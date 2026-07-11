import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TicketAccessScopeResolver } from "./ticket-access-scope.resolver.js";

describe("TicketAccessScopeResolver", () => {
  it("establishes tenant RLS context before resolving a ticket in the guard", async () => {
    const queries: Array<{ parameters: unknown[]; sql: string }> = [];
    const resolver = new TicketAccessScopeResolver({
      transaction: async (work: (manager: any) => Promise<unknown>) =>
        work({
          getRepository: () => ({
            findOne: async () => ({ organizationId: "org-1", scope: "organization" }),
          }),
          query: async (sql: string, parameters: unknown[]) => {
            queries.push({ parameters, sql });
          },
        }),
    } as any);

    const result = await resolver.resolve({
      definition: {} as any,
      request: {
        accessPrincipal: { tenantId: "tenant-1" },
        params: { ticketId: "ticket-1" },
      },
    });

    assert.deepEqual(result, { organizationId: "org-1", tenantId: "tenant-1" });
    assert.equal(queries.length, 1);
    assert.match(queries[0].sql, /set_config\('app\.tenant_id'/);
    assert.deepEqual(queries[0].parameters, ["tenant-1"]);
  });
});
