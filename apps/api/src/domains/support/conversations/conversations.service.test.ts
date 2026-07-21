import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConversationCapabilityService } from "./conversations.service.js";

describe("ConversationCapabilityService workspace source contract", () => {
  it("looks up conversations by workspace, source type and source id", async () => {
    const lookups: unknown[] = [];
    const saved: Array<Record<string, unknown>> = [];
    const manager = {
      findOne: async (_target: unknown, query: unknown) => {
        lookups.push(query);
        return null;
      },
      save: async (_target: unknown, value: Record<string, unknown>) => {
        const entity = { id: "conversation-a", ...value };
        saved.push(entity);
        return entity;
      },
    };
    const service = new ConversationCapabilityService(
      {
        create: (value: unknown) => value,
        manager: { transaction: async (work: (manager: unknown) => unknown) => work(manager) },
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      undefined,
    );
    const result = await service.ensureConversationForSource({
      sourceId: "ticket-a",
      sourceType: "ticket",
      status: "open",
      subject: "Need help",
      workspaceId: "workspace-a",
    });
    assert.deepEqual((lookups[0] as { where: unknown }).where, {
      sourceId: "ticket-a",
      sourceType: "ticket",
      workspaceId: "workspace-a",
    });
    assert.equal(result.workspaceId, "workspace-a");
    assert.equal(saved.length, 1);
  });

  it("rejects conversation sources without an explicit workspace", async () => {
    const service = new ConversationCapabilityService(
      { manager: { transaction: async (work: (manager: unknown) => unknown) => work({}) } } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      undefined,
    );
    await assert.rejects(
      service.ensureConversationForSource({
        sourceId: "ticket-a",
        sourceType: "ticket",
        workspaceId: "",
      }),
    );
  });
});
