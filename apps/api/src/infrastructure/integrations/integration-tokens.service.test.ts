import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import {
  Department,
  IntegrationToken,
  Organization,
  Permission,
  RolePermission,
  User,
  UserDepartment,
  UserDepartmentRole,
  UserOrganization,
  UserOrganizationRole,
  UserTenantRole,
} from "@hermes-swarm/core";
import { IntegrationTokensService } from "./integration-tokens.service.js";

const TENANT_ID = "00000000-0000-4000-8000-000000000001";

describe("IntegrationTokensService", () => {
  it("exposes tenant, organization, and department capabilities from layered roles", async () => {
    const state = createService();

    const result = await state.service.capabilities("Bearer session", "user-1");

    assert.deepEqual(
      result.scopes.map((item) => ({
        departmentId: item.departmentId,
        organizationId: item.organizationId,
        permissions: item.permissions.map((permission) => permission.permission),
        scope: item.scope,
      })),
      [
        {
          departmentId: null,
          organizationId: null,
          permissions: ["tenant.settings.read:tenant"],
          scope: "tenant",
        },
        {
          departmentId: null,
          organizationId: "org-1",
          permissions: ["ticket.list:organization"],
          scope: "organization",
        },
        {
          departmentId: "dept-1",
          organizationId: "org-1",
          permissions: ["ticket.assign:department"],
          scope: "department",
        },
      ],
    );
  });

  it("creates a tenant token with an immutable tenant binding", async () => {
    const state = createService();

    const result = await state.service.create("Bearer session", "user-1", {
      expiresAt: futureIso(),
      permissions: ["tenant.settings.read:tenant"],
      scope: "tenant",
    });

    assert.equal(result.scope, "tenant");
    assert.equal(result.tenantId, TENANT_ID);
    assert.equal(result.organizationId, null);
    assert.equal(result.departmentId, null);
    assert.match(result.token, /^[^.]+\.[^.]+\.[^.]+$/);
    assert.equal(state.records.IntegrationToken.length, 1);
    assert.equal(state.records.IntegrationToken[0].tenantId, TENANT_ID);
  });

  it("creates a department token only for the matching organization department", async () => {
    const state = createService();

    const result = await state.service.create("Bearer session", "user-1", {
      departmentId: "dept-1",
      expiresAt: futureIso(),
      organizationId: "org-1",
      permissions: ["ticket.assign:department"],
      scope: "department",
    });

    assert.equal(result.departmentId, "dept-1");
    assert.equal(result.departmentName, "Support");
    assert.equal(result.organizationId, "org-1");

    await assert.rejects(
      () =>
        state.service.create("Bearer session", "user-1", {
          departmentId: "dept-1",
          organizationId: "org-other",
          permissions: ["ticket.assign:department"],
          scope: "department",
        }),
      ForbiddenException,
    );
  });

  it("enforces scope column combinations", async () => {
    const state = createService();

    await assert.rejects(
      () =>
        state.service.create("Bearer session", "user-1", {
          organizationId: "org-1",
          permissions: ["tenant.settings.read:tenant"],
          scope: "tenant",
        }),
      BadRequestException,
    );
    await assert.rejects(
      () =>
        state.service.create("Bearer session", "user-1", {
          permissions: ["ticket.list:organization"],
          scope: "organization",
        }),
      BadRequestException,
    );
    await assert.rejects(
      () =>
        state.service.create("Bearer session", "user-1", {
          organizationId: "org-1",
          permissions: ["ticket.assign:department"],
          scope: "department",
        }),
      BadRequestException,
    );
    await assert.rejects(
      () =>
        state.service.create("Bearer session", "user-1", {
          permissions: ["tenant.settings.read:tenant"],
          scope: "own" as never,
        }),
      BadRequestException,
    );
  });

  it("rejects permission escalation", async () => {
    const state = createService();
    await assert.rejects(
      () =>
        state.service.create("Bearer session", "user-1", {
          permissions: ["tenant.settings.write:tenant"],
          scope: "tenant",
        }),
      ForbiddenException,
    );
    assert.equal(state.records.IntegrationToken.length, 0);
  });

  it("rejects malformed payloads before repository writes", async () => {
    const state = createService();
    await assert.rejects(
      () => state.service.create("Bearer session", "user-1", null as never),
      BadRequestException,
    );
    await assert.rejects(
      () =>
        state.service.create("Bearer session", "user-1", {
          permissions: "tenant.settings.read:tenant" as never,
          scope: "tenant",
        }),
      BadRequestException,
    );
    await assert.rejects(
      () =>
        state.service.create("Bearer session", "user-1", {
          note: "x".repeat(161),
          permissions: ["tenant.settings.read:tenant"],
          scope: "tenant",
        }),
      BadRequestException,
    );
    assert.equal(state.records.IntegrationToken.length, 0);
  });

  it("rejects platform sessions, cross-tenant sessions, and integration tokens", async () => {
    const platform = createService({
      session: {
        principalType: "platform",
        sessionId: "platform-session",
        tenantId: null,
        tokenKind: "session",
        userId: "platform-user-1",
      },
    });
    await assert.rejects(
      () => platform.service.list("Bearer session", "platform-user-1"),
      ForbiddenException,
    );

    const crossTenant = createService({
      session: tenantSession("00000000-0000-4000-8000-000000000002"),
    });
    await assert.rejects(
      () => crossTenant.service.list("Bearer session", "user-1"),
      ForbiddenException,
    );

    const integration = createService({
      session: { ...tenantSession(TENANT_ID), tokenKind: "integration" },
    });
    await assert.rejects(
      () => integration.service.list("Bearer token", "user-1"),
      ForbiddenException,
    );
  });

  it("lists and revokes only tokens inside the requested tenant scope", async () => {
    const state = createService({
      tokens: [
        tokenRecord({ id: "tenant-token", scope: "tenant" }),
        tokenRecord({
          id: "org-token",
          organizationId: "org-1",
          scope: "organization",
        }),
        tokenRecord({
          departmentId: "dept-1",
          id: "dept-token",
          organizationId: "org-1",
          scope: "department",
        }),
      ],
    });

    const organizationTokens = await state.service.listOrganization(
      "Bearer session",
      "org-1",
    );
    assert.deepEqual(organizationTokens.map((item) => item.id), ["org-token"]);

    const departmentTokens = await state.service.listDepartment(
      "Bearer session",
      "org-1",
      "dept-1",
    );
    assert.deepEqual(departmentTokens.map((item) => item.id), ["dept-token"]);

    await state.service.revokeDepartment(
      "Bearer session",
      "org-1",
      "dept-1",
      "dept-token",
    );
    assert.ok(state.records.IntegrationToken[2].revokedAt instanceof Date);

    await assert.rejects(
      () =>
        state.service.revokeDepartment(
          "Bearer session",
          "org-1",
          "dept-other",
          "dept-token",
        ),
      NotFoundException,
    );
  });

  it("caps token expiry at one year", async () => {
    const state = createService();
    await assert.rejects(
      () =>
        state.service.create("Bearer session", "user-1", {
          expiresAt: "2099-01-01T00:00:00Z",
          permissions: ["tenant.settings.read:tenant"],
          scope: "tenant",
        }),
      BadRequestException,
    );
  });
});

type Session = {
  principalType: "integration" | "platform" | "tenant";
  sessionId: string;
  tenantId: string | null;
  tokenKind: "integration" | "session";
  userId: string;
};

function createService(
  options: { session?: Session; tokens?: any[] } = {},
) {
  const records: Record<string, any[]> = {
    Department: [
      {
        id: "dept-1",
        name: "Support",
        organizationId: "org-1",
        status: "active",
        tenantId: TENANT_ID,
      },
    ],
    IntegrationToken: options.tokens ?? [],
    Organization: [
      {
        id: "org-1",
        name: "Hermes",
        status: "active",
        tenantId: TENANT_ID,
      },
    ],
    Permission: [
      permissionRecord("tenant.settings.read:tenant", "tenant"),
      permissionRecord("ticket.list:organization", "organization"),
      permissionRecord("ticket.assign:department", "department"),
    ],
    RolePermission: [
      rolePermission("tenant-role", "integration_token.tenant_integration.create:tenant"),
      rolePermission("tenant-role", "tenant.settings.read:tenant"),
      rolePermission(
        "organization-role",
        "integration_token.organization_integration.create:organization",
      ),
      rolePermission("organization-role", "ticket.list:organization"),
      rolePermission(
        "department-role",
        "integration_token.department_integration.create:department",
      ),
      rolePermission("department-role", "ticket.assign:department"),
    ],
    User: [
      {
        avatarUrl: null,
        displayName: "Owner",
        email: "owner@example.com",
        id: "user-1",
        imageUrl: null,
        tenantId: TENANT_ID,
        username: "owner",
      },
    ],
    UserDepartment: [
      {
        department: {
          id: "dept-1",
          name: "Support",
          organizationId: "org-1",
          status: "active",
        },
        departmentId: "dept-1",
        id: "department-membership-1",
        membershipId: "membership-1",
        status: "active",
        tenantId: TENANT_ID,
      },
    ],
    UserDepartmentRole: [
      {
        roleId: "department-role",
        tenantId: TENANT_ID,
        userDepartmentId: "department-membership-1",
      },
    ],
    UserOrganization: [
      {
        id: "membership-1",
        organization: {
          id: "org-1",
          name: "Hermes",
          status: "active",
        },
        organizationId: "org-1",
        status: "active",
        tenantId: TENANT_ID,
        userId: "user-1",
      },
    ],
    UserOrganizationRole: [
      {
        membershipId: "membership-1",
        roleId: "organization-role",
        tenantId: TENANT_ID,
      },
    ],
    UserTenantRole: [
      { roleId: "tenant-role", tenantId: TENANT_ID, userId: "user-1" },
    ],
  };
  const targets = {
    [Department.name]: Department,
    [IntegrationToken.name]: IntegrationToken,
    [Organization.name]: Organization,
    [Permission.name]: Permission,
    [RolePermission.name]: RolePermission,
    [User.name]: User,
    [UserDepartment.name]: UserDepartment,
    [UserDepartmentRole.name]: UserDepartmentRole,
    [UserOrganization.name]: UserOrganization,
    [UserOrganizationRole.name]: UserOrganizationRole,
    [UserTenantRole.name]: UserTenantRole,
  };
  const repositories = new Map(
    Object.entries(targets).map(([name, target]) => [
      target,
      createRepository(records[name]),
    ]),
  );
  const tenantContext = {
    current: () => ({
      departmentId: null,
      manager: { getRepository: (target: unknown) => repositories.get(target) },
      organizationId: null,
      scopeLevel: "tenant",
      tenantId: TENANT_ID,
    }),
    repository: (target: unknown) => repositories.get(target),
  } as any;
  const service = new IntegrationTokensService(
    {
      validateAccessToken: async () => options.session ?? tenantSession(TENANT_ID),
    } as any,
    { getOrThrow: () => "test-secret" } as any,
    tenantContext,
  );
  return { records, service };
}

function createRepository(records: any[]) {
  return {
    create(value: any) {
      return {
        createdAt: new Date("2026-01-01T00:00:00Z"),
        lastUsedAt: null,
        revokedAt: null,
        updatedAt: new Date("2026-01-01T00:00:00Z"),
        ...value,
      };
    },
    async find(options: any = {}) {
      return records.filter((record) => matches(record, options.where ?? {}));
    },
    async findOne(options: any = {}) {
      return records.find((record) => matches(record, options.where ?? {})) ?? null;
    },
    async save(value: any) {
      const index = records.findIndex((record) => record.id === value.id);
      if (index >= 0) records[index] = value;
      else records.push(value);
      return value;
    },
  };
}

function matches(record: any, where: any) {
  if (Array.isArray(where)) return where.some((item) => matches(record, item));
  return Object.entries(where).every(([key, expected]) => {
    if (
      expected &&
      typeof expected === "object" &&
      "_type" in (expected as Record<string, unknown>)
    ) {
      const operator = expected as { _type: string; _value: unknown[] };
      return operator._type === "in" && operator._value.includes(record[key]);
    }
    return record[key] === expected;
  });
}

function tenantSession(tenantId: string): Session {
  return {
    principalType: "tenant",
    sessionId: "session-1",
    tenantId,
    tokenKind: "session",
    userId: "user-1",
  };
}

function permissionRecord(code: string, scope: string) {
  return {
    code,
    description: code,
    entity: "test",
    entityLabel: "Test",
    entityOrder: 1,
    isDangerous: false,
    operation: "read",
    operationLabel: code,
    operationOrder: 1,
    purpose: "test",
    purposeLabel: "Test",
    purposeOrder: 1,
    scope,
  };
}

function rolePermission(roleId: string, permission: string) {
  return { enabled: true, permission, roleId, tenantId: TENANT_ID };
}

function tokenRecord(overrides: Record<string, unknown>) {
  return {
    createdAt: new Date("2026-01-01T00:00:00Z"),
    departmentId: null,
    expiresAt: futureDate(),
    lastUsedAt: null,
    note: null,
    organizationId: null,
    ownerUserId: "user-1",
    permissions: [],
    revokedAt: null,
    tenantId: TENANT_ID,
    tokenPrefix: "prefix",
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function futureDate(days = 30) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function futureIso(days = 30) {
  return futureDate(days).toISOString();
}
