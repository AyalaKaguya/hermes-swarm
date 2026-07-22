import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { IntegrationTokensService } from "./integration-tokens.service.js";

describe("IntegrationTokensService personal token contract", () => {
  it("exposes the live workspace permission set", async () => {
    const state = createState();
    const result = await state.service.capabilities("Bearer session");
    assert.deepEqual(result, {
      scopes: [{
        permissions: [
          {
            description: "查看工作空间工单。",
            entity: "ticket",
            entityLabel: "工单",
            entityOrder: 30,
            isDangerous: false,
            label: "查看工单",
            operation: "list",
            operationOrder: 10,
            permission: "ticket.conversation.list:workspace",
            purpose: "conversation",
            purposeLabel: "工单会话",
            purposeOrder: 10,
            scope: "workspace",
          },
        ],
        scope: "workspace",
      }],
    });
  });

  it("rejects legacy scope parameters on personal token creation", async () => {
    const state = createState();
    await assert.rejects(
      state.service.create("Bearer session", {
        permissions: [],
        scope: "workspace",
      } as never),
      BadRequestException,
    );
  });

  it("prevents permission escalation and persists user-owned tokens", async () => {
    const state = createState();
    await assert.rejects(
      state.service.create("Bearer session", {
        permissions: ["platform.manage:platform"],
      }),
      ForbiddenException,
    );
    const created = await state.service.create("Bearer session", {
      note: "automation",
      permissions: ["ticket.conversation.list:workspace"],
    });
    assert.equal(created.scope, "workspace");
    assert.equal(created.ownerUserId, "user-a");
    assert.equal(state.tokens[0]?.workspaceId, "workspace-a");
  });

  it("marks expired tokens for the historical list", async () => {
    const state = createState();
    state.tokens.push({
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
      expiresAt: new Date("2025-01-02T00:00:00.000Z"),
      id: "expired-token",
      lastUsedAt: null,
      note: "expired",
      ownerUserId: "user-a",
      permissions: [],
      revokedAt: null,
      scope: "workspace",
      workspaceId: "workspace-a",
      tokenPrefix: "expired",
    });

    const [token] = await state.service.list("Bearer session");
    assert.equal(token?.isExpired, true);
  });

  it("rejects token management when the assigned role belongs to another workspace", async () => {
    const state = createState();
    state.membership.role.workspaceId = "workspace-b";

    await assert.rejects(
      () => state.service.capabilities("Bearer session"),
      ForbiddenException,
    );
  });
});

function createState() {
  const tokens: Array<Record<string, unknown>> = [];
  const membership = {
    accountId: "user-a",
    role: { scope: "workspace", workspaceId: "workspace-a" },
    roleId: "workspace-role",
    status: "active",
    workspaceId: "workspace-a",
  };
  const workspaceMembershipRepository = {
    find: async () => [
      {
        ...membership,
        userId: "user-a",
      },
    ],
    findOne: async () => membership,
  };
  const rolePermissionRepository = {
    find: async () => [
      { enabled: true, permission: "ticket.conversation.list:workspace", roleId: "workspace-role" },
      { enabled: true, permission: "integration_token.personal_api_token.create:own", roleId: "workspace-role" },
      { enabled: true, permission: "page.settings.account.access:own", roleId: "workspace-role" },
    ],
  };
  const permissionRepository = {
    find: async () => [
      {
        code: "ticket.conversation.list:workspace",
        description: "查看工作空间工单。",
        entity: "ticket",
        entityLabel: "工单",
        entityOrder: 30,
        isDangerous: false,
        operation: "list",
        operationLabel: "查看工单",
        operationOrder: 10,
        purpose: "conversation",
        purposeLabel: "工单会话",
        purposeOrder: 10,
        scope: "workspace",
        source: "controller",
      },
      {
        code: "page.settings.account.access:own",
        description: "访问账号设置。",
        entity: "page",
        entityLabel: "页面",
        entityOrder: 1,
        isDangerous: false,
        operation: "access",
        operationLabel: "账号",
        operationOrder: 10,
        purpose: "settings",
        purposeLabel: "设置",
        purposeOrder: 10,
        scope: "own",
        source: "navigation",
      },
    ],
  };
  const integrationTokenRepository = {
      create: (value: Record<string, unknown>) => value,
      find: async () => tokens,
      findOne: async ({ where }: { where: { id: string } }) => tokens.find((item) => item.id === where.id) ?? null,
      save: async (value: Record<string, unknown>) => {
        const entity = {
          createdAt: new Date("2026-07-15T00:00:00.000Z"),
          lastUsedAt: null,
          updatedAt: new Date("2026-07-15T00:00:00.000Z"),
          ...value,
        };
        const index = tokens.findIndex((item) => item.id === entity.id);
        if (index >= 0) tokens[index] = entity;
        else tokens.push(entity);
        return entity;
      },
  };
  const workspaceContext = {
    current: () => ({ workspaceId: "workspace-a" }),
  };
  const service = new IntegrationTokensService(
    {
      validateAccessToken: async () => ({
        principalType: "workspace",
        workspaceId: "workspace-a",
        tokenKind: "session",
        userId: "user-a",
      }),
    } as never,
    { getOrThrow: () => "test-session-secret-with-sufficient-entropy" } as never,
    workspaceContext as never,
    integrationTokenRepository as never,
    workspaceMembershipRepository as never,
    rolePermissionRepository as never,
    permissionRepository as never,
  );
  return { membership, service, tokens };
}
