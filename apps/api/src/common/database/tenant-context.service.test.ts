import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";
import type { EntityManager } from "typeorm";
import { TenantContextService } from "./tenant-context.service.js";
import { resolveTenantRequestScope } from "./tenant-transaction.interceptor.js";
import { TENANT_DATABASE_GUCS } from "./tenant-database.constants.js";

describe("tenant database context", () => {
  it("uses the canonical transaction-local PostgreSQL GUC schema", () => {
    assert.deepEqual(TENANT_DATABASE_GUCS, {
      departmentId: "app.department_id",
      organizationId: "app.organization_id",
      scopeLevel: "app.scope_level",
      tenantId: "app.tenant_id",
    });
  });

  it("keeps tenant managers isolated across asynchronous work", async () => {
    const service = new TenantContextService();
    const manager = {} as EntityManager;
    const result = await service.run(
      {
        departmentId: "dept-a",
        manager,
        organizationId: "org-a",
        scopeLevel: "department",
        tenantId: "tenant-a",
      },
      async () => {
        await Promise.resolve();
        return service.current();
      },
    );

    assert.equal(result?.tenantId, "tenant-a");
    assert.equal(result?.manager, manager);
    assert.equal(service.current(false), null);
  });

  it("normalizes tenant, organization and department request scopes", () => {
    assert.deepEqual(
      resolveTenantRequestScope({ headers: { "x-scope-level": "tenant" } }),
      { departmentId: null, organizationId: null, scopeLevel: "tenant" },
    );
    assert.deepEqual(
      resolveTenantRequestScope({
        headers: {
          "organization-id": "org-a",
          "x-scope-level": "organization",
        },
      }),
      {
        departmentId: null,
        organizationId: "org-a",
        scopeLevel: "organization",
      },
    );
    assert.deepEqual(
      resolveTenantRequestScope({
        headers: {
          "department-id": "dept-a",
          "organization-id": "org-a",
          "x-scope-level": "department",
        },
      }),
      {
        departmentId: "dept-a",
        organizationId: "org-a",
        scopeLevel: "department",
      },
    );
  });

  it("rejects path/header mismatches and incomplete department scopes", () => {
    assert.throws(
      () =>
        resolveTenantRequestScope({
          headers: {
            "organization-id": "org-b",
            "x-scope-level": "organization",
          },
          params: { organizationId: "org-a" },
        }),
      BadRequestException,
    );
    assert.throws(
      () =>
        resolveTenantRequestScope({
          headers: { "x-scope-level": "department" },
        }),
      BadRequestException,
    );
  });
});
