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
      {} as never,
      {
        create: (value: unknown) => value,
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {
        manager,
        transaction: async (work: (manager: unknown) => unknown) => work(manager),
      } as never,
      {} as never,
      {} as never,
      { current: () => ({ workspaceId: "workspace-a" }) } as never,
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
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {
        manager: {},
        transaction: async (work: (manager: unknown) => unknown) => work({}),
      } as never,
      {} as never,
      {} as never,
      { current: () => ({ workspaceId: "workspace-a" }) } as never,
    );
    await assert.rejects(
      service.ensureConversationForSource({
        sourceId: "ticket-a",
        sourceType: "ticket",
        workspaceId: "",
      }),
    );
  });

  it("filters resolver-provided mentions through active workspace memberships", async () => {
    const membershipManager = {
      find: async () => [
        {
          account: { id: "member-a", status: "active" },
          accountId: "member-a",
        },
      ],
    };
    const service = new ConversationCapabilityService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { manager: membershipManager } as never,
      {} as never,
      {} as never,
      { current: () => ({ workspaceId: "workspace-a" }) } as never,
    );

    const ids = await service.resolveMentionedUserIdsForSource({
      authorUserId: "author-a",
      body: "@member-a @outside-user",
      resolver: {
        resolveMentionCandidates: async () => ["member-a", "outside-user"],
      },
      source: {
        sourceId: "ticket-a",
        sourceType: "ticket",
        workspaceId: "workspace-a",
      },
    });

    assert.deepEqual(ids, ["member-a"]);
  });
});
