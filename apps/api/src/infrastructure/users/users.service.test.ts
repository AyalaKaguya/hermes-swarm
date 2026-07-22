import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Account, Role, WorkspaceMembership } from "@hermes-swarm/core";
import { hashPassword, verifyPassword } from "../../common/security/password-hash.js";
import { UsersService } from "./users.service.js";

const WORKSPACE_ID = "workspace-1";
const ACCOUNT_ID = "account-1";
const MEMBERSHIP_ID = "membership-1";
const TOKEN = "Bearer access-token";

describe("UsersService workspace membership contract", () => {
  it("lists account data through workspace memberships", async () => {
    const state = createState();
    const [member] = await state.service.list(TOKEN);

    assert.equal(member.membershipId, MEMBERSHIP_ID);
    assert.equal(member.account.id, ACCOUNT_ID);
    assert.equal(member.role.name, "workspace-member");
    assert.equal(member.status, "active");
    assert.deepEqual(state.membershipFindOptions?.where, {
      workspaceId: WORKSPACE_ID,
    });
  });

  it("disables only the current workspace membership and its sessions", async () => {
    const state = createState();
    const updated = await state.service.updateMembershipStatus(
      TOKEN,
      MEMBERSHIP_ID,
      "disabled",
    );

    assert.equal(updated.status, "disabled");
    assert.deepEqual(state.revokedWorkspaceSessions, [
      `${WORKSPACE_ID}:${ACCOUNT_ID}`,
    ]);
    assert.equal(state.revokedAccountSessions.length, 0);
    assert.equal(state.tokenUpdates.length, 1);
  });

  it("protects the final active Owner membership", async () => {
    const state = createState({ roleName: "workspace-owner" });
    await assert.rejects(
      state.service.updateMembershipStatus(TOKEN, MEMBERSHIP_ID, "removed"),
      { message: "工作空间必须至少保留一个有效 Workspace Owner" },
    );
    assert.equal(state.membership.status, "active");
  });

  it("changes global credentials and revokes sessions across all workspaces", async () => {
    const state = createState();
    const result = await state.service.updatePassword(TOKEN, {
      currentPassword: "old-password",
      password: "new-password",
    });

    assert.deepEqual(result, { reauthenticationRequired: true, success: true });
    assert.equal(await verifyPassword("new-password", state.account.passwordHash), true);
    assert.equal(state.account.credentialVersion, 2);
    assert.deepEqual(state.revokedAccountSessions, [ACCOUNT_ID]);
  });

  it("stores language and time zone on the global account", async () => {
    const state = createState();
    const account = await state.service.updateRuntimePreferences(TOKEN, {
      preferredLanguage: "zh-HK",
      timeZone: "Asia/Tokyo",
    });

    assert.equal(account.preferredLanguage, "zh-Hant");
    assert.equal(account.timeZone, "Asia/Tokyo");
  });
});

function createState(options: { roleName?: string } = {}) {
  const account = accountRecord();
  const role = {
    id: "role-1",
    isSystem: true,
    label: "Role",
    name: options.roleName ?? "workspace-member",
    rolePermissions: [],
    scope: "workspace",
    workspaceId: WORKSPACE_ID,
  };
  const membership: any = {
    account,
    accountId: ACCOUNT_ID,
    createdAt: new Date(),
    id: MEMBERSHIP_ID,
    removedAt: null,
    role,
    roleId: role.id,
    status: "active",
    updatedAt: new Date(),
    workspaceId: WORKSPACE_ID,
  };
  const revokedWorkspaceSessions: string[] = [];
  const revokedAccountSessions: string[] = [];
  const tokenUpdates: any[] = [];
  let membershipFindOptions: any;
  const manager = {
    find: async (target: unknown) => target === WorkspaceMembership ? [membership] : [],
    findOne: async (target: unknown, { where }: any) => {
      if (target === WorkspaceMembership) {
        return where.id === membership.id ? membership : null;
      }
      if (target === Role) return where.id === role.id ? role : null;
      return null;
    },
    query: async () => [{ id: membership.id }],
    save: async (_target: unknown, value: any) => value,
    update: async (_target: unknown, query: any, value: any) => {
      tokenUpdates.push({ query, value });
      return { affected: 1 };
    },
  };
  const dataSource = {
    transaction: async (work: (transactionManager: typeof manager) => Promise<unknown>) =>
      work(manager),
  };
  const authSessionService = {
    revokeAccountSessions: async (accountId: string) =>
      revokedAccountSessions.push(accountId),
    revokeUserSessions: async (workspaceId: string, accountId: string) =>
      revokedWorkspaceSessions.push(`${workspaceId}:${accountId}`),
    validateAccessToken: async () => ({
      accountId: ACCOUNT_ID,
      membershipId: MEMBERSHIP_ID,
      principalType: "workspace",
      workspaceId: WORKSPACE_ID,
    }),
  };
  const accountRepository = {
    findOne: async ({ where }: any) => where.id === account.id ? account : null,
    save: async (value: any) => value,
  };
  const roleRepository = {
    findOne: async ({ where }: any) =>
      where.id === role.id &&
      where.scope === role.scope &&
      where.workspaceId === role.workspaceId
        ? role
        : null,
  };
  const membershipRepository = {
    find: async (options: any) => {
      membershipFindOptions = options;
      return options.where?.workspaceId === WORKSPACE_ID ? [membership] : [];
    },
    manager,
  };
  const service = new UsersService(
    { current: () => ({ scopeLevel: "workspace", workspaceId: WORKSPACE_ID }) } as never,
    authSessionService as never,
    dataSource as never,
    accountRepository as never,
    roleRepository as never,
    membershipRepository as never,
  );
  return {
    account,
    membership,
    get membershipFindOptions() {
      return membershipFindOptions;
    },
    revokedAccountSessions,
    revokedWorkspaceSessions,
    service,
    tokenUpdates,
  };
}

function accountRecord() {
  return {
    avatarUrl: null,
    credentialVersion: 1,
    displayName: "Global Account",
    email: "account@example.com",
    emailVerified: true,
    firstName: null,
    id: ACCOUNT_ID,
    imageUrl: null,
    lastName: null,
    mobile: null,
    nickname: "Global Account",
    passwordHash: hashPassword("old-password"),
    preferredLanguage: "zh-Hans",
    status: "active",
    timeZone: null,
    type: "user",
    updatedAt: new Date(),
    username: null,
  };
}
