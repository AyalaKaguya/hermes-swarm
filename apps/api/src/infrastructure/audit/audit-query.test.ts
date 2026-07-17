import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";
import { parseAuditListQuery } from "./audit-query.js";

describe("audit query parsing", () => {
  it("applies stable pagination defaults and normalizes filters", () => {
    const query = parseAuditListQuery(
      {
        actorId: "00000000-0000-4000-8000-000000000001",
        from: "2026-07-01T00:00:00.000Z",
        httpMethod: "patch",
        keyword: " admin ",
        page: "2",
        pageSize: "50",
        result: "allowed",
      },
      { results: ["allowed", "denied", "error"] },
    );

    assert.equal(query.page, 2);
    assert.equal(query.pageSize, 50);
    assert.equal(query.httpMethod, "PATCH");
    assert.equal(query.keyword, "admin");
    assert.equal(query.from?.toISOString(), "2026-07-01T00:00:00.000Z");
  });

  it("rejects oversized pages and reversed time windows", () => {
    assert.throws(
      () =>
        parseAuditListQuery(
          { pageSize: "101" },
          { results: ["success", "failed"] },
        ),
      BadRequestException,
    );
    assert.throws(
      () =>
        parseAuditListQuery(
          {
            from: "2026-07-02T00:00:00.000Z",
            to: "2026-07-01T00:00:00.000Z",
          },
          { results: ["success", "failed"] },
        ),
      BadRequestException,
    );
  });
});
