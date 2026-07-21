# Workspace resource ownership

Hermes 的资源边界固定为 `Platform → Workspace`。Workspace 是成员、认证会话、数据隔离、审计和授权边界。

| Resource | Required owner | Optional context | Notes |
| --- | --- | --- | --- |
| Platform users/roles, workspace applications, platform defaults | Platform | Target Workspace for audit | 只允许 Platform datasource 访问。 |
| Workspace, members, workspace roles, settings | Workspace | — | `workspace_id` 非空；每个成员恰好一个工作空间角色。 |
| Password reset, email verification, invites | Workspace | User | 认证前先解析 Workspace；邀请只指定一个工作空间角色。 |
| SMTP, email templates, email logs | Workspace | — | 所有配置和日志直接归属 Workspace。 |
| Tickets and conversations | Workspace | Requester / participants / assignee | 不存储额外层级来源。 |
| Notifications | Workspace | Recipient User | recipient 必须属于同一 Workspace。 |
| Personal API tokens | Workspace security boundary | Owner User | Token 固定 Workspace namespace，但不是工作空间共享资源。 |
| Permissions catalog | Platform-maintained catalog | Platform/Workspace/Own | 平台与工作空间使用独立目录端点。 |

## Enforcement

1. Workspace-owned 表必须有 `workspace_id NOT NULL`、索引、RLS policy 与 `FORCE ROW LEVEL SECURITY`。
2. User、Role 和业务引用使用包含 `workspace_id` 的复合外键，拒绝跨 Workspace 关联。
3. 请求在事务内设置 `app.workspace_id`；无 WorkspaceContext 时失败关闭。
4. Platform 跨 Workspace 服务使用独立 datasource/角色并记录目标 Workspace 审计。
5. Worker payload、Redis channel、cache key、realtime client 与 idempotency key 均包含 Workspace namespace。
6. 禁止通过 nullable `workspace_id` 表达 Platform 作用域；平台资源使用独立实体和访问路径。
7. 权限 scope 只允许 `platform | workspace | own`。
8. 工作空间角色只能拥有 `workspace | own` 权限，平台角色只能拥有 `platform` 权限。
9. API Token 授权固定为 `Token 声明权限 ∩ Owner 当前有效权限`；每次请求先校验 Token 收窄范围，再实时检查 Owner 的当前工作空间权限。
10. 新业务资源必须直接归属 Workspace；确需更细协作范围时，使用显式的成员组、项目或资源授权模型，不改变 Workspace 安全边界。
