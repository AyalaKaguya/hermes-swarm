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

  it("allows selected permissions inside the selected organization", async () => {
    const guard = createGuard({
      integrationToken: {
        id: "token-1",
        organizationId: "org-1",
        permissions: ["ticket.conversation.handle:organization"],
        scope: "organization",
      },
    });

    assert.equal(
      await guard.canActivate(createContext({ organizationId: "org-1" })),
      true,
    );
  });

  it("denies permissions that were not selected on the integration token", async () => {
    const guard = createGuard({
      integrationToken: {
        id: "token-1",
        organizationId: "org-1",
        permissions: ["ticket.conversation.list_organization:organization"],
        scope: "organization",
      },
    });

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
          organizationId: "org-1",
          permissions: [],
          scope: "organization",
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

  it("denies organization tokens outside their selected organization", async () => {
    const guard = createGuard({
      integrationToken: {
        id: "token-1",
        organizationId: "org-1",
        permissions: ["ticket.conversation.handle:organization"],
        scope: "organization",
      },
    });

    await assert.rejects(
      () => guard.canActivate(createContext({ organizationId: "org-2" })),
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
      { getDefinition: () => null } as any,
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
        organizationId: "org-1",
        permissions: ["ticket.conversation.handle:organization"],
        scope: "organization",
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
      organizationId: string | null;
      permissions: string[];
      scope: "organization" | "own" | "platform";
    };
  }, auditService?: { recordRequest: (...args: any[]) => Promise<unknown> }) {
    return new AccessGuard(
      {
        get: (key: string) =>
          key === ACCESS_RESOURCE_METADATA ? resource : undefined,
        getAllAndOverride: (key: string) =>
          key === ACCESS_OPERATION_METADATA
            ? operation
            : key === ACCESS_SCOPE_METADATA
              ? scope
              : undefined,
      } as any,
      {
        validateAccessToken: async () => ({
          integrationToken: {
            ...session.integrationToken,
            tenantId: "tenant-1",
          },
          principalType: "integration",
          sessionId: `integration:${session.integrationToken.id}`,
          tenantId: "tenant-1",
          tokenKind: "integration",
          userId: "user-1",
        }),
      },
      { getDefinition: () => null } as any,
      { can: async () => true } as any,
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
