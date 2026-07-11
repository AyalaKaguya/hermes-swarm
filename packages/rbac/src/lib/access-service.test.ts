import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AccessService } from "./access-service.js";
import type { ResolvedAccessDefinition } from "./access.types.js";

describe("AccessService hierarchical authorization", () => {
  it("allows platform permissions only through independent platform roles", async () => {
    const service = createService({
      platformRolePermissions: [
        {
          enabled: true,
          permission: { code: "tenant.application.approve:platform" },
          platformRoleId: "platform-role-1",
        },
      ],
      platformUserRoles: [
        { platformRoleId: "platform-role-1", platformUserId: "platform-user-1" },
      ],
    });
    const permission = definition(
      "tenant.application.approve:platform",
      "platform",
    );

    assert.equal(
      await service.can("platform-user-1", permission, {
        principalType: "platform",
        tenantId: null,
      }),
      true,
    );
    assert.equal(
      await service.can("platform-user-1", permission, {
        principalType: "tenant",
        tenantId: "tenant-1",
      }),
      false,
    );
  });

  it("unions tenant, organization and department roles at department scope", async () => {
    const permission = definition("ticket.dispatch.handle:department", "department");
    const service = createService({
      departmentMemberships: [
        {
          departmentId: "dept-1",
          id: "user-dept-1",
          membershipId: "membership-1",
          status: "active",
          tenantId: "tenant-1",
        },
      ],
      departmentRoles: [
        {
          role: { scope: "department" },
          roleId: "role-department",
          tenantId: "tenant-1",
          userDepartmentId: "user-dept-1",
        },
      ],
      memberships: [
        {
          id: "membership-1",
          organizationId: "org-1",
          roleId: null,
          status: "active",
          tenantId: "tenant-1",
          userId: "user-1",
        },
      ],
      rolePermissions: [
        {
          enabled: true,
          permission: permission.id,
          roleId: "role-department",
          tenantId: "tenant-1",
        },
      ],
    });

    assert.equal(
      await service.can("user-1", permission, {
        departmentId: "dept-1",
        organizationId: "org-1",
        principalType: "tenant",
        tenantId: "tenant-1",
      }),
      true,
    );
  });

  it("rejects an organization outside the tenant user's memberships", async () => {
    const permission = definition("ticket.list:organization", "organization");
    const service = createService({
      memberships: [
        {
          id: "membership-1",
          organizationId: "org-1",
          roleId: "role-org",
          status: "active",
          tenantId: "tenant-1",
          userId: "user-1",
        },
      ],
      rolePermissions: [
        {
          enabled: true,
          permission: permission.id,
          roleId: "role-org",
          tenantId: "tenant-1",
        },
      ],
    });

    assert.equal(
      await service.can("user-1", permission, {
        organizationId: "org-2",
        principalType: "tenant",
        tenantId: "tenant-1",
      }),
      false,
    );
  });

  it("requires a matching target and a tenant role for own scope", async () => {
    const permission = definition("user.profile.update:own", "own");
    const service = createService({
      rolePermissions: [
        {
          enabled: true,
          permission: permission.id,
          roleId: "role-tenant",
          tenantId: "tenant-1",
        },
      ],
      tenantRoles: [
        {
          role: { scope: "tenant" },
          roleId: "role-tenant",
          tenantId: "tenant-1",
          userId: "user-1",
        },
      ],
    });

    assert.equal(
      await service.can("user-1", permission, {
        principalType: "tenant",
        targetUserId: "user-1",
        tenantId: "tenant-1",
      }),
      true,
    );
    assert.equal(
      await service.can("user-1", permission, {
        principalType: "tenant",
        targetUserId: "user-2",
        tenantId: "tenant-1",
      }),
      false,
    );
  });
});

function createService(options: Record<string, any[]> = {}) {
  const repositories = {
    RolePermission: repository(options.rolePermissions ?? []),
    UserDepartment: repository(options.departmentMemberships ?? []),
    UserDepartmentRole: repository(options.departmentRoles ?? []),
    UserOrganization: repository(options.memberships ?? []),
    UserOrganizationRole: repository(options.organizationRoles ?? []),
    UserTenantRole: repository(options.tenantRoles ?? []),
  } as Record<string, any>;
  return new AccessService(
    repository(options.platformUserRoles ?? []),
    repository(options.platformRolePermissions ?? []),
    repositories.UserTenantRole,
    repositories.UserOrganization,
    repositories.UserOrganizationRole,
    repositories.UserDepartment,
    repositories.UserDepartmentRole,
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
