import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";
import {
  hashPassword,
  verifyPassword,
} from "../../common/security/password-hash.js";
import { UsersService } from "./users.service.js";

const USER_ID = "user-1";
const token = "Bearer token";

describe("UsersService uniqueness handling", () => {
  it("rejects malformed user payloads and invalid statuses with controlled errors", async () => {
    const state = createService({
      users: [
        userRecord({
          email: "current@example.com",
          id: USER_ID,
        }),
      ],
    });

    await assert.rejects(
      () => state.service.search(token, null as any),
      { message: "请求内容无效" },
    );
    await assert.rejects(
      () => state.service.create(token, null as any),
      { message: "请求内容无效" },
    );
    await assert.rejects(
      () =>
        state.service.create(token, {
          email: "new@example.com",
          status: "archived",
        } as any),
      { message: "用户状态无效" },
    );
    await assert.rejects(
      () => state.service.update(token, USER_ID, null as any),
      { message: "请求内容无效" },
    );
    await assert.rejects(
      () => state.service.update(token, USER_ID, { status: "archived" } as any),
      { message: "用户状态无效" },
    );
    assert.equal(state.users[0].status, "active");
    await assert.rejects(
      () => state.service.updatePassword(token, USER_ID, null as any),
      { message: "请求内容无效" },
    );
    await assert.rejects(
      () => state.service.updatePreferredLanguage(token, USER_ID, null as any),
      { message: "请求内容无效" },
    );
  });

  it("requires the current password before changing an existing password", async () => {
    const state = createService({
      users: [
        userRecord({
          email: "current@example.com",
          id: USER_ID,
          passwordHash: hashPassword("old-password"),
        }),
      ],
    });

    await assert.rejects(
      () =>
        state.service.updatePassword(token, USER_ID, {
          password: "new-password",
        }),
      { message: "当前密码不能为空" },
    );
    await assert.rejects(
      () =>
        state.service.updatePassword(token, USER_ID, {
          currentPassword: "wrong-password",
          password: "new-password",
        }),
      { message: "当前密码不正确" },
    );

    await state.service.updatePassword(token, USER_ID, {
      currentPassword: "old-password",
      password: "new-password",
    });

    assert.equal(verifyPassword("new-password", state.users[0].passwordHash), true);
  });

  it("maps concurrent email uniqueness failures during create to a business error", async () => {
    const state = createService({ failSaveWithUniqueError: true });

    await assert.rejects(
      () =>
        state.service.create(token, {
          displayName: "New User",
          email: "new@example.com",
          password: "password-123",
          status: "active",
        }),
      BadRequestException,
    );
  });

  it("maps concurrent email uniqueness failures during update to a business error", async () => {
    const state = createService({
      failSaveWithUniqueError: true,
      users: [
        userRecord({
          email: "current@example.com",
          id: USER_ID,
        }),
      ],
    });

    await assert.rejects(
      () =>
        state.service.update(token, USER_ID, {
          email: "next@example.com",
        }),
      BadRequestException,
    );
  });

  it("revokes user sessions and integration tokens when disabling a user", async () => {
    const state = createService({
      users: [
        userRecord({
          email: "current@example.com",
          id: USER_ID,
        }),
      ],
    });

    await state.service.updateManaged(token, USER_ID, { status: "disabled" });

    assert.equal(state.users[0].status, "disabled");
    assert.deepEqual(state.revokedIntegrationTokenUpdates.map(stripDates), [
      {
        query: { ownerUserId: USER_ID, revokedAt: "IS_NULL" },
        value: { revokedAt: "DATE" },
      },
    ]);
    assert.deepEqual(state.revokedSessionUsers, [USER_ID]);
  });

  it("does not revoke sessions when disabling a user rolls back", async () => {
    const state = createService({
      failTransactionAfterTokenRevoke: true,
      users: [
        userRecord({
          email: "current@example.com",
          id: USER_ID,
        }),
      ],
    });

    await assert.rejects(
      () => state.service.updateManaged(token, USER_ID, { status: "disabled" }),
      { message: "transaction failed" },
    );

    assert.equal(state.users[0].status, "active");
    assert.deepEqual(state.revokedIntegrationTokenUpdates.map(stripDates), []);
    assert.deepEqual(state.revokedSessionUsers, []);
  });

  it("revokes user sessions and integration tokens when deleting a managed user", async () => {
    const state = createService({
      users: [
        userRecord({
          email: "current@example.com",
          id: USER_ID,
        }),
      ],
    });

    await state.service.deleteManaged(token, USER_ID);

    assert.deepEqual(state.softDeletedUsers, [USER_ID]);
    assert.deepEqual(state.revokedIntegrationTokenUpdates.map(stripDates), [
      {
        query: { ownerUserId: USER_ID, revokedAt: "IS_NULL" },
        value: { revokedAt: "DATE" },
      },
    ]);
    assert.deepEqual(state.revokedSessionUsers, [USER_ID]);
  });
});

function createService(options: {
  failTransactionAfterTokenRevoke?: boolean;
  failSaveWithUniqueError?: boolean;
  users?: Array<ReturnType<typeof userRecord>>;
} = {}) {
  const users = options.users ?? [];
  const revokedIntegrationTokenUpdates: any[] = [];
  const revokedSessionUsers: string[] = [];
  const softDeletedUsers: string[] = [];
  const userSnapshots = () => users.map((user) => ({ ...user }));
  function restoreUsers(snapshot: any[]) {
    users.splice(0, users.length, ...snapshot);
  }
  async function saveUser(user: any) {
    if (options.failSaveWithUniqueError) {
      throw { driverError: { code: "23505" } };
    }
    const index = users.findIndex((item) => item.id === user.id);
    const saved = { ...user };
    if (index >= 0) users[index] = saved;
    else users.push(saved);
    return { ...saved };
  }
  const manager = {
    async save(target: any, user: any) {
      void target;
      return saveUser(user);
    },
    async softDelete(target: any, query: any) {
      void target;
      softDeletedUsers.push(query.id);
      return { affected: 1 };
    },
    async transaction(callback: (transactionManager: any) => Promise<any>) {
      const snapshot = userSnapshots();
      const revokedSnapshot = [...revokedIntegrationTokenUpdates];
      const softDeletedSnapshot = [...softDeletedUsers];
      try {
        const result = await callback(manager);
        if (options.failTransactionAfterTokenRevoke) {
          throw new Error("transaction failed");
        }
        return result;
      } catch (error) {
        restoreUsers(snapshot);
        revokedIntegrationTokenUpdates.splice(
          0,
          revokedIntegrationTokenUpdates.length,
          ...revokedSnapshot,
        );
        softDeletedUsers.splice(
          0,
          softDeletedUsers.length,
          ...softDeletedSnapshot,
        );
        throw error;
      }
    },
    async update(target: any, query: any, value: any) {
      if (target.name === "IntegrationToken") {
        revokedIntegrationTokenUpdates.push({ query, value });
      }
      return { affected: 1 };
    },
  };
  const service = new UsersService(
    {
      manager,
      create(value: any) {
        return {
          avatarUrl: null,
          createdAt: new Date("2026-07-01T00:00:00Z"),
          firstName: null,
          id: `user-${users.length + 1}`,
          imageUrl: null,
          lastName: null,
          mobile: null,
          nickname: null,
          preferredLanguage: "zh-Hans",
          timeZone: null,
          updatedAt: new Date("2026-07-01T00:00:00Z"),
          username: null,
          ...value,
        };
      },
      async find({ order }: any) {
        void order;
        return users;
      },
      async findOne({ where }: any) {
        const user =
          users.find((item) =>
            Object.entries(where).every(([key, value]) => item[key] === value),
          ) ?? null;
        return user ? { ...user } : null;
      },
      async save(user: any) {
        return saveUser(user);
      },
      async softDelete() {
        return { affected: 1 };
      },
    } as any,
    {} as any,
    {
      validateAccessToken: async () => ({
        sessionId: "session-1",
        tokenKind: "session",
        userId: USER_ID,
      }),
      revokeUserSessions: async (userId: string) => {
        revokedSessionUsers.push(userId);
      },
    } as any,
  );

  return {
    revokedIntegrationTokenUpdates,
    revokedSessionUsers,
    service,
    softDeletedUsers,
    users,
  };
}

function userRecord(input: { email: string; id: string; passwordHash?: string | null }) {
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
    passwordHash: input.passwordHash ?? null,
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

function stripDates(value: any) {
  if (value instanceof Date) return "DATE";
  if (value?._type === "isNull") return "IS_NULL";
  if (Array.isArray(value)) return value.map(stripDates);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, stripDates(item)]),
    );
  }
  return value;
}
