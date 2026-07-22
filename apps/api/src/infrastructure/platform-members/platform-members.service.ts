import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import {
  Account,
  PLATFORM_ADMIN_ROLE_NAME,
  PlatformMembership,
  Role,
  type PlatformMembershipStatus,
} from "@hermes-swarm/core";
import { IsNull, Repository } from "typeorm";
import type { PlatformMemberPayload } from "./platform-members.controller.js";
import { RoleGrantPolicyService } from "@hermes-swarm/rbac";
import { InviteService } from "../invite/invite.service.js";
import { AuthSessionService } from "../auth/auth-session.service.js";
import { toAccountDto, toRoleDto } from "../users/user-dto.js";

@Injectable()
export class PlatformMembersService {
  constructor(
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    @InjectRepository(PlatformMembership)
    private readonly membershipRepository: Repository<PlatformMembership>,
    private readonly inviteService: InviteService,
    private readonly authSessionService: AuthSessionService,
    private readonly grantPolicy: RoleGrantPolicyService =
      new RoleGrantPolicyService(),
  ) {}

  async list() {
    const memberships = await this.membershipRepository.find({
      order: { createdAt: "ASC" },
      relations: { account: true, role: true },
    });
    return memberships.map(toPlatformMemberDto);
  }

  async create(payload: PlatformMemberPayload, actorAccountId?: string) {
    const input = requirePayload(payload);
    const role = await this.resolveRole(requireText(input.roleId, "角色 ID"));
    if (actorAccountId) {
      await this.assertCanGrantPlatformRole(actorAccountId, undefined, role);
    }
    const email = normalizeEmail(input.email);
    const account = await this.accountRepository.findOne({ where: { email } });
    if (!account) {
      return {
        invite: await this.inviteService.createPlatform(
          actorAccountId ?? null,
          {
            email,
            expiresIn: input.expiresIn,
            roleId: role.id,
          },
        ),
        status: "invited" as const,
      };
    }
    if (account.status !== "active") {
      throw new BadRequestException("账号不可用");
    }

    const membership = await this.membershipRepository.findOne({
      where: { accountId: account.id },
    });
    if (membership && membership.status !== "removed") {
      throw new ConflictException("该账号已经拥有平台访问关系");
    }
    const saved = await this.membershipRepository.save(
      Object.assign(
        membership ?? this.membershipRepository.create(),
        {
          accountId: account.id,
          removedAt: null,
          roleId: role.id,
          status: "active" as const,
        },
      ),
    );
    saved.account = account;
    saved.role = role;
    return toPlatformMemberDto(saved);
  }

  async update(
    membershipId: string,
    payload: Partial<PlatformMemberPayload>,
    actorAccountId?: string,
  ) {
    const input = requirePayload(payload);
    await this.membershipRepository.manager.transaction(async (manager) => {
      const membership = await manager.findOne(PlatformMembership, {
        lock: { mode: "pessimistic_write" },
        relations: { account: true, role: true },
        where: { id: membershipId },
      });
      if (!membership) throw new NotFoundException("平台成员关系不存在");
      const wasAdmin = isActivePlatformAdmin(membership);

      if (input.roleId !== undefined) {
        const role = await this.resolveRole(input.roleId, manager);
        if (actorAccountId) {
          await this.assertCanGrantPlatformRole(
            actorAccountId,
            membership.accountId,
            role,
            manager,
          );
        }
        membership.roleId = role.id;
        membership.role = role;
      }
      if (input.status !== undefined) {
        membership.status = normalizeStatus(input.status);
        membership.removedAt = null;
      }
      if (wasAdmin && !isActivePlatformAdmin(membership)) {
        await this.assertAnotherAdmin(membership.id, manager);
      }
      await manager.save(PlatformMembership, membership);
    });
    await this.authSessionService.revokeMembershipSessions("platform", membershipId);
    return toPlatformMemberDto(await this.getMembershipOrThrow(membershipId));
  }

  async remove(membershipId: string) {
    await this.membershipRepository.manager.transaction(async (manager) => {
      const membership = await manager.findOne(PlatformMembership, {
        lock: { mode: "pessimistic_write" },
        relations: { account: true, role: true },
        where: { id: membershipId },
      });
      if (!membership) throw new NotFoundException("平台成员关系不存在");
      if (isActivePlatformAdmin(membership)) {
        await this.assertAnotherAdmin(membership.id, manager);
      }
      membership.roleId = null;
      membership.role = null;
      membership.status = "removed";
      membership.removedAt = new Date();
      await manager.save(PlatformMembership, membership);
    });
    await this.authSessionService.revokeMembershipSessions("platform", membershipId);
  }

  private async getMembershipOrThrow(id: string) {
    const membership = await this.membershipRepository.findOne({
      relations: { account: true, role: true },
      where: { id },
    });
    if (!membership) throw new NotFoundException("平台成员关系不存在");
    return membership;
  }

  private async resolveRole(
    roleId: string | null | undefined,
    manager = this.roleRepository.manager,
  ) {
    const id = requireText(roleId, "角色 ID");
    const role = await manager.findOne(Role, {
      relations: { rolePermissions: { permissionRecord: true } },
      where: { id, scope: "platform", workspaceId: IsNull() },
    });
    if (!role) throw new BadRequestException("平台角色不存在");
    return role;
  }

  private async assertAnotherAdmin(
    currentMembershipId: string,
    manager: Repository<PlatformMembership>["manager"],
  ) {
    const memberships = await manager.find(PlatformMembership, {
      lock: { mode: "pessimistic_write" },
      relations: { role: true },
      where: { status: "active" },
    });
    if (
      !memberships.some(
        (membership) =>
          membership.id !== currentMembershipId &&
          isActivePlatformAdmin(membership),
      )
    ) {
      throw new BadRequestException("平台至少需要保留一个 Platform Admin");
    }
  }

  private async assertCanGrantPlatformRole(
    actorAccountId: string,
    targetAccountId: string | undefined,
    targetRole: Role,
    manager = this.accountRepository.manager,
  ) {
    const actor = await manager.findOne(PlatformMembership, {
      relations: { role: { rolePermissions: { permissionRecord: true } } },
      where: { accountId: actorAccountId, status: "active" },
    });
    const role = actor?.role;
    this.grantPolicy.assertCanGrant({
      actor: {
        principalType: "platform",
        workspaceId: null,
        userId: actorAccountId,
      },
      actorPermissionCodes: (role?.rolePermissions ?? [])
        .filter((permission) => permission.enabled)
        .flatMap((permission) =>
          permission.permissionRecord?.code
            ? [permission.permissionRecord.code]
            : [],
        ),
      actorRoleNames: role ? [role.name] : [],
      scope: "platform",
      targetRole: {
        id: targetRole.id,
        name: targetRole.name,
        permissionCodes: (targetRole.rolePermissions ?? [])
          .filter((permission) => permission.enabled)
          .flatMap((permission) =>
            permission.permissionRecord?.code
              ? [permission.permissionRecord.code]
              : [],
          ),
      },
      targetUserId: targetAccountId,
    });
  }
}

function requirePayload(value: object | null | undefined) {
  if (!value || Array.isArray(value)) throw new BadRequestException("请求内容无效");
  return value as Partial<PlatformMemberPayload>;
}

function requireText(value: unknown, label: string) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new BadRequestException(`${label}不能为空`);
  return text;
}

function normalizeEmail(value: unknown) {
  const email = requireText(value, "邮箱").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new BadRequestException("邮箱格式不正确");
  }
  return email;
}

function normalizeStatus(value: unknown): Exclude<PlatformMembershipStatus, "removed"> {
  if (value === "active" || value === "disabled") return value;
  throw new BadRequestException("平台成员状态无效");
}

function isActivePlatformAdmin(membership: PlatformMembership) {
  return membership.status === "active" &&
    membership.role?.name === PLATFORM_ADMIN_ROLE_NAME;
}

function toPlatformMemberDto(membership: PlatformMembership) {
  const account = membership.account;
  return {
    account: toAccountDto(account),
    displayName: account?.displayName ?? "",
    email: account?.email ?? "",
    id: membership.id,
    membershipId: membership.id,
    role: membership.role ? toRoleDto(membership.role) : null,
    roleId: membership.roleId,
    status: membership.status,
    userId: membership.accountId,
  };
}
