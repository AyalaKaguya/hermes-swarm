import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import {
  Organization,
  OrganizationGroup,
  OrganizationGroupMember,
  IntegrationToken,
  Role,
  User,
  UserOrganization,
  type UserOrganizationStatus,
} from "@hermes-swarm/core";
import { In, IsNull, Repository, type EntityManager } from "typeorm";
import { hashPassword } from "../../common/security/password-hash.js";
import { toUserDto } from "../users/user-dto.js";
import type { MembershipPayload } from "./memberships.controller.js";

@Injectable()
export class MembershipsService {
  constructor(
    @InjectRepository(UserOrganization)
    private readonly membershipRepository: Repository<UserOrganization>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Organization)
    private readonly organizationRepository: Repository<Organization>,
    @InjectRepository(OrganizationGroupMember)
    private readonly groupMemberRepository: Repository<OrganizationGroupMember>,
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    @InjectRepository(IntegrationToken)
    private readonly integrationTokenRepository: Repository<IntegrationToken>,
  ) {}

  async list(organizationId: string) {
    await this.ensureOrganization(organizationId);
    const memberships = await this.membershipRepository.find({
      order: { createdAt: "ASC" },
      relations: { role: true, user: true },
      where: { organizationId },
    });
    const groupsByMembership = await this.loadGroupsByMembership(
      memberships.map((membership) => membership.id),
    );
    return memberships.map((membership) =>
      toMembershipDto(membership, groupsByMembership.get(membership.id) ?? []),
    );
  }

  async create(organizationId: string, payload: MembershipPayload) {
    const input = requireMembershipPayload(payload);
    await this.ensureOrganization(organizationId);
    try {
      const membership = await this.membershipRepository.manager.transaction(
        async (manager) => {
          const user = await this.resolveOrCreateUser(input, manager);
          const existing = await manager.findOne(UserOrganization, {
            where: { organizationId, userId: user.id },
          });
          if (existing) throw new BadRequestException("用户已经在该组织中");

          const roleId = await this.resolveRoleId(
            organizationId,
            input.roleId,
            manager,
          );
          return manager.save(
            UserOrganization,
            this.membershipRepository.create({
              displayName:
                normalizeNullableText(input.displayName) ??
                user.nickname ??
                user.displayName,
              joinedAt: new Date(),
              organizationId,
              roleId,
              status: normalizeMembershipStatus(input.status),
              userId: user.id,
            }),
          );
        },
      );
      return toMembershipDto(membership);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const constraint = getConstraintName(error);
        if (constraint?.includes("users_email")) {
          throw new BadRequestException("邮箱已被使用");
        }
        throw new BadRequestException("用户已经在该组织中");
      }
      throw error;
    }
  }

  async update(
    organizationId: string,
    membershipId: string,
    payload: Partial<MembershipPayload>,
  ) {
    const input = requireMembershipPayload(payload);
    await this.membershipRepository.manager.transaction(async (manager) => {
      const membership = await this.getMembershipOrThrow(
        organizationId,
        membershipId,
        manager,
        true,
      );
      const wasActiveOwner = isActiveOwnerMembership(membership);
      const previousRoleId = membership.roleId;
      let nextRole = membership.role;

      if (input.displayName !== undefined) {
        membership.displayName = normalizeNullableText(input.displayName);
      }
      if (input.roleId !== undefined) {
        nextRole = await this.resolveRole(
          organizationId,
          input.roleId,
          manager,
        );
        membership.roleId = nextRole?.id ?? null;
      }
      if (input.status !== undefined) {
        membership.status = normalizeMembershipStatus(input.status);
      }

      if (wasActiveOwner && !isActiveOwnerState(nextRole, membership.status)) {
        await this.assertAnotherActiveOwner(
          organizationId,
          membership.id,
          manager,
        );
      }
      if (
        input.roleId !== undefined ||
        (input.status !== undefined && membership.status !== "active")
      ) {
        await this.revokeOrganizationTokensForMembership(
          membership.userId,
          organizationId,
          manager,
          previousRoleId !== membership.roleId ? "role_changed" : "membership_disabled",
        );
      }

      await manager.update(
        UserOrganization,
        { id: membership.id, organizationId },
        {
          displayName: membership.displayName,
          roleId: membership.roleId,
          status: membership.status,
        },
      );
    });
    return toMembershipDto(
      await this.getMembershipOrThrow(organizationId, membershipId),
    );
  }

  async remove(organizationId: string, membershipId: string) {
    await this.membershipRepository.manager.transaction(async (manager) => {
      const membership = await this.getMembershipOrThrow(
        organizationId,
        membershipId,
        manager,
        true,
      );
      if (isActiveOwnerMembership(membership)) {
        await this.assertAnotherActiveOwner(
          organizationId,
          membership.id,
          manager,
        );
      }
      await this.revokeOrganizationTokensForMembership(
        membership.userId,
        organizationId,
        manager,
        "membership_removed",
      );
      await manager.delete(OrganizationGroupMember, {
        membershipId: membership.id,
        organizationId,
      });
      await manager.delete(UserOrganization, { id: membership.id, organizationId });
    });
  }

  private async ensureOrganization(organizationId: string) {
    const organization = await this.organizationRepository.findOne({
      where: { id: organizationId },
    });
    if (!organization) throw new NotFoundException("组织不存在");
  }

  private async getMembershipOrThrow(
    organizationId: string,
    membershipId: string,
    manager: EntityManager = this.membershipRepository.manager,
    lockForUpdate = false,
  ) {
    const membership = await manager.findOne(UserOrganization, {
      lock: lockForUpdate ? { mode: "pessimistic_write" } : undefined,
      relations: { role: true, user: true },
      where: { id: membershipId, organizationId },
    });
    if (!membership) throw new NotFoundException("组织成员不存在");
    return membership;
  }

  private async resolveRoleId(
    organizationId: string,
    roleId: string | null | undefined,
    manager: EntityManager = this.roleRepository.manager,
  ) {
    return (await this.resolveRole(organizationId, roleId, manager))?.id ?? null;
  }

  private async resolveRole(
    organizationId: string,
    roleId: string | null | undefined,
    manager: EntityManager = this.roleRepository.manager,
  ) {
    if (roleId === null || roleId === undefined) return null;
    const role = await manager.findOne(Role, {
      where: { id: roleId },
    });
    if (!role || role.scope !== "organization" || role.organizationId !== organizationId) {
      throw new BadRequestException("角色不属于该组织");
    }
    return role;
  }

  private async resolveOrCreateUser(
    payload: MembershipPayload,
    manager: EntityManager = this.userRepository.manager,
  ) {
    if (payload.userId) {
      const user = await manager.findOne(User, {
        where: { id: requireText(payload.userId, "用户 ID") },
      });
      if (!user) throw new NotFoundException("用户不存在");
      return user;
    }

    const email = normalizeEmail(payload.email);
    const existing = await manager.findOne(User, { where: { email } });
    if (existing) return existing;

    const displayName =
      normalizeNullableText(payload.displayName) ?? email.split("@")[0] ?? email;
    return manager.save(
      User,
      this.userRepository.create({
        displayName,
        email,
        nickname: displayName,
        passwordHash: payload.password
          ? hashPassword(requirePassword(payload.password))
          : null,
        status: "active",
        type: "user",
      }),
    );
  }

  private async loadGroupsByMembership(membershipIds: string[]) {
    if (membershipIds.length === 0) return new Map<string, OrganizationGroup[]>();

    const rows = await this.groupMemberRepository.find({
      order: { createdAt: "ASC" },
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

  private async revokeOrganizationTokensForMembership(
    userId: string,
    organizationId: string,
    manager: EntityManager = this.integrationTokenRepository.manager,
    _reason: "membership_disabled" | "membership_removed" | "role_changed",
  ) {
    await manager.update(
      IntegrationToken,
      {
        organizationId,
        ownerUserId: userId,
        revokedAt: IsNull(),
        scope: "organization",
      },
      { revokedAt: new Date() },
    );
  }

  private async assertAnotherActiveOwner(
    organizationId: string,
    currentMembershipId: string,
    manager: EntityManager = this.membershipRepository.manager,
  ) {
    const activeMemberships = await manager.find(UserOrganization, {
      lock: { mode: "pessimistic_write" },
      relations: { role: true },
      where: { organizationId, status: "active" },
    });
    const hasAnotherOwner = activeMemberships.some(
      (membership) =>
        membership.id !== currentMembershipId && membership.role?.name === "owner",
    );
    if (!hasAnotherOwner) {
      throw new BadRequestException("组织至少需要保留一个 Owner");
    }
  }
}

function requireMembershipPayload(
  value: MembershipPayload | Partial<MembershipPayload>,
) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException("请求内容无效");
  }
  return value;
}

function requireText(value: string | undefined, label: string) {
  if (value !== undefined && typeof value !== "string") {
    throw new BadRequestException(`${label}格式不正确`);
  }
  const text = value?.trim();
  if (!text) throw new BadRequestException(`${label}不能为空`);
  return text;
}

function normalizeEmail(value: string | undefined) {
  const email = requireText(value, "邮箱").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new BadRequestException("邮箱格式不正确");
  }
  return email;
}

function normalizeNullableText(value: string | null | undefined) {
  if (value !== null && value !== undefined && typeof value !== "string") {
    throw new BadRequestException("显示名称格式不正确");
  }
  const text = value?.trim();
  return text || null;
}

function requirePassword(value: string | undefined) {
  const password = requireText(value, "密码");
  if (password.length < 8) throw new BadRequestException("密码至少需要 8 位");
  return password;
}

function normalizeMembershipStatus(
  value: string | null | undefined,
): UserOrganizationStatus {
  if (value === null || value === undefined) return "active";
  if (value === "active" || value === "disabled" || value === "invited") {
    return value;
  }
  throw new BadRequestException("组织成员状态无效");
}

function isActiveOwnerMembership(membership: UserOrganization) {
  return isActiveOwnerState(membership.role, membership.status);
}

function isActiveOwnerState(
  role: Role | null | undefined,
  status: UserOrganizationStatus,
) {
  return status === "active" && role?.name === "owner";
}

function isUniqueConstraintError(error: unknown) {
  const typed = error as {
    code?: string;
    driverError?: { code?: string; constraint?: string };
  };
  return typed.code === "23505" || typed.driverError?.code === "23505";
}

function getConstraintName(error: unknown) {
  const typed = error as { constraint?: string; driverError?: { constraint?: string } };
  return typed.constraint ?? typed.driverError?.constraint ?? null;
}

function toMembershipDto(
  membership: UserOrganization,
  groups: OrganizationGroup[] = [],
) {
  return {
    displayName: membership.displayName,
    groupIds: groups.map((group) => group.id),
    groups: groups.map(toGroupBriefDto),
    id: membership.id,
    joinedAt: membership.joinedAt,
    organizationId: membership.organizationId,
    role: membership.role,
    roleId: membership.roleId,
    status: membership.status,
    user: membership.user ? toUserDto(membership.user) : undefined,
    userId: membership.userId,
  };
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
