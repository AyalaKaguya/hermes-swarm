import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  authLogin,
  createInvite,
  createIntegrationToken,
  createWorkspaceRole,
  fetchMe,
  getPublicBootstrap,
  listInvites,
  listLoginAuditLogs,
  listOperationAuditLogs,
  listWorkspaceMembers,
  listWorkspaceRoles,
  replaceWorkspaceRolePermissions,
  replaceWorkspaceMemberRole,
  resolveWorkspaceLoginContext,
} from "./admin-api";

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;

beforeEach(() => {
  (globalThis as { window?: Partial<Window> }).window = {
    clearTimeout: globalThis.clearTimeout,
    setTimeout: globalThis.setTimeout,
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  (globalThis as { window?: Window }).window = originalWindow;
});

describe("admin API browser client", () => {
  it("never sends client-selected workspace scope headers", async () => {
    const requests: Headers[] = [];
    let csrfRequests = 0;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url === "/api/admin/auth/csrf") {
        csrfRequests += 1;
        return Response.json({ csrfToken: "csrf-token" });
      }
      requests.push(new Headers(init?.headers));
      if (url.endsWith("/auth/me")) return Response.json(workspacePrincipal());
      if (url.endsWith("/auth/login")) {
        return Response.json({
          contexts: [workspaceContextOption()],
          expiresAt: TEST_DATE,
          selectionToken: "selection-token",
          status: "context_selection_required",
        });
      }
      return Response.json({
        source: "workspace",
        workspace: { name: "Acme", slug: "acme" },
      });
    };

    await fetchMe();
    await authLogin({ email: "owner@example.com", password: "secret", workspaceSlug: "acme" });
    await resolveWorkspaceLoginContext("acme");

    for (const headers of requests) {
      assert.equal(headers.has("Workspace-Id"), false);
      assert.equal(headers.has("X-Scope-Level"), false);
      assert.equal(headers.has("Department-Id"), false);
      assert.equal(headers.has("Authorization"), false);
    }
    assert.equal(csrfRequests, 0);
  });

  it("uses the workspace role library routes", async () => {
    const requests: Array<{
      body: unknown;
      csrfToken: string | null;
      method: string;
      url: string;
    }> = [];
    globalThis.fetch = async (input, init) => {
      if (String(input) === "/api/admin/auth/csrf") {
        return Response.json({ csrfToken: "csrf-token" });
      }
      const headers = new Headers(init?.headers);
      requests.push({
        body: init?.body ? JSON.parse(String(init.body)) : null,
        csrfToken: headers.get("X-CSRF-Token"),
        method: init?.method ?? "GET",
        url: String(input),
      });
      return Response.json((init?.method ?? "GET") === "GET" ? [] : role());
    };

    await listWorkspaceRoles("web-session");
    await createWorkspaceRole("web-session", {
      displayName: "Workspace operator",
    });
    await replaceWorkspaceRolePermissions("web-session", "role-1", [
      { enabled: true, permission: "workspace.profile.view:workspace" },
    ]);

    assert.deepEqual(requests, [
      {
        body: null,
        csrfToken: null,
        method: "GET",
        url: "/api/admin/workspace/roles",
      },
      {
        body: { displayName: "Workspace operator" },
        csrfToken: "csrf-token",
        method: "POST",
        url: "/api/admin/workspace/roles",
      },
      {
        body: {
          permissions: [
            { enabled: true, permission: "workspace.profile.view:workspace" },
          ],
        },
        csrfToken: "csrf-token",
        method: "PUT",
        url: "/api/admin/workspace/roles/role-1/permissions",
      },
    ]);
  });

  it("uses the personal API Token route without a user id or scope", async () => {
    let request: { body: unknown; url: string } | null = null;
    globalThis.fetch = async (input, init) => {
      if (String(input) === "/api/admin/auth/csrf") {
        return Response.json({ csrfToken: "csrf-token" });
      }
      request = {
        body: init?.body ? JSON.parse(String(init.body)) : null,
        url: String(input),
      };
      return Response.json(integrationToken());
    };

    await createIntegrationToken("web-session", {
      permissions: ["ticket.conversation.list:workspace"],
    });

    assert.deepEqual(request, {
      body: {
        permissions: ["ticket.conversation.list:workspace"],
      },
      url: "/api/admin/account/integration-tokens",
    });
  });

  it("uses workspace-level user and invite routes", async () => {
    const requests: Array<{ body: unknown; method: string; url: string }> = [];
    globalThis.fetch = async (input, init) => {
      if (String(input) === "/api/admin/auth/csrf") {
        return Response.json({ csrfToken: "csrf-token" });
      }
      requests.push({
        body: init?.body ? JSON.parse(String(init.body)) : null,
        method: init?.method ?? "GET",
        url: String(input),
      });
      const url = String(input);
      if ((init?.method ?? "GET") === "GET") return Response.json([]);
      return Response.json(url.includes("/members/") ? workspaceMember() : invite());
    };

    await listWorkspaceMembers("web-session");
    await replaceWorkspaceMemberRole("web-session", "membership-1", "role-1");
    await listInvites("web-session");
    await createInvite("web-session", {
      email: "member@example.com",
      workspaceRoleId: "role-1",
    });

    assert.deepEqual(requests, [
      { body: null, method: "GET", url: "/api/admin/workspace/members" },
      {
        body: { roleId: "role-1" },
        method: "PUT",
        url: "/api/admin/workspace/members/membership-1/role",
      },
      { body: null, method: "GET", url: "/api/admin/invites" },
      {
        body: {
          email: "member@example.com",
          workspaceRoleId: "role-1",
        },
        method: "POST",
        url: "/api/admin/invites",
      },
    ]);
  });

  it("uses scope-specific audit routes with server-side filters", async () => {
    const requests: string[] = [];
    globalThis.fetch = async (input) => {
      requests.push(String(input));
      return Response.json({ items: [], page: 2, pageSize: 20, total: 0 });
    };

    await listLoginAuditLogs("web-session", "workspace", {
      keyword: "owner@example.com",
      page: 2,
      pageSize: 20,
      result: "failed",
    });
    await listOperationAuditLogs("web-session", "platform", {
      httpMethod: "PATCH",
      permission: "workspace.application.approve:platform",
    });

    assert.deepEqual(requests, [
      "/api/admin/workspace/audit/login-logs?keyword=owner%40example.com&page=2&pageSize=20&result=failed",
      "/api/admin/platform/audit/operation-logs?httpMethod=PATCH&permission=workspace.application.approve%3Aplatform",
    ]);
  });

  it("retries a transient public bootstrap failure without using a cached response", async () => {
    const requests: RequestInit[] = [];
    globalThis.fetch = async (_input, init) => {
      requests.push(init ?? {});
      if (requests.length === 1) {
        return Response.json({ message: "temporary failure" }, { status: 500 });
      }
      return Response.json({
        onboardingRequired: false,
        onboardingState: "complete",
        systemSettings: [],
      });
    };

    const bootstrap = await getPublicBootstrap();

    assert.equal(bootstrap.onboardingState, "complete");
    assert.equal(requests.length, 2);
    assert.equal(requests[0]?.cache, "no-store");
    assert.equal(requests[1]?.cache, "no-store");
  });
});

const TEST_DATE = "2026-07-21T00:00:00.000Z";

function role() {
  return {
    color: null,
    description: null,
    displayName: "Workspace owner",
    id: "role-1",
    isSystem: true,
    label: "Workspace owner",
    name: "workspace-owner",
    permissions: [],
    scope: "workspace",
    workspaceId: "workspace-1",
  };
}

function user() {
  return {
    avatarUrl: null,
    createdAt: TEST_DATE,
    displayName: "Owner",
    email: "owner@example.com",
    emailVerified: true,
    firstName: null,
    id: "account-1",
    imageUrl: null,
    lastName: null,
    mobile: null,
    nickname: null,
    preferredLanguage: null,
    status: "active",
    timeZone: null,
    type: "user",
    updatedAt: TEST_DATE,
    username: null,
    workspaceRole: role(),
  };
}

function workspace() {
  return { id: "workspace-1", name: "Acme", slug: "acme", status: "active" };
}

function workspaceContextOption() {
  return {
    membershipId: "membership-1",
    role: { displayName: "Workspace owner", id: "role-1", name: "workspace-owner" },
    type: "workspace",
    workspace: { id: "workspace-1", name: "Acme", slug: "acme", subdomain: null },
  };
}

function workspacePrincipal() {
  return {
    account: user(),
    context: { membershipId: "membership-1", type: "workspace", workspace: workspace() },
    membership: { id: "membership-1", role: role(), status: "active" },
    permissions: [],
    principalType: "workspace",
    role: role(),
    runtimePreferences: {
      currency: "CNY",
      dateFormat: "yyyy-MM-dd",
      language: "zh-Hans",
      regionCode: "CN",
      sources: { currency: "code", dateFormat: "code", language: "code", regionCode: "code", timeZone: "code" },
      timeZone: "Asia/Hong_Kong",
    },
    workspace: workspace(),
    workspaceId: "workspace-1",
    workspaceRole: role(),
  };
}

function integrationToken() {
  return {
    createdAt: TEST_DATE,
    expiresAt: TEST_DATE,
    id: "token-1",
    isExpired: false,
    lastUsedAt: null,
    note: null,
    permissions: ["ticket.conversation.list:workspace"],
    revokedAt: null,
    scope: "workspace",
    token: "secret-token",
    tokenPrefix: "secret",
    updatedAt: TEST_DATE,
    workspaceId: "workspace-1",
  };
}

function workspaceMember() {
  return {
    account: user(),
    membershipId: "membership-1",
    removedAt: null,
    role: role(),
    status: "active",
  };
}

function invite() {
  return {
    acceptedCount: 0,
    acceptedUserId: null,
    actionDate: null,
    closedAt: null,
    contextType: "workspace",
    createdAt: TEST_DATE,
    email: "member@example.com",
    expireDate: null,
    id: "invite-1",
    invitedById: null,
    roleId: "role-1",
    status: "invited",
    workspaceRoleId: "role-1",
  };
}
