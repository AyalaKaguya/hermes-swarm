## xpert → hermes-swarm Backend Migration Gap Analysis

*Generated 2026-06-25 after comparing both codebases; refreshed 2026-06-27 against the current Hermes-Swarm tree*

### Scope

Migrate the xpert backend's user, tenant (organization), management, and system
settings (email, global) capabilities into the hermes-swarm NestJS backend.

### Already Implemented

| Feature | herm-swarm Implementation |
|---|---|
| Users | apps/api/src/users/ + TenancyService: Full CRUD, search, password, preferred language, status management |
| Auth | TenancyService + apps/api/src/auth/: Login, session tokens, onboarding, default admin recovery |
| Organizations | apps/api/src/organizations/ + TenancyService: CRUD, slug, status, rich profile fields (image, brand, currency, etc.) |
| Roles | TenancyService + Role entity: System roles (owner/admin/member), per-org role management |
| Role Permissions | TenancyService + RolePermission entity: Menu-based permission model, bulk replace, role defaults |
| Menus | TenancyService + Menu entity: Hierarchical admin navigation, code/index/permission-key sync |
| Organization Settings | TenancyService + OrganizationSetting entity: Key-value settings per org (maps to xpert TenantSetting) |
| System Settings | SettingsService + SystemSetting entity: Global settings with scope field |
| Custom SMTP | MailService + CustomSmtp entity: CRUD, validation, org-scoped with global fallback |
| Email Templates | MailService + EmailTemplate entity: CRUD with hbs, mjml, languageCode, org/global scoping |
| Email Logs | MailService + EmailLog entity: Sent/queued/failed/skipped status tracking |

### Refreshed Status

The previous "Needed" list has since been implemented in the current tree:

| Previously Needed | Current Hermes-Swarm Implementation |
|---|---|
| Invite module | `apps/api/src/invite/` plus `packages/core/src/tenancy/entities/invite.entity.ts`: list, bulk create, resend, delete, validate, accept |
| Email sending capability | `apps/api/src/mail/email-send.service.ts`: nodemailer transport, SMTP verification, Handlebars template rendering, email log recording |
| Organization Contact | `packages/core/src/tenancy/entities/organization-contact.entity.ts` |
| Organization Language | `packages/core/src/tenancy/entities/organization-language.entity.ts` |
| User Email Verification | `packages/core/src/tenancy/entities/email-verification.entity.ts` |

Future changes should no longer treat these as missing migration tasks. Instead,
use Xpert as the reference for behavior and close any specific divergence found
in the current implementation.

### Not Porting

- UserOrganization many-to-many: hermes-swarm uses direct organizationId FK, which is simpler
- xpert Tenant entity: hermes-swarm collapses tenant+org into single Organization entity
- Employee entity: hermes-swarm's direct roleId+organizationId on User covers this
- xpert CQRS pattern: hermes-swarm uses plain service classes
- xpert i18n subsystem: out of scope

### Entity Mapping: xpert → hermes-swarm

| xpert Entity | herm Entity |
|---|---|
| User (TenantBaseEntity) | User (BaseEntity with organizationId FK) |
| Organization (TenantBaseEntity) | Organization (BaseEntity) |
| Role (TenantOrganizationBaseEntity) | Role (OrganizationBaseEntity) |
| RolePermission (TenantOrganizationBaseEntity) | RolePermission (OrganizationBaseEntity) |
| TenantSetting (TenantBaseEntity) | OrganizationSetting (OrganizationBaseEntity) |
| CustomSmtp (TenantOrganizationBaseEntity) | CustomSmtp (OrganizationBaseEntity) |
| EmailTemplate (TenantOrganizationBaseEntity) | EmailTemplate (OrganizationBaseEntity) |
| Email (sent email history) | EmailLog |
| Invite | needs creation |
| OrganizationContact | needs creation |
| OrganizationLanguage | needs creation |
| EmailVerification | needs creation |

### Auth Model

xpert uses JWT via @nestjs/jwt with passport strategies. hermes-swarm uses a
simpler PBKDF2-based admin session token model (admin-session.ts). We keep the
hermes-swarm auth model and adapt invite verification to use JWT where needed
for public endpoint validation.
