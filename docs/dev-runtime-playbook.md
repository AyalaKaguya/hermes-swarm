# Hermes-Swarm Development Runtime Playbook

## Local endpoints

| Surface | URL |
| --- | --- |
| Web | `http://localhost:3100` |
| API | `http://localhost:3200/api` |
| API health | `http://localhost:3200/api/health` |

Web proxies `/api/**` to API. Root `.env` provides local PostgreSQL/Redis URLs and API overrides.

Check listeners on Windows:

```powershell
Get-NetTCPConnection -LocalPort 3100,3200 -State Listen -ErrorAction SilentlyContinue
```

## Nx commands

```powershell
pnpm nx show projects --json
pnpm nx show project @hermes-swarm/api --json
pnpm nx show project @hermes-swarm/web --json

pnpm nx run @hermes-swarm/api:dev
pnpm nx run @hermes-swarm/web:dev
```

If project graph state is stale:

```powershell
pnpm nx reset
pnpm nx show projects --json
```

## Database policy

- `DATABASE_SYNCHRONIZE=false`; migration is the only schema source.
- `POSTGRES_TENANT_URL` authenticates as `hermes_tenant_app` (`NOBYPASSRLS`).
- `POSTGRES_PLATFORM_URL` uses a distinct platform/migration role.
- API startup validates that Tenant credentials cannot bypass RLS and Platform credentials can perform audited cross-tenant operations.
- Never point both datasources at the same database role outside tests.

Destructive development rebuild:

```powershell
# Stop API before resetting the schema/volume.
pnpm nx run @hermes-swarm/api:migration:show
pnpm nx run @hermes-swarm/api:migration:run

$env:DEV_SEED_OWNER_PASSWORD='<至少 8 位>'
$env:DEV_SEED_PLATFORM_ADMIN_PASSWORD='<至少 8 位>'
pnpm nx run @hermes-swarm/api:seed:development
```

When Docker is used locally, infrastructure is defined by `devenv/docker-compose.yml`. Removing `hermes_postgres_data` is destructive and is only allowed for the development baseline.

Current development seed defaults:

- workspace: `hermes-dev`
- owner: `owner@hermes.local`
- password: supplied only through `DEV_SEED_OWNER_PASSWORD`

Platform seed credentials must also be supplied through environment variables and must not be committed.

## Verification

```powershell
pnpm nx run-many -t typecheck test build --skipNxCache
pnpm nx run @hermes-swarm/api:e2e --skipNxCache
pnpm nx run @hermes-swarm/web:e2e --skipNxCache
pnpm nx run @hermes-swarm/api:coverage --skipNxCache
pnpm nx run @hermes-swarm/web:coverage --skipNxCache
pnpm nx run @hermes-swarm/api:openapi:generate
```

## Browser validation

Use the already-open in-app browser. Do not switch to another browser or start Playwright without explicit approval.

Primary flows:

1. `http://localhost:3100/login?workspace=hermes-dev`
2. Owner onboarding and root Organization creation
3. Workspace navigation: Organization, User, Invite, Mail, Integration, Roles
4. Organization switching without full-page refresh or reauthentication
5. Ticket source Organization and ancestor-handler visibility
6. Platform console only through `/platform/**`
