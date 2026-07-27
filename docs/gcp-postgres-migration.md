# HomeKonet — Migrating from Neon to a Self-Hosted PostgreSQL VM on GCP

**Status:** Planning document
**Trigger:** Production outage on 2026-07-26 — Neon returned `ERROR: Your account or
project has exceeded the compute time quota. Upgrade your plan to increase limits.`
Every request that touched the database (login, listings, health check) failed
with a 500 until the quota issue was resolved on Neon's side. This document is
the plan to remove that single point of failure by hosting our own PostgreSQL
instance on a dedicated Google Cloud Compute Engine VM, inside the same VPC as
the application server, so we control capacity, quotas, and uptime ourselves.

---

## Table of Contents

1. [Decision Summary](#1-decision-summary)
2. [Current Environment](#2-current-environment)
3. [Target Architecture](#3-target-architecture)
4. [Server Specifications](#4-server-specifications)
5. [Prerequisites](#5-prerequisites)
6. [Step 1 — Provision the GCP VM](#6-step-1--provision-the-gcp-vm)
7. [Step 2 — Baseline OS Hardening](#7-step-2--baseline-os-hardening)
8. [Step 3 — Install PostgreSQL 16](#8-step-3--install-postgresql-16)
9. [Step 4 — Configure PostgreSQL](#9-step-4--configure-postgresql)
10. [Step 5 — Lock Down Networking](#10-step-5--lock-down-networking)
11. [Step 6 — Enable SSL on PostgreSQL](#11-step-6--enable-ssl-on-postgresql)
12. [Step 7 — Create the Database and Role](#12-step-7--create-the-database-and-role)
13. [Step 8 — Migrate Data from Neon](#13-step-8--migrate-data-from-neon)
14. [Step 9 — Cut Over the Application](#14-step-9--cut-over-the-application)
15. [Step 10 — Post-Cutover Verification](#15-step-10--post-cutover-verification)
16. [Step 11 — Automated Backups](#16-step-11--automated-backups)
17. [Step 12 — Monitoring and Alerting](#17-step-12--monitoring-and-alerting)
18. [Rollback Plan](#18-rollback-plan)
19. [Security Hardening Checklist](#19-security-hardening-checklist)
20. [Ongoing Maintenance](#20-ongoing-maintenance)
21. [Cost Comparison](#21-cost-comparison)
22. [Quick Reference](#22-quick-reference)

---

## 1. Decision Summary

| | Current (Neon) | Proposed (self-hosted GCP VM) |
|---|---|---|
| Compute | Shared, metered compute-time quota | Dedicated vCPU/RAM, always on |
| Outage cause seen in production | Quota exhaustion → hard connection refusal | Only self-inflicted (disk full, OOM, our own misconfig) |
| Cost model | Usage-based, can spike or cut off | Flat monthly VM cost, predictable |
| Control over tuning (`shared_buffers`, connections, etc.) | None | Full |
| Backup/restore | Neon-managed branching/PITR | We own it — must implement (§16) |
| Operational burden | ~Zero | We patch, back up, and monitor it |

**Recommendation:** move to a dedicated e2-standard-2 (or larger — see §4) GCP VM
running PostgreSQL 16 natively (not in Docker), in the **same VPC and region** as
the app server so traffic stays on the internal network and never touches the
public internet. This trades a small amount of ongoing ops work for full control
over uptime and eliminates the exact failure mode that caused the 2026-07-26
outage.

---

## 2. Current Environment

Captured directly from the running app server via the GCP metadata service, so
the plan below plugs into what actually exists rather than a generic example:

| Item | Value |
|---|---|
| GCP Project ID | `eventhub-and-homekonet` |
| VPC network | `easytechnet` |
| App server zone | `us-east1-c` (region `us-east1`) |
| App server machine type | `e2-standard-4` (4 vCPU / 16 GB RAM) |
| App server internal IP | `10.0.1.2` (subnet `/24`) |
| App server OS | Debian 12 (bookworm) |
| Current disk usage | 47 GB / 99 GB (50%) |
| Current DB | Neon PostgreSQL (managed, external) — version 16 |
| Backend DB config | `backend/.env` → `DATABASE_URL` (Neon) or discrete `POSTGRES_*` + `DB_ENGINE=postgres` (see `backend/realestate_backend/settings.py:168-209`) |
| App containers | `redis`, `backend`, `celery`, `celery-beat`, `celery-ai`, `frontend` (docker-compose, no `db` service today) |

The Django settings module already supports connecting to a self-hosted Postgres
via discrete environment variables — this is the exact code path used by local
development today:

```python
# backend/realestate_backend/settings.py (existing code, no changes needed)
elif os.environ.get("DB_ENGINE", "sqlite").lower() == "postgres":
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": os.environ["POSTGRES_DB"],
            "USER": os.environ["POSTGRES_USER"],
            "PASSWORD": os.environ["POSTGRES_PASSWORD"],
            "HOST": os.environ["POSTGRES_HOST"],
            "PORT": os.environ.get("POSTGRES_PORT", "5432"),
            "CONN_MAX_AGE": int(os.environ.get("POSTGRES_CONN_MAX_AGE", "60")),
            "OPTIONS": {
                "sslmode": os.environ.get("POSTGRES_SSLMODE", "require"),
                "channel_binding": os.environ.get("POSTGRES_CHANNEL_BINDING", "require"),
            },
        }
    }
```

This means **no application code changes are required** for this migration —
only `backend/.env` values change (§14).

---

## 3. Target Architecture

```
                      VPC: easytechnet (us-east1)
   ┌───────────────────────────────────────────────────────────────┐
   │                                                                │
   │   App server (existing)              DB server (new)          │
   │   e2-standard-4, us-east1-c           e2-standard-2, us-east1-c│
   │   10.0.1.2                            10.0.1.X (new)          │
   │   ┌─────────────────────┐             ┌──────────────────┐    │
   │   │ nginx (80/443, public)             │ PostgreSQL 16     │    │
   │   │ backend / celery*    │──5432/tcp──▶│ (internal IP only)│    │
   │   │ redis                │  private    │ no public IP      │    │
   │   └─────────────────────┘   only       └──────────────────┘    │
   │                                              │                 │
   │                                        nightly pg_dump         │
   │                                              ▼                 │
   │                                    GCS bucket (backups)         │
   └───────────────────────────────────────────────────────────────┘
```

Key decisions:

- **Dedicated VM**, not a `db:` container bolted onto the existing app server.
  A database has a different failure/scaling profile than the app tier (disk
  I/O and RAM matter far more than CPU) and we don't want a runaway backend
  process or a bad container rebuild to ever touch database uptime.
- **No public IP** on the DB VM. It is only reachable from inside the
  `easytechnet` VPC. This closes off the entire internet-facing attack surface
  that a publicly reachable Postgres port would have.
- **Same region/zone as the app server** (`us-east1-c`) to keep round-trip
  latency in the sub-millisecond range, same as it would be for two containers
  on one host.
- **Firewall rule scoped to the app server's IP only** — not "allow from VPC,"
  specifically the app server's internal IP (and any future app-tier IPs you
  add), least-privilege.

---

## 4. Server Specifications

Sizing is driven by RAM (PostgreSQL leans on OS page cache + `shared_buffers`),
not raw vCPU count, for a workload this size (a booking platform's relational
data — users, listings, bookings, payments, messages — is small compared to
media, which already lives in Cloudinary, not the DB).

| Tier | Machine type | vCPU | RAM | Disk | Monthly est.* | When to use |
|---|---|---|---|---|---|---|
| Minimum | `e2-small` | 2 | 2 GB | 30 GB SSD | ~$14 | Staging/testing only — not recommended for production |
| **Recommended** | **`e2-standard-2`** | **2** | **8 GB** | **50 GB SSD (pd-ssd)** | **~$50** | Production — matches or exceeds current Neon free/starter tier compute, headroom for years of growth at current data volume |
| Growth | `e2-standard-4` | 4 | 16 GB | 100 GB SSD | ~$100 | If connection counts or query concurrency grow significantly (e.g. celery-ai or reporting workloads start hitting the DB hard) |

<sub>*Rough us-east1 on-demand pricing at time of writing — verify current
rates at cloud.google.com/compute/pricing before committing; use committed-use
or sustained-use discounts once the sizing is validated in production.</sub>

**Disk:** use `pd-ssd` (not `pd-standard`/HDD) — Postgres is latency-sensitive
on WAL fsyncs, and standard persistent disks will show up as query latency
spikes under write load (booking/payment writes, in this app). 50 GB gives
significant headroom over the current dataset size for a platform of this
scale; resize is a one-command operation later if needed (`gcloud compute
disks resize`), so it is not a one-shot irreversible decision.

**OS image:** Debian 12 (bookworm) — matches the app server exactly, so the
same runbooks, monitoring agents, and muscle memory apply to both boxes.

---

## 5. Prerequisites

- `gcloud` CLI authenticated with an account that has `roles/compute.admin` (or
  equivalent) on project `eventhub-and-homekonet`.
- Confirm quota for one more VM + one more persistent disk in `us-east1`
  (`gcloud compute regions describe us-east1`).
- A maintenance window communicated to users — cutover (§14) requires a few
  minutes of write downtime while the final data sync happens.
- Access to the current Neon connection string (`backend/.env` →
  `DATABASE_URL`) to run `pg_dump` against it.
- A GCS bucket for backups, or reuse an existing one — see §16.

---

## 6. Step 1 — Provision the GCP VM

```bash
# Reserve a static internal IP so the app's .env never needs to change again
# even if the VM is recreated.
gcloud compute addresses create homekonet-db-internal \
  --project=eventhub-and-homekonet \
  --region=us-east1 \
  --subnet=easytechnet \
  --addresses=10.0.1.10   # pick an unused IP in the same /24 as 10.0.1.2

# Create the VM — no external IP (--no-address), same VPC/zone as the app server.
gcloud compute instances create homekonet-db \
  --project=eventhub-and-homekonet \
  --zone=us-east1-c \
  --machine-type=e2-standard-2 \
  --network=easytechnet \
  --private-network-ip=homekonet-db-internal \
  --no-address \
  --image-family=debian-12 \
  --image-project=debian-cloud \
  --boot-disk-size=20GB \
  --boot-disk-type=pd-ssd \
  --create-disk=name=homekonet-db-data,size=50GB,type=pd-ssd,device-name=pgdata \
  --tags=homekonet-db
```

Notes:
- The 20 GB boot disk holds the OS only; PostgreSQL's actual data directory
  lives on the separate 50 GB `pgdata` disk attached above — this lets you
  resize/snapshot/replace the data disk independently of the OS disk later.
- `--tags=homekonet-db` is referenced by the firewall rule in §10.
- If `10.0.1.10` is already taken in your subnet, pick the next free address —
  check with `gcloud compute addresses list --filter="region:us-east1"`.

SSH in via IAP (no public IP needed for access, no bastion required):

```bash
gcloud compute ssh homekonet-db --zone=us-east1-c --tunnel-through-iap
```

Format and mount the data disk:

```bash
sudo mkfs.ext4 -m 0 -F -E lazy_itable_init=0,lazy_journal_init=0,discard \
  /dev/disk/by-id/google-pgdata
sudo mkdir -p /var/lib/postgresql
echo '/dev/disk/by-id/google-pgdata /var/lib/postgresql ext4 discard,defaults,nofail 0 2' \
  | sudo tee -a /etc/fstab
sudo mount -a
```

---

## 7. Step 2 — Baseline OS Hardening

```bash
sudo apt update && sudo apt upgrade -y

# Unattended security upgrades, matching the app server's baseline.
sudo apt install -y unattended-upgrades fail2ban
sudo dpkg-reconfigure -plow unattended-upgrades

# Create a non-root admin user for day-to-day access (avoid using the
# default GCP-provisioned user for routine work).
sudo adduser dbadmin
sudo usermod -aG sudo dbadmin

# Timezone consistency with the app server.
sudo timedatectl set-timezone UTC
```

Since the VM has no public IP, SSH exposure is already minimal (only reachable
via IAP tunnel, which is itself gated by IAM). Still disable password auth as
defense in depth:

```bash
sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo systemctl restart ssh
```

---

## 8. Step 3 — Install PostgreSQL 16

Match the version currently used by Neon (16) so the migration in §13 is a
same-version `pg_dump`/`pg_restore` — no cross-version upgrade risk mixed into
the cutover.

```bash
sudo apt install -y curl ca-certificates gnupg

# Add the official PostgreSQL APT repository (Debian's default repos lag behind).
sudo install -d /usr/share/postgresql-common/pgdg
sudo curl -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
  --fail https://www.postgresql.org/media/keys/ACCC4CF8.asc
sudo sh -c 'echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] \
  https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
  > /etc/apt/sources.list.d/pgdg.list'

sudo apt update
sudo apt install -y postgresql-16 postgresql-contrib-16

systemctl status postgresql   # should show "active (running)"
```

Point PostgreSQL's data directory at the mounted 50 GB disk instead of the
boot disk:

```bash
sudo systemctl stop postgresql
sudo mkdir -p /var/lib/postgresql/16/main
sudo chown -R postgres:postgres /var/lib/postgresql
sudo -u postgres /usr/lib/postgresql/16/bin/initdb -D /var/lib/postgresql/16/main
sudo systemctl start postgresql
sudo systemctl enable postgresql
```

---

## 9. Step 4 — Configure PostgreSQL

Edit `/etc/postgresql/16/main/postgresql.conf`. Values below are tuned for the
recommended `e2-standard-2` (2 vCPU / 8 GB RAM) tier — halve or double
proportionally if you pick a different tier from §4.

```ini
# Connections
listen_addresses = 'localhost,10.0.1.10'   # the DB VM's own internal IP only — never '*'
max_connections = 100                       # Django CONN_MAX_AGE=60 reuses connections; 100 is generous

# Memory (8 GB RAM box)
shared_buffers = 2GB                        # ~25% of RAM
effective_cache_size = 6GB                  # ~75% of RAM
work_mem = 16MB
maintenance_work_mem = 512MB

# Write-ahead log / durability
wal_level = replica                         # leaves room to add a read replica later
max_wal_size = 2GB
min_wal_size = 512MB
checkpoint_completion_target = 0.9

# SSL (see §11)
ssl = on
ssl_cert_file = '/etc/postgresql/16/main/server.crt'
ssl_key_file = '/etc/postgresql/16/main/server.key'

# Logging — keep enough to diagnose issues without drowning the disk
log_min_duration_statement = 500            # log queries slower than 500ms
log_checkpoints = on
log_connections = on
log_disconnections = on
log_lock_waits = on
```

Edit `/etc/postgresql/16/main/pg_hba.conf` — allow the app server's internal IP
only, over SSL, with password auth:

```
# TYPE  DATABASE        USER            ADDRESS                 METHOD
local   all             postgres                                peer
host    homekonet       homekonet_app   10.0.1.2/32             scram-sha-256
hostssl homekonet       homekonet_app   10.0.1.2/32             scram-sha-256
```

Then:

```bash
sudo systemctl restart postgresql
```

---

## 10. Step 5 — Lock Down Networking

GCP firewall rule — allow port 5432 **only** from the app server's internal IP,
not the whole subnet:

```bash
gcloud compute firewall-rules create allow-homekonet-db-from-app \
  --project=eventhub-and-homekonet \
  --network=easytechnet \
  --direction=INGRESS \
  --action=ALLOW \
  --rules=tcp:5432 \
  --source-ranges=10.0.1.2/32 \
  --target-tags=homekonet-db
```

Do **not** create a rule allowing 5432 from `0.0.0.0/0` at any point — the DB
VM has no external IP, so this would have no effect anyway, but it's worth
stating as a hard rule for anyone extending this later (e.g. if a bastion or
second app server is added, add its specific IP, never a wildcard).

Verify from the app server after this rule is in place:

```bash
# Run on the app server (10.0.1.2)
nc -zv 10.0.1.10 5432   # should say "succeeded"
```

---

## 11. Step 6 — Enable SSL on PostgreSQL

Self-signed certificate is sufficient here since traffic never leaves the
private VPC — this protects against anything that might be listening on the
internal network, not against a public MITM:

```bash
sudo -u postgres openssl req -new -x509 -days 3650 -nodes -text \
  -out /etc/postgresql/16/main/server.crt \
  -keyout /etc/postgresql/16/main/server.key \
  -subj "/CN=homekonet-db.internal"
sudo -u postgres chmod 600 /etc/postgresql/16/main/server.key
sudo systemctl restart postgresql
```

Copy `server.crt` to the app server so Django can verify it (optional but
recommended — otherwise use `sslmode=require` without `verify-full`, which
still encrypts the connection but doesn't verify the certificate identity):

```bash
# From the app server
gcloud compute scp homekonet-db:/etc/postgresql/16/main/server.crt \
  ./backend/certs/homekonet-db.crt --zone=us-east1-c --tunnel-through-iap
```

---

## 12. Step 7 — Create the Database and Role

```bash
sudo -u postgres psql <<'SQL'
CREATE DATABASE homekonet;
CREATE ROLE homekonet_app WITH LOGIN PASSWORD 'CHANGE_ME_STRONG_PASSWORD';
ALTER DATABASE homekonet OWNER TO homekonet_app;
GRANT ALL PRIVILEGES ON DATABASE homekonet TO homekonet_app;
SQL
```

Generate the password with something like `openssl rand -base64 32` and store
it in your secrets manager / password vault — this is the value that goes into
`backend/.env` as `POSTGRES_PASSWORD` in §14.

---

## 13. Step 8 — Migrate Data from Neon

This is the step with real downtime risk — do it in two passes: a full dump
taken ahead of time (while the app is still live against Neon) to validate the
process end-to-end, then a final short dump during the maintenance window.

**Dry run (any time before the maintenance window):**

```bash
# From a machine with network access to Neon (the app server works).
# $NEON_DATABASE_URL is the existing backend/.env DATABASE_URL value.
pg_dump --format=custom --no-owner --no-acl \
  --dbname="$NEON_DATABASE_URL" \
  --file=homekonet_dryrun.dump

# Copy to the new DB VM and restore into a scratch DB to validate.
gcloud compute scp homekonet_dryrun.dump homekonet-db:~/ \
  --zone=us-east1-c --tunnel-through-iap

# On homekonet-db:
sudo -u postgres createdb homekonet_scratch
sudo -u postgres pg_restore --no-owner --no-acl \
  --dbname=homekonet_scratch homekonet_dryrun.dump

# Spot-check row counts match Neon for a few key tables, then drop the scratch DB.
sudo -u postgres psql -d homekonet_scratch -c "SELECT count(*) FROM users_user;"
sudo -u postgres dropdb homekonet_scratch
```

**Final migration (during the maintenance window):**

```bash
# 1. Put the app in maintenance mode / stop write traffic.
#    Simplest option for this stack: stop the backend + celery containers so
#    nothing writes to Neon during the final dump.
docker compose stop backend celery celery-beat celery-ai

# 2. Take the final dump from Neon.
pg_dump --format=custom --no-owner --no-acl \
  --dbname="$NEON_DATABASE_URL" \
  --file=homekonet_final.dump

# 3. Copy it to the new DB VM.
gcloud compute scp homekonet_final.dump homekonet-db:~/ \
  --zone=us-east1-c --tunnel-through-iap

# 4. Restore into the real 'homekonet' database created in §12.
sudo -u postgres pg_restore --no-owner --no-acl --clean --if-exists \
  --dbname=homekonet ~/homekonet_final.dump

# 5. Re-grant ownership (pg_restore --no-owner restores objects as the
#    connecting role, which should already be homekonet_app if you ran the
#    restore as that role — otherwise fix up ownership explicitly):
sudo -u postgres psql -d homekonet -c \
  "REASSIGN OWNED BY postgres TO homekonet_app;"
```

Expect this final pass to take well under a minute for a dataset this size
(users, listings, bookings, messages — no large binary blobs, since media is
in Cloudinary) — confirm actual duration on the dry run in step one and use
that to set expectations for the maintenance window length.

---

## 14. Step 9 — Cut Over the Application

Update `backend/.env` on the app server:

```bash
# Remove or comment out:
# DATABASE_URL=postgres://...neon.tech/...

# Add:
DB_ENGINE=postgres
POSTGRES_DB=homekonet
POSTGRES_USER=homekonet_app
POSTGRES_PASSWORD=<the password generated in §12>
POSTGRES_HOST=10.0.1.10
POSTGRES_PORT=5432
POSTGRES_CONN_MAX_AGE=60
POSTGRES_SSLMODE=require
POSTGRES_CHANNEL_BINDING=disable   # self-hosted Postgres doesn't need Neon's channel_binding=require
```

Redeploy following this project's established pattern (see
`docs/developer-guide.html` → CLI Reference):

```bash
docker compose run --rm backend python manage.py check
docker compose up -d --force-recreate backend celery celery-beat celery-ai
```

`docker-entrypoint.sh` will run `migrate --no-input` automatically on startup
— this should be a no-op (`No migrations to apply`) since the restored dump
already reflects the current migration state, but it's a cheap safety check.

---

## 15. Step 10 — Post-Cutover Verification

```bash
curl -sk https://homekonet.com/api/health/
docker inspect --format='{{.State.Health.Status}}' homekonet-backend-1

# Confirm the app is actually talking to the new DB, not a cached connection:
docker compose exec backend python manage.py shell -c \
  "from django.db import connection; print(connection.settings_dict['HOST'])"
```

Smoke-test end to end:
- Log in as an existing user (confirms `users_user` data + password hashes
  survived the dump/restore intact).
- Load the listings page (confirms `listings_listing` + related tables).
- Check a recent booking in Trips (confirms `bookings_booking`).

Keep the `backend`/`celery*` containers stopped against Neon for a day or two
before deleting the Neon project entirely — see §18.

---

## 16. Step 11 — Automated Backups

Neon previously handled this for you; it is now our responsibility.

**Nightly `pg_dump` to Cloud Storage**, via cron on `homekonet-db`:

```bash
# /etc/cron.d/homekonet-db-backup
0 3 * * * postgres pg_dump --format=custom --no-owner --no-acl \
  --dbname=homekonet --file=/tmp/homekonet-$(date +\%Y\%m\%d).dump \
  && gsutil cp /tmp/homekonet-$(date +\%Y\%m\%d).dump gs://homekonet-db-backups/ \
  && find /tmp -name 'homekonet-*.dump' -mtime +2 -delete
```

Set a GCS lifecycle rule to expire objects older than 30 days so the bucket
doesn't grow unbounded:

```bash
gsutil lifecycle set - gs://homekonet-db-backups/ <<'JSON'
{"rule": [{"action": {"type": "Delete"}, "condition": {"age": 30}}]}
JSON
```

**Disk snapshots** as a second, independent recovery path (protects against
`pg_dump`/backup-script bugs, not just data loss):

```bash
gcloud compute resource-policies create snapshot-schedule homekonet-db-daily-snapshot \
  --project=eventhub-and-homekonet --region=us-east1 \
  --max-retention-days=14 \
  --daily-schedule --start-time=04:00

gcloud compute disks add-resource-policies homekonet-db-data \
  --zone=us-east1-c --resource-policies=homekonet-db-daily-snapshot
```

**Restore drill:** actually test a restore from a backup at least once before
relying on this in a real incident — an untested backup is a hope, not a plan.

---

## 17. Step 12 — Monitoring and Alerting

```bash
# Install the Ops Agent for CPU/RAM/disk metrics + log forwarding.
curl -sSO https://dl.google.com/cloudagents/add-google-cloud-ops-agent-repo.sh
sudo bash add-google-cloud-ops-agent-repo.sh --also-install
```

Minimum alerting policies to create in Cloud Monitoring:
- **Disk usage > 80%** on the `pgdata` disk — the single most common cause of
  a self-hosted Postgres outage.
- **VM CPU > 90% for 10+ minutes** — early warning before connections start
  queueing.
- **Postgres process down** (via the Ops Agent's uptime check, or a simple
  `pg_isready` check hitting the app server's known-good query path).

Also enable `pg_stat_statements` for query-level visibility, which Neon's
dashboard previously gave you for free:

```sql
-- In postgresql.conf: shared_preload_libraries = 'pg_stat_statements'
-- then, after restart:
CREATE EXTENSION pg_stat_statements;
```

---

## 18. Rollback Plan

Keep the Neon project **paused, not deleted**, for at least 7 days after
cutover. If something is found wrong post-cutover:

1. Revert `backend/.env` to the previous `DATABASE_URL` (Neon).
2. `docker compose up -d --force-recreate backend celery celery-beat celery-ai`.
3. Any writes that happened against the new self-hosted DB during the
   rollback window need to be manually reconciled (this is why the maintenance
   window in §13 stops writes before the final dump — minimizing this gap to
   effectively zero is the whole point).

Once you're confident (recommend: one full week of clean operation, at least
one successful automated backup + restore drill), delete the Neon project to
stop it from continuing to bill or count toward any account limits.

---

## 19. Security Hardening Checklist

- [ ] DB VM has no external IP (`--no-address` at creation, confirmed via
      `gcloud compute instances describe homekonet-db`)
- [ ] Firewall allows port 5432 only from the app server's specific IP, not
      the subnet/VPC broadly
- [ ] `pg_hba.conf` requires `scram-sha-256`, no `trust` entries beyond local
      `peer` auth for the `postgres` superuser
- [ ] SSL enabled (`ssl = on`) and enforced (`sslmode=require` in the app)
- [ ] `homekonet_app` role has only the privileges it needs on the `homekonet`
      database — not superuser
- [ ] SSH password auth disabled; access only via `gcloud compute ssh
      --tunnel-through-iap`
- [ ] Automatic security updates enabled (`unattended-upgrades`)
- [ ] Backups encrypted at rest (GCS default) and access-restricted (bucket
      IAM, not public)
- [ ] Secrets (`POSTGRES_PASSWORD`) never committed to git — confirm
      `backend/.env` stays in `.gitignore`

---

## 20. Ongoing Maintenance

| Task | Frequency |
|---|---|
| Review disk usage trend | Weekly |
| Confirm last night's backup succeeded | Daily (automate as a monitoring check, not a manual glance) |
| OS security patches (`apt upgrade`) | Monthly, during a maintenance window |
| PostgreSQL minor version updates (16.x → 16.y) | Quarterly |
| Restore drill from backup | Quarterly |
| Review slow query log (`log_min_duration_statement`) | Monthly |
| Re-evaluate VM sizing against actual usage | Every 6 months, or after any noticeable growth in traffic |

---

## 21. Cost Comparison

| | Neon (that hit the quota) | Self-hosted `e2-standard-2` |
|---|---|---|
| Base cost | Free/starter tier compute-time quota, or paid plan to raise it | ~$50/mo flat (verify current GCP pricing) |
| Failure mode hit in production | Hard cutoff at quota exhaustion, no warning short of dashboard checking | None from a quota standpoint — capacity is ours until the VM itself is under-provisioned |
| Backup/PITR | Included, managed | We build and maintain it (§16) — real but bounded engineering cost |
| Scaling | Automatic, but capped by plan/quota | Manual (resize VM/disk) but no external cutoff |

The GCP VM has a small, predictable monthly cost and removes the exact
failure mode that caused this incident. The tradeoff is that backups,
monitoring, and patching become our responsibility instead of Neon's — all
addressed above, but worth stating plainly as the real cost of this move.

---

## 22. Quick Reference

```bash
# SSH to the DB VM
gcloud compute ssh homekonet-db --zone=us-east1-c --tunnel-through-iap

# Check PostgreSQL status
sudo systemctl status postgresql

# Tail PostgreSQL logs
sudo tail -f /var/log/postgresql/postgresql-16-main.log

# Connect locally as an admin
sudo -u postgres psql -d homekonet

# Manual backup right now
sudo -u postgres pg_dump --format=custom --no-owner --no-acl \
  --dbname=homekonet --file=/tmp/manual-backup.dump

# Check current connections from the app
sudo -u postgres psql -d homekonet -c \
  "SELECT client_addr, count(*) FROM pg_stat_activity GROUP BY client_addr;"

# Resize the data disk later if needed (online, no downtime)
gcloud compute disks resize homekonet-db-data --zone=us-east1-c --size=100GB
sudo resize2fs /dev/disk/by-id/google-pgdata
```
