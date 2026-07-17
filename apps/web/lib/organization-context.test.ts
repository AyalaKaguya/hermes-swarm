import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  organizationStorageKey,
  resolveInitialOrganizationSelection,
  storeOrganizationId,
} from "./organization-context";

const principal = {
  defaultOrganizationId: "org-1",
  memberships: [
    { organizationId: "org-1", status: "active" },
    { organizationId: "org-2", status: "active" },
  ],
  principalType: "tenant" as const,
  tenantId: "tenant-1",
  permissions: ["workspace.console.access:tenant"],
  tenantRole: { name: "tenant-owner" },
  user: { id: "user-1", tenantId: "tenant-1" },
};

describe("organization selection persistence", () => {
  it("restores the all-organizations selection for workspace governors", () => {
    const storage = createStorage();
    storeOrganizationId(storage, "tenant-1", "user-1", null);

    assert.equal(
      resolveInitialOrganizationSelection(principal, storage)?.activeOrganizationId,
      null,
    );
  });

  it("restores an active membership and rejects a stale stored organization", () => {
    const storage = createStorage();
    storeOrganizationId(storage, "tenant-1", "user-1", "org-2");
    assert.equal(
      resolveInitialOrganizationSelection(principal, storage)?.activeOrganizationId,
      "org-2",
    );

    storage.setItem(organizationStorageKey("tenant-1", "user-1"), "org-stale");
    assert.equal(
      resolveInitialOrganizationSelection(principal, storage)?.activeOrganizationId,
      "org-1",
    );
  });
});

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => {
      values.delete(key);
    },
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}
