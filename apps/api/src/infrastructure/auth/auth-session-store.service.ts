import { Injectable } from "@nestjs/common";
import { RedisService } from "../../common/redis/redis.service.js";
import type {
  AuthSessionRecord,
  ContextSelectionRecord,
  RealtimeTicketSession,
} from "./auth-session.types.js";

type RefreshIndex = {
  sessionId: string;
  workspaceId: string | null;
};

@Injectable()
export class AuthSessionStoreService {
  constructor(private readonly redisService: RedisService) {}

  async saveContextSelection(
    tokenHash: string,
    record: ContextSelectionRecord,
    ttlSeconds: number,
  ) {
    await (await this.redisService.getClient()).set(
      this.contextSelectionKey(tokenHash),
      JSON.stringify(record),
      { EX: ttlSeconds },
    );
  }

  async consumeContextSelection(tokenHash: string) {
    return this.getAndDelete(
      await this.redisService.getClient(),
      this.contextSelectionKey(tokenHash),
    );
  }

  async getSessionRecord(workspaceId: string | null, sessionId: string) {
    const rawValue = await (
      await this.redisService.getClient()
    ).get(this.sessionKey(workspaceId, sessionId));
    if (!rawValue) return null;
    try {
      return JSON.parse(rawValue) as AuthSessionRecord;
    } catch {
      return null;
    }
  }

  async saveSession(record: AuthSessionRecord, ttlSeconds: number) {
    await (
      await this.redisService.getClient()
    ).set(this.sessionKey(record.workspaceId, record.sessionId), JSON.stringify(record), {
      EX: ttlSeconds,
    });
  }

  async indexRefreshToken(
    refreshTokenHash: string,
    workspaceId: string | null,
    sessionId: string,
    ttlSeconds: number,
  ) {
    await (
      await this.redisService.getClient()
    ).set(
      this.refreshIndexKey(refreshTokenHash),
      JSON.stringify({ sessionId, workspaceId } satisfies RefreshIndex),
      { EX: ttlSeconds },
    );
  }

  async getRefreshIndex(refreshTokenHash: string) {
    return parseRefreshIndex(
      await (await this.redisService.getClient()).get(
        this.refreshIndexKey(refreshTokenHash),
      ),
    );
  }

  async deleteRefreshIndex(refreshTokenHash: string) {
    await (await this.redisService.getClient()).del(
      this.refreshIndexKey(refreshTokenHash),
    );
  }

  async addUserSession(
    workspaceId: string | null,
    userId: string,
    sessionId: string,
    principalType: "platform" | "workspace",
    membershipId: string | null,
    ttlSeconds: number,
  ) {
    const client = await this.redisService.getClient();
    const key = this.userSessionsKey(workspaceId, userId);
    await client.sAdd(key, sessionId);
    await client.expire(key, ttlSeconds);
    const contextId = workspaceId ?? "platform";
    const accountKey = this.accountSessionsKey(userId);
    await client.sAdd(accountKey, `${contextId}:${sessionId}`);
    await client.expire(accountKey, ttlSeconds);
    if (membershipId) {
      const membershipKey = this.membershipSessionsKey(principalType, membershipId);
      await client.sAdd(membershipKey, `${contextId}:${sessionId}`);
      await client.expire(membershipKey, ttlSeconds);
    }
  }

  async listUserSessionIds(workspaceId: string | null, userId: string) {
    return (await this.redisService.getClient()).sMembers(
      this.userSessionsKey(workspaceId, userId),
    );
  }

  async removeUserSessionIds(
    workspaceId: string | null,
    userId: string,
    sessionIds: string[],
  ) {
    if (!sessionIds.length) return;
    await (await this.redisService.getClient()).sRem(
      this.userSessionsKey(workspaceId, userId),
      sessionIds,
    );
  }

  async listAccountSessionEntries(accountId: string) {
    return (await this.redisService.getClient()).sMembers(
      this.accountSessionsKey(accountId),
    );
  }

  async listMembershipSessionEntries(
    principalType: "platform" | "workspace",
    membershipId: string,
  ) {
    return (await this.redisService.getClient()).sMembers(
      this.membershipSessionsKey(principalType, membershipId),
    );
  }

  async createRealtimeTicket(
    ticketHash: string,
    session: RealtimeTicketSession,
    ttlSeconds: number,
  ) {
    const client = await this.redisService.getClient();
    await Promise.all([
      client.set(
        this.realtimeTicketKey(session.workspaceId, ticketHash),
        JSON.stringify(session satisfies RealtimeTicketSession),
        { EX: ttlSeconds },
      ),
      client.set(this.realtimeTicketIndexKey(ticketHash), session.workspaceId, {
        EX: ttlSeconds,
      }),
    ]);
  }

  async consumeRealtimeTicket(ticketHash: string) {
    const client = await this.redisService.getClient();
    const workspaceId = await this.getAndDelete(
      client,
      this.realtimeTicketIndexKey(ticketHash),
    );
    if (!workspaceId) return null;
    return this.getAndDelete(client, this.realtimeTicketKey(workspaceId, ticketHash));
  }

  async acquireRefreshLock(
    refreshTokenHash: string,
    lockOwner: string,
    ttlSeconds: number,
  ) {
    const result = await (await this.redisService.getClient()).set(
      this.refreshLockKey(refreshTokenHash),
      lockOwner,
      { EX: ttlSeconds, NX: true },
    );
    return Boolean(result);
  }

  async getRefreshRotationResult(refreshTokenHash: string) {
    return (await this.redisService.getClient()).get(
      this.refreshRotationKey(refreshTokenHash),
    );
  }

  async saveRefreshRotationResult(
    refreshTokenHash: string,
    encryptedResult: string,
    ttlSeconds: number,
  ) {
    await (await this.redisService.getClient()).set(
      this.refreshRotationKey(refreshTokenHash),
      encryptedResult,
      { EX: ttlSeconds },
    );
  }

  async releaseRefreshLock(refreshTokenHash: string, lockOwner: string) {
    await (await this.redisService.getClient()).eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0",
      {
        arguments: [lockOwner],
        keys: [this.refreshLockKey(refreshTokenHash)],
      },
    );
  }

  async deleteSessionRecord(record: AuthSessionRecord) {
    const client = await this.redisService.getClient();
    await Promise.all([
      client.del(this.sessionKey(record.workspaceId, record.sessionId)),
      client.del(this.refreshIndexKey(record.refreshTokenHash)),
      client.sRem(
        this.userSessionsKey(record.workspaceId, record.userId),
        record.sessionId,
      ),
    ]);
  }

  private async getAndDelete(
    client: Awaited<ReturnType<RedisService["getClient"]>>,
    key: string,
  ) {
    if ("getDel" in client && typeof client.getDel === "function") {
      return client.getDel(key);
    }

    const rawValue = await client.get(key);
    if (rawValue) {
      await client.del(key);
    }
    return rawValue;
  }

  private sessionKey(workspaceId: string | null, sessionId: string) {
    return `auth:${workspaceNamespace(workspaceId)}:session:${sessionId}`;
  }

  private refreshIndexKey(refreshTokenHash: string) {
    return `auth:refresh:${refreshTokenHash}`;
  }

  private refreshLockKey(refreshTokenHash: string) {
    return `auth:refresh_lock:${refreshTokenHash}`;
  }

  private refreshRotationKey(refreshTokenHash: string) {
    return `auth:refresh_rotation:${refreshTokenHash}`;
  }

  private userSessionsKey(workspaceId: string | null, userId: string) {
    return `auth:${workspaceNamespace(workspaceId)}:user_sessions:${userId}`;
  }

  private accountSessionsKey(accountId: string) {
    return `auth:account:${accountId}:sessions`;
  }

  private contextSelectionKey(tokenHash: string) {
    return `auth:context_selection:${tokenHash}`;
  }

  private membershipSessionsKey(
    principalType: "platform" | "workspace",
    membershipId: string,
  ) {
    return `auth:membership:${principalType}:${membershipId}:sessions`;
  }

  private realtimeTicketKey(workspaceId: string, ticketHash: string) {
    return `auth:${workspaceId}:realtime_ticket:${ticketHash}`;
  }

  private realtimeTicketIndexKey(ticketHash: string) {
    return `auth:realtime_ticket_index:${ticketHash}`;
  }
}

function workspaceNamespace(workspaceId: string | null) {
  return workspaceId ?? "platform";
}

function parseRefreshIndex(value: string | null): RefreshIndex | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as {
      sessionId?: unknown;
      workspaceId?: unknown;
    };
    return typeof parsed.sessionId === "string" &&
      (typeof parsed.workspaceId === "string" || parsed.workspaceId === null)
      ? { sessionId: parsed.sessionId, workspaceId: parsed.workspaceId }
      : null;
  } catch {
    return null;
  }
}
