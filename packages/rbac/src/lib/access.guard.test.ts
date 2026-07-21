import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ForbiddenException } from "@nestjs/common";
import {
  ACCESS_OPERATION_METADATA,
  ACCESS_RESOURCE_METADATA,
  PUBLIC_ACCESS_METADATA,
} from "./access.decorators.js";
import { AccessGuard } from "./access.guard.js";
import { resolveAccessDefinition } from "./access-catalog.service.js";
import type {
  AccessOperationMetadata,
  AccessResourceMetadata,
} from "./access.types.js";

describe("AccessGuard integration token narrowing", () => {
  const resource: AccessResourceMetadata = {
    entity: "ticket",
    entityLabel: "工单",
    purpose: "conversation",
    purposeLabel: "工单会话",
    scope: "workspace",
  };
  const operation: AccessOperationMetadata = {
    label: "处理工单",
    operation: "handle",
  };
  const permission = "ticket.conversation.handle:workspace";

  it("allows a selected workspace permission when the member still has it", async () => {
    const guard = createGuard({
      integrationToken: {
        id: "token-1",
        permissions: [permission],
        scope: "workspace",
      },
    });

    assert.equal(await guard.canActivate(createContext()), true);
  });

  it("denies permissions that were not selected on the integration token", async () => {
    let memberPermissionChecks = 0;
    const guard = createGuard(
      {
        integrationToken: {
          id: "token-1",
          permissions: [],
          scope: "workspace",
        },
      },
      undefined,
      {
        can: async () => {
          memberPermissionChecks += 1;
          return true;
        },
      },
    );

    await assert.rejects(() => guard.canActivate(createContext()), ForbiddenException);
    assert.equal(memberPermissionChecks, 0);
  });

  it("denies a selected token permission when the member no longer has it", async () => {
    const guard = createGuard(
      {
        integrationToken: {
          id: "token-1",
          permissions: [permission],
          scope: "workspace",
        },
      },
      undefined,
      { can: async () => false },
    );

    await assert.rejects(() => guard.canActivate(createContext()), ForbiddenException);
  });

  it("denies a token bound to a different workspace", async () => {
    const guard = createGuard({
      integrationToken: {
        id: "token-1",
        permissions: [permission],
        scope: "workspace",
        workspaceId: "workspace-2",
      },
    });

    await assert.rejects(() => guard.canActivate(createContext()), ForbiddenException);
  });

  it("bypasses authentication only for explicit public handlers", async () => {
    const guard = new AccessGuard(
      {
        getAllAndOverride: (key: string) =>
          key === PUBLIC_ACCESS_METADATA ? { reason: "test" } : undefined,
      } as any,
      {
        validateAccessToken: async () => {
          throw new Error("should not authenticate");
        },
      },
      { getDefinition: () => null } as any,
      { can: async () => false } as any,
      { resolve: async () => ({}) } as any,
    );

    assert.equal(await guard.canActivate(createContext()), true);
  });

  it("stores the validated workspace principal on the request", async () => {
    const request: Record<string, unknown> = {
      headers: { authorization: "Bearer session-token" },
    };
    const guard = createGuard({
      integrationToken: {
        id: "token-1",
        permissions: [permission],
        scope: "workspace",
      },
    });

    assert.equal(
      await guard.canActivate({
        getClass: () => function Controller() {},
        getHandler: () => function handler() {},
        switchToHttp: () => ({ getRequest: () => request }),
      } as any),
      true,
    );
    assert.equal((request.accessPrincipal as { userId?: string }).userId, "user-1");
  });

  it("resolves handler-level resource metadata before the controller fallback", async () => {
    const handlerResource: AccessResourceMetadata = {
      ...resource,
      entity: "workspace_application",
      entityLabel: "工作空间申请",
      scope: "platform",
    };
    const handlerOperation: AccessOperationMetadata = {
      label: "查看工作空间申请",
      operation: "list",
    };
    const definition = resolveAccessDefinition(handlerResource, handlerOperation)!;
    function Controller() {}
    function handler() {}
    let resourceTargets: unknown[] = [];
    const guard = new AccessGuard(
      {
        getAllAndOverride: (key: string, targets: unknown[]) => {
          if (key === ACCESS_RESOURCE_METADATA) {
            resourceTargets = targets;
            return handlerResource;
          }
          if (key === ACCESS_OPERATION_METADATA) return handlerOperation;
          return undefined;
        },
      } as any,
      {
        validateAccessToken: async () => ({
          principalType: "platform",
          workspaceId: null,
          userId: "platform-user-1",
        }),
      },
      {
        getDefinition: (id: string) => (id === definition.id ? definition : null),
      } as any,
      { can: async () => true } as any,
      { resolve: async () => ({ scopeLevel: "platform", workspaceId: null }) } as any,
    );

    assert.equal(
      await guard.canActivate({
        getClass: () => Controller,
        getHandler: () => handler,
        switchToHttp: () => ({
          getRequest: () => ({ headers: { authorization: "Bearer session-token" } }),
        }),
      } as any),
      true,
    );
    assert.deepEqual(resourceTargets, [handler, Controller]);
  });

  it("rejects unannotated admin routes", async () => {
    const guard = new AccessGuard(
      { getAllAndOverride: () => undefined } as any,
      { validateAccessToken: async () => ({ userId: "user-1" }) },
      { getDefinition: () => null } as any,
      { can: async () => true } as any,
      { resolve: async () => ({}) } as any,
    );

    await assert.rejects(
      () =>
        guard.canActivate({
          getClass: () => function Controller() {},
          getHandler: () => function handler() {},
          switchToHttp: () => ({
            getRequest: () => ({ originalUrl: "/api/admin/unannotated" }),
          }),
        } as any),
      ForbiddenException,
    );
  });

  function createGuard(
    session: {
      integrationToken: {
        id: string;
        permissions: string[];
        scope: "workspace";
        workspaceId?: string;
      };
    },
    auditService?: { recordRequest: (...args: any[]) => Promise<unknown> },
    accessService: { can: (...args: any[]) => Promise<boolean> } = {
      can: async () => true,
    },
  ) {
    return new AccessGuard(
      {
        getAllAndOverride: (key: string) =>
          key === ACCESS_RESOURCE_METADATA
            ? resource
            : key === ACCESS_OPERATION_METADATA
              ? operation
              : undefined,
      } as any,
      {
        validateAccessToken: async () => ({
          integrationToken: {
            ...session.integrationToken,
            workspaceId: session.integrationToken.workspaceId ?? "workspace-1",
          },
          principalType: "integration",
          sessionId: `integration:${session.integrationToken.id}`,
          workspaceId: "workspace-1",
          tokenKind: "integration",
          userId: "user-1",
        }),
      },
      { getDefinition: () => resolveAccessDefinition(resource, operation) } as any,
      accessService as any,
      {
        resolve: async () => ({
          scopeLevel: "workspace",
          workspaceId: "workspace-1",
        }),
      } as any,
      auditService as any,
    );
  }

  function createContext() {
    return {
      getClass: () => function Controller() {},
      getHandler: () => function handler() {},
      switchToHttp: () => ({
        getRequest: () => ({
          headers: { authorization: "Bearer integration-token" },
        }),
      }),
    } as any;
  }
});
