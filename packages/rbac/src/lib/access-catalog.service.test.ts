import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AccessCatalogService,
  resolveAccessDefinition,
} from "./access-catalog.service.js";

describe("AccessCatalogService catalog sync", () => {
  it("assigns workspace fallback operations to workspace roles", () => {
    const definition = resolveAccessDefinition(
      {
        entity: "user",
        entityLabel: "成员",
        purpose: "workspace_user",
        purposeLabel: "工作空间成员",
        scope: "workspace",
      },
      {
        label: "查看用户列表",
        operation: "list",
      },
    );

    assert.deepEqual(definition?.defaultRoles, [
      "workspace-owner",
      "workspace-admin",
    ]);
  });

  it("assigns own-resource operations only to workspace roles", () => {
    const definition = resolveAccessDefinition(
      {
        entity: "ticket",
        entityLabel: "工单",
        purpose: "conversation",
        purposeLabel: "工单会话",
        scope: "workspace",
      },
      {
        label: "查看工单消息",
        operation: "list_messages",
        scope: "own",
      },
    );

    assert.ok(definition?.defaultRoles.includes("workspace-owner"));
    assert.ok(definition?.defaultRoles.includes("workspace-member"));
    assert.equal(definition?.defaultRoles.includes("owner"), false);
    assert.equal(definition?.defaultRoles.includes("member"), false);
  });

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
        upsert: async (permissions: Array<{ code?: string | null }>) => {
          savedPermissions.push(...permissions);
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
