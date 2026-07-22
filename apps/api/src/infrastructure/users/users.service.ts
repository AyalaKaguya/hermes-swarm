import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import {
  Account,
  IntegrationToken,
  Role,
  WorkspaceMembership,
  normalizeCanonicalLanguage,
  type WorkspaceMembershipStatus,
} from "@hermes-swarm/core";
import { DataSource, IsNull, Repository, type EntityManager } from "typeorm";
import type {
  SearchUsersQuery,
  UpdateAccountPasswordPayload,
  UpdateRuntimePreferencesPayload,
  UpdateSelfProfilePayload,
} from "../../common/admin-api.types.js";
import { WorkspaceContextService } from "../../common/database/workspace-context.service.js";
import { hashPassword, verifyPassword } from "../../common/security/password-hash.js";
import { AuthSessionService } from "../auth/auth-session.service.js";
import { toAccountDto, toWorkspaceMemberDto } from "./user-dto.js";

@Injectable()
export class UsersService {
  constructor(
    private readonly workspaceContext: WorkspaceContextService,
    private readonly authSessionService: AuthSessionService,
    private readonly dataSource: DataSource,
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    @InjectRepository(WorkspaceMembership)
    private readonly membershipRepository: Repository<WorkspaceMembership>,
  ) {}

  async list(authorization: string | undefined) {
    await this.requireWorkspaceSession(authorization);
    const memberships = await this.membershipRepository.find({
      order: { createdAt: "DESC" },
      relations: { account: true, role: true },
      where: { workspaceId: this.workspaceId },
    });
    return memberships
      .filter((membership) => membership.account)
      .map((membership) =>
        toWorkspaceMemberDto(membership, membership.account, membership.role),
      );
  }

  async search(authorization: string | undefined, query: SearchUsersQuery) {
    const search = normalizeOptionalText(query?.search)?.toLowerCase();
    const members = await this.list(authorization);
    if (!search) return members;
    return members.filter((member) =>
      [
        member.account.displayName,
        member.account.email,
        member.account.mobile,
        member.account.nickname,
        member.account.username,
      ].some((value) => value?.toLowerCase().includes(search)),
    );
  }

  async replaceWorkspaceRole(
    authorization: string | undefined,
    membershipId: string,
    roleId: string,
  ) {
    await this.requireWorkspaceSession(authorization);
    return this.dataSource.transaction(async (manager) => {
      const membership = await this.getMembershipOrThrow(membershipId, manager);
      if (membership.status === "removed") {
        throw new BadRequestException("已移除成员需要通过邀请重新加入");
      }
      const role = await manager.findOne(Role, {
        where: { id: requireText(roleId, "工作空间角色"), scope: "workspace", workspaceId: this.workspaceId },
      });
      if (!role) throw new BadRequestException("工作空间角色无效");
      await this.assertOwnerContinuity(manager, membership, role.name === "workspace-owner");
      membership.roleId = role.id;
      membership.role = role;
      membership.updatedAt = new Date();
      return toWorkspaceMemberDto(
        await manager.save(WorkspaceMembership, membership),
        membership.account,
        role,
      );
    });
  }

  async updateMembershipStatus(
    authorization: string | undefined,
    membershipId: string,
    status: WorkspaceMembershipStatus,
    roleId?: string,
  ) {
    await this.requireWorkspaceSession(authorization);
    const result = await this.dataSource.transaction(async (manager) => {
      const membership = await this.getMembershipOrThrow(membershipId, manager);
      if (!["active", "disabled", "removed"].includes(status)) {
        throw new BadRequestException("成员关系状态无效");
      }
      if (status !== "active") {
        await this.assertOwnerContinuity(manager, membership, false);
      }
      if (status === "removed") {
        membership.status = "removed";
        membership.roleId = null;
        membership.role = null;
        membership.removedAt = new Date();
      } else {
        if (!membership.roleId) {
          const role = await manager.findOne(Role, {
            where: {
              id: requireText(roleId, "工作空间角色"),
              scope: "workspace",
              workspaceId: this.workspaceId,
            },
          });
          if (!role) throw new BadRequestException("工作空间角色无效");
          membership.roleId = role.id;
          membership.role = role;
        }
        membership.status = status;
        membership.removedAt = null;
      }
      membership.updatedAt = new Date();
      const saved = await manager.save(WorkspaceMembership, membership);
      if (status !== "active") {
        await manager.update(
          IntegrationToken,
          {
            ownerUserId: membership.accountId,
            revokedAt: IsNull(),
            workspaceId: this.workspaceId,
          },
          { revokedAt: new Date() },
        );
      }
      return { membership, saved };
    });
    if (status !== "active") {
      await this.authSessionService.revokeUserSessions(
        this.workspaceId,
        result.membership.accountId,
      );
    }
    return toWorkspaceMemberDto(result.saved, result.membership.account, result.membership.role);
  }

  async removeMembership(
    authorization: string | undefined,
    membershipId: string,
  ) {
    await this.updateMembershipStatus(
      authorization,
      membershipId,
      "removed",
    );
  }

  async getAccount(authorization: string | undefined) {
    const session = await this.requireWorkspaceSession(authorization);
    return toAccountDto(await this.getGlobalAccountOrThrow(session.accountId));
  }

  async updateAccount(
    authorization: string | undefined,
    payload: UpdateSelfProfilePayload,
  ) {
    const session = await this.requireWorkspaceSession(authorization);
    const account = await this.getGlobalAccountOrThrow(session.accountId);
    if (payload.displayName !== undefined) {
      account.displayName = requireText(payload.displayName, "显示名称");
      account.nickname = account.displayName;
    }
    if (payload.firstName !== undefined) account.firstName = normalizeNullableText(payload.firstName);
    if (payload.lastName !== undefined) account.lastName = normalizeNullableText(payload.lastName);
    if (payload.imageUrl !== undefined) {
      account.imageUrl = normalizeNullableText(payload.imageUrl);
      account.avatarUrl = account.imageUrl;
    }
    if (payload.mobile !== undefined) account.mobile = normalizeNullableText(payload.mobile);
    if (payload.username !== undefined) account.username = normalizeNullableText(payload.username);
    account.updatedAt = new Date();
    return toAccountDto(await this.accountRepository.save(account));
  }

  async updatePassword(
    authorization: string | undefined,
    payload: UpdateAccountPasswordPayload,
  ) {
    const session = await this.requireWorkspaceSession(authorization);
    const account = await this.getGlobalAccountOrThrow(session.accountId);
    if (
      account.passwordHash &&
      !(await verifyPassword(
        requireText(payload?.currentPassword, "当前密码"),
        account.passwordHash,
      ))
    ) {
      throw new BadRequestException("当前密码不正确");
    }
    account.passwordHash = await hashPassword(requirePassword(payload?.password));
    account.credentialVersion += 1;
    account.credentialsChangedAt = new Date();
    account.updatedAt = new Date();
    await this.accountRepository.save(account);
    await this.authSessionService.revokeAccountSessions(account.id);
    return { reauthenticationRequired: true, success: true } as const;
  }

  async updateRuntimePreferences(
    authorization: string | undefined,
    payload: UpdateRuntimePreferencesPayload,
  ) {
    const session = await this.requireWorkspaceSession(authorization);
    const account = await this.getGlobalAccountOrThrow(session.accountId);
    if (payload?.preferredLanguage !== undefined) {
      account.preferredLanguage = normalizePreferredLanguage(payload.preferredLanguage);
    }
    if (payload?.timeZone !== undefined) {
      account.timeZone = normalizeTimeZone(payload.timeZone);
    }
    account.updatedAt = new Date();
    return toAccountDto(await this.accountRepository.save(account));
  }

  async updatePreferredLanguage(
    authorization: string | undefined,
    payload: UpdateRuntimePreferencesPayload,
  ) {
    return this.updateRuntimePreferences(authorization, payload);
  }

  private async requireWorkspaceSession(authorization: string | undefined) {
    try {
      const session = await this.authSessionService.validateAccessToken(
        authorization?.replace(/^Bearer\s+/i, "").trim(),
      );
      if (
        session.principalType !== "workspace" ||
        !session.workspaceId ||
        session.workspaceId !== this.workspaceId ||
        !session.accountId ||
        !session.membershipId
      ) {
        throw new Error();
      }
      return {
        accountId: session.accountId,
        membershipId: session.membershipId,
        workspaceId: session.workspaceId,
      };
    } catch {
      throw new UnauthorizedException("登录已失效，请重新登录");
    }
  }

  private async getMembershipOrThrow(
    membershipId: string,
    manager: EntityManager = this.membershipRepository.manager,
  ) {
    const membership = await manager.findOne(WorkspaceMembership, {
      relations: { account: true, role: true },
      where: { id: membershipId, workspaceId: this.workspaceId },
    });
    if (!membership) throw new NotFoundException("成员关系不存在");
    return membership;
  }

  private async getGlobalAccountOrThrow(accountId: string) {
    const account = await this.accountRepository.findOne({ where: { id: accountId } });
    if (!account || account.status !== "active") {
      throw new NotFoundException("账号不存在");
    }
    return account;
  }

  private async assertOwnerContinuity(
    manager: EntityManager,
    membership: WorkspaceMembership,
    remainsOwner: boolean,
  ) {
    if (remainsOwner || membership.role?.name !== "workspace-owner" || membership.status !== "active") {
      return;
    }
    const rows = (await manager.query(
      `SELECT membership.id
         FROM user_workspace_roles membership
         JOIN roles role
           ON role.workspace_id = membership.workspace_id
          AND role.id = membership.role_id
        WHERE membership.workspace_id = $1
          AND membership.status = 'active'
          AND role.name = 'workspace-owner'
          AND role.scope = 'workspace'
        FOR UPDATE OF membership`,
      [this.workspaceId],
    )) as Array<{ id: string }>;
    if (rows.length === 1 && rows[0]?.id === membership.id) {
      throw new BadRequestException({
        code: "OWNER_CONTINUITY_REQUIRED",
        message: "工作空间必须至少保留一个有效 Workspace Owner",
        statusCode: 400,
      });
    }
  }

  private get workspaceId() {
    return this.workspaceContext.current()!.workspaceId;
  }
}

function requireText(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new BadRequestException(`${label}不能为空`);
  }
  return value.trim();
}

function normalizeOptionalText(value: unknown) {
  if (typeof value !== "string") return null;
  return value.trim() || null;
}

function normalizeNullableText(value: unknown) {
  if (value === null) return null;
  if (typeof value !== "string") throw new BadRequestException("文本字段无效");
  return value.trim() || null;
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
