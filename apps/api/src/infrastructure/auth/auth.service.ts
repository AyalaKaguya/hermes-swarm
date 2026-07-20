import {
  Injectable,
  Optional,
  UnauthorizedException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import {
  Organization,
  PlatformUser,
  RolePermission,
  Tenant,
  User,
  UserOrganization,
  UserOrganizationRole,
  UserTenantRole,
} from "@hermes-swarm/core";
import { DataSource, In, IsNull, Repository, type EntityManager } from "typeorm";
import { TenantContextService } from "../../common/database/tenant-context.service.js";
import type { LoginPayload } from "../../common/admin-api.types.js";
import { AuthSessionService } from "./auth-session.service.js";
import { verifyPassword } from "../../common/security/password-hash.js";
import { toUserDto } from "../users/user-dto.js";
import { PLATFORM_DATA_SOURCE } from "../../common/database/database.constants.js";
import { TenantLoginResolverService } from "./tenant-login-resolver.service.js";
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
    @InjectRepository(PlatformUser, PLATFORM_DATA_SOURCE)
    private readonly platformUserRepository: Repository<PlatformUser>,
    private readonly dataSource: DataSource,
    private readonly tenantContext: TenantContextService,
    private readonly tenantLoginResolver: TenantLoginResolverService,
    private readonly settingsService: SettingsService,
    @Optional()
    private readonly loginAuditService?: LoginAuditService,
  ) {}

  /**
   * Authenticates an admin user and returns the session token plus principal.
   */
  async login(payload: LoginPayload, request: any, response: any) {
    const requestContext = getRequestContext(request);
    const attemptedEmail = readAttemptedEmail(payload);
    let tenantId: string | null = null;
    let tenantResolutionCompleted = false;
    let recorded = false;
    try {
      const input = requireLoginPayload(payload);
      const email = normalizeEmail(input.email);
      const password = requireText(input.password, "密码");
      const tenant = (await this.tenantLoginResolver.resolve(
        request,
        input.tenantSlug,
      ))?.tenant;
      tenantResolutionCompleted = true;
      tenantId = tenant?.id ?? null;
      const user = tenant
        ? await this.runInTenantContext(tenant.id, (manager) =>
            manager.getRepository(User).findOne({
              where: { email, tenantId: tenant.id },
            }),
          )
        : null;
      if (
        !user ||
        user.status !== "active" ||
        !(await verifyPassword(password, user.passwordHash))
      ) {
        await this.recordLoginAttempt({
          attemptedEmail: email,
          failureCode: tenant ? "invalid_credentials" : "tenant_unresolved",
          ...requestContext,
          result: "failed",
          scopeType: "tenant",
          tenantId,
        });
        recorded = true;
        throw new UnauthorizedException("用户名或密码不正确");
      }

      const result = await this.createLoginResponse(user, request, response);
      await this.recordLoginAttempt({
        actorId: user.id,
        attemptedEmail: email,
        ...requestContext,
        result: "success",
        scopeType: "tenant",
        sessionId: result.sessionId,
        tenantId,
      });
      recorded = true;
      return result;
    } catch (error) {
      if (!recorded) {
        await this.recordLoginAttempt({
          attemptedEmail,
          failureCode:
            tenantResolutionCompleted && !tenantId
              ? "tenant_unresolved"
              : error instanceof UnauthorizedException
                ? "invalid_credentials"
                : "internal_error",
          ...requestContext,
          result: "failed",
          scopeType: "tenant",
          tenantId,
        });
      }
      throw error;
    }
  }

  async loginPlatform(payload: LoginPayload, request: any, response: any) {
    const requestContext = getRequestContext(request);
    const attemptedEmail = readAttemptedEmail(payload);
    let recorded = false;
    try {
      const input = requireLoginPayload(payload);
      const email = normalizeEmail(input.email);
      const password = requireText(input.password, "密码");
      const user = await this.platformUserRepository.findOne({
        relations: {
          roles: {
            platformRole: { rolePermissions: { permission: true } },
          },
        },
        where: { email },
      });
      if (
        !user ||
        user.status !== "active" ||
        !(await verifyPassword(password, user.passwordHash))
      ) {
        await this.recordLoginAttempt({
          attemptedEmail: email,
          failureCode: "invalid_credentials",
          ...requestContext,
          result: "failed",
          scopeType: "platform",
        });
        recorded = true;
        throw new UnauthorizedException("用户名或密码不正确");
      }
      const session = await this.authSessionService.createSession(
        user.id,
        null,
        "platform",
        requestContext,
      );
      setRefreshCookie(
        response,
        this.authSessionService.getRefreshCookieName(),
        session.refreshToken,
        this.authSessionService.getRefreshCookieOptions(),
      );
      const result = {
        accessToken: session.accessToken,
        expiresAt: session.expiresAt,
        sessionId: session.sessionId,
        snapshot: {
          platformUser: toPlatformUserDto(user),
          principalType: "platform" as const,
          runtimePreferences:
            await this.settingsService.resolvePlatformRuntimePreferences(user),
        },
      };
      await this.recordLoginAttempt({
        actorId: user.id,
        attemptedEmail: email,
        ...requestContext,
        result: "success",
        scopeType: "platform",
        sessionId: result.sessionId,
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
          scopeType: "platform",
        });
      }
      throw error;
    }
  }

  async createLoginResponse(user: User, request: any, response: any) {
    const session = await this.authSessionService.createSession(
      user.id,
      requireUserTenantId(user),
      "tenant",
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
      snapshot: await this.runInTenantContext(
        requireUserTenantId(user),
        (manager) => this.getPrincipalSnapshot(user, manager),
      ),
    };
  }

  async refresh(
    request: any,
    response: any,
    expectedPrincipalType?: "platform" | "tenant",
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
        session.tenantId,
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
      session.tenantId,
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
      session.tenantId,
      session.userId,
      session.sessionId,
    );
  }

  async revokeSession(authorization: string | undefined, sessionId: string) {
    const session = await this.validateInteractiveAuthorization(authorization);
    await this.authSessionService.revokeSession(
      session.tenantId,
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
      session.tenantId,
      sessionId,
      session.userId,
      session.sessionId,
    );
  }

  async revokeOtherSessions(authorization: string | undefined) {
    const session = await this.validateInteractiveAuthorization(authorization);
    await this.authSessionService.revokeOtherSessions(
      session.tenantId,
      session.userId,
      session.sessionId,
    );
  }

  async createRealtimeTicket(authorization: string | undefined) {
    const session = await this.validateInteractiveAuthorization(authorization);
    if (!session.tenantId || session.principalType !== "tenant") {
      throw new UnauthorizedException("平台会话不支持租户实时通道");
    }
    return this.authSessionService.createRealtimeTicket({
      sessionId: session.sessionId,
      tenantId: session.tenantId,
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
   * Resolves the current authenticated user, role, permissions, and organization.
   */
  async me(authorization: string | undefined) {
    const session = await this.validateAuthorization(authorization);
    if (session.principalType === "platform") {
      const platformUser = await this.platformUserRepository.findOne({
        relations: {
          roles: {
            platformRole: { rolePermissions: { permission: true } },
          },
        },
        where: { id: session.userId, status: "active" },
      });
      if (!platformUser) throw new UnauthorizedException("平台账号不可用");
      return {
        platformUser: toPlatformUserDto(platformUser),
        principalType: "platform",
        runtimePreferences:
          await this.settingsService.resolvePlatformRuntimePreferences(
            platformUser,
          ),
      };
    }
    if (!session.tenantId) throw new UnauthorizedException("当前接口需要租户账号");
    return this.runInTenantContext(session.tenantId, async (manager) => {
      const user = await this.getUserFromSession(session, manager);
      return this.getPrincipalSnapshot(user, manager);
    });
  }

  async platformMe(authorization: string | undefined) {
    const session = await this.validateAuthorization(authorization);
    if (session.principalType !== "platform") {
      throw new UnauthorizedException("当前接口需要平台账号");
    }
    return this.me(authorization);
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
    if (session.principalType !== "tenant" || !session.tenantId) {
      throw new UnauthorizedException("当前接口需要租户账号");
    }

    const user = await manager.getRepository(User).findOne({
      where: { id: session.userId, tenantId: session.tenantId },
    });
    if (
      !user ||
      user.status !== "active" ||
      requireUserTenantId(user) !== session.tenantId
    ) {
      throw new UnauthorizedException("用户不可用");
    }
    return user;
  }

  private async getPrincipalSnapshot(user: User, manager: EntityManager) {
    const tenantId = requireUserTenantId(user);
    const [tenant, rootOrganization, memberships, tenantRoleAssignments] =
      await Promise.all([
      manager.getRepository(Tenant).findOne({ where: { id: tenantId } }),
      manager.getRepository(Organization).findOne({
        where: { parentOrganizationId: IsNull(), tenantId },
      }),
      manager.getRepository(UserOrganization).find({
        relations: { organization: true, user: true },
        where: { status: "active", tenantId, userId: user.id },
      }),
      manager.getRepository(UserTenantRole).find({
        relations: { role: true },
        where: { tenantId, userId: user.id },
      }),
    ]);

    const organizationRoleAssignments = memberships.length
      ? await manager.getRepository(UserOrganizationRole).find({
          relations: { role: true },
          where: { membershipId: In(memberships.map((item) => item.id)), tenantId },
        })
      : [];

    const roleIds = [
      ...tenantRoleAssignments.map((assignment) => assignment.roleId),
      ...organizationRoleAssignments.map((assignment) => assignment.roleId),
    ];
    const permissions = roleIds.length
      ? await manager.getRepository(RolePermission).find({
          where: roleIds.map((roleId) => ({ enabled: true, roleId })),
        })
      : [];
    const permissionsByRoleId = groupPermissionsByRoleId(permissions);
    const defaultMembership =
      memberships.find((item) => item.isDefault) ?? memberships[0] ?? null;

    return {
      defaultOrganizationId: defaultMembership?.organizationId ?? null,
      memberships: memberships.map((membership) => ({
          displayName: membership.displayName,
          id: membership.id,
          isDefault: membership.isDefault,
          joinedAt: membership.joinedAt,
          organization: membership.organization,
          organizationId: membership.organizationId,
          role: (() => {
            const assignment = organizationRoleAssignments.find(
              (item) => item.membershipId === membership.id,
            );
            return assignment
              ? {
                  ...assignment.role,
                  permissions: permissionsByRoleId.get(assignment.roleId) ?? [],
                }
              : null;
          })(),
          status: membership.status,
      })),
      onboarding: { rootOrganizationRequired: !rootOrganization },
      permissions: tenantRoleAssignments.flatMap((assignment) =>
        (permissionsByRoleId.get(assignment.roleId) ?? []).map(
          (permission) => permission.permission,
        ),
      ),
      principalType: "tenant" as const,
      runtimePreferences:
        await this.settingsService.resolveTenantRuntimePreferences(
          tenantId,
          user,
        ),
      tenant,
      tenantId,
      tenantRole: tenantRoleAssignments[0]
        ? {
            ...tenantRoleAssignments[0].role,
            permissions: permissionsByRoleId.get(tenantRoleAssignments[0].roleId) ?? [],
          }
        : null,
      user: toUserDto(user),
    };
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

function requireUserTenantId(user: User) {
  const tenantId = (user as User & { tenantId?: string | null }).tenantId;
  if (!tenantId) throw new UnauthorizedException("用户不可用");
  return tenantId;
}

function toPlatformUserDto(user: PlatformUser) {
  return {
    displayName: user.displayName,
    email: user.email,
    id: user.id,
    roles:
      user.roles?.map((item) => ({
        description: item.platformRole.description,
        id: item.platformRole.id,
        isSystem: item.platformRole.isSystem,
        label: item.platformRole.label,
        name: item.platformRole.name,
        permissions:
          item.platformRole.rolePermissions
            ?.filter((row) => row.enabled)
            .flatMap((row) => {
              const permission = row.permission?.code;
              return permission
                ? [
                    {
                      enabled: row.enabled,
                      id: row.id,
                      permission,
                      permissionId: row.permissionId,
                      roleId: row.platformRoleId,
                    },
                  ]
                : [];
            }) ?? [],
      })) ?? [],
    status: user.status,
  };
}
