import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  authLogin,
  createInvite,
  createIntegrationToken,
  createTenantRole,
  fetchMe,
  listInvites,
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
    globalThis.fetch = async (_input, init) => {
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
  });

  it("uses the workspace role library routes", async () => {
    const requests: Array<{ body: unknown; method: string; url: string }> = [];
    globalThis.fetch = async (input, init) => {
      requests.push({
        body: init?.body ? JSON.parse(String(init.body)) : null,
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
      { body: null, method: "GET", url: "/api/admin/roles" },
      {
        body: { displayName: "Workspace operator" },
        method: "POST",
        url: "/api/admin/roles",
      },
      {
        body: {
          permissions: [
            { enabled: true, permission: "organization.profile.view:organization" },
          ],
        },
        method: "PUT",
        url: "/api/admin/roles/role-1/permissions",
      },
    ]);
  });

  it("uses the personal API Token route without a user id or scope", async () => {
    let request: { body: unknown; url: string } | null = null;
    globalThis.fetch = async (input, init) => {
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
});
