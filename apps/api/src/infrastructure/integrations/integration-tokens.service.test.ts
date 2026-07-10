import { createHash, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { IntegrationTokensService } from "./integration-tokens.service.js";
import { AuthSessionService } from "../auth/auth-session.service.js";
import {
  INTEGRATION_SESSION_PREFIX,
  createAuthSessionToken,
} from "../auth/auth-session.js";

describe("IntegrationTokensService", () => {
  it("rejects malformed integration token payloads before repository writes", async () => {
    let saved = false;
    const service = new IntegrationTokensService(
      {
        create: (value: any) => value,
        save: async (value: any) => {
          saved = true;
          return value;
        },
      } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {
        validateAccessToken: async () => ({
          sessionId: "session-1",
          tokenKind: "session",
          userId: "user-1",
        }),
      } as any,
      { getOrThrow: () => "test-secret" } as any,
    );

    await assert.rejects(
      () => service.create("Bearer login-token", "user-1", null as any),
      BadRequestException,
    );
    await assert.rejects(
      () =>
        service.create("Bearer login-token", "user-1", {
          permissions: "page.home.access:own",
          scope: "own",
        } as any),
      BadRequestException,
    );
    await assert.rejects(
      () =>
        service.create("Bearer login-token", "user-1", {
          permissions: ["page.home.access:own", 42],
          scope: "own",
        } as any),
      BadRequestException,
    );
    await assert.rejects(
      () =>
        service.create("Bearer login-token", "user-1", {
          expiresAt: {},
          permissions: ["page.home.access:own"],
          scope: "own",
        } as any),
      BadRequestException,
    );

    assert.equal(saved, false);
  });

  it("rejects overlong notes instead of silently truncating token metadata", async () => {
    let saved = false;
    const service = new IntegrationTokensService(
      {
        create: (value: any) => value,
        save: async (value: any) => {
          saved = true;
          return value;
        },
      } as any,
      {} as any,
      {} as any,
      {
        find: async ({ where }: any) =>
          where.scope === "own"
            ? [
                {
                  code: "page.home.access:own",
                  description: "Home access",
                  isDangerous: false,
                  operationLabel: "访问主页",
                },
              ]
            : [],
      } as any,
      { findOne: async () => null } as any,
      {
        find: async () => [
          {
            enabled: true,
            permission: "page.home.access:own",
            roleId: "role-1",
          },
        ],
        findOne: async () => null,
      } as any,
      {
        find: async () => [
          {
            organizationId: "org-1",
            roleId: "role-1",
            status: "active",
            userId: "user-1",
          },
        ],
      } as any,
      {
        validateAccessToken: async () => ({
          sessionId: "session-1",
          tokenKind: "session",
          userId: "user-1",
        }),
      } as any,
      { getOrThrow: () => "test-secret" } as any,
    );

    await assert.rejects(
      () =>
        service.create("Bearer login-token", "user-1", {
          expiresAt: futureIso(),
          note: "x".repeat(161),
          permissions: ["page.home.access:own"],
          scope: "own",
        }),
      BadRequestException,
    );

    assert.equal(saved, false);
  });

  it("rejects organization ids on non-organization token scopes", async () => {
    let saved = false;
    const service = new IntegrationTokensService(
      {
        create: (value: any) => value,
        save: async (value: any) => {
          saved = true;
          return value;
        },
      } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {
        validateAccessToken: async () => ({
          sessionId: "session-1",
          tokenKind: "session",
          userId: "user-1",
        }),
      } as any,
      { getOrThrow: () => "test-secret" } as any,
    );

    await assert.rejects(
      () =>
        service.create("Bearer login-token", "user-1", {
          expiresAt: futureIso(),
          organizationId: "org-1",
          permissions: ["page.home.access:own"],
          scope: "own",
        }),
      BadRequestException,
    );

    assert.equal(saved, false);
  });

  it("rejects organization-scoped token creation when the organization is unavailable", async () => {
    let saved = false;
    const service = new IntegrationTokensService(
      {
        create: (value: any) => value,
        save: async (value: any) => {
          saved = true;
          return value;
        },
      } as any,
      {} as any,
      {
        find: async () => [],
        findOne: async ({ where }: any) =>
          where.id === "org-suspended"
            ? { id: "org-suspended", name: "Suspended", status: "suspended" }
            : null,
      } as any,
      {
        find: async ({ where }: any) =>
          where.scope === "organization"
            ? [
                {
                  code: "ticket.conversation.list_organization:organization",
                  description: "List tickets",
                  isDangerous: false,
                  operationLabel: "查看组织工单",
                },
              ]
            : [],
      } as any,
      { findOne: async () => null } as any,
      {
        findOne: async ({ where }: any) =>
          where.permission ===
            "integration_token.organization_integration.create:organization" &&
          where.roleId === "role-1" &&
          where.enabled
            ? {
                enabled: true,
                permission:
                  "integration_token.organization_integration.create:organization",
                roleId: "role-1",
              }
            : null,
        find: async () => [
          {
            enabled: true,
            permission: "ticket.conversation.list_organization:organization",
            roleId: "role-1",
          },
        ],
      } as any,
      {
        find: async () => [
          {
            organization: { id: "org-suspended", name: "Suspended" },
            organizationId: "org-suspended",
            roleId: "role-1",
            status: "active",
            userId: "user-1",
          },
        ],
      } as any,
      {
        validateAccessToken: async () => ({
          sessionId: "session-1",
          tokenKind: "session",
          userId: "user-1",
        }),
      } as any,
      { getOrThrow: () => "test-secret" } as any,
    );

    await assert.rejects(
      () =>
        service.create("Bearer login-token", "user-1", {
          expiresAt: futureIso(),
          organizationId: "org-suspended",
          permissions: ["ticket.conversation.list_organization:organization"],
          scope: "organization",
        }),
      ForbiddenException,
    );

    assert.equal(saved, false);
  });

  it("creates a scoped token and validates it without a login session record", async () => {
    let savedToken: any = null;
    const tokenRepository = {
      create: (value: any) => ({
        createdAt: new Date("2026-07-07T00:00:00Z"),
        updatedAt: new Date("2026-07-07T00:00:00Z"),
        ...value,
      }),
      findOne: async ({ where }: any) =>
        savedToken &&
        where.id === savedToken.id &&
        where.ownerUserId === savedToken.ownerUserId &&
        (!where.tokenHash || where.tokenHash === savedToken.tokenHash)
          ? savedToken
          : null,
      save: async (value: any) => {
        savedToken = {
          ...savedToken,
          ...value,
          createdAt: value.createdAt ?? savedToken?.createdAt ?? new Date(),
          updatedAt: new Date(),
        };
        return savedToken;
      },
      update: async (_where: any, value: any) => {
        savedToken = { ...savedToken, ...value, updatedAt: new Date() };
        return { affected: savedToken ? 1 : 0 };
      },
    };
    const service = new IntegrationTokensService(
      tokenRepository as any,
      { find: async () => [], findOne: async () => null } as any,
      {
        find: async () => [],
        findOne: async ({ where }: any) =>
          where.id === "org-1"
            ? { id: "org-1", name: "Hermes", status: "active" }
            : null,
      } as any,
      {
        find: async ({ where }: any) =>
          where.scope === "organization"
            ? [
                {
                  code: "ticket.conversation.list_organization:organization",
                  description: "List tickets",
                  isDangerous: false,
                  operationLabel: "查看组织工单",
                },
              ]
            : [],
      } as any,
      { findOne: async () => null } as any,
      {
        findOne: async ({ where }: any) =>
          where.permission ===
            "integration_token.organization_integration.create:organization" &&
          where.roleId === "role-1" &&
          where.enabled
            ? {
                enabled: true,
                permission:
                  "integration_token.organization_integration.create:organization",
                roleId: "role-1",
              }
            : null,
        find: async () => [
          {
            enabled: true,
            permission: "ticket.conversation.list_organization:organization",
            roleId: "role-1",
          },
          {
            enabled: true,
            permission: "integration_token.organization_integration.create:organization",
            roleId: "role-1",
          },
        ],
      } as any,
      {
        find: async () => [
          {
            organization: { name: "Hermes" },
            organizationId: "org-1",
            roleId: "role-1",
            status: "active",
            userId: "user-1",
          },
        ],
      } as any,
      {
        validateAccessToken: async () => ({
          sessionId: "session-1",
          tokenKind: "session",
          userId: "user-1",
        }),
      } as any,
      { getOrThrow: () => "test-secret" } as any,
    );

    const created = await service.create("Bearer login-token", "user-1", {
      expiresAt: futureIso(),
      note: "CI",
      organizationId: "org-1",
      permissions: ["ticket.conversation.list_organization:organization"],
      scope: "organization",
    });

    assert.equal(created.note, "CI");
    assert.equal(created.scope, "organization");
    assert.equal(created.organizationId, "org-1");
    assert.ok(created.token);
    assert.equal(savedToken.tokenHash.length, 64);

    const authSessionService = new AuthSessionService(
      tokenRepository as any,
      { findOne: async () => ({ id: "user-1", status: "active" }) } as any,
      { findOne: async () => ({ id: "org-1", status: "active" }) } as any,
      { getOrThrow: () => "test-secret" } as any,
      { getClient: async () => null } as any,
    );
    const validated = await authSessionService.validateAccessToken(created.token);

    assert.equal(validated.tokenKind, "integration");
    assert.equal(validated.userId, "user-1");
    assert.deepEqual(validated.integrationToken?.permissions, [
      "ticket.conversation.list_organization:organization",
    ]);
  });

  it("rejects integration tokens after the owner user is disabled", async () => {
    const record = {
      createdAt: new Date("2026-07-07T00:00:00Z"),
      expiresAt: futureDate(),
      id: "token-1",
      lastUsedAt: null,
      note: "CI",
      organizationId: null,
      ownerUserId: "user-1",
      permissions: ["page.home.access:own"],
      revokedAt: null,
      scope: "own",
      tokenHash: "",
      updatedAt: new Date("2026-07-07T00:00:00Z"),
    };
    const token = createIntegrationToken("token-1", "user-1", "test-secret");
    record.tokenHash = hashTokenForTest(token);
    const authSessionService = new AuthSessionService(
      {
        findOne: async ({ where }: any) =>
          where.id === record.id &&
          where.ownerUserId === record.ownerUserId &&
          where.tokenHash === record.tokenHash
            ? record
            : null,
      } as any,
      {
        findOne: async () => ({ id: "user-1", status: "disabled" }),
      } as any,
      { findOne: async () => null } as any,
      { getOrThrow: () => "test-secret" } as any,
      { getClient: async () => null } as any,
    );

    await assert.rejects(
      () => authSessionService.validateAccessToken(token),
      { message: "用户不可用" },
    );
  });

  it("lists organization tokens with owner and organization metadata", async () => {
    const service = new IntegrationTokensService(
      {
        find: async ({ where }: any) =>
          where.organizationId === "org-1" && where.scope === "organization"
            ? [
                {
                  createdAt: new Date("2026-07-07T00:00:00Z"),
                  expiresAt: futureDate(),
                  id: "token-1",
                  lastUsedAt: null,
                  note: "Deploy",
                  organizationId: "org-1",
                  ownerUserId: "user-2",
                  permissions: ["ticket.conversation.list_organization:organization"],
                  revokedAt: null,
                  scope: "organization",
                  tokenPrefix: "v1.prefix",
                  updatedAt: new Date("2026-07-07T00:00:00Z"),
                },
              ]
            : [],
      } as any,
      {
        find: async () => [
          {
            avatarUrl: null,
            displayName: "Operator",
            email: "operator@hermes.local",
            id: "user-2",
            imageUrl: null,
            username: "operator",
          },
        ],
      } as any,
      {
        find: async () => [{ id: "org-1", name: "Hermes" }],
      } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {
        validateAccessToken: async () => ({
          sessionId: "session-1",
          tokenKind: "session",
          userId: "user-1",
        }),
      } as any,
      { getOrThrow: () => "test-secret" } as any,
    );

    const [token] = await service.listOrganization("Bearer login-token", "org-1");

    assert.equal(token.organizationName, "Hermes");
    assert.equal(token.owner?.displayName, "Operator");
    assert.equal(token.ownerUserId, "user-2");
  });

  it("lists personal tokens with owner and organization metadata", async () => {
    const service = new IntegrationTokensService(
      {
        find: async ({ where }: any) =>
          where.ownerUserId === "user-1"
            ? [
                {
                  createdAt: new Date("2026-07-07T00:00:00Z"),
                  expiresAt: futureDate(),
                  id: "token-own",
                  lastUsedAt: null,
                  note: "Personal",
                  organizationId: null,
                  ownerUserId: "user-1",
                  permissions: ["page.home.access:own"],
                  revokedAt: null,
                  scope: "own",
                  tokenPrefix: "v1.own",
                  updatedAt: new Date("2026-07-07T00:00:00Z"),
                },
                {
                  createdAt: new Date("2026-07-07T00:00:00Z"),
                  expiresAt: futureDate(),
                  id: "token-org",
                  lastUsedAt: null,
                  note: "Organization",
                  organizationId: "org-1",
                  ownerUserId: "user-1",
                  permissions: ["ticket.conversation.list_organization:organization"],
                  revokedAt: null,
                  scope: "organization",
                  tokenPrefix: "v1.org",
                  updatedAt: new Date("2026-07-07T00:00:00Z"),
                },
              ]
            : [],
      } as any,
      {
        find: async () => [
          {
            avatarUrl: null,
            displayName: "Owner",
            email: "owner@hermes.local",
            id: "user-1",
            imageUrl: null,
            username: "owner",
          },
        ],
      } as any,
      {
        find: async () => [{ id: "org-1", name: "Hermes" }],
      } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {
        validateAccessToken: async () => ({
          sessionId: "session-1",
          tokenKind: "session",
          userId: "user-1",
        }),
      } as any,
      { getOrThrow: () => "test-secret" } as any,
    );

    const tokens = await service.list("Bearer login-token", "user-1");

    assert.equal(tokens.length, 2);
    assert.equal(tokens[0].owner?.email, "owner@hermes.local");
    assert.equal(tokens[0].organizationName, null);
    assert.equal(tokens[1].organizationName, "Hermes");
  });

  it("lists platform tokens with owner metadata and no organization", async () => {
    const service = new IntegrationTokensService(
      {
        find: async ({ where }: any) =>
          where.scope === "platform"
            ? [
                {
                  createdAt: new Date("2026-07-07T00:00:00Z"),
                  expiresAt: futureDate(),
                  id: "token-platform",
                  lastUsedAt: null,
                  note: "Platform deploy",
                  organizationId: null,
                  ownerUserId: "user-3",
                  permissions: ["organization.platform_organization.list:platform"],
                  revokedAt: null,
                  scope: "platform",
                  tokenPrefix: "v1.platform",
                  updatedAt: new Date("2026-07-07T00:00:00Z"),
                },
              ]
            : [],
      } as any,
      {
        find: async () => [
          {
            avatarUrl: null,
            displayName: "Platform Operator",
            email: "platform@hermes.local",
            id: "user-3",
            imageUrl: null,
            username: "platform",
          },
        ],
      } as any,
      { find: async () => [] } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {
        validateAccessToken: async () => ({
          sessionId: "session-1",
          tokenKind: "session",
          userId: "user-1",
        }),
      } as any,
      { getOrThrow: () => "test-secret" } as any,
    );

    const [token] = await service.listPlatform("Bearer login-token");

    assert.equal(token.organizationId, null);
    assert.equal(token.organizationName, null);
    assert.equal(token.owner?.displayName, "Platform Operator");
    assert.equal(token.scope, "platform");
  });

  it("revokes only organization tokens inside the requested organization", async () => {
    const saved: any[] = [];
    const service = new IntegrationTokensService(
      {
        findOne: async ({ where }: any) =>
          where.id === "token-1" &&
          where.organizationId === "org-1" &&
          where.scope === "organization"
            ? {
                id: "token-1",
                organizationId: "org-1",
                revokedAt: null,
                scope: "organization",
              }
            : null,
        save: async (value: any) => {
          saved.push(value);
          return value;
        },
      } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {
        validateAccessToken: async () => ({
          sessionId: "session-1",
          tokenKind: "session",
          userId: "user-1",
        }),
      } as any,
      { getOrThrow: () => "test-secret" } as any,
    );

    await service.revokeOrganization("Bearer login-token", "org-1", "token-1");

    assert.equal(saved.length, 1);
    assert.ok(saved[0].revokedAt instanceof Date);
    await assert.rejects(
      () => service.revokeOrganization("Bearer login-token", "org-2", "token-1"),
      { message: "Token 不存在" },
    );
  });

  it("revokes only platform tokens without an organization", async () => {
    const saved: any[] = [];
    let receivedWhere: any = null;
    const service = new IntegrationTokensService(
      {
        findOne: async ({ where }: any) => {
          receivedWhere = where;
          return where.id === "token-platform" &&
            where.scope === "platform" &&
            where.organizationId
            ? {
                id: "token-platform",
                organizationId: null,
                revokedAt: null,
                scope: "platform",
              }
            : null;
        },
        save: async (value: any) => {
          saved.push(value);
          return value;
        },
      } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {
        validateAccessToken: async () => ({
          sessionId: "session-1",
          tokenKind: "session",
          userId: "user-1",
        }),
      } as any,
      { getOrThrow: () => "test-secret" } as any,
    );

    await service.revokePlatform("Bearer login-token", "token-platform");

    assert.equal(saved.length, 1);
    assert.equal(receivedWhere.scope, "platform");
    assert.ok(receivedWhere.organizationId);
    assert.ok(saved[0].revokedAt instanceof Date);
    await assert.rejects(
      () => service.revokePlatform("Bearer login-token", "token-org"),
      { message: "Token 不存在" },
    );
  });

  it("does not expose integration management permissions as token capabilities", async () => {
    const service = new IntegrationTokensService(
      {} as any,
      {} as any,
      {} as any,
      {
        find: async ({ where }: any) =>
          where.scope === "organization"
            ? [
                {
                  code: "ticket.conversation.list_organization:organization",
                  description: "List tickets",
                  entity: "ticket",
                  entityLabel: "工单",
                  entityOrder: 10,
                  isDangerous: false,
                  operation: "list_organization",
                  operationLabel: "查看组织工单",
                  operationOrder: 10,
                  purpose: "conversation",
                  purposeLabel: "会话",
                  purposeOrder: 10,
                },
              ]
            : [],
      } as any,
      { findOne: async () => null } as any,
      {
        findOne: async ({ where }: any) =>
          where.permission ===
            "integration_token.organization_integration.create:organization" &&
          where.roleId === "role-1" &&
          where.enabled
            ? {
                enabled: true,
                permission:
                  "integration_token.organization_integration.create:organization",
                roleId: "role-1",
              }
            : null,
        find: async () => [
          {
            enabled: true,
            permission: "ticket.conversation.list_organization:organization",
            roleId: "role-1",
          },
          {
            enabled: true,
            permission: "integration_token.organization_integration.create:organization",
            roleId: "role-1",
          },
          {
            enabled: true,
            permission: "integration_token.organization_integration.revoke:organization",
            roleId: "role-1",
          },
          {
            enabled: true,
            permission: "page.settings.organization-integrations.access:organization",
            roleId: "role-1",
          },
        ],
      } as any,
      {
        find: async () => [
          {
            organization: { name: "Hermes" },
            organizationId: "org-1",
            roleId: "role-1",
            status: "active",
            userId: "user-1",
          },
        ],
      } as any,
      {
        validateAccessToken: async () => ({
          sessionId: "session-1",
          tokenKind: "session",
          userId: "user-1",
        }),
      } as any,
      { getOrThrow: () => "test-secret" } as any,
    );

    const result = await service.capabilities("Bearer login-token", "user-1");
    const organizationScope = result.scopes.find(
      (scope) => scope.scope === "organization",
    );

    assert.deepEqual(
      organizationScope?.permissions.map((permission) => permission.permission),
      ["ticket.conversation.list_organization:organization"],
    );
  });

  it("rejects permissions outside the selected owned scope", async () => {
    const service = new IntegrationTokensService(
      { create: (value: any) => value, save: async (value: any) => value } as any,
      { find: async () => [], findOne: async () => null } as any,
      { find: async () => [] } as any,
      { find: async () => [] } as any,
      { findOne: async () => null } as any,
      { find: async () => [], findOne: async () => null } as any,
      {
        find: async () => [
          {
            organization: { name: "Hermes" },
            organizationId: "org-1",
            roleId: "role-1",
            status: "active",
            userId: "user-1",
          },
        ],
      } as any,
      {
        validateAccessToken: async () => ({
          sessionId: "session-1",
          tokenKind: "session",
          userId: "user-1",
        }),
      } as any,
      { getOrThrow: () => "test-secret" } as any,
    );

    await assert.rejects(
      () =>
        service.create("Bearer login-token", "user-1", {
          expiresAt: futureIso(),
          organizationId: "org-1",
          permissions: ["user.platform_user.delete:platform"],
          scope: "organization",
        }),
      ForbiddenException,
    );
  });

  it("requires organization integration create permission for organization-scoped tokens", async () => {
    const service = new IntegrationTokensService(
      { create: (value: any) => value, save: async (value: any) => value } as any,
      { find: async () => [] } as any,
      { find: async () => [] } as any,
      {
        find: async ({ where }: any) =>
          where.scope === "organization"
            ? [
                {
                  code: "ticket.conversation.list_organization:organization",
                  description: "List tickets",
                  isDangerous: false,
                  operationLabel: "查看组织工单",
                },
              ]
            : [],
      } as any,
      { findOne: async () => null } as any,
      {
        findOne: async () => null,
        find: async () => [
          {
            enabled: true,
            permission: "ticket.conversation.list_organization:organization",
            roleId: "role-1",
          },
        ],
      } as any,
      {
        find: async () => [
          {
            organization: { name: "Hermes" },
            organizationId: "org-1",
            roleId: "role-1",
            status: "active",
            userId: "user-1",
          },
        ],
      } as any,
      {
        validateAccessToken: async () => ({
          sessionId: "session-1",
          tokenKind: "session",
          userId: "user-1",
        }),
      } as any,
      { getOrThrow: () => "test-secret" } as any,
    );

    const capabilities = await service.capabilities("Bearer login-token", "user-1");
    assert.equal(
      capabilities.scopes.some((scope) => scope.scope === "organization"),
      false,
    );

    await assert.rejects(
      () =>
        service.create("Bearer login-token", "user-1", {
          expiresAt: futureIso(),
          organizationId: "org-1",
          permissions: ["ticket.conversation.list_organization:organization"],
          scope: "organization",
        }),
      ForbiddenException,
    );
  });

  it("does not expose suspended organizations as token capability scopes", async () => {
    const service = new IntegrationTokensService(
      {} as any,
      {} as any,
      {} as any,
      {
        find: async ({ where }: any) =>
          where.scope === "organization"
            ? [
                {
                  code: "ticket.conversation.list_organization:organization",
                  description: "List tickets",
                  isDangerous: false,
                  operationLabel: "查看组织工单",
                },
              ]
            : [],
      } as any,
      { findOne: async () => null } as any,
      {
        findOne: async ({ where }: any) =>
          where.permission ===
            "integration_token.organization_integration.create:organization" &&
          where.roleId === "role-1" &&
          where.enabled
            ? {
                enabled: true,
                permission:
                  "integration_token.organization_integration.create:organization",
                roleId: "role-1",
              }
            : null,
        find: async () => [
          {
            enabled: true,
            permission: "ticket.conversation.list_organization:organization",
            roleId: "role-1",
          },
        ],
      } as any,
      {
        find: async () => [
          {
            organization: {
              id: "org-suspended",
              name: "Suspended",
              status: "suspended",
            },
            organizationId: "org-suspended",
            roleId: "role-1",
            status: "active",
            userId: "user-1",
          },
        ],
      } as any,
      {
        validateAccessToken: async () => ({
          sessionId: "session-1",
          tokenKind: "session",
          userId: "user-1",
        }),
      } as any,
      { getOrThrow: () => "test-secret" } as any,
    );

    const capabilities = await service.capabilities("Bearer login-token", "user-1");

    assert.equal(
      capabilities.scopes.some((scope) => scope.scope === "organization"),
      false,
    );
  });

  it("requires platform integration create permission for platform-scoped tokens", async () => {
    const service = new IntegrationTokensService(
      { create: (value: any) => value, save: async (value: any) => value } as any,
      { find: async () => [], findOne: async () => null } as any,
      { find: async () => [] } as any,
      {
        find: async ({ where }: any) =>
          where.scope === "platform"
            ? [
                {
                  code: "organization.platform_organization.list:platform",
                  description: "List organizations",
                  isDangerous: false,
                  operationLabel: "查看组织列表",
                },
              ]
            : [],
      } as any,
      {
        findOne: async () => ({
          roleId: "platform-role-1",
          status: "active",
          userId: "user-1",
        }),
      } as any,
      {
        findOne: async () => null,
        find: async () => [
          {
            enabled: true,
            permission: "organization.platform_organization.list:platform",
            roleId: "platform-role-1",
          },
        ],
      } as any,
      { find: async () => [] } as any,
      {
        validateAccessToken: async () => ({
          sessionId: "session-1",
          tokenKind: "session",
          userId: "user-1",
        }),
      } as any,
      { getOrThrow: () => "test-secret" } as any,
    );

    const capabilities = await service.capabilities("Bearer login-token", "user-1");
    assert.equal(
      capabilities.scopes.some((scope) => scope.scope === "platform"),
      false,
    );

    await assert.rejects(
      () =>
        service.create("Bearer login-token", "user-1", {
          expiresAt: futureIso(),
          permissions: ["organization.platform_organization.list:platform"],
          scope: "platform",
        }),
      ForbiddenException,
    );
  });

  it("rejects integration tokens from managing integration tokens", async () => {
    const service = new IntegrationTokensService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {
        validateAccessToken: async () => ({
          integrationToken: {
            id: "token-1",
            organizationId: null,
            permissions: ["integration_token.personal_integration.create:own"],
            scope: "own",
          },
          sessionId: "integration:token-1",
          tokenKind: "integration",
          userId: "user-1",
        }),
      } as any,
      { getOrThrow: () => "test-secret" } as any,
    );

    await assert.rejects(
      () =>
        service.create("Bearer integration-token", "user-1", {
          expiresAt: futureIso(),
          permissions: ["page.home.access:own"],
          scope: "own",
        }),
      ForbiddenException,
    );
  });

  it("caps integration token expiry at one year", async () => {
    const service = new IntegrationTokensService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {
        validateAccessToken: async () => ({
          sessionId: "session-1",
          tokenKind: "session",
          userId: "user-1",
        }),
      } as any,
      { getOrThrow: () => "test-secret" } as any,
    );

    await assert.rejects(
      () =>
        service.create("Bearer login-token", "user-1", {
          expiresAt: "2099-01-01T00:00:00Z",
          permissions: ["page.home.access:own"],
          scope: "own",
        }),
      BadRequestException,
    );
  });
});

function futureDate(days = 30) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function futureIso(days = 30) {
  return futureDate(days).toISOString();
}

function createIntegrationToken(tokenId: string, userId: string, secret: string) {
  return createAuthSessionToken(
    {
      jti: randomUUID(),
      sessionId: `${INTEGRATION_SESSION_PREFIX}${tokenId}`,
      userId,
    },
    {
      secret,
      ttlSeconds: 60 * 60,
    },
  );
}

function hashTokenForTest(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
