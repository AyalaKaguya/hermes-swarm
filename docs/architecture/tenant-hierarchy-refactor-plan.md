# Hermes 工作空间与组织双层 RBAC

## 目标模型

Hermes 的身份、治理和业务边界固定为：

> Platform → Tenant（UI 称“工作空间”）→ Organization → User / Role / Permission

这是开发期破坏性基线，不迁移旧数据，不保留 Department、用户组、共享组织角色、旧 scope header、旧 API 或旧会话兼容层。空数据库必须能仅通过 migration + seed 完整重建。

## 控制面边界

### Platform

- `PlatformUser`、`PlatformRole`、`PlatformRolePermission` 使用独立身份、会话、API 和 datasource。
- 平台页面与接口只位于 `/platform/**`、`/api/admin/platform/**`。
- 平台权限目录只由 `/api/admin/platform/permissions/catalog` 返回。
- 租户用户看不到平台入口、平台角色或平台权限；平台角色不参与租户授权。

### Workspace

- Tenant 是账号、会话、域名、RLS、Redis、任务和缓存的硬边界。
- `User.tenantId` 非空；邮箱按 `(tenantId, lower(email))` 唯一。
- 同一邮箱可在不同 Tenant 中拥有完全独立的账号和密码。
- 一个会话固定一个 Tenant；切换 Tenant 必须重新登录。
- “全部组织”表示工作空间控制台，仅拥有 `workspace.console.access:tenant` 的用户可选择。

### Organization

- Organization 是 Tenant 内的轻量树节点，只保存父级、名称、slug、状态、创建者和审计字段。
- 每个 Tenant 恰好一个有效根组织；非根组织必须指定同 Tenant 父级。
- 服务层阻止自引用和循环；根组织不能删除、停用或改挂。
- 有子组织、有效成员或工单引用的组织不能删除。
- 组织之间不继承角色或权限。

## 双层 RBAC

### 工作空间角色

- `Role.scope = tenant` 且 `organizationId IS NULL`。
- 每个活跃 User 通过 `UserTenantRole` 恰好绑定一个工作空间角色。
- 工作空间角色只能包含 `tenant | own` 权限。
- Tenant Owner 是不可删除的系统角色，拥有全部租户治理和个人能力权限。
- Tenant Owner 不绕过组织授权；进入具体组织仍需显式 membership 和组织角色。

### 组织角色

- `Role.scope = organization` 且 `organizationId` 必须指向同 Tenant 的组织。
- 每个组织拥有独立角色库；名称只在该组织内唯一。
- 每个活跃 `UserOrganization` 通过 `UserOrganizationRole` 恰好绑定一个当前组织角色。
- 组织角色只能包含 `organization` 权限，只作用于精确组织，不向父级、子级或其他组织继承。
- 新建组织原子创建 Owner、Admin、Member、Viewer，并把创建者加入该组织、绑定 Owner。
- Owner 权限不可削减；最后一个 Owner 不可降级或移除；已分配角色不可删除。

### 有效权限

- 个人请求：只使用工作空间角色中的 `own` 权限。
- 工作空间请求：只使用工作空间角色中的 `tenant` 权限。
- 组织请求：只使用目标组织 membership 的单个组织角色。
- 不合并工作空间角色与组织角色，不合并其他组织角色，也不做组织树继承。
- 跨 Tenant 资源返回 404；同 Tenant 权限不足返回 403。

权限目录分别由以下端点返回：

```http
GET /api/admin/permissions/catalog
GET /api/admin/organizations/:organizationId/permissions/catalog
GET /api/admin/platform/permissions/catalog
```

第一条只返回 `tenant + own`，第二条只返回 `organization`，第三条只返回 `platform`。

## 用户、成员与会话

- User 是工作空间账号，可加入多个 Organization；删除 membership 不删除 User。
- 禁用 User 会撤销全部会话和个人 Integration Token。
- 切换组织不重新认证；前端只保存 `activeOrganizationId`、epoch 和请求取消状态。
- `/api/admin/auth/me` 返回单个 `tenantRole`，以及每个 membership 的单个 `role + permissions`。
- 顶层 `permissions` 只含工作空间角色权限，不返回组织权限全局并集。
- 客户端不发送 Tenant、scope 或隐式 Organization header；Tenant 来自服务端会话，Organization 由路径、查询或请求体明确表达。

## Onboarding

平台审批后创建 `provisioning` Tenant、Owner User 和 Tenant Owner 角色，不自动创建 Organization。Owner 激活密码后获得受限会话，并调用：

```http
POST /api/admin/tenant/onboarding/root-organization
```

根组织、默认组织角色、Owner membership、组织 Owner 分配和 Tenant `active` 状态在一个事务中完成。重复提交相同输入幂等返回，冲突输入返回 409。

## API 契约

工作空间治理：

```http
GET    /api/admin/tenant
PATCH  /api/admin/tenant

GET    /api/admin/organizations
POST   /api/admin/organizations
GET    /api/admin/organizations/:organizationId
PATCH  /api/admin/organizations/:organizationId
DELETE /api/admin/organizations/:organizationId

GET    /api/admin/users
POST   /api/admin/users
PATCH  /api/admin/users/:userId
DELETE /api/admin/users/:userId
PUT    /api/admin/users/:userId/role

GET    /api/admin/roles
POST   /api/admin/roles
PATCH  /api/admin/roles/:roleId
PUT    /api/admin/roles/:roleId/permissions
DELETE /api/admin/roles/:roleId
```

组织治理：

```http
GET  /api/admin/organizations/:organizationId/members
POST /api/admin/organizations/:organizationId/members
PATCH /api/admin/organizations/:organizationId/members/:membershipId
DELETE /api/admin/organizations/:organizationId/members/:membershipId
PUT /api/admin/organizations/:organizationId/members/:membershipId/role

GET  /api/admin/organizations/:organizationId/roles
POST /api/admin/organizations/:organizationId/roles
PATCH /api/admin/organizations/:organizationId/roles/:roleId
PUT /api/admin/organizations/:organizationId/roles/:roleId/permissions
DELETE /api/admin/organizations/:organizationId/roles/:roleId
```

统一邀请使用一个工作空间角色和每个目标组织的一个角色：

```ts
type CreateInvitePayload = {
  email: string;
  workspaceRoleId: string;
  organizations: Array<{
    organizationId: string;
    roleId: string;
    isDefault?: boolean;
  }>;
};
```

邀请者必须在每个目标组织拥有 `user.organization_member.create:organization`；Tenant Owner 没有绕过。接受邀请在单个事务内创建或复用 User、唯一工作空间角色、memberships 和组织角色。

## 业务边界

- Ticket 保存 `tenantId`、`sourceOrganizationId`、requester 和可选 assignee。
- 提交 Ticket 必须属于来源组织并拥有该组织的 `ticket.conversation.submit:organization`。
- Requester、参与者、assignee 具有工单固有访问；批量处理要求来源组织精确角色的 `ticket.conversation.handle:organization`。
- 父组织、子组织和兄弟组织均不自动获得工单处理权限。
- Conversation 从 Ticket 推导组织来源。
- Notifications 为 Tenant + recipient User，不存在组织通知目标或部门路由。
- Personal API Token 由当前账号通过 `/api/admin/account/integration-tokens` 创建和撤销；创建能力由工作空间角色中的 `own` 权限控制。Token 固定 Tenant namespace，但不是工作空间共享资源，也不接受客户端 scope 参数。
- Token 的有效授权为 `Token 声明权限 ∩ Owner 当前有效权限`：先检查 Token 是否声明目标权限，再实时检查 Owner 的工作空间角色或目标组织成员角色；任一权限、成员关系或用户状态被撤销后，已有 Token 立即失去对应能力。
- Settings、SMTP、邮件模板和 Feature Access 只支持 Platform default → Tenant override。
- Realtime、Redis、Jobs、cache 和幂等键都使用 Tenant namespace。

## 数据库与 RLS

- `WorkspaceModelBaseline2026071500001` 是唯一初始 migration。
- Tenant-owned 表包含 `tenant_id NOT NULL`、Tenant 索引、复合外键和强制 RLS policy。
- Role scope 使用 CHECK；组织角色通过 `(tenant_id, organization_id, role_id)` 复合外键防止跨组织分配。
- `UserTenantRole(tenantId,userId)` 与 `UserOrganizationRole(tenantId,membershipId)` 唯一。
- Invite 的工作空间角色、Organization 父级、User、Membership、Ticket 来源均使用 Tenant 一致性外键。
- Tenant datasource 使用 `hermes_tenant_app`（`NOBYPASSRLS`）；Platform datasource 使用独立跨租户角色。
- 每个租户请求在事务内设置 `app.tenant_id`，repository 只使用 AsyncLocalStorage 当前 EntityManager。
- 退役表不得存在：Department、UserDepartment、DepartmentDispatchRelation、OrganizationGroup、OrganizationSetting 及相关关联表。

## 前端信息架构

始终显示个人设置：账号、登录设备、API Token。

选择“全部组织”时显示：工作空间、组织、用户、邀请、邮件、工作空间访问。

选择具体组织时显示：组织资料、成员、角色与权限。

工作空间角色路由为 `/settings/workspace-access`；组织角色路由为 `/settings/organization/roles`。旧 `/settings/roles` 不再存在。组织切换通过 `OrganizationContextProvider` 原子更新，不刷新页面或重新登录。

## 验收门禁

- 同一用户在组织 A 为 Admin、组织 B 为 Viewer，切换后页面、按钮、API 和数据结果同步变化。
- A 组织角色不能分配给 B 组织成员；父子组织不继承权限。
- Tenant Owner 未加入目标组织时不能进入组织控制台或邀请成员。
- 无 `workspace.console.access:tenant` 时不能显示、选择或伪造“全部组织”。
- `/auth/me` 顶层不合并组织权限；三个权限目录互不泄漏。
- 空库可通过 migration + seed 重建，并通过 RLS、API/Web E2E、OpenAPI、coverage、test、typecheck 和 build。

## 2026-07-16 实施状态

- 双层单角色实体、API、授权解析、组织默认角色、邀请、工单和前端动态设置导航已落地。
- 开发数据库已从唯一基线 migration 重建并完成 Seed；租户应用角色已启用 `NOBYPASSRLS`，退役表、RLS 缺口、重复角色分配、跨组织角色错配和权限 scope 泄漏检查均为零。
- 工作空间、组织与平台权限目录已拆为独立 API；工作空间目录只返回 `tenant/own`，组织目录只返回 `organization`，平台目录只返回 `platform`。
- 全仓 `test`、`typecheck`、`build` 已通过；API 单元测试 163 项、Web 单元测试 47 项、API E2E 5 项及 Web E2E 3 项全部通过。
- API coverage 为行 70.60%、分支 69.44%、函数 61.30%；Web coverage 为行 75.18%、分支 83.82%、函数 36.56%。
- OpenAPI 已按最终权限目录重新生成；浏览器已验收“全部组织”与具体组织导航切换、组织资料、组织角色权限目录和工作空间角色权限目录。
