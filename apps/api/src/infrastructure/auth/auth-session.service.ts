import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import {
  IntegrationToken,
  PlatformUser,
  User,
} from "@hermes-swarm/core";
import {
  DataSource,
  IsNull,
  MoreThan,
  Repository,
  type EntityManager,
} from "typeorm";
import { TenantContextService } from "../../common/database/tenant-context.service.js";
import { PLATFORM_DATA_SOURCE } from "../../common/database/database.constants.js";
import { RedisService } from "../../common/redis/redis.service.js";
import {
  INTEGRATION_SESSION_PREFIX,
  createAuthSessionToken,
  parseAuthSessionToken,
} from "./auth-session.js";
import { parseAuthDevice } from "./auth-device.js";

export type AuthRequestContext = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type AuthSessionRecord = {
  browser: string;
  credentialVersion: number;
  createdAt: string;
  deviceLabel: string;
  expiresAt: string;
  ipAddress: string | null;
  lastSeenAt: string;
  os: string;
  principalType: "platform" | "tenant";
  refreshTokenHash: string;
  revokedAt: string | null;
  sessionId: string;
  tenantId: string | null;
  userAgent: string | null;
  userId: string;
};

export type ValidatedAuthSession = {
  integrationToken?: {
    id: string;
    permissions: string[];
    scope: IntegrationToken["scope"];
    tenantId: string;
  } | null;
  jti: string;
  principalType: "integration" | "platform" | "tenant";
  record: AuthSessionRecord;
  sessionId: string;
  tenantId: string | null;
  tokenKind: "integration" | "session";
  userId: string;
};

export type IssuedAuthSession = {
  accessToken: string;
  expiresAt: string;
  principalType: "platform" | "tenant";
  refreshToken: string;
  sessionId: string;
  tenantId: string | null;
};

export type RealtimeTicketSession = {
  sessionId: string;
  tenantId: string;
  userId: string;
};

@Injectable()
export class AuthSessionService {
  constructor(
    @InjectRepository(IntegrationToken)
    private readonly integrationTokenRepository: Repository<IntegrationToken>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(PlatformUser, PLATFORM_DATA_SOURCE)
    private readonly platformUserRepository: Repository<PlatformUser>,
    private readonly dataSource: DataSource,
    private readonly tenantContext: TenantContextService,
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
  ) {}

  async createSession(
    userId: string,
    tenantId: string | null,
    principalType: "platform" | "tenant" = "tenant",
    context: AuthRequestContext = {},
  ) {
    assertPrincipalTenantContext(principalType, tenantId);
    const principal = await this.ensureActivePrincipal(
      userId,
      tenantId,
      principalType,
    );
    const credentialVersion = principal.credentialVersion ?? 0;
    const sessionId = randomUUID();
    const refreshToken = createRefreshToken();
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + this.refreshTokenTtlSeconds * 1000,
    );
    const device = parseAuthDevice(context.userAgent);
    const record: AuthSessionRecord = {
      browser: device.browser,
      credentialVersion,
      createdAt: now.toISOString(),
      deviceLabel: device.deviceLabel,
      expiresAt: expiresAt.toISOString(),
      ipAddress: context.ipAddress ?? null,
      lastSeenAt: now.toISOString(),
      os: device.os,
      principalType,
      refreshTokenHash: hashToken(refreshToken),
      revokedAt: null,
      sessionId,
      tenantId,
      userAgent: context.userAgent ?? null,
      userId,
    };

    await this.saveSession(record);
    await this.indexRefreshToken(record.refreshTokenHash, tenantId, sessionId);
    await this.addUserSession(tenantId, userId, sessionId);

    return {
      ...this.issueAccessToken(
        userId,
        tenantId,
        principalType,
        sessionId,
        credentialVersion,
      ),
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
    const lockKey = this.refreshLockKey(refreshTokenHash);
    const lockOwner = randomUUID();
    const lockAcquired = await client.set(lockKey, lockOwner, {
      EX: REFRESH_LOCK_TTL_SECONDS,
      NX: true,
    });
    if (!lockAcquired) {
      const rotated = await this.waitForRefreshRotation(client, refreshTokenHash);
      if (rotated) return rotated;
      throw new UnauthorizedException("登录已失效，请重新登录");
    }

    try {
      const refreshIndex = parseRefreshIndex(
        await client.get(this.refreshIndexKey(refreshTokenHash)),
      );
      if (!refreshIndex) {
        const rotated = await this.getRefreshRotationResult(client, refreshTokenHash);
        if (rotated) return rotated;
        throw new UnauthorizedException("登录已失效，请重新登录");
      }

      const { sessionId, tenantId } = refreshIndex;
      const record = await this.getSessionRecord(tenantId, sessionId);
      if (
        !record ||
        record.revokedAt ||
        record.refreshTokenHash !== refreshTokenHash ||
        isSessionExpired(record)
      ) {
        await client.del(this.refreshIndexKey(refreshTokenHash));
        const rotated = await this.getRefreshRotationResult(client, refreshTokenHash);
        if (rotated) return rotated;
        throw new UnauthorizedException("登录已失效，请重新登录");
      }
      const principal = await this.ensureActivePrincipal(
        record.userId,
        record.tenantId,
        record.principalType,
      );
      this.assertCredentialVersion(record, principal.credentialVersion ?? 0);

      const nextRefreshToken = createRefreshToken();
      const nextHash = hashToken(nextRefreshToken);
      const now = new Date();
      const nowIso = now.toISOString();
      const expiresAt = new Date(
        now.getTime() + this.refreshTokenTtlSeconds * 1000,
      );
      const device = parseAuthDevice(context.userAgent ?? record.userAgent);
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
      const issued = {
        ...this.issueAccessToken(
          record.userId,
          record.tenantId,
          record.principalType,
          sessionId,
          record.credentialVersion,
        ),
        refreshToken: nextRefreshToken,
        sessionId,
        tenantId: record.tenantId,
        userId: record.userId,
      };

      await Promise.all([
        this.saveSession(nextRecord),
        this.indexRefreshToken(nextHash, record.tenantId, sessionId),
        this.addUserSession(record.tenantId, record.userId, sessionId),
      ]);
      await this.saveRefreshRotationResult(client, refreshTokenHash, issued);
      await client.del(this.refreshIndexKey(refreshTokenHash));

      return issued;
    } finally {
      await this.releaseRefreshLock(client, lockKey, lockOwner);
    }
  }

  async validateAccessToken(token: string | undefined) {
    const accessToken = token ?? "";
    const payload = parseAuthSessionToken(token, {
      keyId: this.sessionKeyId,
      previousKeys: this.previousSessionKeys,
      secret: this.sessionSecret,
    });
    if (!payload) {
      throw new UnauthorizedException("登录已失效，请重新登录");
    }

    if (payload.sessionId.startsWith(INTEGRATION_SESSION_PREFIX)) {
      return this.validateIntegrationToken(accessToken, payload);
    }

    const record = await this.getSessionRecord(payload.tenantId, payload.sessionId);
    if (
      !record ||
      record.userId !== payload.userId ||
      record.tenantId !== payload.tenantId ||
      record.principalType !== payload.principalType ||
      record.credentialVersion !== payload.credentialVersion ||
      record.revokedAt ||
      isSessionExpired(record)
    ) {
      throw new UnauthorizedException("登录已失效，请重新登录");
    }
    const principal = await this.ensureActivePrincipal(
      payload.userId,
      payload.tenantId,
      payload.principalType,
    );
    this.assertCredentialVersion(record, principal.credentialVersion ?? 0);

    const touchedRecord = await this.touchSession(
      payload.sessionId,
      payload.tenantId,
      payload.userId,
    );

    return {
      jti: payload.jti,
      principalType: payload.principalType,
      record: touchedRecord,
      sessionId: payload.sessionId,
      tenantId: payload.tenantId,
      tokenKind: "session",
      userId: payload.userId,
    } satisfies ValidatedAuthSession;
  }

  async createRealtimeTicket(session: RealtimeTicketSession) {
    const ticket = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 30_000).toISOString();
    const client = await this.redisService.getClient();
    const ticketHash = hashToken(ticket);
    await Promise.all([
      client.set(
        this.realtimeTicketKey(session.tenantId, ticketHash),
        JSON.stringify(session satisfies RealtimeTicketSession),
        { EX: 30 },
      ),
      client.set(this.realtimeTicketIndexKey(ticketHash), session.tenantId, {
        EX: 30,
      }),
    ]);
    return { expiresAt, ticket };
  }

  async consumeRealtimeTicket(ticket: string | undefined) {
    if (!ticket) {
      throw new UnauthorizedException("登录已失效，请重新登录");
    }

    const client = await this.redisService.getClient();
    const indexKey = this.realtimeTicketIndexKey(hashToken(ticket));
    const tenantId = await this.getAndDelete(client, indexKey);
    if (!tenantId) {
      throw new UnauthorizedException("登录已失效，请重新登录");
    }
    const key = this.realtimeTicketKey(tenantId, hashToken(ticket));
    const rawValue = await this.getAndDelete(client, key);
    if (!rawValue) {
      throw new UnauthorizedException("登录已失效，请重新登录");
    }

    let ticketSession: RealtimeTicketSession;
    try {
      ticketSession = JSON.parse(rawValue) as RealtimeTicketSession;
    } catch {
      throw new UnauthorizedException("登录已失效，请重新登录");
    }

    const record = await this.getSessionRecord(
      ticketSession.tenantId,
      ticketSession.sessionId,
    );
    if (
      !record ||
      record.userId !== ticketSession.userId ||
      record.tenantId !== ticketSession.tenantId ||
      record.revokedAt ||
      isSessionExpired(record)
    ) {
      throw new UnauthorizedException("登录已失效，请重新登录");
    }
    await this.ensureActiveUser(ticketSession.userId, ticketSession.tenantId);

    await this.touchSession(
      ticketSession.sessionId,
      ticketSession.tenantId,
      ticketSession.userId,
    );
    return ticketSession;
  }

  async listSessions(
    tenantId: string | null,
    userId: string,
    currentSessionId: string,
  ) {
    const client = await this.redisService.getClient();
    const sessionIds = await client.sMembers(this.userSessionsKey(tenantId, userId));
    const records = await Promise.all(
      sessionIds.map((sessionId) => this.getSessionRecord(tenantId, sessionId)),
    );
    const missingSessionIds = sessionIds.filter((_, index) => !records[index]);
    if (missingSessionIds.length > 0) {
      await client.sRem(this.userSessionsKey(tenantId, userId), missingSessionIds);
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
    tenantId: string | null,
    sessionId: string,
    expectedUserId?: string,
  ) {
    const record = await this.getSessionRecord(tenantId, sessionId);
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

  async revokeOtherSessions(
    tenantId: string | null,
    userId: string,
    currentSessionId: string,
  ) {
    const sessionIds = await (
      await this.redisService.getClient()
    ).sMembers(this.userSessionsKey(tenantId, userId));
    await Promise.all(
      sessionIds
        .filter((sessionId) => sessionId !== currentSessionId)
        .map((sessionId) => this.revokeSession(tenantId, sessionId, userId)),
    );
  }

  async revokeUserSessions(
    tenantId: string,
    userId: string,
  ) {
    const sessionIds = await (
      await this.redisService.getClient()
    ).sMembers(this.userSessionsKey(tenantId, userId));
    await Promise.all(
      sessionIds.map((sessionId) =>
        this.revokeSession(tenantId, sessionId, userId),
      ),
    );
  }

  async deleteSessionRecord(
    tenantId: string | null,
    sessionId: string,
    expectedUserId: string,
    currentSessionId: string,
  ) {
    const record = await this.getSessionRecord(tenantId, sessionId);
    if (!record || record.userId !== expectedUserId) return;
    if (record.sessionId === currentSessionId && !record.revokedAt) {
      throw new BadRequestException("不能删除当前活跃设备");
    }
    if (!record.revokedAt && !isSessionExpired(record)) {
      throw new BadRequestException("请先登出设备后再删除记录");
    }

    const client = await this.redisService.getClient();
    await Promise.all([
      client.del(this.sessionKey(record.tenantId, record.sessionId)),
      client.del(this.refreshIndexKey(record.refreshTokenHash)),
      client.sRem(
        this.userSessionsKey(record.tenantId, record.userId),
        record.sessionId,
      ),
    ]);
  }

  getRefreshCookieName() {
    return this.configService.getOrThrow<string>("auth.refreshCookieName");
  }

  getRefreshCookieOptions() {
    return {
      httpOnly: true,
      maxAge: this.refreshTokenTtlSeconds * 1000,
      path: "/api/admin",
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

  private issueAccessToken(
    userId: string,
    tenantId: string | null,
    principalType: "platform" | "tenant",
    sessionId: string,
    credentialVersion: number,
  ) {
    const ttlSeconds = this.accessTokenTtlSeconds;
    const expiresAt = new Date(
      (Math.floor(Date.now() / 1000) + ttlSeconds) * 1000,
    ).toISOString();
    const accessToken = createAuthSessionToken(
      {
        credentialVersion,
        jti: randomUUID(),
        principalType,
        sessionId,
        tenantId,
        userId,
      },
      {
        keyId: this.sessionKeyId,
        secret: this.sessionSecret,
        ttlSeconds,
      },
    );
    return { accessToken, expiresAt, principalType, tenantId };
  }

  private async validateIntegrationToken(
    token: string,
    payload: NonNullable<ReturnType<typeof parseAuthSessionToken>>,
  ) {
    if (!payload.tenantId || payload.principalType !== "integration") {
      throw new UnauthorizedException("登录已失效，请重新登录");
    }
    const tokenId = payload.sessionId.slice(INTEGRATION_SESSION_PREFIX.length);
    if (!tokenId) throw new UnauthorizedException("登录已失效，请重新登录");
    const { record, tenantId } = await this.runInTenantContext(
      payload.tenantId,
      async (manager) => {
        const repository = manager.getRepository(IntegrationToken);
        const record = await repository.findOne({
          where: {
            id: tokenId,
            ownerUserId: payload.userId,
            tenantId: payload.tenantId!,
            tokenHash: hashToken(token),
          },
        });
        if (
          !record ||
          record.revokedAt ||
          record.expiresAt.getTime() <= Date.now()
        ) {
          throw new UnauthorizedException("登录已失效，请重新登录");
        }
        const tenantId = requireUserTenantId(
          await this.ensureActiveUserWithManager(
            manager,
            record.ownerUserId,
            payload.tenantId!,
          ),
        );
        if (tenantId !== payload.tenantId) {
          throw new UnauthorizedException("登录已失效，请重新登录");
        }
        const lastUsedAt = new Date();
        const updateResult = await repository.update(
          {
            expiresAt: MoreThan(lastUsedAt),
            id: record.id,
            ownerUserId: record.ownerUserId,
            revokedAt: IsNull(),
            tenantId,
            tokenHash: hashToken(token),
          },
          { lastUsedAt },
        );
        if ((updateResult.affected ?? 0) < 1) {
          throw new UnauthorizedException("登录已失效，请重新登录");
        }
        record.lastUsedAt = lastUsedAt;
        return { record, tenantId };
      },
    );

    return {
      integrationToken: {
        id: record.id,
        permissions: record.permissions ?? [],
        scope: record.scope,
        tenantId,
      },
      jti: payload.jti,
      record: {
        browser: "Integration Token",
        credentialVersion: payload.credentialVersion,
        createdAt: record.createdAt.toISOString(),
        deviceLabel: record.note || "Integration Token",
        expiresAt: record.expiresAt.toISOString(),
        ipAddress: null,
        lastSeenAt: (record.lastUsedAt ?? record.updatedAt).toISOString(),
        os: "API",
        principalType: "tenant",
        refreshTokenHash: "",
        revokedAt: null,
        sessionId: payload.sessionId,
        tenantId,
        userAgent: null,
        userId: record.ownerUserId,
      },
      sessionId: payload.sessionId,
      principalType: "integration",
      tenantId,
      tokenKind: "integration",
      userId: record.ownerUserId,
    } satisfies ValidatedAuthSession;
  }

  private async getSessionRecord(tenantId: string | null, sessionId: string) {
    const rawValue = await (
      await this.redisService.getClient()
    ).get(this.sessionKey(tenantId, sessionId));
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
    ).set(this.sessionKey(record.tenantId, record.sessionId), JSON.stringify(record), {
      EX: this.sessionHistoryTtlSeconds,
    });
  }

  private async indexRefreshToken(
    refreshTokenHash: string,
    tenantId: string | null,
    sessionId: string,
  ) {
    await (
      await this.redisService.getClient()
    ).set(
      this.refreshIndexKey(refreshTokenHash),
      JSON.stringify({ sessionId, tenantId }),
      {
      EX: this.refreshTokenTtlSeconds,
      },
    );
  }

  private async addUserSession(
    tenantId: string | null,
    userId: string,
    sessionId: string,
  ) {
    const client = await this.redisService.getClient();
    const key = this.userSessionsKey(tenantId, userId);
    await client.sAdd(key, sessionId);
    await client.expire(key, this.sessionHistoryTtlSeconds);
  }

  private async touchSession(
    sessionId: string,
    tenantId: string | null,
    userId: string,
  ) {
    const latestRecord = await this.getSessionRecord(tenantId, sessionId);
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
    await this.saveSession(touchedRecord);
    return touchedRecord;
  }

  private async ensureActiveUser(userId: string, tenantId: string) {
    return this.runInTenantContext(tenantId, (manager) =>
      this.ensureActiveUserWithManager(manager, userId, tenantId),
    );
  }

  private async ensureActiveUserWithManager(
    manager: EntityManager,
    userId: string,
    tenantId: string,
  ) {
    const user = await manager.getRepository(User).findOne({
        relations: { tenant: true },
        where: { id: userId, tenantId },
      });
    if (!user || user.status !== "active") {
      throw new UnauthorizedException("用户不可用");
    }
    if (requireUserTenantId(user) !== tenantId) {
      throw new UnauthorizedException("用户不可用");
    }
    const tenant = (user as User & { tenant?: { status?: string } }).tenant;
    if (
      !tenant ||
      (tenant.status !== "active" && tenant.status !== "provisioning")
    ) {
      throw new UnauthorizedException("租户不可用");
    }
    return user;
  }

  private runInTenantContext<T>(
    tenantId: string,
    work: (manager: EntityManager) => Promise<T>,
  ) {
    return this.dataSource.transaction(async (manager) => {
      await manager.query(
        "SELECT set_config('app.tenant_id', $1, true), set_config('app.scope_level', 'tenant', true)",
        [tenantId],
      );
      return this.tenantContext.run(
        {
          manager,
          organizationId: null,
          scopeLevel: "tenant",
          tenantId,
        },
        () => work(manager),
      );
    });
  }

  private async ensureActivePlatformUser(platformUserId: string) {
    const user = await this.platformUserRepository.findOne({
      where: { id: platformUserId },
    });
    if (!user || user.status !== "active") {
      throw new UnauthorizedException("平台账号不可用");
    }
    return user;
  }

  private ensureActivePrincipal(
    userId: string,
    tenantId: string | null,
    principalType: "integration" | "platform" | "tenant",
  ) {
    if (principalType === "platform") {
      if (tenantId !== null) throw new UnauthorizedException("平台会话无效");
      return this.ensureActivePlatformUser(userId);
    }
    if (!tenantId) throw new UnauthorizedException("登录会话缺少租户上下文");
    return this.ensureActiveUser(userId, tenantId);
  }

  private assertCredentialVersion(
    record: Pick<AuthSessionRecord, "credentialVersion" | "tenantId" | "userId">,
    currentVersion: number,
  ) {
    if (record.credentialVersion === currentVersion) return;
    void this.revokeAllPrincipalSessions(record.tenantId, record.userId).catch(
      () => undefined,
    );
    throw new UnauthorizedException({
      code: "AUTH_CREDENTIALS_CHANGED",
      message: "登录凭据已变更，请重新登录",
      statusCode: 401,
    });
  }

  private revokeAllPrincipalSessions(tenantId: string | null, userId: string) {
    return tenantId
      ? this.revokeUserSessions(tenantId, userId)
      : this.revokePlatformUserSessions(userId);
  }

  private async revokePlatformUserSessions(userId: string) {
    const sessionIds = await (
      await this.redisService.getClient()
    ).sMembers(this.userSessionsKey(null, userId));
    await Promise.all(
      sessionIds.map((sessionId) => this.revokeSession(null, sessionId, userId)),
    );
  }

  private async waitForRefreshRotation(
    client: Awaited<ReturnType<RedisService["getClient"]>>,
    refreshTokenHash: string,
  ) {
    const deadline = Date.now() + REFRESH_ROTATION_WAIT_MS;
    do {
      const rotated = await this.getRefreshRotationResult(client, refreshTokenHash);
      if (rotated) return rotated;
      await delay(REFRESH_ROTATION_POLL_MS);
    } while (Date.now() < deadline);

    return this.getRefreshRotationResult(client, refreshTokenHash);
  }

  private async getRefreshRotationResult(
    client: Awaited<ReturnType<RedisService["getClient"]>>,
    refreshTokenHash: string,
  ) {
    const value = await client.get(this.refreshRotationKey(refreshTokenHash));
    return value ? decryptRefreshRotation(value, this.sessionSecret) : null;
  }

  private async saveRefreshRotationResult(
    client: Awaited<ReturnType<RedisService["getClient"]>>,
    refreshTokenHash: string,
    issued: RefreshRotationResult,
  ) {
    await client.set(
      this.refreshRotationKey(refreshTokenHash),
      encryptRefreshRotation(issued, this.sessionSecret),
      { EX: REFRESH_ROTATION_RESULT_TTL_SECONDS },
    );
  }

  private async releaseRefreshLock(
    client: Awaited<ReturnType<RedisService["getClient"]>>,
    lockKey: string,
    lockOwner: string,
  ) {
    await client.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0",
      {
        arguments: [lockOwner],
        keys: [lockKey],
      },
    );
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

  private sessionKey(tenantId: string | null, sessionId: string) {
    return `auth:${tenantNamespace(tenantId)}:session:${sessionId}`;
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

  private userSessionsKey(tenantId: string | null, userId: string) {
    return `auth:${tenantNamespace(tenantId)}:user_sessions:${userId}`;
  }

  private realtimeTicketKey(tenantId: string, ticketHash: string) {
    return `auth:${tenantId}:realtime_ticket:${ticketHash}`;
  }

  private realtimeTicketIndexKey(ticketHash: string) {
    return `auth:realtime_ticket_index:${ticketHash}`;
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

  private get sessionKeyId() {
    return this.configService.get<string>("auth.sessionKeyId") ?? "current";
  }

  private get previousSessionKeys() {
    return this.configService.get<Record<string, string>>(
      "auth.previousSessionKeys",
    ) ?? {};
  }
}

function requireUserTenantId(user: User) {
  const tenantId = (user as User & { tenantId?: string | null }).tenantId;
  if (!tenantId) throw new UnauthorizedException("用户不可用");
  return tenantId;
}

function tenantNamespace(tenantId: string | null) {
  return tenantId ?? "platform";
}

function assertPrincipalTenantContext(
  principalType: "platform" | "tenant",
  tenantId: string | null,
) {
  if (
    (principalType === "platform" && tenantId !== null) ||
    (principalType === "tenant" && !tenantId)
  ) {
    throw new UnauthorizedException("登录会话租户上下文无效");
  }
}

function parseRefreshIndex(value: string | null) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as {
      sessionId?: unknown;
      tenantId?: unknown;
    };
    return typeof parsed.sessionId === "string" &&
      (typeof parsed.tenantId === "string" || parsed.tenantId === null)
      ? { sessionId: parsed.sessionId, tenantId: parsed.tenantId }
      : null;
  } catch {
    return null;
  }
}

const REFRESH_LOCK_TTL_SECONDS = 10;
const REFRESH_ROTATION_RESULT_TTL_SECONDS = 10;
const REFRESH_ROTATION_WAIT_MS = 2_000;
const REFRESH_ROTATION_POLL_MS = 50;

type RefreshRotationResult = IssuedAuthSession & {
  tenantId: string | null;
  userId: string;
};

function encryptRefreshRotation(value: RefreshRotationResult, secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", createEncryptionKey(secret), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return JSON.stringify({
    ciphertext: ciphertext.toString("base64url"),
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
  });
}

function decryptRefreshRotation(value: string, secret: string): RefreshRotationResult | null {
  try {
    const payload = JSON.parse(value) as Partial<{
      ciphertext: string;
      iv: string;
      tag: string;
    }>;
    if (!payload.ciphertext || !payload.iv || !payload.tag) return null;
    const decipher = createDecipheriv(
      "aes-256-gcm",
      createEncryptionKey(secret),
      Buffer.from(payload.iv, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(payload.tag, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(payload.ciphertext, "base64url")),
      decipher.final(),
    ]);
    const issued = JSON.parse(plaintext.toString("utf8")) as Partial<RefreshRotationResult>;
    if (
      typeof issued.accessToken !== "string" ||
      typeof issued.expiresAt !== "string" ||
      (issued.principalType !== "platform" && issued.principalType !== "tenant") ||
      typeof issued.refreshToken !== "string" ||
      typeof issued.sessionId !== "string" ||
      (issued.principalType === "platform"
        ? issued.tenantId !== null
        : typeof issued.tenantId !== "string") ||
      typeof issued.userId !== "string"
    ) {
      return null;
    }
    return issued as RefreshRotationResult;
  } catch {
    return null;
  }
}

function createEncryptionKey(secret: string) {
  return createHash("sha256").update(secret).digest();
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function isSessionExpired(record: Pick<AuthSessionRecord, "expiresAt">) {
  const expiresAt = new Date(record.expiresAt).getTime();
  return !Number.isFinite(expiresAt) || expiresAt <= Date.now();
}

function dateToSortableTime(value: string) {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function createRefreshToken() {
  return randomBytes(48).toString("base64url");
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
