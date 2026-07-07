import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";
import { PlatformRolesService } from "./platform-roles.service.js";

type PlatformRoleRecord = {
  color: string | null;
  description: string | null;
  displayName: string | null;
  id: string;
  isSystem: boolean;
  label: string;
  name: string;
  organizationId: null;
  rolePermissions: unknown[];
  scope: "platform";
};

describe("PlatformRolesService role protections", () => {
  it("rejects updating system platform roles", async () => {
    const role = systemPlatformRole();
    const state = createService({ role });

    await assert.rejects(
      () =>
        state.service.update(role.id, {
          displayName: "Platform Super Admin",
        }),
      BadRequestException,
    );

    assert.equal(state.savedRoles.length, 0);
  });

  it("rejects replacing permissions for system platform roles", async () => {
    const role = systemPlatformRole();
    const state = createService({ role });

    await assert.rejects(
      () =>
        state.service.replacePermissions(role.id, {
          permissions: [
            {
              enabled: true,
              permission: "setting.platform_config.save:platform",
            },
          ],
        }),
      BadRequestException,
    );

    assert.equal(state.deletedRolePermissionQueries.length, 0);
    assert.equal(state.savedRolePermissions.length, 0);
  });

  it("rejects deleting system platform roles", async () => {
    const role = systemPlatformRole();
    const state = createService({ role });

    await assert.rejects(
      () => state.service.remove(role.id),
      BadRequestException,
    );

    assert.equal(state.deletedRoleQueries.length, 0);
  });

  it("continues to replace permissions for custom platform roles", async () => {
    const role = customPlatformRole();
    const state = createService({ role });

    const result = await state.service.replacePermissions(role.id, {
      permissions: [
        {
          enabled: true,
          permission: "setting.platform_config.save:platform",
        },
        {
          enabled: false,
          permission: "role.platform_role.delete:platform",
        },
      ],
    });

    assert.deepEqual(state.deletedRolePermissionQueries, [{ roleId: role.id }]);
    assert.equal(state.savedRolePermissions.length, 1);
    assert.equal(
      state.savedRolePermissions[0].permission,
      "setting.platform_config.save:platform",
    );
    assert.equal(result.length, 1);
  });
});

function createService(options: { role: PlatformRoleRecord }) {
  const savedRoles: PlatformRoleRecord[] = [];
  const deletedRoleQueries: unknown[] = [];
  const deletedRolePermissionQueries: unknown[] = [];
  const savedRolePermissions: any[] = [];

  const service = new PlatformRolesService(
    {
      create(value: any) {
        return value;
      },
      async delete(query: unknown) {
        deletedRoleQueries.push(query);
      },
      async findOne({ where }: any) {
        return where.id === options.role.id && where.scope === "platform"
          ? options.role
          : null;
      },
      async save(role: PlatformRoleRecord) {
        savedRoles.push({ ...role });
        return role;
      },
    } as any,
    {
      create(value: any) {
        return value;
      },
      async delete(query: unknown) {
        deletedRolePermissionQueries.push(query);
      },
      async save(values: any[]) {
        savedRolePermissions.push(...values);
        return values;
      },
    } as any,
    {
      async findOne({ where }: any) {
        return where.code === "setting.platform_config.save:platform" &&
          where.scope === "platform"
          ? {
              code: where.code,
              id: "permission-1",
              scope: where.scope,
            }
          : null;
      },
    } as any,
  );

  return {
    deletedRolePermissionQueries,
    deletedRoleQueries,
    savedRolePermissions,
    savedRoles,
    service,
  };
}

function systemPlatformRole(): PlatformRoleRecord {
  return {
    color: "#7c3aed",
    description: "Platform administrator",
    displayName: "Platform Admin",
    id: "role-platform-admin",
    isSystem: true,
    label: "Platform Admin",
    name: "platform-admin",
    organizationId: null,
    rolePermissions: [],
    scope: "platform",
  };
}

function customPlatformRole(): PlatformRoleRecord {
  return {
    color: null,
    description: null,
    displayName: "Operator",
    id: "role-operator",
    isSystem: false,
    label: "Operator",
    name: "operator",
    organizationId: null,
    rolePermissions: [],
    scope: "platform",
  };
}
