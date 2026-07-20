import {
  BadRequestException,
  Injectable,
  Inject,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { ILike, In, IsNull } from "typeorm";
import {
  IntegrationToken,
  Role,
  User,
  UserTenantRole,
  normalizeCanonicalLanguage,
  type UserStatus,
} from "@hermes-swarm/core";
import type {
  CreateUserPayload,
  AdminResetUserPasswordPayload,
  SearchUsersQuery,
  UpdatePreferredLanguagePayload,
  UpdateRuntimePreferencesPayload,
  UpdateUserPasswordPayload,
  UpdateManagedUserPayload,
  UpdateSelfProfilePayload,
} from "../../common/admin-api.types.js";
import { AuthSessionService } from "../auth/auth-session.service.js";
import {
  hashPassword,
  verifyPassword,
} from "../../common/security/password-hash.js";
import { toUserDto } from "./user-dto.js";
import { TenantContextService } from "../../common/database/tenant-context.service.js";
import { RoleGrantPolicyService } from "@hermes-swarm/rbac";

@Injectable()
/**
 * Implements tenant-local user-management operations.
 */
export class UsersService {
  constructor(
    private readonly tenantContext: TenantContextService,
    @Inject(AuthSessionService)
    private readonly authSessionService: AuthSessionService,
    private readonly grantPolicy: RoleGrantPolicyService =
      new RoleGrantPolicyService(),
  ) {}

  /**
   * Lists users in the active organization after checking user view permission.
   */
  async list(authorization: string | undefined) {
    const session = await this.requireSession(authorization);
    const users = await this.users.find({
      order: { createdAt: "DESC" },
      where: { tenantId: session.tenantId },
    });
    return this.withTenantRoles(users);
  }

  /**
   * Searches organization users by profile, email, username, or mobile fields.
   */
  async search(authorization: string | undefined, query: SearchUsersQuery) {
    const session = await this.requireSession(authorization);
    const input = requirePayload(query);
    const search = normalizeOptionalText(input.search);
    if (!search) return this.list(authorization);

    const pattern = `%${search}%`;
    const users = await this.users.find({
      order: { createdAt: "DESC" },
      take: 20,
      where: [
        { email: ILike(pattern), tenantId: session.tenantId },
        { displayName: ILike(pattern), tenantId: session.tenantId },
        { nickname: ILike(pattern), tenantId: session.tenantId },
        { username: ILike(pattern), tenantId: session.tenantId },
        { mobile: ILike(pattern), tenantId: session.tenantId },
      ],
    });
    return users.map((user) => toUserDto(user));
  }

  /**
   * Creates a user in the active organization with the requested role.
   */
  async create(
    authorization: string | undefined,
    payload: CreateUserPayload,
  ) {
    const session = await this.requireSession(authorization);
    const input = requirePayload(payload);
    const email = normalizeEmail(input.email);
    await this.assertUniqueEmail(email);

    const displayName =
      normalizeOptionalText(input.displayName) ?? email.split("@")[0] ?? email;
    const passwordHash = input.password
      ? await hashPassword(requirePassword(input.password))
      : null;
    const roleId = requireText(input.roleId, "工作空间角色");
    const role = await this.tenantContext.repository(Role).findOne({
      relations: { rolePermissions: true },
      where: {
        id: roleId,
        organizationId: IsNull(),
        scope: "tenant",
        tenantId: session.tenantId,
      },
    });
    if (!role) throw new BadRequestException("工作空间角色无效");
    await this.assertCanGrantTenantRole(session.userId, role);

    const user = this.users.create({
      avatarUrl: normalizeNullableText(input.imageUrl),
      displayName,
      email,
      firstName: normalizeNullableText(input.firstName),
      imageUrl: normalizeNullableText(input.imageUrl),
      lastName: normalizeNullableText(input.lastName),
      mobile: normalizeNullableText(input.mobile),
      nickname: displayName,
      passwordHash,
      status:
        input.status === undefined ? "active" : normalizeUserStatus(input.status),
      type: "user",
      tenantId: session.tenantId,
      username: normalizeNullableText(input.username),
    });

    try {
      const saved = await this.users.save(user);
      await this.tenantContext.current()!.manager.insert(UserTenantRole, {
        roleId: role.id,
        tenantId: session.tenantId,
        userId: saved.id,
      });
      return toUserDto(saved, role);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new BadRequestException("邮箱已被使用");
      }
      throw error;
    }
  }

  /**
   * Updates mutable profile, status, role, and credential fields for a user.
   */
  async updateSelf(
    authorization: string | undefined,
    payload: UpdateSelfProfilePayload,
  ) {
    const session = await this.requireSession(authorization);
    const input = requirePayload(payload);
    assertAllowedKeys(input, SELF_PROFILE_KEYS);
    const user = await this.getUserOrThrow(session.userId);
    return this.applyUserPatch(user, input);
  }

  /**
   * Updates mutable fields for a user in the current tenant.
   */
  async updateManaged(
    authorization: string | undefined,
    userId: string,
    payload: UpdateManagedUserPayload,
  ) {
    const session = await this.requireSession(authorization);
    const input = requirePayload(payload);
    assertAllowedKeys(input, MANAGED_PROFILE_KEYS);
    const user = await this.getUserOrThrow(userId);
    return this.applyUserPatch(user, input);
  }

  /**
   * Deletes a user from the current tenant.
   */
  async deleteManaged(authorization: string | undefined, userId: string) {
    const session = await this.requireSession(authorization);
    const user = await this.getUserOrThrow(userId);
    const manager = this.tenantContext.current()!.manager;
    await this.assertTenantOwnerContinuity(user.id, false);
    await manager.update(
      IntegrationToken,
      { ownerUserId: user.id, revokedAt: IsNull(), tenantId: session.tenantId },
      { revokedAt: new Date() },
    );
    await manager.softDelete(User, { id: user.id, tenantId: session.tenantId });
    await this.authSessionService.revokeUserSessions(session.tenantId, user.id);
  }

  async replaceTenantRole(
    authorization: string | undefined,
    userId: string,
    roleId: string,
  ) {
    const session = await this.requireSession(authorization);
    const user = await this.getUserOrThrow(userId);
    roleId = requireText(roleId, "工作空间角色");
    const role = await this.tenantContext.current()!.manager.findOne(Role, {
      relations: { rolePermissions: true },
      where: {
        id: roleId,
        organizationId: IsNull(),
        scope: "tenant",
        tenantId: this.tenantId,
      },
    });
    if (!role) throw new BadRequestException("工作空间角色无效");
    await this.assertCanGrantTenantRole(session.userId, role, userId);

    await this.assertTenantOwnerContinuity(
      user.id,
      role.name === "tenant-owner",
    );

    const manager = this.tenantContext.current()!.manager;
    await manager.transaction(async (transaction) => {
      await transaction.delete(UserTenantRole, {
        tenantId: this.tenantId,
        userId,
      });
      await transaction.insert(UserTenantRole, {
        roleId: role.id,
        tenantId: this.tenantId,
        userId,
      });
    });
    return toUserDto(user, role);
  }

  /**
   * Updates a user password, allowing self-service with current password proof.
   */
  async updatePassword(
    authorization: string | undefined,
    payload: UpdateUserPasswordPayload,
  ) {
    const session = await this.requireSession(authorization);
    const input = requirePayload(payload);
    const user = await this.getUserOrThrow(session.userId);

    if (user.passwordHash) {
      const currentPassword = requireText(input.currentPassword, "当前密码");
      if (!(await verifyPassword(currentPassword, user.passwordHash))) {
        throw new BadRequestException("当前密码不正确");
      }
    }

    const passwordHash = await hashPassword(requirePassword(input.password));
    await this.commitCredentialChange(user, passwordHash);
    await this.authSessionService
      .revokeUserSessions(this.tenantId, user.id)
      .catch(() => undefined);
    return { reauthenticationRequired: true, success: true } as const;
  }

  async adminResetPassword(
    authorization: string | undefined,
    userId: string,
    payload: AdminResetUserPasswordPayload,
  ) {
    await this.requireSession(authorization);
    const input = requirePayload(payload);
    assertAllowedKeys(input, new Set(["password"]));
    const user = await this.getUserOrThrow(userId);
    const passwordHash = await hashPassword(requirePassword(input.password));
    await this.commitCredentialChange(user, passwordHash);
    await this.authSessionService
      .revokeUserSessions(this.tenantId, user.id)
      .catch(() => undefined);
    return { reauthenticationRequired: true, success: true } as const;
  }

  /**
   * Updates a user's preferred language within the supported language set.
   */
  async updatePreferredLanguage(
    authorization: string | undefined,
    payload: UpdatePreferredLanguagePayload,
  ) {
    return this.updateRuntimePreferences(authorization, payload);
  }

  async updateRuntimePreferences(
    authorization: string | undefined,
    payload: UpdateRuntimePreferencesPayload,
  ) {
    const session = await this.requireSession(authorization);
    const input = requirePayload(payload);
    const user = await this.getUserOrThrow(session.userId);
    if (
      input.preferredLanguage === undefined &&
      input.timeZone === undefined
    ) {
      throw new BadRequestException("至少需要提供一项偏好设置");
    }
    if (input.preferredLanguage !== undefined) {
      user.preferredLanguage = normalizePreferredLanguage(
        input.preferredLanguage,
      );
    }
    if (input.timeZone !== undefined) {
      user.timeZone = normalizeTimeZone(input.timeZone);
    }
    user.updatedAt = new Date();
    return toUserDto(await this.users.save(user));
  }

  private async applyUserPatch(
    user: User,
    payload: UpdateManagedUserPayload,
  ) {
    const wasActive = user.status === "active";
    if (payload.displayName !== undefined) {
      const displayName = requireText(payload.displayName, "显示名称");
      user.displayName = displayName;
      user.nickname = displayName;
    }
    if (payload.firstName !== undefined) {
      user.firstName = normalizeNullableText(payload.firstName);
    }
    if (payload.lastName !== undefined) {
      user.lastName = normalizeNullableText(payload.lastName);
    }
    if (payload.imageUrl !== undefined) {
      user.imageUrl = normalizeNullableText(payload.imageUrl);
      user.avatarUrl = user.imageUrl;
    }
    if (payload.mobile !== undefined) {
      user.mobile = normalizeNullableText(payload.mobile);
    }
    if (payload.username !== undefined) {
      user.username = normalizeNullableText(payload.username);
    }
    if (payload.status !== undefined) {
      user.status = normalizeUserStatus(payload.status);
    }

    user.updatedAt = new Date();
    const shouldRevokeAccess = wasActive && user.status !== "active";
    if (shouldRevokeAccess) {
      await this.assertTenantOwnerContinuity(user.id, false);
    }
    try {
      const manager = this.tenantContext.current()!.manager;
      const saved = await manager.save(User, user);
      if (shouldRevokeAccess) {
        await manager.update(
          IntegrationToken,
          { ownerUserId: user.id, revokedAt: IsNull(), tenantId: this.tenantId },
          { revokedAt: new Date() },
        );
      }
      if (shouldRevokeAccess) {
        await this.authSessionService.revokeUserSessions(this.tenantId, user.id);
      }
      return toUserDto(saved);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new BadRequestException("邮箱已被使用");
      }
      throw error;
    }
  }

  private async commitCredentialChange(user: User, passwordHash: string) {
    const now = new Date();
    const result = await this.tenantContext.current()!.manager
      .createQueryBuilder()
      .update(User)
      .set({
        credentialVersion: () => `"credential_version" + 1`,
        credentialsChangedAt: now,
        passwordHash,
        updatedAt: now,
      })
      .where("id = :id AND tenant_id = :tenantId", {
        id: user.id,
        tenantId: this.tenantId,
      })
      .execute();
    if (!result.affected) throw new NotFoundException("用户不存在");
  }

  private async requireSession(authorization: string | undefined) {
    const token = authorization?.replace(/^Bearer\s+/i, "").trim();
    try {
      const session = await this.authSessionService.validateAccessToken(token);
      const tenantId = session.tenantId?.trim();
      if (!tenantId || tenantId !== this.tenantId) throw new Error();
      return { tenantId, userId: session.userId };
    } catch {
      throw new UnauthorizedException("登录已失效，请重新登录");
    }
  }

  private async getUserOrThrow(userId: string) {
    const user = await this.users.findOne({
      where: { id: userId, tenantId: this.tenantId },
    });
    if (!user) throw new NotFoundException("用户不存在");
    return user;
  }

  private async assertUniqueEmail(email: string, exceptUserId?: string) {
    const existing = await this.users.findOne({
      where: { email, tenantId: this.tenantId },
    });
    if (existing && existing.id !== exceptUserId) {
      throw new BadRequestException("邮箱已被使用");
    }
  }

  private async withTenantRoles(users: User[]) {
    if (users.length === 0) return [];
    const assignments = await this.tenantContext.current()!.manager.find(
      UserTenantRole,
      {
        relations: { role: true },
        where: {
          tenantId: this.tenantId,
          userId: In(users.map((user) => user.id)),
        },
      },
    );
    const byUser = new Map<string, Role>();
    for (const assignment of assignments) {
      if (!assignment.role) continue;
      byUser.set(assignment.userId, assignment.role);
    }
    return users.map((user) => toUserDto(user, byUser.get(user.id) ?? null));
  }

  private async assertCanGrantTenantRole(
    actorUserId: string,
    targetRole: Role,
    targetUserId?: string,
  ) {
    const assignments = await this.tenantContext.current()!.manager.find(
      UserTenantRole,
      {
        relations: { role: { rolePermissions: true } },
        where: { tenantId: this.tenantId, userId: actorUserId },
      },
    );
    const roles = assignments.map((assignment) => assignment.role).filter(Boolean);
    this.grantPolicy.assertCanGrant({
      actor: {
        principalType: "tenant",
        tenantId: this.tenantId,
        userId: actorUserId,
      },
      actorPermissionCodes: [
        ...new Set(
          roles.flatMap((role) =>
            (role.rolePermissions ?? [])
              .filter((permission) => permission.enabled)
              .map((permission) => permission.permission),
          ),
        ),
      ],
      actorRoleNames: roles.map((role) => role.name),
      scope: "tenant",
      targetRole: {
        id: targetRole.id,
        name: targetRole.name,
        permissionCodes: (targetRole.rolePermissions ?? [])
          .filter((permission) => permission.enabled)
          .map((permission) => permission.permission),
      },
      targetUserId,
    });
  }

  private async assertTenantOwnerContinuity(
    targetUserId: string,
    targetRemainsOwner: boolean,
  ) {
    if (targetRemainsOwner) return;
    const manager = this.tenantContext.current()!.manager;
    const assignments = await manager.find(UserTenantRole, {
      relations: { role: true },
      where: { tenantId: this.tenantId, userId: targetUserId },
    });
    if (
      !assignments.some(
        (assignment) => assignment.role?.name === "tenant-owner",
      )
    ) {
      return;
    }
    if (typeof manager.query !== "function") {
      throw new BadRequestException("工作空间必须至少保留一个有效 Tenant Owner");
    }
    const rows = (await manager.query(
      `SELECT u.id
         FROM users u
         JOIN user_tenant_roles utr
           ON utr.tenant_id = u.tenant_id AND utr.user_id = u.id
         JOIN roles r
           ON r.tenant_id = utr.tenant_id AND r.id = utr.role_id
        WHERE u.tenant_id = $1
          AND u.status = 'active'
          AND u.deleted_at IS NULL
          AND r.name = 'tenant-owner'
          AND r.scope = 'tenant'
        FOR UPDATE OF u, utr`,
      [this.tenantId],
    )) as Array<{ id: string }>;
    if (
      rows.some((row) => row.id === targetUserId) &&
      rows.filter((row) => row.id !== targetUserId).length === 0
    ) {
      throw new BadRequestException({
        code: "OWNER_CONTINUITY_REQUIRED",
        message: "工作空间必须至少保留一个有效 Tenant Owner",
        statusCode: 400,
      });
    }
  }

  private get tenantId() {
    return this.tenantContext.current()!.tenantId;
  }

  private get users() {
    return this.tenantContext.repository(User);
  }
}

const SELF_PROFILE_KEYS = new Set([
  "displayName",
  "firstName",
  "imageUrl",
  "lastName",
  "mobile",
  "username",
]);
const MANAGED_PROFILE_KEYS = new Set([...SELF_PROFILE_KEYS, "status"]);

function assertAllowedKeys(value: object, allowed: ReadonlySet<string>) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) {
    throw new BadRequestException(`不允许的字段: ${unknown.join(", ")}`);
  }
}

function requirePayload<T extends object>(value: T): T {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException("请求内容无效");
  }
  return value;
}

function normalizeEmail(value: unknown) {
  const email = requireText(value, "邮箱").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new BadRequestException("邮箱格式不正确");
  }
  return email;
}

function requireText(value: unknown, label: string) {
  if (value === undefined || value === null) {
    throw new BadRequestException(`${label}不能为空`);
  }
  if (typeof value !== "string") {
    throw new BadRequestException(`${label}无效`);
  }
  const text = value.trim();
  if (!text) throw new BadRequestException(`${label}不能为空`);
  return text;
}

function normalizeOptionalText(value: unknown) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new BadRequestException("文本字段无效");
  }
  const text = value.trim();
  return text || null;
}

function normalizeNullableText(value: unknown) {
  return value === null ? null : normalizeOptionalText(value);
}

function requirePassword(value: unknown) {
  const password = requireText(value, "密码");
  if (password.length < 8) throw new BadRequestException("密码至少需要 8 位");
  return password;
}

function normalizePreferredLanguage(value: unknown) {
  if (value === null) return null;
  const language = normalizeCanonicalLanguage(requireText(value, "首选语言"));
  if (!language) throw new BadRequestException("不支持的语言");
  return language;
}

function normalizeTimeZone(value: unknown) {
  if (value === null) return null;
  const timeZone = requireText(value, "时区");
  try {
    new Intl.DateTimeFormat("en", { timeZone }).format();
    return timeZone;
  } catch {
    throw new BadRequestException("不支持的时区");
  }
}

function normalizeUserStatus(value: unknown): UserStatus {
  if (value === "active" || value === "disabled") return value;
  throw new BadRequestException("用户状态无效");
}

function isUniqueConstraintError(error: unknown) {
  const typed = error as { code?: string; driverError?: { code?: string } };
  return typed.code === "23505" || typed.driverError?.code === "23505";
}
