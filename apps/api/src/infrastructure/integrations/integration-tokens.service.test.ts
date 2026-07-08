import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { IntegrationTokensService } from "./integration-tokens.service.js";
import { AuthSessionService } from "../auth/auth-session.service.js";

describe("IntegrationTokensService", () => {
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
    };
    const service = new IntegrationTokensService(
      tokenRepository as any,
      { find: async () => [] } as any,
      {
        find: async () => [],
        findOne: async ({ where }: any) =>
          where.id === "org-1" ? { id: "org-1", name: "Hermes" } : null,
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

    const created = await service.create("Bearer login-token", "user-1", {
      expiresAt: "2026-08-07T00:00:00Z",
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
      { getOrThrow: () => "test-secret" } as any,
      { findOne: async () => null } as any,
    );
    const validated = await authSessionService.validateAccessToken(created.token);

    assert.equal(validated.tokenKind, "integration");
    assert.equal(validated.userId, "user-1");
    assert.deepEqual(validated.integrationToken?.permissions, [
      "ticket.conversation.list_organization:organization",
    ]);
  });

  it("lists organization tokens with owner and organization metadata", async () => {
    const service = new IntegrationTokensService(
      {
        find: async ({ where }: any) =>
          where.organizationId === "org-1" && where.scope === "organization"
            ? [
                {
                  createdAt: new Date("2026-07-07T00:00:00Z"),
                  expiresAt: new Date("2026-08-07T00:00:00Z"),
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
                  expiresAt: new Date("2026-08-07T00:00:00Z"),
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
                  expiresAt: new Date("2026-08-07T00:00:00Z"),
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
                  expiresAt: new Date("2026-08-07T00:00:00Z"),
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
        find: async () => [
          {
            enabled: true,
            permission: "ticket.conversation.list_organization:organization",
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
      { find: async () => [] } as any,
      { find: async () => [] } as any,
      { find: async () => [] } as any,
      { findOne: async () => null } as any,
      { find: async () => [] } as any,
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
          expiresAt: "2026-08-07T00:00:00Z",
          organizationId: "org-1",
          permissions: ["user.platform_user.delete:platform"],
          scope: "organization",
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
          expiresAt: "2026-08-07T00:00:00Z",
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
