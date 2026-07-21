# Hermes-Swarm Development Runtime Playbook

## Local endpoints

| Surface | URL |
| --- | --- |
| Web | `http://localhost:3100` |
| API | `http://localhost:3200/api` |
| API health | `http://localhost:3200/api/health` |

Web proxies `/api/**` to API. Root `.env` provides local PostgreSQL/Redis URLs and API overrides.

## Audit client IP behind a proxy or CDN

Login and operation audits always record the direct TCP peer. They use
`Forwarded`, `X-Forwarded-For`, `CF-Connecting-IP`, `True-Client-IP`,
`Fastly-Client-IP`, `X-Azure-ClientIP`, `X-Envoy-External-Address`, or
`X-Real-IP` only when that peer matches `TRUSTED_PROXY_CIDRS`.

```dotenv
TRUSTED_PROXY_CIDRS=127.0.0.1/32,::1/128,10.20.0.0/16
```

List only the CDN, load balancer, ingress, or BFF networks that can connect
directly to the API. The last trusted proxy must overwrite or sanitize incoming
forwarding headers. Do not use a public catch-all CIDR on an Internet-accessible
API. Multi-hop `Forwarded` and `X-Forwarded-For` chains are evaluated from right
to left, removing only configured trusted proxy hops.

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
- `POSTGRES_WORKSPACE_URL` authenticates as `hermes_workspace_app` (`NOBYPASSRLS`).
- `POSTGRES_PLATFORM_URL` uses a distinct platform/migration role.
- API startup validates that Workspace credentials cannot bypass RLS and Platform credentials can perform audited cross-workspace operations.
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
2. Workspace Owner activation and first login
3. Workspace navigation: Members, Invites, Mail, Integration, Roles
4. A member has exactly one workspace role
5. Ticket submitter visibility and workspace handler capability
6. Platform console isolation under `/platform/**`
