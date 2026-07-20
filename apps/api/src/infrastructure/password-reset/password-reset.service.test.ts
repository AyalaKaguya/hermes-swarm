import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PasswordReset, Tenant, User } from "@hermes-swarm/core";
import { hashPassword, verifyPassword } from "../../common/security/password-hash.js";
import { PasswordResetService } from "./password-reset.service.js";
import { createPasswordResetToken } from "./password-reset-token.js";

describe("PasswordResetService", () => {
  it("rejects malformed request and reset payloads with controlled errors", async () => {
    const state = createPasswordResetService();

    await assert.rejects(
      () => state.service.requestReset(null as any),
      { message: "请求内容无效" },
    );
    await assert.rejects(
      () => state.service.requestReset([] as any),
      { message: "请求内容无效" },
    );
    await assert.rejects(
      () => state.service.resetPassword(null as any),
      { message: "请求内容无效" },
    );
    await assert.rejects(
      () => state.service.resetPassword([] as any),
      { message: "请求内容无效" },
    );
  });

  it("returns success without sending email for unknown accounts", async () => {
    const state = createPasswordResetService();

    const result = await state.service.requestReset({
      email: "missing@example.com",
    });

    assert.deepEqual(result, { success: true });
    assert.equal(state.passwordResets.length, 0);
    assert.equal(state.sentEmails.length, 0);
  });

  it("creates a tenant-bound reset token and sends the tenant password template", async () => {
    const state = createPasswordResetService({
      memberships: [{ organizationId: "org-1", userId: "user-1" }],
      users: [userRecord({ email: "Admin@Example.com", id: "user-1" })],
    });

    const result = await state.service.requestReset({
      email: " admin@example.com ",
      tenantSlug: "acme",
    });

    assert.deepEqual(result, { success: true });
    assert.equal(state.passwordResets.length, 1);
    assert.equal(state.passwordResets[0].email, "admin@example.com");
    assert.equal(state.sentEmails.length, 1);
    assert.equal(state.sentEmails[0].email, "admin@example.com");
    assert.equal("organizationId" in state.sentEmails[0], false);
    assert.equal(state.sentEmails[0].templateName, "password-reset");
    assert.match(state.sentEmails[0].locals.resetLink, /\/reset-password\?/);
  });

  it("resets password with a valid token and rejects mismatched confirmation", async () => {
    const user = userRecord({ email: "admin@example.com", id: "user-1" });
    const state = createPasswordResetService({ users: [user] });
    await state.service.requestReset({ email: "admin@example.com", tenantSlug: "acme" });
    const token = state.passwordResets[0].token;

    await assert.rejects(() =>
      state.service.resetPassword({
        confirmPassword: "different-password",
        email: "admin@example.com",
        password: "new-password",
        token,
      }),
    );

    const result = await state.service.resetPassword({
      confirmPassword: "new-password",
      email: "admin@example.com",
      password: "new-password",
      token,
    });

    assert.deepEqual(result, {
      success: true,
      reauthenticationRequired: true,
    });
    assert.equal(await verifyPassword("new-password", user.passwordHash), true);
    assert.equal(user.emailVerified, true);
    await assert.rejects(() =>
      state.service.resetPassword({
        confirmPassword: "another-password",
        email: "admin@example.com",
        password: "another-password",
        token,
      }),
    );
  });

  it("consumes a reset token at most once under concurrent reset requests", async () => {
    const user = userRecord({ email: "admin@example.com", id: "user-1" });
    const state = createPasswordResetService({ users: [user] });
    await state.service.requestReset({ email: "admin@example.com", tenantSlug: "acme" });
    const token = state.passwordResets[0].token;

    const results = await Promise.allSettled([
      state.service.resetPassword({
        confirmPassword: "first-password",
        email: "admin@example.com",
        password: "first-password",
        token,
      }),
      state.service.resetPassword({
        confirmPassword: "second-password",
        email: "admin@example.com",
        password: "second-password",
        token,
      }),
    ]);

    assert.equal(
      results.filter((result) => result.status === "fulfilled").length,
      1,
    );
    assert.equal(
      results.filter((result) => result.status === "rejected").length,
      1,
    );
    assert.equal(state.passwordResets.length, 0);
    assert.equal(
      (await verifyPassword("first-password", user.passwordHash)) ||
        (await verifyPassword("second-password", user.passwordHash)),
      true,
    );
  });

  it("keeps a provisioning tenant restricted until its root organization is created", async () => {
    const user = userRecord({ email: "owner@example.com", id: "owner-1" });
    const state = createPasswordResetService({
      tenantStatus: "provisioning",
      users: [user],
    });
    const token = createPasswordResetToken({
      email: user.email,
      tenantId: state.tenant.id,
      userId: user.id,
    });
    state.passwordResets.push({
      createdAt: new Date(),
      email: user.email,
      expired: false,
      id: "activation-1",
      tenantId: state.tenant.id,
      token,
    });

    await state.service.resetPassword({
      confirmPassword: "owner-password",
      email: user.email,
      password: "owner-password",
      tenantSlug: "acme",
      token,
    });

    assert.equal(state.tenant.status, "provisioning");
    assert.equal(await verifyPassword("owner-password", user.passwordHash), true);
    assert.equal(state.passwordResets.length, 0);
  });

  it("rolls back password changes when reset token consumption fails", async () => {
    const user = userRecord({ email: "admin@example.com", id: "user-1" });
    const oldPasswordHash = user.passwordHash;
    const state = createPasswordResetService({
      failResetDelete: true,
      users: [user],
    });
    await state.service.requestReset({ email: "admin@example.com", tenantSlug: "acme" });
    const token = state.passwordResets[0].token;

    await assert.rejects(() =>
      state.service.resetPassword({
        confirmPassword: "new-password",
        email: "admin@example.com",
        password: "new-password",
        token,
      }),
    );

    assert.equal(user.passwordHash, oldPasswordHash);
    assert.equal(user.emailVerified, false);
    assert.equal(state.passwordResets.length, 1);
  });
});

function createPasswordResetService(options: {
  failResetDelete?: boolean;
  memberships?: Array<{ organizationId: string; userId: string }>;
  users?: ReturnType<typeof userRecord>[];
  tenantStatus?: "active" | "provisioning";
} = {}) {
  const passwordResets: any[] = [];
  const users = options.users ?? [];
  const memberships = options.memberships ?? [];
  const sentEmails: any[] = [];
  let transactionQueue = Promise.resolve();
  const tenantId = "tenant-1";
  const tenant = {
    id: tenantId,
    slug: "acme",
    status: options.tenantStatus ?? "active",
    subdomain: "acme",
  };
  for (const user of users) user.tenantId = tenantId;
  let currentContext: any = null;
  const passwordResetRepository = {
      create(value: any) {
        return {
          createdAt: new Date(),
          expired: false,
          id: `reset-${passwordResets.length + 1}`,
          ...value,
        };
      },
      async findOne({ where }: any) {
        return (
          passwordResets.find(
            (record) =>
              record.email === where.email &&
              record.token === where.token &&
              !record.expired,
          ) ?? null
        );
      },
      async save(record: any) {
        passwordResets.push(record);
        return record;
      },
    } as any;
  const userRepository = {
      async findOne({ where }: any) {
        return (
          users.find((user) =>
            Object.entries(where).every(([key, value]) => user[key] === value),
          ) ?? null
        );
      },
      async save(user: any) {
        return user;
      },
    } as any;
  const manager = {
    async query() {},
    async findOne(target: unknown, { where }: any) {
      if (target === PasswordReset) {
        return (
          passwordResets.find(
            (record) =>
              record.email === where.email &&
              record.tenantId === where.tenantId &&
              record.token === where.token &&
              !record.expired,
          ) ?? null
        );
      }
      if (target === User) {
        return (
          users.find((user) =>
            Object.entries(where).every(([key, value]) => user[key] === value),
          ) ?? null
        );
      }
      if (target === Tenant) return tenant;
      return null;
    },
    async delete(_target: unknown, where: any) {
      if (options.failResetDelete) throw new Error("delete failed");
      const index = passwordResets.findIndex(
        (record) => record.id === where.id && record.tenantId === where.tenantId,
      );
      if (index >= 0) {
        passwordResets.splice(index, 1);
        return { affected: 1 };
      }
      return { affected: 0 };
    },
    async save(_target: unknown, user: any) {
      if (_target === Tenant) Object.assign(tenant, user);
      return user;
    },
  };
  const dataSource = {
    getRepository(target: unknown) {
      if (target !== Tenant) throw new Error("unexpected repository");
      return {
        async findOne() {
          return tenant;
        },
      };
    },
    async transaction(callback: (manager: any) => Promise<unknown>) {
          const run = async () => {
            const userSnapshots = users.map((user) => ({
              emailVerified: user.emailVerified,
              id: user.id,
              passwordHash: user.passwordHash,
            }));
            const resetSnapshot = [...passwordResets];
            try {
              return await callback(manager);
            } catch (error) {
              for (const snapshot of userSnapshots) {
                const user = users.find((item) => item.id === snapshot.id);
                if (user) {
                  user.emailVerified = snapshot.emailVerified;
                  user.passwordHash = snapshot.passwordHash;
                }
              }
              passwordResets.splice(0, passwordResets.length, ...resetSnapshot);
              throw error;
            }
          };
          const result = transactionQueue.then(run, run);
          transactionQueue = result.then(
            () => undefined,
            () => undefined,
          );
          return result;
        },
  } as any;
  const tenantContext = {
    current(required = true) {
      if (!currentContext && required) throw new Error("missing context");
      return currentContext;
    },
    repository(target: unknown) {
      if (target === PasswordReset) return passwordResetRepository;
      if (target === User) return userRepository;
      throw new Error("unexpected repository");
    },
    run(context: any, work: () => unknown) {
      const previous = currentContext;
      currentContext = context;
      return Promise.resolve(work()).finally(() => {
        currentContext = previous;
      });
    },
  } as any;
  const service = new PasswordResetService(
    dataSource,
    tenantContext,
    {
      async send(payload: any) {
        sentEmails.push(payload);
      },
    } as any,
    {
      async getPlatformValue(_key: string, fallback: string) {
        return fallback;
      },
      async resolveTenantRuntimePreferences(_tenantId: string, user: any) {
        return {
          currency: "CNY",
          dateFormat: "YYYY-MM-DD",
          language: user.preferredLanguage ?? "zh-Hans",
          regionCode: "CN",
          sources: {
            currency: "code",
            dateFormat: "code",
            language: user.preferredLanguage ? "user" : "code",
            regionCode: "code",
            timeZone: "code",
          },
          timeZone: user.timeZone ?? "Asia/Shanghai",
        };
      },
    } as any,
    dataSource.getRepository(Tenant),
    {
      async resolve(_request: unknown, workspace?: string) {
        const resolved =
          tenant.status === "active" &&
          (tenant.slug === workspace || tenant.subdomain === workspace)
            ? tenant
            : null;
        return resolved ? { source: "workspace", tenant: resolved } : null;
      },
    } as any,
  );

  return {
    memberships,
    passwordResets,
    sentEmails,
    service,
    tenant,
    users,
  };
}

function userRecord(input: { email: string; id: string }) {
  return {
    displayName: input.email.split("@")[0],
    email: input.email.toLowerCase(),
    emailVerified: false,
    id: input.id,
    passwordHash: hashPassword("old-password"),
    preferredLanguage: "zh-Hans",
  };
}
