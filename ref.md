# 组织用户组与功能访问限制实现文档

## Summary

新增组织内“用户组”能力，用于在角色权限之外做更细的访问人员限定。角色仍负责授予能力，用户组只负责收窄某个组织功能的可用人群。

默认语义：

- 用户组不授予权限，只作为功能 allow-list。
- 某个功能没有配置用户组时，保持现有角色权限行为。
- 某个功能配置了用户组后，普通成员必须属于至少一个允许组才能使用。
- 平台管理员和组织管理员绕过用户组限制，但仍受原 RBAC 权限控制。
- 第一版只覆盖现有 `feature:*` 组织功能开关，不做通用 route/resource 策略。

## Key Changes

### 数据模型

新增 core identity entities：

- `organization_groups`
  - `id`, `organization_id`, `name`, `display_name`, `color`, `description`, `created_by_user_id`, timestamps
  - unique: `(organization_id, name)`
- `organization_group_members`
  - `id`, `organization_id`, `group_id`, `membership_id`, `user_id`, timestamps
  - unique: `(group_id, membership_id)`
  - 只允许加入同组织的 `user_organizations` 成员
- `organization_feature_group_access`
  - `id`, `organization_id`, `feature_key`, `group_id`, timestamps
  - unique: `(organization_id, feature_key, group_id)`
  - `groupIds = []` 表示该功能不限制用户组

不复用旧库残留的 `groups` / `group_users` 表，避免和旧 schema 语义混淆。

### 后端 API

新增 `GroupsModule`，挂在 `AdminModule` 下。

组织用户组管理：

- `GET /api/admin/organizations/:organizationId/groups`
- `POST /api/admin/organizations/:organizationId/groups`
- `GET /api/admin/organizations/:organizationId/groups/:groupId`
- `PATCH /api/admin/organizations/:organizationId/groups/:groupId`
- `DELETE /api/admin/organizations/:organizationId/groups/:groupId`
- `GET /api/admin/organizations/:organizationId/groups/:groupId/members`
- `PUT /api/admin/organizations/:organizationId/groups/:groupId/members`

功能访问限制：

- `GET /api/admin/organizations/:organizationId/feature-access`
- `PUT /api/admin/organizations/:organizationId/feature-access`
  - body: `{ featureKey: string; groupIds: string[] }`
  - `groupIds: []` 删除该功能的用户组限制

RBAC 新增权限：

- `group:create:organization`
- `group:read:organization`
- `group:update:organization`
- `group:delete:organization`

默认角色：

- `owner` / `admin` / `platform-admin` 拥有 group CRUD。
- `member` / `viewer` 不默认拥有 group 管理权限。

### 功能访问判断

新增 `FeatureAccessService`：

- `isFeatureEnabledForUser(organizationId, featureKey, userId)`
  - 先读取工作空间有效设置：`SettingsService.getTenantValue(...)`
  - feature 开关不是 `"true"` 时返回 false
  - 没有用户组限制时返回 true
  - 有用户组限制时，普通成员必须命中允许组
  - 平台管理员或具备组织管理权限的用户绕过用户组 allow-list

新增 `@RequireFeature(featureKey)` decorator 与 `FeatureAccessGuard`：

- RBAC guard 仍先执行。
- Feature guard 只用于已经有组织上下文的 feature 业务接口。
- 第一版接入组织级 feature：
  - `feature:invite:enabled` -> 邀请相关组织接口
  - `feature:email:enabled` -> 组织邮件 SMTP、模板、日志相关接口
- `feature:password-reset:enabled` 和 system scope feature 暂不接用户组限制。

### 前端 UI

新增设置导航项：`用户组`。

用户组页面：

- 路由：`/settings/groups`
- 能力：创建、编辑、删除用户组；设置颜色、描述；管理组成员。
- 成员来源：当前组织 `user_organizations`，展示邮箱、昵称、组织显示名、角色。

功能管理页面改造：

- 每个组织 feature 保留启用/禁用开关。
- 增加“访问人员”配置：
  - 默认：所有有角色权限的人可用。
  - 可选择一个或多个用户组。
  - 清空用户组表示恢复默认不限制。
- 如果当前用户没有 `setting:update:organization`，访问人员配置只读。

Session/API 类型：

- `OrganizationMembership` 返回 `groupIds` / `groups` 简要信息，方便前端判断和展示。
- `apps/web/lib/admin-api.ts` 增加 group 与 feature-access 类型和 wrapper。
- `hasMenuAccess` 增加 `groups -> group:*:organization` 映射。

## Test Plan

### 后端

- 用户组 CRUD：
  - 创建同组织唯一 `name`。
  - 不能把 A 组织成员加入 B 组织用户组。
  - 删除用户组后清理成员和 feature access 记录。
- 权限：
  - 无 `group:*:organization` 权限不能管理用户组。
  - owner/admin/platform-admin 可管理用户组。
- 功能访问：
  - feature disabled 时所有普通使用请求返回 403。
  - feature enabled 且无 group 限制时维持现有 RBAC 行为。
  - feature enabled 且配置 group 限制时，非组成员返回 403。
  - 组成员可访问。
  - 平台管理员和组织管理员绕过 group 限制，但仍需要原 RBAC 权限。
- 回归：
  - `pnpm nx run @hermes-swarm/core:build --skip-nx-cache`
  - `pnpm nx run @hermes-swarm/api:typecheck --skip-nx-cache`
  - `pnpm nx run @hermes-swarm/web:typecheck --skip-nx-cache`
  - `pnpm verify:refactor`

### 前端

- `/settings/groups` 可完成用户组创建、编辑、删除、成员维护。
- 功能管理页可为 feature 选择多个用户组并回显。
- 清空 feature 的用户组限制后恢复“所有有权限人员可用”。
- 无管理权限用户只能查看，不能修改组和访问限制。
- 受限用户登录后，看不到或无法使用被用户组限制的功能。

## Assumptions

- 用户组只存在于组织范围，不做平台用户组。
- 用户组不替代角色，也不授予权限。
- 第一版只做 feature allow-list，不做任意资源、任意 route 或字段级策略。
- 管理员绕过用户组限制的判定采用权限能力：平台管理员，或组织内具备 group/setting 管理权限的用户。
- 后端是最终权限来源；前端隐藏入口只是体验优化。
