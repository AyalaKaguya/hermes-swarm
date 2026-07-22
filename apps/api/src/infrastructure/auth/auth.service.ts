import {
  Injectable,
  Optional,
  UnauthorizedException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import {
  Account,
  PlatformMembership,
  Role,
  RolePermission,
  Workspace,
  WorkspaceMembership,
} from "@hermes-swarm/core";
import { DataSource, Repository, type EntityManager } from "typeorm";
import { WorkspaceContextService } from "../../common/database/workspace-context.service.js";
import type { LoginPayload, SelectContextPayload } from "../../common/admin-api.types.js";
import { AuthSessionService } from "./auth-session.service.js";
import { verifyPassword } from "../../common/security/password-hash.js";
import { toRoleDto, toUserDto, toWorkspaceDto } from "../users/user-dto.js";
import { WorkspaceLoginResolverService } from "./workspace-login-resolver.service.js";
import { SettingsService } from "../settings/settings.service.js";
import { LoginAuditService } from "../audit/login-audit.service.js";
import { resolveClientIp } from "@hermes-swarm/rbac";

@Injectable()
/**
 * Owns admin authentication and principal resolution.
 */
export class AuthService {
  constructor(
    private readonly authSessionService: AuthSessionService,
    @InjectRepository(PlatformMembership)
    private readonly platformMembershipRepository: Repository<PlatformMembership>,
    private readonly dataSource: DataSource,
    private readonly workspaceContext: WorkspaceContextService,
    private readonly workspaceLoginResolver: WorkspaceLoginResolverService,
    private readonly settingsService: SettingsService,
    @Optional()
    private readonly loginAuditService?: LoginAuditService,
    @Optional()
    @InjectRepository(Account)
    private readonly accountRepository?: Repository<Account>,
    @Optional()
    @InjectRepository(WorkspaceMembership)
    private readonly membershipRepository?: Repository<WorkspaceMembership>,
  ) {}

  /**
   * Authenticates an admin user and returns the session token plus principal.
   */
  async login(payload: LoginPayload, request: any, response: any) {
    const requestContext = getRequestContext(request);
    const attemptedEmail = readAttemptedEmail(payload);
    let workspaceId: string | null = null;
    let recorded = false;
    try {
      const input = requireLoginPayload(payload);
      const email = normalizeEmail(input.email);
      const password = requireText(input.password, "密码");
      const requestedContextType = input.contextType ??
        (input.workspaceSlug ? "workspace" : undefined);
      const requestedWorkspace = requestedContextType === "platform"
        ? null
        : (await this.workspaceLoginResolver.resolve(
            request,
            input.workspaceSlug,
          ))?.workspace;
      workspaceId = requestedWorkspace?.id ?? null;
      const account = await this.accountRepository!.findOne({ where: { email } });
      if (
        !account ||
        account.status !== "active" ||
        !(await verifyPassword(password, account.passwordHash))
      ) {
        await this.recordLoginAttempt({
          attemptedEmail: email,
          failureCode: "invalid_credentials",
          ...requestContext,
          result: "failed",
          scopeType: "workspace",
          workspaceId,
        });
        recorded = true;
        throw new UnauthorizedException("用户名或密码不正确");
      }

      const contexts = await this.listAvailableContexts(account.id);
      const eligible = requestedContextType === "platform"
        ? contexts.filter((context) => context.type === "platform")
        : requestedWorkspace
          ? contexts.filter(
              (context) => context.type === "workspace" &&
                context.membership.workspaceId === requestedWorkspace.id,
            )
          : contexts;
      if (eligible.length === 0) {
        throw new UnauthorizedException("账号没有可用的访问上下文");
      }
      if (!requestedContextType && !requestedWorkspace && eligible.length > 1) {
        const selection = await this.authSessionService.createContextSelection(
          account.id,
          account.credentialVersion,
          eligible.map(contextSelectionKey),
        );
        recorded = true;
        return {
          ...selection,
          contexts: eligible.map(toContextOption),
          status: "context_selection_required" as const,
        };
      }

      const context = eligible[0];
      const result = context.type === "platform"
        ? await this.createPlatformLoginResponse(account, context.membership, request, response)
        : await this.createWorkspaceLoginResponse(account, context.membership, request, response);
      await this.recordLoginAttempt({
        actorId: account.id,
        attemptedEmail: email,
        ...requestContext,
        result: "success",
        scopeType: context.type,
        sessionId: result.sessionId,
        workspaceId: context.type === "workspace" ? context.membership.workspaceId : null,
      });
      recorded = true;
      return result;
    } catch (error) {
      if (!recorded) {
        await this.recordLoginAttempt({
          attemptedEmail,
          failureCode:
            error instanceof UnauthorizedException
                ? "invalid_credentials"
                : "internal_error",
          ...requestContext,
          result: "failed",
          scopeType: "workspace",
          workspaceId,
        });
      }
      throw error;
    }
  }

  async createWorkspaceLoginResponse(
    account: Account,
    membership: WorkspaceMembership,
    request: any,
    response: any,
  ) {
    const session = await this.authSessionService.createSession(
      account.id,
      membership.workspaceId,
      "workspace",
      getRequestContext(request),
    );
    setRefreshCookie(
      response,
      this.authSessionService.getRefreshCookieName(),
      session.refreshToken,
      this.authSessionService.getRefreshCookieOptions(),
    );
    return {
      accessToken: session.accessToken,
      expiresAt: session.expiresAt,
      sessionId: session.sessionId,
      status: "authenticated" as const,
      snapshot: await this.runInWorkspaceContext(
        membership.workspaceId,
        (manager) => this.getPrincipalSnapshot(account, membership, manager),
      ),
    };
  }

  async createPlatformLoginResponse(
    account: Account,
    membership: PlatformMembership,
    request: any,
    response: any,
  ) {
    const session = await this.authSessionService.createSession(
      account.id,
      null,
      "platform",
      getRequestContext(request),
    );
    setRefreshCookie(
      response,
      this.authSessionService.getRefreshCookieName(),
      session.refreshToken,
      this.authSessionService.getRefreshCookieOptions(),
    );
    return {
      accessToken: session.accessToken,
      expiresAt: session.expiresAt,
      sessionId: session.sessionId,
      status: "authenticated" as const,
      snapshot: await this.getPlatformPrincipalSnapshot(account, membership),
    };
  }

  async selectContext(
    payload: SelectContextPayload,
    request: any,
    response: any,
  ) {
    const selectionToken = requireText(payload?.selectionToken, "上下文选择凭证");
    const contextType = requireContextType(payload?.contextType);
    const membershipId = requireText(payload?.membershipId, "成员关系");
    const selection = await this.authSessionService.consumeContextSelection(
      selectionToken,
    );
    const account = await this.accountRepository!.findOne({
      where: { id: selection.accountId, status: "active" },
    });
    if (!account || account.credentialVersion !== selection.credentialVersion) {
      throw new UnauthorizedException("账号凭据已变更，请重新登录");
    }
    const contexts = await this.listAvailableContexts(account.id);
    const context = contexts.find(
      (item) => item.type === contextType && item.membership.id === membershipId,
    );
    if (!context || !selection.contextMembershipIds.includes(contextSelectionKey(context))) {
      throw new UnauthorizedException("访问上下文不可用");
    }
    return context.type === "platform"
      ? this.createPlatformLoginResponse(account, context.membership, request, response)
      : this.createWorkspaceLoginResponse(account, context.membership, request, response);
  }

  async listAccountContexts(authorization: string | undefined) {
    const session = await this.validateInteractiveAuthorization(authorization);
    return (await this.listAvailableContexts(session.accountId ?? session.userId))
      .map(toContextOption);
  }

  async switchContext(
    authorization: string | undefined,
    payload: { contextType?: string; membershipId?: string },
    request: any,
    response: any,
  ) {
    const session = await this.validateInteractiveAuthorization(authorization);
    const contextType = requireContextType(payload?.contextType);
    const membershipId = requireText(payload?.membershipId, "成员关系");
    const account = await this.accountRepository!.findOne({
      where: { id: session.userId, status: "active" },
    });
    const context = (await this.listAvailableContexts(session.userId)).find(
      (item) => item.type === contextType && item.membership.id === membershipId,
    );
    if (!account || !context) throw new UnauthorizedException("目标访问上下文不可用");
    await this.authSessionService.revokeSession(
      session.workspaceId,
      session.sessionId,
      session.userId,
    );
    return context.type === "platform"
      ? this.createPlatformLoginResponse(account, context.membership, request, response)
      : this.createWorkspaceLoginResponse(account, context.membership, request, response);
  }

  async refresh(
    request: any,
    response: any,
    expectedPrincipalType?: "platform" | "workspace",
  ) {
    const session = await this.authSessionService.refreshSession(
      getCookie(
        request?.headers?.cookie,
        this.authSessionService.getRefreshCookieName(),
      ),
      getRequestContext(request),
    );
    if (
      expectedPrincipalType &&
      session.principalType !== expectedPrincipalType
    ) {
      await this.authSessionService.revokeSession(
        session.workspaceId,
        session.sessionId,
        session.userId,
      );
      clearRefreshCookie(
        response,
        this.authSessionService.getRefreshCookieName(),
        this.authSessionService.getClearRefreshCookieOptions(),
      );
      throw new UnauthorizedException("登录会话类型不匹配");
    }
    setRefreshCookie(
      response,
      this.authSessionService.getRefreshCookieName(),
      session.refreshToken,
      this.authSessionService.getRefreshCookieOptions(),
    );
    return {
      accessToken: session.accessToken,
      expiresAt: session.expiresAt,
      sessionId: session.sessionId,
    };
  }

  async logout(authorization: string | undefined, response: any) {
    const session = await this.validateInteractiveAuthorization(authorization);
    await this.authSessionService.revokeSession(
      session.workspaceId,
      session.sessionId,
      session.userId,
    );
    clearRefreshCookie(
      response,
      this.authSessionService.getRefreshCookieName(),
      this.authSessionService.getClearRefreshCookieOptions(),
    );
  }

  async listSessions(authorization: string | undefined) {
    const session = await this.validateInteractiveAuthorization(authorization);
    return this.authSessionService.listSessions(
      session.workspaceId,
      session.userId,
      session.sessionId,
    );
  }

  async revokeSession(authorization: string | undefined, sessionId: string) {
    const session = await this.validateInteractiveAuthorization(authorization);
    await this.authSessionService.revokeSession(
      session.workspaceId,
      sessionId,
      session.userId,
    );
  }

  async deleteSessionRecord(
    authorization: string | undefined,
    sessionId: string,
  ) {
    const session = await this.validateInteractiveAuthorization(authorization);
    await this.authSessionService.deleteSessionRecord(
      session.workspaceId,
      sessionId,
      session.userId,
      session.sessionId,
    );
  }

  async revokeOtherSessions(authorization: string | undefined) {
    const session = await this.validateInteractiveAuthorization(authorization);
    await this.authSessionService.revokeOtherSessions(
      session.workspaceId,
      session.userId,
      session.sessionId,
    );
  }

  async createRealtimeTicket(authorization: string | undefined) {
    const session = await this.validateInteractiveAuthorization(authorization);
    if (!session.workspaceId || session.principalType !== "workspace") {
      throw new UnauthorizedException("平台会话不支持工作空间实时通道");
    }
    return this.authSessionService.createRealtimeTicket({
      sessionId: session.sessionId,
      workspaceId: session.workspaceId,
      userId: session.userId,
    });
  }

  /**
   * Checks whether the bearer token resolves to an active user.
   */
  async authenticated(authorization: string | undefined) {
    try {
      await this.validateAuthorization(authorization);
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) return false;
      throw error;
    }
  }

  /**
   * Resolves the current authenticated user, workspace role, and permissions.
   */
  async me(authorization: string | undefined) {
    const session = await this.validateAuthorization(authorization);
    if (session.principalType === "platform") {
      const account = await this.accountRepository!.findOne({
        where: { id: session.userId, status: "active" },
      });
      const membership = await this.platformMembershipRepository.findOne({
        relations: { role: { rolePermissions: { permissionRecord: true } } },
        where: {
          accountId: session.userId,
          id: session.membershipId ?? undefined,
          status: "active",
        },
      });
      if (!account || !membership) throw new UnauthorizedException("平台账号不可用");
      return this.getPlatformPrincipalSnapshot(account, membership);
    }
    if (!session.workspaceId) throw new UnauthorizedException("当前接口需要工作空间账号");
    return this.runInWorkspaceContext(session.workspaceId, async (manager) => {
      const principal = await this.getUserFromSession(session, manager);
      return this.getPrincipalSnapshot(
        principal.account,
        principal.membership,
        manager,
      );
    });
  }

  async validateAuthorization(authorization: string | undefined) {
    return this.authSessionService.validateAccessToken(
      extractBearerToken(authorization),
    );
  }

  async validateInteractiveAuthorization(authorization: string | undefined) {
    const session = await this.validateAuthorization(authorization);
    if (session.tokenKind === "integration") {
      throw new UnauthorizedException("集成 Token 不能管理登录会话");
    }
    return session;
  }

  private async getUserFromSession(
    session: Awaited<ReturnType<AuthSessionService["validateAccessToken"]>>,
    manager: EntityManager,
  ) {
    if (session.principalType !== "workspace" || !session.workspaceId) {
      throw new UnauthorizedException("当前接口需要工作空间账号");
    }

    const membership = await manager.getRepository(WorkspaceMembership).findOne({
      relations: { account: true, role: true },
      where: {
        accountId: session.userId,
        id: session.membershipId ?? undefined,
        status: "active",
        workspaceId: session.workspaceId,
      },
    });
    const user = membership?.account;
    if (
      !user ||
      user.status !== "active"
    ) {
      throw new UnauthorizedException("用户不可用");
    }
    return { account: user, membership };
  }

  private async getPrincipalSnapshot(
    account: Account,
    activeMembership: WorkspaceMembership,
    manager: EntityManager,
  ) {
    const workspaceId = activeMembership.workspaceId;
    const [workspace, membership] = await Promise.all([
      manager.getRepository(Workspace).findOne({ where: { id: workspaceId } }),
      manager.getRepository(WorkspaceMembership).findOne({
        relations: { role: true },
        where: {
          accountId: account.id,
          id: activeMembership.id,
          status: "active",
          workspaceId,
        },
      }),
    ]);

    if (!membership?.roleId || !membership.role) {
      throw new UnauthorizedException("工作空间成员关系不可用");
    }
    const roleIds = [membership.roleId];
    const permissions = roleIds.length
      ? await manager.getRepository(RolePermission).find({
          relations: { permissionRecord: true },
          where: roleIds.map((roleId) => ({ enabled: true, roleId })),
        })
      : [];
    const permissionsByRoleId = groupPermissionsByRoleId(permissions);

    return {
      account: toUserDto(account),
      context: {
        membershipId: membership.id,
        type: "workspace" as const,
        workspace: workspace ? toWorkspaceDto(workspace) : workspace,
      },
      membership: {
        id: membership.id,
        role: toRoleDto(membership.role),
        status: membership.status,
      },
      permissions: [membership].flatMap((assignment) =>
        (permissionsByRoleId.get(assignment.roleId!) ?? []).map(
          (permission) => permission.permission,
        ),
      ),
      principalType: "workspace" as const,
      role: toRoleDto(
        membership.role,
        permissionsByRoleId.get(membership.roleId) ?? [],
      ),
      runtimePreferences:
        await this.settingsService.resolveWorkspaceRuntimePreferences(
          workspaceId,
          account,
        ),
      workspace: workspace ? toWorkspaceDto(workspace) : workspace,
      workspaceId,
      workspaceRole: toRoleDto(
        membership.role,
        permissionsByRoleId.get(membership.roleId) ?? [],
      ),
    };
  }

  private async getPlatformPrincipalSnapshot(
    account: Account,
    membership: PlatformMembership,
  ) {
    const resolved = membership.role?.rolePermissions
      ? membership
      : await this.platformMembershipRepository.findOne({
          relations: { role: { rolePermissions: { permissionRecord: true } } },
          where: { id: membership.id, status: "active" },
        });
    if (!resolved?.role || resolved.role.scope !== "platform") {
      throw new UnauthorizedException("平台成员关系不可用");
    }
    const permissions = (resolved.role.rolePermissions ?? [])
      .filter((item) => item.enabled && item.permissionRecord?.code)
      .map((item) => item.permissionRecord.code!);
    return {
      account: toUserDto(account),
      context: {
        membershipId: resolved.id,
        type: "platform" as const,
      },
      membership: {
        id: resolved.id,
        role: toRoleDto(resolved.role),
        status: resolved.status,
      },
      permissions,
      principalType: "platform" as const,
      role: toRoleDto(resolved.role, resolved.role.rolePermissions ?? []),
      runtimePreferences:
        await this.settingsService.resolvePlatformRuntimePreferences(account),
    };
  }

  private async listAvailableContexts(accountId: string): Promise<AvailableContext[]> {
    const [platformMembership, workspaceMemberships] = await Promise.all([
      this.platformMembershipRepository.findOne({
        relations: { role: true },
        where: { accountId, status: "active" },
      }),
      this.listActiveMemberships(accountId),
    ]);
    const contexts: AvailableContext[] = [];
    if (platformMembership?.role?.scope === "platform") {
      contexts.push({ membership: platformMembership, type: "platform" });
    }
    contexts.push(
      ...workspaceMemberships
        .filter((membership) => membership.role?.scope === "workspace")
        .map((membership) => ({
          membership,
          type: "workspace" as const,
        })),
    );
    return contexts;
  }

  private listActiveMemberships(accountId: string) {
    return this.membershipRepository!.find({
      relations: { role: true, workspace: true },
      where: {
        accountId,
        status: "active",
        workspace: { status: "active" },
      },
      order: { createdAt: "ASC" },
    });
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

  private recordLoginAttempt(
    input: Parameters<LoginAuditService["record"]>[0],
  ) {
    return this.loginAuditService?.record(input) ?? Promise.resolve();
  }
}

function groupPermissionsByRoleId(permissions: RolePermission[]) {
  const permissionsByRoleId = new Map<string, RolePermission[]>();
  for (const permission of permissions) {
    permissionsByRoleId.set(permission.roleId, [
      ...(permissionsByRoleId.get(permission.roleId) ?? []),
      permission,
    ]);
  }
  return permissionsByRoleId;
}

function requireLoginPayload(value: LoginPayload) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new UnauthorizedException("用户名或密码不正确");
  }
  return value;
}

function normalizeEmail(value: unknown) {
  return requireText(value, "邮箱").toLowerCase();
}

function readAttemptedEmail(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "unknown";
  }
  const email = (value as { email?: unknown }).email;
  if (typeof email !== "string") return "unknown";
  return email.trim().toLowerCase().slice(0, 160) || "unknown";
}

function requireText(value: unknown, label: string) {
  if (value === undefined || value === null || typeof value !== "string") {
    throw new UnauthorizedException(`${label}不能为空`);
  }
  const text = value.trim();
  if (!text) throw new UnauthorizedException(`${label}不能为空`);
  return text;
}

function extractBearerToken(authorization: string | undefined) {
  return authorization?.replace(/^Bearer\s+/i, "").trim();
}

function getRequestContext(request: any) {
  return {
    ipAddress: resolveClientIp(request),
    userAgent: getHeader(request, "user-agent"),
  };
}

function getHeader(request: any, name: string) {
  const value = request?.headers?.[name];
  return Array.isArray(value) ? value[0] : value ?? null;
}

function getCookie(cookieHeader: string | undefined, name: string) {
  if (!cookieHeader) return undefined;
  const cookies = cookieHeader.split(";").map((item) => item.trim());
  const prefix = `${name}=`;
  const cookie = cookies.find((item) => item.startsWith(prefix));
  return cookie ? decodeURIComponent(cookie.slice(prefix.length)) : undefined;
}

function setRefreshCookie(
  response: any,
  name: string,
  value: string,
  options: Record<string, unknown>,
) {
  response.cookie(name, value, options);
}

function clearRefreshCookie(
  response: any,
  name: string,
  options: Record<string, unknown>,
) {
  response.clearCookie(name, options);
}

function toWorkspaceSelectionOption(membership: WorkspaceMembership) {
  if (!membership.workspace || !membership.role) {
    throw new UnauthorizedException("工作空间成员关系不可用");
  }
  return {
    membershipId: membership.id,
    role: {
      displayName: membership.role.displayName,
      id: membership.role.id,
      name: membership.role.name,
    },
    workspace: {
      id: membership.workspace.id,
      name: membership.workspace.name,
      slug: membership.workspace.slug,
      subdomain: membership.workspace.subdomain,
    },
  };
}

type AvailableContext =
  | { membership: PlatformMembership; type: "platform" }
  | { membership: WorkspaceMembership; type: "workspace" };

function contextSelectionKey(context: AvailableContext) {
  return `${context.type}:${context.membership.id}`;
}

function toContextOption(context: AvailableContext) {
  if (context.type === "platform") {
    if (!context.membership.role) {
      throw new UnauthorizedException("平台成员关系不可用");
    }
    return {
      membershipId: context.membership.id,
      role: toContextRole(context.membership.role),
      type: "platform" as const,
    };
  }
  return {
    ...toWorkspaceSelectionOption(context.membership),
    type: "workspace" as const,
  };
}

function toContextRole(role: Role) {
  return {
    displayName: role.displayName ?? role.label,
    id: role.id,
    name: role.name,
  };
}

function requireContextType(value: unknown): "platform" | "workspace" {
  if (value === "platform" || value === "workspace") return value;
  throw new UnauthorizedException("访问上下文无效");
}
