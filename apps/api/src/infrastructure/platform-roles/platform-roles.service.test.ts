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
  it("maps concurrent platform role name uniqueness failures during create", async () => {
    const role = customPlatformRole();
    const state = createService({ failRoleSaveWithUniqueError: true, role });

    await assert.rejects(
      () =>
        state.service.create({
          displayName: "Operator",
          name: "operator",
        }),
      BadRequestException,
    );
  });

  it("maps concurrent platform role name uniqueness failures during update", async () => {
    const role = customPlatformRole();
    const state = createService({ failRoleSaveWithUniqueError: true, role });

    await assert.rejects(
      () =>
        state.service.update(role.id, {
          name: "renamed-operator",
        }),
      BadRequestException,
    );
  });

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

  it("clears platform member role references and permissions when deleting a custom role", async () => {
    const role = customPlatformRole();
    const state = createService({
      platformRoleUserIds: ["user-with-platform-role"],
      role,
    });

    await state.service.remove(role.id);

    assert.deepEqual(state.updatedPlatformMemberQueries, [
      {
        query: { roleId: role.id },
        target: "PlatformMember",
        value: { roleId: null },
      },
    ]);
    assert.deepEqual(state.deletedRolePermissionQueries, [{ roleId: role.id }]);
    assert.deepEqual(state.deletedRoleQueries, [{ id: role.id }]);
    assert.equal(state.revokedIntegrationTokenUpdates.length, 1);
    assert.deepEqual(
      getFindOperatorValues(
        state.revokedIntegrationTokenUpdates[0].query.ownerUserId,
      ),
      ["user-with-platform-role"],
    );
  });

  it("continues to replace permissions for custom platform roles", async () => {
    const role = customPlatformRole();
    const state = createService({
      platformRoleUserIds: ["user-with-platform-role"],
      role,
    });

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
    assert.equal(state.revokedIntegrationTokenUpdates.length, 1);
    assert.deepEqual(
      getFindOperatorValues(
        state.revokedIntegrationTokenUpdates[0].query.ownerUserId,
      ),
      ["user-with-platform-role"],
    );
    assert.equal(result.length, 1);
  });

  it("rejects malformed platform role payloads with controlled errors", async () => {
    const role = customPlatformRole();
    const state = createService({ role });

    await assert.rejects(() => state.service.create(null as any), BadRequestException);
    await assert.rejects(
      () => state.service.create({ displayName: 42 as any }),
      BadRequestException,
    );
    await assert.rejects(
      () => state.service.update(role.id, { color: false as any }),
      BadRequestException,
    );

    assert.equal(state.savedRoles.length, 0);
  });

  it("rejects malformed platform role permission payloads before clearing permissions", async () => {
    const role = customPlatformRole();
    const state = createService({ role });

    await assert.rejects(
      () => state.service.replacePermissions(role.id, null as any),
      BadRequestException,
    );
    await assert.rejects(
      () =>
        state.service.replacePermissions(role.id, {
          permissions: "all" as any,
        }),
      BadRequestException,
    );
    await assert.rejects(
      () =>
        state.service.replacePermissions(role.id, {
          permissions: [{ enabled: true } as any],
        }),
      BadRequestException,
    );

    assert.equal(state.deletedRolePermissionQueries.length, 0);
    assert.equal(state.savedRolePermissions.length, 0);
    assert.equal(state.revokedIntegrationTokenUpdates.length, 0);
  });

  it("does not clear existing permissions when a requested platform permission is missing", async () => {
    const role = customPlatformRole();
    const state = createService({ role });

    await assert.rejects(
      () =>
        state.service.replacePermissions(role.id, {
          permissions: [
            {
              enabled: true,
              permission: "missing.permission:platform",
            },
          ],
        }),
      BadRequestException,
    );

    assert.equal(state.deletedRolePermissionQueries.length, 0);
    assert.equal(state.savedRolePermissions.length, 0);
  });
});

function createService(options: {
  failRoleSaveWithUniqueError?: boolean;
  platformRoleUserIds?: string[];
  role: PlatformRoleRecord;
}) {
  const savedRoles: PlatformRoleRecord[] = [];
  const deletedRoleQueries: unknown[] = [];
  const deletedRolePermissionQueries: unknown[] = [];
  const savedRolePermissions: any[] = [];
  const revokedIntegrationTokenUpdates: any[] = [];
  const updatedPlatformMemberQueries: unknown[] = [];

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
      manager: {
        async transaction(callback: (manager: any) => Promise<unknown>) {
          return callback({
            async delete(target: { name?: string }, query: unknown) {
              if (target.name === "RolePermission") {
                deletedRolePermissionQueries.push(query);
                return;
              }
              if (target.name === "Role") {
                deletedRoleQueries.push(query);
              }
            },
            async update(
              target: { name?: string },
              query: unknown,
              value: unknown,
            ) {
              if (target.name === "IntegrationToken") {
                revokedIntegrationTokenUpdates.push({ query, value });
              } else {
                updatedPlatformMemberQueries.push({
                  query,
                  target: target.name,
                  value,
                });
              }
            },
            async find(target: { name?: string }) {
              if (target.name === "PlatformMember") {
                return (options.platformRoleUserIds ?? []).map((userId) => ({
                  userId,
                }));
              }
              return [];
            },
          });
        },
      },
      async save(role: PlatformRoleRecord) {
        if (options.failRoleSaveWithUniqueError) {
          throw { driverError: { code: "23505" } };
        }
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
      manager: {
        async transaction(callback: (manager: any) => Promise<unknown>) {
          return callback({
            async delete(_target: unknown, query: unknown) {
              deletedRolePermissionQueries.push(query);
            },
            async find(target: { name?: string }) {
              if (target.name === "PlatformMember") {
                return (options.platformRoleUserIds ?? []).map((userId) => ({
                  userId,
                }));
              }
              return [];
            },
            async save(_target: unknown, values: any[]) {
              savedRolePermissions.push(...values);
              return values;
            },
            async update(target: { name?: string }, query: unknown, value: unknown) {
              if (target.name === "IntegrationToken") {
                revokedIntegrationTokenUpdates.push({ query, value });
              }
            },
          });
        },
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
    revokedIntegrationTokenUpdates,
    service,
    updatedPlatformMemberQueries,
  };
}

function getFindOperatorValues(value: unknown) {
  const typed = value as { _value?: unknown };
  return Array.isArray(typed._value) ? typed._value : [];
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
