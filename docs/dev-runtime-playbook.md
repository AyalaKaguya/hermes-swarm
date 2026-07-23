# Hermes-Swarm Development Runtime Playbook

## Local endpoints

| Surface | URL |
| --- | --- |
| Web | `http://localhost:3100` |
| API | `http://localhost:3200/api` |
| API health | `http://localhost:3200/api/health` |

Web proxies `/api/**` to API. Root `.env` provides the configured PostgreSQL and
Redis application URLs plus API overrides; remote services are the normal
development setup.

## Runtime configuration

- `POSTGRES_URL` is the only non-test PostgreSQL application endpoint.
- `POSTGRES_TEST_URL` is used only when `NODE_ENV=test`.
- `REDIS_URL` is the single canonical Redis endpoint for sessions, rate limits,
  realtime events, job locks, and caches. Both `redis://` and TLS `rediss://`
  URLs are supported.
- Old `REDIS_HOST`, `REDIS_PORT`, and `REDIS_PASSWORD` settings remain only as
  a startup fallback when `REDIS_URL` is absent. Do not add them to new
  deployments.

Local Docker is optional and never starts as part of an Nx app command:

```powershell
Copy-Item docker/.env.example docker/.env
docker compose --env-file docker/.env -f docker/docker-compose.yml up -d
```

When using local Docker, update root `.env` so `POSTGRES_URL` and `REDIS_URL`
point to those containers. Keep container credentials and port mappings only in
`docker/.env`.

## Debug runtime logs

Store ad-hoc local API, web, worker, and test-process logs only in the
repository-root `.runtime/logs/` directory. This directory is local-only and
is ignored by Git.

Use one shared run identifier and this filename format:

```text
YYYYMMDD-HHmmss--<service>--<stream>.log
```

Examples:

```text
.runtime/logs/20260723-094500--api--stdout.log
.runtime/logs/20260723-094500--api--stderr.log
.runtime/logs/20260723-094500--web--stdout.log
```

`<service>` is a lowercase service name such as `api`, `web`, `worker`, or
`e2e`; `<stream>` is `stdout` or `stderr`. Keep framework-owned diagnostics in
their native ignored caches (`.nx/` and `apps/web/.next-dev/`); do not copy or
move those files into `.runtime/logs/`.

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
- `POSTGRES_URL` is the only non-test application connection and backs one
  TypeORM DataSource/connection pool.
- `POSTGRES_TEST_URL` is the only database URL used when `NODE_ENV=test`; use
  the configured remote test database and do not start a local PostgreSQL
  container as a prerequisite.
- API E2E requires `POSTGRES_TEST_URL` to point at a dedicated, disposable
  remote database. It resets the `public` schema and may provision required
  extensions, so it must never be the production database or an ordinary
  development workspace database.
- Tenant isolation is enforced in the application: an authenticated session
  supplies the trusted `workspaceId`, and workspace services explicitly filter
  and write `workspace_id`. Request headers and body values cannot replace that
  boundary.
- PostgreSQL RLS, transaction-local `app.workspace_id` GUCs, and the
  `hermes_workspace_app` runtime role are not used. Legacy
  `DATABASE_STRICT_RLS`, `POSTGRES_WORKSPACE_URL`, and
  `POSTGRES_PLATFORM_URL` configuration causes startup validation to fail.
- Deploy the RLS removal during a maintenance window: stop old API/worker
  processes, run migrations, then start the version with explicit workspace
  filtering. Direct database access is therefore trusted-operator access, not a
  tenant-isolated application surface.
- Before `migration:show` or `migration:run`, remove
  `DATABASE_STRICT_RLS`, `POSTGRES_WORKSPACE_URL`, and `POSTGRES_PLATFORM_URL`
  from the deployment environment, then make the sole `POSTGRES_URL` the
  schema-owner/migration connection. The migration datasource validates this
  configuration before connecting and intentionally rejects stale RLS values.
- The cleanup migration revokes this database's public-schema/table/sequence ACL
  from `hermes_workspace_app`, but deliberately does not drop the PostgreSQL
  role. After every Hermes database has migrated, a DBA must first check
  memberships, default privileges, dependencies, and active connections before
  removing that role manually.

First-start onboarding:

- `admin_required`: no Account or Workspace data exists; `/onboarding` is public
  and creates the only initial global account, its Platform Admin membership,
  the first workspace, and its Owner membership in one transaction.
- `workspace_required`: a Platform Admin already exists, so the operator signs
  in through `/login?context=platform&next=/onboarding` and resumes workspace
  provisioning with the same account.
- `complete`: at least one active Platform Admin and one workspace row exist;
  repeated initialization is rejected.
- `recovery_required`: account or workspace data exists without an active
  Platform Admin; restore administrator access through the operations recovery
  process before retrying onboarding.

Destructive development rebuild:

```powershell
# Stop API before resetting the schema/volume.
pnpm nx run @hermes-swarm/api:migration:show
pnpm nx run @hermes-swarm/api:migration:run

$env:DEV_SEED_ADMIN_PASSWORD='<至少 8 位>'
pnpm nx run @hermes-swarm/api:seed:development
```

When optional Docker infrastructure is used locally, it is defined by
`docker/docker-compose.yml`. Removing its local PostgreSQL data directory is
destructive and is only allowed for the development baseline.

Current development seed defaults:

- workspace: `hermes-dev`
- administrator: `admin@hermes.local`
- password: supplied only through `DEV_SEED_ADMIN_PASSWORD`
- memberships: Platform Admin, primary Workspace Owner, and lab Workspace Admin

The development seed uses one global account for platform and workspace access.
`DEV_SEED_ADMIN_NAME`, `DEV_SEED_ADMIN_EMAIL`, and the workspace defaults can be
overridden through environment variables. Seed credentials must not be committed.

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
