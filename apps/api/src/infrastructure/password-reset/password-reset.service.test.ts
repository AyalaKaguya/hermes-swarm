import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Account, PasswordReset } from "@hermes-swarm/core";
import { hashPassword, verifyPassword } from "../../common/security/password-hash.js";
import { PasswordResetService } from "./password-reset.service.js";

describe("PasswordResetService global account contract", () => {
  it("returns success without disclosing unknown accounts", async () => {
    const state = createState();

    assert.deepEqual(
      await state.service.requestReset({ email: "missing@example.com" }),
      { success: true },
    );
    assert.equal(state.resets.length, 0);
    assert.equal(state.sentEmails.length, 0);
  });

  it("creates one global reset token without workspace identity", async () => {
    const account = accountRecord();
    const state = createState([account]);

    await state.service.requestReset({ email: " ACCOUNT@EXAMPLE.COM " });

    assert.equal(state.resets.length, 1);
    assert.equal(state.resets[0]?.email, "account@example.com");
    assert.equal("workspaceId" in state.resets[0], false);
    assert.equal(state.sentEmails[0]?.templateName, "password-reset");
    assert.match(state.sentEmails[0]?.locals.resetLink, /reset-password/);
  });

  it("changes the global credential once and revokes every account session", async () => {
    const account = accountRecord();
    const state = createState([account]);
    await state.service.requestReset({ email: account.email });
    const token = state.resets[0]!.token;

    const result = await state.service.resetPassword({
      confirmPassword: "new-password",
      email: account.email,
      password: "new-password",
      token,
    });

    assert.deepEqual(result, { reauthenticationRequired: true, success: true });
    assert.equal(await verifyPassword("new-password", account.passwordHash), true);
    assert.equal(account.credentialVersion, 2);
    assert.equal(state.resets.length, 0);
    assert.deepEqual(state.revokedAccounts, [account.id]);
    await assert.rejects(
      state.service.resetPassword({
        confirmPassword: "another-password",
        email: account.email,
        password: "another-password",
        token,
      }),
      { message: "令牌无效或已过期" },
    );
  });

  it("rejects mismatched email and password confirmation before mutation", async () => {
    const account = accountRecord();
    const state = createState([account]);
    await state.service.requestReset({ email: account.email });
    const token = state.resets[0]!.token;

    await assert.rejects(
      state.service.resetPassword({
        confirmPassword: "different-password",
        email: account.email,
        password: "new-password",
        token,
      }),
      { message: "两次输入的密码不一致" },
    );
    await assert.rejects(
      state.service.resetPassword({
        confirmPassword: "new-password",
        email: "other@example.com",
        password: "new-password",
        token,
      }),
      { message: "邮箱与令牌不匹配" },
    );
    assert.equal(account.credentialVersion, 1);
    assert.equal(state.resets.length, 1);
  });
});

function createState(accounts: any[] = []) {
  const resets: any[] = [];
  const sentEmails: any[] = [];
  const revokedAccounts: string[] = [];
  const accountRepository = {
    findOne: async ({ where }: any) =>
      accounts.find((account) => account.email === where.email) ?? null,
  };
  const resetRepository = {
    create: (value: any) => ({
      createdAt: new Date(),
      expired: false,
      id: `reset-${resets.length + 1}`,
      ...value,
    }),
    save: async (value: any) => {
      resets.push(value);
      return value;
    },
  };
  const manager = {
    delete: async (target: unknown, { id }: any) => {
      if (target !== PasswordReset) return { affected: 0 };
      const index = resets.findIndex((item) => item.id === id);
      if (index < 0) return { affected: 0 };
      resets.splice(index, 1);
      return { affected: 1 };
    },
    findOne: async (target: unknown, { where }: any) => {
      if (target === PasswordReset) {
        return resets.find(
          (item) => item.email === where.email && item.token === where.token,
        ) ?? null;
      }
      if (target === Account) {
        return accounts.find((item) => item.id === where.id) ?? null;
      }
      return null;
    },
    save: async (_target: unknown, value: any) => value,
  };
  const service = new PasswordResetService(
    { transaction: async (work: (manager: any) => unknown) => work(manager) } as never,
    accountRepository as never,
    resetRepository as never,
    { send: async (value: any) => sentEmails.push(value) } as never,
    { getPlatformValue: async (_key: string, fallback: string) => fallback } as never,
    { revokeAccountSessions: async (accountId: string) => revokedAccounts.push(accountId) } as never,
  );
  return { resets, revokedAccounts, sentEmails, service };
}

function accountRecord() {
  return {
    credentialVersion: 1,
    credentialsChangedAt: null,
    email: "account@example.com",
    emailVerified: false,
    id: "account-1",
    passwordHash: hashPassword("old-password"),
    preferredLanguage: "zh-Hans",
    status: "active",
    updatedAt: new Date(),
  };
}
