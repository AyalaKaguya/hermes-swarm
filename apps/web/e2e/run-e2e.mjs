import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const baseUrl = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3100";
const sessionKey = "hermes-swarm.admin-session";

const user = {
  avatarUrl: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  displayName: "Admin User",
  email: "admin@hermes.local",
  emailVerified: true,
  firstName: "Admin",
  id: "user-admin",
  imageUrl: null,
  lastName: "User",
  mobile: null,
  nickname: null,
  preferredLanguage: "zh-CN",
  status: "active",
  timeZone: "Asia/Shanghai",
  type: "user",
  updatedAt: "2026-01-01T00:00:00.000Z",
  username: "admin",
};

const organization = {
  banner: null,
  brandColor: null,
  clientFocus: null,
  createdByUserId: user.id,
  currency: "CNY",
  dateFormat: "YYYY-MM-DD",
  id: "org-hermes",
  imageUrl: null,
  isDefault: true,
  logoUrl: null,
  name: "Hermes",
  officialName: "Hermes",
  overview: null,
  preferredLanguage: "zh-CN",
  profileLink: null,
  regionCode: "CN",
  shortDescription: null,
  slug: "hermes",
  status: "active",
  subdomain: "hermes",
  timeZone: "Asia/Shanghai",
  totalEmployees: null,
  website: null,
};

const platformPermissions = [
  "page.settings.account.access:own",
  "page.settings.sessions.access:own",
  "page.settings.integrations.access:own",
  "page.settings.organization.access:organization",
  "page.settings.custom-smtp.access:organization",
  "page.settings.email-templates.access:organization",
  "page.settings.notification-destinations.access:organization",
  "page.settings.features.access:organization",
  "page.settings.groups.access:organization",
  "page.settings.roles.access:organization",
  "page.settings.organization-integrations.access:organization",
  "page.settings.platform.access:platform",
  "page.settings.organizations.access:platform",
  "page.settings.platform-integrations.access:platform",
  "organization.platform_organization.list:platform",
  "organization.platform_organization.create:platform",
  "organization.platform_organization.delete:platform",
  "organization.profile.view:organization",
  "integration_token.organization_integration.list:organization",
  "integration_token.organization_integration.revoke:organization",
  "integration_token.platform_integration.list:platform",
  "integration_token.platform_integration.revoke:platform",
  "setting.organization_config.list:organization",
  "user.organization_member.list:organization",
  "role.organization_role.list:organization",
];

const orgScopedPermissions = [
  "page.settings.account.access:own",
  "page.settings.integrations.access:own",
  "page.settings.organization.access:organization",
  "page.settings.organization-integrations.access:organization",
  "organization.profile.view:organization",
  "integration_token.organization_integration.list:organization",
  "setting.organization_config.list:organization",
  "user.organization_member.list:organization",
  "role.organization_role.list:organization",
];

const ordinaryPermissions = ["page.settings.account.access:own"];

const personas = {
  platformAdmin: {
    displayName: "Admin User",
    permissions: platformPermissions,
    roleName: "platform-admin",
    scope: "platform",
  },
  orgScopedUser: {
    displayName: "Org Scoped User",
    permissions: orgScopedPermissions,
    roleName: "member",
    scope: "organization",
  },
  ordinaryUser: {
    displayName: "Ordinary User",
    permissions: ordinaryPermissions,
    roleName: "viewer",
    scope: "organization",
  },
  noManagementUser: {
    displayName: "No Management User",
    permissions: [],
    roleName: "guest",
    scope: "organization",
  },
};

function roleFor(personaName) {
  const persona = personas[personaName] ?? personas.platformAdmin;
  return {
    id: `role-${persona.roleName}`,
    isSystem: persona.roleName === "platform-admin",
    label: persona.displayName,
    name: persona.roleName,
    organizationId: persona.scope === "platform" ? null : organization.id,
    permissions: persona.permissions.map((permission, index) => ({
      enabled: true,
      id: `${persona.roleName}-permission-${index}`,
      organizationId: persona.scope === "platform" ? null : organization.id,
      permission,
      roleId: `role-${persona.roleName}`,
    })),
    scope: persona.scope,
  };
}

let organizations = [
  organization,
  {
    ...organization,
    id: "org-acme",
    isDefault: false,
    name: "Acme Labs",
    officialName: "Acme Labs",
    slug: "acme",
    subdomain: "acme",
  },
];

const systemSettings = [
  {
    id: "setting-platform-title",
    name: "platform.title",
    value: "Hermes Swarm",
    valueOptions: null,
    valueType: "string",
  },
];

const organizationMemberships = [
  {
    displayName: user.displayName,
    groupIds: [],
    groups: [],
    id: "membership-admin",
    joinedAt: "2026-01-01T00:00:00.000Z",
    organization,
    organizationId: organization.id,
    role: roleFor("platformAdmin"),
    roleId: "role-platform-admin",
    status: "active",
    user,
    userId: user.id,
  },
];

const organizationRoles = [roleFor("platformAdmin"), roleFor("orgScopedUser")];

const personalIntegrationTokens = [
  {
    createdAt: "2026-07-07T00:00:00.000Z",
    expiresAt: "2026-08-07T00:00:00.000Z",
    id: "token-personal-org",
    isExpired: false,
    lastUsedAt: null,
    note: "Personal org token",
    organizationId: organization.id,
    organizationName: organization.name,
    owner: null,
    ownerUserId: user.id,
    permissions: ["ticket.conversation.list_organization:organization"],
    revokedAt: null,
    scope: "organization",
    tokenPrefix: "v1.personal",
    updatedAt: "2026-07-07T00:00:00.000Z",
  },
];

const organizationIntegrationTokens = [
  {
    ...personalIntegrationTokens[0],
    id: "token-organization-managed",
    note: "Organization managed token",
    owner: {
      avatarUrl: null,
      displayName: "Org Operator",
      email: "operator@hermes.local",
      id: "user-operator",
      imageUrl: null,
      username: "operator",
    },
    ownerUserId: "user-operator",
    tokenPrefix: "v1.organization",
  },
];

const platformIntegrationTokens = [
  {
    ...personalIntegrationTokens[0],
    id: "token-platform-managed",
    note: "Platform managed token",
    organizationId: null,
    organizationName: null,
    owner: {
      avatarUrl: null,
      displayName: "Platform Operator",
      email: "platform@hermes.local",
      id: "user-platform",
      imageUrl: null,
      username: "platform",
    },
    ownerUserId: "user-platform",
    scope: "platform",
    tokenPrefix: "v1.platform",
  },
];

const authSession = {
  accessToken: "e2e-access-token",
  expiresAt: "2099-01-01T00:00:00.000Z",
  sessionId: "session-e2e",
};

function principal(personaName = "platformAdmin") {
  const persona = personas[personaName] ?? personas.platformAdmin;
  const role = roleFor(personaName);
  const principalUser = {
    ...user,
    displayName: persona.displayName,
  };
  return {
    memberships: [
      {
        displayName: persona.displayName,
        groupIds: [],
        groups: [],
        id: `membership-${persona.roleName}`,
        joinedAt: "2026-01-01T00:00:00.000Z",
        organization,
        organizationId: organization.id,
        role,
        roleId: role.id,
        status: "active",
        user: principalUser,
        userId: principalUser.id,
      },
    ],
    organization,
    permissions: persona.permissions,
    platformMembership:
      persona.scope === "platform"
        ? {
            displayName: persona.displayName,
            id: `platform-member-${persona.roleName}`,
            role,
            roleId: role.id,
            status: "active",
            user: principalUser,
            userId: principalUser.id,
          }
        : null,
    role,
    scope: {
      level: persona.scope,
      organizationId: persona.scope === "platform" ? null : organization.id,
    },
    systemSettings,
    user: principalUser,
  };
}

const tests = [
  {
    name: "login stores the session and opens the home shell",
    run: async ({ page }) => {
      await installApiMocks(page, { onboardingRequired: false });
      await page.goto(`${baseUrl}/login`);
      await page.getByRole("button", { name: "登录" }).waitFor({
        state: "visible",
        timeout: 10_000,
      });
      await waitForEnabled(page.getByRole("button", { name: "登录" }));
      await page.getByLabel("邮箱").fill("admin@hermes.local");
      await page.getByLabel("密码").fill("admin123456");
      await page.getByRole("button", { name: "登录" }).click();

      await page.waitForURL("**/home");
      assert.equal(
        await page.evaluate((key) => Boolean(localStorage.getItem(key)), sessionKey),
        true,
      );
    },
  },
  {
    name: "login redirects to onboarding when the server requires setup",
    run: async ({ page }) => {
      await installApiMocks(page, { onboardingRequired: true });
      await page.goto(`${baseUrl}/login`);
      await page.waitForURL("**/onboarding");
      await expectVisibleText(page, "初始化");

      await page.getByLabel("组织名称").fill("Launch Org");
      await page.getByLabel("组织标识").fill("launch");
      await page.getByRole("button", { name: "创建并进入" }).click();
      await page.waitForURL("**/home");
    },
  },
  {
    name: "ordinary users without management permissions cannot enter the admin shell",
    run: async ({ page }) => {
      await installApiMocks(page, {
        onboardingRequired: false,
        persona: "noManagementUser",
      });
      await page.goto(`${baseUrl}/login`);
      await waitForEnabled(page.getByRole("button", { name: "登录" }));
      await page.getByRole("button", { name: "登录" }).click();

      await expectVisibleText(page, "当前用户没有管理端访问权限");
      assert.equal(page.url().endsWith("/login"), true);
    },
  },
  {
    name: "authenticated account settings validate password changes",
    run: async ({ page }) => {
      await installApiMocks(page, { onboardingRequired: false });
      await seedSession(page);
      await page.goto(`${baseUrl}/settings/account`);

      await expectVisibleText(page, "个人资料");
      await expectVisibleText(page, "Admin User");
      await page.getByRole("tab", { name: "密码" }).click();
      await page.getByLabel("当前密码").fill("admin123456");
      await page.getByLabel("新密码").fill("new-password");
      await page.getByLabel("确认密码").fill("different-password");
      await page.getByRole("button", { name: "修改密码" }).click();
      await expectVisibleText(page, "两次输入的密码不一致");
    },
  },
  {
    name: "platform admins can see organization management entry points",
    run: async ({ page }) => {
      organizations = [organization, { ...organizations[1] }];
      await installApiMocks(page, { onboardingRequired: false });
      await seedSession(page);
      await page.goto(`${baseUrl}/settings/organizations`);

      await expectVisibleText(page, "组织列表");
      await expectVisibleText(page, "Acme Labs");
      await page.locator('input[placeholder="搜索组织..."]:visible').fill("hermes");
      await expectVisibleText(page, "Hermes");
      await expectHiddenText(page, "Acme Labs");
      await expectEnabled(page.getByRole("button", { name: "新建组织" }));
    },
  },
  {
    name: "integration management is split between personal organization and platform pages",
    run: async ({ page }) => {
      await installApiMocks(page, { onboardingRequired: false });
      await seedSession(page);

      await page.goto(`${baseUrl}/settings/integrations`);
      await expectVisibleText(page, "Personal org token");
      await expectVisibleText(page, "创建 Token");
      await expectHiddenText(page, "组织集成");
      await expectHiddenText(page, "平台集成");
      await expectHiddenText(page, "Organization managed token");

      await page.goto(`${baseUrl}/settings/organization-integrations`);
      await expectVisibleText(page, "组织集成");
      await expectVisibleText(page, "Organization managed token");
      await expectVisibleText(page, "Org Operator");
      await expectHiddenText(page, "创建 Token");

      await page.goto(`${baseUrl}/settings/platform-integrations`);
      await expectVisibleText(page, "平台集成");
      await expectVisibleText(page, "Platform managed token");
      await expectVisibleText(page, "Platform Operator");
      await expectHiddenText(page, "创建 Token");
    },
  },
  {
    name: "regular organization users cannot open platform-only pages",
    run: async ({ page }) => {
      await installApiMocks(page, {
        onboardingRequired: false,
        persona: "orgScopedUser",
      });
      await seedSession(page);
      await page.goto(`${baseUrl}/settings/platform`);

      await expectVisibleText(page, "没有页面访问权限");
      await expectVisibleText(page, "page.settings.platform.access:platform");
    },
  },
  {
    name: "resource-scoped users cannot open platform organization management",
    run: async ({ page }) => {
      await installApiMocks(page, {
        onboardingRequired: false,
        persona: "orgScopedUser",
      });
      await seedSession(page);
      await page.goto(`${baseUrl}/settings/organizations`);

      await expectVisibleText(page, "没有页面访问权限");
      await expectVisibleText(page, "page.settings.organizations.access:platform");
      await expectHiddenText(page, "新建组织");
    },
  },
  {
    name: "organization read-only users can view org settings but mutation controls stay disabled",
    run: async ({ page }) => {
      await installApiMocks(page, {
        onboardingRequired: false,
        persona: "orgScopedUser",
      });
      await seedSession(page);
      await page.goto(`${baseUrl}/settings/organization`);

      await expectVisibleText(page, "组织信息");
      await expectVisibleText(page, "Hermes");
      await expectHiddenText(page, "平台设置");
      await expectHiddenText(page, "组织列表");
      await expectDisabled(page.locator("#organization-name").first());
      await expectDisabled(page.getByRole("button", { name: "上传 Logo" }));
      await expectDisabled(page.getByRole("button", { name: "保存" }).last());

      await page.goto(`${baseUrl}/settings/organization?tab=members`);
      await expectVisibleText(page, "组织成员");
      await expectDisabled(page.getByRole("button", { name: "添加成员" }));
    },
  },
  {
    name: "ordinary users cannot open organization resource pages without page permission",
    run: async ({ page }) => {
      await installApiMocks(page, {
        onboardingRequired: false,
        persona: "ordinaryUser",
      });
      await seedSession(page);
      await page.goto(`${baseUrl}/settings/organization`);

      await expectVisibleText(page, "没有页面访问权限");
      await expectVisibleText(page, "page.settings.organization.access:organization");
    },
  },
];

async function main() {
  const server = await ensureServer();
  const browser = await launchBrowser();
  const failures = [];

  try {
    for (const test of tests) {
      const context = await browser.newContext({
        baseURL: baseUrl,
        viewport: { height: 900, width: 1440 },
      });
      const page = await context.newPage();
      try {
        await test.run({ page });
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
    if (server.started) {
      server.process.kill();
    }
  }

  if (failures.length > 0) {
    throw new Error(`${failures.length} e2e scenario(s) failed`);
  }
}

async function launchBrowser() {
  try {
    return await chromium.launch({ headless: true });
  } catch (error) {
    if (!String(error).includes("Executable doesn't exist")) {
      throw error;
    }
  }

  for (const channel of ["chrome", "msedge"]) {
    try {
      return await chromium.launch({ channel, headless: true });
    } catch {
      // Try the next installed browser channel.
    }
  }

  throw new Error(
    "No Playwright browser is installed. Run `pnpm exec playwright install chromium` or install Chrome/Edge.",
  );
}

async function ensureServer() {
  if (await isServerReady()) {
    return { started: false };
  }

  const nextBin = fileURLToPath(
    new URL("../node_modules/next/dist/bin/next", import.meta.url),
  );
  const child = spawn(process.execPath, [nextBin, "start", "--port", "3100"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));

  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await isServerReady()) {
      return { process: child, started: true };
    }
    if (child.exitCode !== null) {
      throw new Error(`Next server exited with code ${child.exitCode}`);
    }
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

async function installApiMocks(page, options) {
  const personaName = options.persona ?? "platformAdmin";
  const persona = personas[personaName] ?? personas.platformAdmin;
  const can = (permission) => persona.permissions.includes(permission);
  await page.route("**/api/admin/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace("/api/admin", "");
    const method = request.method();

    if (method === "OPTIONS") {
      await route.fulfill({ headers: corsHeaders(request), status: 204 });
      return;
    }

    if (method === "GET" && path === "/bootstrap") {
      await json(route, {
        onboardingRequired: options.onboardingRequired,
        organizations,
        systemSettings,
      });
      return;
    }

    if (method === "POST" && path === "/auth/login") {
      await json(route, { ...authSession, snapshot: principal(personaName) });
      return;
    }

    if (method === "POST" && path === "/onboarding") {
      await json(route, { ...authSession, snapshot: principal(personaName) });
      return;
    }

    if (method === "POST" && path === "/auth/refresh") {
      await json(route, authSession);
      return;
    }

    if (method === "GET" && path === "/auth/me") {
      await json(route, principal(personaName));
      return;
    }

    if (
      method === "GET" &&
      path === `/users/${user.id}/integration-tokens/capabilities`
    ) {
      await json(route, {
        scopes: [
          {
            organizationId: organization.id,
            organizationName: organization.name,
            permissions: [
              {
                description: "查看组织工单。",
                entity: "ticket",
                entityLabel: "工单",
                entityOrder: 10,
                isDangerous: false,
                label: "查看组织工单",
                operation: "list_organization",
                operationOrder: 10,
                permission: "ticket.conversation.list_organization:organization",
                purpose: "conversation",
                purposeLabel: "会话",
                purposeOrder: 10,
              },
            ],
            scope: "organization",
          },
        ],
      });
      return;
    }

    if (method === "GET" && path === `/users/${user.id}/integration-tokens`) {
      await json(route, personalIntegrationTokens);
      return;
    }

    if (
      method === "GET" &&
      path === `/organizations/${organization.id}/integration-tokens`
    ) {
      if (!can("integration_token.organization_integration.list:organization")) {
        await forbidden(route);
        return;
      }
      await json(route, organizationIntegrationTokens);
      return;
    }

    if (method === "GET" && path === "/platform/integration-tokens") {
      if (!can("integration_token.platform_integration.list:platform")) {
        await forbidden(route);
        return;
      }
      await json(route, platformIntegrationTokens);
      return;
    }

    if (method === "PATCH" && path === `/users/${user.id}`) {
      const body = await request.postDataJSON();
      Object.assign(user, body, { updatedAt: "2026-01-02T00:00:00.000Z" });
      await json(route, user);
      return;
    }

    if (method === "GET" && path === "/organizations") {
      if (!can("organization.platform_organization.list:platform")) {
        await forbidden(route);
        return;
      }
      await json(route, organizations);
      return;
    }

    if (method === "POST" && path === "/organizations") {
      if (!can("organization.platform_organization.create:platform")) {
        await forbidden(route);
        return;
      }
      const body = await request.postDataJSON();
      const created = {
        ...organization,
        id: `org-${body.slug || "created"}`,
        isDefault: false,
        name: body.name,
        officialName: body.name,
        slug: body.slug || String(body.name).toLowerCase().replace(/\s+/g, "-"),
        subdomain: body.subdomain ?? null,
      };
      organizations = [...organizations, created];
      await json(route, created);
      return;
    }

    const organizationMatch = path.match(/^\/organizations\/([^/]+)$/);
    if (method === "GET" && organizationMatch) {
      if (!can("organization.profile.view:organization")) {
        await forbidden(route);
        return;
      }
      await json(
        route,
        organizations.find((item) => item.id === organizationMatch[1]) ?? organization,
      );
      return;
    }

    if (
      method === "GET" &&
      path.match(/^\/organizations\/([^/]+)\/settings$/)
    ) {
      if (!can("setting.organization_config.list:organization")) {
        await forbidden(route);
        return;
      }
      await json(route, []);
      return;
    }

    if (
      method === "GET" &&
      path.match(/^\/organizations\/([^/]+)\/members$/)
    ) {
      if (!can("user.organization_member.list:organization")) {
        await forbidden(route);
        return;
      }
      await json(route, organizationMemberships);
      return;
    }

    if (
      method === "GET" &&
      path.match(/^\/organizations\/([^/]+)\/roles$/)
    ) {
      if (!can("role.organization_role.list:organization")) {
        await forbidden(route);
        return;
      }
      await json(route, organizationRoles);
      return;
    }

    await json(route, { message: `Unhandled e2e mock: ${method} ${path}` }, 404);
  });
}

async function seedSession(page) {
  await page.goto(`${baseUrl}/login`);
  await page.evaluate(
    ({ key, value }) => localStorage.setItem(key, JSON.stringify(value)),
    { key: sessionKey, value: authSession },
  );
}

async function json(route, body, status = 200) {
  await route.fulfill({
    body: JSON.stringify(body),
    headers: {
      ...corsHeaders(route.request()),
      "content-type": "application/json",
    },
    status,
  });
}

async function forbidden(route) {
  await json(route, { message: "权限不足" }, 403);
}

function corsHeaders(request) {
  const origin = request.headers().origin ?? baseUrl;
  return {
    "access-control-allow-headers": "authorization,content-type",
    "access-control-allow-credentials": "true",
    "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "access-control-allow-origin": origin,
  };
}

async function expectVisibleText(page, text) {
  await page.waitForFunction(
    (expected) => document.body.innerText.includes(expected),
    text,
    { timeout: 10_000 },
  );
}

async function expectHiddenText(page, text) {
  await page.waitForFunction(
    (expected) => !document.body.innerText.includes(expected),
    text,
    { timeout: 10_000 },
  );
}

async function waitForEnabled(locator) {
  await locator.waitFor({ state: "visible", timeout: 10_000 });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const disabled = await locator.evaluate(
      (element) => element instanceof HTMLButtonElement && element.disabled,
    );
    if (!disabled) return;
    await delay(100);
  }
  throw new Error("Control is still disabled");
}

async function expectEnabled(locator) {
  await locator.waitFor({ state: "visible", timeout: 10_000 });
  assert.equal(await isDisabled(locator), false);
}

async function expectDisabled(locator) {
  await locator.waitFor({ state: "visible", timeout: 10_000 });
  assert.equal(await isDisabled(locator), true);
}

async function isDisabled(locator) {
  return locator.evaluate((element) => {
    if (
      element instanceof HTMLButtonElement ||
      element instanceof HTMLInputElement ||
      element instanceof HTMLSelectElement ||
      element instanceof HTMLTextAreaElement
    ) {
      return element.disabled;
    }
    return element.getAttribute("aria-disabled") === "true";
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
