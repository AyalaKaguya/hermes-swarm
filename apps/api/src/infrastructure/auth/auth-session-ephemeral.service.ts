import { randomBytes } from "node:crypto";
import { Injectable, UnauthorizedException } from "@nestjs/common";
import { AuthSessionStoreService } from "./auth-session-store.service.js";
import { hashAuthToken } from "./auth-session-security.js";
import type {
  ContextSelectionRecord,
  RealtimeTicketSession,
} from "./auth-session.types.js";

const CONTEXT_SELECTION_TTL_SECONDS = 5 * 60;
const REALTIME_TICKET_TTL_SECONDS = 30;

@Injectable()
export class AuthSessionEphemeralService {
  constructor(private readonly sessionStore: AuthSessionStoreService) {}

  async createContextSelection(
    accountId: string,
    credentialVersion: number,
    contextMembershipIds: string[],
  ) {
    const selectionToken = randomBytes(32).toString("base64url");
    const expiresAt = new Date(
      Date.now() + CONTEXT_SELECTION_TTL_SECONDS * 1000,
    ).toISOString();
    const record: ContextSelectionRecord = {
      accountId,
      credentialVersion,
      contextMembershipIds: [...new Set(contextMembershipIds)],
      expiresAt,
    };
    await this.sessionStore.saveContextSelection(
      hashAuthToken(selectionToken),
      record,
      CONTEXT_SELECTION_TTL_SECONDS,
    );
    return { expiresAt, selectionToken };
  }

  async consumeContextSelection(selectionToken: string) {
    const raw = await this.sessionStore.consumeContextSelection(
      hashAuthToken(selectionToken),
    );
    if (!raw) throw new UnauthorizedException("上下文选择凭证无效或已过期");
    const parsed = JSON.parse(raw) as ContextSelectionRecord;
    if (
      !parsed.accountId ||
      !Array.isArray(parsed.contextMembershipIds) ||
      new Date(parsed.expiresAt).getTime() <= Date.now()
    ) {
      throw new UnauthorizedException("上下文选择凭证无效或已过期");
    }
    return parsed;
  }

  async createRealtimeTicket(session: RealtimeTicketSession) {
    const ticket = randomBytes(32).toString("base64url");
    const expiresAt = new Date(
      Date.now() + REALTIME_TICKET_TTL_SECONDS * 1000,
    ).toISOString();
    await this.sessionStore.createRealtimeTicket(
      hashAuthToken(ticket),
      session,
      REALTIME_TICKET_TTL_SECONDS,
    );
    return { expiresAt, ticket };
  }

  async consumeRealtimeTicket(ticket: string | undefined) {
    if (!ticket) {
      throw new UnauthorizedException("登录已失效，请重新登录");
    }

    const rawValue = await this.sessionStore.consumeRealtimeTicket(
      hashAuthToken(ticket),
    );
    if (!rawValue) {
      throw new UnauthorizedException("登录已失效，请重新登录");
    }

    try {
      return JSON.parse(rawValue) as RealtimeTicketSession;
    } catch {
      throw new UnauthorizedException("登录已失效，请重新登录");
    }
  }
}
