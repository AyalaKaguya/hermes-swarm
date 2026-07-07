# Hermes Swarm

A distributed computing swarm built with **pnpm + NX Monorepo**, **NestJS**, **TypeORM**, **PostgreSQL**, and **Redis**.

## Architecture

```
hermes-swarm/
├── apps/
│   ├── api/                  # NestJS API server
│   └── web/                  # Next.js admin web app
├── packages/
│   └── core/                 # Shared core business entities and config utilities
├── devenv/                   # Local dev infrastructure (Docker)
│   ├── docker-compose.yml    # PostgreSQL 17 + Redis 7
│   └── postgres/init/        # Database initialization scripts
├── tsconfig.base.json        # Shared TypeScript configuration
├── nx.json                   # NX build orchestration
└── pnpm-workspace.yaml       # pnpm workspace definition
```

## Prerequisites

- **Node.js** >= 18
- **pnpm** >= 9
- **Docker** & **Docker Compose**

## Getting Started

### 1. Install dependencies

```bash
pnpm install
```

### 2. Start development services

```bash
cp .env.example .env
cd devenv && cp ../.env.example .env && docker compose up -d
```

This starts PostgreSQL and Redis containers with health checks.

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
# { "status": "ok", "db": "connected" }
```

## Commands

| Command | Description |
|---------|-------------|
| `pnpm build` | Build all packages via NX |
| `pnpm test` | Run tests across workspace |
| `pnpm lint` | Lint all packages |
| `pnpm clean` | Remove dist directories |
| `pnpm graph` | Visualize dependency graph |

Prefer project-target commands when working on a single app or package, for example:

```bash
pnpm nx run @hermes-swarm/api:dev
pnpm nx run @hermes-swarm/web:dev
```

## Development Services

| Service | Image | Port |
|---------|-------|------|
| PostgreSQL 17 | `postgres:17-alpine` | 5432 |
| Redis 7 | `redis:7-alpine` | 6379 |

Configuration is managed via `.env` (see `.env.example` for defaults).

## License

MIT
