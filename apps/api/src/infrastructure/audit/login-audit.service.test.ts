import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LoginAuditService } from "./login-audit.service.js";

describe("LoginAuditService", () => {
  it("normalizes login metadata and derives a device label", async () => {
    const rows: Array<Record<string, unknown>> = [];
    const service = new LoginAuditService({
      insert: async (row: Record<string, unknown>) => rows.push(row),
    } as never);

    await service.record({
      actorId: "00000000-0000-4000-8000-000000000001",
      attemptedEmail: " Admin@Example.com ",
      ipAddress: "203.0.113.10",
      result: "success",
      scopeType: "platform",
      sessionId: "00000000-0000-4000-8000-000000000002",
      userAgent: "Mozilla/5.0 Chrome/120.0 Windows NT 10.0",
    });

    assert.equal(rows[0]?.attemptedEmail, "admin@example.com");
    assert.equal(rows[0]?.deviceLabel, "Chrome / Windows");
    assert.equal(rows[0]?.workspaceId, null);
  });

  it("does not propagate persistence failures into authentication", async () => {
    const service = new LoginAuditService({
      insert: async () => {
        throw new Error("database unavailable");
      },
    } as never);

    await assert.doesNotReject(
      service.record({
        attemptedEmail: "admin@example.com",
        result: "failed",
        scopeType: "platform",
      }),
    );
  });
});
