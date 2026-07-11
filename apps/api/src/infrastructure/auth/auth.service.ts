import { Injectable, UnauthorizedException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import {
  OrganizationGroup,
  OrganizationGroupMember,
  PlatformUser,
  RolePermission,
  Tenant,
  User,
  UserDepartment,
  UserDepartmentRole,
  UserOrganization,
  UserTenantRole,
} from "@hermes-swarm/core";
import { DataSource, In, Repository, type EntityManager } from "typeorm";
import { TenantContextService } from "../../common/database/tenant-context.service.js";
import type { LoginPayload } from "../../common/admin-api.types.js";
import { AuthSessionService } from "./auth-session.service.js";
import { verifyPassword } from "../../common/security/password-hash.js";
import { SettingsService } from "../settings/settings.service.js";
import { toUserDto } from "../users/user-dto.js";
import { PLATFORM_DATA_SOURCE } from "../../common/database/database.constants.js";

@Injectable()
/**
 * Owns admin authentication and principal resolution.
 */
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(UserOrganization)
    private readonly membershipRepository: Repository<UserOrganization>,
    @InjectRepository(OrganizationGroupMember)
    private readonly groupMemberRepository: Repository<OrganizationGroupMember>,
    @InjectRepository(RolePermission)
    private readonly rolePermissionRepository: Repository<RolePermission>,
    private readonly authSessionService: AuthSessionService,
    private readonly settingsService: SettingsService,
    @InjectRepository(PlatformUser, PLATFORM_DATA_SOURCE)
    private readonly platformUserRepository: Repository<PlatformUser>,
    @InjectRepository(Tenant, PLATFORM_DATA_SOURCE)
    private readonly tenantRepository: Repository<Tenant>,
    private readonly dataSource: DataSource,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * Authenticates an admin user and returns the session token plus principal.
   */
  async login(payload: LoginPayload, request: any, response: any) {
    const input = requireLoginPayload(payload);
    const email = normalizeEmail(input.email);
    const password = requireText(input.password, "密码");
    const tenantSlug = requireText(input.tenantSlug, "租户标识").toLowerCase();
    const tenant = await this.tenantRepository.findOne({
      where: { slug: tenantSlug, status: "active" },
    });
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
      !verifyPassword(password, user.passwordHash)
    ) {
      throw new UnauthorizedException("用户名或密码不正确");
    }

    return this.createLoginResponse(user, request, response);
  }

  async loginPlatform(payload: LoginPayload, request: any, response: any) {
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
      !verifyPassword(password, user.passwordHash)
    ) {
      throw new UnauthorizedException("用户名或密码不正确");
    }
    const session = await this.authSessionService.createSession(
      user.id,
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
      snapshot: { platformUser: toPlatformUserDto(user), principalType: "platform" },
    };
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
    const membershipRepository =
      manager.getRepository(UserOrganization);
    const groupMemberRepository =
      manager.getRepository(OrganizationGroupMember);
    const rolePermissionRepository =
      manager.getRepository(RolePermission);
    const [tenant, memberships, tenantRoleAssignments, departmentMemberships, systemSettings] =
      await Promise.all([
      manager.getRepository(Tenant).findOne({ where: { id: tenantId } }),
      membershipRepository.find({
        relations: { organization: true, role: true, user: true },
        where: { status: "active", tenantId, userId: user.id },
      }),
      manager.getRepository(UserTenantRole).find({
        relations: { role: true },
        where: { tenantId, userId: user.id },
      }),
      manager.getRepository(UserDepartment).find({
        relations: { department: true, membership: true },
        where: {
          membership: { userId: user.id },
          status: "active",
          tenantId,
        },
      }),
      this.settingsService.listPlatformSettings(),
    ]);

    const userDepartmentMemberships = departmentMemberships;
    const departmentRoleAssignments = userDepartmentMemberships.length
      ? await manager.getRepository(UserDepartmentRole).find({
          relations: { role: true },
          where: userDepartmentMemberships.map((item) => ({
            tenantId,
            userDepartmentId: item.id,
          })),
        })
      : [];

    const roleIds = [
      ...memberships.map((membership) => membership.roleId),
      ...tenantRoleAssignments.map((assignment) => assignment.roleId),
      ...departmentRoleAssignments.map((assignment) => assignment.roleId),
    ].filter((roleId): roleId is string => Boolean(roleId));
    const permissions = roleIds.length
      ? await rolePermissionRepository.find({
          where: roleIds.map((roleId) => ({ enabled: true, roleId })),
        })
      : [];
    const permissionsByRoleId = groupPermissionsByRoleId(permissions);
    const groupsByMembership = await this.loadGroupsByMembership(
      memberships.map((membership) => membership.id),
      groupMemberRepository,
    );
    const allowedScopes = [
      ...(tenantRoleAssignments.length > 0 ? ["tenant" as const] : []),
      ...(memberships.length > 0 ? ["organization" as const] : []),
      ...(userDepartmentMemberships.length > 0 ? ["department" as const] : []),
    ];
    const defaultDepartment =
      userDepartmentMemberships.find((item) => item.isDefault) ??
      userDepartmentMemberships[0] ??
      null;
    const defaultMembership =
      memberships.find((item) => item.isDefault) ?? memberships[0] ?? null;
    const defaultScope = defaultDepartment
      ? {
          departmentId: defaultDepartment.departmentId,
          level: "department" as const,
          organizationId: defaultDepartment.organizationId,
        }
      : defaultMembership
        ? {
            departmentId: null,
            level: "organization" as const,
            organizationId: defaultMembership.organizationId,
          }
        : tenantRoleAssignments.length > 0
          ? {
              departmentId: null,
              level: "tenant" as const,
              organizationId: null,
            }
          : null;

    return {
      allowedScopes,
      defaultScope,
      departmentMemberships: userDepartmentMemberships.map((membership) => ({
        department: membership.department,
        departmentId: membership.departmentId,
        id: membership.id,
        isDefault: membership.isDefault,
        joinedAt: membership.joinedAt,
        membershipId: membership.membershipId,
        organizationId: membership.organizationId,
        roles: departmentRoleAssignments
          .filter((assignment) => assignment.userDepartmentId === membership.id)
          .map((assignment) => assignment.role),
        status: membership.status,
        tenantId: membership.tenantId,
      })),
      memberships: memberships.map((membership) => {
        const groups = groupsByMembership.get(membership.id) ?? [];
        return {
          displayName: membership.displayName,
          groupIds: groups.map((group) => group.id),
          groups: groups.map(toGroupBriefDto),
          id: membership.id,
          joinedAt: membership.joinedAt,
          organization: membership.organization,
          organizationId: membership.organizationId,
          role: membership.role
            ? {
                ...membership.role,
                permissions:
                  permissionsByRoleId.get(
                    membership.roleId ?? membership.role.id,
                  ) ?? [],
              }
            : null,
          roleId: membership.roleId,
          status: membership.status,
          user: membership.user,
          userId: membership.userId,
        };
      }),
      permissions: permissions.map((permission) => permission.permission),
      principalType: "tenant" as const,
      systemSettings,
      tenant,
      tenantId,
      tenantRoles: tenantRoleAssignments.map((assignment) => ({
        ...assignment.role,
        permissions: permissionsByRoleId.get(assignment.roleId) ?? [],
      })),
      user: toUserDto(user),
    };
  }

  private async loadGroupsByMembership(
    membershipIds: string[],
    repository: Repository<OrganizationGroupMember>,
  ) {
    if (membershipIds.length === 0) return new Map<string, OrganizationGroup[]>();

    const rows = await repository.find({
      relations: { group: true },
      where: { membershipId: In(membershipIds) },
    });
    const groupsByMembership = new Map<string, OrganizationGroup[]>();
    for (const row of rows) {
      if (!row.group) continue;
      groupsByMembership.set(row.membershipId, [
        ...(groupsByMembership.get(row.membershipId) ?? []),
        row.group,
      ]);
    }
    return groupsByMembership;
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
          departmentId: null,
          manager,
          organizationId: null,
          scopeLevel: "tenant",
          tenantId,
        },
        () => work(manager),
      );
    });
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
    ipAddress: getRequestIp(request),
    userAgent: getHeader(request, "user-agent"),
  };
}

function getRequestIp(request: any) {
  const forwardedFor = getHeader(request, "x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || null;
  }
  return request?.ip ?? request?.socket?.remoteAddress ?? null;
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

function toGroupBriefDto(group: OrganizationGroup) {
  return {
    color: group.color,
    displayName: group.displayName,
    id: group.id,
    name: group.name,
    organizationId: group.organizationId,
  };
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
            .map((row) => row.permission.code)
            .filter(Boolean) ?? [],
      })) ?? [],
    status: user.status,
  };
}
