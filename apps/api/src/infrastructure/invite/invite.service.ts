import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import {
  Account,
  Invite,
  PLATFORM_SETTING_KEYS,
  PlatformMembership,
  Role,
  Workspace,
  WorkspaceMembership,
  type InviteStatus,
} from "@hermes-swarm/core";
import jwt from "jsonwebtoken";
import { DataSource, IsNull, QueryFailedError, type EntityManager } from "typeorm";
import type {
  AcceptInvitePayload,
  CreateInvitePayload,
  InviteDto,
} from "../../common/admin-api.types.js";
import { WorkspaceContextService } from "../../common/database/workspace-context.service.js";
import { hashPassword } from "../../common/security/password-hash.js";
import { EmailSendService } from "../mail/email-send.service.js";
import { PlatformEmailSendService } from "../mail/platform-email-send.service.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { SettingsService } from "../settings/settings.service.js";
import { RoleGrantPolicyService } from "@hermes-swarm/rbac";
import { PLATFORM_DATA_SOURCE } from "../../common/database/database.constants.js";
import { AuthSessionService } from "../auth/auth-session.service.js";

type InviteExpiry = "3d" | "7d" | "never";
type PlatformInvitePayload = {
  email: string;
  expiresIn?: InviteExpiry;
  roleId: string;
};

@Injectable()
export class InviteService {
  private readonly logger = new Logger(InviteService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly workspaceContext: WorkspaceContextService,
    private readonly emailSendService: EmailSendService,
    private readonly notificationsService: NotificationsService,
    private readonly settingsService: SettingsService,
    private readonly grantPolicy: RoleGrantPolicyService =
      new RoleGrantPolicyService(),
    @Optional()
    @InjectDataSource(PLATFORM_DATA_SOURCE)
    private readonly injectedPlatformDataSource?: DataSource,
    @Optional()
    private readonly authSessionService?: AuthSessionService,
    @Optional()
    private readonly platformEmailSendService?: PlatformEmailSendService,
  ) {}

  private get platformDataSource() {
    return this.injectedPlatformDataSource ?? this.dataSource;
  }

  async list(): Promise<InviteDto[]> {
    const invites = await this.invites.find({
      order: { createdAt: "DESC" },
      relations: { invitedBy: true },
      where: { workspaceId: this.workspaceId },
    });
    return Promise.all(invites.map((invite) => this.toDto(invite)));
  }

  async create(invitedById: string, payload: CreateInvitePayload): Promise<InviteDto> {
    const input = parseCreatePayload(payload);
    await this.requireWorkspaceRole(this.manager, input.workspaceRoleId);
    const accountRepository = this.platformDataSource.getRepository?.(Account);
    const existingAccount = accountRepository
      ? await accountRepository.findOne({ where: { email: input.email } })
      : null;
    if (existingAccount) {
      const membershipRepository =
        this.platformDataSource.getRepository?.(WorkspaceMembership);
      const membership = membershipRepository
        ? await membershipRepository.findOne({
          where: {
            accountId: existingAccount.id,
            workspaceId: this.workspaceId,
          },
        })
        : null;
      if (membership && membership.status !== "removed") {
        throw new ConflictException("该账号已经是当前工作空间成员");
      }
    }
    await this.assertInviterCanGrantRoles(
      this.manager,
      invitedById,
      input.workspaceRoleId,
    );
    const existing = await this.invites.findOne({
      where: { email: input.email, status: "invited", workspaceId: this.workspaceId },
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
      contextType: "workspace",
      expireDate: computeExpireDate(input.expiresIn),
      invitedById,
      status: "invited",
      workspaceId: this.workspaceId,
      workspaceRoleId: input.workspaceRoleId,
      token: signInviteToken(
        input.email,
        { contextType: "workspace", workspaceId: this.workspaceId },
        input.expiresIn,
      ),
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

  async createPlatform(
    invitedById: string | null,
    payload: PlatformInvitePayload,
  ): Promise<InviteDto> {
    const email = requireEmail(payload.email);
    const expiresIn = normalizeExpiry(payload.expiresIn);
    const roleId = requireText(payload.roleId, "平台角色");
    const role = await this.platformDataSource.getRepository(Role).findOne({
      where: { id: roleId, scope: "platform", workspaceId: IsNull() },
    });
    if (!role) throw new BadRequestException("邀请包含无效平台角色");
    if (await this.platformDataSource.getRepository(Account).findOne({ where: { email } })) {
      throw new ConflictException("该邮箱已经注册，请直接授予平台访问权限");
    }
    const repository = this.platformDataSource.getRepository(Invite);
    const pending = await repository.findOne({
      where: { contextType: "platform", email, status: "invited" },
    });
    if (pending && deriveInviteStatus(pending) === "invited") {
      throw new ConflictException("该邮箱已有待处理平台邀请");
    }
    const invite = repository.create({
      acceptedCount: 0,
      acceptedUserId: null,
      actionDate: null,
      closedAt: null,
      contextType: "platform",
      email,
      expireDate: computeExpireDate(expiresIn),
      invitedById,
      roleId,
      status: "invited",
      token: signInviteToken(email, { contextType: "platform" }, expiresIn),
      workspaceId: null,
    });
    const saved = await repository.save(invite);
    await this.notifyInvitee(saved);
    return this.toDto(saved);
  }

  async resend(inviteId: string, invitedById: string): Promise<InviteDto> {
    const invite = await this.manager.transaction(async (manager) => {
      const locked = await manager.findOne(Invite, {
        lock: { mode: "pessimistic_write" },
        where: { id: inviteId, workspaceId: this.workspaceId },
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
      locked.token = signInviteToken(
        locked.email,
        { contextType: "workspace", workspaceId: locked.workspaceId! },
        expiresIn,
      );
      return manager.save(Invite, locked);
    });
    await this.notifyInvitee(invite);
    return this.toDto(invite);
  }

  async revoke(inviteId: string): Promise<void> {
    await this.manager.transaction(async (manager) => {
      const invite = await manager.findOne(Invite, {
        lock: { mode: "pessimistic_write" },
        where: { id: inviteId, workspaceId: this.workspaceId },
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
    if (decoded.contextType === "platform") {
      return this.toDto(await this.getActivePlatformInvite(email, token));
    }
    return this.runInWorkspace(decoded.workspaceId, async () => {
      const invite = await this.getActiveInvite(email, token);
      return this.toDto(invite);
    });
  }

  async accept(
    payload: AcceptInvitePayload,
    authorization?: string,
  ): Promise<InviteDto> {
    const decoded = verifyInviteToken(payload?.token);
    if (decoded.contextType === "platform") {
      const invite = await this.getActivePlatformInvite(payload.email, payload.token);
      if (payload.action === "decline") {
        invite.actionDate = new Date();
        invite.status = "declined";
        return this.toDto(
          await this.platformDataSource.getRepository(Invite).save(invite),
        );
      }
      return this.acceptPlatformInTransaction(invite, payload);
    }
    return this.runInWorkspace(decoded.workspaceId, async () => {
      const invite = await this.getActiveInvite(payload.email, payload.token);
      if (payload.action === "decline") return this.decline(invite);
      return this.acceptInTransaction(invite, payload, authorization);
    });
  }

  private async acceptPlatformInTransaction(
    invite: Invite,
    payload: AcceptInvitePayload,
  ): Promise<InviteDto> {
    let savedInvite!: Invite;
    await this.platformDataSource.transaction(async (manager) => {
      const locked = await manager.findOne(Invite, {
        lock: { mode: "pessimistic_write" },
        where: { contextType: "platform", id: invite.id, workspaceId: IsNull() },
      });
      if (!locked || !locked.email || deriveInviteStatus(locked) !== "invited") {
        throw new BadRequestException("邀请链接无效或已过期");
      }
      const role = await manager.findOne(Role, {
        where: { id: locked.roleId, scope: "platform", workspaceId: IsNull() },
      });
      if (!role) throw new BadRequestException("邀请包含无效平台角色");
      let account = await manager.findOne(Account, { where: { email: locked.email } });
      if (!account) {
        account = await manager.save(
          Account,
          manager.create(Account, {
            displayName: requireText(payload.displayName, "用户名称"),
            email: locked.email,
            emailVerified: true,
            nickname: requireText(payload.displayName, "用户名称"),
            passwordHash: await hashPassword(requirePassword(payload.password)),
            preferredLanguage: null,
            status: "active",
            type: "user",
          }),
        );
      }
      if (account.status !== "active") throw new BadRequestException("账号不可用");
      const existing = await manager.findOne(PlatformMembership, {
        where: { accountId: account.id },
      });
      if (existing && existing.status !== "removed") {
        throw new ConflictException("该账号已经拥有平台访问关系");
      }
      await manager.save(
        PlatformMembership,
        Object.assign(existing ?? manager.create(PlatformMembership), {
          accountId: account.id,
          removedAt: null,
          roleId: role.id,
          status: "active",
        }),
      );
      locked.acceptedCount += 1;
      locked.acceptedUserId = account.id;
      locked.actionDate = new Date();
      locked.status = "accepted";
      savedInvite = await manager.save(Invite, locked);
    });
    return this.toDto(savedInvite);
  }

  private async acceptInTransaction(
    invite: Invite,
    payload: AcceptInvitePayload,
    authorization?: string,
  ): Promise<InviteDto> {
    let acceptedUser!: Account;
    let savedInvite!: Invite;
    try {
      await this.platformDataSource.transaction(async (manager) => {
        const locked = await manager.findOne(Invite, {
          lock: { mode: "pessimistic_write" },
          where: { id: invite.id, workspaceId: this.workspaceId },
        });
        if (!locked || deriveInviteStatus(locked) !== "invited" || !locked.email) {
          throw new BadRequestException("邀请链接无效或已过期");
        }
        await this.requireWorkspaceRole(manager, locked.workspaceRoleId);
        if (!locked.invitedById) {
          throw new BadRequestException("邀请缺少有效的授权主体");
        }
        await this.assertInviterCanGrantRoles(
          manager,
          locked.invitedById,
          locked.workspaceRoleId,
        );

        const existingAccount = await manager.findOne(Account, {
          where: { email: locked.email },
        });
        if (existingAccount) {
          const token = authorization?.replace(/^Bearer\s+/i, "").trim();
          const proof = token
            ? await this.authSessionService?.validateAccessToken(token)
            : null;
          if (
            !proof ||
            proof.principalType !== "workspace" ||
            proof.accountId !== existingAccount.id
          ) {
            throw new BadRequestException({
              code: "ACCOUNT_EXISTS_LOGIN_REQUIRED",
              message: "该邮箱已有账号，请先登录后接受邀请",
              statusCode: 400,
            });
          }
          acceptedUser = existingAccount;
        } else {
          acceptedUser = await manager.save(
            Account,
            manager.create(Account, {
              displayName: requireText(payload.displayName, "用户名称"),
              email: locked.email,
              emailVerified: true,
              nickname: requireText(payload.displayName, "用户名称"),
              passwordHash: await hashPassword(requirePassword(payload.password)),
              preferredLanguage: null,
              status: "active",
              type: "user",
            }),
          );
        }

        if (acceptedUser.status !== "active") {
          throw new BadRequestException("账号不可用");
        }
        await this.assignWorkspaceRole(manager, acceptedUser.id, locked.workspaceRoleId);

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

  private async assignWorkspaceRole(
    manager: EntityManager,
    userId: string,
    roleId: string,
  ) {
    const existing = await manager.findOne(WorkspaceMembership, {
      where: { accountId: userId, workspaceId: this.workspaceId },
    });
    await manager.save(
      WorkspaceMembership,
      Object.assign(existing ?? manager.create(WorkspaceMembership), {
        accountId: userId,
        removedAt: null,
        roleId,
        status: "active",
        workspaceId: this.workspaceId,
      }),
    );
  }

  private async requireWorkspaceRole(manager: EntityManager, roleId: string) {
    const role = await manager.findOne(Role, {
      where: { id: roleId, scope: "workspace", workspaceId: this.workspaceId },
    });
    if (!role) throw new BadRequestException("邀请包含无效工作空间角色");
  }

  private async assertInviterCanGrantRoles(
    manager: EntityManager,
    actorUserId: string,
    workspaceRoleId: string,
  ) {
    const actorWorkspaceAssignments = await manager.find(WorkspaceMembership, {
      relations: { role: { rolePermissions: { permissionRecord: true } } },
      where: {
        accountId: actorUserId,
        status: "active",
        workspaceId: this.workspaceId,
      },
    });
    const actorWorkspaceRoles = actorWorkspaceAssignments
      .map((assignment) => assignment.role)
      .filter((role): role is Role => Boolean(role));
    const workspaceRole = await manager.findOne(Role, {
      relations: { rolePermissions: { permissionRecord: true } },
      where: {
        id: workspaceRoleId,
        scope: "workspace",
        workspaceId: this.workspaceId,
      },
    });
    if (!workspaceRole) throw new BadRequestException("邀请包含无效工作空间角色");
    this.grantPolicy.assertCanGrant({
      actor: {
        principalType: "workspace",
        workspaceId: this.workspaceId,
        userId: actorUserId,
      },
      actorPermissionCodes: actorWorkspaceRoles.flatMap((role) =>
        (role.rolePermissions ?? [])
          .filter((permission) => permission.enabled)
          .map((permission) => permission.permission),
      ),
      actorRoleNames: actorWorkspaceRoles.map((role) => role.name),
      scope: "workspace",
      targetRole: {
        id: workspaceRole.id,
        name: workspaceRole.name,
        permissionCodes: (workspaceRole.rolePermissions ?? [])
          .filter((permission) => permission.enabled)
          .map((permission) => permission.permission),
      },
    });

  }

  private async getActiveInvite(email?: string, token?: string) {
    const decoded = verifyInviteToken(token);
    const normalizedEmail = normalizeEmail(email ?? decoded.email);
    if (!normalizedEmail || normalizedEmail !== decoded.email) {
      throw new BadRequestException("邮箱与邀请不匹配");
    }
    const invite = await this.invites.findOne({
      where: { workspaceId: this.workspaceId, token },
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

  private async getActivePlatformInvite(email?: string, token?: string) {
    const decoded = verifyInviteToken(token);
    if (decoded.contextType !== "platform") {
      throw new BadRequestException("邀请链接无效或已过期");
    }
    const normalizedEmail = normalizeEmail(email ?? decoded.email);
    if (!normalizedEmail || normalizedEmail !== decoded.email) {
      throw new BadRequestException("邮箱与邀请不匹配");
    }
    const invite = await this.platformDataSource.getRepository(Invite).findOne({
      where: { contextType: "platform", token, workspaceId: IsNull() },
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
      const message = {
        email: invite.email,
        locals: {
          email: invite.email,
          expiresAt: invite.expireDate?.toISOString() ?? "永久有效",
          inviteLink: await this.buildInviteLink(invite),
          workspaceName: invite.contextType === "platform"
            ? "平台控制台"
            : (await this.platformDataSource.getRepository(Workspace).findOne({
                where: { id: invite.workspaceId! },
              }))?.name ?? "",
        },
        templateName: invite.contextType === "platform"
          ? "platform-invite"
          : "workspace-invite",
      };
      if (invite.contextType === "platform") {
        await (this.platformEmailSendService?.send(message) ??
          this.emailSendService.send(message));
      } else {
        await this.emailSendService.send(message);
      }
    } catch (error) {
      this.logger.warn(`invite email failed for ${invite.id}: ${String(error)}`);
    }
  }

  private async buildInviteLink(invite: Invite) {
    const baseUrl = await this.settingsService.getPlatformValue(
      PLATFORM_SETTING_KEYS.publicBaseUrl,
      "http://localhost:3100",
    );
    const workspace = invite.workspaceId
      ? await this.platformDataSource.getRepository(Workspace).findOne({
          where: { id: invite.workspaceId },
        })
      : null;
    const url = new URL("/invite", baseUrl ?? "http://localhost:3100");
    url.searchParams.set("email", invite.email ?? "");
    url.searchParams.set("token", invite.token);
    if (invite.contextType === "platform") url.searchParams.set("context", "platform");
    if (workspace?.slug) url.searchParams.set("workspace", workspace.slug);
    return url.toString();
  }

  private async toDto(invite: Invite): Promise<InviteDto> {
    const invitedBy =
      invite.invitedBy ??
      (invite.invitedById
        ? await this.users.findOne({
            where: { id: invite.invitedById },
          })
        : null);
    return {
      acceptedCount: invite.acceptedCount,
      acceptedUserId: invite.acceptedUserId,
      actionDate: invite.actionDate?.toISOString() ?? null,
      closedAt: invite.closedAt?.toISOString() ?? null,
      createdAt: invite.createdAt.toISOString(),
      email: invite.email,
      existingUser: Boolean(
        invite.email &&
          (await this.users.findOne({
            select: { id: true },
            where: { email: invite.email },
          })),
      ),
      expireDate: invite.expireDate?.toISOString() ?? null,
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
      status: deriveInviteStatus(invite),
      contextType: invite.contextType,
      roleId: invite.roleId,
      workspaceRoleId: invite.workspaceRoleId,
    };
  }

  private runInWorkspace<T>(workspaceId: string, work: () => Promise<T>) {
    const current = this.workspaceContext.current(false);
    if (current) {
      if (current.workspaceId !== workspaceId) {
        throw new BadRequestException("邀请链接无效或已过期");
      }
      return work();
    }
    return this.dataSource.transaction(async (manager) => {
      await manager.query(
        "SELECT set_config('app.workspace_id', $1, true), set_config('app.scope_level', 'workspace', true)",
        [workspaceId],
      );
      return this.workspaceContext.run(
        { manager, scopeLevel: "workspace", workspaceId },
        work,
      );
    });
  }

  private get workspaceId() {
    return this.workspaceContext.current()!.workspaceId;
  }

  private get manager() {
    return this.workspaceContext.current()!.manager;
  }

  private get invites() {
    return this.workspaceContext.repository(Invite);
  }

  private get users() {
    return this.platformDataSource.getRepository(Account);
  }

}

function parseCreatePayload(payload: CreateInvitePayload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new BadRequestException("请求内容无效");
  }
  return {
    email: requireEmail(payload.email),
    expiresIn: normalizeExpiry(payload.expiresIn),
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

function signInviteToken(
  email: string,
  context: { contextType: "platform" } | { contextType: "workspace"; workspaceId: string },
  expiresIn: InviteExpiry,
) {
  const payload = { email, nonce: randomUUID(), ...context };
  return expiresIn === "never"
    ? jwt.sign(payload, getInviteTokenSecret())
    : jwt.sign(payload, getInviteTokenSecret(), { expiresIn });
}

function verifyInviteToken(token?: string) {
  if (!token) throw new BadRequestException("令牌不能为空");
  try {
    const decoded = jwt.verify(token, getInviteTokenSecret()) as {
      contextType?: "platform" | "workspace";
      email?: string;
      workspaceId?: string;
    };
    const contextType = decoded.contextType ?? "workspace";
    if (!decoded.email || (contextType === "workspace" && !decoded.workspaceId)) {
      throw new Error("invalid");
    }
    return contextType === "platform"
      ? { contextType, email: requireEmail(decoded.email) }
      : {
          contextType,
          email: requireEmail(decoded.email),
          workspaceId: decoded.workspaceId!,
        };
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
