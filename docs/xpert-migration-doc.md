# Xpert → Hermes-Swarm 后端模块迁移文档

## 概述

本文档记录了从 Xpert 项目 (`/home/ayala/Projects/xpert`) 向 Hermes-Swarm 项目 (`/home/ayala/Projects/hermes-swarm`) 迁移以下后端功能模块的分析与实现状态：

- 用户 (User)
- 租户/组织 (Tenant/Organization)
- 管理 (Admin)
- 系统设置 - 邮件 (Email System)
- 系统设置 - 整体 (Global System Settings)

## 项目架构对比

| 层面 | Xpert | Hermes-Swarm |
|------|-------|--------------|
| 框架 | NestJS + CQRS | NestJS |
| ORM | TypeORM (TenantBaseEntity) | TypeORM (BaseEntity) |
| 实体层 | packages/server/src/* | packages/core/src/* |
| 接口定义 | packages/contracts | typescript types |
| API 入口 | apps/api (轻量网关) | apps/api (直接实现) |
| 前端 | Angular | Next.js (React) |
| 包管理 | pnpm + Nx | pnpm + Nx |

---

## 一、用户模块 (User)

### Xpert 原始实现
- **实体路径**: `packages/server/src/user/user.entity.ts`
- **服务**: `packages/server/src/user/user.service.ts`
- **控制器**: `packages/server/src/user/user.controller.ts`
- **核心字段**: type, email, username, mobile, firstName, lastName, hash, imageUrl, preferredLanguage, refreshToken, emailVerified

### Hermes-Swarm 对应实现
- **实体路径**: `packages/core/src/tenancy/entities/user.entity.ts`
- **服务**: `apps/api/src/users/users.service.ts` (委托 TenancyService)
- **控制器**: `apps/api/src/users/users.controller.ts` (`/api/admin/users`)
- **额外端点**: `POST /api/admin/login`, `POST /api/admin/users/{userId}/password`, `PATCH /api/admin/users/{userId}/preferred-language`

### 迁移状态: ✅ 完成
- 实体已迁移: User extends BaseEntity (无 TenantBaseEntity 继承，改用 organizationId FK)
- CRUD 已实现: list, search, create, update, updatePassword, updatePreferredLanguage
- 权限控制已实现: users manage 权限

---

## 二、租户/组织模块 (Tenant/Organization)

### Xpert 原始实现
- **Tenant 实体**: `packages/server/src/tenant/tenant.entity.ts` (name, subdomain)
- **TenantSetting**: `packages/server/src/tenant/tenant-setting/tenant-setting.entity.ts` (name, value pairs)
- **Organization**: `packages/server/src/organization/organization.entity.ts`
- **控制器**: TenantController, TenantSettingController, OrganizationController

### Hermes-Swarm 对应实现
- **Organization 实体**: `packages/core/src/tenancy/entities/organization.entity.ts`
  - 合并了 Tenant 的字段 (name, subdomain, status, isDefault)
  - 包含完整组织信息 (profileLink, banner, totalEmployees, overview, website, currency, etc.)
- **OrganizationSetting**: `packages/core/src/tenancy/entities/organization-setting.entity.ts` (name, value pairs)
- **SystemSetting**: `packages/core/src/settings/entities/system-setting.entity.ts` (name, value — 全局设置)
- **控制器**:
  - `TenancyController`: `/api/admin/bootstrap`, `/api/admin/onboarding`, `/api/admin/login`, `/api/admin/snapshot`, `/api/admin/organization`
  - `OrganizationsController`: `/api/admin/organizations/*`
  - `SettingsController`: `/api/admin/settings`, `/api/admin/system-settings`

### 迁移状态: ✅ 完成
- Tenant → Organization 简化: 一组织一租户模型
- TenantSetting → OrganizationSetting (组织级) + SystemSetting (全局)
- 初始化流程: bootstrap → onboarding → login 完整链路

---

## 三、管理模块 (Admin)

### Xpert 原始实现
- TenantOnboarding: Auto-create super admin + features + languages
- Role/Guard system: RoleGuard + PermissionGuard + RolesEnum
- Route prefix: nested under tenant/

### Hermes-Swarm 对应实现
- **AdminController**: bootstrap, onboarding, login, snapshot, roles, menus
- **权限系统**: Role + RolePermission 实体, buildMenuPermissionKey, SYSTEM_ROLES
- **Groups**: Group 实体 + GroupsService + GroupsController
- **菜单系统**: Menu 实体 (DEFAULT_ADMIN_MENUS 定义 9 个管理菜单)
- **Route prefix**: 统一 `/api/admin/*`

### 迁移状态: ✅ 完成
- 9 个管理菜单: account, users, groups, roles, email-templates, custom-smtp, features, organizations, tenant
- 4 种系统角色: owner, admin, member, viewer (各带差异化权限)

---

## 四、邮件系统 (Email)

### Xpert 原始实现
- **Email 实体**: `packages/server/src/email/email.entity.ts`
- **EmailTemplate**: `packages/server/src/email-template/email-template.entity.ts`
- **CustomSmtp**: `packages/server/src/custom-smtp/custom-smtp.entity.ts`
- **控制器**: EmailController, CustomSmtpController

### Hermes-Swarm 对应实现
- **CustomSmtp**: `packages/core/src/mail/entities/custom-smtp.entity.ts`
- **EmailTemplate**: `packages/core/src/mail/entities/email-template.entity.ts` (hbs, mjml, languageCode, subject)
- **EmailLog**: `packages/core/src/mail/entities/email-log.entity.ts` (发信记录)
- **MailController**: `/api/admin/mail/smtp`, `/api/admin/mail/templates`, `/api/admin/mail/logs`
- **MailService**: getSmtp, saveSmtp, validateSmtp, listTemplates, createTemplate, updateTemplate, listLogs, createLog

### 迁移状态: ✅ 完成
- SMTP CRUD with validation
- Email template CRUD (hbs + mjml content)
- Email log (sent/queued/failed/skipped)

---

## 五、全局系统设置 (System Settings)

### Xpert 原始实现
- **Feature**: `packages/server/src/feature/feature.entity.ts` — 层级特征定义
- **FeatureOrganization**: `packages/server/src/feature/feature-organization.entity.ts` — 组织特征开关
- **FeatureToggleController**: toggle definition, parent features, enabled/disabled
- **FeatureController**: upgrade features

### Hermes-Swarm 对应实现
- **SystemSetting**: `packages/core/src/settings/entities/system-setting.entity.ts` (name, value, scope)
- **SettingsController**: `/api/admin/system-settings` (GET/PUT)
- **SettingsService**: listSystemSettings, saveSystemSettings (key-value 模型)

### 迁移状态: ✅ 完成（简化版）
- Xpert 的层级特征系统已简化为 key-value SystemSetting
- Feature toggle → SystemSetting name=feature:* keys
- 前端 `/settings/features` 页面通过 SystemSetting API 操作

---

## 六、其他已迁移模块

| Xpert 模块 | Hermes-Swarm 对应 | 状态 |
|-----------|-----------------|------|
| invite | InviteService + InviteController | ✅ |
| password-reset | PasswordResetService + PasswordResetController | ✅ |
| role-permission | RolePermission entity + TenancyService | ✅ |
| user-group | Group entity + GroupsService + GroupsController | ✅ |
| organization-contact | OrganizationContact entity | ✅ |
| organization-language | OrganizationLanguage entity | ✅ |
| auth | AuthService + AuthController (/api/admin/login) | ✅ |

---

## 七、构建验证结果

| 项目 | 编译命令 | 结果 |
|------|---------|------|
| packages/core | `pnpm exec tsc --noEmit` | ✅ 无错误 |
| apps/api | `pnpm exec tsc --noEmit` | ✅ 无错误 |
| apps/web | `pnpm exec tsc --noEmit` | ✅ 无错误 |
| Nx daemon | `pnpm nx reset` + `pnpm nx run` | ⚠️ EPERM on unix socket (非阻塞，tsc 直接可用) |

---

## 八、前后端路由映射

| 菜单 | 前端路由 | 后端 API |
|------|---------|---------|
| 账号 | /settings/account | /api/admin/snapshot, /api/admin/users/{id} |
| 用户 | /settings/users | /api/admin/users |
| 用户组 | /settings/groups | /api/admin/groups |
| 角色 | /settings/roles | /api/admin/roles |
| 邮件模板 | /settings/email-templates | /api/admin/mail/templates |
| 自定义 SMTP | /settings/custom-smtp | /api/admin/mail/smtp |
| 功能 | /settings/features | /api/admin/system-settings |
| 组织 | /settings/organizations | /api/admin/organization |
| 租户 | /settings/tenant | /api/admin/organization |

---
生成时间: 2026-06-26
