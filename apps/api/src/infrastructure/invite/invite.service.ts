import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import {
  Invite,
  Organization,
  PLATFORM_SETTING_KEYS,
  Role,
  RolePermission,
  Tenant,
  User,
  UserOrganization,
  UserOrganizationRole,
  UserTenantRole,
  type InviteStatus,
} from "@hermes-swarm/core";
import jwt from "jsonwebtoken";
import { DataSource, In, IsNull, QueryFailedError, type EntityManager } from "typeorm";
import type {
  AcceptInvitePayload,
  CreateInvitePayload,
  InviteDto,
} from "../../common/admin-api.types.js";
import { TenantContextService } from "../../common/database/tenant-context.service.js";
import { hashPassword } from "../../common/security/password-hash.js";
import { EmailSendService } from "../mail/email-send.service.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { SettingsService } from "../settings/settings.service.js";
import { RoleGrantPolicyService } from "@hermes-swarm/rbac";

const ORGANIZATION_MEMBER_CREATE_PERMISSION =
  "user.organization_member.create:organization";
type InviteExpiry = "3d" | "7d" | "never";

@Injectable()
export class InviteService {
  private readonly logger = new Logger(InviteService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly tenantContext: TenantContextService,
    private readonly emailSendService: EmailSendService,
    private readonly notificationsService: NotificationsService,
    private readonly settingsService: SettingsService,
    private readonly grantPolicy: RoleGrantPolicyService =
      new RoleGrantPolicyService(),
  ) {}

  async list(): Promise<InviteDto[]> {
    const invites = await this.invites.find({
      order: { createdAt: "DESC" },
      relations: { invitedBy: true },
      where: { tenantId: this.tenantId },
    });
    return Promise.all(invites.map((invite) => this.toDto(invite)));
  }

  async create(invitedById: string, payload: CreateInvitePayload): Promise<InviteDto> {
    const input = parseCreatePayload(payload);
    const assignments = await this.validateAssignments(
      input.workspaceRoleId,
      input.organizations,
    );
    await this.assertInviterCanAssignOrganizations(invitedById, assignments);
    await this.assertInviterCanGrantRoles(
      this.manager,
      invitedById,
      input.workspaceRoleId,
      assignments,
    );
    const existing = await this.invites.findOne({
      where: { email: input.email, status: "invited", tenantId: this.tenantId },
    });
    if (existing && deriveInviteStatus(existing) === "invited") {
      throw new ConflictException("该邮箱已有待处理邀请");
    }

    const invite = this.invites.create({
      acceptedCount: 0,
      acceptedUserId: null,
      actionDate: null,
      closedAt: null,
      email: input.email,
      expireDate: computeExpireDate(input.expiresIn),
      invitedById,
      organizationAssignments: assignments,
      status: "invited",
      tenantId: this.tenantId,
      workspaceRoleId: input.workspaceRoleId,
      token: signInviteToken(input.email, this.tenantId, input.expiresIn),
    });
    let saved: Invite;
    try {
      saved = await this.invites.save(invite);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException("该邮箱已有待处理邀请");
      }
      throw error;
    }
    await this.notifyInvitee(saved);
    return this.toDto(saved);
  }

  async resend(inviteId: string, invitedById: string): Promise<InviteDto> {
    const invite = await this.manager.transaction(async (manager) => {
      const locked = await manager.findOne(Invite, {
        lock: { mode: "pessimistic_write" },
        where: { id: inviteId, tenantId: this.tenantId },
      });
      if (!locked) throw new NotFoundException("邀请不存在");
      if (deriveInviteStatus(locked) === "accepted") {
        throw new BadRequestException("已接受的邀请不能重发");
      }
      const expiresIn: InviteExpiry = locked.expireDate === null ? "never" : "3d";
      locked.actionDate = null;
      locked.closedAt = null;
      locked.expireDate = computeExpireDate(expiresIn);
      locked.invitedById = invitedById;
      locked.status = "invited";
      if (!locked.email) throw new BadRequestException("邀请缺少邮箱");
      locked.token = signInviteToken(locked.email, locked.tenantId, expiresIn);
      return manager.save(Invite, locked);
    });
    await this.notifyInvitee(invite);
    return this.toDto(invite);
  }

  async revoke(inviteId: string): Promise<void> {
    await this.manager.transaction(async (manager) => {
      const invite = await manager.findOne(Invite, {
        lock: { mode: "pessimistic_write" },
        where: { id: inviteId, tenantId: this.tenantId },
      });
      if (!invite) throw new NotFoundException("邀请不存在");
      if (deriveInviteStatus(invite) === "accepted") {
        throw new BadRequestException("已接受的邀请不能撤销");
      }
      if (invite.status === "revoked") return;
      invite.actionDate = new Date();
      invite.closedAt = new Date();
      invite.status = "revoked";
      await manager.save(Invite, invite);
    });
  }

  async validateByToken(email?: string, token?: string): Promise<InviteDto> {
    const decoded = verifyInviteToken(token);
    return this.runInTenant(decoded.tenantId, async () => {
      const invite = await this.getActiveInvite(email, token);
      return this.toDto(invite);
    });
  }

  async accept(payload: AcceptInvitePayload): Promise<InviteDto> {
    const decoded = verifyInviteToken(payload?.token);
    return this.runInTenant(decoded.tenantId, async () => {
      const invite = await this.getActiveInvite(payload.email, payload.token);
      if (payload.action === "decline") return this.decline(invite);
      return this.acceptInTransaction(invite, payload);
    });
  }

  private async acceptInTransaction(
    invite: Invite,
    payload: AcceptInvitePayload,
  ): Promise<InviteDto> {
    let acceptedUser!: User;
    let savedInvite!: Invite;
    try {
      await this.manager.transaction(async (manager) => {
        const locked = await manager.findOne(Invite, {
          lock: { mode: "pessimistic_write" },
          where: { id: invite.id, tenantId: this.tenantId },
        });
        if (!locked || deriveInviteStatus(locked) !== "invited" || !locked.email) {
          throw new BadRequestException("邀请链接无效或已过期");
        }
        await this.validateAssignmentsWithManager(
          manager,
          locked.workspaceRoleId,
          locked.organizationAssignments,
        );
        if (!locked.invitedById) {
          throw new BadRequestException("邀请缺少有效的授权主体");
        }
        await this.assertInviterCanGrantRoles(
          manager,
          locked.invitedById,
          locked.workspaceRoleId,
          locked.organizationAssignments,
        );

        acceptedUser =
          (await manager.findOne(User, {
            where: { email: locked.email, tenantId: this.tenantId },
          })) ??
          (await manager.save(
            User,
            manager.create(User, {
              displayName: requireText(payload.displayName, "用户名称"),
              email: locked.email,
              emailVerified: true,
              nickname: requireText(payload.displayName, "用户名称"),
              passwordHash: await hashPassword(requirePassword(payload.password)),
              preferredLanguage: null,
              status: "active",
              tenantId: this.tenantId,
              type: "user",
            }),
          ));

        if (acceptedUser.status !== "active") {
          throw new BadRequestException("账号不可用");
        }
        await this.assignTenantRole(manager, acceptedUser.id, locked.workspaceRoleId);
        await this.assignOrganizations(
          manager,
          acceptedUser,
          locked.organizationAssignments,
        );

        locked.acceptedCount += 1;
        locked.acceptedUserId = acceptedUser.id;
        locked.actionDate = new Date();
        locked.status = "accepted";
        savedInvite = await manager.save(Invite, locked);
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException("邀请分配与现有账号状态冲突");
      }
      throw error;
    }

    await this.notificationsService
      .createForUser({
        actorUserId: savedInvite.invitedById,
        body: "你已加入当前工作空间。",
        kind: "success",
        payload: { inviteId: savedInvite.id },
        recipientUserId: acceptedUser.id,
        sourceId: savedInvite.id,
        sourceType: "workspace-invite",
        title: "工作空间邀请已接受",
      })
      .catch((error) => this.logger.warn(`invite notification failed: ${String(error)}`));
    return this.toDto(savedInvite);
  }

  private async decline(invite: Invite): Promise<InviteDto> {
    invite.actionDate = new Date();
    invite.status = "declined";
    return this.toDto(await this.invites.save(invite));
  }

  private async assignTenantRole(
    manager: EntityManager,
    userId: string,
    roleId: string,
  ) {
    await manager.delete(UserTenantRole, { tenantId: this.tenantId, userId });
    await manager
      .createQueryBuilder()
      .insert()
      .into(UserTenantRole)
      .values({ roleId, tenantId: this.tenantId, userId })
      .execute();
  }

  private async assignOrganizations(
    manager: EntityManager,
    user: User,
    assignments: Invite["organizationAssignments"],
  ) {
    const defaultAssignment = assignments.find((assignment) => assignment.isDefault);
    if (defaultAssignment) {
      await manager.update(
        UserOrganization,
        { tenantId: this.tenantId, userId: user.id },
        { isDefault: false },
      );
    }
    for (const assignment of assignments) {
      let membership = await manager.findOne(UserOrganization, {
        where: {
          organizationId: assignment.organizationId,
          tenantId: this.tenantId,
          userId: user.id,
        },
      });
      membership ??= manager.create(UserOrganization, {
        organizationId: assignment.organizationId,
        tenantId: this.tenantId,
        userId: user.id,
      });
      Object.assign(membership, {
        displayName: membership.displayName ?? user.displayName,
        isDefault: Boolean(assignment.isDefault),
        joinedAt: membership.joinedAt ?? new Date(),
        status: "active",
      });
      membership = await manager.save(UserOrganization, membership);
      await manager.delete(UserOrganizationRole, {
        membershipId: membership.id,
        tenantId: this.tenantId,
      });
      await manager.insert(UserOrganizationRole, {
        membershipId: membership.id,
        organizationId: assignment.organizationId,
        roleId: assignment.roleId,
        tenantId: this.tenantId,
      });
    }
  }

  private validateAssignments(
    workspaceRoleId: string,
    assignments: Invite["organizationAssignments"],
  ) {
    return this.validateAssignmentsWithManager(this.manager, workspaceRoleId, assignments);
  }

  private async validateAssignmentsWithManager(
    manager: EntityManager,
    workspaceRoleId: string,
    assignments: Invite["organizationAssignments"],
  ) {
    if (assignments.filter((assignment) => assignment.isDefault).length > 1) {
      throw new BadRequestException("只能指定一个默认组织");
    }
    const organizationIds = assignments.map((assignment) => assignment.organizationId);
    if (new Set(organizationIds).size !== organizationIds.length) {
      throw new BadRequestException("组织分配不能重复");
    }
    if (organizationIds.length > 0) {
      const organizations = await manager.find(Organization, {
        where: { id: In(organizationIds), status: "active", tenantId: this.tenantId },
      });
      if (organizations.length !== organizationIds.length) {
        throw new BadRequestException("邀请包含无效组织");
      }
    }
    await this.requireWorkspaceRole(manager, workspaceRoleId);
    for (const assignment of assignments) {
      const role = await manager.findOne(Role, {
        where: {
          id: assignment.roleId,
          organizationId: assignment.organizationId,
          scope: "organization",
          tenantId: this.tenantId,
        },
      });
      if (!role) throw new BadRequestException("邀请包含无效组织角色");
    }
    return assignments;
  }

  private async requireWorkspaceRole(manager: EntityManager, roleId: string) {
    const role = await manager.findOne(Role, {
      where: { id: roleId, organizationId: IsNull(), scope: "tenant", tenantId: this.tenantId },
    });
    if (!role) throw new BadRequestException("邀请包含无效工作空间角色");
  }

  private async assertInviterCanAssignOrganizations(
    invitedById: string,
    assignments: Invite["organizationAssignments"],
  ) {
    for (const assignment of assignments) {
      const membership = await this.manager.findOne(UserOrganization, {
        where: {
          organizationId: assignment.organizationId,
          status: "active",
          tenantId: this.tenantId,
          userId: invitedById,
        },
      });
      if (!membership) {
        throw new BadRequestException("没有目标组织的成员管理权限");
      }
      const roleAssignment = await this.manager.findOne(UserOrganizationRole, {
        where: {
          membershipId: membership.id,
          organizationId: assignment.organizationId,
          tenantId: this.tenantId,
        },
      });
      const allowed = roleAssignment
        ? await this.manager.findOne(RolePermission, {
            where: {
              enabled: true,
              permission: ORGANIZATION_MEMBER_CREATE_PERMISSION,
              roleId: roleAssignment.roleId,
              tenantId: this.tenantId,
            },
          })
        : null;
      if (!allowed) {
        throw new BadRequestException("没有目标组织的成员管理权限");
      }
    }
  }

  private async assertInviterCanGrantRoles(
    manager: EntityManager,
    actorUserId: string,
    workspaceRoleId: string,
    assignments: Invite["organizationAssignments"],
  ) {
    const actorTenantAssignments = await manager.find(UserTenantRole, {
      relations: { role: { rolePermissions: true } },
      where: { tenantId: this.tenantId, userId: actorUserId },
    });
    const actorTenantRoles = actorTenantAssignments
      .map((assignment) => assignment.role)
      .filter(Boolean);
    const workspaceRole = await manager.findOne(Role, {
      relations: { rolePermissions: true },
      where: {
        id: workspaceRoleId,
        organizationId: IsNull(),
        scope: "tenant",
        tenantId: this.tenantId,
      },
    });
    if (!workspaceRole) throw new BadRequestException("邀请包含无效工作空间角色");
    this.grantPolicy.assertCanGrant({
      actor: {
        principalType: "tenant",
        tenantId: this.tenantId,
        userId: actorUserId,
      },
      actorPermissionCodes: actorTenantRoles.flatMap((role) =>
        (role.rolePermissions ?? [])
          .filter((permission) => permission.enabled)
          .map((permission) => permission.permission),
      ),
      actorRoleNames: actorTenantRoles.map((role) => role.name),
      scope: "tenant",
      targetRole: {
        id: workspaceRole.id,
        name: workspaceRole.name,
        permissionCodes: (workspaceRole.rolePermissions ?? [])
          .filter((permission) => permission.enabled)
          .map((permission) => permission.permission),
      },
    });

    for (const assignment of assignments) {
      const actorMembership = await manager.findOne(UserOrganization, {
        where: {
          organizationId: assignment.organizationId,
          status: "active",
          tenantId: this.tenantId,
          userId: actorUserId,
        },
      });
      const actorRoleAssignment = actorMembership
        ? await manager.findOne(UserOrganizationRole, {
            relations: { role: { rolePermissions: true } },
            where: {
              membershipId: actorMembership.id,
              tenantId: this.tenantId,
            },
          })
        : null;
      const targetRole = await manager.findOne(Role, {
        relations: { rolePermissions: true },
        where: {
          id: assignment.roleId,
          organizationId: assignment.organizationId,
          scope: "organization",
          tenantId: this.tenantId,
        },
      });
      if (!targetRole) throw new BadRequestException("邀请包含无效组织角色");
      this.grantPolicy.assertCanGrant({
        actor: {
          principalType: "tenant",
          tenantId: this.tenantId,
          userId: actorUserId,
        },
        actorPermissionCodes: (actorRoleAssignment?.role?.rolePermissions ?? [])
          .filter((permission) => permission.enabled)
          .map((permission) => permission.permission),
        actorRoleNames: actorRoleAssignment?.role
          ? [actorRoleAssignment.role.name]
          : [],
        scope: "organization",
        targetRole: {
          id: targetRole.id,
          name: targetRole.name,
          permissionCodes: (targetRole.rolePermissions ?? [])
            .filter((permission) => permission.enabled)
            .map((permission) => permission.permission),
        },
      });
    }
  }

  private async getActiveInvite(email?: string, token?: string) {
    const decoded = verifyInviteToken(token);
    const normalizedEmail = normalizeEmail(email ?? decoded.email);
    if (!normalizedEmail || normalizedEmail !== decoded.email) {
      throw new BadRequestException("邮箱与邀请不匹配");
    }
    const invite = await this.invites.findOne({
      where: { tenantId: this.tenantId, token },
    });
    if (
      !invite ||
      invite.email !== normalizedEmail ||
      deriveInviteStatus(invite) !== "invited"
    ) {
      throw new BadRequestException("邀请链接无效或已过期");
    }
    return invite;
  }

  private async notifyInvitee(invite: Invite) {
    if (!invite.email) return;
    try {
      await this.emailSendService.send({
        email: invite.email,
        locals: {
          email: invite.email,
          expiresAt: invite.expireDate?.toISOString() ?? "永久有效",
          inviteLink: await this.buildInviteLink(invite),
          organizationNames: await this.resolveOrganizationNames(invite),
        },
        templateName: "organization-invite",
      });
    } catch (error) {
      this.logger.warn(`invite email failed for ${invite.id}: ${String(error)}`);
    }
  }

  private async resolveOrganizationNames(invite: Invite) {
    const ids = invite.organizationAssignments.map((assignment) => assignment.organizationId);
    if (ids.length === 0) return [];
    return (
      await this.organizations.find({
        select: { name: true },
        where: { id: In(ids), tenantId: this.tenantId },
      })
    ).map((organization) => organization.name);
  }

  private async buildInviteLink(invite: Invite) {
    const baseUrl = await this.settingsService.getPlatformValue(
      PLATFORM_SETTING_KEYS.publicBaseUrl,
      "http://localhost:3100",
    );
    const tenant = await this.manager.findOne(Tenant, {
      where: { id: invite.tenantId },
    });
    const url = new URL("/invite", baseUrl ?? "http://localhost:3100");
    url.searchParams.set("email", invite.email ?? "");
    url.searchParams.set("token", invite.token);
    if (tenant?.slug) url.searchParams.set("workspace", tenant.slug);
    return url.toString();
  }

  private async toDto(invite: Invite): Promise<InviteDto> {
    const invitedBy =
      invite.invitedBy ??
      (invite.invitedById
        ? await this.users.findOne({
            where: { id: invite.invitedById, tenantId: this.tenantId },
          })
        : null);
    return {
      acceptedCount: invite.acceptedCount,
      acceptedUserId: invite.acceptedUserId,
      actionDate: invite.actionDate,
      closedAt: invite.closedAt,
      createdAt: invite.createdAt,
      email: invite.email,
      existingUser: Boolean(
        invite.email &&
          (await this.users.findOne({
            select: { id: true },
            where: { email: invite.email, tenantId: this.tenantId },
          })),
      ),
      expireDate: invite.expireDate,
      id: invite.id,
      invitedBy: invitedBy
        ? {
            avatarUrl: invitedBy.avatarUrl,
            displayName: invitedBy.displayName,
            email: invitedBy.email,
            id: invitedBy.id,
            imageUrl: invitedBy.imageUrl,
            username: invitedBy.username,
          }
        : null,
      invitedById: invite.invitedById,
      link: await this.buildInviteLink(invite),
      organizationAssignments: invite.organizationAssignments,
      status: deriveInviteStatus(invite),
      workspaceRoleId: invite.workspaceRoleId,
    };
  }

  private runInTenant<T>(tenantId: string, work: () => Promise<T>) {
    const current = this.tenantContext.current(false);
    if (current) {
      if (current.tenantId !== tenantId) {
        throw new BadRequestException("邀请链接无效或已过期");
      }
      return work();
    }
    return this.dataSource.transaction(async (manager) => {
      await manager.query(
        "SELECT set_config('app.tenant_id', $1, true), set_config('app.scope_level', 'tenant', true), set_config('app.organization_id', '', true)",
        [tenantId],
      );
      return this.tenantContext.run(
        { manager, organizationId: null, scopeLevel: "tenant", tenantId },
        work,
      );
    });
  }

  private get tenantId() {
    return this.tenantContext.current()!.tenantId;
  }

  private get manager() {
    return this.tenantContext.current()!.manager;
  }

  private get invites() {
    return this.tenantContext.repository(Invite);
  }

  private get users() {
    return this.tenantContext.repository(User);
  }

  private get organizations() {
    return this.tenantContext.repository(Organization);
  }
}

function parseCreatePayload(payload: CreateInvitePayload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new BadRequestException("请求内容无效");
  }
  const organizations = Array.isArray(payload.organizations)
    ? payload.organizations.map((assignment) => ({
        isDefault: Boolean(assignment?.isDefault),
        organizationId: requireText(assignment?.organizationId, "组织"),
        roleId: requireText(assignment?.roleId, "组织角色"),
      }))
    : [];
  return {
    email: requireEmail(payload.email),
    expiresIn: normalizeExpiry(payload.expiresIn),
    organizations,
    workspaceRoleId: requireText(payload.workspaceRoleId, "工作空间角色"),
  };
}

function normalizeExpiry(value: unknown): InviteExpiry {
  if (value === undefined || value === null || value === "3d") return "3d";
  if (value === "7d" || value === "never") return value;
  throw new BadRequestException("邀请有效期无效");
}

function computeExpireDate(expiresIn: InviteExpiry) {
  if (expiresIn === "never") return null;
  return new Date(Date.now() + (expiresIn === "7d" ? 7 : 3) * 24 * 60 * 60 * 1000);
}

function signInviteToken(email: string, tenantId: string, expiresIn: InviteExpiry) {
  const payload = { email, nonce: randomUUID(), tenantId };
  return expiresIn === "never"
    ? jwt.sign(payload, getInviteTokenSecret())
    : jwt.sign(payload, getInviteTokenSecret(), { expiresIn });
}

function verifyInviteToken(token?: string) {
  if (!token) throw new BadRequestException("令牌不能为空");
  try {
    const decoded = jwt.verify(token, getInviteTokenSecret()) as {
      email?: string;
      tenantId?: string;
    };
    if (!decoded.tenantId || !decoded.email) throw new Error("invalid");
    return { email: requireEmail(decoded.email), tenantId: decoded.tenantId };
  } catch {
    throw new BadRequestException("邀请链接无效或已过期");
  }
}

function getInviteTokenSecret() {
  const secret =
    process.env.INVITE_TOKEN_SECRET ??
    (process.env.NODE_ENV === "production"
      ? undefined
      : process.env.INVITE_JWT_SECRET ??
        process.env.JWT_SECRET ??
        "dev-invite-secret");
  if (!secret) throw new Error("INVITE_TOKEN_SECRET is required in production");
  return secret;
}

function deriveInviteStatus(invite: Invite): InviteStatus {
  if (invite.status !== "invited") return invite.status;
  if (invite.closedAt) return "revoked";
  return invite.expireDate && invite.expireDate.getTime() < Date.now()
    ? "expired"
    : "invited";
}

function requireEmail(value: unknown) {
  const email = normalizeEmail(value);
  if (!email) throw new BadRequestException("邮箱不能为空");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new BadRequestException("邮箱格式不正确");
  }
  return email;
}

function normalizeEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() || null : null;
}

function requireText(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new BadRequestException(`${label}不能为空`);
  }
  return value.trim();
}

function requirePassword(value: unknown) {
  const password = requireText(value, "密码");
  if (password.length < 8) throw new BadRequestException("密码至少需要 8 位");
  return password;
}

function isUniqueConstraintError(error: unknown) {
  if (!(error instanceof QueryFailedError)) return false;
  return (error.driverError as { code?: string } | undefined)?.code === "23505";
}
