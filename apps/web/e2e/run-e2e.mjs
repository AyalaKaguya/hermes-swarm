import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import {
  PrincipalSessionSchema,
  adminContracts,
  responseSchemaFor,
} from "@hermes-swarm/api-contracts";

const baseUrl = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const webSessionCookieName = "hermes_web_session";

const user = {
  avatarUrl: null,
  createdAt: "2026-07-15T00:00:00.000Z",
  displayName: "Workspace Owner",
  email: "owner@hermes.local",
  emailVerified: true,
  firstName: null,
  id: "user-owner",
  imageUrl: null,
  lastName: null,
  mobile: null,
  nickname: "Workspace Owner",
  preferredLanguage: "zh-Hans",
  status: "active",
  timeZone: "Asia/Hong_Kong",
  type: "user",
  updatedAt: "2026-07-15T00:00:00.000Z",
  username: "owner",
};

const role = {
  color: null,
  description: "工作空间所有者",
  displayName: "Workspace Owner",
  id: "role-owner",
  isSystem: true,
  label: "Workspace Owner",
  name: "workspace-owner",
  permissions: [],
  scope: "workspace",
  workspaceId: "workspace-hermes",
};

const permissions = [
  "page.settings.account.access:own",
  "page.settings.sessions.access:own",
  "page.settings.api-tokens.access:own",
  "page.settings.workspace.access:workspace",
  "page.settings.workspace.members.access:workspace",
  "page.settings.invites.access:workspace",
  "page.settings.email-templates.access:workspace",
  "page.settings.workspace-access.access:workspace",
  "page.settings.audit-logs.access:workspace",
  "workspace.workspace_profile.update:workspace",
  "member.workspace_user.list:workspace",
  "member.workspace_user.create:workspace",
  "member.workspace_user.update_basic:workspace",
  "member.workspace_user.replace_roles:workspace",
  "member.workspace_user.delete:workspace",
  "role.workspace_role.list:workspace",
];

const snapshot = {
  account: user,
  context: {
    membershipId: "membership-owner",
    type: "workspace",
    workspace: {
      id: "workspace-hermes",
      name: "Hermes Development",
      slug: "hermes-dev",
      status: "active",
    },
  },
  membership: {
    id: "membership-owner",
    role,
    status: "active",
  },
  permissions,
  principalType: "workspace",
  runtimePreferences: {
    currency: "CNY",
    dateFormat: "YYYY-MM-DD",
    language: "zh-Hans",
    regionCode: "CN",
    sources: {
      currency: "platform",
      dateFormat: "platform",
      language: "user",
      regionCode: "platform",
      timeZone: "user",
    },
    timeZone: "Asia/Hong_Kong",
  },
  workspace: {
    id: "workspace-hermes",
    name: "Hermes Development",
    slug: "hermes-dev",
    status: "active",
  },
  workspaceId: "workspace-hermes",
  workspaceRole: role,
};

const member = {
  account: user,
  membershipId: "membership-owner",
  removedAt: null,
  role,
  status: "active",
};

const contexts = [
  {
    membershipId: "platform-membership-owner",
    role: {
      displayName: "Platform Admin",
      id: "role-platform-admin",
      name: "platform-admin",
    },
    type: "platform",
  },
  {
    membershipId: "membership-owner",
    role: {
      displayName: role.displayName,
      id: role.id,
      name: role.name,
    },
    type: "workspace",
    workspace: {
      id: snapshot.workspace.id,
      name: snapshot.workspace.name,
      slug: snapshot.workspace.slug,
      subdomain: null,
    },
  },
];

const permissionCatalog = {
  scopes: [
    {
      entities: [
        {
          entity: "member",
          label: "成员",
          purposes: [
            {
              label: "工作空间成员",
              operations: [
                {
                  description: "查看工作空间成员",
                  isDangerous: false,
                  label: "查看成员",
                  operation: "list",
                  permission: "member.workspace_user.list:workspace",
                },
              ],
              purpose: "workspace_user",
            },
          ],
        },
      ],
      label: "工作空间",
      scope: "workspace",
    },
  ],
};

const snapshotResult = PrincipalSessionSchema.safeParse(snapshot);
assert.equal(
  snapshotResult.success,
  true,
  snapshotResult.success ? undefined : snapshotResult.error.message,
);
assertFixture(adminContracts.authContexts, contexts);
assertFixture(adminContracts.workspaceMembers, [member]);
assertFixture(adminContracts.workspaceRoles, [role]);
assertFixture(adminContracts.workspacePermissionCatalog, permissionCatalog);
assertFixture(adminContracts.workspaceSettings, []);

async function main() {
  const server = await ensureServer();
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await seedSession(page);
    await page.route("**/api/admin/**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname.replace(/^\/api\/admin/, "");
      if (path === "/auth/me") return json(route, snapshot);
      if (path === "/auth/contexts") return json(route, contexts);
      if (path === "/auth/csrf") {
        return json(route, { csrfToken: "e2e-csrf-token" });
      }
      if (path === "/workspace/members") return json(route, [member]);
      if (path === "/workspace/roles") return json(route, [role]);
      if (path === "/workspace/permissions/catalog") {
        return json(route, permissionCatalog);
      }
      if (path === "/workspace/settings") return json(route, []);
      return json(route, { message: `Unhandled e2e route: ${path}` }, 404);
    });

    await verifyPage(page, "/settings/workspace", ["工作空间", "管理成员"]);
    assert.equal(
      await page.getByLabel("工作空间名称").inputValue(),
      "Hermes Development",
    );
    await verifyPage(page, "/settings/workspace/members", [
      "成员",
      "owner@hermes.local",
    ]);
    await verifyPage(page, "/settings/workspace/access", [
      "角色和权限",
      "Workspace Owner",
    ]);

    console.log("web workspace convergence e2e passed");
  } finally {
    await browser.close();
    if (server.started) server.process?.kill();
  }
}

async function verifyPage(page, path, expectedTexts) {
  await page.goto(`${baseUrl}${path}`);
  for (const text of expectedTexts) {
    try {
      await page.waitForFunction(
        (expected) => document.body.innerText.includes(expected),
        text,
        { timeout: 10_000 },
      );
    } catch (error) {
      const currentBody = await page.locator("body").innerText();
      throw new Error(
        `${path} did not render ${JSON.stringify(text)}. Body: ${currentBody}`,
        { cause: error },
      );
    }
  }
  const body = await page.locator("body").innerText();
  assert.equal(body.includes("\u7ec4\u7ec7"), false, `${path} exposes a removed layer`);
  assert.equal(body.includes("\u79df\u6237"), false, `${path} exposes legacy terminology`);
}

function assertFixture(contract, value) {
  const schema = responseSchemaFor(contract, 200, true);
  assert.ok(schema, `${contract.id} does not declare a browser response schema`);
  const result = schema.safeParse(value);
  assert.equal(
    result.success,
    true,
    result.success ? undefined : `${contract.id}: ${result.error.message}`,
  );
}

async function seedSession(page) {
  await page.context().addCookies([
    {
      domain: new URL(baseUrl).hostname,
      expires: Math.floor(Date.now() / 1000) + 3600,
      httpOnly: true,
      name: webSessionCookieName,
      path: "/",
      sameSite: "Lax",
      secure: baseUrl.startsWith("https://"),
      value: "e2e-web-session",
    },
  ]);
}

async function json(route, body, status = 200) {
  await route.fulfill({
    body: status === 204 ? "" : JSON.stringify(body),
    headers: { "content-type": "application/json" },
    status,
  });
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
    if (await isServerReady()) return { process: child, started: true };
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

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
