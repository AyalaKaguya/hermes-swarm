import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { randomBytes, pbkdf2Sync } from "node:crypto";
import jwt from "jsonwebtoken";
import { MoreThanOrEqual, Repository } from "typeorm";
import { Invite, Organization, Role, User } from "@hermes-swarm/core";
import { TenancyService } from "../tenancy/tenancy.service.js";
import type {
  AcceptInvitePayload,
  AuthContext,
  CreateBulkInvitesPayload,
  InviteDto,
} from "../tenancy/tenancy.types.js";

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
    private readonly tenancyService: TenancyService,
  ) {}

  /**
   * Creates bulk invites from a list of emails, skipping already-invited or
   * already-registered addresses.
   */
  async createBulk(
    context: AuthContext,
    payload: CreateBulkInvitesPayload,
  ): Promise<{ items: InviteDto[]; total: number; ignored: number }> {
    this.tenancyService.ensurePermission(context, "users", "manage");

    const emails = (payload.emailIds ?? [])
      .map(normalizeEmail)
      .filter((e): e is string => Boolean(e));

    if (!emails.length) {
      return { items: [], total: 0, ignored: 0 };
    }

    const roleId = payload.roleId
      ? (await this.roleRepository.findOne({ where: { id: payload.roleId, organizationId: context.organizationId } }))?.id
      : null;

    if (payload.roleId && !roleId) {
      throw new NotFoundException("角色不存在");
    }

    // Skip addresses that already have an active invite or are already users
    const existingInvites = await this.inviteRepository
      .createQueryBuilder("invite")
      .select("invite.email", "email")
      .where("invite.organizationId = :orgId", { orgId: context.organizationId })
      .andWhere("invite.email IN (:...emails)", { emails })
      .andWhere("invite.status = :status", { status: "invited" })
      .andWhere(
        "(invite.expireDate IS NULL OR invite.expireDate >= :now)",
        { now: new Date() },
      )
      .getRawMany<{ email: string }>();

    const existingUsers = await this.userRepository
      .createQueryBuilder("user")
      .select("user.email", "email")
      .where("user.organizationId = :orgId", { orgId: context.organizationId })
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
        { email, organizationId: context.organizationId },
        INVITE_JWT_SECRET,
      );
      invites.push(
        this.inviteRepository.create({
          token,
          email,
          roleId: roleId || null,
          invitedById: context.userId,
          status: "invited",
          organizationId: context.organizationId,
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

    const organization = await this.organizationRepository.findOne({
      where: { id: inviteEntity.organizationId as string },
    });

    // Check if user with this email already exists in the org
    const existing = await this.userRepository.findOne({
      where: { email: inviteEntity.email, organizationId: inviteEntity.organizationId as string },
    });
    if (existing) {
      throw new ConflictException("该邮箱已注册");
    }

    // Create the user (password hashing is handled by TenancyService style)
    
    const salt = randomBytes(16).toString("base64url");
    const hash = pbkdf2Sync(
      password,
      salt,
      310_000,
      32,
      "sha256",
    ).toString("base64url");
    const passwordHash = `pbkdf2_sha256$${310_000}$${salt}$${hash}`;

    await this.userRepository.save(
      this.userRepository.create({
        displayName,
        email: inviteEntity.email,
        passwordHash,
        roleId: inviteEntity.roleId,
        status: "active",
        organizationId: inviteEntity.organizationId,
        type: "user",
        preferredLanguage: "zh-CN",
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
  async list(context: AuthContext): Promise<InviteDto[]> {
    this.tenancyService.ensurePermission(context, "users", "view");
    const invites = await this.inviteRepository.find({
      where: { organizationId: context.organizationId },
      order: { createdAt: "DESC" },
    });
    return invites.map(toInviteDto);
  }

  /**
   * Deletes an invite by id within the current organization.
   */
  async delete(context: AuthContext, inviteId: string): Promise<void> {
    this.tenancyService.ensurePermission(context, "users", "manage");
    const invite = await this.inviteRepository.findOne({
      where: { id: inviteId, organizationId: context.organizationId },
    });
    if (!invite) throw new NotFoundException("邀请不存在");
    await this.inviteRepository.remove(invite);
  }

  /**
   * Resends an existing invite by regenerating the token.
   */
  async resend(
    context: AuthContext,
    inviteId: string,
  ): Promise<InviteDto> {
    this.tenancyService.ensurePermission(context, "users", "manage");
    const invite = await this.inviteRepository.findOne({
      where: { id: inviteId, organizationId: context.organizationId },
    });
    if (!invite) throw new NotFoundException("邀请不存在");

    const token = jwt.sign(
      { email: invite.email, organizationId: context.organizationId },
      INVITE_JWT_SECRET,
    );

    invite.token = token;
    invite.status = "invited";
    invite.actionDate = null;
    invite.invitedById = context.userId;
    await this.inviteRepository.save(invite);

    return toInviteDto(invite);
  }
}
