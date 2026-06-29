import { Injectable, UnauthorizedException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import {
  PlatformMember,
  RolePermission,
  User,
  UserOrganization,
} from "@hermes-swarm/core";
import { Repository } from "typeorm";
import type { LoginPayload } from "../common/admin-api.types.js";
import {
  createAuthSessionToken,
  parseAuthSessionToken,
} from "./auth-session.js";
import { verifyPassword } from "../common/security/password-hash.js";
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
    @InjectRepository(PlatformMember)
    private readonly platformMemberRepository: Repository<PlatformMember>,
    @InjectRepository(RolePermission)
    private readonly rolePermissionRepository: Repository<RolePermission>,
  ) {}

  /**
   * Authenticates an admin user and returns the session token plus principal.
   */
  async login(payload: LoginPayload) {
    const email = normalizeEmail(payload.email);
    const password = requireText(payload.password, "密码");
    const user = await this.userRepository.findOne({ where: { email } });
    if (
      !user ||
      user.status !== "active" ||
      !verifyPassword(password, user.passwordHash)
    ) {
      throw new UnauthorizedException("用户名或密码不正确");
    }

    const token = createAuthSessionToken({ userId: user.id });
    return {
      snapshot: await this.getPrincipalSnapshot(user),
      token,
    };
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

  private async getUserFromAuthorization(authorization: string | undefined) {
    const token = authorization?.replace(/^Bearer\s+/i, "").trim();
    const session = parseAuthSessionToken(token);
    if (!session) throw new UnauthorizedException("登录已失效");

    const user = await this.userRepository.findOne({
      where: { id: session.userId },
    });
    if (!user || user.status !== "active") {
      throw new UnauthorizedException("用户不可用");
    }
    return user;
  }

  private async getPrincipalSnapshot(user: User) {
    const [memberships, platformMembership] = await Promise.all([
      this.membershipRepository.find({
        relations: { organization: true, role: true },
        where: { status: "active", userId: user.id },
      }),
      this.platformMemberRepository.findOne({
        relations: { role: true },
        where: { status: "active", userId: user.id },
      }),
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

    return {
      memberships: memberships.map((membership) => ({
        displayName: membership.displayName,
        id: membership.id,
        organization: membership.organization,
        organizationId: membership.organizationId,
        role: membership.role,
        roleId: membership.roleId,
        status: membership.status,
      })),
      permissions: permissions.map((permission) => permission.permission),
      platformMembership: platformMembership
        ? {
            displayName: platformMembership.displayName,
            id: platformMembership.id,
            role: platformMembership.role,
            roleId: platformMembership.roleId,
            status: platformMembership.status,
          }
        : null,
      user: toUserDto(user),
    };
  }
}

function normalizeEmail(value: string | undefined) {
  return requireText(value, "邮箱").toLowerCase();
}

function requireText(value: string | undefined, label: string) {
  const text = value?.trim();
  if (!text) throw new UnauthorizedException(`${label}不能为空`);
  return text;
}
