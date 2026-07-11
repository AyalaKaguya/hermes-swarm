# Tenant resource ownership

This document is the implementation checklist for the `Platform → Tenant → Organization → Department` boundary. A resource may be promoted to a broader scope only through an explicit architecture change; nullable foreign keys must not be used to silently mean “platform”.

| Resource | Required owner | Optional scope | Notes |
| --- | --- | --- | --- |
| Platform users, roles, tenant applications | Platform | Target tenant for audited actions | Stored outside tenant RLS policies. |
| Tenant users, tenant roles, tenant settings | Tenant | — | `tenant_id` is non-null. |
| Organizations, organization memberships, groups, contacts, languages | Tenant + Organization | — | Organization must belong to the current tenant. |
| Departments and department memberships | Tenant + Organization + Department | — | Membership references an organization membership. |
| Department dispatch relations | Tenant | Source and target departments | Cross-organization is allowed only inside one tenant; it grants no access. |
| Password resets and email verifications | Tenant | User | Tenant is resolved before issuing a token. |
| Invites | Tenant + Organization | Department | Existing-user matching is tenant-local. |
| Settings | Tenant | Organization override | Resolution is platform → tenant → organization. |
| SMTP and email templates | Tenant | Organization override | Password reset is tenant-level; organization invite is organization-level. |
| Email logs | Tenant | Organization, Department | Platform delivery logs use a separate control-plane store or explicit audited target tenant. |
| Tickets and ticket messages | Tenant | Organization, Department | Platform support views are audited cross-tenant reads, not unowned rows. |
| Conversations, participants and messages | Tenant | Organization, Department | Source uniqueness includes `tenant_id`. |
| Notifications and destinations | Tenant | Organization, Department | Realtime and Redis keys include tenant scope. |
| Integration tokens | Tenant | Organization, Department | The signed subject includes tenant and selected scope. |
| Permissions catalog and platform defaults | Platform | — | Global read-only catalog; tenant data never references a nullable tenant as a platform marker. |

## Enforcement rules

1. Every tenant-owned table has `tenant_id NOT NULL`, an index, RLS enabled and `FORCE ROW LEVEL SECURITY`.
2. Organization- and department-owned rows use composite foreign keys that include `tenant_id`.
3. Request handling sets tenant scope with transaction-local PostgreSQL settings; repositories without a tenant transaction fail closed.
4. Background jobs carry `tenantId` in their payload and establish the same context before querying.
5. Cache keys, realtime connections, Redis channels and idempotency keys are tenant-namespaced.
6. Cross-tenant platform operations use the platform datasource and write an immutable access audit event.
