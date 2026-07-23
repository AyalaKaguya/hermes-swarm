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
  Account,
  IntegrationToken,
  PlatformMembership,
  Workspace,
  WorkspaceMembership,
} from "@hermes-swarm/core";
import {
  DataSource,
  IsNull,
  MoreThan,
  Repository,
  type EntityManager,
} from "typeorm";
import { WorkspaceContextService } from "../../common/database/workspace-context.service.js";
import {
  INTEGRATION_SESSION_PREFIX,
  createAuthSessionToken,
  parseAuthSessionToken,
} from "./auth-session.js";
import { parseAuthDevice } from "./auth-device.js";
import { AuthSessionStoreService } from "./auth-session-store.service.js";
import type {
  AuthRequestContext,
  AuthSessionRecord,
  ContextSelectionRecord,
  IssuedAuthSession,
  RealtimeTicketSession,
  RefreshRotationResult,
  ValidatedAuthSession,
} from "./auth-session.types.js";

export type {
  AuthRequestContext,
  AuthSessionRecord,
  ContextSelectionRecord,
  IssuedAuthSession,
  RealtimeTicketSession,
  ValidatedAuthSession,
} from "./auth-session.types.js";

@Injectable()
export class AuthSessionService {
  constructor(
    @InjectRepository(IntegrationToken)
    private readonly integrationTokenRepository: Repository<IntegrationToken>,
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
    @InjectRepository(Account)
    private readonly platformAccountRepository: Repository<Account>,
    @InjectRepository(PlatformMembership)
    private readonly platformMembershipRepository: Repository<PlatformMembership>,
    private readonly dataSource: DataSource,
    private readonly workspaceContext: WorkspaceContextService,
    private readonly configService: ConfigService,
    private readonly sessionStore: AuthSessionStoreService,
  ) {}

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
      hashToken(selectionToken),
      record,
      CONTEXT_SELECTION_TTL_SECONDS,
    );
    return { expiresAt, selectionToken };
  }

  async consumeContextSelection(selectionToken: string) {
    const raw = await this.sessionStore.consumeContextSelection(
      hashToken(selectionToken),
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

  async createSession(
    userId: string,
    workspaceId: string | null,
    principalType: "platform" | "workspace" = "workspace",
    context: AuthRequestContext = {},
  ) {
    assertPrincipalWorkspaceContext(principalType, workspaceId);
    const principal = await this.ensureActivePrincipal(
      userId,
      workspaceId,
      principalType,
    );
    const credentialVersion = principal.credentialVersion ?? 0;
    const membershipId = principalType === "workspace" && workspaceId
      ? await this.resolveActiveMembershipId(userId, workspaceId)
      : await this.resolveActivePlatformMembershipId(userId);
    const sessionId = randomUUID();
    const refreshToken = createRefreshToken();
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + this.refreshTokenTtlSeconds * 1000,
    );
    const device = parseAuthDevice(context.userAgent);
    const record: AuthSessionRecord = {
      accountId: userId,
      browser: device.browser,
      credentialVersion,
      createdAt: now.toISOString(),
      deviceLabel: device.deviceLabel,
      expiresAt: expiresAt.toISOString(),
      ipAddress: context.ipAddress ?? null,
      lastSeenAt: now.toISOString(),
      membershipId,
      os: device.os,
      principalType,
      refreshTokenHash: hashToken(refreshToken),
      revokedAt: null,
      sessionId,
      workspaceId,
      userAgent: context.userAgent ?? null,
      userId,
    };

    await this.sessionStore.saveSession(record, this.sessionHistoryTtlSeconds);
    await this.sessionStore.indexRefreshToken(
      record.refreshTokenHash,
      workspaceId,
      sessionId,
      this.refreshTokenTtlSeconds,
    );
    await this.sessionStore.addUserSession(
      workspaceId,
      userId,
      sessionId,
      principalType,
      membershipId,
      this.sessionHistoryTtlSeconds,
    );

    return {
      ...this.issueAccessToken(
        userId,
        workspaceId,
        principalType,
        sessionId,
        credentialVersion,
        membershipId,
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
    const lockOwner = randomUUID();
    const lockAcquired = await this.sessionStore.acquireRefreshLock(
      refreshTokenHash,
      lockOwner,
      REFRESH_LOCK_TTL_SECONDS,
    );
    if (!lockAcquired) {
      const rotated = await this.waitForRefreshRotation(refreshTokenHash);
      if (rotated) return rotated;
      throw new UnauthorizedException("登录已失效，请重新登录");
    }

    try {
      const refreshIndex = await this.sessionStore.getRefreshIndex(refreshTokenHash);
      if (!refreshIndex) {
        const rotated = await this.getRefreshRotationResult(refreshTokenHash);
        if (rotated) return rotated;
        throw new UnauthorizedException("登录已失效，请重新登录");
      }

      const { sessionId, workspaceId } = refreshIndex;
      const record = await this.sessionStore.getSessionRecord(workspaceId, sessionId);
      if (
        !record ||
        record.revokedAt ||
        record.refreshTokenHash !== refreshTokenHash ||
        isSessionExpired(record)
      ) {
        await this.sessionStore.deleteRefreshIndex(refreshTokenHash);
        const rotated = await this.getRefreshRotationResult(refreshTokenHash);
        if (rotated) return rotated;
        throw new UnauthorizedException("登录已失效，请重新登录");
      }
      const principal = await this.ensureActivePrincipal(
        record.userId,
        record.workspaceId,
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
          record.workspaceId,
          record.principalType,
          sessionId,
          record.credentialVersion,
          record.membershipId,
        ),
        refreshToken: nextRefreshToken,
        sessionId,
        workspaceId: record.workspaceId,
        userId: record.userId,
      };

      await Promise.all([
        this.sessionStore.saveSession(nextRecord, this.sessionHistoryTtlSeconds),
        this.sessionStore.indexRefreshToken(
          nextHash,
          record.workspaceId,
          sessionId,
          this.refreshTokenTtlSeconds,
        ),
        this.sessionStore.addUserSession(
          record.workspaceId,
          record.userId,
          sessionId,
          record.principalType,
          record.membershipId,
          this.sessionHistoryTtlSeconds,
        ),
      ]);
      await this.saveRefreshRotationResult(refreshTokenHash, issued);
      await this.sessionStore.deleteRefreshIndex(refreshTokenHash);

      return issued;
    } finally {
      await this.sessionStore.releaseRefreshLock(refreshTokenHash, lockOwner);
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

    const record = await this.sessionStore.getSessionRecord(
      payload.workspaceId,
      payload.sessionId,
    );
    if (
      !record ||
      record.userId !== payload.userId ||
      record.workspaceId !== payload.workspaceId ||
      record.principalType !== payload.principalType ||
      record.credentialVersion !== payload.credentialVersion ||
      record.revokedAt ||
      isSessionExpired(record)
    ) {
      throw new UnauthorizedException("登录已失效，请重新登录");
    }
    const principal = await this.ensureActivePrincipal(
      payload.userId,
      payload.workspaceId,
      payload.principalType,
    );
    this.assertCredentialVersion(record, principal.credentialVersion ?? 0);

    const touchedRecord = await this.touchSession(
      payload.sessionId,
      payload.workspaceId,
      payload.userId,
    );

    return {
      accountId: record.accountId ?? record.userId,
      jti: payload.jti,
      membershipId: record.membershipId,
      principalType: payload.principalType,
      record: touchedRecord,
      sessionId: payload.sessionId,
      workspaceId: payload.workspaceId,
      tokenKind: "session",
      userId: payload.userId,
    } satisfies ValidatedAuthSession;
  }

  async createRealtimeTicket(session: RealtimeTicketSession) {
    const ticket = randomBytes(32).toString("base64url");
    const expiresAt = new Date(
      Date.now() + REALTIME_TICKET_TTL_SECONDS * 1000,
    ).toISOString();
    const ticketHash = hashToken(ticket);
    await this.sessionStore.createRealtimeTicket(
      ticketHash,
      session,
      REALTIME_TICKET_TTL_SECONDS,
    );
    return { expiresAt, ticket };
  }

  async consumeRealtimeTicket(ticket: string | undefined) {
    if (!ticket) {
      throw new UnauthorizedException("登录已失效，请重新登录");
    }

    const rawValue = await this.sessionStore.consumeRealtimeTicket(hashToken(ticket));
    if (!rawValue) {
      throw new UnauthorizedException("登录已失效，请重新登录");
    }

    let ticketSession: RealtimeTicketSession;
    try {
      ticketSession = JSON.parse(rawValue) as RealtimeTicketSession;
    } catch {
      throw new UnauthorizedException("登录已失效，请重新登录");
    }

    const record = await this.sessionStore.getSessionRecord(
      ticketSession.workspaceId,
      ticketSession.sessionId,
    );
    if (
      !record ||
      record.userId !== ticketSession.userId ||
      record.workspaceId !== ticketSession.workspaceId ||
      record.revokedAt ||
      isSessionExpired(record)
    ) {
      throw new UnauthorizedException("登录已失效，请重新登录");
    }
    await this.ensureActiveUser(ticketSession.userId, ticketSession.workspaceId);

    await this.touchSession(
      ticketSession.sessionId,
      ticketSession.workspaceId,
      ticketSession.userId,
    );
    return ticketSession;
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

  async revokeUserSessions(
    workspaceId: string,
    userId: string,
  ) {
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
    workspaceId: string | null,
    principalType: "platform" | "workspace",
    sessionId: string,
    credentialVersion: number,
    membershipId: string | null,
  ) {
    const ttlSeconds = this.accessTokenTtlSeconds;
    const expiresAt = new Date(
      (Math.floor(Date.now() / 1000) + ttlSeconds) * 1000,
    ).toISOString();
    const accessToken = createAuthSessionToken(
      {
        accountId: userId,
        credentialVersion,
        jti: randomUUID(),
        membershipId,
        principalType,
        sessionId,
        workspaceId,
        userId,
      },
      {
        keyId: this.sessionKeyId,
        secret: this.sessionSecret,
        ttlSeconds,
      },
    );
    return { accessToken, expiresAt, principalType, workspaceId };
  }

  private async validateIntegrationToken(
    token: string,
    payload: NonNullable<ReturnType<typeof parseAuthSessionToken>>,
  ) {
    if (!payload.workspaceId || payload.principalType !== "integration") {
      throw new UnauthorizedException("登录已失效，请重新登录");
    }
    const tokenId = payload.sessionId.slice(INTEGRATION_SESSION_PREFIX.length);
    if (!tokenId) throw new UnauthorizedException("登录已失效，请重新登录");
    const { membershipId, record, workspaceId } = await this.runInWorkspaceContext(
      payload.workspaceId,
      async (manager) => {
        const repository = manager.getRepository(IntegrationToken);
        const record = await repository.findOne({
          where: {
            id: tokenId,
            ownerUserId: payload.userId,
            workspaceId: payload.workspaceId!,
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
        await this.ensureActiveUserWithManager(
          manager,
          record.ownerUserId,
          payload.workspaceId!,
        );
        const workspaceId = payload.workspaceId!;
        const membership = await manager.getRepository(WorkspaceMembership).findOne({
          select: { id: true },
          where: { accountId: record.ownerUserId, status: "active", workspaceId },
        });
        if (!membership) throw new UnauthorizedException("登录已失效，请重新登录");
        const lastUsedAt = new Date();
        const updateResult = await repository.update(
          {
            expiresAt: MoreThan(lastUsedAt),
            id: record.id,
            ownerUserId: record.ownerUserId,
            revokedAt: IsNull(),
            workspaceId,
            tokenHash: hashToken(token),
          },
          { lastUsedAt },
        );
        if ((updateResult.affected ?? 0) < 1) {
          throw new UnauthorizedException("登录已失效，请重新登录");
        }
        record.lastUsedAt = lastUsedAt;
        return { membershipId: membership.id, record, workspaceId };
      },
    );

    return {
      accountId: record.ownerUserId,
      integrationToken: {
        id: record.id,
        permissions: record.permissions ?? [],
        scope: record.scope,
        workspaceId,
      },
      jti: payload.jti,
      membershipId,
      record: {
        accountId: record.ownerUserId,
        browser: "Integration Token",
        credentialVersion: payload.credentialVersion,
        createdAt: record.createdAt.toISOString(),
        deviceLabel: record.note || "Integration Token",
        expiresAt: record.expiresAt.toISOString(),
        ipAddress: null,
        lastSeenAt: (record.lastUsedAt ?? record.updatedAt).toISOString(),
        membershipId,
        os: "API",
        principalType: "workspace",
        refreshTokenHash: "",
        revokedAt: null,
        sessionId: payload.sessionId,
        workspaceId,
        userAgent: null,
        userId: record.ownerUserId,
      },
      sessionId: payload.sessionId,
      principalType: "integration",
      workspaceId,
      tokenKind: "integration",
      userId: record.ownerUserId,
    } satisfies ValidatedAuthSession;
  }

  private async touchSession(
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

  private async ensureActiveUser(userId: string, workspaceId: string) {
    return this.runInWorkspaceContext(workspaceId, (manager) =>
      this.ensureActiveUserWithManager(manager, userId, workspaceId),
    );
  }

  private async ensureActiveUserWithManager(
    manager: EntityManager,
    userId: string,
    workspaceId: string,
  ) {
    const membership = await manager.getRepository(WorkspaceMembership).findOne({
      relations: { account: true },
      where: { accountId: userId, status: "active", workspaceId },
    });
    const user = membership?.account;
    if (!user || user.status !== "active") {
      throw new UnauthorizedException("用户不可用");
    }
    const workspace = await manager.getRepository(Workspace).findOne({
      where: { id: workspaceId },
    });
    if (
      !workspace ||
      (workspace.status !== "active" && workspace.status !== "provisioning")
    ) {
      throw new UnauthorizedException("工作空间不可用");
    }
    return user;
  }

  private async resolveActiveMembershipId(accountId: string, workspaceId: string) {
    return this.runInWorkspaceContext(workspaceId, async (manager) => {
      const membership = await manager.getRepository(WorkspaceMembership).findOne({
        select: { id: true },
        where: { accountId, status: "active", workspaceId },
      });
      if (!membership) throw new UnauthorizedException("工作空间成员关系不可用");
      return membership.id;
    });
  }

  private async resolveActivePlatformMembershipId(accountId: string) {
    const membership = await this.platformMembershipRepository.findOne({
      select: { id: true },
      where: { accountId, status: "active" },
    });
    if (!membership) throw new UnauthorizedException("平台成员关系不可用");
    return membership.id;
  }

  private runInWorkspaceContext<T>(
    workspaceId: string,
    work: (manager: EntityManager) => Promise<T>,
  ) {
    return this.dataSource.transaction(async (manager) => {
      return this.workspaceContext.run(
        {
          scopeLevel: "workspace",
          workspaceId,
        },
        () => work(manager),
      );
    });
  }

  private async ensureActivePlatformAccount(accountId: string) {
    const membership = await this.platformMembershipRepository.findOne({
      relations: { account: true, role: true },
      where: { accountId, status: "active" },
    });
    const account = membership?.account ?? await this.platformAccountRepository.findOne({
      where: { id: accountId },
    });
    if (!membership?.roleId || membership.role?.scope !== "platform" || !account || account.status !== "active") {
      throw new UnauthorizedException("平台账号不可用");
    }
    return account;
  }

  private ensureActivePrincipal(
    userId: string,
    workspaceId: string | null,
    principalType: "integration" | "platform" | "workspace",
  ) {
    if (principalType === "platform") {
      if (workspaceId !== null) throw new UnauthorizedException("平台会话无效");
      return this.ensureActivePlatformAccount(userId);
    }
    if (!workspaceId) throw new UnauthorizedException("登录会话缺少工作空间上下文");
    return this.ensureActiveUser(userId, workspaceId);
  }

  private assertCredentialVersion(
    record: Pick<AuthSessionRecord, "accountId" | "credentialVersion" | "workspaceId" | "userId">,
    currentVersion: number,
  ) {
    if (record.credentialVersion === currentVersion) return;
    void this.revokeAccountSessions(record.accountId ?? record.userId).catch(
      () => undefined,
    );
    throw new UnauthorizedException({
      code: "AUTH_CREDENTIALS_CHANGED",
      message: "登录凭据已变更，请重新登录",
      statusCode: 401,
    });
  }

  private async waitForRefreshRotation(
    refreshTokenHash: string,
  ) {
    const deadline = Date.now() + REFRESH_ROTATION_WAIT_MS;
    do {
      const rotated = await this.getRefreshRotationResult(refreshTokenHash);
      if (rotated) return rotated;
      await delay(REFRESH_ROTATION_POLL_MS);
    } while (Date.now() < deadline);

    return this.getRefreshRotationResult(refreshTokenHash);
  }

  private async getRefreshRotationResult(refreshTokenHash: string) {
    const value = await this.sessionStore.getRefreshRotationResult(refreshTokenHash);
    return value ? decryptRefreshRotation(value, this.sessionSecret) : null;
  }

  private async saveRefreshRotationResult(
    refreshTokenHash: string,
    issued: RefreshRotationResult,
  ) {
    await this.sessionStore.saveRefreshRotationResult(
      refreshTokenHash,
      encryptRefreshRotation(issued, this.sessionSecret),
      REFRESH_ROTATION_RESULT_TTL_SECONDS,
    );
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

function assertPrincipalWorkspaceContext(
  principalType: "platform" | "workspace",
  workspaceId: string | null,
) {
  if (
    (principalType === "platform" && workspaceId !== null) ||
    (principalType === "workspace" && !workspaceId)
  ) {
    throw new UnauthorizedException("登录会话工作空间上下文无效");
  }
}

const CONTEXT_SELECTION_TTL_SECONDS = 5 * 60;
const REALTIME_TICKET_TTL_SECONDS = 30;
const REFRESH_LOCK_TTL_SECONDS = 10;
const REFRESH_ROTATION_RESULT_TTL_SECONDS = 10;
const REFRESH_ROTATION_WAIT_MS = 2_000;
const REFRESH_ROTATION_POLL_MS = 50;

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
      (issued.principalType !== "platform" && issued.principalType !== "workspace") ||
      typeof issued.refreshToken !== "string" ||
      typeof issued.sessionId !== "string" ||
      (issued.principalType === "platform"
        ? issued.workspaceId !== null
        : typeof issued.workspaceId !== "string") ||
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
