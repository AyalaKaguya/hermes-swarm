import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import {
  IntegrationToken,
  Permission,
  RolePermission,
  UserOrganization,
  UserOrganizationRole,
  UserTenantRole,
} from "@hermes-swarm/core";
import { IntegrationTokensService } from "./integration-tokens.service.js";

describe("IntegrationTokensService personal token contract", () => {
  it("exposes the live union of workspace and organization permissions", async () => {
    const state = createState();
    const result = await state.service.capabilities("Bearer session");
    assert.deepEqual(result, {
      scopes: [{
        permissions: [
          {
            description: "查看组织资料。",
            entity: "organization",
            entityLabel: "组织",
            entityOrder: 20,
            isDangerous: false,
            label: "查看组织资料",
            operation: "view",
            operationOrder: 10,
            permission: "organization.profile.view:organization",
            purpose: "profile",
            purposeLabel: "组织资料",
            purposeOrder: 10,
            scope: "organization",
          },
          {
            description: "查看工作空间工单。",
            entity: "ticket",
            entityLabel: "工单",
            entityOrder: 30,
            isDangerous: false,
            label: "查看工单",
            operation: "list",
            operationOrder: 10,
            permission: "ticket.conversation.list:tenant",
            purpose: "conversation",
            purposeLabel: "工单会话",
            purposeOrder: 10,
            scope: "tenant",
          },
        ],
        scope: "tenant",
      }],
    });
  });

  it("rejects legacy scope parameters on personal token creation", async () => {
    const state = createState();
    await assert.rejects(
      state.service.create("Bearer session", {
        permissions: [],
        scope: "tenant",
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
      permissions: ["organization.profile.view:organization"],
    });
    assert.equal(created.scope, "tenant");
    assert.equal(created.ownerUserId, "user-a");
    assert.equal(state.tokens[0]?.tenantId, "tenant-a");
    assert.equal("organizationId" in (state.tokens[0] ?? {}), false);
    assert.equal("departmentId" in (state.tokens[0] ?? {}), false);
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
      scope: "tenant",
      tenantId: "tenant-a",
      tokenPrefix: "expired",
    });

    const [token] = await state.service.list("Bearer session");
    assert.equal(token?.isExpired, true);
  });
});

function createState() {
  const tokens: Array<Record<string, unknown>> = [];
  const repositories = new Map([
    [UserTenantRole, { find: async () => [{
      role: { organizationId: null, scope: "tenant" },
      roleId: "tenant-role",
      tenantId: "tenant-a",
      userId: "user-a",
    }] }],
    [UserOrganization, { find: async () => [{
      id: "membership-a",
      organizationId: "organization-a",
      status: "active",
      tenantId: "tenant-a",
      userId: "user-a",
    }] }],
    [UserOrganizationRole, { find: async () => [{
      membershipId: "membership-a",
      organizationId: "organization-a",
      role: { organizationId: "organization-a", scope: "organization" },
      roleId: "organization-role",
      tenantId: "tenant-a",
    }] }],
    [RolePermission, { find: async () => [
      { enabled: true, permission: "ticket.conversation.list:tenant", roleId: "tenant-role" },
      { enabled: true, permission: "integration_token.personal_api_token.create:own", roleId: "tenant-role" },
      { enabled: true, permission: "page.settings.account.access:own", roleId: "tenant-role" },
      { enabled: true, permission: "organization.profile.view:organization", roleId: "organization-role" },
    ] }],
    [Permission, { find: async () => [
      {
        code: "ticket.conversation.list:tenant",
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
        scope: "tenant",
        source: "controller",
      },
      {
        code: "organization.profile.view:organization",
        description: "查看组织资料。",
        entity: "organization",
        entityLabel: "组织",
        entityOrder: 20,
        isDangerous: false,
        operation: "view",
        operationLabel: "查看组织资料",
        operationOrder: 10,
        purpose: "profile",
        purposeLabel: "组织资料",
        purposeOrder: 10,
        scope: "organization",
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
    ] }],
    [IntegrationToken, {
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
    }],
  ]);
  const tenantContext = {
    current: () => ({ tenantId: "tenant-a" }),
    repository: (target: unknown) => repositories.get(target as never),
  };
  const service = new IntegrationTokensService(
    {
      validateAccessToken: async () => ({
        principalType: "tenant",
        tenantId: "tenant-a",
        tokenKind: "session",
        userId: "user-a",
      }),
    } as never,
    { getOrThrow: () => "test-session-secret-with-sufficient-entropy" } as never,
    tenantContext as never,
  );
  return { service, tokens };
}
