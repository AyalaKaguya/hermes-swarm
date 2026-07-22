import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";
import { PlatformMemberSchema } from "@hermes-swarm/api-contracts";
import { PlatformMembersService } from "./platform-members.service.js";

describe("PlatformMembersService unified account membership", () => {
  it("grants an existing account a platform membership", async () => {
    const account = platformAccount();
    const state = createService({ accounts: [account] });

    const result = await state.service.create({
      email: "operator@example.com",
      roleId: "role-admin",
    });

    assert.equal(result.account.id, "account-1");
    assert.equal(result.membershipId, "membership-1");
    assert.equal(state.memberships.length, 1);
  });

  it("maps member rows to the public contract without internal account fields", async () => {
    const account = platformAccount();
    const state = createService({
      accounts: [account],
      memberships: [{
        account,
        accountId: account.id,
        id: "membership-1",
        role: platformAdminRole(),
        roleId: "role-admin",
        status: "active",
      }],
    });

    const result = JSON.parse(JSON.stringify(await state.service.list()));

    assert.deepEqual(PlatformMemberSchema.array().parse(result), result);
    assert.equal("passwordHash" in result[0].account, false);
  });

  it("invites an unknown email instead of assigning its password", async () => {
    const state = createService();
    const result = await state.service.create({
      email: "new@example.com",
      expiresIn: "7d",
      roleId: "role-admin",
    });

    assert.equal(result.status, "invited");
    assert.deepEqual(state.invites, [{
      actorAccountId: null,
      email: "new@example.com",
      expiresIn: "7d",
      roleId: "role-admin",
    }]);
  });

  it("does not disable the final active platform administrator", async () => {
    const state = createService({
      accounts: [{ id: "account-1", status: "active" }],
      memberships: [{
        accountId: "account-1",
        id: "membership-1",
        role: platformAdminRole(),
        roleId: "role-admin",
        status: "active",
      }],
    });

    await assert.rejects(
      () => state.service.update("membership-1", { status: "disabled" }),
      BadRequestException,
    );
  });
});

function createService(options: { accounts?: any[]; memberships?: any[] } = {}) {
  const accounts = options.accounts ?? [];
  const memberships = options.memberships ?? [];
  const invites: any[] = [];
  const roles = [platformAdminRole()];
  const manager = {
    find: async (target: { name?: string }) =>
      target.name === "PlatformMembership" ? memberships : [],
    findOne: async (target: { name?: string }, { where }: any) => {
      if (target.name === "PlatformMembership") {
        return memberships.find((item) => item.id === where.id) ?? null;
      }
      if (target.name === "Role") {
        return roles.find((item) => item.id === where.id) ?? null;
      }
      return null;
    },
    save: async (_target: unknown, value: any) => value,
    transaction: async (work: (manager: any) => unknown) => work(manager),
  };
  const membershipRepository = {
    create: (value: any = {}) => value,
    find: async () => memberships,
    findOne: async ({ where }: any) =>
      memberships.find((item) => item.accountId === where.accountId) ?? null,
    manager,
    save: async (value: any) => {
      const saved = { id: value.id ?? `membership-${memberships.length + 1}`, ...value };
      memberships.push(saved);
      return saved;
    },
  };
  const service = new PlatformMembersService(
    {
      findOne: async ({ where }: any) =>
        accounts.find((item) => item.email === where.email) ?? null,
      manager,
    } as never,
    {
      findOne: async ({ where }: any) =>
        roles.find((item) => item.id === where.id) ?? null,
      manager,
    } as never,
    membershipRepository as never,
    {
      createPlatform: async (actorAccountId: string | null, input: any) => {
        invites.push({ actorAccountId, ...input });
        return { id: "invite-1", ...input };
      },
    } as never,
    { revokeMembershipSessions: async () => undefined } as never,
  );
  return { invites, memberships, service };
}

function platformAccount(overrides: Record<string, unknown> = {}) {
  return {
    avatarUrl: null,
    createdAt: new Date("2026-07-22T00:00:00.000Z"),
    displayName: "Existing Account",
    email: "operator@example.com",
    emailVerified: true,
    firstName: null,
    id: "account-1",
    imageUrl: null,
    lastName: null,
    mobile: null,
    nickname: null,
    passwordHash: "not-for-the-api",
    preferredLanguage: "zh-Hans",
    status: "active",
    timeZone: "Asia/Shanghai",
    type: "user",
    updatedAt: new Date("2026-07-22T00:00:00.000Z"),
    username: null,
    ...overrides,
  };
}

function platformAdminRole() {
  return {
    id: "role-admin",
    isSystem: true,
    label: "Platform Admin",
    name: "platform-admin",
    rolePermissions: [],
    scope: "platform",
    workspaceId: null,
  };
}
