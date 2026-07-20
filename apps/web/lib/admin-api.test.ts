import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  authLogin,
  createOrganizationMember,
  createInvite,
  createIntegrationToken,
  createTenantRole,
  fetchMe,
  listInvites,
  listLoginAuditLogs,
  listOperationAuditLogs,
  listOrganizationMemberCandidates,
  listUsers,
  listTenantRoles,
  replaceTenantRolePermissions,
  replaceUserTenantRoles,
  resolveTenantLoginContext,
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
  it("never sends client-selected tenant or organization scope headers", async () => {
    const requests: Headers[] = [];
    let csrfRequests = 0;
    globalThis.fetch = async (input, init) => {
      if (String(input) === "/api/admin/auth/csrf") {
        csrfRequests += 1;
        return Response.json({ csrfToken: "csrf-token" });
      }
      requests.push(new Headers(init?.headers));
      return Response.json({ memberships: [], permissions: [], user: {} });
    };

    await fetchMe();
    await authLogin({ email: "owner@example.com", password: "secret", tenantSlug: "acme" });
    await resolveTenantLoginContext("acme");

    for (const headers of requests) {
      assert.equal(headers.has("Tenant-Id"), false);
      assert.equal(headers.has("X-Scope-Level"), false);
      assert.equal(headers.has("Organization-Id"), false);
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
      return Response.json([]);
    };

    await listTenantRoles("web-session");
    await createTenantRole("web-session", {
      displayName: "Workspace operator",
    });
    await replaceTenantRolePermissions("web-session", "role-1", [
      { enabled: true, permission: "organization.profile.view:organization" },
    ]);

    assert.deepEqual(requests, [
      {
        body: null,
        csrfToken: null,
        method: "GET",
        url: "/api/admin/roles",
      },
      {
        body: { displayName: "Workspace operator" },
        csrfToken: "csrf-token",
        method: "POST",
        url: "/api/admin/roles",
      },
      {
        body: {
          permissions: [
            { enabled: true, permission: "organization.profile.view:organization" },
          ],
        },
        csrfToken: "csrf-token",
        method: "PUT",
        url: "/api/admin/roles/role-1/permissions",
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
      return Response.json({});
    };

    await createIntegrationToken("web-session", {
      permissions: ["ticket.conversation.list:tenant"],
    });

    assert.deepEqual(request, {
      body: {
        permissions: ["ticket.conversation.list:tenant"],
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
      return Response.json([]);
    };

    await listUsers("web-session");
    await replaceUserTenantRoles("web-session", "user-1", "role-1");
    await listInvites("web-session");
    await createInvite("web-session", {
      email: "member@example.com",
      organizations: [
        { isDefault: true, organizationId: "org-1", roleId: "role-2" },
      ],
      workspaceRoleId: "role-1",
    });

    assert.deepEqual(requests, [
      { body: null, method: "GET", url: "/api/admin/users" },
      {
        body: { roleId: "role-1" },
        method: "PUT",
        url: "/api/admin/users/user-1/role",
      },
      { body: null, method: "GET", url: "/api/admin/invites" },
      {
        body: {
          email: "member@example.com",
          organizations: [
            { isDefault: true, organizationId: "org-1", roleId: "role-2" },
          ],
          workspaceRoleId: "role-1",
        },
        method: "POST",
        url: "/api/admin/invites",
      },
    ]);
  });

  it("uses organization-scoped routes to list and add existing workspace users", async () => {
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
      return Response.json([]);
    };

    await listOrganizationMemberCandidates("web-session", "org-1");
    await createOrganizationMember("web-session", "org-1", {
      roleId: "role-1",
      userId: "user-1",
    });

    assert.deepEqual(requests, [
      {
        body: null,
        method: "GET",
        url: "/api/admin/organizations/org-1/members/candidates",
      },
      {
        body: { roleId: "role-1", userId: "user-1" },
        method: "POST",
        url: "/api/admin/organizations/org-1/members",
      },
    ]);
  });

  it("uses scope-specific audit routes with server-side filters", async () => {
    const requests: string[] = [];
    globalThis.fetch = async (input) => {
      requests.push(String(input));
      return Response.json({ items: [], page: 2, pageSize: 20, total: 0 });
    };

    await listLoginAuditLogs("web-session", "tenant", {
      keyword: "owner@example.com",
      page: 2,
      pageSize: 20,
      result: "failed",
    });
    await listOperationAuditLogs("web-session", "platform", {
      httpMethod: "PATCH",
      permission: "tenant.application.approve:platform",
    });

    assert.deepEqual(requests, [
      "/api/admin/tenant/audit/login-logs?keyword=owner%40example.com&page=2&pageSize=20&result=failed",
      "/api/admin/platform/audit/operation-logs?httpMethod=PATCH&permission=tenant.application.approve%3Aplatform",
    ]);
  });
});
