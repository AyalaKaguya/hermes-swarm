import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hashPassword, verifyPassword } from "../../common/security/password-hash.js";
import { PasswordResetService } from "./password-reset.service.js";

describe("PasswordResetService", () => {
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
});

function createPasswordResetService(options: {
  memberships?: Array<{ organizationId: string; userId: string }>;
  users?: ReturnType<typeof userRecord>[];
} = {}) {
  const passwordResets: any[] = [];
  const users = options.users ?? [];
  const memberships = options.memberships ?? [];
  const sentEmails: any[] = [];

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
