import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";
import { firstValueFrom, of, throwError } from "rxjs";
import { AccessAuditInterceptor } from "./access-audit.interceptor.js";
import { AccessAuditService } from "./access-audit.service.js";
import type { AccessRequest, ResolvedAccessDefinition } from "./access.types.js";

describe("access audit persistence", () => {
  it("persists workspace scope, actor, permission, and result", async () => {
    const rows: any[] = [];
    const service = new AccessAuditService({
      insert: async (row: any) => rows.push(row),
    } as any);

    await service.recordRequest(createRequest(), "allowed", { statusCode: 200 });

    assert.deepEqual(rows, [
      {
        actorId: "user-1",
        errorCode: null,
        httpMethod: "PATCH",
        httpPath: "/api/admin/workspace",
        ipAddress: null,
        permission: "workspace.profile.update:workspace",
        principalType: "workspace",
        result: "allowed",
        scopeType: "workspace",
        sessionId: null,
        statusCode: 200,
        targetWorkspaceId: null,
        workspaceId: "workspace-1",
        userAgent: null,
      },
    ]);
  });

  it("records the target workspace for platform control-plane access", async () => {
    const rows: any[] = [];
    const service = new AccessAuditService({
      insert: async (row: any) => rows.push(row),
    } as any);
    const request = createRequest({
      accessPrincipal: {
        principalType: "platform",
        workspaceId: null,
        userId: "platform-user-1",
      },
      params: { workspaceId: "workspace-target" },
    });

    await service.recordRequest(request, "denied", { statusCode: 403 });

    assert.equal(rows[0].workspaceId, null);
    assert.equal(rows[0].targetWorkspaceId, "workspace-target");
    assert.equal(rows[0].result, "denied");
  });

  it("records stable security codes from Nest exception responses", async () => {
    const rows: any[] = [];
    const service = new AccessAuditService({
      insert: async (row: any) => rows.push(row),
    } as any);
    const error = new BadRequestException({
      code: "OWNER_CONTINUITY_REQUIRED",
      message: "owner required",
      statusCode: 400,
    });

    await service.recordRequest(createRequest(), "error", { error });

    assert.equal(rows[0].errorCode, "OWNER_CONTINUITY_REQUIRED");
  });

  it("records handler completion and preserves handler errors", async () => {
    const calls: any[] = [];
    const interceptor = new AccessAuditInterceptor({
      recordRequest: async (...args: any[]) => calls.push(args),
    } as any);
    const request = createRequest();

    assert.equal(
      await firstValueFrom(
        interceptor.intercept(createContext(request, 204), {
          handle: () => of("ok"),
        }),
      ),
      "ok",
    );
    const error = new BadRequestException("invalid");
    await assert.rejects(
      () =>
        firstValueFrom(
          interceptor.intercept(createContext(request, 200), {
            handle: () => throwError(() => error),
          }),
        ),
      (received) => received === error,
    );
    assert.equal(calls[0][1], "allowed");
    assert.equal(calls[1][1], "error");
    assert.equal(calls[1][2].error, error);
  });

  it("extracts the workspace created by a platform approval", async () => {
    const calls: any[] = [];
    const interceptor = new AccessAuditInterceptor({
      recordRequest: async (...args: any[]) => calls.push(args),
    } as any);
    const request = createRequest({
      accessPrincipal: {
        principalType: "platform",
        workspaceId: null,
        userId: "platform-user-1",
      },
    });

    await firstValueFrom(
      interceptor.intercept(createContext(request, 201), {
        handle: () => of({ workspace: { id: "workspace-created" } }),
      }),
    );

    assert.equal(calls[0][2].targetWorkspaceId, "workspace-created");
  });
});

const definition: ResolvedAccessDefinition = {
  defaultRoles: [],
  description: null,
  entity: "workspace",
  entityLabel: "工作空间",
  entityOrder: 1,
  id: "workspace.profile.update:workspace",
  isDangerous: false,
  operation: "update",
  operationLabel: "更新工作空间",
  operationOrder: 1,
  purpose: "profile",
  purposeLabel: "工作空间资料",
  purposeOrder: 1,
  scope: "workspace",
};

function createRequest(overrides: Partial<AccessRequest> = {}): AccessRequest {
  return {
    accessAudit: {
      definition,
      scope: {
        scopeLevel: "workspace",
        workspaceId: "workspace-1",
      },
    },
    accessPrincipal: {
      principalType: "workspace",
      workspaceId: "workspace-1",
      userId: "user-1",
    },
    method: "patch",
    originalUrl: "/api/admin/workspace",
    params: {},
    ...overrides,
  };
}

function createContext(request: AccessRequest, statusCode: number) {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({ statusCode }),
    }),
  } as any;
}
