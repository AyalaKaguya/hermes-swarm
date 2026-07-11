# Hermes-Swarm Development Runtime Playbook

Use this when changing or debugging existing features so runtime setup, logs,
browser checks, and screenshots stay consistent across context resets.

## Local Ports

Current Hermes-Swarm defaults:

| Surface | URL |
|---|---|
| Web app | `http://localhost:3100` |
| API | `http://localhost:3200/api` |

The web app proxies `/api/**` to `http://localhost:3200/api/**`.
Root `.env` can override `API_PORT`; if no `API_PORT` is present, the API
defaults to `3200` in `apps/api/src/main.ts`.

Check listeners before starting or restarting servers:

```bash
lsof -nP -iTCP:3100 -sTCP:LISTEN
lsof -nP -iTCP:3200 -sTCP:LISTEN
```

## Nx Commands

Project discovery:

```bash
pnpm nx show projects
pnpm nx show project @hermes-swarm/api
pnpm nx show project @hermes-swarm/web
```

Known projects:

- `@hermes-swarm/rbac-api`
- `@hermes-swarm/core`
- `@hermes-swarm/rbac`
- `@hermes-swarm/api`
- `@hermes-swarm/web`

Use Nx targets instead of direct package scripts:

```bash
pnpm nx run @hermes-swarm/api:typecheck
pnpm nx run @hermes-swarm/web:typecheck
pnpm nx run @hermes-swarm/api:dev
pnpm nx run @hermes-swarm/web:dev
```

If Nx daemon or project graph state is stale:

```bash
pnpm nx reset
pnpm nx show projects
```

In a restricted runner, Nx may fail with plugin-worker connection errors. In a
normal full-access shell, `pnpm nx show projects` has been verified to return the
five projects above.

## Services And Logs

Infrastructure runs from `devenv/docker-compose.yml` and reads `devenv/.env`:

```bash
cd /home/ayala/Projects/hermes-swarm/devenv
docker compose up -d
docker compose ps
```

If API or web logs are needed, stop any existing listener on the matching port
first, then restart manually in foreground terminals:

```bash
cd /home/ayala/Projects/hermes-swarm
pnpm nx run @hermes-swarm/api:dev
```

```bash
cd /home/ayala/Projects/hermes-swarm
pnpm nx run @hermes-swarm/web:dev
```

Health check:

```bash
curl -sS http://localhost:3200/api/health
```

## Database Schema Policy

All environments use reviewed TypeORM migrations. `DATABASE_SYNCHRONIZE` defaults
to `false`; do not enable it for tenant-aware development because synchronize
cannot create the required PostgreSQL roles, composite constraints, or RLS
policies.

The API uses two database connections:

- `POSTGRES_TENANT_URL` must authenticate as `hermes_tenant_app`, which is
  created as `LOGIN NOBYPASSRLS`. The destructive Docker development bootstrap
  assigns the `.env.example` development password; non-development environments
  must provision a secret out-of-band before migration.
- `POSTGRES_PLATFORM_URL` must use a different role with `BYPASSRLS` (or a
  superuser only in local development) for audited control-plane operations.
- `DATABASE_STRICT_RLS` is mandatory outside `NODE_ENV=test`; startup rejects
  attempts to disable it, missing URLs, a tenant
  username other than `hermes_tenant_app`, shared credentials, a bypass-capable
  tenant role, or a platform role that cannot cross RLS.

Run migrations with the privileged migration connection, not the tenant
application role. Never point both application datasources at the migration
owner in production.

The current development model is intentionally destructive. To rebuild it from
the tenant hierarchy baseline, stop the API, remove the development Postgres
volume, start Postgres again, and run the migration before starting API replicas:

```powershell
docker compose -f devenv/docker-compose.yml down
docker volume rm hermes_postgres_data
docker compose -f devenv/docker-compose.yml up -d postgres redis
pnpm nx run @hermes-swarm/api:migration:show
pnpm nx run @hermes-swarm/api:migration:run
$env:DEV_SEED_PLATFORM_ADMIN_PASSWORD='<至少 8 位>'
$env:DEV_SEED_OWNER_PASSWORD='<至少 8 位>'
pnpm nx run @hermes-swarm/api:seed:development
```

`devenv/postgres/init` only creates databases, extensions and the development
tenant role. It must never create application tables; the migration is the sole
schema source.

For subsequent schema changes, generate and review a migration rather than
changing the database manually:

```bash
pnpm nx run @hermes-swarm/api:migration:generate -- src/common/database/migrations/<release-name>
pnpm nx run @hermes-swarm/api:migration:show
pnpm nx run @hermes-swarm/api:migration:run
```

`DATABASE_SYNCHRONIZE=true` and `DATABASE_MIGRATIONS_RUN=true` are both
rejected when `NODE_ENV=production`.

## Browser And Screenshots

Use the existing Playwright helper when both servers are running:

```bash
node scripts/screenshot.mjs
```

It checks API health, opens `http://localhost:3100/login`, attempts the local
admin login flow, and writes screenshots to `/tmp/hermes-login.png`,
`/tmp/hermes-org-users.png`, and `/tmp/hermes-org-invites.png`.

For ad hoc browser checks, use the same URLs:

- Web: `http://localhost:3100`
- Login: `http://localhost:3100/login`
- Admin API health: `http://localhost:3200/api/health`
