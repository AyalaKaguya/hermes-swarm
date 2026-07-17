# 平台默认值与工作空间参数设置

日期：2026-07-17  
状态：已实现并通过自动化验收

## 1. 目标与边界

本功能建立统一的运行时设置解析顺序：

```text
个人显式偏好 → 工作空间覆盖 → 平台默认 → 代码兜底
```

- 平台管理员维护语言、时区、货币、地区、日期格式及受控参数。
- 工作空间管理员和所有者可覆盖平台开放给工作空间的项目，或恢复继承。
- 普通工作空间成员只读。
- 地区只参与本地化格式，不代表数据驻留或法律辖区。
- 不增加组织级设置层，也不改变现有管理 API 的权限语义。
- 本轮不增加跨会话实时推送；其他会话在刷新、重新登录或重新获取会话快照时生效。

## 2. 页面与路由

### 平台设置

| 路由 | 内容 | 状态 |
| --- | --- | --- |
| `/platform/settings/general` | 平台名称、访问地址、主域名 | 已完成 |
| `/platform/settings/localization` | 默认语言、时区、货币、地区、日期格式及实时预览 | 已完成 |
| `/platform/settings/governance` | 工作空间创建、默认状态、密码策略 | 已完成 |
| `/platform/settings/services` | 消息与工单服务 | 已完成 |
| `/platform/settings/email` | 公共 SMTP | 已完成 |
| `/platform/settings/administrators` | 平台管理员 | 已完成 |
| `/platform/settings/roles` | 平台角色与权限 | 已完成 |
| `/platform/settings/parameters` | 自定义参数定义、类型、范围和默认值 | 已完成 |

`/platform/settings` 和旧的 `?tab=` 地址通过 Next 服务端重定向到对应子路由。

### 工作空间设置

| 路由 | 内容 | 状态 |
| --- | --- | --- |
| `/settings/tenant/general` | 工作空间名称、标识和状态 | 已完成 |
| `/settings/tenant/localization` | 五项本地化设置、继承状态、生效值和来源 | 已完成 |
| `/settings/tenant/governance` | 可由工作空间覆盖的治理参数 | 已完成 |
| `/settings/tenant/parameters` | 平台定义且范围为工作空间的自定义参数 | 已完成 |

`/settings/tenant` 通过 Next 服务端重定向到 `general`。各页面只提交自己负责的字段，原平台管理员、角色、SMTP 和服务功能保留原业务调用。

### 平台与工作空间设置页视觉契约

平台设置与工作空间设置共用 `SettingsWorkspaceShell` 双栏工作区：

- 桌面端：左侧为 240px 可缩放局部设置导航，支持折叠到图标模式；右侧内容区独立滚动并限制为 `max-w-7xl`。
- 移动端：局部侧栏切换为顶部横向滚动导航，隐藏滚动条且不产生页面横向溢出。
- 平台八个设置入口位于局部侧栏，不再显示为内容区顶部的横向导航条。
- 平台与工作空间继续共用 `SettingsPageHeader`、`SettingsCard` 和 `SettingsFieldRow`，统一标题、说明、卡片与字段行间距。
- 平台管理员、角色和参数保留原业务组件；仅接入共享工作区，不改变 API、权限或数据流。

工作空间设置行包含：

- “跟随平台默认”与“自定义”状态；
- 当前生效值和来源徽标：个人偏好、工作空间覆盖、平台默认或代码默认；
- 单项恢复；
- 本地化设置全部恢复确认；
- 孤立遗留参数只读，但有权限的管理员仍可删除。

### Web 目录职责

设置功能按“路由声明、页面实现、共享骨架”分层，避免 App Router 的
`page.tsx` 被其他路由当作普通组件导入：

```text
apps/web/app/**/settings/**/page.tsx
  仅负责重定向或声明当前设置分区

apps/web/components/settings/
  platform-settings-page.tsx   平台设置业务页面
  tenant-settings-page.tsx     工作空间设置业务页面
  settings-navigation.ts       设置主导航定义
  settings-page.tsx             标题、卡片、字段行和子导航
  settings-value-input.tsx      参数值输入与编辑对话框
  settings-workspace-shell.tsx  桌面双栏与移动端导航骨架
```

平台八个子路由和工作空间四个子路由显式传入自己的分区，不再根据父级
路由文件或运行时路径反推业务组件。根路由仍通过服务端重定向保留兼容。

## 3. 数据、接口与约束

### 设置接口

- `GET/PUT /api/admin/platform/settings`
- `GET/PUT /api/admin/tenant/settings`

`SettingPayloadEntry` 支持 `scope?: "platform" | "tenant"`。预定义参数的范围始终由代码定义强制决定；启动初始化会修正数据库中错误的预定义类型、选项和范围。

工作空间写入规则：

1. 只能覆盖平台中存在且有效范围为 `tenant` 的参数；
2. 未知参数和平台专属参数返回 `400`；
3. `value: null` 删除工作空间覆盖并恢复继承；
4. 仅当数据库中确实存在孤立工作空间参数时，允许用 `null` 删除；
5. 平台删除自定义定义时，同一事务中删除全部同名工作空间覆盖，并发布缓存失效事件。

`GET tenant/settings` 返回有效值、平台默认、工作空间覆盖、类型、选项、来源、可编辑状态及孤立状态。Secret 值继续使用现有遮罩逻辑。

### 会话契约

登录响应和 `/api/admin/auth/me` 返回：

```ts
type RuntimePreferences = {
  language: "zh-Hans" | "zh-Hant" | "en";
  timeZone: string;
  currency: string;
  regionCode: string;
  dateFormat: string;
  sources: {
    language: "user" | "tenant" | "platform" | "code";
    timeZone: "user" | "tenant" | "platform" | "code";
    currency: "tenant" | "platform" | "code";
    regionCode: "tenant" | "platform" | "code";
    dateFormat: "tenant" | "platform" | "code";
  };
};
```

平台会话解析时会将平台记录明确标记为 `platform` 来源，不会把参数可覆盖范围误判为有效值来源。

### 个人偏好

- 新增 `PATCH /api/admin/users/me/preferences`；
- 支持可空的 `preferredLanguage` 和 `timeZone`；
- `null` 表示跟随工作空间；
- 旧语言接口保留并委托给新实现；
- 用户菜单提供“跟随工作空间”；
- 账号设置提供个人语言和时区选择。

## 4. Web 运行时

- next-intl Provider 动态接收有效语言和时区，不再硬编码 `Asia/Hong_Kong`。
- 语言和时区同步到 Cookie 与 Local Storage，保证刷新和服务端首屏一致。
- `runtime-format.ts` 统一处理日期、日期时间和货币格式。
- 现有 Web 业务页面中的散落 `toLocaleString` 和无参数 `Intl.DateTimeFormat` 已迁移。
- 平台本地化预览使用同一格式化实现，因此日期格式、时区、地区和货币变化会实时反映。
- 保存平台、工作空间或个人偏好后刷新会话快照；跟随工作空间的当前用户立即更新 Provider。

## 5. 数据迁移与兼容

迁移：`CanonicalRuntimePreferences2026071700001`

- `users.preferred_language` 改为可空并移除默认值；
- 现有租户用户语言保留为显式偏好，新建租户用户默认继承工作空间；
- 平台用户语言保持非空显式值；
- 语言持久化统一为 `zh-Hans`、`zh-Hant`、`en`；
- 迁移 `zh`、`zh-CN`、`zh-TW`、`zh-HK`、`en-US`、`en-GB` 等旧值；
- API 输入继续兼容旧别名并规范化；
- 迁移已在当前开发数据库执行。

本地开发运行时继续启用严格 RLS：

- Tenant datasource：`hermes_tenant_app`，已验证 `NOBYPASSRLS`；
- Platform datasource：独立的跨租户角色；
- API 启动不会通过关闭严格 RLS 或复用同一数据库角色绕过校验。

## 6. 验收结果

| 检查 | 结果 |
| --- | --- |
| Core test | 17/17 |
| RBAC test | 24/24 |
| RBAC API test | 13/13 |
| API test | 171/171 |
| Web test | 55/55 |
| Core/API/Web/RBAC/RBAC API typecheck | 通过 |
| Core/API/Web/RBAC/RBAC API build | 通过 |
| Web production routes | 44/44 生成成功 |
| API E2E | 5/5 |
| Web E2E | 9/9 |
| API health | `200`，数据库和 Redis 均连接 |

Web E2E 已覆盖平台双栏设置工作区、桌面端活动侧栏、移动端导航与横向溢出，以及工作空间覆盖、`null` 恢复、个人时区优先、服务端旧路由重定向和平台登录入口。API 单元/服务测试覆盖参数范围校验、未知与平台专属参数拒绝、孤立参数删除、平台来源标记、缓存失效及个人偏好规范化。

应用内浏览器直达平台设置路由时，过期会话会按权限边界返回平台登录页；本轮检查未发现新的 Console error，开发环境仅出现 Fast Refresh 全量刷新提示。

## 7. 完成清单

- [x] Core 设置契约、运行时偏好解析和语言归一化
- [x] 数据库迁移与新用户继承语义
- [x] API 范围校验、缓存失效和会话偏好
- [x] 平台设置独立子路由和旧地址服务端重定向
- [x] 设置路由声明与页面实现分层，移除跨路由组件复用
- [x] 平台与工作空间共用双栏设置工作区和移动端导航
- [x] 平台八个设置入口迁入局部侧栏
- [x] 工作空间覆盖、单项恢复、全部恢复和孤立参数删除
- [x] 动态语言/时区 Provider 和统一格式化工具
- [x] 简中、繁中、英文界面文案
- [x] 完整 Nx build、typecheck、test
- [x] API 与 Web E2E
- [x] API 运行态健康检查与浏览器权限边界检查
