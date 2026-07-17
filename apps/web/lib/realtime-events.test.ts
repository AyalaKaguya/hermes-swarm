import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Ticket, TicketMessage } from "./admin-api.js";
import {
  applyTicketMessageRealtimeUpdate,
  applyTicketSourceRealtimeUpdate,
  parseRealtimeEnvelope,
  toTicketMessageRealtimeUpdate,
  toTicketSourceRealtimeUpdate,
  upsertTicketMessage,
} from "./realtime-events.js";

describe("realtime event contracts", () => {
  it("parses valid envelopes and rejects malformed frames", () => {
    assert.equal(parseRealtimeEnvelope("not-json"), null);
    assert.equal(parseRealtimeEnvelope({ payload: null }), null);
    assert.deepEqual(
      parseRealtimeEnvelope(JSON.stringify({ payload: { ok: true }, type: "ready" })),
      { id: null, payload: { ok: true }, sentAt: null, tenantId: null, type: "ready" },
    );
  });

  it("extracts ticket message events and ignores other conversation sources", () => {
    const message = ticketMessage("message-1", "2026-07-17T01:00:00.000Z");
    const event = parseRealtimeEnvelope({
      payload: {
        conversation: { sourceId: "ticket-1", sourceType: "ticket" },
        message,
      },
      type: "conversation.message.created",
    })!;
    assert.deepEqual(toTicketMessageRealtimeUpdate(event), {
      message,
      ticketId: "ticket-1",
    });
    assert.equal(
      toTicketMessageRealtimeUpdate({
        ...event,
        payload: {
          conversation: { sourceId: "x", sourceType: "chat" },
          message,
        },
      }),
      null,
    );
  });

  it("deduplicates echoed messages and updates ticket summaries", () => {
    const older = ticketMessage("message-1", "2026-07-17T01:00:00.000Z");
    const newer = ticketMessage("message-2", "2026-07-17T01:01:00.000Z");
    assert.deepEqual(
      upsertTicketMessage([newer], older).map((item) => item.id),
      ["message-1", "message-2"],
    );
    assert.equal(upsertTicketMessage([older], older).length, 1);

    const tickets = [ticket("ticket-1")];
    assert.equal(
      applyTicketMessageRealtimeUpdate(tickets, {
        message: newer,
        ticketId: "ticket-1",
      })[0]?.lastMessageAt,
      newer.createdAt,
    );
  });

  it("applies ticket status events", () => {
    const event = parseRealtimeEnvelope({
      payload: {
        conversation: { status: "closed" },
        source: { sourceId: "ticket-1", sourceType: "ticket" },
        sourcePayload: { status: "closed" },
      },
      type: "conversation.source.updated",
    })!;
    const update = toTicketSourceRealtimeUpdate(event);
    assert.deepEqual(update, { status: "closed", ticketId: "ticket-1" });
    assert.equal(
      applyTicketSourceRealtimeUpdate([ticket("ticket-1")], update!)[0]?.status,
      "closed",
    );
  });
});

function ticket(id: string): Ticket {
  return {
    archivedAt: null,
    assigneeUserId: null,
    conversationId: "conversation-1",
    createdAt: "2026-07-17T00:00:00.000Z",
    handlerClosedAt: null,
    id,
    lastMessageAt: null,
    participantUserIds: [],
    requesterClosedAt: null,
    requesterUserId: "user-1",
    sourceOrganizationId: "organization-1",
    status: "open",
    subject: "Help",
    updatedAt: "2026-07-17T00:00:00.000Z",
  };
}

function ticketMessage(id: string, createdAt: string): TicketMessage {
  return {
    attachments: [],
    author: null,
    authorUserId: "user-1",
    body: "Hello",
    conversationId: "conversation-1",
    createdAt,
    id,
    kind: "message",
    metadata: null,
    sourceId: "ticket-1",
    sourceType: "ticket",
    ticketId: "ticket-1",
    updatedAt: createdAt,
  };
}
