import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  auditDateBoundaryToIso,
  auditDateFromKey,
  auditDateKeyFromDate,
  formatAuditDateKey,
} from "./audit-date-range.js";

describe("audit date range", () => {
  it("roundtrips calendar dates and formats runtime date preferences", () => {
    const selected = auditDateFromKey("2026-07-18");
    assert.ok(selected);
    assert.equal(auditDateKeyFromDate(selected), "2026-07-18");
    assert.equal(formatAuditDateKey("2026-07-18", "YYYY/MM/DD"), "2026/07/18");
    assert.equal(formatAuditDateKey("2026-07-18", "DD/MM/YYYY"), "18/07/2026");
  });

  it("uses the runtime time zone for inclusive day boundaries", () => {
    assert.equal(
      auditDateBoundaryToIso("2026-07-18", "Asia/Shanghai", "start"),
      "2026-07-17T16:00:00.000Z",
    );
    assert.equal(
      auditDateBoundaryToIso("2026-07-18", "Asia/Shanghai", "end"),
      "2026-07-18T15:59:59.999Z",
    );
  });

  it("accounts for daylight-saving changes within the selected day", () => {
    assert.equal(
      auditDateBoundaryToIso("2026-03-08", "America/New_York", "start"),
      "2026-03-08T05:00:00.000Z",
    );
    assert.equal(
      auditDateBoundaryToIso("2026-03-08", "America/New_York", "end"),
      "2026-03-09T03:59:59.999Z",
    );
  });
});
