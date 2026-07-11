import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildRequestScopeHeaders,
  commitRequestScope,
  getRequestScopeSignal,
  isRequestScopeAllowed,
  requestScopeStorageKey,
  resolveInitialRequestScope,
  storeRequestScope,
} from "./request-scope";

const principal = {
  allowedScopes: ["tenant", "organization", "department"] as const,
  defaultScope: {
    level: "organization" as const,
    organizationId: "org-a",
  },
  departmentMemberships: [
    {
      departmentId: "dept-a",
      organizationId: "org-a",
      status: "active",
      tenantId: "tenant-a",
    },
  ],
  memberships: [
    { organizationId: "org-a", status: "active" },
    { organizationId: "org-disabled", status: "disabled" },
  ],
  tenantId: "tenant-a",
  user: { id: "user-a" },
};

describe("request scope", () => {
  it("builds scope headers without exposing tenant ids", () => {
    assert.deepEqual(
      buildRequestScopeHeaders({
        departmentId: "dept-a",
        level: "department",
        organizationId: "org-a",
        tenantId: "tenant-a",
      }),
      {
        "Department-Id": "dept-a",
        "Organization-Id": "org-a",
        "X-Scope-Level": "department",
      },
    );
  });

  it("restores only a valid scope stored for the same tenant and user", () => {
    const storage = createStorage();
    storeRequestScope(storage, "user-a", {
      departmentId: "dept-a",
      level: "department",
      organizationId: "org-a",
      tenantId: "tenant-a",
    });

    const scope = resolveInitialRequestScope(principal, storage);
    assert.equal(scope?.level, "department");
    assert.equal(scope?.departmentId, "dept-a");
    assert.equal(
      storage.getItem(requestScopeStorageKey("tenant-a", "user-a")) !== null,
      true,
    );
  });

  it("falls back to the server default when persisted membership is stale", () => {
    const storage = createStorage();
    storage.setItem(
      requestScopeStorageKey("tenant-a", "user-a"),
      JSON.stringify({
        departmentId: null,
        level: "organization",
        organizationId: "org-removed",
        tenantId: "tenant-a",
      }),
    );

    const scope = resolveInitialRequestScope(principal, storage);
    assert.equal(scope?.level, "organization");
    assert.equal(scope?.organizationId, "org-a");
  });

  it("rejects disabled, cross-organization, and cross-tenant selections", () => {
    assert.equal(
      isRequestScopeAllowed(
        {
          departmentId: null,
          level: "organization",
          organizationId: "org-disabled",
          tenantId: "tenant-a",
        },
        principal,
      ),
      false,
    );
    assert.equal(
      isRequestScopeAllowed(
        {
          departmentId: "dept-a",
          level: "department",
          organizationId: "org-b",
          tenantId: "tenant-a",
        },
        principal,
      ),
      false,
    );
    assert.equal(
      isRequestScopeAllowed(
        {
          departmentId: null,
          level: "tenant",
          organizationId: null,
          tenantId: "tenant-b",
        },
        principal,
      ),
      false,
    );
  });

  it("aborts in-flight work before publishing the next epoch", () => {
    commitRequestScope({
      departmentId: null,
      level: "organization",
      organizationId: "org-a",
      tenantId: "tenant-a",
    });
    const oldSignal = getRequestScopeSignal();
    const next = commitRequestScope({
      departmentId: "dept-a",
      level: "department",
      organizationId: "org-a",
      tenantId: "tenant-a",
    });

    assert.equal(oldSignal.aborted, true);
    assert.equal(next?.epoch, 2);
    assert.equal(getRequestScopeSignal().aborted, false);
  });
});

function createStorage(): Storage {
  const values = new Map<string, string>();
  return {
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}
