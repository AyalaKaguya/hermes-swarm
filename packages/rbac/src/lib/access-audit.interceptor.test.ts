import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";
import { firstValueFrom, of, throwError } from "rxjs";
import { AccessAuditInterceptor } from "./access-audit.interceptor.js";
import { AccessAuditService } from "./access-audit.service.js";
import type { AccessRequest, ResolvedAccessDefinition } from "./access.types.js";

describe("access audit persistence", () => {
  it("persists tenant scope, actor, permission, and result", async () => {
    const rows: any[] = [];
    const service = new AccessAuditService({
      insert: async (row: any) => {
        rows.push(row);
      },
    } as any);
    const request = createRequest();

    await service.recordRequest(request, "allowed", { statusCode: 200 });

    assert.deepEqual(rows, [
      {
        actorId: "user-1",
        errorCode: null,
        httpMethod: "PATCH",
        httpPath: "/api/admin/organizations/org-1",
        ipAddress: null,
        organizationId: "org-1",
        permission: "organization.update:organization",
        principalType: "tenant",
        result: "allowed",
        scopeType: "organization",
        sessionId: null,
        statusCode: 200,
        targetTenantId: null,
        tenantId: "tenant-1",
        userAgent: null,
      },
    ]);
  });

  it("records the target tenant for platform control-plane access", async () => {
    const rows: any[] = [];
    const service = new AccessAuditService({
      insert: async (row: any) => rows.push(row),
    } as any);
    const request = createRequest({
      accessPrincipal: {
        principalType: "platform",
        tenantId: null,
        userId: "platform-user-1",
      },
      params: { tenantId: "tenant-target" },
    });

    await service.recordRequest(request, "denied", { statusCode: 403 });

    assert.equal(rows[0].principalType, "platform");
    assert.equal(rows[0].tenantId, null);
    assert.equal(rows[0].targetTenantId, "tenant-target");
    assert.equal(rows[0].result, "denied");
  });

  it("records allowed handler completion", async () => {
    const calls: any[] = [];
    const interceptor = new AccessAuditInterceptor({
      recordRequest: async (...args: any[]) => calls.push(args),
    } as any);
    const request = createRequest();

    const result = await firstValueFrom(
      interceptor.intercept(createContext(request, 204), {
        handle: () => of("ok"),
      }),
    );

    assert.equal(result, "ok");
    assert.equal(calls.length, 1);
    assert.equal(calls[0][1], "allowed");
    assert.equal(calls[0][2].statusCode, 204);
  });

  it("records handler errors and preserves the original exception", async () => {
    const calls: any[] = [];
    const interceptor = new AccessAuditInterceptor({
      recordRequest: async (...args: any[]) => calls.push(args),
    } as any);
    const request = createRequest();
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
    assert.equal(calls.length, 1);
    assert.equal(calls[0][1], "error");
    assert.equal(calls[0][2].error, error);
  });

  it("extracts the target tenant created by an allowed platform approval", async () => {
    const calls: any[] = [];
    const interceptor = new AccessAuditInterceptor({
      recordRequest: async (...args: any[]) => calls.push(args),
    } as any);
    const request = createRequest({
      accessPrincipal: {
        principalType: "platform",
        tenantId: null,
        userId: "platform-user-1",
      },
    });

    await firstValueFrom(
      interceptor.intercept(createContext(request, 201), {
        handle: () => of({ tenant: { id: "tenant-created" } }),
      }),
    );

    assert.equal(calls[0][2].targetTenantId, "tenant-created");
  });
});

const definition: ResolvedAccessDefinition = {
  defaultRoles: [],
  description: null,
  entity: "ticket",
  entityLabel: "工单",
  entityOrder: 1,
  id: "organization.update:organization",
  isDangerous: false,
  operation: "handle",
  operationLabel: "处理工单",
  operationOrder: 1,
  purpose: "conversation",
  purposeLabel: "工单会话",
  purposeOrder: 1,
  scope: "organization",
};

function createRequest(overrides: Partial<AccessRequest> = {}): AccessRequest {
  return {
    accessAudit: {
      definition,
      scope: {
        organizationId: "org-1",
        scopeLevel: "organization",
        tenantId: "tenant-1",
      },
    },
    accessPrincipal: {
      principalType: "tenant",
      tenantId: "tenant-1",
      userId: "user-1",
    },
    method: "patch",
    originalUrl: "/api/admin/organizations/org-1",
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
