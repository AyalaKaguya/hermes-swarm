import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { UnauthorizedException } from "@nestjs/common";
import { hashPassword } from "../../common/security/password-hash.js";
import { AuthService } from "./auth.service.js";

describe("AuthService unified account contexts", () => {
  it("logs a global account into a workspaceless platform context", async () => {
    const created: unknown[][] = [];
    const service = createService({
      authSessionService: {
        createSession: async (...args: unknown[]) => {
          created.push(args);
          return issuedSession("platform");
        },
        getRefreshCookieName: () => "refresh",
        getRefreshCookieOptions: () => ({}),
      },
      accountRepository: { findOne: async () => platformAccount() },
      membershipRepository: { find: async () => [] },
      platformMembershipRepository: {
        findOne: async () => platformMembership(),
      },
    });
    const result = await service.login(
      { contextType: "platform", email: "admin@example.com", password: "password-123" },
      {},
      { cookie() {} },
    );
    assert.deepEqual(created[0]?.slice(0, 3), ["account-platform", null, "platform"]);
    assert.equal(result.snapshot.principalType, "platform");
    assert.deepEqual(result.snapshot.systemSettings, [platformTitleSetting()]);
  });

  it("serializes platform role permissions in the web session contract", async () => {
    const service = createService({
      authSessionService: {
        createSession: async () => issuedSession("platform"),
        getRefreshCookieName: () => "refresh",
        getRefreshCookieOptions: () => ({}),
      },
      accountRepository: { findOne: async () => platformAccount() },
      membershipRepository: { find: async () => [] },
      platformMembershipRepository: { findOne: async () => platformMembership() },
    });

    const result = await service.login(
      { contextType: "platform", email: "admin@example.com", password: "password-123" },
      {},
      { cookie() {} },
    );

    assert.deepEqual(result.snapshot.permissions, [
      "role.platform_role.list:platform",
    ]);
  });

  it("verifies the global account before selecting its requested workspace membership", async () => {
    const accountQueries: unknown[] = [];
    const account = {
      email: "shared@example.com",
      id: "account-a",
      passwordHash: hashPassword("workspace-password"),
      status: "active",
    };
    const service = createService({
      accountRepository: {
        findOne: async (query: unknown) => {
          accountQueries.push(query);
          return account;
        },
      },
      membershipRepository: {
        find: async () => [{
          accountId: "account-a",
          id: "membership-a",
          role: { id: "role-a", name: "workspace-member", scope: "workspace" },
          roleId: "role-a",
          status: "active",
          workspace: { id: "workspace-a", name: "A", slug: "a", status: "active" },
          workspaceId: "workspace-a",
        }],
      },
      workspaceLoginResolver: {
        resolve: async () => ({ source: "workspace", workspace: { id: "workspace-a", name: "A", slug: "a" } }),
      },
    });
    (service as unknown as { createWorkspaceLoginResponse: (account: unknown) => unknown }).createWorkspaceLoginResponse =
      async () => ({ accountId: "account-a" });
    const result = await service.login(
      { email: "Shared@Example.com", password: "workspace-password", workspaceSlug: "a" },
      {},
      { cookie() {} },
    );
    assert.deepEqual((accountQueries[0] as { where: unknown }).where, {
      email: "shared@example.com",
    });
    assert.deepEqual(result, { accountId: "account-a" });
  });

  it("does not establish a session when a global account has no active membership", async () => {
    const service = createService({
      accountRepository: {
        findOne: async () => ({
          email: "shared@example.com",
          id: "account-a",
          passwordHash: hashPassword("password-123"),
          status: "active",
        }),
      },
      membershipRepository: { find: async () => [] },
      workspaceLoginResolver: { resolve: async () => null },
    });
    await assert.rejects(
      service.login(
        { email: "shared@example.com", password: "password-123" },
        {},
        { cookie() {} },
      ),
      UnauthorizedException,
    );
  });

  it("records successful platform logins without exposing credentials", async () => {
    const auditRows: Array<Record<string, unknown>> = [];
    const service = createService({
      authSessionService: {
        createSession: async () => issuedSession("platform"),
        getRefreshCookieName: () => "refresh",
        getRefreshCookieOptions: () => ({}),
      },
      loginAuditService: {
        record: async (row: Record<string, unknown>) => auditRows.push(row),
      },
      accountRepository: {
        findOne: async () => ({ ...platformAccount(), id: "00000000-0000-4000-8000-000000000001" }),
      },
      membershipRepository: { find: async () => [] },
      platformMembershipRepository: { findOne: async () => platformMembership() },
    });

    await service.login(
      { contextType: "platform", email: "Admin@Example.com", password: "password-123" },
      {
        headers: {
          "user-agent": "Mozilla/5.0 Chrome/120.0 Windows NT 10.0",
        },
        socket: { remoteAddress: "203.0.113.10" },
      },
      { cookie() {} },
    );

    assert.deepEqual(auditRows, [
      {
        actorId: "00000000-0000-4000-8000-000000000001",
        attemptedEmail: "admin@example.com",
        ipAddress: "203.0.113.10",
        result: "success",
        scopeType: "platform",
        sessionId: "session",
        userAgent: "Mozilla/5.0 Chrome/120.0 Windows NT 10.0",
        workspaceId: null,
      },
    ]);
    assert.equal("password" in auditRows[0], false);
  });

  it("records unresolved workspace login failures without assigning a workspace", async () => {
    const auditRows: Array<Record<string, unknown>> = [];
    const service = createService({
      accountRepository: { findOne: async () => null },
      loginAuditService: {
        record: async (row: Record<string, unknown>) => auditRows.push(row),
      },
      workspaceLoginResolver: { resolve: async () => null },
    });

    await assert.rejects(
      service.login(
        {
          email: "owner@example.com",
          password: "wrong-password",
          workspaceSlug: "missing",
        },
        {},
        { cookie() {} },
      ),
      UnauthorizedException,
    );

    assert.equal(auditRows[0]?.failureCode, "invalid_credentials");
    assert.equal(auditRows[0]?.scopeType, "workspace");
    assert.equal(auditRows[0]?.workspaceId, null);
  });
});

function createService(options: Record<string, Record<string, unknown>> = {}) {
  return new AuthService(
    (options.authSessionService ?? {}) as never,
    (options.platformMembershipRepository ?? { findOne: async () => null }) as never,
    (options.dataSource ?? {}) as never,
    { run: (_context: unknown, work: () => unknown) => work() } as never,
    (options.workspaceLoginResolver ?? { resolve: async () => null }) as never,
    (options.settingsService ?? {
      listPlatformSettings: async () => [platformTitleSetting()],
      resolvePlatformRuntimePreferences: async () => ({
        currency: "CNY",
        dateFormat: "YYYY-MM-DD",
        language: "zh-Hans",
        regionCode: "CN",
        sources: {
          currency: "code",
          dateFormat: "code",
          language: "code",
          regionCode: "code",
          timeZone: "code",
        },
        timeZone: "Asia/Shanghai",
      }),
    }) as never,
    options.loginAuditService as never,
    options.accountRepository as never,
    options.membershipRepository as never,
  );
}

function platformTitleSetting() {
  return {
    id: "platform-title",
    name: "platform.title",
    scope: "platform",
    value: "Hermes Swarm",
    valueOptions: null,
    valueType: "string",
  };
}

function platformAccount() {
  return {
    credentialVersion: 0,
    displayName: "Platform Admin",
    email: "admin@example.com",
    id: "account-platform",
    passwordHash: hashPassword("password-123"),
    status: "active",
  };
}

function platformMembership() {
  return {
    accountId: "account-platform",
    id: "platform-membership",
    role: {
      description: "Platform administrator",
      displayName: "Platform Admin",
      id: "platform-role",
      isSystem: true,
      label: "Platform Admin",
      name: "platform-admin",
      rolePermissions: [{
        enabled: true,
        id: "platform-role-permission",
        permissionId: "permission",
        permissionRecord: { code: "role.platform_role.list:platform" },
        roleId: "platform-role",
      }],
      scope: "platform",
      workspaceId: null,
    },
    roleId: "platform-role",
    status: "active",
  };
}

function issuedSession(principalType: "platform" | "workspace") {
  return {
    accessToken: "access",
    expiresAt: "2030-01-01T00:00:00.000Z",
    principalType,
    refreshToken: "refresh",
    sessionId: "session",
    workspaceId: principalType === "workspace" ? "workspace-a" : null,
  };
}
