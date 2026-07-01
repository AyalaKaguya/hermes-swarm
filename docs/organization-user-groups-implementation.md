# 组织用户组实现文档

状态：已调整为组织内分组能力  
范围：后端数据模型、组织成员分组、前端用户组管理  
目标：在组织角色之外提供用户组能力，用于组织内成员细分管理，不参与功能访问限制

## 1. 设计目标

用户组用于表达组织内的团队、职责或临时协作集合，例如“HR 组”“运营组”“Beta 测试成员”。它独立于组织角色体系，但不授予权限，也不限制功能开关。

功能是否可用由组织配置项控制，例如 `feature:invite:enabled`、`feature:email:enabled`。组织管理员只需要打开或关闭功能，不再为功能配置访问人员名单。

## 2. 边界

| 能力 | 归属 |
| --- | --- |
| 用户是否有操作权限 | RBAC 角色与权限 |
| 组织功能是否启用 | 组织配置 `feature:*:enabled` |
| 成员如何分组 | 用户组 |
| 功能访问人员限制 | 不再支持 |

用户组可以被后续业务用于筛选、展示、通知或协作流，但不能绕过或覆盖 RBAC。

## 3. 数据模型

### `organization_groups`

组织内用户组基础信息。

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `organization_id` | 所属组织 |
| `name` | 组标识，组织内唯一 |
| `display_name` | 显示名称 |
| `color` | 颜色 |
| `description` | 描述 |
| `created_by_user_id` | 创建人 |
| `created_at` / `updated_at` | 时间戳 |

### `organization_group_members`

用户组成员关系。

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `organization_id` | 所属组织 |
| `group_id` | 用户组 |
| `membership_id` | 组织成员关系 `user_organizations.id` |
| `user_id` | 用户 |
| `created_at` / `updated_at` | 时间戳 |

## 4. 后端接口

接口位于 `/api/admin/organizations/:organizationId/groups`。

| Method | Path | 用途 |
| --- | --- | --- |
| `GET` | `/groups` | 用户组列表 |
| `POST` | `/groups` | 创建用户组 |
| `GET` | `/groups/:groupId` | 用户组详情 |
| `PATCH` | `/groups/:groupId` | 更新用户组 |
| `DELETE` | `/groups/:groupId` | 删除用户组 |
| `GET` | `/groups/:groupId/members` | 用户组成员 |
| `PUT` | `/groups/:groupId/members` | 替换用户组成员 |

删除用户组时清理 `organization_group_members`。功能开关不读取用户组，也不保存用户组访问范围。

## 5. 功能开关

`FeatureAccessModule` 只负责 `@RequireFeature` 守卫：

1. 校验 feature key 属于组织功能定义。
2. 读取组织设置中的 feature 值。
3. 值为 `"true"` 时放行，否则返回 `403 功能未启用`。

它不再读取用户组、用户组成员或访问人员 allow-list。

## 6. 前端页面

### `/settings/groups`

用于维护组织内用户组和成员：

- 创建、编辑、删除用户组。
- 选择成员并保存到当前用户组。
- 展示用户角色和已加入的组。

### `/settings/features`

用于维护组织功能开关：

- 只显示组织级 feature 定义。
- 每项只有开关，不显示访问人员。
- 保存时写入组织设置，`valueType` 为 `boolean`。

## 7. 验收

- 用户组 CRUD 和成员维护可用。
- 功能管理页不再出现访问人员配置。
- `/feature-access` 管理接口不存在。
- `@RequireFeature` 只按组织 feature 开关判断。
- 邀请、邮件等接口仍受组织功能开关控制。
