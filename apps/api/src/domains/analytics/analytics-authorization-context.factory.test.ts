import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Account } from "@hermes-swarm/core";
import type {
  AccessAuthSession,
  AccessCatalogService,
  AccessService,
  ResolvedAccessDefinition,
} from "@hermes-swarm/rbac";
import type { Repository } from "typeorm";
import { WorkspaceContextService } from "../../common/database/workspace-context.service.js";
import {
  AnalyticsAuthorizationContextFactory,
  type AnalyticsAuthorizedRequest,
} from "./analytics-authorization-context.factory.js";
import { AnalyticsQueryError } from "./analytics-query.error.js";
import {
  SUPPORT_TICKETS_DESCRIBE_PERMISSION,
  SUPPORT_TICKETS_QUERY_PERMISSION,
} from "./support-tickets-analytics.constants.js";

describe("AnalyticsAuthorizationContextFactory", () => {
  it("derives actor, preferences and live permissions from server state", async () => {
    const state = createState({ liveAllowed: true });
    const result = await state.inWorkspace(() =>
      state.factory.create(workspaceRequest(), {
        operationPermission: SUPPORT_TICKETS_DESCRIBE_PERMISSION,
        requiredPermissions: [SUPPORT_TICKETS_QUERY_PERMISSION],
      }),
    );

    assert.equal(result.actorId, "account-a");
    assert.equal(result.integrationTokenId, null);
    assert.equal(result.locale, "zh-Hant");
    assert.equal(result.timeZone, "Asia/Hong_Kong");
    assert.equal(result.requestId, "server-request-a");
    assert.deepEqual([...result.permissions], [SUPPORT_TICKETS_QUERY_PERMISSION]);
    assert.deepEqual(state.checkedPermissions, [SUPPORT_TICKETS_QUERY_PERMISSION]);
  });

  it("treats integration-token permissions as a restriction, never a grant", async () => {
    const liveDenied = createState({ liveAllowed: false });
    const withTokenGrant = integrationRequest([SUPPORT_TICKETS_QUERY_PERMISSION]);
    const deniedByRole = await liveDenied.inWorkspace(() =>
      liveDenied.factory.create(withTokenGrant, {
        operationPermission: SUPPORT_TICKETS_DESCRIBE_PERMISSION,
        requiredPermissions: [SUPPORT_TICKETS_QUERY_PERMISSION],
      }),
    );
    assert.equal(deniedByRole.integrationTokenId, "token-a");
    assert.deepEqual([...deniedByRole.permissions], []);

    const tokenDenied = createState({ liveAllowed: true });
    const withoutTokenGrant = integrationRequest([]);
    const deniedByToken = await tokenDenied.inWorkspace(() =>
      tokenDenied.factory.create(withoutTokenGrant, {
        operationPermission: SUPPORT_TICKETS_DESCRIBE_PERMISSION,
        requiredPermissions: [SUPPORT_TICKETS_QUERY_PERMISSION],
      }),
    );
    assert.equal(deniedByToken.integrationTokenId, "token-a");
    assert.deepEqual([...deniedByToken.permissions], []);
    assert.deepEqual(tokenDenied.checkedPermissions, []);
  });

  it("fails closed when principal, audited operation and WorkspaceContext differ", async () => {
    const state = createState({ liveAllowed: true });
    await assert.rejects(
      state.inWorkspace(() =>
        state.factory.create(
          {
            ...workspaceRequest(),
            accessPrincipal: {
              ...workspaceRequest().accessPrincipal!,
              workspaceId: "workspace-b",
            },
          },
          {
            operationPermission: SUPPORT_TICKETS_DESCRIBE_PERMISSION,
            requiredPermissions: [SUPPORT_TICKETS_QUERY_PERMISSION],
          },
        ),
      ),
      (error: unknown) => {
        assert.ok(error instanceof AnalyticsQueryError);
        assert.equal(error.code, "ANALYTICS_CONTEXT_REQUIRED");
        return true;
      },
    );
  });

  it("requires an integration principal to carry its matching trusted token id", async () => {
    const state = createState({ liveAllowed: true });
    const request = integrationRequest([SUPPORT_TICKETS_QUERY_PERMISSION]);

    for (const integrationToken of [
      null,
      {
        id: "token-a",
        permissions: [SUPPORT_TICKETS_QUERY_PERMISSION],
        scope: "workspace" as const,
        workspaceId: "workspace-b",
      },
    ]) {
      await assert.rejects(
        state.inWorkspace(() =>
          state.factory.create(
            {
              ...request,
              accessPrincipal: {
                ...request.accessPrincipal!,
                integrationToken,
              },
            },
            {
              operationPermission: SUPPORT_TICKETS_DESCRIBE_PERMISSION,
              requiredPermissions: [SUPPORT_TICKETS_QUERY_PERMISSION],
            },
          )
        ),
        (error: unknown) => {
          assert.ok(error instanceof AnalyticsQueryError);
          assert.equal(error.code, "ANALYTICS_CONTEXT_REQUIRED");
          return true;
        },
      );
    }
  });
});

function createState(input: { liveAllowed: boolean }) {
  const workspaceContext = new WorkspaceContextService();
  const checkedPermissions: string[] = [];
  const definitions = new Map([
    [SUPPORT_TICKETS_QUERY_PERMISSION, definition("query")],
    [SUPPORT_TICKETS_DESCRIBE_PERMISSION, definition("describe")],
  ]);
  const accessCatalog = {
    getDefinition(permission: string) {
      return definitions.get(permission) ?? null;
    },
  } as unknown as AccessCatalogService;
  const accessService = {
    async can(
      _userId: string,
      permission: ResolvedAccessDefinition,
      context: { workspaceId?: string | null },
    ) {
      assert.equal(context.workspaceId, "workspace-a");
      checkedPermissions.push(permission.id);
      return input.liveAllowed;
    },
  } as unknown as AccessService;
  const accounts = {
    async findOne() {
      return {
        id: "account-a",
        preferredLanguage: "zh-Hant",
        timeZone: "Asia/Hong_Kong",
      } as Account;
    },
  } as unknown as Repository<Account>;
  return {
    checkedPermissions,
    factory: new AnalyticsAuthorizationContextFactory(
      workspaceContext,
      accessCatalog,
      accessService,
      accounts,
    ),
    inWorkspace<T>(work: () => T) {
      return workspaceContext.run(
        { scopeLevel: "workspace", workspaceId: "workspace-a" },
        work,
      );
    },
  };
}
function workspaceRequest(): AnalyticsAuthorizedRequest {
  return {
    accessAudit: {
      definition: definition("describe"),
      scope: { scopeLevel: "workspace", workspaceId: "workspace-a" },
    },
    accessPrincipal: principal("workspace"),
    id: "server-request-a",
  };
}

function integrationRequest(permissions: string[]): AnalyticsAuthorizedRequest {
  return {
    ...workspaceRequest(),
    accessPrincipal: {
      ...principal("integration"),
      integrationToken: {
        id: "token-a",
        permissions,
        scope: "workspace",
        workspaceId: "workspace-a",
      },
    },
  };
}

function principal(
  principalType: "integration" | "workspace",
): AccessAuthSession {
  return {
    principalType,
    sessionId: "session-a",
    tokenKind: principalType === "integration" ? "integration" : "session",
    userId: "account-a",
    workspaceId: "workspace-a",
  };
}

function definition(
  operation: "describe" | "query",
): ResolvedAccessDefinition {
  return {
    defaultRoles: ["workspace-owner", "workspace-admin"],
    description: null,
    entity: "analytics",
    entityLabel: "数据分析",
    entityOrder: 80,
    id:
      operation === "describe"
        ? SUPPORT_TICKETS_DESCRIBE_PERMISSION
        : SUPPORT_TICKETS_QUERY_PERMISSION,
    isDangerous: false,
    operation,
    operationLabel: operation,
    operationOrder: null,
    purpose: "ticket_dataset",
    purposeLabel: "工单数据集",
    purposeOrder: 10,
    scope: "workspace",
    source: "controller",
  };
}
