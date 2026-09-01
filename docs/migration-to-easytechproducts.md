# Migrating HomeKonet to the `easytechproducts` GCP Project

**Status:** New servers provisioned and readiness-verified. Data cutover not yet
performed — the steps below pick up from here. See `MIGRATION.md` for the
general, reusable runbook this follows; this doc has the concrete values for
*this specific* move (old `eventhub-and-homekonet` project → new
`easytechproducts` project) and records exactly what's already been done.

---

## 1. New server details

| | Old (`eventhub-and-homekonet`) | New (`easytechproducts`) |
|---|---|---|
| App server name | `easytech-svr01` | `easytech-svr01` |
| App server zone | `us-east1-c` | `us-east1-b` (see note below) |
| App server external IP | `34.139.48.198` | `35.243.218.206` |
| App server internal IP | `10.0.1.2` | `10.142.0.3` |
| DB server name | `homekonet-db-svr` | `homekonet-db-svr` |
| DB server zone | `us-east1-c` | `us-east1-b` |
| DB server external IP | `34.24.9.173` | **none** (see note below) |
| DB server internal IP | `10.0.1.4` | `10.142.0.4` |
| PostgreSQL version | 16.14 | 16.15 |
| Docker version | 29.6.1 | 29.7.2 |

**Zone note:** `us-east1-c` was out of `pd-balanced` disk capacity for both
VMs at provisioning time (`ZONE_RESOURCE_POOL_EXHAUSTED`) — used `us-east1-b`
instead (same region, satisfies "keep app + DB in the same region/VPC").

**DB server has no external IP** (deliberate improvement over the old
server, which is directly internet-reachable on SSH) — it's only reachable
via SSH from the app server's internal network or via IAP tunneling. This
means:
- SSH to it needs `--tunnel-through-iap`:
  ```bash
  gcloud compute ssh homekonet-db-svr --zone=us-east1-b --project=easytechproducts --tunnel-through-iap
  ```
- Because it has no external IP, it also has **no outbound internet access**
  by default — a **Cloud NAT** gateway (`homekonet-nat-router` +
  `homekonet-nat`, region `us-east1`) was created so `apt-get`/package
  installs work. This is a permanent piece of infrastructure the DB server
  now depends on — don't delete it.

## 2. What's already done on the new servers

- [x] Compute Engine API enabled on `easytechproducts`.
- [x] Both VMs created (Debian 12, matching current OS), OS Login enabled
      (`enable-oslogin=TRUE` metadata) so IAM-based SSH access works the same
      way it does today.
- [x] Firewall rules: `allow-http-https` (80/443, app server), `allow-pgadmin`
      (5050, open to `0.0.0.0/0` — **matches the current production setup**,
      which is also open to the whole internet; tighten this on both if you
      want to change that going forward, it wasn't changed here to keep
      parity). SSH (22) and all internal VPC traffic (including Postgres
      5432 between the two servers) are already covered by the network's
      default `default-allow-ssh` / `default-allow-internal` rules — no
      extra rule was needed for 5432.
- [x] Cloud NAT set up for the DB server's outbound internet access (see §1).
- [x] Docker + Docker Compose plugin installed on the app server (from
      Docker's **Debian** repo — `docs/DEPLOYMENT.md` previously pointed at
      the Ubuntu repo by mistake; fixed as part of this work).
- [x] PostgreSQL 16 installed on the DB server (pinned to 16, matching
      production — *not* whatever's newest, since a 17-vs-16 `pg_dump`/
      `pg_restore` mismatch was a real incident on the current servers; see
      `scripts/backup.sh`'s version-matching fix).
- [x] `homekonet_app` role + `homekonet` database created, **with
      `homekonet_app` as the owner from creation** (avoids the exact "must be
      owner of table" migration failure hit on the current DB server, where
      most tables ended up owned by `postgres` instead).
- [x] `postgresql.conf` (`listen_addresses = '*'`) and `pg_hba.conf`
      (`host homekonet homekonet_app 10.142.0.0/20 scram-sha-256`) configured
      so the app server can reach it.
- [x] End-to-end connectivity verified: `psql` from the app server to the DB
      server over the internal network, authenticated as `homekonet_app`,
      confirmed working.
- [x] `fail2ban` + `unattended-upgrades` installed on both (matching current
      hardening).

## 3. What's NOT done yet — still needs action

- [ ] **Jake's IAM access on the new project.** Granting
      `roles/compute.osAdminLogin`, `roles/iap.tunnelResourceAccessor`, and
      `roles/compute.instanceAdmin.v1` to `jaketreeves@gmail.com` on
      `easytechproducts` was blocked by this session's safety guardrails
      (granting another person access to a project is treated as sensitive).
      Whoever owns/administers `easytechproducts` needs to run:
      ```bash
      gcloud projects add-iam-policy-binding easytechproducts \
        --member="user:jaketreeves@gmail.com" --role="roles/compute.osAdminLogin"
      gcloud projects add-iam-policy-binding easytechproducts \
        --member="user:jaketreeves@gmail.com" --role="roles/iap.tunnelResourceAccessor"
      gcloud projects add-iam-policy-binding easytechproducts \
        --member="user:jaketreeves@gmail.com" --role="roles/compute.instanceAdmin.v1"
      ```
      Same idea for anyone else (e.g. whoever "Jdalton" is under their own
      Google identity, not the shared account) who needs equivalent access —
      grant the same three roles.
- [ ] **The actual data cutover** — nothing from the live database or media
      has been copied yet. The two new servers are empty, ready-to-receive
      infrastructure, not a live copy. Follow §4 below.
- [ ] **pgAdmin** — not yet deployed on the new app server (it comes up as
      part of `docker compose up` in §4, using the same `pgadmin_data`
      restore step as any other migration).
- [ ] **DNS and TLS** — still point at the old servers; not touched yet by
      design (see `MIGRATION.md` §5–6 — don't cut over until the rest is
      verified).

## 4. Remaining steps to finish the migration

These are `MIGRATION.md`'s generic steps, with the concrete values for this
move filled in. Full explanations of *why* each step exists are in that doc —
this is the copy-paste version for this specific migration.

### 4.1 Take a fresh backup on the OLD app server

```bash
# on easytech-svr01 (old project)
cd /opt/homekonet
BACKUP_PASSPHRASE="$(cat /root/.backup-passphrase)" bash scripts/backup.sh
# or, if the weekly cron passphrase file doesn't exist yet, run interactively
# and choose a passphrase — write it down, you need it in step 4.3.
```

### 4.2 Copy the archive to the NEW app server

```bash
# from easytech-svr01 (old project) — scp straight to the new one
scp -o ProxyCommand="gcloud compute start-iap-tunnel easytech-svr01 22 --listen-on-stdin --project=easytechproducts --zone=us-east1-b" \
  backups/homekonet-backup-*.tar.gz.gpg \
  easytecheventhub_gmail_com@easytech-svr01:/tmp/
# simpler alternative if the new app server's external IP is reachable:
scp backups/homekonet-backup-*.tar.gz.gpg easytecheventhub_gmail_com@35.243.218.206:/tmp/
```

### 4.3 On the NEW app server: clone, restore, configure

```bash
gcloud compute ssh easytech-svr01 --zone=us-east1-b --project=easytechproducts
sudo mkdir -p /opt/homekonet && sudo chown "$(whoami)":"$(whoami)" /opt/homekonet
git clone https://github.com/Easy-Tech-Solutions/realestate-booking-platform.git /opt/homekonet
cd /opt/homekonet
bash scripts/restore.sh /tmp/homekonet-backup-*.tar.gz.gpg
```

Then edit `backend/.env`:
- `POSTGRES_HOST=10.142.0.4` (the new DB server's internal IP — **not**
  `10.0.1.4`, that's the old one)
- `POSTGRES_PASSWORD=` → the `homekonet_app` password generated in §2
  (rotate it if you'd rather not reuse the one from this session)
- `DJANGO_ALLOWED_HOSTS`, `FRONTEND_ORIGIN`, `CORS_ALLOWED_ORIGINS` — leave as
  `homekonet.com`/`www.homekonet.com` (same domain, only the server moves)

### 4.4 Restore the database dump

```bash
# on the NEW app server, after backend/.env points at 10.142.0.4
source <(grep -E '^POSTGRES_' backend/.env)
PGPASSWORD="$POSTGRES_PASSWORD" pg_restore --no-owner --no-acl --clean --if-exists \
  -h "$POSTGRES_HOST" -p "${POSTGRES_PORT:-5432}" -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  backups/database.dump
```

`--no-owner` means restored objects end up owned by whichever role runs this
(`homekonet_app`, since that's `$POSTGRES_USER`) — this is what avoids
recreating the ownership bug from the incident on the current servers.

### 4.5 Build, dry-run, then go live

Follow `MIGRATION.md` §4 and §7 exactly as written — `docker compose build`,
`docker compose up -d`, `curl https://homekonet.com/api/health/` — nothing
about those steps changes for this migration.

### 4.6 DNS and TLS cutover

Follow `MIGRATION.md` §5–6, pointing `homekonet.com` / `www.homekonet.com` at
`35.243.218.206` (the new app server's external IP) instead of
`34.139.48.198`.

### 4.7 pgAdmin

Follow `MIGRATION.md` §8. Access it afterward at
`http://35.243.218.206:5050`.

### 4.8 Decommission the old project

Only after the new servers have been verified stable for a few days — see
`MIGRATION.md` §9 ("Decommission the old server") for the same caution here,
applied to the whole `eventhub-and-homekonet` project once you're confident.
