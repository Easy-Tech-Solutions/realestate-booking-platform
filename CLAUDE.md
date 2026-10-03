# HomeKonet — project & infrastructure context

HomeKonet is a real-estate/short-term-rental booking platform: Django 5 +
DRF + Channels + Celery backend, React 18 + TypeScript + Vite frontend,
deployed via Docker Compose. Domain: `homekonet.com`.

## Current server (read this first)

This server (Hostinger VPS, `179.198.215.152`, Ubuntu 26.04 LTS, 4 vCPU/16GB)
**became the production server on 2026-10-03**, migrated from two GCP VMs.
Full detail: **`docs/migration-to-hostinger.md`**. The short version:

- Everything runs from `docker-compose.yml` in this directory: `backend`,
  `celery`, `celery-beat`, `celery-ai`, `frontend` (nginx), `pgadmin`, `redis`,
  and **`db`** (PostgreSQL 16 — see next point).
- **Postgres is a container (`db` service), not bare-metal.** If you go
  looking for a system Postgres install to manage, you'll find one at
  `/etc/postgresql/16/main` — it's **stopped and disabled**
  (`systemctl status postgresql` will show inactive), left over from an
  earlier step of the migration before the architecture changed mid-flight.
  Its data directory is untouched as a redundant safety copy, but it is
  **not** the database the app uses. The real one is
  `docker compose exec db psql -U homekonet_app -d homekonet`.
- `POSTGRES_HOST=db` in `backend/.env` (Docker Compose service-name
  resolution, not an IP). `POSTGRES_SSLMODE=disable` — deliberate, all DB
  traffic stays inside the Compose network.
- Deploy user is `homekonet` (passwordless sudo, in the `docker` group).
  SSH is **key-only** — root login and password auth are both disabled.
- pgAdmin is bound to `127.0.0.1:5050` only (not public). Reach it via
  `ssh -L 5050:localhost:5050 homekonet@179.198.215.152`, then browse to
  `localhost:5050`.
- `ufw` is active: only OpenSSH/80/443 are open.
- TLS cert is real (Let's Encrypt, issued fresh on this server, valid to
  2027-01-01), renewal hooks installed and dry-run verified
  (`scripts/install-certbot-hooks.sh`).

## The old GCP servers still exist — don't assume they're gone

`easytech-svr01` (app) and `homekonet-db-svr` (database) in the
`easytechproducts` GCP project are **kept as a rollback fallback**, not yet
decommissioned as of this server's cutover. `easytech-svr01`'s app
containers (`backend`/`celery*`) are deliberately stopped; its database VM
is still running, untouched, read-accessible. See
`docs/migration-to-hostinger.md` §7–9 for exactly what's pending
(confidence window → decommission GCP VMs, Cloud NAT gateway, reserved IP)
before treating that infrastructure as gone. If you're asked to clean up
GCP resources, check that doc's checklist first — don't assume it's stale
just because it mentions "pending."

## Where to go for more

- **`MIGRATION.md`** — the general, reusable server-migration runbook
  (backup/restore scripts, DNS/TLS cutover steps, rollback).
- **`docs/migration-to-hostinger.md`** — exactly what happened in this most
  recent migration, including the Postgres architecture change above.
- **`docs/gcp-postgres-migration.md`** — background on the *previous*
  database-only migration (bare-metal Postgres on a dedicated GCP VM); the
  bare-metal install steps it describes are **no longer how Postgres is run
  here** (see above) — useful for history/reasoning, not as current
  instructions for this server.
- **`docs/DEPLOYMENT.md`** — general server setup (OS hardening, Docker
  install) — still accurate, cloud-agnostic.
- **`docs/developer-guide.html`** — engineering handbook, including its own
  Backup & Migration section.
- **`scripts/backup.sh`** / **`scripts/restore.sh`** — the encrypted
  backup/restore tooling referenced throughout the migration docs.

## Working conventions from this project (apply broadly)

- Never commit a database dump, `.env` file, or anything under `backups/` —
  it's gitignored on purpose.
- This codebase has an RBAC permission system (`rbac/resources.py`), a
  dual-authorization engine for sensitive actions (`rbac/dual_auth.py`), and
  a "generic admin" CRUD framework (`superadmin/generic_admin/`) — check
  for existing patterns there before building new admin functionality from
  scratch.
- Verification workflow for backend changes: `docker compose build backend`
  → `docker compose run --rm --no-deps --entrypoint python backend manage.py
  check` → `manage.py makemigrations --check --dry-run`. For frontend:
  `docker build --target builder -f Dockerfile.frontend .` →
  `npm run typecheck` inside that image.
- Don't print secrets (passwords, API keys, tokens) in command output or
  chat — redact them even when you have to handle them to complete a task.
