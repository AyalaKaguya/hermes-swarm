import { Injectable, UnauthorizedException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import {
  OrganizationGroup,
  OrganizationGroupMember,
  PlatformMember,
  RolePermission,
  User,
  UserOrganization,
} from "@hermes-swarm/core";
import { In, Repository } from "typeorm";
import type { LoginPayload } from "../../common/admin-api.types.js";
import { AuthSessionService } from "./auth-session.service.js";
import { verifyPassword } from "../../common/security/password-hash.js";
import { SettingsService } from "../settings/settings.service.js";
import { toUserDto } from "../users/user-dto.js";

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
    @InjectRepository(PlatformMember)
    private readonly platformMemberRepository: Repository<PlatformMember>,
    @InjectRepository(RolePermission)
    private readonly rolePermissionRepository: Repository<RolePermission>,
    private readonly authSessionService: AuthSessionService,
    private readonly settingsService: SettingsService,
  ) {}

  /**
   * Authenticates an admin user and returns the session token plus principal.
   */
  async login(payload: LoginPayload, request: any, response: any) {
    const input = requireLoginPayload(payload);
    const email = normalizeEmail(input.email);
    const password = requireText(input.password, "密码");
    const user = await this.userRepository.findOne({ where: { email } });
    if (
      !user ||
      user.status !== "active" ||
      !verifyPassword(password, user.passwordHash)
    ) {
      throw new UnauthorizedException("用户名或密码不正确");
    }

    return this.createLoginResponse(user, request, response);
  }

  async createLoginResponse(user: User, request: any, response: any) {
    const session = await this.authSessionService.createSession(
      user.id,
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
      snapshot: await this.getPrincipalSnapshot(user),
    };
  }

  async refresh(request: any, response: any) {
    const session = await this.authSessionService.refreshSession(
      getCookie(
        request?.headers?.cookie,
        this.authSessionService.getRefreshCookieName(),
      ),
      getRequestContext(request),
    );
    const user = await this.userRepository.findOne({
      where: { id: session.userId },
    });
    if (!user || user.status !== "active") {
      await this.authSessionService.revokeSession(
        session.sessionId,
        session.userId,
      );
      clearRefreshCookie(
        response,
        this.authSessionService.getRefreshCookieName(),
        this.authSessionService.getClearRefreshCookieOptions(),
      );
      throw new UnauthorizedException("用户不可用");
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
      session.userId,
      session.sessionId,
    );
  }

  async revokeSession(authorization: string | undefined, sessionId: string) {
    const session = await this.validateInteractiveAuthorization(authorization);
    await this.authSessionService.revokeSession(sessionId, session.userId);
  }

  async deleteSessionRecord(
    authorization: string | undefined,
    sessionId: string,
  ) {
    const session = await this.validateInteractiveAuthorization(authorization);
    await this.authSessionService.deleteSessionRecord(
      sessionId,
      session.userId,
      session.sessionId,
    );
  }

  async revokeOtherSessions(authorization: string | undefined) {
    const session = await this.validateInteractiveAuthorization(authorization);
    await this.authSessionService.revokeOtherSessions(
      session.userId,
      session.sessionId,
    );
  }

  async createRealtimeTicket(authorization: string | undefined) {
    const session = await this.validateInteractiveAuthorization(authorization);
    return this.authSessionService.createRealtimeTicket({
      sessionId: session.sessionId,
      userId: session.userId,
    });
  }

  /**
   * Checks whether the bearer token resolves to an active user.
   */
  async authenticated(authorization: string | undefined) {
    try {
      await this.getUserFromAuthorization(authorization);
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
    const user = await this.getUserFromAuthorization(authorization);
    return this.getPrincipalSnapshot(user);
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

  private async getUserFromAuthorization(authorization: string | undefined) {
    const session = await this.validateAuthorization(authorization);

    const user = await this.userRepository.findOne({
      where: { id: session.userId },
    });
    if (!user || user.status !== "active") {
      throw new UnauthorizedException("用户不可用");
    }
    return user;
  }

  private async getPrincipalSnapshot(user: User) {
    const [memberships, platformMembership, systemSettings] = await Promise.all([
      this.membershipRepository.find({
        relations: { organization: true, role: true, user: true },
        where: { status: "active", userId: user.id },
      }),
      this.platformMemberRepository.findOne({
        relations: { role: true },
        where: { status: "active", userId: user.id },
      }),
      this.settingsService.listPlatformSettings(),
    ]);

    const roleIds = [
      ...memberships.map((membership) => membership.roleId),
      platformMembership?.roleId ?? null,
    ].filter((roleId): roleId is string => Boolean(roleId));
    const permissions = roleIds.length
      ? await this.rolePermissionRepository.find({
          where: roleIds.map((roleId) => ({ enabled: true, roleId })),
        })
      : [];
    const permissionsByRoleId = groupPermissionsByRoleId(permissions);
    const groupsByMembership = await this.loadGroupsByMembership(
      memberships.map((membership) => membership.id),
    );

    return {
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
      platformMembership: platformMembership
        ? {
            displayName: platformMembership.displayName,
            id: platformMembership.id,
            role: platformMembership.role
              ? {
                  ...platformMembership.role,
                  permissions:
                    permissionsByRoleId.get(
                      platformMembership.roleId ?? platformMembership.role.id,
                    ) ?? [],
                }
              : null,
            roleId: platformMembership.roleId,
            status: platformMembership.status,
          }
        : null,
      systemSettings,
      user: toUserDto(user),
    };
  }

  private async loadGroupsByMembership(membershipIds: string[]) {
    if (membershipIds.length === 0) return new Map<string, OrganizationGroup[]>();

    const rows = await this.groupMemberRepository.find({
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
