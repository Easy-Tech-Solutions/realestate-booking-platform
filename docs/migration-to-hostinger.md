# Migration Report — GCP (two VMs) → Hostinger (one VPS)

**Status:** Complete. `homekonet.com` is live on the new server. Old GCP
servers are stopped (app layer) / untouched (database) and kept as a
rollback fallback pending a confidence window before decommissioning.

**Date:** 2026-10-03

---

## 1. Why

The stack was split across two GCP VMs in the `easytechproducts` project —
`easytech-svr01` (e2-standard-4: 4 vCPU/16GB, the full Docker Compose stack)
and `homekonet-db-svr` (e2-standard-2: 2 vCPU/8GB, bare-metal Postgres 16,
no public IP, reachable only via an internal VPC + a Cloud NAT gateway).

Live measurements taken before this migration showed both boxes heavily
over-provisioned for actual usage:

| Metric | Measured |
|---|---|
| All 7 containers, combined RAM (steady-state) | ~1.4GB (`docker stats`) |
| Database size | 19MB |
| Database connections | 51 open, ~1 active at a time |
| Database CPU, 14-day peak | ~0.6 of one vCPU (daily max 2.5–3.5% normally, two anomalous spikes to ~20–28%, against a 2-vCPU box) |

A single Hostinger VPS (16GB RAM / 4 vCPU / 200GB disk) — already
provisioned — is roughly 8x the measured steady-state need. This migration
consolidates both GCP VMs onto it, cutting cost with no sizing risk.

## 2. New server

| | Value |
|---|---|
| Provider | Hostinger VPS |
| Public IP | `179.198.215.152` |
| OS | Ubuntu 26.04.1 LTS ("resolute") |
| Specs | 4 vCPU / 16GB RAM / 200GB disk |
| App directory | `/opt/homekonet` |
| Deploy user | `homekonet` (passwordless sudo, `docker` group) — created during this migration, replacing root login |
| Repo | `https://github.com/Easy-Tech-Solutions/realestate-booking-platform.git`, `main` @ `3c85a2a` at cutover |

## 3. Architecture change: Postgres is now a container, not bare-metal

The original plan (see `docs/gcp-postgres-migration.md`'s pattern, adapted)
called for installing PostgreSQL 16 directly on the VPS, bound to
`localhost` only, matching the bare-metal convention from the GCP database
VM. That install was completed and *data-verified* — but hit a real
blocker once the app containers tried to reach it: `127.0.0.1` inside a
Docker container is the container's own loopback, not the host's, so
`backend`/`celery*` had no way to reach a host-bound Postgres without either
widening its bind address (a real security-posture change the session's own
safety check correctly flagged and refused to apply silently) or switching
Postgres into the compose stack itself.

**Decision (user call, explicit requirement: no data loss):** run Postgres
as a `db` service inside `docker-compose.yml`, on the same Docker network as
the rest of the stack, reached by service name — not bare-metal. This is
also architecturally simpler than the original plan: no cross-host network
boundary to secure at all, since everything is one Docker Compose project.

The bare-metal install was not discarded destructively — it was stopped and
disabled (`systemctl stop/disable postgresql`), not uninstalled, and its
data directory is still on disk at `/var/lib/postgresql/16/main` as a second
safety copy, redundant with the GCP database VM itself.

```yaml
# docker-compose.yml — new service
db:
  image: postgres:16
  restart: unless-stopped
  environment:
    POSTGRES_USER: homekonet_app
    POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}   # in .env, not committed
    POSTGRES_DB: homekonet
  volumes:
    - postgres_data:/var/lib/postgresql/data
  healthcheck:
    test: ["CMD-SHELL", "pg_isready -U homekonet_app -d homekonet"]
    interval: 10s
    timeout: 5s
    retries: 5
```

`backend`, `celery`, `celery-beat`, `celery-ai` each gained
`db: condition: service_healthy` alongside their existing `redis` dependency.
`backend/.env`: `POSTGRES_HOST=db`, `POSTGRES_SSLMODE=disable` /
`POSTGRES_CHANNEL_BINDING=disable` (internal Docker network traffic, no TLS
needed — same reasoning as the original localhost-only plan, just one layer
further out).

## 4. Data integrity — verified at every stage

| Stage | Users | Listings | Bookings |
|---|---|---|---|
| Original production (GCP) | 45 | 22 | 29 |
| After first restore into bare-metal Postgres on the VPS | 45 | 22 | 29 |
| After restore into the `db` container | 45 | 22 | 29 |
| **After the final write-frozen resync (post-DNS-cutover)** | **45** | **22** | **29** |

No divergence at any point. The final row matters most: once DNS was
pointed at the new server, `backend`/`celery*` on the old app server were
stopped first (freezing writes), a fresh `pg_dump` was taken directly from
the old database VM (`10.142.0.4`, which stayed running throughout — only
the app layer was frozen), and that final dump was restored into the new
`db` container, overwriting the slightly earlier copy. Counts matched
before and after, confirming no write happened in the gap.

Also verified: a full login round-trip (JWT issuance) against a disposable
test account, confirming restored password hashes authenticate correctly
through the whole stack — not just that rows exist, but that the app
actually works against them.

## 5. What else changed (security improvements, not just a like-for-like move)

- **SSH hardened**: key-only auth, root login disabled, a non-root
  `homekonet` user created with passwordless sudo. Verified both the
  session's own key and the user's personal key work *before* disabling
  password/root login, to avoid a lockout.
- **`ufw` firewall**: default-deny incoming, only OpenSSH/80/443 open.
- **pgAdmin**: bound to `127.0.0.1:5050` only (reach it via
  `ssh -L 5050:localhost:5050 homekonet@179.198.215.152`, then browse to
  `localhost:5050`) — the old GCP server exposed it to the entire internet
  (`0.0.0.0:5050`), inherited unexamined from an even earlier migration.
  Fixed here since the network boundary was being rebuilt anyway.
- **Postgres**: not reachable from outside the Docker Compose network at
  all (no host port published) — stricter than the old GCP setup, which
  listened on an internal VPC IP reachable from the app server over the
  network.
- `fail2ban` + `unattended-upgrades` installed and enabled, matching the old
  server's baseline.

## 6. Cutover sequence (what actually happened, in order)

1. VPS hardening: `ufw`, `fail2ban`, unattended-upgrades, non-root deploy
   user, SSH key-only.
2. PostgreSQL 16 installed bare-metal, tuned, verified with a full
   data restore (then superseded — see §3).
3. `scripts/backup.sh` on the old app server → encrypted archive → `scp` to
   the new VPS → `scripts/restore.sh` → `backend/.env` updated for the new
   database location.
4. `db` service added to `docker-compose.yml`; data restored into it;
   verified against production row counts.
5. Full stack built (`docker compose build`) and brought up
   (`docker compose up -d`) on the new VPS, validated pre-cutover via direct
   IP + `Host:` header (health check, listings API, media images, login).
6. **User pointed `homekonet.com`'s DNS A record at the new server's IP.**
7. Write-freeze: `backend`/`celery*` stopped on the old app server.
8. Final `pg_dump` taken directly from the old database VM (still running),
   transferred, restored into the new `db` container — confirmed identical
   row counts to the pre-freeze state (no writes lost).
9. Fresh Let's Encrypt certificate issued on the new server (the restored
   copy of the old cert would have kept working, but its renewal hooks
   lived on the old server, which can no longer complete domain validation)
   — brief `frontend` container stop/start around the `certbot certonly
   --standalone` call.
10. `scripts/install-certbot-hooks.sh` run on the new server; renewal
    verified with `certbot renew --dry-run`.
11. pgAdmin's saved servers restored into its volume; port binding
    tightened to localhost-only.
12. Full smoke test against the live `https://homekonet.com` domain: health
    check, listings API, media image serving, HTTPS certificate validity.

## 7. Current state of the old GCP infrastructure

**Nothing has been deleted.** Specifically:

- `easytech-svr01`: `backend`/`celery*`/`celery-beat`/`celery-ai` containers
  are **stopped** (deliberately — DNS no longer resolves here, so there is
  no legitimate traffic to serve; restarting them risks a stray client with
  cached DNS writing to a now-abandoned database). `redis`, `frontend`,
  `pgadmin` were left as-is (not individually addressed, low risk either
  way since the domain doesn't route here anymore).
- `homekonet-db-svr`: Postgres is **still running**, untouched, serving as a
  live read-accessible rollback snapshot.
- Both VMs, the `homekonet-nat-router` Cloud NAT gateway, and the reserved
  static IP (`34.74.99.23`) still exist and are still billing.

## 8. Rollback plan (if needed during the confidence window)

Point `homekonet.com`'s DNS A record back at the old app server's external
IP. The old stack's database is untouched; only its app containers are
stopped — restart them (`docker compose start backend celery celery-beat
celery-ai` on `easytech-svr01`) and rollback is complete. Any writes that
happened against the new server during the time it was live would need to
be manually reconciled before rolling back — the longer the new server runs
before a rollback, the more this matters.

## 9. Outstanding follow-ups

- [ ] **Confidence window**: use the live site for a few days before
      touching the old infrastructure (matches the convention in
      `MIGRATION.md`'s own "Decommission the old server" section).
- [ ] **Decommission GCP** (only after the above): delete `easytech-svr01`
      and `homekonet-db-svr`, delete the `homekonet-nat-router` Cloud NAT
      gateway (only existed for the database VM's outbound internet access
      — nothing needs it once both VMs are gone), release the reserved
      static IP `34.74.99.23` (small ongoing charge if left allocated).
      Confirm separately whether to fully wind down the `easytechproducts`
      project or leave it dormant.
- [ ] **Credential rotation**: the `homekonet_app` Postgres password was
      freshly generated for this migration (not reused from the GCP
      database), a good moment also to rotate any other long-lived secret
      in `backend/.env` if desired.
- [ ] **Automated backups on the new server**: this migration moved data
      once; it did not set up a recurring backup cron
      (`docs/gcp-postgres-migration.md` §16 / `MIGRATION.md`'s "Backing up
      without a full server migration" section describe the pattern) — set
      one up on the new VPS before relying on it long-term.
