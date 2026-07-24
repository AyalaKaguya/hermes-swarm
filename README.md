# Hermes Swarm

A distributed computing swarm built with **pnpm + NX Monorepo**, **NestJS**, **TypeORM**, **PostgreSQL**, **Redis**, and optional S3-compatible object storage.

## Architecture

```
hermes-swarm/
├── apps/
│   ├── api/                  # NestJS runtime: common, infrastructure, domains
│   └── web/                  # Next.js platform, workspace, and domain routes
├── packages/
│   ├── core/                 # Shared persistence models and settings definitions
│   ├── rbac-api/             # Client-safe permission contracts
│   └── rbac/                 # NestJS access-control runtime
├── docker/                   # Optional local PostgreSQL, Redis, and MinIO profile
│   ├── docker-compose.yml    # PostgreSQL 17 + Redis 7; MinIO is opt-in
│   └── init/                 # Infrastructure initialization assets
├── docs/architecture/        # Architecture boundaries and review records
├── tsconfig.base.json        # Shared TypeScript configuration
├── nx.json                   # NX build orchestration
└── pnpm-workspace.yaml       # pnpm workspace definition
```

## Prerequisites

- **Node.js** >= 20.9
- **pnpm** >= 9
- **Docker** & **Docker Compose** (optional; only for local infrastructure)

## Getting Started

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure application runtime

```powershell
Copy-Item .env.example .env
```

Set `POSTGRES_URL` and `REDIS_URL` in `.env` to the managed or remote services
for your environment. The API uses one PostgreSQL URL and one Redis URL; it
does not start Docker services automatically. Object storage remains disabled
until `OBJECT_STORAGE_ENABLED=true` and a private bucket is configured.

### 3. Start the app servers

```bash
pnpm nx run @hermes-swarm/api:dev
pnpm nx run @hermes-swarm/web:dev
```

The web app runs on `http://localhost:3100`.
The API runs on `http://localhost:3200/api` (configurable via `API_PORT`).

### 4. Health check

```bash
curl http://localhost:3200/api/health
# { "status": "ok", "db": "connected", "redis": "connected", "storage": "disabled" }
```

### Optional: local Docker infrastructure

Only use this when you explicitly want local PostgreSQL and Redis instead of
the configured remote services.

```powershell
Copy-Item docker/.env.example docker/.env
docker compose --env-file docker/.env -f docker/docker-compose.yml up -d
```

Then point root `.env` at the local containers using `POSTGRES_URL` and
`REDIS_URL`. Docker credentials and ports stay in `docker/.env`; application
URLs and secrets stay in root `.env`.

MinIO is a separate `storage` profile and is never started by the command
above. To opt in explicitly, use:

```powershell
docker compose --profile storage --env-file docker/.env -f docker/docker-compose.yml up -d minio minio-init
```

Remote deployments must provision a private bucket and bucket-scoped
application credentials before enabling object storage. Hermes never uses
MinIO root credentials to create a remote bucket.

## Commands

| Command | Description |
|---------|-------------|
| `pnpm build` | Build all packages via NX |
| `pnpm test` | Run tests across workspace |
| `pnpm nx run-many -t typecheck` | Type-check all projects |
| `pnpm clean` | Remove dist directories |
| `pnpm graph` | Visualize dependency graph |

Prefer project-target commands when working on a single app or package, for example:

```bash
pnpm nx run @hermes-swarm/api:dev
pnpm nx run @hermes-swarm/web:dev
```

For local ports, server logs, browser checks, and screenshots, see
[docs/dev-runtime-playbook.md](docs/dev-runtime-playbook.md). Architecture
review records are kept under [docs/architecture](docs/architecture).
The object lifecycle and security boundary are documented in
[docs/architecture/object-storage-and-file-objects.md](docs/architecture/object-storage-and-file-objects.md).

## Optional Local Development Services

| Service | Image | Port |
|---------|-------|------|
| PostgreSQL 17 | `postgres:17-alpine` | 5432 |
| Redis 7 | `redis:7-alpine` | 6379 |
| MinIO (optional `storage` profile) | pinned `quay.io/minio/minio` release | 9000 / 9001 |

Docker infrastructure is configured through `docker/.env`; the application is
configured through root `.env` (see their respective `.env.example` files).

## Related Project

[Xpert](https://github.com/xpert-ai/xpert) is an open-source AI platform
distributed under the GNU Affero General Public License v3.0. Its public
product behavior and documentation have been consulted during Hermes Swarm
research. The Xpert repository is not bundled with Hermes Swarm; its source
code, copyright, trademarks, and licensing remain governed by the official
Xpert project.

## License

Hermes Swarm is licensed under the
[GNU Affero General Public License v3.0](LICENSE) (`AGPL-3.0-only`).
