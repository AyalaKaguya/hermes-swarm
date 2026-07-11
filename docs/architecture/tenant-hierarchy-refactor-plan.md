# Hermes 真租户层级重构计划

## 目标

将当前的 `Platform + Organization` 假租户模型重构为：

> Platform Control Plane → Tenant → Organization → Department

当前没有生产数据，允许直接删除并重建开发数据库。本次不实现旧数据迁移、双读双写或旧会话兼容；从新基线开始启用 PostgreSQL RLS。

## 已锁定的架构决策

- 平台账号与租户账号完全分离：`PlatformUser` 只访问控制面，`User` 强制属于一个 Tenant。
- 同一邮箱可在不同 Tenant 中拥有独立账号、密码、角色和会话。
- Tenant 支持自助申请与平台审批；批准后创建默认 Organization 和 Owner。
- Tenant 下可有多个 Organization；Organization 下可有树状 Department。
- Department 是可选硬数据作用域，并支持同 Tenant 内跨 Organization 的有向调度关系。
- RBAC 分为 tenant、organization、department 三层，有效权限按 allow-only 并集合并，v1 不实现显式 deny。
- 全部 tenant-owned 表强制 `tenant_id NOT NULL`，通过复合外键和 PostgreSQL RLS 阻止串租户引用与查询。
- 调度关系不授予数据权限。

## 核心模型

### 平台控制面

- `PlatformUser`、`PlatformRole`、`PlatformRolePermission` 独立建模。
- `TenantApplication` 支持申请、邮箱验证、审批、拒绝和取消。
- 平台跨租户操作只允许通过 `/api/admin/platform/**`，并写入不可变审计记录。

### 租户数据面

- `Tenant`：全局唯一 slug/subdomain，状态为 `provisioning | active | suspended | archived`。
- `User`：`tenantId` 非空，邮箱唯一约束为 `(tenantId, lower(email))`。
- `Organization`：属于 Tenant，slug 在 Tenant 内唯一，每个 Tenant 最多一个有效默认 Organization。
- `Department`：属于 Organization，使用 `parentDepartmentId` 构建树并禁止循环。
- `UserOrganization`：表达组织访问资格。
- `UserDepartment`：引用 `UserOrganization`，保证部门成员先属于组织。
- `OrganizationGroup` 保留为非层级标签分组，不承担 Department 或安全边界职责。

### 分层 RBAC

- Permission 继续作为全局目录。
- Role 明确属于 `tenant | organization | department` 层级。
- 通过独立关联表支持 Tenant User、Organization Membership、Department Membership 的多角色绑定。
- Tenant scope 合并 Tenant roles；Organization scope 再合并 Organization roles；Department scope 再合并 Department roles。
- Platform roles 不参与租户权限计算。

### 部门调度

`DepartmentDispatchRelation` 包含 tenant、source、target、类型、优先级、启用状态和 JSON policy。

v1 类型：

- `handoff`
- `escalation`
- `collaboration`
- `fallback`

允许同 Tenant 跨 Organization 调度，禁止跨 Tenant；解析器使用幂等键、visited-set 和最大跳数防止循环，首批接入工单分派、通知目标和升级路由。

## 数据库与 RLS

- Platform：平台用户/角色、TenantApplication、平台设置、平台模板。
- Tenant：User、Tenant roles/settings、密码重置、邮箱验证、租户 SMTP/模板。
- Organization：memberships、组织 roles/invites/groups/contacts/languages/settings。
- Department：Department、memberships、dispatch relations 及可选部门业务归属。
- Tenant + 可选范围：tickets、conversations、notifications、integration tokens、email logs。

所有租户业务表包含非空 `tenant_id`；Organization/Department 资源同时保留相应下级外键。使用复合外键确保引用属于同一 Tenant，并用 CHECK 约束 scope 字段组合。

Tenant/Organization 使用软删除，核心业务外键默认 `RESTRICT`。缓存、Redis channel、实时客户端、后台任务及幂等键全部加入 tenant namespace。

RLS 从首阶段全面启用：

- 租户应用数据库角色不具备 BYPASSRLS。
- 请求在事务中使用 `SET LOCAL` 设置 tenant、scope、organization 和 department。
- 所有租户表启用 `FORCE ROW LEVEL SECURITY`；无 TenantContext 时拒绝访问。
- TypeORM repository 从 AsyncLocalStorage 获取当前事务 EntityManager。
- 平台跨租户模块使用独立 datasource/数据库角色并强制审计。
- Worker 每个任务显式携带 tenantId；平台任务拆分为逐 Tenant 子任务。
- CI 校验 TenantOwnedEntity 的非空 tenantId、索引及 RLS policy 覆盖。

## 认证、作用域与 API

- 租户 JWT 与 Redis session 固化 tenantId、userId、sessionId 和 principal type。
- token、session、User.tenantId 与 Tenant active 状态必须一致。
- 普通客户端不能覆盖 tenantId；登录、重置和邀请在认证前通过 host/subdomain 解析 Tenant，localhost 使用显式 tenant slug。
- 密码重置 token 包含 tenantId；平台账号使用独立认证端点和会话。

请求作用域：

```ts
type RequestScopeLevel = "tenant" | "organization" | "department";
```

使用 `X-Scope-Level`、`Organization-Id`、`Department-Id`；tenantId 由服务端会话注入。路径/header 冲突返回 400，跨 Tenant 资源返回 404，同 Tenant 权限不足返回 403。

API：

- `/api/admin/platform/**`：租户审批、状态、平台人员与默认配置。
- `/api/admin/tenant/**`：租户资料、组织目录、成员、角色和默认设置。
- `/api/admin/organizations/:organizationId/**`：组织成员、角色、部门、邮件、集成和通知。
- `/api/admin/organizations/:organizationId/departments/**`：部门树、成员和调度关系。
- `/api/auth/me` 返回 Tenant、分层 memberships、默认 scope 和 allowed scopes。

## 基础业务重构

- Settings：`platform default → tenant override → organization override`。
- Mail：SMTP `organization → tenant → platform public`；密码重置使用 Tenant 模板，组织邀请使用 Organization 模板。
- Tickets：始终携带 tenantId，可选 organization/department；平台支持视图显式跨租户。
- Conversations：唯一键改为 `(tenantId, sourceType, sourceId)`，参与者与消息受 TenantContext 保护。
- Notifications/Realtime：通知、socket key、Redis event 和订阅全部携带 tenantId。
- Integration Tokens：支持 tenant/organization/department scope，签名主体包含 tenantId。
- Jobs：使用 tenant-aware 队列、分布式锁和幂等执行，替换进程内全表任务。
- Audit：记录 tenant/org/department、actor、principal、permission、结果及平台目标 Tenant。
- Feature Access：扩展为 platform/tenant/organization 三层。

## 前端重构

- `/platform/**`：平台控制面。
- `/settings/tenant/**`：租户治理。
- `/settings/organization/**`：当前组织。
- `/settings/organization/departments/**`：部门管理。
- `/settings/organizations` 改为当前 Tenant 的 Organization 目录。
- 新建统一 ScopeProvider，持有 tenant、organization、department、scopeKey 和 epoch。
- Scope 偏好按 `${tenantId}:${userId}` 持久化，恢复时重新校验 membership。
- 切换 scope 时取消在途请求、清理局部状态、更新 header、重挂业务树、重连 realtime 并导航到兼容路由。
- 请求与缓存 key 包含完整 scope；公共认证接口不注入已登录 scope。
- v1 使用现有 React 数据模式，通过 AbortController、epoch 与 scope-key remount 防止旧响应污染。
- Onboarding 分为平台初始化、Tenant 申请/审批和 Owner 激活。

## 实施顺序

1. 建立文档、资源归属清单、scope 契约和可回放 schema 基线。
2. 实现新实体、复合约束、RLS、TenantContext、平台 datasource；重建开发数据库。
3. 分离平台/租户认证，完成 tenant-aware session、申请审批、激活、密码重置和分层 RBAC。
4. 迁移 Settings/Mail、Tickets/Conversations、Notifications/Realtime、Integrations、Jobs/Audit。
5. 实现 Tenant Console、ScopeProvider、部门树和调度 UI，改造现有设置与业务页面。
6. 删除 Platform-as-Tenant、旧 PlatformMember、全局 User、旧 scope 和 nullable organization fallback，生成 OpenAPI 并更新运行手册。

## 多 Agent 工作流

第一轮：

- Agent A：核心实体、migration、RLS 和数据库测试。
- Agent B：认证、会话、RBAC、请求上下文和 OpenAPI。
- Agent C：ScopeProvider、导航、登录及设置页面。
- 主 Agent：公共契约、业务模块整合和阶段验收。

第二轮：

- Agent A：Tickets、Conversations、Jobs。
- Agent B：Settings、Mail、Integrations、Audit。
- Agent C：Notifications、Realtime、Departments UI。
- 主 Agent：端到端测试、安全检查和文档。

共享类型由单一负责人修改，每轮以 core build、typecheck 和契约测试为合并门槛。

## 测试与验收

- 双 Tenant 同邮箱及相似资源 ID 的 list/get/update/delete/raw SQL 隔离。
- 无上下文、伪造 tenant、连接池复用和缺少上下文的后台任务均失败。
- host 解析、Tenant suspended、refresh 不漂移、平台/租户 token 混用。
- 伪造组织/部门 header、路径冲突、跨 Tenant Organization、跨 Organization Department。
- Department 树循环、无效 membership、跨 Tenant 调度、循环及最大跳数。
- 设置/模板回退、密码重置、工单/会话、实时事件、缓存、队列和 integration token 隔离。
- 平台运营、Tenant Owner、Org Admin、Department Manager、多组织成员、同邮箱双 Tenant 六类 E2E 身份。
- 刷新恢复 scope、浏览器前进后退、慢请求取消、缓存清理和 realtime 重连。
- 执行 `pnpm nx run-many -t test typecheck build` 以及 API/Web e2e 和 coverage。

完成标准：不存在缺少 tenantId 的租户业务表，不存在客户端可覆盖的 Tenant 授权，不存在未经过 RLS 或平台 datasource 的跨租户查询；Organization 不再承担账号边界，Department 调度与数据授权完全分离，开发数据库可从空库通过 migration + seed 重建。

## 2026-07-11 实施状态

本轮破坏性重构已完成代码与静态数据库契约落地：

- PlatformUser/PlatformRole 与 Tenant User/RBAC 已分离，Tenant 申请、审批和 Owner 激活闭环已实现。
- Tenant → Organization → Department 实体、成员关系、三层角色关联与跨组织部门调度已实现。
- 初始 migration 覆盖 Tenant 根表和全部 tenant-owned 表的强制 RLS、复合外键、scope CHECK、默认项约束和不可变访问审计。
- API 使用 `hermes_tenant_app` 非 BYPASSRLS 角色与独立 platform datasource；生产启动会验证两个数据库角色的隔离能力。
- Settings/Mail、Tickets/Conversations、Notifications/Realtime、Integration Token、Invite、Password Reset、Users/Groups/Memberships 已迁入 TenantContext。
- Department Dispatch 已实现带 tenant 校验、visited-set、最大跳数和幂等键的解析器，并接入工单分派、通知目标与升级路由；调度收件人仍必须具备已有组织/部门成员资格。
- Jobs 已使用逐 Tenant envelope、Redis 分布式锁和幂等完成标记，首个 `tickets.archive-expired` handler 不再依赖进程内全表 timer。
- Web 已提供 ScopeProvider、租户控制台、平台控制面、Tenant 申请/审批、组织/部门切换、部门树和调度管理，并移除 Platform-as-Tenant 与 platform integration token 语义。
- TenantApplication 已支持私密取消 token；平台支持租户目录及 suspend/archive 状态控制；Tenant Role CRUD API 已建立。
- 旧 Docker Organization-as-Tenant 初始化 schema 与旧 `PlatformMember` 实体已删除；开发空库只由 migration + 幂等 seed 创建。
- Feature Access 已按定义分别解析 platform、tenant、organization，并在组织层使用 platform → tenant → organization 覆盖链。
- 全仓 `test + typecheck + build` 通过；coverage 任务通过。

当前工作站没有 PostgreSQL/Docker/psql，且 5432 未监听，因此尚未在真实 PostgreSQL 上执行 migration、seed、API/Web E2E 与 OpenAPI 再生成。代码门禁将在本轮最终变更整合后重新执行；下一次具备数据库运行时后，必须按 `docs/dev-runtime-playbook.md` 从空库执行这些步骤，在此之前不得宣称“空库重建”运行验收完成。
