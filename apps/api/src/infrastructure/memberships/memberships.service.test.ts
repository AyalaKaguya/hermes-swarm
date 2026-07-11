import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";
import { MembershipsService } from "./memberships.service.js";

const ORGANIZATION_ID = "org-1";
const TENANT_ID = "tenant-1";
const ROLE_ID = "role-member";
const OWNER_ROLE_ID = "role-owner";

describe("MembershipsService consistency", () => {
  it("rejects malformed create payload before querying or persisting", async () => {
    const state = createService();

    await assert.rejects(
      () => state.service.create(ORGANIZATION_ID, null as never),
      BadRequestException,
    );

    assert.equal(state.users.length, 0);
    assert.equal(state.memberships.length, 0);
  });

  it("rejects malformed update payload before changing the member", async () => {
    const state = createService({
      memberships: [
        membershipRecord({
          id: "membership-member",
          role: roleRecord({ id: ROLE_ID, name: "member" }),
          roleId: ROLE_ID,
          status: "active",
          userId: "user-member",
        }),
      ],
    });

    await assert.rejects(
      () => state.service.update(ORGANIZATION_ID, "membership-member", [] as never),
      BadRequestException,
    );

    assert.equal(state.updatedMembershipQueries.length, 0);
  });

  it("rejects non-string member text fields without throwing TypeError", async () => {
    const state = createService({
      users: [userRecord({ email: "member@example.com", id: "user-member" })],
    });

    await assert.rejects(
      () =>
        state.service.create(ORGANIZATION_ID, {
          displayName: 123 as never,
          roleId: ROLE_ID,
          userId: "user-member",
        }),
      BadRequestException,
    );

    assert.equal(state.memberships.length, 0);
  });

  it("rolls back a newly created user when membership creation fails", async () => {
    const state = createService({ failMembershipSave: true });

    await assert.rejects(
      () =>
        state.service.create(ORGANIZATION_ID, {
          displayName: "Rollback User",
          email: "rollback@example.com",
          password: "password-123",
          roleId: ROLE_ID,
          status: "active",
        }),
      Error,
    );

    assert.equal(
      state.users.some((user) => user.email === "rollback@example.com"),
      false,
    );
    assert.equal(state.memberships.length, 0);
  });

  it("maps concurrent membership uniqueness failures to a business error", async () => {
    const state = createService({
      failMembershipSaveWithUniqueError: true,
      users: [userRecord({ email: "member@example.com", id: "user-member" })],
    });

    await assert.rejects(
      () =>
        state.service.create(ORGANIZATION_ID, {
          roleId: ROLE_ID,
          userId: "user-member",
        }),
      BadRequestException,
    );
  });

  it("maps concurrent user email uniqueness failures to a business error", async () => {
    const state = createService({ failUserSaveWithUniqueError: true });

    await assert.rejects(
      () =>
        state.service.create(ORGANIZATION_ID, {
          displayName: "Duplicate User",
          email: "duplicate@example.com",
          password: "password-123",
          roleId: ROLE_ID,
        }),
      BadRequestException,
    );
  });

  it("rejects invalid membership status before persisting", async () => {
    const state = createService({
      users: [userRecord({ email: "member@example.com", id: "user-member" })],
    });

    await assert.rejects(
      () =>
        state.service.create(ORGANIZATION_ID, {
          roleId: ROLE_ID,
          status: "archived" as never,
          userId: "user-member",
        }),
      BadRequestException,
    );

    assert.equal(state.memberships.length, 0);
  });

  it("rejects removing the last active owner", async () => {
    const state = createService({
      memberships: [
        membershipRecord({
          id: "membership-owner",
          role: roleRecord({ id: OWNER_ROLE_ID, name: "owner" }),
          roleId: OWNER_ROLE_ID,
          status: "active",
          userId: "user-owner",
        }),
      ],
    });

    await assert.rejects(
      () => state.service.remove(ORGANIZATION_ID, "membership-owner"),
      BadRequestException,
    );

    assert.equal(state.deletedMembershipQueries.length, 0);
    assert.equal(state.deletedGroupMemberQueries.length, 0);
  });

  it("rejects demoting the last active owner", async () => {
    const state = createService({
      memberships: [
        membershipRecord({
          id: "membership-owner",
          role: roleRecord({ id: OWNER_ROLE_ID, name: "owner" }),
          roleId: OWNER_ROLE_ID,
          status: "active",
          userId: "user-owner",
        }),
      ],
    });

    await assert.rejects(
      () =>
        state.service.update(ORGANIZATION_ID, "membership-owner", {
          roleId: ROLE_ID,
        }),
      BadRequestException,
    );

    assert.equal(state.updatedMembershipQueries.length, 0);
  });

  it("clears group membership rows before removing a non-last owner", async () => {
    const state = createService({
      memberships: [
        membershipRecord({
          id: "membership-owner-1",
          role: roleRecord({ id: OWNER_ROLE_ID, name: "owner" }),
          roleId: OWNER_ROLE_ID,
          status: "active",
          userId: "user-owner-1",
        }),
        membershipRecord({
          id: "membership-owner-2",
          role: roleRecord({ id: OWNER_ROLE_ID, name: "owner" }),
          roleId: OWNER_ROLE_ID,
          status: "active",
          userId: "user-owner-2",
        }),
      ],
    });

    await state.service.remove(ORGANIZATION_ID, "membership-owner-1");

    assert.deepEqual(state.deletedGroupMemberQueries, [
      {
        membershipId: "membership-owner-1",
        organizationId: ORGANIZATION_ID,
        tenantId: TENANT_ID,
      },
    ]);
    assert.deepEqual(state.deletedMembershipQueries, [
      {
        id: "membership-owner-1",
        organizationId: ORGANIZATION_ID,
        tenantId: TENANT_ID,
      },
    ]);
  });

  it("revokes organization integration tokens when disabling a member", async () => {
    const state = createService({
      memberships: [
        membershipRecord({
          id: "membership-member",
          role: roleRecord({ id: ROLE_ID, name: "member" }),
          roleId: ROLE_ID,
          status: "active",
          userId: "user-member",
        }),
      ],
    });

    await state.service.update(ORGANIZATION_ID, "membership-member", {
      status: "disabled",
    });

    assert.deepEqual(state.revokedIntegrationTokenUpdates.map(stripDates), [
      {
        query: {
          organizationId: ORGANIZATION_ID,
          ownerUserId: "user-member",
          revokedAt: "IS_NULL",
          scope: "organization",
          tenantId: TENANT_ID,
        },
        value: { revokedAt: "DATE" },
      },
    ]);
  });

  it("revokes organization integration tokens when removing a member", async () => {
    const state = createService({
      memberships: [
        membershipRecord({
          id: "membership-member",
          role: roleRecord({ id: ROLE_ID, name: "member" }),
          roleId: ROLE_ID,
          status: "active",
          userId: "user-member",
        }),
      ],
    });

    await state.service.remove(ORGANIZATION_ID, "membership-member");

    assert.deepEqual(state.revokedIntegrationTokenUpdates.map(stripDates), [
      {
        query: {
          organizationId: ORGANIZATION_ID,
          ownerUserId: "user-member",
          revokedAt: "IS_NULL",
          scope: "organization",
          tenantId: TENANT_ID,
        },
        value: { revokedAt: "DATE" },
      },
    ]);
  });
});

function createService(options: {
  failMembershipSave?: boolean;
  failMembershipSaveWithUniqueError?: boolean;
  failUserSaveWithUniqueError?: boolean;
  memberships?: any[];
  users?: Array<ReturnType<typeof userRecord>>;
} = {}) {
  const users = options.users ?? [];
  const initialUserCount = users.length;
  const memberships: any[] = options.memberships ?? [];
  const deletedGroupMemberQueries: any[] = [];
  const deletedMembershipQueries: any[] = [];
  const revokedIntegrationTokenUpdates: any[] = [];
  const updatedMembershipQueries: any[] = [];
  const transactionManager = {
    async delete(target: { name?: string }, query: any) {
      if (target.name === "OrganizationGroupMember") {
        deletedGroupMemberQueries.push(query);
        return { affected: 1 };
      }
      if (target.name === "UserOrganization") {
        deletedMembershipQueries.push(query);
        const index = memberships.findIndex((membership) =>
          Object.entries(query).every(
            ([key, value]) => membership[key] === value,
          ),
        );
        if (index >= 0) memberships.splice(index, 1);
        return { affected: index >= 0 ? 1 : 0 };
      }
      return { affected: 0 };
    },
    async find(target: { name?: string }, { where }: any) {
      if (target.name !== "UserOrganization") return [];
      return memberships.filter((membership) =>
        Object.entries(where).every(([key, value]) => membership[key] === value),
      );
    },
    async findOne(target: { name?: string }, { where }: any) {
      if (target.name === "User") {
        return (
          users.find((user) =>
            Object.entries(where).every(([key, value]) => user[key] === value),
          ) ?? null
        );
      }
      if (target.name === "UserOrganization") {
        return (
          memberships.find((membership) =>
            Object.entries(where).every(
              ([key, value]) => membership[key] === value,
            ),
          ) ?? null
        );
      }
      if (target.name === "Role") {
        if (where.id === ROLE_ID) {
          return roleRecord({ id: ROLE_ID, name: "member" });
        }
        if (where.id === OWNER_ROLE_ID) {
          return roleRecord({ id: OWNER_ROLE_ID, name: "owner" });
        }
        return null;
      }
      return null;
    },
    async save(target: { name?: string }, value: any) {
      if (target.name === "User") {
        if (options.failUserSaveWithUniqueError) {
          throw {
            driverError: {
              code: "23505",
              constraint: "IDX_users_email_unique",
            },
          };
        }
        const user = {
          avatarUrl: null,
          createdAt: new Date("2026-07-01T00:00:00Z"),
          firstName: null,
          id: `user-${users.length + 1}`,
          imageUrl: null,
          lastName: null,
          mobile: null,
          preferredLanguage: "zh-Hans",
          refreshToken: null,
          thirdPartyId: null,
          timeZone: null,
          updatedAt: new Date("2026-07-01T00:00:00Z"),
          username: null,
          ...value,
        };
        users.push(user);
        return user;
      }
      if (target.name === "UserOrganization") {
        if (options.failMembershipSaveWithUniqueError) {
          throw {
            driverError: {
              code: "23505",
              constraint: "IDX_user_organizations_user_organization_unique",
            },
          };
        }
        if (options.failMembershipSave) {
          users.splice(initialUserCount);
          throw new Error("membership save failed");
        }
        const membership = {
          id: `membership-${memberships.length + 1}`,
          ...value,
        };
        memberships.push(membership);
        return membership;
      }
      return value;
    },
    async update(target: { name?: string }, query: any, value: any) {
      if (target.name === "IntegrationToken") {
        revokedIntegrationTokenUpdates.push({ query, value });
        return { affected: 1 };
      }
      if (target.name !== "UserOrganization") return { affected: 0 };
      updatedMembershipQueries.push({ query, value });
      const membership = memberships.find((item) =>
        Object.entries(query).every(([key, entryValue]) => item[key] === entryValue),
      );
      if (membership) Object.assign(membership, value);
      return { affected: membership ? 1 : 0 };
    },
  };
  const membershipRepository = {
    create(value: any) {
      return value;
    },
    async find() {
      return memberships;
    },
  };
  const userRepository = {
    create(value: any) {
      return value;
    },
  };
  const organizationRepository = {
    async findOne({ where }: any) {
      return where.id === ORGANIZATION_ID && where.tenantId === TENANT_ID
        ? { id: ORGANIZATION_ID, tenantId: TENANT_ID }
        : null;
    },
  };
  const groupMemberRepository = {
    async find() {
      return [];
    },
  };
  const service = new MembershipsService({
    current: () => ({ manager: transactionManager, tenantId: TENANT_ID }),
    repository: (target: { name?: string }) => {
      if (target.name === "UserOrganization") return membershipRepository;
      if (target.name === "Organization") return organizationRepository;
      if (target.name === "OrganizationGroupMember") return groupMemberRepository;
      return userRepository;
    },
  } as any);

  return {
    deletedGroupMemberQueries,
    deletedMembershipQueries,
    memberships,
    revokedIntegrationTokenUpdates,
    service,
    updatedMembershipQueries,
    users,
  };
}

function stripDates(value: any) {
  if (value instanceof Date) return "DATE";
  if (value && typeof value === "object") {
    if ("_type" in value && value._type === "isNull") return "IS_NULL";
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, stripDates(entry)]),
    );
  }
  return value;
}

function roleRecord(input: { id: string; name: string }) {
  return {
    id: input.id,
    name: input.name,
    organizationId: ORGANIZATION_ID,
    scope: "organization",
    tenantId: TENANT_ID,
  };
}

function membershipRecord(input: {
  id: string;
  role: ReturnType<typeof roleRecord>;
  roleId: string;
  status: string;
  userId: string;
}) {
  return {
    displayName: null,
    groupIds: [],
    groups: [],
    id: input.id,
    joinedAt: new Date("2026-07-01T00:00:00Z"),
    organizationId: ORGANIZATION_ID,
    role: input.role,
    roleId: input.roleId,
    status: input.status,
    tenantId: TENANT_ID,
    user: userRecord({
      email: `${input.userId}@example.com`,
      id: input.userId,
    }),
    userId: input.userId,
  };
}

function userRecord(input: { email: string; id: string }) {
  return {
    avatarUrl: null,
    createdAt: new Date("2026-07-01T00:00:00Z"),
    displayName: input.email.split("@")[0],
    email: input.email,
    emailVerified: true,
    firstName: null,
    id: input.id,
    imageUrl: null,
    lastName: null,
    mobile: null,
    nickname: input.email.split("@")[0],
    passwordHash: null,
    preferredLanguage: "zh-Hans",
    refreshToken: null,
    status: "active",
    tenantId: TENANT_ID,
    thirdPartyId: null,
    timeZone: null,
    type: "user",
    updatedAt: new Date("2026-07-01T00:00:00Z"),
    username: null,
  } as any;
}
