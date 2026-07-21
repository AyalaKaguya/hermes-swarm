import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";
import { PlatformRolesService } from "./platform-roles.service.js";

describe("PlatformRolesService unified roles", () => {
  it("creates a platform-scoped role in the unified role repository", async () => {
    const saved: any[] = [];
    const service = createService({
      roleRepository: repository([], saved),
    });

    const role = await service.create({ displayName: "Support Ops" });

    assert.equal(role.scope, "platform");
    assert.equal(saved[0]?.name, "support-ops");
    assert.equal(saved[0]?.workspaceId, null);
  });

  it("keeps the system platform-admin role immutable", async () => {
    const service = createService({
      roleRepository: repository([
        {
          id: "role-admin",
          isSystem: true,
          label: "Platform Admin",
          name: "platform-admin",
          rolePermissions: [],
          scope: "platform",
          workspaceId: null,
        },
      ]),
    });

    await assert.rejects(
      () => service.remove("role-admin"),
      BadRequestException,
    );
  });

  it("replaces permissions through RolePermission", async () => {
    const deleted: unknown[] = [];
    const saved: any[] = [];
    const role = {
      id: "role-1",
      isSystem: false,
      label: "Support",
      name: "support",
      rolePermissions: [],
      scope: "platform",
      workspaceId: null,
    };
    const service = createService({
      permissionRepository: repository([
        { code: "workspace.application.approve:platform", id: "permission-1", scope: "platform" },
      ]),
      rolePermissionRepository: {
        create: (value: any) => value,
        manager: {
          transaction: async (work: any) =>
            work({
              create: (_target: unknown, value: any) => value,
              delete: async (...args: unknown[]) => deleted.push(args),
              save: async (_target: unknown, rows: any[]) => {
                saved.push(...rows);
                return rows;
              },
            }),
        },
      },
      roleRepository: repository([role]),
    });

    await service.replacePermissions("role-1", {
      permissions: [
        { enabled: true, permission: "workspace.application.approve:platform" },
      ],
    });

    assert.equal(deleted.length, 1);
    assert.deepEqual(saved[0], {
      enabled: true,
      permissionId: "permission-1",
      roleId: "role-1",
    });
  });
});

function createService(options: {
  permissionRepository?: any;
  rolePermissionRepository?: any;
  roleRepository?: any;
}) {
  return new PlatformRolesService(
    options.roleRepository ?? repository([]),
    options.rolePermissionRepository ?? {
      manager: { transaction: async (work: any) => work({}) },
    },
    options.permissionRepository ?? repository([]),
  );
}

function repository(items: any[], saved: any[] = []) {
  return {
    create: (value: any) => value,
    find: async () => items,
    findOne: async ({ where }: any) =>
      items.find((item) =>
        Object.entries(where).every(([key, value]) =>
          key === "workspaceId" && typeof value === "object"
            ? item[key] == null
            : item[key] === value,
        ),
      ) ?? null,
    manager: { transaction: async (work: any) => work({}) },
    save: async (value: any) => {
      const result = { id: value.id ?? `role-${saved.length + 1}`, ...value };
      saved.push(result);
      return result;
    },
  };
}
