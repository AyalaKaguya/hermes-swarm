# Hermes 工作空间模型收敛

## 目标模型

```text
Platform
└─ Workspace
   ├─ Members
   ├─ Workspace roles and permissions
   └─ Business resources
```

`Workspace` 是唯一的成员、会话、数据隔离、审计和权限边界。当前基线不包含 Workspace 下的额外治理层；未来的成员组、项目、助手、知识库和工具应直接归属于 Workspace。

这是开发期破坏性基线，不迁移旧数据，不提供旧表、旧接口、旧字段、重定向或兼容适配层。空数据库必须能仅通过 migration 与 development seed 完整重建。

## 安全边界

- 平台和工作空间服务共用一个 application datasource；跨工作空间治理仍必须通过 Platform RBAC 授权。
- 认证会话提供可信 `workspaceId`；缺少或无效上下文时失败关闭，客户端输入不能覆盖该值。
- 所有工作空间业务表使用非空 `workspace_id`、索引、复合外键和显式服务层 Workspace 条件。
- Session、Redis、后台任务、实时消息、审计与幂等键均使用 `workspaceId` 命名空间。
- 工作空间会话只绑定一个 Workspace；切换 Workspace 必须重新建立登录会话。
- 权限范围只允许 `platform | workspace | own`。
- 工作空间角色只允许授予 `workspace | own` 权限，平台角色只允许授予 `platform` 权限。
- 每个成员在同一 Workspace 内只能拥有一个工作空间角色。

## 角色与成员约束

- 默认系统角色为 Workspace Owner 和 Workspace Member。
- Workspace Owner 不可删除。
- 禁止删除、移除或降级最后一名有效 Owner。
- 自定义工作空间角色可配置权限，但不得突破当前操作者的授权边界。
- 所有有效成员默认具备 `ticket.conversation.submit:workspace`。
- `ticket.conversation.handle:workspace` 只授予 Owner、管理员或显式配置的自定义角色。
- 邀请只携带一个 `workspaceRoleId`；接受邀请时原子创建或复用 User，并写入唯一的工作空间角色。

## 认证与开通

- Workspace principal 使用 `workspaceId` 和 `workspaceSlug`。
- `/auth/me` 只返回当前 `workspace`、`user`、`workspaceRole` 和权限集合。
- `WorkspaceApplication` 保存名称、slug、子域名和 Owner 信息。
- 平台批准申请后创建 `provisioning` Workspace、Owner User、默认角色及 Owner 角色关系。
- Owner 完成邮箱与密码激活后，在同一事务内将 Workspace 置为 `active`。

## 管理 API

```text
/api/admin/workspace
/api/admin/workspace/members
/api/admin/workspace/roles
/api/admin/workspace/permissions/catalog
/api/admin/platform/workspaces
/api/admin/platform/workspace-applications
/api/admin/workspace-applications
/api/admin/invites
```

工作空间资源不得接受客户端提供的边界标识来覆盖当前安全会话；平台 API 必须验证 platform principal。

## 工单与审计

- Ticket 通过实体的 `workspaceId` 归属 Workspace。
- 普通成员可创建工单，并访问自己提交或参与的工单。
- 拥有处理权限的成员可查看、分配和处理当前 Workspace 的全部工单。
- 平台操作审计记录目标 Workspace；工作空间操作审计直接记录当前 `workspaceId`。
- 审计日志只追加，不允许工作空间应用角色更新或删除。

## 前端路由

```text
/settings/workspace
/settings/workspace/members
/settings/workspace/access
```

设置导航和用户菜单只展示当前 Workspace；人员统一称为成员。

## 验收

- 空库 migration、development seed 和重复启动成功。
- 申请、批准、Owner 激活和 Workspace 登录闭环成功。
- 邀请、单角色约束、最后 Owner 保护和自定义角色管理通过。
- 工单提交与处理权限符合当前 Workspace 会话。
- 跨 Workspace 的读取、写入、邀请、角色和工单访问被服务层的显式 Workspace 条件、RBAC 与复合外键拒绝。
- Session、CSRF、密码变更与会话撤销保持有效。
- 平台账号可治理多个 Workspace，Workspace 账号不能访问平台 API。
- 应用、共享包、OpenAPI 和前端客户端不暴露旧层级标识或路由。

## 回滚

回退代码到改造前版本，并恢复改造前数据库备份或重新执行旧基线。此阶段不实施双写、在线迁移或兼容视图。
