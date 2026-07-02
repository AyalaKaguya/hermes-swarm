import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { RedisService } from "../common/redis/redis.service.js";
import {
  createAuthSessionToken,
  parseAuthSessionToken,
} from "./auth-session.js";

export type AuthRequestContext = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type AuthSessionRecord = {
  browser: string;
  createdAt: string;
  deviceLabel: string;
  expiresAt: string;
  ipAddress: string | null;
  lastSeenAt: string;
  os: string;
  refreshTokenHash: string;
  revokedAt: string | null;
  sessionId: string;
  userAgent: string | null;
  userId: string;
};

export type ValidatedAuthSession = {
  jti: string;
  record: AuthSessionRecord;
  sessionId: string;
  userId: string;
};

export type IssuedAuthSession = {
  accessToken: string;
  expiresAt: string;
  refreshToken: string;
  sessionId: string;
};

@Injectable()
export class AuthSessionService {
  constructor(
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
  ) {}

  async createSession(userId: string, context: AuthRequestContext = {}) {
    const sessionId = randomUUID();
    const refreshToken = createRefreshToken();
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + this.refreshTokenTtlSeconds * 1000,
    );
    const device = parseDevice(context.userAgent);
    const record: AuthSessionRecord = {
      browser: device.browser,
      createdAt: now.toISOString(),
      deviceLabel: device.deviceLabel,
      expiresAt: expiresAt.toISOString(),
      ipAddress: context.ipAddress ?? null,
      lastSeenAt: now.toISOString(),
      os: device.os,
      refreshTokenHash: hashToken(refreshToken),
      revokedAt: null,
      sessionId,
      userAgent: context.userAgent ?? null,
      userId,
    };

    await this.saveSession(record);
    await this.indexRefreshToken(record.refreshTokenHash, sessionId);
    await this.addUserSession(userId, sessionId);

    return {
      ...this.issueAccessToken(userId, sessionId),
      refreshToken,
      sessionId,
    };
  }

  async refreshSession(
    refreshToken: string | undefined,
    context: AuthRequestContext = {},
  ) {
    if (!refreshToken) {
      throw new UnauthorizedException("登录已失效，请重新登录");
    }

    const refreshTokenHash = hashToken(refreshToken);
    const client = await this.redisService.getClient();
    const sessionId = await client.get(this.refreshIndexKey(refreshTokenHash));
    if (!sessionId) {
      throw new UnauthorizedException("登录已失效，请重新登录");
    }

    const record = await this.getSessionRecord(sessionId);
    if (
      !record ||
      record.revokedAt ||
      record.refreshTokenHash !== refreshTokenHash ||
      new Date(record.expiresAt).getTime() <= Date.now()
    ) {
      await client.del(this.refreshIndexKey(refreshTokenHash));
      throw new UnauthorizedException("登录已失效，请重新登录");
    }

    const nextRefreshToken = createRefreshToken();
    const nextHash = hashToken(nextRefreshToken);
    const now = new Date();
    const nowIso = now.toISOString();
    const expiresAt = new Date(
      now.getTime() + this.refreshTokenTtlSeconds * 1000,
    );
    const device = parseDevice(context.userAgent ?? record.userAgent);
    const nextRecord: AuthSessionRecord = {
      ...record,
      browser: device.browser,
      deviceLabel: device.deviceLabel,
      expiresAt: expiresAt.toISOString(),
      ipAddress: context.ipAddress ?? record.ipAddress,
      lastSeenAt: nowIso,
      os: device.os,
      refreshTokenHash: nextHash,
      userAgent: context.userAgent ?? record.userAgent,
    };

    await Promise.all([
      client.del(this.refreshIndexKey(refreshTokenHash)),
      this.saveSession(nextRecord),
      this.indexRefreshToken(nextHash, sessionId),
      this.addUserSession(record.userId, sessionId),
    ]);

    return {
      ...this.issueAccessToken(record.userId, sessionId),
      refreshToken: nextRefreshToken,
      sessionId,
    };
  }

  async validateAccessToken(token: string | undefined) {
    const payload = parseAuthSessionToken(token, {
      secret: this.sessionSecret,
    });
    if (!payload) {
      throw new UnauthorizedException("登录已失效，请重新登录");
    }

    const record = await this.getSessionRecord(payload.sessionId);
    if (
      !record ||
      record.userId !== payload.userId ||
      record.revokedAt ||
      isSessionExpired(record)
    ) {
      throw new UnauthorizedException("登录已失效，请重新登录");
    }

    record.lastSeenAt = new Date().toISOString();
    await this.saveSession(record);

    return {
      jti: payload.jti,
      record,
      sessionId: payload.sessionId,
      userId: payload.userId,
    } satisfies ValidatedAuthSession;
  }

  async listSessions(userId: string, currentSessionId: string) {
    const client = await this.redisService.getClient();
    const sessionIds = await client.sMembers(this.userSessionsKey(userId));
    const records = await Promise.all(
      sessionIds.map((sessionId) => this.getSessionRecord(sessionId)),
    );
    const missingSessionIds = sessionIds.filter((_, index) => !records[index]);
    if (missingSessionIds.length > 0) {
      await client.sRem(this.userSessionsKey(userId), missingSessionIds);
    }

    return records
      .filter((record): record is AuthSessionRecord => Boolean(record))
      .sort(
        (left, right) =>
          new Date(right.lastSeenAt).getTime() -
          new Date(left.lastSeenAt).getTime(),
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

  async revokeSession(sessionId: string, expectedUserId?: string) {
    const record = await this.getSessionRecord(sessionId);
    if (!record || (expectedUserId && record.userId !== expectedUserId)) {
      return;
    }

    const revokedRecord = {
      ...record,
      revokedAt: record.revokedAt ?? new Date().toISOString(),
    };
    const client = await this.redisService.getClient();
    await Promise.all([
      client.del(this.refreshIndexKey(record.refreshTokenHash)),
      this.saveSession(revokedRecord),
    ]);
  }

  async revokeOtherSessions(userId: string, currentSessionId: string) {
    const sessionIds = await (
      await this.redisService.getClient()
    ).sMembers(this.userSessionsKey(userId));
    await Promise.all(
      sessionIds
        .filter((sessionId) => sessionId !== currentSessionId)
        .map((sessionId) => this.revokeSession(sessionId, userId)),
    );
  }

  async deleteSessionRecord(
    sessionId: string,
    expectedUserId: string,
    currentSessionId: string,
  ) {
    const record = await this.getSessionRecord(sessionId);
    if (!record || record.userId !== expectedUserId) return;
    if (record.sessionId === currentSessionId && !record.revokedAt) {
      throw new BadRequestException("不能删除当前活跃设备");
    }
    if (!record.revokedAt && !isSessionExpired(record)) {
      throw new BadRequestException("请先登出设备后再删除记录");
    }

    const client = await this.redisService.getClient();
    await Promise.all([
      client.del(this.sessionKey(record.sessionId)),
      client.del(this.refreshIndexKey(record.refreshTokenHash)),
      client.sRem(this.userSessionsKey(record.userId), record.sessionId),
    ]);
  }

  getRefreshCookieName() {
    return this.configService.getOrThrow<string>("auth.refreshCookieName");
  }

  getRefreshCookieOptions() {
    return {
      httpOnly: true,
      maxAge: this.refreshTokenTtlSeconds * 1000,
      path: "/api/admin/auth",
      sameSite: "lax" as const,
      secure: this.configService.getOrThrow<boolean>(
        "auth.refreshCookieSecure",
      ),
    };
  }

  getClearRefreshCookieOptions() {
    return {
      ...this.getRefreshCookieOptions(),
      maxAge: 0,
    };
  }

  private issueAccessToken(userId: string, sessionId: string) {
    const ttlSeconds = this.accessTokenTtlSeconds;
    const expiresAt = new Date(
      (Math.floor(Date.now() / 1000) + ttlSeconds) * 1000,
    ).toISOString();
    const accessToken = createAuthSessionToken(
      {
        jti: randomUUID(),
        sessionId,
        userId,
      },
      {
        secret: this.sessionSecret,
        ttlSeconds,
      },
    );
    return { accessToken, expiresAt };
  }

  private async getSessionRecord(sessionId: string) {
    const rawValue = await (
      await this.redisService.getClient()
    ).get(this.sessionKey(sessionId));
    if (!rawValue) return null;
    try {
      return JSON.parse(rawValue) as AuthSessionRecord;
    } catch {
      return null;
    }
  }

  private async saveSession(record: AuthSessionRecord) {
    await (
      await this.redisService.getClient()
    ).set(this.sessionKey(record.sessionId), JSON.stringify(record), {
      EX: this.sessionHistoryTtlSeconds,
    });
  }

  private async indexRefreshToken(refreshTokenHash: string, sessionId: string) {
    await (
      await this.redisService.getClient()
    ).set(this.refreshIndexKey(refreshTokenHash), sessionId, {
      EX: this.refreshTokenTtlSeconds,
    });
  }

  private async addUserSession(userId: string, sessionId: string) {
    const client = await this.redisService.getClient();
    const key = this.userSessionsKey(userId);
    await client.sAdd(key, sessionId);
    await client.expire(key, this.sessionHistoryTtlSeconds);
  }

  private sessionKey(sessionId: string) {
    return `auth:session:${sessionId}`;
  }

  private refreshIndexKey(refreshTokenHash: string) {
    return `auth:refresh:${refreshTokenHash}`;
  }

  private userSessionsKey(userId: string) {
    return `auth:user_sessions:${userId}`;
  }

  private get accessTokenTtlSeconds() {
    return this.configService.getOrThrow<number>(
      "auth.accessTokenTtlSeconds",
    );
  }

  private get refreshTokenTtlSeconds() {
    return this.configService.getOrThrow<number>(
      "auth.refreshTokenTtlSeconds",
    );
  }

  private get sessionHistoryTtlSeconds() {
    return this.refreshTokenTtlSeconds * 2;
  }

  private get sessionSecret() {
    return this.configService.getOrThrow<string>("auth.sessionSecret");
  }
}

function isSessionExpired(record: Pick<AuthSessionRecord, "expiresAt">) {
  return new Date(record.expiresAt).getTime() <= Date.now();
}

function createRefreshToken() {
  return randomBytes(48).toString("base64url");
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function parseDevice(userAgent: string | null | undefined) {
  const value = userAgent ?? "";
  const browser = /Edg\//.test(value)
    ? "Edge"
    : /Chrome\//.test(value)
      ? "Chrome"
      : /Firefox\//.test(value)
        ? "Firefox"
        : /Safari\//.test(value)
          ? "Safari"
          : "未知浏览器";
  const os = /Windows NT/.test(value)
    ? "Windows"
    : /Mac OS X/.test(value)
      ? "macOS"
      : /Android/.test(value)
        ? "Android"
        : /iPhone|iPad|iPod/.test(value)
          ? "iOS"
          : /Linux/.test(value)
            ? "Linux"
            : "未知系统";
  return {
    browser,
    deviceLabel: `${browser} / ${os}`,
    os,
  };
}
