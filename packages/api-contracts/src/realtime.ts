import { z } from "zod";
import { IdentifierSchema, IsoDateTimeSchema, TicketMessageSchema, TicketStatusSchema, UserNotificationSchema } from "./models.js";

const envelopeBase = {
  id: IdentifierSchema.nullable().default(null),
  sentAt: IsoDateTimeSchema.nullable().default(null),
  workspaceId: IdentifierSchema.nullable().default(null),
};

export const KnownRealtimeEnvelopeSchema = z.discriminatedUnion("type", [
  z.strictObject({
    ...envelopeBase,
    type: z.literal("realtime.connected"),
    payload: z.strictObject({ clientId: IdentifierSchema, sessionId: IdentifierSchema.optional(), workspaceId: IdentifierSchema }),
  }),
  z.strictObject({
    ...envelopeBase,
    type: z.literal("realtime.error"),
    payload: z.strictObject({ message: z.string() }),
  }),
  z.strictObject({ ...envelopeBase, type: z.literal("pong"), payload: z.null() }),
  z.strictObject({
    ...envelopeBase,
    type: z.literal("notification.created"),
    payload: UserNotificationSchema.extend({ workspaceId: IdentifierSchema }),
  }),
  z.strictObject({
    ...envelopeBase,
    type: z.literal("conversation.message.created"),
    payload: z.strictObject({
      conversation: z.strictObject({ sourceId: IdentifierSchema, sourceType: z.literal("ticket") }).passthrough(),
      message: TicketMessageSchema,
    }).passthrough(),
  }),
  z.strictObject({
    ...envelopeBase,
    type: z.literal("conversation.source.updated"),
    payload: z.strictObject({
      conversation: z.record(z.string(), z.unknown()).optional(),
      source: z.strictObject({ sourceId: IdentifierSchema, sourceType: z.literal("ticket"), status: TicketStatusSchema.optional() }).passthrough(),
      sourcePayload: z.strictObject({ status: TicketStatusSchema }).passthrough().optional(),
    }).passthrough(),
  }),
]);

export const PublicRealtimeEnvelopeSchema = KnownRealtimeEnvelopeSchema;

export type RealtimeEnvelope = z.infer<typeof PublicRealtimeEnvelopeSchema>;
export type PublicRealtimeEvent = Omit<RealtimeEnvelope, "id" | "sentAt" | "workspaceId"> & { id?: string };

export function parseRealtimeEnvelope(input: unknown): RealtimeEnvelope | null {
  try {
    const value = typeof input === "string" ? JSON.parse(input) : input;
    const result = PublicRealtimeEnvelopeSchema.safeParse(value);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
