# 当前模块与引用图

更新日期：2026-07-17

## Nx 项目

```mermaid
flowchart LR
  Web["@hermes-swarm/web"] --> Core["@hermes-swarm/core"]
  Web --> RbacApi["@hermes-swarm/rbac-api"]
  Api["@hermes-swarm/api"] --> Core
  Api --> Rbac["@hermes-swarm/rbac"]
  Api --> RbacApi
  Rbac --> Core
  Rbac --> RbacApi
  Web -. "/api/admin/**" .-> Api
  Api --> Pg[(PostgreSQL)]
  Api --> Redis[(Redis)]
```

| Project | Responsibility |
| --- | --- |
| `@hermes-swarm/core` | Shared persistence models: identity、settings、mail、notifications、support |
| `@hermes-swarm/rbac-api` | Permission IDs、page access catalog、shared DTO |
| `@hermes-swarm/rbac` | Nest access decorators、guard、catalog、audit runtime |
| `@hermes-swarm/api` | Nest runtime、database/RLS context、infrastructure 与 business domains |
| `@hermes-swarm/web` | Next.js Platform console、Workspace console 与 business pages |

## 身份与数据关系

```mermaid
erDiagram
  TENANT ||--o{ USER : owns
  TENANT ||--o{ ORGANIZATION : owns
  ORGANIZATION ||--o{ ORGANIZATION : parent_of
  USER ||--o{ USER_ORGANIZATION : joins
  ORGANIZATION ||--o{ USER_ORGANIZATION : has_members
  USER ||--o{ USER_TENANT_ROLE : assigned
  ROLE ||--o{ USER_TENANT_ROLE : grants
  USER_ORGANIZATION ||--o{ USER_ORGANIZATION_ROLE : assigned
  ROLE ||--o{ USER_ORGANIZATION_ROLE : grants
  ROLE ||--o{ ROLE_PERMISSION : grants
  PERMISSION ||--o{ ROLE_PERMISSION : catalogs
  ORGANIZATION ||--o{ TICKET : source
```

Platform identity uses separate `platform_users`、`platform_roles`、`platform_role_permissions` tables and does not join Tenant User tables.

## API modules

| Module | Boundary |
| --- | --- |
| Auth | Separate Platform/Tenant login, refresh, session and `/auth/me` |
| Tenants | Applications, approval, status, root-organization onboarding, unified role library |
| Organizations | Lightweight tree CRUD and ancestry validation |
| Memberships | User ↔ Organization membership and exact Organization role assignments |
| Users | Tenant-local users, status, self profile and Tenant role assignments |
| Invite | One workspace invite with multiple Organization assignments |
| Settings | Platform default → Tenant override |
| Mail | Platform public mail plus Tenant SMTP/templates/logs |
| Support domain | `domains/support` 中的 Ticket/Conversation 与 source Organization access filtering |
| Notifications/Realtime | Tenant + recipient User, tenant-namespaced delivery |
| Integrations | User-owned personal API Token with live Token ∩ User permission checks |
| Jobs/Audit | 通用 Tenant job runtime 位于 `common/jobs`；业务 job 与对应 domain 共置 |

Removed modules: Departments, Department dispatch, Organization groups, Organization settings and notification destinations.

## Scope and access

Permission IDs remain:

```text
{entity}.{purpose}.{operation}:{scope}
page.{pageKey}.access:{scope}
```

Valid Tenant-facing scopes are `tenant | organization | own`. Platform permissions are queried only through Platform APIs. Organization Role does not inherit across the tree; Ticket ancestor visibility is a separate data-access rule.

The web client never sends Tenant or implicit scope headers. Tenant comes from the session; Organization identifiers are explicit route/query/body values. `OrganizationContextProvider` only maintains the active Organization UI selection and abort epoch.

## Frontend routes

Platform control plane:

- `/platform/tenants`
- `/platform/settings`
- `/platform/email-templates`

Workspace settings:

- `/settings/tenant`
- `/settings/organizations`
- `/settings/users`
- `/settings/invites`
- `/settings/email-templates`
- `/settings/custom-smtp`
- `/settings/integrations`
- `/settings/workspace-access`
- `/settings/organization`
- `/settings/organization/members`
- `/settings/organization/roles`

“全部组织”显示工作空间治理；具体组织显示资料、成员和该组织独立的角色权限。组织角色不跨组织或沿树继承。

Business routes:

- `/tickets` → `app/(console)/(domains)/tickets`

## 源码目录边界

```text
apps/api/src/
├── common/                  # runtime primitives: config, DB/RLS, Redis, generic jobs
├── infrastructure/          # identity, access, settings, mail, notifications
└── domains/
    └── support/             # tickets, conversations, domain jobs

apps/web/app/(console)/
├── settings/                # infrastructure configuration
└── (domains)/
    └── tickets/             # business route; URL remains /tickets

packages/core/src/
├── identity/                # workspace identity persistence models
├── mail/
├── notifications/          # recipient notifications only
├── settings/
└── support/                 # ticket and conversation persistence models
```

## Database baseline

`WorkspaceModelBaseline2026071500001` is the sole initial migration. Tenant-owned repositories require a transaction-local TenantContext and are protected by forced PostgreSQL RLS. The Platform datasource uses a distinct role for audited cross-tenant access.

## Verification

```powershell
pnpm nx show projects --json
pnpm nx run-many -t typecheck test build --skipNxCache
pnpm nx run @hermes-swarm/api:e2e --skipNxCache
pnpm nx run @hermes-swarm/web:e2e --skipNxCache
pnpm nx run @hermes-swarm/api:openapi:generate
```
