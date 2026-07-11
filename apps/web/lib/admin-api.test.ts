import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  authLogin,
  cancelTenantApplication,
  createDepartmentIntegrationToken,
  createDepartmentDispatchRelation,
  createIntegrationToken,
  deleteManagedUser,
  fetchMe,
  listDepartmentIntegrationTokens,
  listDepartments,
  listPlatformTenants,
  previewEmailTemplate,
  platformAuthLogin,
  submitTenantApplication,
  verifyTenantApplication,
  updatePlatformTenantStatus,
  updateManagedUser,
} from "./admin-api";
import {
  getAuthenticatedAdminSessionMarker,
  requireAuthenticatedAdminSessionMarker,
} from "./authenticated-admin";
import { clearStoredSession, getStoredSession } from "./session";
import { commitRequestScope } from "./request-scope";

const originalWindow = globalThis.window;
const originalFetch = globalThis.fetch;

afterEach(() => {
  commitRequestScope(null);
  (globalThis as { fetch?: typeof fetch }).fetch = originalFetch;
  (globalThis as { window?: Window }).window = originalWindow;
});

describe("admin API browser auth client", () => {
  it("returns only a non-secret web session marker", async () => {
    assert.equal(await getAuthenticatedAdminSessionMarker(), "web-session");
    assert.equal(await requireAuthenticatedAdminSessionMarker(), "web-session");
  });

  it("removes legacy localStorage access tokens", () => {
    const storage = createLocalStorage();
    installWindow(storage);
    storage.setItem(
      "hermes-swarm.admin-session",
      JSON.stringify({
        accessToken: "legacy-token",
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
        sessionId: "session-1",
      }),
    );

    assert.equal(getStoredSession(), null);
    assert.equal(storage.getItem("hermes-swarm.admin-session"), null);
  });

  it("does not send browser Authorization headers", async () => {
    installWindow(createLocalStorage());
    globalThis.fetch = async (_input, init) => {
      const headers = new Headers(init?.headers);
      assert.equal(headers.has("Authorization"), false);
      return Response.json({ memberships: [], permissions: [], user: {} });
    };

    await fetchMe();
  });

  it("adds the active organization and department scope only to authenticated requests", async () => {
    installWindow(createLocalStorage());
    commitRequestScope({
      departmentId: "dept-1",
      level: "department",
      organizationId: "org-1",
      tenantId: "tenant-1",
    });
    const requests: Array<{ headers: Headers; url: string }> = [];
    globalThis.fetch = async (input, init) => {
      requests.push({ headers: new Headers(init?.headers), url: String(input) });
      return Response.json({ memberships: [], permissions: [], user: {} });
    };

    await fetchMe();
    await authLogin({ email: "owner@example.com", password: "secret" });

    assert.equal(requests[0].headers.get("X-Scope-Level"), "department");
    assert.equal(requests[0].headers.get("Organization-Id"), "org-1");
    assert.equal(requests[0].headers.get("Department-Id"), "dept-1");
    assert.equal(requests[0].headers.has("Tenant-Id"), false);
    assert.equal(requests[1].headers.has("X-Scope-Level"), false);
    assert.equal(requests[1].headers.has("Organization-Id"), false);
    assert.equal(requests[1].headers.has("Department-Id"), false);
  });

  it("keeps platform login and tenant application flows outside tenant scope", async () => {
    installWindow(createLocalStorage());
    commitRequestScope({
      departmentId: "dept-1",
      level: "department",
      organizationId: "org-1",
      tenantId: "tenant-1",
    });
    const requests: Array<{ headers: Headers; url: string }> = [];
    globalThis.fetch = async (input, init) => {
      requests.push({ headers: new Headers(init?.headers), url: String(input) });
      return Response.json({});
    };

    await platformAuthLogin({ email: "operator@example.com", password: "secret" });
    await submitTenantApplication({
      ownerDisplayName: "Alice",
      ownerEmail: "alice@example.com",
      requestedName: "North Region",
      requestedSlug: "north-region",
    });
    await verifyTenantApplication("application-1", "verify-token");
    await cancelTenantApplication("application-1", "cancel-token");
    await listPlatformTenants("web-session");
    await updatePlatformTenantStatus("web-session", "tenant-1", "suspended");

    assert.deepEqual(
      requests.map(({ url }) => url),
      [
        "/api/admin/platform/auth/login",
        "/api/admin/tenant-applications",
        "/api/admin/tenant-applications/application-1/verify",
        "/api/admin/tenant-applications/application-1/cancel",
        "/api/admin/platform/tenants",
        "/api/admin/platform/tenants/tenant-1/status",
      ],
    );
    for (const { headers } of requests) {
      assert.equal(headers.has("X-Scope-Level"), false);
      assert.equal(headers.has("Organization-Id"), false);
      assert.equal(headers.has("Department-Id"), false);
    }
  });

  it("routes email template previews to platform and organization APIs", async () => {
    installWindow(createLocalStorage());
    const requests: Array<{ body: unknown; method: string; url: string }> = [];
    globalThis.fetch = async (input, init) => {
      requests.push({
        body: init?.body ? JSON.parse(String(init.body)) : null,
        method: init?.method ?? "GET",
        url: String(input),
      });
      return Response.json({ html: "<p>Preview</p>", subject: "Preview" });
    };

    await previewEmailTemplate(
      "web-session",
      { hbs: "<p>{{name}}</p>", subject: "Hello {{name}}" },
      "org-1",
    );
    await previewEmailTemplate("web-session", { hbs: "<p>Platform</p>" });

    assert.deepEqual(
      requests.map(({ method, url }) => ({ method, url })),
      [
        {
          method: "POST",
          url: "/api/admin/organizations/org-1/mail/templates/preview",
        },
        {
          method: "POST",
          url: "/api/admin/platform/mail/templates/preview",
        },
      ],
    );
    assert.deepEqual(requests[0].body, {
      hbs: "<p>{{name}}</p>",
      subject: "Hello {{name}}",
    });
  });

  it("uses organization-nested department management routes", async () => {
    installWindow(createLocalStorage());
    const requests: Array<{ method: string; url: string }> = [];
    globalThis.fetch = async (input, init) => {
      requests.push({ method: init?.method ?? "GET", url: String(input) });
      return Response.json([]);
    };

    await listDepartments("web-session", "org-1");
    await createDepartmentDispatchRelation("web-session", "org-1", {
      sourceDepartmentId: "department-a",
      targetDepartmentId: "department-b",
      type: "handoff",
    });

    assert.deepEqual(requests, [
      { method: "GET", url: "/api/admin/organizations/org-1/departments" },
      {
        method: "POST",
        url: "/api/admin/organizations/org-1/departments/department-a/dispatch-relations",
      },
    ]);
  });

  it("uses tenant, organization, and department integration token contracts", async () => {
    installWindow(createLocalStorage());
    const requests: Array<{ body: unknown; method: string; url: string }> = [];
    globalThis.fetch = async (input, init) => {
      requests.push({
        body: init?.body ? JSON.parse(String(init.body)) : null,
        method: init?.method ?? "GET",
        url: String(input),
      });
      return Response.json([]);
    };

    await createIntegrationToken("web-session", "user-1", {
      permissions: ["ticket.tenant_conversation.list_tenant:tenant"],
      scope: "tenant",
    });
    await listDepartmentIntegrationTokens(
      "web-session",
      "org-1",
      "department-1",
    );
    await createDepartmentIntegrationToken(
      "web-session",
      "org-1",
      "department-1",
      { permissions: ["ticket.department_queue.list:department"] },
    );

    assert.deepEqual(requests, [
      {
        body: {
          permissions: ["ticket.tenant_conversation.list_tenant:tenant"],
          scope: "tenant",
        },
        method: "POST",
        url: "/api/admin/users/user-1/integration-tokens",
      },
      {
        body: null,
        method: "GET",
        url: "/api/admin/organizations/org-1/departments/department-1/integration-tokens",
      },
      {
        body: { permissions: ["ticket.department_queue.list:department"] },
        method: "POST",
        url: "/api/admin/organizations/org-1/departments/department-1/integration-tokens",
      },
    ]);
  });

  it("uses tenant-owned user management routes", async () => {
    installWindow(createLocalStorage());
    const requests: Array<{ method: string; url: string }> = [];
    globalThis.fetch = async (input, init) => {
      requests.push({ method: init?.method ?? "GET", url: String(input) });
      return Response.json({});
    };

    await updateManagedUser("web-session", "user-1", { displayName: "Alice" });
    await deleteManagedUser("web-session", "user-1");

    assert.deepEqual(requests, [
      { method: "PATCH", url: "/api/admin/users/tenant/user-1" },
      { method: "DELETE", url: "/api/admin/users/tenant/user-1" },
    ]);
  });

  it("clears legacy session storage explicitly", () => {
    const storage = createLocalStorage();
    installWindow(storage);
    storage.setItem("hermes-swarm.admin-session", "{}");
    clearStoredSession();
    assert.equal(storage.getItem("hermes-swarm.admin-session"), null);
  });
});

function installWindow(localStorage: Storage) {
  (globalThis as { window?: Partial<Window> }).window = {
    clearTimeout: globalThis.clearTimeout,
    localStorage,
    setTimeout: globalThis.setTimeout,
  };
}

function createLocalStorage(): Storage {
  const store = new Map<string, string>();
  return {
    clear: () => store.clear(),
    getItem: (key) => store.get(key) ?? null,
    key: (index) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
    removeItem: (key) => {
      store.delete(key);
    },
    setItem: (key, value) => {
      store.set(key, value);
    },
  };
}
