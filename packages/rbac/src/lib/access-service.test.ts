import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AccessService } from "./access-service.js";
import type { ResolvedAccessDefinition } from "./access.types.js";

describe("AccessService unified role authorization", () => {
  it("allows platform permissions only through a platform membership", async () => {
    const service = createService({
      rolePermissions: [
        {
          enabled: true,
          permissionRecord: { code: "workspace.application.approve:platform" },
          roleId: "platform-role-1",
        },
      ],
      platformMemberships: [
        {
          accountId: "account-1",
          role: { scope: "platform" },
          roleId: "platform-role-1",
          status: "active",
        },
      ],
    });
    const permission = definition(
      "workspace.application.approve:platform",
      "platform",
    );

    assert.equal(
      await service.can("account-1", permission, {
        principalType: "platform",
        workspaceId: null,
      }),
      true,
    );
    assert.equal(
      await service.can("account-1", permission, {
        principalType: "workspace",
        workspaceId: "workspace-1",
      }),
      false,
    );
  });

  it("uses the member's single workspace role at workspace scope", async () => {
    const permission = definition(
      "ticket.conversation.handle:workspace",
      "workspace",
    );
    const service = createService({
      rolePermissions: [
        {
          enabled: true,
          permissionRecord: { code: permission.id },
          roleId: "role-workspace",
          role: { scope: "workspace", workspaceId: "workspace-1" },
        },
      ],
      workspaceRoles: [
        {
          role: { scope: "workspace" },
          accountId: "user-1",
          roleId: "role-workspace",
          status: "active",
          workspaceId: "workspace-1",
        },
      ],
    });

    assert.equal(
      await service.can("user-1", permission, {
        principalType: "workspace",
        workspaceId: "workspace-1",
      }),
      true,
    );
    assert.equal(
      await service.can("user-1", permission, {
        principalType: "workspace",
        workspaceId: "workspace-2",
      }),
      false,
    );
  });

  it("requires a matching target and a workspace role for own scope", async () => {
    const permission = definition("user.profile.update:own", "own");
    const service = createService({
      rolePermissions: [
        {
          enabled: true,
          permissionRecord: { code: permission.id },
          roleId: "role-workspace",
          role: { scope: "workspace", workspaceId: "workspace-1" },
        },
      ],
      workspaceRoles: [
        {
          role: { scope: "workspace" },
          accountId: "user-1",
          roleId: "role-workspace",
          status: "active",
          workspaceId: "workspace-1",
        },
      ],
    });

    assert.equal(
      await service.can("user-1", permission, {
        principalType: "workspace",
        targetUserId: "user-1",
        workspaceId: "workspace-1",
      }),
      true,
    );
    assert.equal(
      await service.can("user-1", permission, {
        principalType: "workspace",
        targetUserId: "user-2",
        workspaceId: "workspace-1",
      }),
      false,
    );
  });
});

function createService(options: Record<string, any[]> = {}) {
  const repositories = {
    RolePermission: repository(options.rolePermissions ?? []),
    WorkspaceMembership: repository(options.workspaceRoles ?? []),
  } as Record<string, any>;
  return new AccessService(
    repository(options.platformMemberships ?? []),
    repositories.RolePermission,
    repositories.WorkspaceMembership,
    repositories.RolePermission,
    {
      transaction: async (work: any) =>
        work({
          getRepository: (target: { name: string }) => repositories[target.name],
          query: async () => [],
        }),
    } as any,
  );
}

function repository(items: any[]) {
  return {
    find: async ({ where }: any) => items.filter((item) => matches(item, where)),
    findOne: async ({ where }: any) =>
      items.find((item) => matches(item, where)) ?? null,
  } as any;
}

function matches(item: any, where: Record<string, any>) {
  return Object.entries(where).every(([key, expected]) => {
    const actual = item[key];
    if (expected && typeof expected === "object" && "_type" in expected) {
      const values = expected._value ?? expected.value;
      return Array.isArray(values) && values.includes(actual);
    }
    if (expected && typeof expected === "object" && !Array.isArray(expected)) {
      return matches(actual ?? {}, expected);
    }
    return actual === expected;
  });
}

function definition(
  id: string,
  scope: ResolvedAccessDefinition["scope"],
): ResolvedAccessDefinition {
  return {
    defaultRoles: [],
    description: "",
    entity: "test",
    entityLabel: "Test",
    id,
    isDangerous: false,
    operation: "test",
    operationLabel: "Test",
    operationOrder: null,
    purpose: "test",
    purposeLabel: "Test",
    scope,
  };
}
