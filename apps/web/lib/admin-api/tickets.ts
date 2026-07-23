import type { AuthenticatedAdminSessionMarker } from "@/lib/authenticated-admin";
import type {
  PlatformTicket,
  Ticket,
  TicketMessage,
  TicketMessageAttachment,
  TicketStatus,
} from "@hermes-swarm/api-contracts";
import { fetchAdmin } from "./client";

export function listTickets(
  session: AuthenticatedAdminSessionMarker,
  options: { status?: TicketStatus } = {},
) {
  const params = new URLSearchParams();
  if (options.status) params.set("status", options.status);
  const query = params.toString();
  return fetchAdmin<Ticket[]>(`/tickets${query ? `?${query}` : ""}`, {});
}

export function listPlatformTickets(
  session: AuthenticatedAdminSessionMarker,
  options: { status?: TicketStatus } = {},
) {
  const params = new URLSearchParams();
  if (options.status) params.set("status", options.status);
  const query = params.toString();
  return fetchAdmin<PlatformTicket[]>(
    `/platform/tickets${query ? `?${query}` : ""}`,
    {},
  );
}

export function getPlatformTicket(
  session: AuthenticatedAdminSessionMarker,
  ticketId: string,
) {
  return fetchAdmin<PlatformTicket>(`/platform/tickets/${ticketId}`, {});
}

export function listPlatformTicketMessages(
  session: AuthenticatedAdminSessionMarker,
  ticketId: string,
) {
  return fetchAdmin<TicketMessage[]>(`/platform/tickets/${ticketId}/messages`, {});
}

export function sendPlatformTicketMessage(
  session: AuthenticatedAdminSessionMarker,
  ticketId: string,
  payload: { attachments?: TicketMessageAttachment[] | null; body: string },
) {
  return fetchAdmin<TicketMessage>(`/platform/tickets/${ticketId}/messages`, {
    body: payload,
    method: "POST",
  });
}

export function closePlatformTicket(
  session: AuthenticatedAdminSessionMarker,
  ticketId: string,
) {
  return fetchAdmin<PlatformTicket>(`/platform/tickets/${ticketId}/close`, {
    method: "PATCH",
  });
}

export function markPlatformTicketRead(
  session: AuthenticatedAdminSessionMarker,
  ticketId: string,
) {
  return fetchAdmin<{ ok: boolean }>(`/platform/tickets/${ticketId}/read`, {
    method: "PATCH",
  });
}

export function createTicket(
  session: AuthenticatedAdminSessionMarker,
  payload: {
    attachments?: TicketMessageAttachment[] | null;
    body: string;
    subject: string;
  },
) {
  return fetchAdmin<Ticket & { firstMessage: TicketMessage }>(
    "/tickets",
    { body: payload, method: "POST" },
  );
}

export function getTicket(session: AuthenticatedAdminSessionMarker, ticketId: string) {
  return fetchAdmin<Ticket>(`/tickets/${ticketId}`, {});
}

export function listTicketMessages(session: AuthenticatedAdminSessionMarker, ticketId: string) {
  return fetchAdmin<TicketMessage[]>(`/tickets/${ticketId}/messages`, {});
}

export function sendTicketMessage(
  session: AuthenticatedAdminSessionMarker,
  ticketId: string,
  payload: { attachments?: TicketMessageAttachment[] | null; body: string },
) {
  return fetchAdmin<TicketMessage>(`/tickets/${ticketId}/messages`, {
    body: payload,
    method: "POST",
  });
}

export function closeTicket(session: AuthenticatedAdminSessionMarker, ticketId: string) {
  return fetchAdmin<Ticket>(`/tickets/${ticketId}/close`, {
    method: "PATCH",
  });
}

export function markTicketRead(session: AuthenticatedAdminSessionMarker, ticketId: string) {
  return fetchAdmin<{ ok: boolean }>(`/tickets/${ticketId}/read`, {
    method: "PATCH",
  });
}
