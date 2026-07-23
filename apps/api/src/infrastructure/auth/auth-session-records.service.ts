import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AuthSessionStoreService } from "./auth-session-store.service.js";
import { isSessionExpired } from "./auth-session-security.js";
import type { AuthSessionRecord } from "./auth-session.types.js";

@Injectable()
export class AuthSessionRecordsService {
  constructor(
    private readonly configService: ConfigService,
    private readonly sessionStore: AuthSessionStoreService,
  ) {}

  async touchSession(
    sessionId: string,
    workspaceId: string | null,
    userId: string,
  ) {
    const latestRecord = await this.sessionStore.getSessionRecord(
      workspaceId,
      sessionId,
    );
    if (
      !latestRecord ||
      latestRecord.userId !== userId ||
      latestRecord.revokedAt ||
      isSessionExpired(latestRecord)
    ) {
      throw new UnauthorizedException("登录已失效，请重新登录");
    }

    const touchedRecord = {
      ...latestRecord,
      lastSeenAt: new Date().toISOString(),
    };
    await this.sessionStore.saveSession(
      touchedRecord,
      this.sessionHistoryTtlSeconds,
    );
    return touchedRecord;
  }

  async listSessions(
    workspaceId: string | null,
    userId: string,
    currentSessionId: string,
  ) {
    const sessionIds = await this.sessionStore.listUserSessionIds(workspaceId, userId);
    const records = await Promise.all(
      sessionIds.map((sessionId) =>
        this.sessionStore.getSessionRecord(workspaceId, sessionId),
      ),
    );
    const missingSessionIds = sessionIds.filter((_, index) => !records[index]);
    if (missingSessionIds.length > 0) {
      await this.sessionStore.removeUserSessionIds(
        workspaceId,
        userId,
        missingSessionIds,
      );
    }

    return records
      .filter((record): record is AuthSessionRecord => Boolean(record))
      .sort(
        (left, right) =>
          dateToSortableTime(right.lastSeenAt) -
          dateToSortableTime(left.lastSeenAt),
      )
      .map((record) => ({
        browser: record.browser,
        createdAt: record.createdAt,
        deviceLabel: record.deviceLabel,
        expiresAt: record.expiresAt,
        ipAddress: record.ipAddress,
        isCurrent: record.sessionId === currentSessionId,
        isExpired: isSessionExpired(record),
        lastSeenAt: record.lastSeenAt,
        os: record.os,
        revokedAt: record.revokedAt,
        sessionId: record.sessionId,
      }));
  }

  async revokeSession(
    workspaceId: string | null,
    sessionId: string,
    expectedUserId?: string,
  ) {
    const record = await this.sessionStore.getSessionRecord(workspaceId, sessionId);
    if (!record || (expectedUserId && record.userId !== expectedUserId)) {
      return;
    }

    const revokedRecord = {
      ...record,
      revokedAt: record.revokedAt ?? new Date().toISOString(),
    };
    await Promise.all([
      this.sessionStore.deleteRefreshIndex(record.refreshTokenHash),
      this.sessionStore.saveSession(revokedRecord, this.sessionHistoryTtlSeconds),
    ]);
  }

  async revokeOtherSessions(
    workspaceId: string | null,
    userId: string,
    currentSessionId: string,
  ) {
    const sessionIds = await this.sessionStore.listUserSessionIds(workspaceId, userId);
    await Promise.all(
      sessionIds
        .filter((sessionId) => sessionId !== currentSessionId)
        .map((sessionId) => this.revokeSession(workspaceId, sessionId, userId)),
    );
  }

  async revokeUserSessions(workspaceId: string, userId: string) {
    const sessionIds = await this.sessionStore.listUserSessionIds(workspaceId, userId);
    await Promise.all(
      sessionIds.map((sessionId) =>
        this.revokeSession(workspaceId, sessionId, userId),
      ),
    );
  }

  async revokeAccountSessions(accountId: string) {
    const entries = await this.sessionStore.listAccountSessionEntries(accountId);
    await Promise.all(
      entries.map(async (entry) => {
        const [contextId, sessionId] = entry.split(":", 2);
        if (contextId && sessionId) {
          await this.revokeSession(
            contextId === "platform" ? null : contextId,
            sessionId,
            accountId,
          );
        }
      }),
    );
  }

  async revokeMembershipSessions(
    principalType: "platform" | "workspace",
    membershipId: string,
  ) {
    const entries = await this.sessionStore.listMembershipSessionEntries(
      principalType,
      membershipId,
    );
    await Promise.all(
      entries.map(async (entry) => {
        const [contextId, sessionId] = entry.split(":", 2);
        if (contextId && sessionId) {
          await this.revokeSession(
            contextId === "platform" ? null : contextId,
            sessionId,
          );
        }
      }),
    );
  }

  async deleteSessionRecord(
    workspaceId: string | null,
    sessionId: string,
    expectedUserId: string,
    currentSessionId: string,
  ) {
    const record = await this.sessionStore.getSessionRecord(workspaceId, sessionId);
    if (!record || record.userId !== expectedUserId) return;
    if (record.sessionId === currentSessionId && !record.revokedAt) {
      throw new BadRequestException("不能删除当前活跃设备");
    }
    if (!record.revokedAt && !isSessionExpired(record)) {
      throw new BadRequestException("请先登出设备后再删除记录");
    }

    await this.sessionStore.deleteSessionRecord(record);
  }

  private get sessionHistoryTtlSeconds() {
    return this.configService.getOrThrow<number>(
      "auth.refreshTokenTtlSeconds",
    ) * 2;
  }
}

function dateToSortableTime(value: string) {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}
