import type { Ticket, TicketMessage, TicketStatus } from "@/lib/admin-api";
import {
  parseRealtimeEnvelope as parseSharedRealtimeEnvelope,
} from "@hermes-swarm/api-contracts/realtime";

export function parseRealtimeEnvelope(input: unknown) {
  const event = parseSharedRealtimeEnvelope(input);
  if (!event) console.warn("Ignored invalid realtime event");
  return event;
}
export type RealtimeEnvelope = {
  id: string | null;
  payload: unknown;
  sentAt: string | null;
  workspaceId: string | null;
  type: string;
};

export type TicketMessageRealtimeUpdate = {
  message: TicketMessage;
  ticketId: string;
};

export type TicketSourceRealtimeUpdate = {
  status: TicketStatus;
  ticketId: string;
};

export function toTicketMessageRealtimeUpdate(
  event: RealtimeEnvelope,
): TicketMessageRealtimeUpdate | null {
  if (event.type !== "conversation.message.created" || !isRecord(event.payload)) {
    return null;
  }
  const conversation = event.payload.conversation;
  const message = event.payload.message;
  if (
    !isRecord(conversation) ||
    conversation.sourceType !== "ticket" ||
    typeof conversation.sourceId !== "string" ||
    !isTicketMessage(message)
  ) {
    return null;
  }
  return { message, ticketId: conversation.sourceId };
}

export function toTicketSourceRealtimeUpdate(
  event: RealtimeEnvelope,
): TicketSourceRealtimeUpdate | null {
  if (event.type !== "conversation.source.updated" || !isRecord(event.payload)) {
    return null;
  }
  const source = event.payload.source;
  const sourcePayload = event.payload.sourcePayload;
  const conversation = event.payload.conversation;
  if (
    !isRecord(source) ||
    source.sourceType !== "ticket" ||
    typeof source.sourceId !== "string"
  ) {
    return null;
  }
  const status =
    (isRecord(sourcePayload) ? sourcePayload.status : null) ??
    source.status ??
    (isRecord(conversation) ? conversation.status : null);
  if (!isTicketStatus(status)) return null;
  return { status, ticketId: source.sourceId };
}

export function upsertTicketMessage(
  messages: TicketMessage[],
  incoming: TicketMessage,
) {
  const existingIndex = messages.findIndex((message) => message.id === incoming.id);
  const next = [...messages];
  if (existingIndex >= 0) next[existingIndex] = incoming;
  else next.push(incoming);
  return next.sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
  );
}

export function applyTicketMessageRealtimeUpdate(
  tickets: Ticket[],
  update: TicketMessageRealtimeUpdate,
) {
  return tickets.map((ticket) =>
    ticket.id === update.ticketId
      ? {
          ...ticket,
          lastMessageAt: update.message.createdAt,
          updatedAt: update.message.updatedAt,
        }
      : ticket,
  );
}

export function applyTicketSourceRealtimeUpdate(
  tickets: Ticket[],
  update: TicketSourceRealtimeUpdate,
) {
  return tickets.map((ticket) =>
    ticket.id === update.ticketId ? { ...ticket, status: update.status } : ticket,
  );
}

function isTicketMessage(value: unknown): value is TicketMessage {
  return Boolean(
    isRecord(value) &&
      typeof value.id === "string" &&
      typeof value.conversationId === "string" &&
      typeof value.createdAt === "string" &&
      typeof value.updatedAt === "string" &&
      typeof value.body === "string" &&
      (value.kind === "message" || value.kind === "system") &&
      Array.isArray(value.attachments),
  );
}

function isTicketStatus(value: unknown): value is TicketStatus {
  return value === "open" || value === "closed" || value === "archived";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
