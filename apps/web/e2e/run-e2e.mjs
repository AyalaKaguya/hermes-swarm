import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const baseUrl = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const webSessionCookieName = "hermes_web_session";

const user = {
  avatarUrl: null,
  createdAt: "2026-07-15T00:00:00.000Z",
  displayName: "Tenant Owner",
  email: "owner@hermes.local",
  emailVerified: true,
  firstName: null,
  id: "user-owner",
  imageUrl: null,
  lastName: null,
  mobile: null,
  nickname: "Tenant Owner",
  preferredLanguage: "zh-Hans",
  status: "active",
  timeZone: "Asia/Hong_Kong",
  type: "user",
  updatedAt: "2026-07-15T00:00:00.000Z",
  username: "owner",
};

const rootOrganization = {
  id: "org-root",
  name: "Hermes Development",
  parentOrganizationId: null,
  slug: "hermes-development",
  status: "active",
};

const childOrganization = {
  id: "org-support",
  name: "Support",
  parentOrganizationId: rootOrganization.id,
  slug: "support",
  status: "active",
};

const tenantRole = {
  id: "role-owner",
  isSystem: true,
  label: "Tenant Owner",
  displayName: "Tenant Owner",
  name: "tenant-owner",
  scope: "tenant",
};

const organizationRole = {
  id: "role-org-admin",
  isSystem: true,
  label: "Organization Admin",
  displayName: "Organization Admin",
  name: "admin",
  organizationId: rootOrganization.id,
  permissions: [
    rolePermission("page.settings.organization.access:organization"),
    rolePermission("page.settings.organization.members.access:organization"),
    rolePermission("page.settings.organization.roles.access:organization"),
    rolePermission("user.organization_member.create:organization"),
  ],
  scope: "organization",
};

const permissions = [
  "page.settings.account.access:own",
  "page.settings.sessions.access:own",
  "page.settings.tenant.access:tenant",
  "page.settings.organizations.access:tenant",
  "page.settings.users.access:tenant",
  "page.settings.invites.access:tenant",
  "page.settings.email-templates.access:tenant",
  "page.settings.api-tokens.access:own",
  "page.settings.workspace-access.access:tenant",
  "page.settings.audit-logs.access:tenant",
  "setting.tenant_config.save:tenant",
  "tenant.tenant_profile.update:tenant",
  "workspace.console.access:tenant",
  "organization.tenant_organization.list:tenant",
  "user.tenant_user.list:tenant",
  "user.tenant_user.create:tenant",
  "user.tenant_user.update_basic:tenant",
  "user.tenant_user.replace_roles:tenant",
  "user.tenant_user.delete:tenant",
  "invite.workspace_invite.list:tenant",
  "invite.workspace_invite.create:tenant",
  "invite.workspace_invite.resend:tenant",
  "invite.workspace_invite.delete:tenant",
  "role.workspace_role.list:tenant",
];

const membership = {
  displayName: user.displayName,
  id: "membership-owner",
  isDefault: true,
  joinedAt: "2026-07-15T00:00:00.000Z",
  organization: rootOrganization,
  organizationId: rootOrganization.id,
  role: organizationRole,
  status: "active",
  user,
  userId: user.id,
};

const supportMembership = {
  ...membership,
  id: "membership-support-owner",
  isDefault: false,
  organization: childOrganization,
  organizationId: childOrganization.id,
  role: {
    ...organizationRole,
    id: "role-org-admin-support",
    organizationId: childOrganization.id,
  },
};

const snapshot = {
  defaultOrganizationId: rootOrganization.id,
  memberships: [membership, supportMembership],
  onboarding: { rootOrganizationRequired: false },
  permissions,
  principalType: "tenant",
  runtimePreferences: {
    currency: "CNY",
    dateFormat: "YYYY-MM-DD",
    language: "zh-Hans",
    regionCode: "CN",
    sources: {
      currency: "platform",
      dateFormat: "platform",
      language: "platform",
      regionCode: "platform",
      timeZone: "platform",
    },
    timeZone: "Asia/Shanghai",
  },
  tenant: {
    id: "tenant-hermes",
    name: "Hermes Development",
    slug: "hermes-dev",
    status: "active",
  },
  tenantId: "tenant-hermes",
  tenantRole,
  user,
};

const platformPagePermissions = [
  "page.platform.audit.access:platform",
  "page.platform.tenants.access:platform",
  "page.settings.platform.access:platform",
];

const platformSettings = [
  platformSetting("platform.title", "Hermes Swarm"),
  platformSetting("platform.publicBaseUrl", "http://localhost:3100"),
  platformSetting("platform.rootDomain", "localhost"),
  platformSetting("platform.subdomainRoutingEnabled", "false", "boolean"),
  platformSetting("tenant.defaultCurrency", "CNY", "enum", "tenant"),
  platformSetting("tenant.defaultDateFormat", "YYYY-MM-DD", "enum", "tenant"),
  platformSetting("tenant.defaultLanguage", "zh-Hans", "enum", "tenant"),
  platformSetting("tenant.defaultRegionCode", "CN", "enum", "tenant"),
  platformSetting("tenant.defaultTimeZone", "Asia/Shanghai", "enum", "tenant"),
];

const tests = [
  {
    name: "platform audit homepage keeps tenant applications in navigation",
    run: async ({ page, state }) => {
      state.principalType = "platform";
      await installApiMocks(page, state);
      await seedSession(page);
      await page.goto(`${baseUrl}/platform`);
      await page.getByRole("heading", { name: "日志审计" }).waitFor();
      await page.getByRole("link", { name: "租户申请", exact: true }).waitFor();
      await expectVisibleText(page, "Platform Administrator");
      await page.getByRole("tab", { name: "操作日志" }).click();
      const row = page.getByRole("row").filter({ hasText: "批准租户申请" });
      await row.click();
      await page.getByRole("dialog").getByText("操作日志详情").waitFor();
      await expectHiddenText(page, "Tenant Owner");
    },
  },
  {
    name: "unauthenticated platform settings use the platform login surface",
    run: async ({ page }) => {
      await page.goto(`${baseUrl}/platform/settings/localization`);
      await page.waitForURL(/\/platform\/login(?:\?|$)/);
    },
  },
  {
    name: "platform settings use the tenant-style two-pane workspace",
    run: async ({ page, state }) => {
      state.principalType = "platform";
      await installApiMocks(page, state);
      await seedSession(page);
      await page.goto(`${baseUrl}/platform/settings/general`);
      await page.getByRole("heading", { level: 1, name: "平台信息" }).waitFor();

      const sidebar = page.getByRole("complementary", { name: "平台设置导航" });
      assert.equal(await sidebar.isVisible(), true);
      assert.equal(
        await sidebar
          .getByRole("link", { name: "平台信息", exact: true })
          .getAttribute("aria-current"),
        "page",
      );
      const mobileNavigation = page.getByRole("navigation", {
        name: "平台设置导航",
      });
      assert.equal(await mobileNavigation.isVisible(), false);

      await sidebar
        .getByRole("link", { name: "参数设置", exact: true })
        .click();
      await page.waitForURL("**/platform/settings/parameters");
      await page.getByRole("heading", { level: 1, name: "参数设置" }).waitFor();
    },
  },
  {
    name: "platform settings use the shared mobile navigation without overflow",
    run: async ({ page, state }) => {
      state.principalType = "platform";
      await page.setViewportSize({ height: 844, width: 390 });
      await installApiMocks(page, state);
      await seedSession(page);
      await page.goto(`${baseUrl}/platform/settings/general`);
      await page.getByRole("heading", { level: 1, name: "平台信息" }).waitFor();

      const sidebar = page.getByRole("complementary", { name: "平台设置导航" });
      assert.equal(await sidebar.isVisible(), false);
      const mobileNavigation = page.getByRole("navigation", {
        name: "平台设置导航",
      });
      assert.equal(await mobileNavigation.isVisible(), true);
      await mobileNavigation
        .getByRole("link", { name: "参数设置", exact: true })
        .click();
      await page.waitForURL("**/platform/settings/parameters");
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
        true,
      );
    },
  },
  {
    name: "workspace navigation contains only the reduced tenant model",
    run: async ({ page }) => {
      await installApiMocks(page);
      await seedSession(page, { allOrganizations: true });
      await page.goto(`${baseUrl}/settings/tenant`);
      await expectVisibleText(page, "工作空间");
      await expectVisibleText(page, "组织");
      await expectVisibleText(page, "用户");
      await expectVisibleText(page, "邀请");
      await expectVisibleText(page, "日志审计");
      await expectHiddenText(page, "部门");
      await expectHiddenText(page, "用户组");
      await expectHiddenText(page, "平台基础设施");
    },
  },
  {
    name: "tenant audit settings show login and organization operation details",
    run: async ({ page }) => {
      await installApiMocks(page);
      await seedSession(page, { allOrganizations: true });
      await page.goto(`${baseUrl}/settings/audit-logs`);
      await page.getByRole("heading", { name: "日志审计" }).waitFor();
      await expectVisibleText(page, "owner@hermes.local");
      await page.getByRole("tab", { name: "操作日志" }).click();
      const row = page.getByRole("row").filter({ hasText: "更新组织资料" });
      await row.click();
      const dialog = page.getByRole("dialog");
      await dialog.getByText("操作日志详情").waitFor();
      await dialog.getByText("Support", { exact: true }).waitFor();
    },
  },
  {
    name: "organization-to-user navigation stays client-side and user roles render",
    run: async ({ page }) => {
      await installApiMocks(page);
      await seedSession(page, { allOrganizations: true });
      await page.goto(`${baseUrl}/settings/organizations`);
      await expectVisibleText(page, "Hermes Development");
      let documentRequests = 0;
      page.on("request", (request) => {
        if (request.resourceType() === "document") documentRequests += 1;
      });
      await page.getByRole("link", { name: "用户", exact: true }).click();
      await page.waitForURL("**/settings/users");
      await expectVisibleText(page, "owner@hermes.local");
      await expectVisibleText(page, "Tenant Owner");
      assert.equal(documentRequests, 0);
    },
  },
  {
    name: "workspace invite form supports tenant and multiple organization assignments",
    run: async ({ page, state }) => {
      await installApiMocks(page, state);
      await seedSession(page, { allOrganizations: true });
      await page.goto(`${baseUrl}/settings/invites`);
      await expectVisibleText(page, "member@example.com");
      await page.getByRole("button", { name: "创建邀请" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("邮箱").fill("new@example.com");
      await dialog.getByRole("combobox").nth(1).click();
      await page.getByRole("option", { name: "Tenant Owner" }).click();
      await dialog.getByText("Hermes Development", { exact: true }).click();
      await dialog.getByRole("combobox").last().click();
      await page.getByRole("option", { name: "Organization Admin" }).click();
      await dialog.getByText("Support", { exact: true }).click();
      await dialog.getByRole("combobox").last().click();
      await page.getByRole("option", { name: "Organization Admin" }).click();
      await dialog.getByRole("button", { name: "创建邀请" }).click();
      await page.waitForFunction(() => !document.body.innerText.includes("受邀用户接受后"));
      assert.equal(state.createdInvite?.email, "new@example.com");
      assert.equal(state.createdInvite?.organizations.length, 2);
    },
  },
  {
    name: "workspace localization overrides and restores platform defaults",
    run: async ({ page, state }) => {
      state.user.preferredLanguage = null;
      state.user.timeZone = null;
      refreshRuntimePreferences(state);
      await installApiMocks(page, state);
      await seedSession(page, { allOrganizations: true });

      await page.goto(`${baseUrl}/settings/tenant`);
      await page.waitForURL("**/settings/tenant/general");
      await page.goto(`${baseUrl}/settings/tenant/localization`);
      await expectVisibleText(page, "当前生效");
      await expectVisibleText(page, "平台默认");

      const timeZoneRow = settingRow(page, "时区");
      await timeZoneRow.getByRole("switch").click();
      await timeZoneRow.getByRole("combobox").click();
      await page.getByRole("option", { name: "东京时间 (Asia/Tokyo)" }).click();
      await page.getByRole("button", { name: "保存", exact: true }).click();
      await page.waitForFunction(() =>
        document.cookie.includes("hermes-swarm.time-zone=Asia/Tokyo"),
      );
      assert.equal(
        state.tenantSettings.find((setting) => setting.name === "tenant.defaultTimeZone")?.overrideValue,
        "Asia/Tokyo",
      );
      await expectVisibleText(page, "工作空间覆盖");

      await settingRow(page, "时区").getByRole("button", { name: "恢复" }).click();
      await page.waitForFunction(() =>
        document.cookie.includes("hermes-swarm.time-zone=Asia/Shanghai"),
      );
      assert.equal(
        state.tenantSettings.find((setting) => setting.name === "tenant.defaultTimeZone")?.isOverridden,
        false,
      );
    },
  },
  {
    name: "explicit user time zone stays above a workspace override",
    run: async ({ page, state }) => {
      state.user.preferredLanguage = null;
      state.user.timeZone = "Asia/Hong_Kong";
      const timeZoneSetting = state.tenantSettings.find(
        (setting) => setting.name === "tenant.defaultTimeZone",
      );
      Object.assign(timeZoneSetting, {
        isOverridden: true,
        overrideValue: "Asia/Tokyo",
        scope: "tenant",
        value: "Asia/Tokyo",
      });
      refreshRuntimePreferences(state);
      await installApiMocks(page, state);
      await seedSession(page, { allOrganizations: true });
      await page.goto(`${baseUrl}/settings/tenant/localization`);

      const row = settingRow(page, "时区");
      await row.getByText("个人偏好", { exact: true }).waitFor();
      await row.getByText(/当前生效.*Asia\/Hong_Kong/).waitFor();
      await page.waitForFunction(() =>
        document.cookie.includes("hermes-swarm.time-zone=Asia/Hong_Kong"),
      );
    },
  },
  {
    name: "workspace settings subroutes remain usable on mobile",
    run: async ({ page, state }) => {
      await page.setViewportSize({ height: 844, width: 390 });
      await installApiMocks(page, state);
      await seedSession(page, { allOrganizations: true });
      await page.goto(`${baseUrl}/settings/tenant/localization`);
      await page.getByRole("link", { name: "参数设置" }).click();
      await page.waitForURL("**/settings/tenant/parameters");
      await expectVisibleText(page, "暂无可配置参数");
    },
  },
];

async function main() {
  const server = await ensureServer();
  const browser = await launchBrowser();
  const failures = [];
  try {
    for (const test of tests) {
      const context = await browser.newContext({ baseURL: baseUrl, viewport: { height: 900, width: 1440 } });
      const page = await context.newPage();
      const state = createE2EState();
      try {
        await test.run({ page, state });
        console.log(`✓ ${test.name}`);
      } catch (error) {
        failures.push({ error, name: test.name });
        console.error(`✗ ${test.name}`);
        console.error(error);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
    if (server.started) server.process.kill();
  }
  if (failures.length) throw new Error(`${failures.length} e2e scenario(s) failed`);
}

async function installApiMocks(page, state = createE2EState()) {
  await page.route("**/api/admin/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api\/admin/, "");
    const method = request.method();
    if (method === "OPTIONS") return json(route, null, 204);
    if (method === "GET" && path === "/auth/me") {
      if (state.principalType === "platform") {
        return json(route, createPlatformPrincipal(state));
      }
      return json(route, {
        ...snapshot,
        runtimePreferences: state.runtimePreferences,
        user: state.user,
      });
    }
    if (method === "GET" && path === "/platform/settings") {
      return json(route, state.platformSettings);
    }
    if (method === "GET" && path === "/platform/audit/login-logs") {
      return json(route, auditPage([platformLoginAuditLog()]));
    }
    if (method === "GET" && path === "/platform/audit/operation-logs") {
      return json(route, auditPage([platformOperationAuditLog()]));
    }
    if (method === "GET" && path === "/tenant/audit/login-logs") {
      return json(route, auditPage([tenantLoginAuditLog()]));
    }
    if (method === "GET" && path === "/tenant/audit/operation-logs") {
      return json(route, auditPage([tenantOperationAuditLog()]));
    }
    if (method === "GET" && path === "/platform/mail/smtp") {
      return json(route, {
        fromAddress: "noreply@hermes.local",
        host: "smtp.hermes.local",
        port: 587,
        secure: false,
        username: "hermes",
      });
    }
    if (method === "GET" && path === "/platform/members") {
      return json(route, []);
    }
    if (method === "GET" && path === "/platform/roles") {
      return json(route, createPlatformPrincipal(state).platformUser.roles);
    }
    if (method === "GET" && path === "/platform/permissions/catalog") {
      return json(route, { scopes: [] });
    }
    if (method === "GET" && path === "/organizations") return json(route, [rootOrganization, childOrganization]);
    if (method === "GET" && path === "/users") return json(route, [{ ...user, tenantRole }]);
    if (method === "GET" && path === "/roles") {
      return json(route, [tenantRole]);
    }
    if (method === "GET" && /^\/organizations\/[^/]+\/roles$/.test(path)) {
      const organizationId = path.split("/")[2];
      return json(route, [{ ...organizationRole, id: `role-admin-${organizationId}`, organizationId }]);
    }
    if (method === "GET" && path === "/invites") {
      return json(route, [{
        acceptedCount: 0,
        acceptedUserId: null,
        actionDate: null,
        closedAt: null,
        createdAt: "2026-07-15T00:00:00.000Z",
        email: "member@example.com",
        existingUser: false,
        expireDate: "2026-07-18T00:00:00.000Z",
        id: "invite-1",
        invitedById: user.id,
        organizationAssignments: [{ isDefault: true, organizationId: rootOrganization.id, roleId: organizationRole.id }],
        status: "invited",
        workspaceRoleId: tenantRole.id,
      }]);
    }
    if (method === "POST" && path === "/invites") {
      state.createdInvite = request.postDataJSON();
      return json(route, { id: "invite-created", ...state.createdInvite }, 201);
    }
    if (method === "GET" && path === "/tenant/settings") {
      return json(route, state.tenantSettings);
    }
    if (method === "PUT" && path === "/tenant/settings") {
      applyTenantSettings(state, request.postDataJSON()?.settings ?? []);
      return json(route, state.tenantSettings);
    }
    if (method === "PATCH" && path === "/users/me/preferences") {
      const payload = request.postDataJSON() ?? {};
      if ("preferredLanguage" in payload) {
        state.user.preferredLanguage = payload.preferredLanguage;
      }
      if ("timeZone" in payload) state.user.timeZone = payload.timeZone;
      refreshRuntimePreferences(state);
      return json(route, state.user);
    }
    if (method === "GET" && path === "/tenant") return json(route, snapshot.tenant);
    return json(route, { message: `Unhandled e2e mock: ${method} ${path}` }, 404);
  });
}

function createE2EState() {
  const state = {
    createdInvite: null,
    platformSettings: structuredClone(platformSettings),
    principalType: "tenant",
    runtimePreferences: structuredClone(snapshot.runtimePreferences),
    tenantSettings: createTenantSettings(),
    user: structuredClone(user),
  };
  refreshRuntimePreferences(state);
  return state;
}

function createPlatformPrincipal(state) {
  const role = {
    displayName: "Platform Administrator",
    id: "role-platform-admin",
    isSystem: true,
    label: "Platform Administrator",
    name: "platform-admin",
    permissions: platformPagePermissions.map((permission) => ({
        enabled: true,
        id: `role-platform-admin-${permission}`,
        permission,
        roleId: "role-platform-admin",
      })),
    scope: "platform",
  };
  return {
    platformUser: {
      displayName: "Platform Administrator",
      email: "platform@hermes.local",
      id: "platform-user-admin",
      preferredLanguage: "zh-Hans",
      roles: [role],
      status: "active",
    },
    principalType: "platform",
    runtimePreferences: structuredClone(snapshot.runtimePreferences),
    systemSettings: state.platformSettings,
  };
}

function auditPage(items) {
  return { items, page: 1, pageSize: 20, total: items.length };
}

function tenantLoginAuditLog() {
  return {
    actor: {
      displayName: "Tenant Owner",
      email: "owner@hermes.local",
      id: user.id,
    },
    actorId: user.id,
    attemptedEmail: "owner@hermes.local",
    createdAt: "2026-07-17T12:00:00.000Z",
    deviceLabel: "Chrome / Windows",
    failureCode: null,
    id: "login-tenant-1",
    ipAddress: "203.0.113.11",
    result: "success",
    scopeType: "tenant",
    sessionId: "session-tenant-1",
    tenantId: snapshot.tenantId,
    userAgent: "Chrome Windows",
  };
}

function platformLoginAuditLog() {
  return {
    actor: {
      displayName: "Platform Administrator",
      email: "platform@hermes.local",
      id: "platform-user-admin",
    },
    actorId: "platform-user-admin",
    attemptedEmail: "platform@hermes.local",
    createdAt: "2026-07-17T12:00:00.000Z",
    deviceLabel: "Edge / Windows",
    failureCode: null,
    id: "login-platform-1",
    ipAddress: "203.0.113.12",
    result: "success",
    scopeType: "platform",
    sessionId: "session-platform-1",
    tenantId: null,
    userAgent: "Edge Windows",
  };
}

function tenantOperationAuditLog() {
  return {
    actor: {
      displayName: "Tenant Owner",
      email: "owner@hermes.local",
      id: user.id,
    },
    actorId: user.id,
    createdAt: "2026-07-17T12:05:00.000Z",
    errorCode: null,
    httpMethod: "PATCH",
    httpPath: "/api/admin/organizations/org-support",
    id: "operation-tenant-1",
    ipAddress: "203.0.113.11",
    operationLabel: "更新组织资料",
    organization: { id: childOrganization.id, name: childOrganization.name },
    organizationId: childOrganization.id,
    permission: "organization.profile.update_basic:organization",
    principalType: "tenant",
    result: "allowed",
    scopeType: "organization",
    sessionId: "session-tenant-1",
    statusCode: 200,
    targetTenant: null,
    targetTenantId: null,
    tenantId: snapshot.tenantId,
    userAgent: "Chrome Windows",
  };
}

function platformOperationAuditLog() {
  return {
    actor: {
      displayName: "Platform Administrator",
      email: "platform@hermes.local",
      id: "platform-user-admin",
    },
    actorId: "platform-user-admin",
    createdAt: "2026-07-17T12:05:00.000Z",
    errorCode: null,
    httpMethod: "POST",
    httpPath: "/api/admin/platform/tenant-applications/application-1/approve",
    id: "operation-platform-1",
    ipAddress: "203.0.113.12",
    operationLabel: "批准租户申请",
    organization: null,
    organizationId: null,
    permission: "tenant.application.approve:platform",
    principalType: "platform",
    result: "allowed",
    scopeType: "platform",
    sessionId: "session-platform-1",
    statusCode: 201,
    targetTenant: { id: "tenant-hermes", name: "Hermes Development" },
    targetTenantId: "tenant-hermes",
    tenantId: null,
    userAgent: "Edge Windows",
  };
}

function platformSetting(name, value, valueType = "string", scope = "platform") {
  return {
    id: `platform-setting-${name}`,
    name,
    scope,
    value,
    valueOptions: null,
    valueType,
  };
}

function createTenantSettings() {
  return [
    effectiveSetting("tenant.defaultCurrency", "CNY", ["CNY", "USD", "EUR", "HKD"]),
    effectiveSetting("tenant.defaultTimeZone", "Asia/Shanghai", [
      "Asia/Shanghai",
      "UTC",
      "America/New_York",
      "Europe/London",
      "Asia/Tokyo",
      "Asia/Singapore",
    ]),
    effectiveSetting("tenant.defaultRegionCode", "CN", ["CN", "HK", "TW", "US", "GB", "JP", "SG"]),
    effectiveSetting("tenant.defaultDateFormat", "YYYY-MM-DD", [
      "YYYY-MM-DD",
      "YYYY/MM/DD",
      "MM/DD/YYYY",
      "DD/MM/YYYY",
    ]),
    effectiveSetting("tenant.defaultLanguage", "zh-Hans", ["zh-Hans", "zh-Hant", "en"]),
  ];
}

function effectiveSetting(name, defaultValue, options) {
  return {
    defaultValue,
    id: `platform-${name}`,
    isEditable: true,
    isOrphaned: false,
    isOverridden: false,
    name,
    overrideValue: null,
    scope: "platform",
    tenantId: snapshot.tenantId,
    value: defaultValue,
    valueOptions: options.map((value) => ({ label: settingOptionLabel(value), value })),
    valueType: "enum",
  };
}

function settingOptionLabel(value) {
  const labels = {
    "Asia/Tokyo": "东京时间 (Asia/Tokyo)",
    "Asia/Shanghai": "中国标准时间 (Asia/Shanghai)",
  };
  return labels[value] ?? value;
}

function applyTenantSettings(state, entries) {
  for (const entry of entries) {
    const setting = state.tenantSettings.find((item) => item.name === entry.name);
    if (!setting) continue;
    if (entry.value === null || entry.value === undefined) {
      Object.assign(setting, {
        isOverridden: false,
        overrideValue: null,
        scope: "platform",
        value: setting.defaultValue,
      });
    } else {
      const value = String(entry.value);
      Object.assign(setting, {
        isOverridden: true,
        overrideValue: value,
        scope: "tenant",
        value,
      });
    }
  }
  refreshRuntimePreferences(state);
}

function refreshRuntimePreferences(state) {
  const values = Object.fromEntries(
    state.tenantSettings.map((setting) => [setting.name, setting]),
  );
  const resolve = (name) => values[name]?.value;
  const source = (name) => values[name]?.scope ?? "code";
  state.runtimePreferences = {
    currency: resolve("tenant.defaultCurrency") ?? "CNY",
    dateFormat: resolve("tenant.defaultDateFormat") ?? "YYYY-MM-DD",
    language: state.user.preferredLanguage ?? resolve("tenant.defaultLanguage") ?? "zh-Hans",
    regionCode: resolve("tenant.defaultRegionCode") ?? "CN",
    sources: {
      currency: source("tenant.defaultCurrency"),
      dateFormat: source("tenant.defaultDateFormat"),
      language: state.user.preferredLanguage ? "user" : source("tenant.defaultLanguage"),
      regionCode: source("tenant.defaultRegionCode"),
      timeZone: state.user.timeZone ? "user" : source("tenant.defaultTimeZone"),
    },
    timeZone: state.user.timeZone ?? resolve("tenant.defaultTimeZone") ?? "Asia/Shanghai",
  };
}

function settingRow(page, label) {
  return page
    .getByText(label, { exact: true })
    .first()
    .locator("xpath=ancestor::div[contains(@class,'rounded-md')][1]");
}

async function seedSession(page, { allOrganizations = false } = {}) {
  await page.context().addCookies([{
    domain: new URL(baseUrl).hostname,
    expires: Math.floor(Date.now() / 1000) + 3600,
    httpOnly: true,
    name: webSessionCookieName,
    path: "/",
    sameSite: "Lax",
    secure: baseUrl.startsWith("https://"),
    value: "e2e-web-session",
  }]);
  if (allOrganizations) {
    await page.addInitScript(({ key }) => {
      window.localStorage.setItem(key, "__all__");
    }, { key: `${snapshot.tenantId}:${user.id}:organization` });
  }
}

function rolePermission(permission) {
  return {
    enabled: true,
    id: `role-permission-${permission}`,
    permission,
    roleId: "role-org-admin",
  };
}

async function json(route, body, status = 200) {
  await route.fulfill({
    body: status === 204 ? "" : JSON.stringify(body),
    headers: { "content-type": "application/json" },
    status,
  });
}

async function expectVisibleText(page, text) {
  await page.waitForFunction((value) => document.body.innerText.includes(value), text, { timeout: 10_000 });
}

async function expectHiddenText(page, text) {
  await page.waitForFunction((value) => !document.body.innerText.includes(value), text, { timeout: 10_000 });
}

async function launchBrowser() {
  try {
    return await chromium.launch({ headless: true });
  } catch (error) {
    if (!String(error).includes("Executable doesn't exist")) throw error;
  }
  for (const channel of ["chrome", "msedge"]) {
    try {
      return await chromium.launch({ channel, headless: true });
    } catch {}
  }
  throw new Error("No Playwright browser is installed");
}

async function ensureServer() {
  if (await isServerReady()) return { started: false };
  const nextBin = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));
  const child = spawn(process.execPath, [nextBin, "start", "--port", "3100"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await isServerReady()) return { process: child, started: true };
    if (child.exitCode !== null) throw new Error(`Next server exited with code ${child.exitCode}`);
    await delay(500);
  }
  child.kill();
  throw new Error(`Timed out waiting for ${baseUrl}`);
}

async function isServerReady() {
  try {
    const response = await fetch(baseUrl, { redirect: "manual" });
    return response.status < 500;
  } catch {
    return false;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
