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

const tests = [
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
      await expectHiddenText(page, "部门");
      await expectHiddenText(page, "用户组");
      await expectHiddenText(page, "平台基础设施");
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
];

async function main() {
  const server = await ensureServer();
  const browser = await launchBrowser();
  const failures = [];
  try {
    for (const test of tests) {
      const context = await browser.newContext({ baseURL: baseUrl, viewport: { height: 900, width: 1440 } });
      const page = await context.newPage();
      const state = { createdInvite: null };
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

async function installApiMocks(page, state = { createdInvite: null }) {
  await page.route("**/api/admin/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api\/admin/, "");
    const method = request.method();
    if (method === "OPTIONS") return json(route, null, 204);
    if (method === "GET" && path === "/auth/me") return json(route, snapshot);
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
    if (method === "GET" && path === "/tenant") return json(route, snapshot.tenant);
    return json(route, { message: `Unhandled e2e mock: ${method} ${path}` }, 404);
  });
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
