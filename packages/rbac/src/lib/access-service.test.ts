import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AccessService } from "./access-service.js";
import type { ResolvedAccessDefinition } from "./access.types.js";

type RepositoryMock<T> = {
  find: (options: { where: Partial<T> }) => Promise<T[]>;
  findOne: (options: { where: Partial<T> }) => Promise<T | null>;
};

type PlatformMemberRecord = {
  roleId: string;
  status: string;
  userId: string;
};

type MembershipRecord = {
  organizationId: string;
  roleId: string;
  status: string;
  userId: string;
};

type RolePermissionRecord = {
  enabled: boolean;
  permission: string;
  roleId: string;
};

const platformListOrganizations = definition(
  "organization.platform_organization.list:platform",
  "platform",
);
const organizationViewProfile = definition(
  "organization.profile.view:organization",
  "organization",
);
const selfUpdateProfile = definition("user.self_profile.update_profile:own", "own");

describe("AccessService authorization matrix", () => {
  it("denies platform APIs to ordinary users with no platform membership", async () => {
    const service = createService({
      memberships: [
        {
          organizationId: "org-1",
          roleId: "role-member",
          status: "active",
          userId: "user-1",
        },
      ],
      rolePermissions: [
        {
          enabled: true,
          permission: organizationViewProfile.id,
          roleId: "role-member",
        },
      ],
    });

    assert.equal(await service.can("user-1", platformListOrganizations), false);
  });

  it("allows organization APIs only inside the user's active organization", async () => {
    const service = createService({
      memberships: [
        {
          organizationId: "org-1",
          roleId: "role-org-viewer",
          status: "active",
          userId: "user-1",
        },
      ],
      rolePermissions: [
        {
          enabled: true,
          permission: organizationViewProfile.id,
          roleId: "role-org-viewer",
        },
      ],
    });

    assert.equal(
      await service.can("user-1", organizationViewProfile, {
        organizationId: "org-1",
      }),
      true,
    );
    assert.equal(
      await service.can("user-1", organizationViewProfile, {
        organizationId: "org-2",
      }),
      false,
    );
  });

  it("does not treat disabled role permissions as access grants", async () => {
    const service = createService({
      platformMembers: [
        {
          roleId: "role-platform-admin",
          status: "active",
          userId: "user-1",
        },
      ],
      rolePermissions: [
        {
          enabled: false,
          permission: platformListOrganizations.id,
          roleId: "role-platform-admin",
        },
      ],
    });

    assert.equal(await service.can("user-1", platformListOrganizations), false);
  });

  it("allows platform roles to satisfy organization-scope permissions as fallback", async () => {
    const service = createService({
      platformMembers: [
        {
          roleId: "role-platform-admin",
          status: "active",
          userId: "user-1",
        },
      ],
      rolePermissions: [
        {
          enabled: true,
          permission: organizationViewProfile.id,
          roleId: "role-platform-admin",
        },
      ],
    });

    assert.equal(
      await service.can("user-1", organizationViewProfile, {
        organizationId: "org-2",
      }),
      true,
    );
  });

  it("requires own-scope permission and matching target user id", async () => {
    const service = createService({
      memberships: [
        {
          organizationId: "org-1",
          roleId: "role-member",
          status: "active",
          userId: "user-1",
        },
      ],
      rolePermissions: [
        {
          enabled: true,
          permission: selfUpdateProfile.id,
          roleId: "role-member",
        },
      ],
    });

    assert.equal(
      await service.can("user-1", selfUpdateProfile, { targetUserId: "user-1" }),
      true,
    );
    assert.equal(
      await service.can("user-1", selfUpdateProfile, { targetUserId: "user-2" }),
      false,
    );
    assert.equal(await service.can("user-1", selfUpdateProfile), false);
  });

  it("denies own-scope APIs when the user role lacks the permission", async () => {
    const service = createService({
      memberships: [
        {
          organizationId: "org-1",
          roleId: "role-member",
          status: "active",
          userId: "user-1",
        },
      ],
    });

    assert.equal(
      await service.can("user-1", selfUpdateProfile, { targetUserId: "user-1" }),
      false,
    );
  });
});

function createService(options: {
  memberships?: MembershipRecord[];
  platformMembers?: PlatformMemberRecord[];
  rolePermissions?: RolePermissionRecord[];
} = {}) {
  return new AccessService(
    repository(options.platformMembers ?? []),
    repository(options.memberships ?? []),
    repository(options.rolePermissions ?? []),
  );
}

function repository<T extends Record<string, unknown>>(items: T[]): RepositoryMock<T> {
  return {
    async find(options) {
      return items.filter((item) =>
        Object.entries(options.where).every(
          ([key, value]) => item[key] === value,
        ),
      );
    },
    async findOne(options) {
      return (
        items.find((item) =>
          Object.entries(options.where).every(
            ([key, value]) => item[key] === value,
          ),
        ) ?? null
      );
    },
  };
}

function definition(
  id: string,
  scope: ResolvedAccessDefinition["scope"],
): ResolvedAccessDefinition {
  return {
    description: "",
    id,
    label: id,
    operation: "test",
    resource: "test",
    scope,
  };
}
