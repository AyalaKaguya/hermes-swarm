import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseAuditListQuery } from "./audit-query.js";

describe("audit list query parsing", () => {
  it("accepts numeric pagination normalized by the admin contract interceptor", () => {
    assert.deepEqual(
      parseAuditListQuery(
        { page: 2, pageSize: 50 },
        { results: ["failed", "success"] },
      ),
      {
        actorId: null,
        from: null,
        httpMethod: null,
        keyword: null,
        page: 2,
        pageSize: 50,
        permission: null,
        result: null,
        to: null,
      },
    );
  });

  it("continues to reject invalid numeric pagination", () => {
    assert.throws(
      () =>
        parseAuditListQuery(
          { page: 1.5 },
          { results: ["failed", "success"] },
        ),
      /page 必须是整数/,
    );
  });
});
