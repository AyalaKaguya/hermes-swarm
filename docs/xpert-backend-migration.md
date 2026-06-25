# xpert Backend Migration Plan

## Scope

Migrate the backend capability shape from `/home/ayala/Projects/xpert` into this Nx workspace while keeping `hermes-swarm` runnable.

Included capability areas:

- Users and authentication.
- Tenant / organization management.
- Admin management routes.
- System settings, including global settings and organization settings.
- Mail settings, templates, and sent-email records.

Out of scope for this pass:

- Copying the whole xpert CQRS, event-emitter, Swagger, i18n, passport, bcrypt, nodemailer, email-templates, file upload, employee, feature, language, import, and plugin stacks.
- Migrating xpert-only ERP/time-tracking/finance organization fields that are not needed for the current admin backend.

## Source Inventory

Relevant xpert source modules:

- `packages/server/src/auth`: login, registration, email verification, refresh token, password reset.
- `packages/server/src/user`: current user, user CRUD, search, preferred language, password reset, bulk import.
- `packages/server/src/tenant`: tenant entity, onboarding, subdomain normalization, tenant settings.
- `packages/server/src/organization`: organization entity and create/update service.
- `packages/server/src/role` and `packages/server/src/role-permission`: role and permission infrastructure created during tenant onboarding.
- `packages/server/src/custom-smtp`: SMTP settings per tenant / organization and validation.
- `packages/server/src/email`: sent email records and template-based send helpers.
- `packages/server/src/email-template`: customizable templates and default seeding.

Important xpert dependencies that are intentionally not introduced here:

- `@nestjs/cqrs`, `@nestjs/event-emitter`, `@nestjs/passport`, `@nestjs/jwt`, `bcryptjs`, `nodemailer`, `email-templates`, `class-validator`, `class-transformer`.

## Current hermes-swarm State

The current API already has:

- Global prefix `api`, so admin endpoints should live under `/api/admin`.
- Shared TypeORM entities in `packages/core/src/tenancy`.
- A single `apps/api/src/tenancy` module with onboarding, admin login, organization update, user CRUD, roles, permissions, menus, and organization settings.
- Session-token auth implemented by `apps/api/src/tenancy/admin-session.ts`.

The current workspace convention is:

- Shared domain / TypeORM models belong in `packages/core`.
- Backend app modules live in `apps/api/src`.
- Admin / back-office APIs use the `/api/admin` namespace.
- Nx commands should be package-manager-prefixed, for example `pnpm nx run @hermes-swarm/api:typecheck`.

## Target Architecture

The migration should split the existing backend surface into explicit modules without breaking the current admin API shape.

Target API modules:

- `apps/api/src/admin`: admin bootstrap, onboarding, snapshot, role, menu route ownership.
- `apps/api/src/auth`: login/session/me/authenticated endpoints backed by the existing lightweight session token.
- `apps/api/src/users`: user list/create/update/search/preferred-language/password endpoints.
- `apps/api/src/organizations`: tenant/organization list/create/current/update endpoints.
- `apps/api/src/settings`: global settings and organization settings endpoints.
- `apps/api/src/mail`: custom SMTP settings, SMTP validation, email templates, and email log endpoints.
- `apps/api/src/tenancy`: shared tenancy service/provider layer used by the modules above.

Target shared model modules:

- `packages/core/src/settings`: global `SystemSetting`.
- `packages/core/src/mail`: `CustomSmtp`, `EmailTemplate`, `EmailLog`.
- Existing `packages/core/src/tenancy`: keep `Organization`, `User`, `Role`, `RolePermission`, `OrganizationSetting`, `Menu`.

## Route Mapping

Admin shell:

- `GET /api/admin/bootstrap`
- `POST /api/admin/onboarding`
- `GET /api/admin/snapshot`
- `GET /api/admin/roles`
- `PUT /api/admin/roles/:roleId/permissions`
- `GET /api/admin/menus`
- `POST /api/admin/menus`
- `PATCH /api/admin/menus/:menuId`

Auth:

- `POST /api/admin/auth/login`
- `GET /api/admin/auth/authenticated`
- `GET /api/admin/auth/me`

Users:

- `GET /api/admin/users`
- `GET /api/admin/users/search`
- `POST /api/admin/users`
- `PATCH /api/admin/users/:userId`
- `POST /api/admin/users/:userId/password`
- `PATCH /api/admin/users/:userId/preferred-language`

Organizations:

- `GET /api/admin/organization`
- `PATCH /api/admin/organization`
- `GET /api/admin/organizations`
- `POST /api/admin/organizations`
- `PATCH /api/admin/organizations/:organizationId`

Settings:

- `GET /api/admin/settings`
- `PUT /api/admin/settings`
- `GET /api/admin/system-settings`
- `PUT /api/admin/system-settings`

Mail:

- `GET /api/admin/mail/smtp`
- `PUT /api/admin/mail/smtp`
- `POST /api/admin/mail/smtp/validate`
- `GET /api/admin/mail/templates`
- `POST /api/admin/mail/templates`
- `PATCH /api/admin/mail/templates/:templateId`
- `GET /api/admin/mail/logs`
- `POST /api/admin/mail/logs`

Compatibility:

- Keep legacy `POST /api/admin/login` as an alias for admin login because the current web app uses it.
- Keep legacy organization, users, settings, roles, and menus paths under `/api/admin` by assigning those paths to the split controllers.

## Migration Decisions

- Use `Organization` as the current tenant / organization boundary. xpert has both `Tenant` and `Organization`; hermes-swarm currently models a single organization boundary and existing frontend state expects that shape.
- Keep the existing PBKDF2 password hashing and session token implementation. This avoids introducing bcrypt/JWT dependencies and keeps the project runnable with its current package set.
- Implement mail settings and records without real SMTP sending. SMTP validation should perform only local input validation and optional socket-level host/port reachability in future work.
- Store global settings in `SystemSetting`; store organization settings in the existing `OrganizationSetting`.
- Keep DTOs as TypeScript payload types and Nest body parsing, matching the current project style.

## Verification

Use Nx-first verification:

- `pnpm nx reset` if the project graph fails.
- `NX_DAEMON=false pnpm nx run @hermes-swarm/core:typecheck`
- `NX_DAEMON=false pnpm nx run @hermes-swarm/api:typecheck`
- `NX_DAEMON=false pnpm nx run @hermes-swarm/api:dev` for runtime startup.

