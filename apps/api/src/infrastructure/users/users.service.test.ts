import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";
import {
  hashPassword,
  verifyPassword,
} from "../../common/security/password-hash.js";
import { UsersService } from "./users.service.js";

const USER_ID = "user-1";
const TENANT_ID = "tenant-1";
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
          roleId: "role-member",
          status: "archived",
        } as any),
      { message: "用户状态无效" },
    );
    await assert.rejects(
      () => state.service.updateSelf(token, null as any),
      { message: "请求内容无效" },
    );
    await assert.rejects(
      () => state.service.updateSelf(token, { status: "archived" } as any),
      { message: "不允许的字段: status" },
    );
    assert.equal(state.users[0].status, "active");
    await assert.rejects(
      () => state.service.updatePassword(token, null as any),
      { message: "请求内容无效" },
    );
    await assert.rejects(
      () => state.service.updatePreferredLanguage(token, null as any),
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
        state.service.updatePassword(token, {
          password: "new-password",
        }),
      { message: "当前密码不能为空" },
    );
    await assert.rejects(
      () =>
        state.service.updatePassword(token, {
          currentPassword: "wrong-password",
          password: "new-password",
        }),
      { message: "当前密码不正确" },
    );

    await state.service.updatePassword(token, {
      currentPassword: "old-password",
      password: "new-password",
    });

    assert.equal(
      await verifyPassword("new-password", state.users[0].passwordHash),
      true,
    );
  });

  it("maps concurrent email uniqueness failures during create to a business error", async () => {
    const state = createService({ failSaveWithUniqueError: true });

    await assert.rejects(
      () =>
        state.service.create(token, {
          displayName: "New User",
          email: "new@example.com",
          password: "password-123",
          roleId: "role-member",
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
        state.service.updateSelf(token, {
          email: "next@example.com",
        } as any),
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
        query: { ownerUserId: USER_ID, revokedAt: "IS_NULL", tenantId: TENANT_ID },
        value: { revokedAt: "DATE" },
      },
    ]);
    assert.deepEqual(state.revokedSessionUsers, [`${TENANT_ID}:${USER_ID}`]);
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
        query: { ownerUserId: USER_ID, revokedAt: "IS_NULL", tenantId: TENANT_ID },
        value: { revokedAt: "DATE" },
      },
    ]);
    assert.deepEqual(state.revokedSessionUsers, [`${TENANT_ID}:${USER_ID}`]);
  });

  it("replaces workspace roles while protecting the tenant owner assignment", async () => {
    const ownerRole = roleRecord("role-owner", "tenant-owner");
    const adminRole = roleRecord("role-admin", "tenant-admin");
    const state = createService({
      roles: [ownerRole, adminRole],
      userTenantRoles: [
        { role: ownerRole, roleId: ownerRole.id, tenantId: TENANT_ID, userId: USER_ID },
      ],
      users: [userRecord({ email: "owner@example.com", id: USER_ID })],
    });

    await assert.rejects(
      () => state.service.replaceTenantRole(token, USER_ID, adminRole.id),
      { message: "工作空间必须至少保留一个有效 Tenant Owner" },
    );

    const updated = await state.service.replaceTenantRole(
      token,
      USER_ID,
      ownerRole.id,
    );
    assert.equal(updated.tenantRole.name, "tenant-owner");
  });

  it("stores explicit runtime preferences and supports workspace inheritance", async () => {
    const state = createService({
      users: [userRecord({ email: "owner@example.com", id: USER_ID })],
    });
    const explicit = await state.service.updateRuntimePreferences(token, {
      preferredLanguage: "zh-HK",
      timeZone: "Asia/Tokyo",
    });
    assert.equal(explicit.preferredLanguage, "zh-Hant");
    assert.equal(explicit.timeZone, "Asia/Tokyo");

    const inherited = await state.service.updateRuntimePreferences(token, {
      preferredLanguage: null,
      timeZone: null,
    });
    assert.equal(inherited.preferredLanguage, null);
    assert.equal(inherited.timeZone, null);
    await assert.rejects(
      () =>
        state.service.updateRuntimePreferences(token, {
          timeZone: "Invalid/Zone",
        }),
      BadRequestException,
    );
  });
});

function createService(options: {
  failTransactionAfterTokenRevoke?: boolean;
  failSaveWithUniqueError?: boolean;
  roles?: any[];
  userTenantRoles?: any[];
  users?: Array<ReturnType<typeof userRecord>>;
} = {}) {
  const users = options.users ?? [];
  const roles = options.roles ?? [roleRecord("role-member", "tenant-member")];
  const userTenantRoles = options.userTenantRoles ?? [];
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
    createQueryBuilder() {
      let values: any;
      let parameters: any;
      return {
        update() {
          return this;
        },
        set(input: any) {
          values = input;
          return this;
        },
        where(_clause: string, input: any) {
          parameters = input;
          return this;
        },
        async execute() {
          const user = users.find(
            (item) =>
              item.id === parameters.id && item.tenantId === parameters.tenantId,
          );
          if (!user) return { affected: 0 };
          user.passwordHash = values.passwordHash;
          user.credentialVersion = (user.credentialVersion ?? 0) + 1;
          user.credentialsChangedAt = values.credentialsChangedAt;
          user.updatedAt = values.updatedAt;
          return { affected: 1 };
        },
      };
    },
    async delete(target: any, query: any) {
      if (target.name === "UserTenantRole") {
        for (let index = userTenantRoles.length - 1; index >= 0; index -= 1) {
          const item = userTenantRoles[index];
          if (item.tenantId === query.tenantId && item.userId === query.userId) {
            userTenantRoles.splice(index, 1);
          }
        }
      }
      return { affected: 1 };
    },
    async find(target: any, options: any) {
      if (target.name === "Role") {
        const ids = findOperatorValues(options.where.id);
        return roles.filter(
          (role) =>
            ids.includes(role.id) &&
            role.scope === options.where.scope &&
            role.tenantId === options.where.tenantId,
        );
      }
      if (target.name === "UserTenantRole") {
        const ids = options.where.userId?._value
          ? findOperatorValues(options.where.userId)
          : [options.where.userId];
        return userTenantRoles.filter(
          (item) =>
            item.tenantId === options.where.tenantId && ids.includes(item.userId),
        );
      }
      return [];
    },
    async findOne(target: any, options: any) {
      if (target.name === "Role") {
        return roles.find(
          (role) =>
            role.id === options.where.id &&
            role.scope === options.where.scope &&
            role.tenantId === options.where.tenantId,
        ) ?? null;
      }
      return null;
    },
    async insert(target: any, values: any[]) {
      if (target.name === "UserTenantRole") {
        const rows = Array.isArray(values) ? values : [values];
        userTenantRoles.push(
          ...rows.map((value) => ({
            ...value,
            role: roles.find((role) => role.id === value.roleId),
          })),
        );
      }
      return { identifiers: [] };
    },
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
        if (options.failTransactionAfterTokenRevoke) {
          const user = users.find((item) => item.id === USER_ID);
          if (user) user.status = "active";
          throw new Error("transaction failed");
        }
        revokedIntegrationTokenUpdates.push({ query, value });
      }
      return { affected: 1 };
    },
  };
  const userRepository = {
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
    } as any;
  const service = new UsersService(
    {
      current: () => ({ manager, tenantId: TENANT_ID }),
      repository: (target: any) => target.name === "Role"
        ? { findOne: (options: any) => manager.findOne(target, options) }
        : userRepository,
    } as any,
    {
      validateAccessToken: async () => ({
        sessionId: "session-1",
        tenantId: TENANT_ID,
        tokenKind: "session",
        userId: USER_ID,
      }),
      revokeUserSessions: async (tenantId: string, userId: string) => {
        revokedSessionUsers.push(`${tenantId}:${userId}`);
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
    credentialVersion: 0,
    credentialsChangedAt: null,
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
    tenantId: TENANT_ID,
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

function findOperatorValues(value: any): string[] {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?._value)) return value._value;
  return value ? [value] : [];
}

function roleRecord(id: string, name: string) {
  return {
    color: null,
    description: null,
    displayName: name,
    id,
    isSystem: true,
    label: name,
    name,
    scope: "tenant",
    tenantId: TENANT_ID,
  };
}
