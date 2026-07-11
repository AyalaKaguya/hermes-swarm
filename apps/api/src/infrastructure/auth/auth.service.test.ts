import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { UnauthorizedException } from "@nestjs/common";
import { AuthService } from "./auth.service.js";
import { hashPassword } from "../../common/security/password-hash.js";
import {
  OrganizationGroupMember,
  RolePermission,
  Tenant,
  User,
  UserDepartment,
  UserDepartmentRole,
  UserOrganization,
  UserTenantRole,
} from "@hermes-swarm/core";

describe("AuthService interactive session guard", () => {
  it("logs platform users into a tenantless platform session", async () => {
    const created: any[] = [];
    const cookies: any[] = [];
    const service = createAuthService({
      authSessionService: {
        createSession: async (...args: any[]) => {
          created.push(args);
          return {
            accessToken: "platform-access",
            expiresAt: "2026-07-12T00:00:00.000Z",
            refreshToken: "platform-refresh",
            sessionId: "platform-session",
          };
        },
        getRefreshCookieName: () => "hermes_refresh",
        getRefreshCookieOptions: () => ({ path: "/api/admin/auth" }),
      },
      platformUserRepository: {
        findOne: async () => ({
          displayName: "Platform Admin",
          email: "admin@example.com",
          id: "platform-user-1",
          passwordHash: hashPassword("password-123"),
          roles: [],
          status: "active",
        }),
      },
    });

    const result = await service.loginPlatform(
      { email: "admin@example.com", password: "password-123" },
      {},
      { cookie: (...args: any[]) => cookies.push(args) },
    );

    assert.deepEqual(created[0]?.slice(0, 3), [
      "platform-user-1",
      null,
      "platform",
    ]);
    assert.equal(result.snapshot.principalType, "platform");
    assert.equal(cookies.length, 1);
  });

  it("rejects malformed login payloads before querying users", async () => {
    let queried = false;
    const service = createAuthService({
      userRepository: {
        findOne: async () => {
          queried = true;
          return null;
        },
      },
    });

    await assert.rejects(
      () => service.login(null as any, {}, { cookie() {} }),
      UnauthorizedException,
    );
    await assert.rejects(
      () =>
        service.login(
          { email: 42, password: "password-123" } as any,
          {},
          { cookie() {} },
        ),
      UnauthorizedException,
    );
    assert.equal(queried, false);
  });

  it("returns a refresh result after AuthSessionService validates the principal", async () => {
    const revoked: any[] = [];
    const cleared: any[] = [];
    const cookies: any[] = [];
    const service = createAuthService({
      authSessionService: {
        getClearRefreshCookieOptions: () => ({ path: "/api/admin/auth" }),
        getRefreshCookieName: () => "hermes_refresh",
        getRefreshCookieOptions: () => ({ path: "/api/admin/auth" }),
        refreshSession: async () => ({
          accessToken: "next-access",
          expiresAt: "2026-07-09T00:00:00.000Z",
          principalType: "tenant",
          refreshToken: "next-refresh",
          sessionId: "session-1",
          tenantId: "tenant-1",
          userId: "user-1",
        }),
        revokeSession: async (...args: any[]) => {
          revoked.push(args);
        },
      },
      userRepository: {
        findOne: async ({ where }: any) =>
          where.status === "active"
            ? null
            : { id: "user-1", status: "disabled" },
      },
    });

    await service.refresh(
      { headers: { cookie: "hermes_refresh=refresh-token" } },
      {
        clearCookie: (...args: any[]) => cleared.push(args),
        cookie: (...args: any[]) => cookies.push(args),
      },
    );

    assert.deepEqual(revoked, []);
    assert.equal(cleared.length, 0);
    assert.equal(cookies.length, 1);
  });

  it("rejects integration tokens from login session management", async () => {
    const service = createAuthService({
      authSessionService: {
        validateAccessToken: async () => ({
          integrationToken: {
            id: "token-1",
            organizationId: null,
            permissions: ["page.home.access:own"],
            scope: "own",
          },
          sessionId: "integration:token-1",
          tokenKind: "integration",
          userId: "user-1",
        }),
      },
    });

    await assert.rejects(
      () => service.listSessions("Bearer integration-token"),
      UnauthorizedException,
    );
  });

  it("returns a tenant-scoped principal snapshot without legacy platform membership", async () => {
    const user = {
      displayName: "Tenant Owner",
      email: "owner@example.com",
      id: "user-1",
      status: "active",
      tenantId: "tenant-1",
      type: "user",
    };
    const tenantRole = { id: "tenant-role-1", name: "tenant-owner", scope: "tenant" };
    const organizationRole = { id: "org-role-1", name: "owner", scope: "organization" };
    const departmentRole = { id: "dept-role-1", name: "department-manager", scope: "department" };
    const membership = {
      id: "membership-1",
      isDefault: true,
      organization: { id: "org-1", name: "Default Org" },
      organizationId: "org-1",
      role: organizationRole,
      roleId: organizationRole.id,
      status: "active",
      tenantId: "tenant-1",
      user,
      userId: user.id,
    };
    const repositories = new Map<any, any>([
      [User, { findOne: async () => user }],
      [Tenant, { findOne: async () => ({ id: "tenant-1", name: "Tenant", slug: "tenant" }) }],
      [UserOrganization, { find: async () => [membership] }],
      [OrganizationGroupMember, { find: async () => [] }],
      [UserTenantRole, { find: async () => [{ role: tenantRole, roleId: tenantRole.id }] }],
      [UserDepartment, { find: async () => [{ department: { id: "dept-1", name: "Support" }, departmentId: "dept-1", id: "user-dept-1", isDefault: true, joinedAt: null, membershipId: membership.id, organizationId: "org-1", status: "active", tenantId: "tenant-1" }] }],
      [UserDepartmentRole, { find: async () => [{ role: departmentRole, roleId: departmentRole.id, userDepartmentId: "user-dept-1" }] }],
      [RolePermission, { find: async () => [
        { enabled: true, permission: "tenant.manage", roleId: tenantRole.id },
        { enabled: true, permission: "organization.manage", roleId: organizationRole.id },
        { enabled: true, permission: "department.manage", roleId: departmentRole.id },
      ] }],
    ]);
    const manager = {
      getRepository: (entity: any) => repositories.get(entity),
      query: async () => undefined,
    };
    const service = new AuthService(
      repositories.get(User),
      repositories.get(UserOrganization),
      repositories.get(OrganizationGroupMember),
      repositories.get(RolePermission),
      { validateAccessToken: async () => ({ principalType: "tenant", tenantId: "tenant-1", userId: user.id }) } as any,
      { listPlatformSettings: async () => [] } as any,
      {} as any,
      repositories.get(Tenant),
      { transaction: async (work: any) => work(manager) } as any,
      { run: (_context: any, work: any) => work() } as any,
    );

    const snapshot = await service.me("Bearer tenant-access") as any;

    assert.equal(snapshot.principalType, "tenant");
    assert.equal(snapshot.tenantId, "tenant-1");
    assert.deepEqual(snapshot.allowedScopes, ["tenant", "organization", "department"]);
    assert.equal(snapshot.defaultScope.level, "department");
    assert.equal(snapshot.tenantRoles[0].name, "tenant-owner");
    assert.equal(snapshot.departmentMemberships[0].roles[0].name, "department-manager");
    assert.equal("platformMembership" in snapshot, false);
  });
});

function createAuthService(options: {
  authSessionService?: Record<string, any>;
  userRepository?: Record<string, any>;
  platformUserRepository?: Record<string, any>;
} = {}) {
  return new AuthService(
    (options.userRepository ?? {}) as any,
    {} as any,
    {} as any,
    {} as any,
    (options.authSessionService ?? {}) as any,
    {} as any,
    (options.platformUserRepository ?? {}) as any,
    {} as any,
    {} as any,
    {} as any,
  );
}
