import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { EntityManager } from "typeorm";
import { TenantContextService } from "./tenant-context.service.js";
import { resolveTenantRequestScope } from "./tenant-transaction.interceptor.js";
import { TENANT_DATABASE_GUCS } from "./tenant-database.constants.js";

describe("tenant database context", () => {
  it("uses tenant and optional organization transaction-local GUCs", () => {
    assert.deepEqual(TENANT_DATABASE_GUCS, {
      organizationId: "app.organization_id",
      scopeLevel: "app.scope_level",
      tenantId: "app.tenant_id",
    });
  });

  it("keeps tenant managers isolated across asynchronous work", async () => {
    const service = new TenantContextService();
    const manager = {} as EntityManager;
    const result = await service.run(
      { manager, organizationId: null, scopeLevel: "tenant", tenantId: "tenant-a" },
      async () => {
        await Promise.resolve();
        return service.current();
      },
    );
    assert.equal(result?.tenantId, "tenant-a");
    assert.equal(result?.manager, manager);
    assert.equal(service.current(false), null);
  });

  it("derives organization context only from authorized metadata or path params", () => {
    assert.deepEqual(
      resolveTenantRequestScope({ headers: { "organization-id": "spoofed" } }),
      { organizationId: null, scopeLevel: "tenant" },
    );
    assert.deepEqual(
      resolveTenantRequestScope({ params: { organizationId: "org-a" } }),
      { organizationId: "org-a", scopeLevel: "organization" },
    );
    assert.deepEqual(
      resolveTenantRequestScope({
        accessAudit: { scope: { organizationId: "org-b", scopeLevel: "organization" } },
        params: { organizationId: "org-a" },
      }),
      { organizationId: "org-b", scopeLevel: "organization" },
    );
  });
});
