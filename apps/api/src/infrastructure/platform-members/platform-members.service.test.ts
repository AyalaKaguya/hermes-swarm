import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";
import { PlatformMembersService } from "./platform-members.service.js";

const USER_ID = "user-1";
const MEMBER_ID = "platform-member-1";
const ROLE_ID = "platform-role-1";
const ADMIN_ROLE_ID = "platform-admin-role";

describe("PlatformMembersService consistency", () => {
  it("rejects malformed create payload before querying or persisting", async () => {
    const state = createService();

    await assert.rejects(
      () => state.service.create(null as never),
      BadRequestException,
    );

    assert.equal(state.savedMembers.length, 0);
  });

  it("rejects malformed update payload before changing the member", async () => {
    const state = createService({
      members: [
        platformMemberRecord({
          id: MEMBER_ID,
          roleId: ROLE_ID,
          userId: USER_ID,
        }),
      ],
    });

    await assert.rejects(
      () => state.service.update(MEMBER_ID, [] as never),
      BadRequestException,
    );

    assert.equal(state.updatedMembers.length, 0);
  });

  it("rejects non-string platform member text fields without throwing TypeError", async () => {
    const state = createService();

    await assert.rejects(
      () =>
        state.service.create({
          displayName: 123 as never,
          roleId: ROLE_ID,
          userId: USER_ID,
        }),
      BadRequestException,
    );

    assert.equal(state.savedMembers.length, 0);
  });

  it("maps concurrent platform member uniqueness failures to a business error", async () => {
    const state = createService({ failMemberSaveWithUniqueError: true });

    await assert.rejects(
      () =>
        state.service.create({
          roleId: ROLE_ID,
          userId: USER_ID,
        }),
      BadRequestException,
    );
  });

  it("rejects invalid create status before persisting", async () => {
    const state = createService();

    await assert.rejects(
      () =>
        state.service.create({
          status: "archived" as never,
          userId: USER_ID,
        }),
      BadRequestException,
    );

    assert.equal(state.savedMembers.length, 0);
  });

  it("rejects invalid update status without changing the member", async () => {
    const state = createService({
      members: [
        platformMemberRecord({
          id: MEMBER_ID,
          roleId: null,
          userId: USER_ID,
        }),
      ],
    });

    await assert.rejects(
      () => state.service.update(MEMBER_ID, { status: "archived" as never }),
      BadRequestException,
    );

    assert.equal(state.updatedMembers.length, 0);
    assert.equal(state.members[0].status, "active");
  });

  it("revokes platform integration tokens when disabling a platform member", async () => {
    const state = createService({
      members: [
        platformMemberRecord({
          id: MEMBER_ID,
          roleId: ROLE_ID,
          userId: USER_ID,
        }),
      ],
    });

    await state.service.update(MEMBER_ID, { status: "disabled" });

    assert.deepEqual(state.revokedIntegrationTokenUpdates.map(stripDates), [
      {
        query: {
          organizationId: "IS_NULL",
          ownerUserId: USER_ID,
          revokedAt: "IS_NULL",
          scope: "platform",
        },
        value: { revokedAt: "DATE" },
      },
    ]);
  });

  it("revokes platform integration tokens when removing a platform member", async () => {
    const state = createService({
      members: [
        platformMemberRecord({
          id: MEMBER_ID,
          roleId: ROLE_ID,
          userId: USER_ID,
        }),
      ],
    });

    await state.service.remove(MEMBER_ID);

    assert.deepEqual(state.revokedIntegrationTokenUpdates.map(stripDates), [
      {
        query: {
          organizationId: "IS_NULL",
          ownerUserId: USER_ID,
          revokedAt: "IS_NULL",
          scope: "platform",
        },
        value: { revokedAt: "DATE" },
      },
    ]);
    assert.deepEqual(state.deletedMembers, [{ id: MEMBER_ID }]);
  });

  it("rejects disabling the last active platform admin", async () => {
    const state = createService({
      members: [
        platformMemberRecord({
          id: "platform-admin-member",
          roleId: ADMIN_ROLE_ID,
          userId: "platform-admin-user",
        }),
      ],
    });

    await assert.rejects(
      () =>
        state.service.update("platform-admin-member", {
          status: "disabled",
        }),
      BadRequestException,
    );

    assert.equal(state.updatedMembers.length, 0);
    assert.equal(state.revokedIntegrationTokenUpdates.length, 0);
  });

  it("rejects removing the last active platform admin", async () => {
    const state = createService({
      members: [
        platformMemberRecord({
          id: "platform-admin-member",
          roleId: ADMIN_ROLE_ID,
          userId: "platform-admin-user",
        }),
      ],
    });

    await assert.rejects(
      () => state.service.remove("platform-admin-member"),
      BadRequestException,
    );

    assert.equal(state.deletedMembers.length, 0);
    assert.equal(state.revokedIntegrationTokenUpdates.length, 0);
  });

  it("allows disabling a platform admin when another active platform admin remains", async () => {
    const state = createService({
      members: [
        platformMemberRecord({
          id: "platform-admin-member-1",
          roleId: ADMIN_ROLE_ID,
          userId: "platform-admin-user-1",
        }),
        platformMemberRecord({
          id: "platform-admin-member-2",
          roleId: ADMIN_ROLE_ID,
          userId: "platform-admin-user-2",
        }),
      ],
    });

    await state.service.update("platform-admin-member-1", {
      status: "disabled",
    });

    assert.equal(state.updatedMembers.length, 1);
    assert.equal(state.members[0].status, "disabled");
  });
});

function createService(
  options: {
    failMemberSaveWithUniqueError?: boolean;
    members?: any[];
  } = {},
) {
  const members = options.members ?? [];
  const savedMembers: any[] = [];
  const updatedMembers: any[] = [];
  const deletedMembers: any[] = [];
  const revokedIntegrationTokenUpdates: any[] = [];
  const transactionManager = {
    async delete(target: { name?: string }, query: any) {
      if (target.name === "PlatformMember") {
        deletedMembers.push(query);
        const index = members.findIndex((member) => member.id === query.id);
        if (index >= 0) members.splice(index, 1);
        return { affected: index >= 0 ? 1 : 0 };
      }
      return { affected: 0 };
    },
    async find(target: { name?: string }, { where }: any) {
      if (target.name !== "PlatformMember") return [];
      return members.filter((member) =>
        Object.entries(where).every(([key, value]) => member[key] === value),
      );
    },
    async findOne(target: { name?: string }, { where }: any) {
      if (target.name === "PlatformMember") {
        return findMember(members, where);
      }
      if (target.name === "Role") {
        return roleRecord(where.id);
      }
      return null;
    },
    async update(target: { name?: string }, query: any, value: any) {
      if (target.name === "IntegrationToken") {
        revokedIntegrationTokenUpdates.push({ query, value });
        return { affected: 1 };
      }
      if (target.name === "PlatformMember") {
        updatedMembers.push({ value, where: query });
        const member = members.find((item) => item.id === query.id);
        if (member) Object.assign(member, value);
        return { affected: member ? 1 : 0 };
      }
      return { affected: 0 };
    },
  };
  const memberRepository = {
    create(value: any) {
      return value;
    },
    async delete(query: any) {
      return transactionManager.delete({ name: "PlatformMember" }, query);
    },
    async findOne({ where }: any) {
      if (where.userId) {
        return findMember(members, where);
      }
      if (where.id) {
        return findMember(members, where);
      }
      return null;
    },
    async save(value: any) {
      if (options.failMemberSaveWithUniqueError) {
        throw {
          driverError: {
            code: "23505",
            constraint: "IDX_platform_members_user_id_unique",
          },
        };
      }
      const member = {
        id: MEMBER_ID,
        role: null,
        user: userRecord(),
        ...value,
      };
      members.push(member);
      savedMembers.push(member);
      return member;
    },
    async update(where: any, value: any) {
      return transactionManager.update(
        { name: "PlatformMember" },
        where,
        value,
      );
    },
    manager: {
      async transaction(callback: (manager: any) => Promise<unknown>) {
        return callback(transactionManager);
      },
    },
  };

  const service = new PlatformMembersService(
    memberRepository as any,
    {
      async findOne({ where }: any) {
        return roleRecord(where.id);
      },
    } as any,
    {
      async findOne({ where }: any) {
        return where.id === USER_ID ? userRecord() : null;
      },
    } as any,
    {
      manager: transactionManager,
    } as any,
  );

  return {
    deletedMembers,
    members,
    revokedIntegrationTokenUpdates,
    savedMembers,
    service,
    updatedMembers,
  };
}

function findMember(members: any[], where: Record<string, unknown>) {
  return (
    members.find((member) =>
      Object.entries(where).every(([key, value]) => member[key] === value),
    ) ?? null
  );
}

function roleRecord(roleId: string | undefined) {
  if (roleId === ROLE_ID) {
    return {
      id: ROLE_ID,
      name: "platform-operator",
      organizationId: null,
      scope: "platform",
    };
  }
  if (roleId === ADMIN_ROLE_ID) {
    return {
      id: ADMIN_ROLE_ID,
      name: "platform-admin",
      organizationId: null,
      scope: "platform",
    };
  }
  return null;
}

function platformMemberRecord(input: {
  id: string;
  roleId: string | null;
  status?: string;
  userId: string;
}) {
  return {
    displayName: "Ops",
    id: input.id,
    role: input.roleId ? roleRecord(input.roleId) : null,
    roleId: input.roleId,
    status: input.status ?? "active",
    user: userRecord(input.userId),
    userId: input.userId,
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

function userRecord(userId = USER_ID) {
  return {
    avatarUrl: null,
    createdAt: new Date("2026-07-01T00:00:00Z"),
    displayName: "Platform User",
    email: "platform-user@example.com",
    emailVerified: true,
    firstName: null,
    id: userId,
    imageUrl: null,
    lastName: null,
    mobile: null,
    nickname: "Platform User",
    passwordHash: null,
    preferredLanguage: "zh-Hans",
    refreshToken: null,
    status: "active",
    thirdPartyId: null,
    timeZone: null,
    type: "user",
    updatedAt: new Date("2026-07-01T00:00:00Z"),
    username: null,
  } as any;
}
