# Tenant resource ownership

Hermes 的资源边界固定为 `Platform → Tenant → Organization`。Organization 是 Tenant 内的轻量树节点，不是账号或配置边界。

| Resource | Required owner | Optional context | Notes |
| --- | --- | --- | --- |
| Platform users/roles, tenant applications, platform defaults | Platform | Target Tenant for audit | 只允许 Platform datasource 访问。 |
| Tenant, users, workspace roles, settings | Tenant | — | `tenant_id` 非空；每个 User 恰好一个工作空间角色。 |
| Organizations, organization roles, memberships | Tenant + Organization | Parent Organization | 每个 membership 恰好一个精确组织角色，不继承。 |
| Password reset, email verification, invites | Tenant | User / Organization assignments | 认证前先解析 Tenant。 |
| SMTP, email templates, email logs | Tenant | — | 不存在 Organization override。 |
| Tickets and conversations | Tenant | Source Organization | Organization 只用于来源与数据访问过滤。 |
| Notifications | Tenant | Recipient User | 不存在 Organization destination。 |
| Personal API tokens | Tenant security boundary | Owner User | 通过个人 API 管理；Token 固定 Tenant namespace，但不是工作空间共享资源。 |
| Permissions catalog | Platform-maintained catalog | Platform/Tenant/Organization/Own | 平台、工作空间和组织使用独立目录端点。 |

## Enforcement

1. Tenant-owned 表必须有 `tenant_id NOT NULL`、索引、RLS policy 与 `FORCE ROW LEVEL SECURITY`。
2. Organization/User/Role/业务引用使用包含 `tenant_id` 的复合外键。
3. 请求在事务内设置 `app.tenant_id`；无 TenantContext 时失败关闭。
4. Platform 跨租户服务使用独立 datasource/角色并记录审计。
5. Worker payload、Redis channel、cache key、realtime client 与 idempotency key 均包含 Tenant namespace。
6. 禁止通过 nullable Tenant/Organization 字段表达 Platform 或默认作用域。
7. 禁止重新引入 Department、用户组、OrganizationSetting 或 Organization-scoped Integration Token。
8. 工作空间角色只能拥有 `tenant | own` 权限；组织角色只能拥有 `organization` 权限。
9. 组织请求只使用目标 membership 的单个角色，不与工作空间或其他组织权限合并。
10. API Token 授权固定为 `Token 声明权限 ∩ Owner 当前有效权限`；每次请求先校验 Token 收窄范围，再实时检查 Owner 的工作空间或目标组织权限。
