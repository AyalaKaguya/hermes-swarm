import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ForbiddenException } from "@nestjs/common";
import {
  ACCESS_OPERATION_METADATA,
  ACCESS_RESOURCE_METADATA,
  ACCESS_SCOPE_METADATA,
  PUBLIC_ACCESS_METADATA,
} from "./access.decorators.js";
import { AccessGuard } from "./access.guard.js";
import { resolveAccessDefinition } from "./access-catalog.service.js";
import type {
  AccessOperationMetadata,
  AccessResourceMetadata,
  AccessScopeMetadata,
} from "./access.types.js";

describe("AccessGuard integration token narrowing", () => {
  const resource: AccessResourceMetadata = {
    entity: "ticket",
    entityLabel: "工单",
    purpose: "conversation",
    purposeLabel: "工单会话",
    scope: "organization",
  };
  const operation: AccessOperationMetadata = {
    label: "处理工单",
    operation: "handle",
  };
  const scope: AccessScopeMetadata = { param: "organizationId" };

  it("allows selected permissions across organizations in the token tenant", async () => {
    const guard = createGuard({
      integrationToken: {
        id: "token-1",
        permissions: ["ticket.conversation.handle:organization"],
        scope: "tenant",
      },
    });

    assert.equal(
      await guard.canActivate(createContext({ organizationId: "org-1" })),
      true,
    );
  });

  it("denies permissions that were not selected on the integration token", async () => {
    let userPermissionChecks = 0;
    const guard = createGuard(
      {
        integrationToken: {
          id: "token-1",
          permissions: ["ticket.conversation.list_organization:organization"],
          scope: "tenant",
        },
      },
      undefined,
      {
        can: async () => {
          userPermissionChecks += 1;
          return true;
        },
      },
    );

    await assert.rejects(
      () => guard.canActivate(createContext({ organizationId: "org-1" })),
      ForbiddenException,
    );
    assert.equal(userPermissionChecks, 0);
  });

  it("denies a selected token permission when the user no longer has it", async () => {
    const guard = createGuard(
      {
        integrationToken: {
          id: "token-1",
          permissions: ["ticket.conversation.handle:organization"],
          scope: "tenant",
        },
      },
      undefined,
      { can: async () => false },
    );

    await assert.rejects(
      () => guard.canActivate(createContext({ organizationId: "org-1" })),
      ForbiddenException,
    );
  });

  it("persists denied authorization decisions before throwing", async () => {
    const audits: any[] = [];
    const guard = createGuard(
      {
        integrationToken: {
          id: "token-1",
          permissions: [],
          scope: "tenant",
        },
      },
      { recordRequest: async (...args: any[]) => audits.push(args) },
    );

    await assert.rejects(
      () => guard.canActivate(createContext({ organizationId: "org-1" })),
      ForbiddenException,
    );
    assert.equal(audits.length, 1);
    assert.equal(audits[0][1], "denied");
  });

  it("denies a token whose embedded tenant differs from the request tenant", async () => {
    const guard = createGuard({
      integrationToken: {
        id: "token-1",
        permissions: ["ticket.conversation.handle:organization"],
        scope: "tenant",
        tenantId: "tenant-2",
      },
    });

    await assert.rejects(
      () => guard.canActivate(createContext({ organizationId: "org-1" })),
      ForbiddenException,
    );
  });


  it("bypasses authentication only for explicit public handlers", async () => {
    const guard = new AccessGuard(
      {
        get: () => undefined,
        getAllAndOverride: (key: string) =>
          key === PUBLIC_ACCESS_METADATA ? { reason: "test" } : undefined,
      } as any,
      {
        validateAccessToken: async () => {
          throw new Error("should not authenticate");
        },
      },
      {
        getDefinition: () => resolveAccessDefinition(resource, operation),
      } as any,
      { can: async () => false } as any,
      { resolve: async () => ({}) } as any,
    );

    assert.equal(await guard.canActivate(createContext({})), true);
  });

  it("stores the validated principal on the request", async () => {
    const request: Record<string, unknown> = {
      headers: { authorization: "Bearer session-token" },
      params: { organizationId: "org-1" },
    };
    const guard = createGuard({
      integrationToken: {
        id: "token-1",
        permissions: ["ticket.conversation.handle:organization"],
        scope: "tenant",
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
      entity: "tenant_application",
      entityLabel: "租户申请",
      scope: "platform",
    };
    const handlerOperation: AccessOperationMetadata = {
      label: "查看租户申请",
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
          tenantId: null,
          userId: "platform-user-1",
        }),
      },
      {
        getDefinition: (permission: string) =>
          permission === definition.id ? definition : null,
      } as any,
      { can: async () => true } as any,
      { resolve: async () => ({ scopeLevel: "platform", tenantId: null }) } as any,
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

  it("rejects unannotated admin routes instead of silently allowing them", async () => {
    const guard = new AccessGuard(
      { get: () => undefined, getAllAndOverride: () => undefined } as any,
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
  function createGuard(session: {
    integrationToken: {
      id: string;
      permissions: string[];
      scope: "tenant";
      tenantId?: string;
    };
  }, auditService?: { recordRequest: (...args: any[]) => Promise<unknown> }, accessService: { can: (...args: any[]) => Promise<boolean> } = { can: async () => true }) {
    return new AccessGuard(
      {
        getAllAndOverride: (key: string) =>
          key === ACCESS_RESOURCE_METADATA
            ? resource
            : key === ACCESS_OPERATION_METADATA
            ? operation
            : key === ACCESS_SCOPE_METADATA
              ? scope
              : undefined,
      } as any,
      {
        validateAccessToken: async () => ({
          integrationToken: {
            ...session.integrationToken,
            tenantId: session.integrationToken.tenantId ?? "tenant-1",
          },
          principalType: "integration",
          sessionId: `integration:${session.integrationToken.id}`,
          tenantId: "tenant-1",
          tokenKind: "integration",
          userId: "user-1",
        }),
      },
      {
        getDefinition: () => resolveAccessDefinition(resource, operation),
      } as any,
      accessService as any,
      {
        resolve: async (_definition: unknown, _metadata: unknown, request: any) => ({
          organizationId: request.params?.organizationId ?? null,
          tenantId: "tenant-1",
        }),
      } as any,
      auditService as any,
    );
  }

  function createContext(params: Record<string, string>) {
    return {
      getClass: () => function Controller() {},
      getHandler: () => function handler() {},
      switchToHttp: () => ({
        getRequest: () => ({
          headers: { authorization: "Bearer integration-token" },
          params,
        }),
      }),
    } as any;
  }
});
