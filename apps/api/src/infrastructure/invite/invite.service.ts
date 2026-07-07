import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import jwt from "jsonwebtoken";
import { MoreThanOrEqual, Repository } from "typeorm";
import {
  Invite,
  Organization,
  Role,
  User,
  UserOrganization,
} from "@hermes-swarm/core";
import type {
  AcceptInvitePayload,
  CreateBulkInvitesPayload,
  InviteDto,
} from "../../common/admin-api.types.js";
import { hashPassword } from "../../common/security/password-hash.js";

const INVITE_JWT_SECRET =
  process.env.INVITE_JWT_SECRET || "hermes-swarm-invite-secret-change-me";

function normalizeEmail(email: string | null | undefined) {
  return email?.trim().toLowerCase() || null;
}

function requireText(value: string | undefined, label: string) {
  const text = value?.trim();
  if (!text) throw new BadRequestException(`${label}不能为空`);
  return text;
}

function toInviteDto(invite: Invite): InviteDto {
  return {
    id: invite.id,
    email: invite.email,
    status: invite.status,
    createdAt: invite.createdAt,
    actionDate: invite.actionDate,
    expireDate: invite.expireDate,
    roleId: invite.roleId,
    invitedById: invite.invitedById,
  };
}

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
  ) {}

  /**
   * Creates bulk invites from a list of emails, skipping already-invited or
   * already-registered addresses.
   */
  async createBulkForOrganization(
    organizationId: string,
    invitedById: string,
    payload: CreateBulkInvitesPayload,
  ): Promise<{ items: InviteDto[]; total: number; ignored: number }> {
    await this.getOrganizationOrThrow(organizationId);

    const emails = (payload.emailIds ?? [])
      .map(normalizeEmail)
      .filter((e): e is string => Boolean(e));

    if (!emails.length) {
      return { items: [], total: 0, ignored: 0 };
    }

    const roleId = payload.roleId
      ? await this.resolveAssignableRoleId(organizationId, payload.roleId)
      : null;

    // Skip addresses that already have an active invite or are already users
    const existingInvites = await this.inviteRepository
      .createQueryBuilder("invite")
      .select("invite.email", "email")
      .where("invite.organizationId = :orgId", { orgId: organizationId })
      .andWhere("invite.email IN (:...emails)", { emails })
      .andWhere("invite.status = :status", { status: "invited" })
      .andWhere(
        "(invite.expireDate IS NULL OR invite.expireDate >= :now)",
        { now: new Date() },
      )
      .getRawMany<{ email: string }>();

    const existingUsers = await this.membershipRepository
      .createQueryBuilder("membership")
      .innerJoin(User, "user", "user.id = membership.userId")
      .select("user.email", "email")
      .where("membership.organizationId = :orgId", {
        orgId: organizationId,
      })
      .andWhere("user.email IN (:...emails)", { emails })
      .getRawMany<{ email: string }>();

    const blockedEmails = new Set([
      ...existingInvites.map((i) => i.email),
      ...existingUsers.map((u) => u.email),
    ]);

    const emailsToCreate = emails.filter((e) => !blockedEmails.has(e));
    const invites: Invite[] = [];

    for (const email of emailsToCreate) {
      const token = jwt.sign(
        { email, organizationId },
        INVITE_JWT_SECRET,
      );
      invites.push(
        this.inviteRepository.create({
          token,
          email,
          roleId: roleId || null,
          invitedById,
          status: "invited",
          organizationId,
        }),
      );
    }

    const saved = emailsToCreate.length
      ? await this.inviteRepository.save(invites)
      : [];

    return {
      items: saved.map(toInviteDto),
      total: saved.length,
      ignored: emails.length - saved.length,
    };
  }

  /**
   * Validates an invite token and returns the invite record if still active.
   */
  async validateByToken(
    email: string | undefined,
    token: string | undefined,
  ): Promise<InviteDto> {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail || !token) {
      throw new BadRequestException("邮箱和令牌不能为空");
    }

    let payload: { email: string; organizationId: string };
    try {
      payload = jwt.verify(token, INVITE_JWT_SECRET) as typeof payload;
    } catch {
      throw new BadRequestException("邀请链接无效或已过期");
    }

    if (payload.email !== normalizedEmail) {
      throw new BadRequestException("邮箱与邀请不匹配");
    }

    const invite = await this.inviteRepository.findOne({
      where: [
        {
          token,
          email: normalizedEmail,
          status: "invited",
          expireDate: MoreThanOrEqual(new Date()),
        },
        {
          token,
          email: normalizedEmail,
          status: "invited",
          expireDate: null as unknown as undefined,
        },
      ].filter(
        (w) => w.expireDate !== (null as unknown as undefined) || true,
      ) as Parameters<typeof this.inviteRepository.findOne>[0]["where"],
    });

    if (!invite) {
      throw new BadRequestException("邀请链接无效或已过期");
    }

    return toInviteDto(invite);
  }

  /**
   * Accepts an invite by creating the user and marking the invite as accepted.
   */
  async accept(payload: AcceptInvitePayload): Promise<InviteDto> {
    const invite = await this.validateByToken(payload.email, payload.token);

    const displayName = requireText(payload.displayName, "用户名称");
    const password = requireText(payload.password, "密码");
    if (password.length < 8) throw new BadRequestException("密码至少需要 8 位");

    const inviteEntity = await this.inviteRepository.findOne({
      where: { id: invite.id },
    });
    if (!inviteEntity) {
      throw new NotFoundException("邀请不存在");
    }

    const organizationId = inviteEntity.organizationId;
    if (!organizationId) throw new BadRequestException("邀请缺少组织信息");

    const organization = await this.organizationRepository.findOne({
      where: { id: organizationId },
    });
    if (!organization) throw new NotFoundException("组织不存在");

    let user = await this.userRepository.findOne({
      where: { email: inviteEntity.email },
    });
    if (user) {
      const existingMembership = await this.membershipRepository.findOne({
        where: { organizationId, userId: user.id },
      });
      if (existingMembership) {
        throw new ConflictException("该邮箱已加入组织");
      }
    }

    if (!user) {
      user = await this.userRepository.save(
        this.userRepository.create({
          displayName,
          email: inviteEntity.email,
          nickname: displayName,
          passwordHash: hashPassword(password),
          status: "active",
          type: "user",
          preferredLanguage: "zh-CN",
        }),
      );
    } else if (!user.passwordHash) {
      user.passwordHash = hashPassword(password);
      user.displayName = user.displayName || displayName;
      user.nickname = user.nickname || displayName;
      user = await this.userRepository.save(user);
    }

    await this.membershipRepository.save(
      this.membershipRepository.create({
        displayName,
        joinedAt: new Date(),
        organizationId,
        roleId: inviteEntity.roleId,
        status: "active",
        userId: user.id,
      }),
    );

    // Mark invite as accepted
    inviteEntity.status = "accepted";
    inviteEntity.actionDate = new Date();
    await this.inviteRepository.save(inviteEntity);

    return toInviteDto(inviteEntity);
  }

  /**
   * Lists all invites for the current organization.
   */
  async listForOrganization(organizationId: string): Promise<InviteDto[]> {
    await this.getOrganizationOrThrow(organizationId);
    const invites = await this.inviteRepository.find({
      where: { organizationId },
      order: { createdAt: "DESC" },
    });
    return invites.map(toInviteDto);
  }

  /**
   * Deletes an invite by id within the current organization.
   */
  async deleteForOrganization(
    organizationId: string,
    inviteId: string,
  ): Promise<void> {
    const invite = await this.inviteRepository.findOne({
      where: { id: inviteId, organizationId },
    });
    if (!invite) throw new NotFoundException("邀请不存在");
    await this.inviteRepository.remove(invite);
  }

  /**
   * Resends an existing invite by regenerating the token.
   */
  async resendForOrganization(
    organizationId: string,
    invitedById: string,
    inviteId: string,
  ): Promise<InviteDto> {
    const invite = await this.inviteRepository.findOne({
      where: { id: inviteId, organizationId },
    });
    if (!invite) throw new NotFoundException("邀请不存在");

    const token = jwt.sign(
      { email: invite.email, organizationId },
      INVITE_JWT_SECRET,
    );

    invite.token = token;
    invite.status = "invited";
    invite.actionDate = null;
    invite.invitedById = invitedById;
    await this.inviteRepository.save(invite);

    return toInviteDto(invite);
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
}
