import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PasswordReset, User } from "@hermes-swarm/core";
import { hashPassword, verifyPassword } from "../../common/security/password-hash.js";
import { PasswordResetService } from "./password-reset.service.js";

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

  it("creates a reset token and sends a reset email through the user organization context", async () => {
    const state = createPasswordResetService({
      memberships: [{ organizationId: "org-1", userId: "user-1" }],
      users: [userRecord({ email: "Admin@Example.com", id: "user-1" })],
    });

    const result = await state.service.requestReset({
      email: " admin@example.com ",
    });

    assert.deepEqual(result, { success: true });
    assert.equal(state.passwordResets.length, 1);
    assert.equal(state.passwordResets[0].email, "admin@example.com");
    assert.equal(state.sentEmails.length, 1);
    assert.equal(state.sentEmails[0].email, "admin@example.com");
    assert.equal(state.sentEmails[0].organizationId, "org-1");
    assert.equal(state.sentEmails[0].templateName, "password-reset");
    assert.match(state.sentEmails[0].locals.resetLink, /\/reset-password\?/);
  });

  it("resets password with a valid token and rejects mismatched confirmation", async () => {
    const user = userRecord({ email: "admin@example.com", id: "user-1" });
    const state = createPasswordResetService({ users: [user] });
    await state.service.requestReset({ email: "admin@example.com" });
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

    assert.deepEqual(result, { success: true });
    assert.equal(verifyPassword("new-password", user.passwordHash), true);
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
    await state.service.requestReset({ email: "admin@example.com" });
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
      verifyPassword("first-password", user.passwordHash) ||
        verifyPassword("second-password", user.passwordHash),
      true,
    );
  });

  it("rolls back password changes when reset token consumption fails", async () => {
    const user = userRecord({ email: "admin@example.com", id: "user-1" });
    const oldPasswordHash = user.passwordHash;
    const state = createPasswordResetService({
      failResetDelete: true,
      users: [user],
    });
    await state.service.requestReset({ email: "admin@example.com" });
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
} = {}) {
  const passwordResets: any[] = [];
  const users = options.users ?? [];
  const memberships = options.memberships ?? [];
  const sentEmails: any[] = [];
  let transactionQueue = Promise.resolve();

  const service = new PasswordResetService(
    {
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
      async delete(where: any) {
        const index = passwordResets.findIndex((record) => record.id === where.id);
        if (index >= 0) passwordResets.splice(index, 1);
      },
    } as any,
    {
      async findOne({ where }: any) {
        return (
          users.find((user) =>
            Object.entries(where).every(([key, value]) => user[key] === value),
          ) ?? null
        );
      },
      manager: {
        async transaction(callback: (manager: any) => Promise<unknown>) {
          const run = async () => {
            const userSnapshots = users.map((user) => ({
              emailVerified: user.emailVerified,
              id: user.id,
              passwordHash: user.passwordHash,
            }));
            const resetSnapshot = [...passwordResets];
            try {
              return await callback({
                async findOne(target: unknown, { where }: any) {
                  if (target === PasswordReset) {
                    return (
                      passwordResets.find(
                        (record) =>
                          record.email === where.email &&
                          record.token === where.token &&
                          !record.expired,
                      ) ?? null
                    );
                  }
                  if (target === User) {
                    return (
                      users.find((user) =>
                        Object.entries(where).every(
                          ([key, value]) => user[key] === value,
                        ),
                      ) ?? null
                    );
                  }
                  return null;
                },
                async delete(_target: unknown, where: any) {
                  if (options.failResetDelete) {
                    throw new Error("delete failed");
                  }
                  const index = passwordResets.findIndex(
                    (record) => record.id === where.id,
                  );
                  if (index >= 0) {
                    passwordResets.splice(index, 1);
                    return { affected: 1 };
                  }
                  return { affected: 0 };
                },
                async save(_target: unknown, user: any) {
                  return user;
                },
              });
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
      },
      async save(user: any) {
        return user;
      },
    } as any,
    {
      async findOne({ where }: any) {
        return memberships.find((item) => item.userId === where.userId) ?? null;
      },
    } as any,
    {
      async send(payload: any) {
        sentEmails.push(payload);
      },
    } as any,
    {
      async getPlatformValue(_key: string, fallback: string) {
        return fallback;
      },
    } as any,
  );

  return {
    memberships,
    passwordResets,
    sentEmails,
    service,
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
  };
}
