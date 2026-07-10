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

- `@hermes-swarm/core`
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
three projects above.

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

Development and isolated test databases use TypeORM `synchronize`; do not create
a migration for ordinary development work. Set `DATABASE_SYNCHRONIZE=false` only
when inspecting a stable local schema manually.

Production never synchronizes schema during API startup. Before a production
release, generate and review a migration from the stable development entities,
then apply it once before starting API replicas:

```bash
pnpm --filter @hermes-swarm/api migration:generate -- src/common/database/migrations/<release-name>
pnpm --filter @hermes-swarm/api migration:show
pnpm --filter @hermes-swarm/api migration:run
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
