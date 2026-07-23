# Hermes Swarm

A distributed computing swarm built with **pnpm + NX Monorepo**, **NestJS**, **TypeORM**, **PostgreSQL**, and **Redis**.

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
├── docker/                   # Optional local PostgreSQL + Redis
│   ├── docker-compose.yml    # PostgreSQL 17 + Redis 7
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
does not start Docker services automatically.

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
# { "status": "ok", "db": "connected", "redis": "connected" }
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

## Optional Local Development Services

| Service | Image | Port |
|---------|-------|------|
| PostgreSQL 17 | `postgres:17-alpine` | 5432 |
| Redis 7 | `redis:7-alpine` | 6379 |

Docker infrastructure is configured through `docker/.env`; the application is
configured through root `.env` (see their respective `.env.example` files).

## License

MIT
