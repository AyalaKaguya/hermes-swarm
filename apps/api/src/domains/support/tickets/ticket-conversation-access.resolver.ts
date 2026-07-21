import { Injectable } from "@nestjs/common";

/** Conversation access is enforced by TicketsService within the active workspace. */
@Injectable()
export class TicketConversationAccessResolver {}
