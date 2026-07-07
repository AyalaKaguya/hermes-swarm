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

  it("rejects permissions outside the selected owned scope", async () => {
    const service = new IntegrationTokensService(
      { create: (value: any) => value, save: async (value: any) => value } as any,
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
