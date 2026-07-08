import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import jwt from "jsonwebtoken";
import { Repository } from "typeorm";
import {
  Invite,
  Organization,
  Role,
  User,
  UserOrganization,
  type InviteStatus,
} from "@hermes-swarm/core";
import { PLATFORM_SETTING_KEYS } from "@hermes-swarm/core/settings/definitions";
import type {
  AcceptInvitePayload,
  CreateBulkInvitesPayload,
  InviteDto,
} from "../../common/admin-api.types.js";
import {
  hashPassword,
  verifyPassword,
} from "../../common/security/password-hash.js";
import { EmailSendService } from "../mail/email-send.service.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { SettingsService } from "../settings/settings.service.js";
import { toUserDto } from "../users/user-dto.js";

const INVITE_JWT_SECRET =
  process.env.INVITE_JWT_SECRET || "hermes-swarm-invite-secret-change-me";

type InviteExpiry = NonNullable<CreateBulkInvitesPayload["expiresIn"]>;

@Injectable()
export class InviteService {
  constructor(
    @InjectRepository(Invite)
    private readonly inviteRepository: Repository<Invite>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Organization)
    private readonly organizationRepository: Repository<Organization>,
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    @InjectRepository(UserOrganization)
    private readonly membershipRepository: Repository<UserOrganization>,
    private readonly emailSendService: EmailSendService,
    private readonly notificationsService: NotificationsService,
    private readonly settingsService: SettingsService,
  ) {}

  /**
   * Creates email-based invite links. Existing platform users still receive
   * the email, and also receive an in-app notification.
   */
  async createBulkForOrganization(
    organizationId: string,
    invitedById: string,
    payload: CreateBulkInvitesPayload,
  ): Promise<{ items: InviteDto[]; total: number; ignored: number }> {
    const organization = await this.getOrganizationOrThrow(organizationId);
    const expiresIn = normalizeExpiry(payload.expiresIn);

    const emails = [
      ...new Set(
        (payload.emailIds ?? [])
          .map(normalizeEmail)
          .filter((email): email is string => Boolean(email)),
      ),
    ];

    const roleId = payload.roleId
      ? await this.resolveAssignableRoleId(organizationId, payload.roleId)
      : null;

    if (!emails.length) {
      const invite = this.inviteRepository.create({
        acceptedCount: 0,
        actionDate: null,
        acceptedUserId: null,
        closedAt: null,
        email: null,
        expireDate: computeExpireDate(expiresIn),
        invitedById,
        organizationId,
        roleId,
        status: "invited",
        token: signInviteToken(null, organizationId, expiresIn),
      });
      const saved = await this.inviteRepository.save(invite);
      return {
        ignored: 0,
        items: [await this.toInviteDto(saved)],
        total: 1,
      };
    }

    const existingInvites = await this.inviteRepository
      .createQueryBuilder("invite")
      .select("invite.email", "email")
      .where("invite.organizationId = :orgId", { orgId: organizationId })
      .andWhere("invite.email IN (:...emails)", { emails })
      .andWhere("invite.status = :status", { status: "invited" })
      .andWhere("invite.closedAt IS NULL")
      .andWhere("(invite.expireDate IS NULL OR invite.expireDate >= :now)", {
        now: new Date(),
      })
      .getRawMany<{ email: string }>();

    const existingMemberships = await this.membershipRepository
      .createQueryBuilder("membership")
      .innerJoin(User, "user", "user.id = membership.userId")
      .select("user.email", "email")
      .where("membership.organizationId = :orgId", { orgId: organizationId })
      .andWhere("user.email IN (:...emails)", { emails })
      .getRawMany<{ email: string }>();

    const blockedEmails = new Set([
      ...existingInvites.map((invite) => invite.email),
      ...existingMemberships.map((membership) => membership.email),
    ]);
    const emailsToCreate = emails.filter((email) => !blockedEmails.has(email));
    const reusableInvites = emailsToCreate.length
      ? await this.inviteRepository.find({
          where: emailsToCreate.map((email) => ({ email, organizationId })),
        })
      : [];
    const reusableByEmail = new Map(
      reusableInvites.map((invite) => [invite.email, invite]),
    );

    const invites = emailsToCreate.map((email) => {
      const expireDate = computeExpireDate(expiresIn);
      const invite =
        reusableByEmail.get(email) ??
        this.inviteRepository.create({
          email,
          organizationId,
        });
      invite.actionDate = null;
      invite.acceptedUserId = null;
      invite.closedAt = null;
      invite.email = email;
      invite.expireDate = expireDate;
      invite.invitedById = invitedById;
      invite.roleId = roleId || null;
      invite.status = "invited";
      invite.token = signInviteToken(email, organizationId, expiresIn);
      return invite;
    });

    const saved = invites.length ? await this.inviteRepository.save(invites) : [];
    await Promise.all(
      saved.map((invite) =>
        this.notifyInvitee({
          invite,
          invitedById,
          organization,
        }),
      ),
    );

    return {
      ignored: emails.length - saved.length,
      items: await Promise.all(saved.map((invite) => this.toInviteDto(invite))),
      total: saved.length,
    };
  }

  /**
   * Validates an invite token and returns organization context for the invite
   * confirmation page.
   */
  async validateByToken(
    email: string | undefined,
    token: string | undefined,
  ): Promise<InviteDto> {
    const invite = await this.getActiveInviteOrThrow(email, token);
    return this.toInviteDto(invite, { includeOrganization: true });
  }

  /**
   * Accepts or declines an invite. Existing platform users can join with the
   * invite token; new users must provide profile and password fields.
   */
  async accept(payload: AcceptInvitePayload): Promise<InviteDto> {
    if (payload.action === "decline") {
      return this.decline(payload);
    }

    const inviteEntity = await this.getActiveInviteOrThrow(
      payload.email,
      payload.token,
    );
    const organizationId = requireOrganizationId(inviteEntity);
    const organization = await this.getOrganizationOrThrow(organizationId);
    const targetEmail = resolveAcceptanceEmail(inviteEntity, payload.email);

    let user = await this.userRepository.findOne({
      where: { email: targetEmail },
    });
    if (user) {
      const existingMembership = await this.membershipRepository.findOne({
        where: { organizationId, userId: user.id },
      });
      if (existingMembership) {
        throw new ConflictException("该邮箱已加入组织");
      }
      if (!inviteEntity.email) {
        const password = requirePassword(payload.password);
        if (!verifyPassword(password, user.passwordHash)) {
          throw new BadRequestException("邮箱或密码不正确");
        }
      }
    }

    if (!user) {
      const displayName = requireText(payload.displayName, "用户名称");
      const password = requirePassword(payload.password);
      user = await this.userRepository.save(
        this.userRepository.create({
          displayName,
          email: targetEmail,
          emailVerified: true,
          nickname: displayName,
          passwordHash: hashPassword(password),
          preferredLanguage: "zh-CN",
          status: "active",
          type: "user",
        }),
      );
    }

    await this.membershipRepository.save(
      this.membershipRepository.create({
        displayName: payload.displayName?.trim() || user.displayName || null,
        joinedAt: new Date(),
        organizationId,
        roleId: inviteEntity.roleId,
        status: "active",
        userId: user.id,
      }),
    );

    inviteEntity.acceptedCount = (inviteEntity.acceptedCount ?? 0) + 1;
    inviteEntity.acceptedUserId = user.id;
    inviteEntity.actionDate = new Date();
    if (inviteEntity.email) {
      inviteEntity.status = "accepted";
    }
    await this.inviteRepository.save(inviteEntity);

    await this.notificationsService.createForUser({
      actorUserId: inviteEntity.invitedById,
      body: `你已加入组织 ${organization.name}。`,
      kind: "success",
      organizationId,
      payload: { organizationId },
      recipientUserId: user.id,
      sourceId: inviteEntity.id,
      sourceType: "organization-invite",
      title: "组织邀请已接受",
    });

    return this.toInviteDto(inviteEntity, { includeOrganization: true });
  }

  async decline(payload: AcceptInvitePayload): Promise<InviteDto> {
    const invite = await this.getActiveInviteOrThrow(payload.email, payload.token);
    if (!invite.email) {
      return this.toInviteDto(invite, { includeOrganization: true });
    }
    invite.actionDate = new Date();
    invite.status = "declined";
    await this.inviteRepository.save(invite);
    return this.toInviteDto(invite, { includeOrganization: true });
  }

  async listForOrganization(organizationId: string): Promise<InviteDto[]> {
    await this.getOrganizationOrThrow(organizationId);
    const invites = await this.inviteRepository.find({
      order: { createdAt: "DESC" },
      relations: { invitedBy: true, role: true },
      where: { organizationId },
    });
    return Promise.all(invites.map((invite) => this.toInviteDto(invite)));
  }

  /**
   * Closes an invite link. We keep the record so the members page can show
   * link history and join counts.
   */
  async deleteForOrganization(
    organizationId: string,
    inviteId: string,
  ): Promise<void> {
    const invite = await this.inviteRepository.findOne({
      where: { id: inviteId, organizationId },
    });
    if (!invite) throw new NotFoundException("邀请不存在");
    invite.actionDate = new Date();
    invite.closedAt = new Date();
    invite.status = "revoked";
    await this.inviteRepository.save(invite);
  }

  async resendForOrganization(
    organizationId: string,
    invitedById: string,
    inviteId: string,
  ): Promise<InviteDto> {
    const organization = await this.getOrganizationOrThrow(organizationId);
    const invite = await this.inviteRepository.findOne({
      where: { id: inviteId, organizationId },
    });
    if (!invite) throw new NotFoundException("邀请不存在");
    if (invite.status === "accepted") {
      throw new BadRequestException("已接受的邀请不能重发");
    }

    const expiresIn = invite.expireDate === null ? "never" : "3d";
    invite.actionDate = null;
    invite.closedAt = null;
    invite.expireDate = computeExpireDate(expiresIn);
    invite.invitedById = invitedById;
    invite.status = "invited";
    invite.token = signInviteToken(invite.email, organizationId, expiresIn);
    await this.inviteRepository.save(invite);

    if (invite.email) {
      await this.notifyInvitee({ invite, invitedById, organization });
    }
    return this.toInviteDto(invite);
  }

  private async getActiveInviteOrThrow(
    email: string | undefined,
    token: string | undefined,
  ) {
    const normalizedEmail = normalizeEmail(email);
    if (!token) {
      throw new BadRequestException("令牌不能为空");
    }

    let payload: { email?: string | null; organizationId: string };
    try {
      payload = jwt.verify(token, INVITE_JWT_SECRET) as typeof payload;
    } catch {
      throw new BadRequestException("邀请链接无效或已过期");
    }

    if (payload.email && normalizedEmail && payload.email !== normalizedEmail) {
      throw new BadRequestException("邮箱与邀请不匹配");
    }

    const invite = await this.inviteRepository.findOne({
      where: { token },
    });
    if (!invite) throw new BadRequestException("邀请链接无效或已过期");
    if (invite.email && normalizedEmail && invite.email !== normalizedEmail) {
      throw new BadRequestException("邮箱与邀请不匹配");
    }
    if (deriveInviteStatus(invite) !== "invited") {
      throw new BadRequestException("邀请链接无效或已过期");
    }
    return invite;
  }

  private async getOrganizationOrThrow(organizationId: string) {
    const organization = await this.organizationRepository.findOne({
      where: { id: organizationId },
    });
    if (!organization) throw new NotFoundException("组织不存在");
    return organization;
  }

  private async resolveAssignableRoleId(organizationId: string, roleId: string) {
    const role = await this.roleRepository.findOne({
      where: { id: roleId, organizationId, scope: "organization" },
    });
    if (!role) throw new BadRequestException("角色不属于该组织");
    return role.id;
  }

  private async notifyInvitee(input: {
    invite: Invite;
    invitedById: string;
    organization: Organization;
  }) {
    if (!input.invite.email) return;
    const link = await this.buildInviteLink(input.invite);
    const existingUser = await this.userRepository.findOne({
      where: { email: input.invite.email },
    });

    if (existingUser) {
      await this.notificationsService.createForUser({
        actorUserId: input.invitedById,
        body: `${input.organization.name} 邀请你加入组织。`,
        kind: "info",
        organizationId: input.organization.id,
        payload: {
          email: input.invite.email,
          inviteId: input.invite.id,
          link,
          organizationId: input.organization.id,
        },
        recipientUserId: existingUser.id,
        sourceId: input.invite.id,
        sourceType: "organization-invite",
        title: "新的组织邀请",
      });
    }

    await this.emailSendService.send({
      email: input.invite.email,
      organizationId: input.organization.id,
      templateName: "organization-invite",
      locals: {
        email: input.invite.email,
        expiresAt: input.invite.expireDate
          ? input.invite.expireDate.toISOString()
          : "永久有效",
        inviteLink: link,
        organizationName: input.organization.name,
      },
    });
  }

  private async toInviteDto(
    invite: Invite,
    options: { includeOrganization?: boolean } = {},
  ): Promise<InviteDto> {
    const existingUser = invite.email
      ? await this.userRepository.findOne({
          where: { email: invite.email },
        })
      : null;
    const role =
      invite.role ??
      (invite.roleId
        ? await this.roleRepository.findOne({ where: { id: invite.roleId } })
        : null);
    const invitedBy =
      invite.invitedBy ??
      (invite.invitedById
        ? await this.userRepository.findOne({ where: { id: invite.invitedById } })
        : null);
    const organization =
      options.includeOrganization && invite.organizationId
        ? await this.organizationRepository.findOne({
            where: { id: invite.organizationId },
          })
        : null;

    return {
      acceptedCount: invite.acceptedCount ?? 0,
      acceptedUserId: invite.acceptedUserId ?? null,
      actionDate: invite.actionDate,
      closedAt: invite.closedAt ?? null,
      createdAt: invite.createdAt,
      email: invite.email,
      existingUser: Boolean(existingUser),
      expireDate: invite.expireDate,
      id: invite.id,
      invitedBy: invitedBy ? toInviteUserDto(invitedBy) : null,
      invitedById: invite.invitedById,
      link: await this.buildInviteLink(invite),
      organization: organization
        ? {
            id: organization.id,
            imageUrl: organization.imageUrl,
            logoUrl: organization.logoUrl,
            name: organization.name,
            shortDescription: organization.shortDescription,
            slug: organization.slug,
          }
        : undefined,
      role: role ? toInviteRoleDto(role) : null,
      roleId: invite.roleId,
      status: deriveInviteStatus(invite),
    };
  }

  private async buildInviteLink(invite: Invite) {
    const baseUrl = await this.settingsService.getPlatformValue(
      PLATFORM_SETTING_KEYS.publicBaseUrl,
      resolvePublicBaseUrl(),
    );
    const url = new URL("/invite", baseUrl || resolvePublicBaseUrl());
    if (invite.email) {
      url.searchParams.set("email", invite.email);
    }
    url.searchParams.set("token", invite.token);
    return url.toString();
  }
}

function toInviteRoleDto(role: Role) {
  return {
    color: role.color,
    displayName: role.displayName,
    id: role.id,
    isSystem: role.isSystem,
    label: role.label,
    name: role.name,
  };
}

function toInviteUserDto(user: User) {
  const dto = toUserDto(user);
  return {
    avatarUrl: dto.avatarUrl,
    displayName: dto.displayName,
    email: dto.email,
    id: dto.id,
    imageUrl: dto.imageUrl,
    username: dto.username,
  };
}

function resolvePublicBaseUrl() {
  return (
    process.env.WEB_PUBLIC_URL ||
    process.env.APP_PUBLIC_URL ||
    process.env.PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3100"
  );
}

function normalizeEmail(email: string | null | undefined) {
  const value = email?.trim().toLowerCase();
  if (!value) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw new BadRequestException("邮箱格式不正确");
  }
  return value;
}

function normalizeExpiry(value: string | undefined): InviteExpiry {
  return value === "7d" || value === "never" ? value : "3d";
}

function computeExpireDate(expiresIn: InviteExpiry) {
  if (expiresIn === "never") return null;
  const days = expiresIn === "7d" ? 7 : 3;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function signInviteToken(
  email: string | null,
  organizationId: string,
  expiresIn: InviteExpiry,
) {
  const payload = { email, organizationId };
  return expiresIn === "never"
    ? jwt.sign(payload, INVITE_JWT_SECRET)
    : jwt.sign(payload, INVITE_JWT_SECRET, { expiresIn });
}

function deriveInviteStatus(invite: Invite): InviteStatus {
  if (invite.status !== "invited") return invite.status;
  if (invite.closedAt) return "revoked";
  if (invite.expireDate && invite.expireDate.getTime() < Date.now()) {
    return "expired";
  }
  return "invited";
}

function requireOrganizationId(invite: Invite) {
  if (!invite.organizationId) throw new BadRequestException("邀请缺少组织信息");
  return invite.organizationId;
}

function resolveAcceptanceEmail(invite: Invite, payloadEmail: string | undefined) {
  if (invite.email) return invite.email;
  const normalizedEmail = normalizeEmail(payloadEmail);
  if (!normalizedEmail) throw new BadRequestException("邮箱不能为空");
  return normalizedEmail;
}

function requireText(value: string | undefined, label: string) {
  const text = value?.trim();
  if (!text) throw new BadRequestException(`${label}不能为空`);
  return text;
}

function requirePassword(value: string | undefined) {
  const password = requireText(value, "密码");
  if (password.length < 8) throw new BadRequestException("密码至少需要 8 位");
  return password;
}
