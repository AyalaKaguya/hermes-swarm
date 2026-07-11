import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AccessCatalogService } from "./access-catalog.service.js";

describe("AccessCatalogService catalog sync", () => {
  it("removes stale controller and navigation permissions before rebuilding defaults", async () => {
    const deletedRolePermissions: unknown[] = [];
    const deletedPermissions: unknown[] = [];
    const savedPermissions: Array<{ code?: string | null }> = [];

    const service = new AccessCatalogService(
      { getControllers: () => [] } as any,
      {
        delete: async (where: unknown) => {
          deletedPermissions.push(where);
        },
        find: async (options?: { where?: Record<string, unknown> }) => {
          if (options?.where?.source) {
            return [
              {
                code: "old.controller.permission:platform",
                id: "permission-1",
                source: "controller",
              },
            ];
          }
          return [];
        },
        save: async (permission: { code?: string | null }) => {
          savedPermissions.push(permission);
          return permission;
        },
        create: (value: Record<string, unknown>) => ({ ...value }),
      } as any,
      { find: async () => [] } as any,
      {
        delete: async (where: unknown) => {
          deletedRolePermissions.push(where);
        },
        find: async () => [],
        save: async () => [],
        create: (value: Record<string, unknown>) => ({ ...value }),
      } as any,
      { find: async () => [] } as any,
      { find: async () => [], create: (value: unknown) => value, save: async () => [] } as any,
    );

    await service.onModuleInit();

    assert.equal(deletedRolePermissions.length, 1);
    assert.equal(deletedPermissions.length, 1);
    assert.ok(savedPermissions.some((permission) => permission.code?.startsWith("page.")));
  });
});
