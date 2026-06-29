# 后端用户/组织/权限体系彻底重构方案

## Summary

- 将当前集中在 `TenancyService` 的用户、组织、角色、权限、设置逻辑拆成清晰模块：`Auth`、`Users`、`Organizations`、`Memberships`、`RBAC`、`Settings`、`Invites`、`Mail`、`Notifications`。
- 重建数据库 schema，不做旧 API 或旧表兼容；用户已确认采用“重建 Schema、组织内角色、平台成员表”。
- 权限层采用 Nest Guard + Decorator + CASL Ability Factory。Nest 官方授权文档也推荐 CASL 适合更复杂的 subject/attribute 权限场景；参考：[Nest Authorization](https://docs.nestjs.com/security/authorization)、[CASL](https://casl.js.org/v6/en/guide/intro/)。
- 删除组织标签功能，包括实体、模块、接口、权限、菜单和 UI 入口；保留邀请、组织邮箱/SMTP、邮件模板、用户通知/通知目标。

## Key Changes

- 新数据模型：
  - `users`: 全局用户表，只保存账号身份信息，如 `id`、`email`、`passwordHash`、`nickname`、`avatarUrl`、`status`、`emailVerified`、`preferredLanguage`、时间戳；不再保存 `organizationId` 或 `roleId`。
  - `organizations`: 组织基础表，保存 `id`、`name`、`slug`、`website`、`createdByUserId`、`status`、`logoUrl`、时间戳。
  - `user_organizations`: 用户组织成员表，保存 `userId`、`organizationId`、`roleId`、`displayName`、`status`、`joinedAt`；唯一约束为 `(userId, organizationId)`。
  - `roles`: 统一角色表，字段为 `id`、`scope`、`organizationId`、`displayName`、`color`、`description`、`isSystem`；组织角色带 `organizationId`，平台角色 `organizationId = null`。
  - `platform_members`: 平台成员表，保存 `userId`、`roleId`、`displayName`、`status`；普通用户默认没有平台成员记录，因此默认不能创建组织。
  - `permissions`: 权限目录表，按实体建模，字段为 `entity`、`action`、`scope`、`description`；`action` 固定为 `create | read | update | delete`，`scope` 固定为 `platform | organization | own`。
  - `role_permissions`: 角色权限表，关联 `roleId` 和 `permissionId`；组织角色禁止绑定 `platform` scope 权限。
  - `platform_settings` 与 `organization_settings`: 继续 KV 设计，保留 `valueType`、`valueOptions`、secret masking 能力；组织设置覆盖平台默认值。

- 后端模块重构：
  - `AuthModule` 只负责登录、当前用户、token/session 解析；token 只表达用户身份，不再强绑定单一组织。
  - `UsersModule` 负责全局用户账号资料、密码、邮箱、昵称等身份信息。
  - `OrganizationsModule` 负责组织 CRUD、创建者、状态、网站等基础信息。
  - `MembershipsModule` 负责组织成员 CRUD、成员显示名称、成员角色分配、组织切换列表。
  - `RbacModule` 负责权限目录、角色、角色权限、CASL Ability 构建，以及 `@RequirePermission({ entity, action, scope })` 注解和全局权限 Guard。
  - `SettingsModule` 负责平台/组织配置读取、写入、Redis 缓存和失效通知。
  - `InviteModule` 改为基于 `user_organizations`：接受邀请时若用户不存在则创建用户，随后创建组织成员关系。
  - `MailModule`、`NotificationsModule` 保留，但所有组织范围接口统一通过 organization scope 权限控制。
  - 移除 `TagsModule`、`Tag` entity、tags 权限、tags 菜单、前端 tags 页面入口。

- API 形态：
  - 登录与身份：`POST /api/admin/auth/login`、`GET /api/admin/auth/me`
  - 平台范围：`GET/PUT /api/admin/platform/settings`、`POST /api/admin/organizations`、平台角色/权限接口
  - 组织范围：`GET/PATCH /api/admin/organizations/:organizationId`、`/members`、`/roles`、`/settings`、`/invites`、`/mail/*`、`/notifications/*`
  - 所有组织范围接口必须从 path 中拿 `organizationId`，不再依赖“当前租户服务”的隐式组织。
  - Guard 先解析用户身份，再根据 route metadata、平台成员关系或组织成员关系生成 CASL ability；service 层仍二次校验资源 `organizationId`，避免 IDOR。

- 配置与 Redis：
  - `SettingsService.getPlatformValue(key)` 和 `getOrganizationValue(organizationId, key)` 作为后端服务读取配置的唯一入口。
  - 读取策略：Redis read-through cache，Redis miss 后查 DB 并回填；Redis 不可用时自动降级到 DB。
  - 写入策略：先写 DB，再更新 Redis，并发布配置失效事件；服务下一次读取立即拿到新值。
  - 平台配置作为默认值，组织配置只保存 override；返回有效配置时合并两层 KV。

- UI 集成：
  - 前端 session 从“当前组织用户”改为“全局用户 + memberships + platformMembership”。
  - 组织切换基于 `user_organizations`，进入组织后台时所有接口带 `organizationId`。
  - 菜单显示从旧 `menu:*` 权限切到实体权限，例如 `organization.read`、`user.update`、`setting.update`。
  - 角色页面支持颜色、描述、CRUD 权限矩阵；组织成员页面编辑 `displayName` 和组织角色。
  - 删除标签入口；保留邀请、邮箱、邮件模板、通知、平台/组织配置 UI。

## Test Plan

- 类型与构建：
  - `pnpm nx run @hermes-swarm/core:build`
  - `pnpm nx run @hermes-swarm/api:typecheck`
  - `pnpm nx run @hermes-swarm/web:typecheck`

- 后端场景：
  - 用户注册/创建后不产生组织归属字段。
  - 普通用户默认无平台成员记录，调用创建组织接口返回 403。
  - 平台成员拥有 `organization:create/platform` 后可以创建组织，并自动成为该组织 owner 成员。
  - 组织成员只能操作自己所在组织；跨组织访问返回 403。
  - CRUD 权限分别生效：有 `user.read` 不能 `user.update`，有 `user.update` 不能 `user.delete`。
  - 组织角色不能绑定平台 scope 权限。
  - 邀请接受后正确创建用户或复用已有用户，并创建 `user_organizations` 记录。
  - 平台配置写入后 Redis 和 DB 一致；Redis 不可用时仍可从 DB 读取。
  - tags 相关接口、菜单、权限全部不存在。

- UI 场景：
  - 登录后能看到自己的全局账号信息、组织 memberships、平台权限状态。
  - 普通用户没有创建组织入口；拥有平台权限的用户可见并可用。
  - 组织成员列表显示成员 display name、账号邮箱、组织角色。
  - 角色权限矩阵按实体 CRUD 展示并可保存。
  - 组织设置读取平台默认值，保存后显示组织 override。
  - 标签页面和菜单入口消失。

## Assumptions

- 已选择不迁移旧数据，允许清空/重建开发数据库 schema。
- 已选择角色以组织内角色为主，平台权限通过 `platform_members` + platform role 承载。
- 后端不需要保持旧 API 兼容，但前端必须同步集成新 API。
- 密码字段只保存 hash，不保存明文；具体 hash helper 可先复用现有实现。
