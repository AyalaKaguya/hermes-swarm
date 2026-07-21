import type {
  PageAccessDefinition,
  PermissionScope,
} from "./types.js";
import { matchRoutePattern } from "./route-pattern.js";
import { getPageAccessPermissionId } from "./permission-key.js";

export const PAGE_ACCESS_DEFINITIONS = [
  definePageAccess({
    defaultRoles: ["workspace-owner", "workspace-admin", "workspace-member"],
    description: "允许访问当前工作空间的工单和会话页面。",
    href: "/tickets",
    icon: "file",
    key: "tickets",
    label: "工单",
    order: 10,
    routePatterns: ["/tickets", "/tickets/:ticketId"],
    scope: "workspace",
    section: "infrastructure",
    sectionLabel: "基础设施",
  }),
  definePageAccess({
    defaultRoles: ["workspace-owner", "workspace-admin", "workspace-member"],
    description: "允许访问个人账号资料与密码设置页面。",
    href: "/settings/account",
    icon: "user",
    key: "settings.account",
    label: "账号",
    order: 10,
    routePatterns: ["/settings", "/settings/account"],
    scope: "own",
    section: "personal",
    sectionLabel: "个人",
  }),
  definePageAccess({
    defaultRoles: ["workspace-owner", "workspace-admin", "workspace-member"],
    description: "允许访问当前账号的登录设备与会话管理页面。",
    href: "/settings/sessions",
    icon: "system",
    key: "settings.sessions",
    label: "登录设备",
    order: 20,
    routePatterns: ["/settings/sessions"],
    scope: "own",
    section: "personal",
    sectionLabel: "个人",
  }),
  definePageAccess({
    defaultRoles: ["workspace-owner", "workspace-admin", "workspace-member"],
    description: "允许管理当前账号创建的个人 API Token。",
    href: "/settings/integrations",
    icon: "plug",
    key: "settings.api-tokens",
    label: "API Token",
    order: 30,
    routePatterns: ["/settings/integrations"],
    scope: "own",
    section: "personal",
    sectionLabel: "个人",
  }),
  definePageAccess({
    defaultRoles: ["workspace-owner", "workspace-admin"],
    description: "允许管理当前工作空间的成员账号与工作空间角色分配。",
    href: "/settings/workspace/members",
    icon: "user",
    key: "settings.workspace.members",
    label: "成员",
    order: 30,
    routePatterns: ["/settings/workspace/members"],
    scope: "workspace",
    section: "workspace",
    sectionLabel: "工作空间",
  }),
  definePageAccess({
    defaultRoles: ["workspace-owner", "workspace-admin"],
    description: "允许创建和管理当前工作空间的成员邀请。",
    href: "/settings/invites",
    icon: "mail",
    key: "settings.invites",
    label: "邀请",
    order: 40,
    routePatterns: ["/settings/invites"],
    scope: "workspace",
    section: "workspace",
    sectionLabel: "工作空间",
  }),
  definePageAccess({
    defaultRoles: ["workspace-owner", "workspace-admin"],
    description: "允许访问工作空间邮件模板页面。",
    href: "/settings/email-templates",
    icon: "file",
    key: "settings.email-templates",
    label: "邮件",
    order: 50,
    routePatterns: ["/settings/email-templates", "/settings/custom-smtp"],
    scope: "workspace",
    section: "workspace",
    sectionLabel: "工作空间",
  }),
  definePageAccess({
    defaultRoles: ["workspace-owner", "workspace-admin"],
    description: "允许访问当前工作空间的角色和权限页面。",
    href: "/settings/workspace/access",
    icon: "shield",
    key: "settings.workspace-access",
    label: "角色和权限",
    order: 70,
    routePatterns: ["/settings/workspace/access"],
    scope: "workspace",
    section: "workspace",
    sectionLabel: "工作空间",
  }),
  definePageAccess({
    defaultRoles: ["workspace-owner", "workspace-admin"],
    description: "允许查看当前工作空间的登录和操作日志。",
    href: "/settings/audit-logs",
    icon: "list-x",
    key: "settings.audit-logs",
    label: "日志审计",
    order: 80,
    routePatterns: ["/settings/audit-logs"],
    scope: "workspace",
    section: "workspace",
    sectionLabel: "工作空间",
  }),
  definePageAccess({
    defaultRoles: ["platform-admin"],
    description: "允许查看平台管理员的登录和操作日志。",
    href: "/platform",
    icon: "list-x",
    key: "platform.audit",
    label: "日志审计",
    order: 0,
    routePatterns: ["/platform"],
    scope: "platform",
    section: "platform",
    sectionLabel: "平台",
  }),
  definePageAccess({
    defaultRoles: ["platform-admin"],
    description: "允许访问平台工作空间申请审批和开通页面。",
    href: "/platform/workspaces",
    icon: "building",
    key: "platform.workspaces",
    label: "工作空间申请",
    order: 5,
    routePatterns: ["/platform/workspaces"],
    scope: "platform",
    section: "platform",
    sectionLabel: "平台",
  }),
  definePageAccess({
    defaultRoles: ["platform-admin"],
    description: "允许访问平台基础设施配置页面。",
    href: "/platform/settings",
    icon: "server",
    key: "settings.platform",
    label: "平台基础设施",
    order: 10,
    routePatterns: [
      "/platform/settings",
      "/platform/settings/general",
      "/platform/settings/localization",
      "/platform/settings/governance",
      "/platform/settings/services",
      "/platform/settings/email",
      "/platform/settings/administrators",
      "/platform/settings/roles",
      "/platform/settings/parameters",
    ],
    scope: "platform",
    section: "platform",
    sectionLabel: "平台",
  }),
  definePageAccess({
    defaultRoles: ["workspace-owner", "workspace-admin", "workspace-member"],
    description: "允许访问当前工作空间资料和治理入口。",
    href: "/settings/workspace",
    icon: "layers",
    key: "settings.workspace",
    label: "工作空间",
    order: 5,
    routePatterns: [
      "/settings/workspace",
      "/settings/workspace/general",
      "/settings/workspace/localization",
      "/settings/workspace/governance",
      "/settings/workspace/parameters",
    ],
    scope: "workspace",
    section: "workspace",
    sectionLabel: "工作空间",
  }),
  definePageAccess({
    defaultRoles: ["platform-admin"],
    description: "允许访问平台邮件模板页面。",
    href: "/platform/email-templates",
    icon: "mail",
    key: "settings.platform-email-templates",
    label: "平台邮件模板",
    order: 30,
    routePatterns: ["/platform/email-templates"],
    scope: "platform",
    section: "platform",
    sectionLabel: "平台",
  }),
] as const satisfies PageAccessDefinition[];

export function getPageAccessDefinition(pageKey: string) {
  return (
    PAGE_ACCESS_DEFINITIONS.find((definition) => definition.key === pageKey) ??
    null
  );
}

export function findPageAccessDefinitionByPath(pathname: string) {
  return findPageAccessDefinitionsByPath(pathname)[0] ?? null;
}

export function findPageAccessDefinitionsByPath(pathname: string) {
  return (
    PAGE_ACCESS_DEFINITIONS.filter((definition) =>
      definition.routePatterns.some((pattern) => matchRoutePattern(pattern, pathname)),
    )
  );
}

function definePageAccess(
  definition: Omit<PageAccessDefinition, "permission">,
): PageAccessDefinition {
  return {
    ...definition,
    permission: getPageAccessPermissionId(definition.key, definition.scope),
  };
}
