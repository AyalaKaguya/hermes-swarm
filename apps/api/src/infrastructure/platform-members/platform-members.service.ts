import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import {
  IntegrationToken,
  PlatformMember,
  PLATFORM_ADMIN_ROLE_NAME,
  type PlatformMemberStatus,
  Role,
  User,
} from "@hermes-swarm/core";
import { IsNull, Repository, type EntityManager } from "typeorm";
import { toUserDto } from "../users/user-dto.js";
import type { PlatformMemberPayload } from "./platform-members.controller.js";

@Injectable()
export class PlatformMembersService {
  constructor(
    @InjectRepository(PlatformMember)
    private readonly memberRepository: Repository<PlatformMember>,
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(IntegrationToken)
    private readonly integrationTokenRepository: Repository<IntegrationToken>,
  ) {}

  async list() {
    const members = await this.memberRepository.find({
      order: { createdAt: "ASC" },
      relations: { role: true, user: true },
    });
    return members.map(toPlatformMemberDto);
  }

  async create(payload: PlatformMemberPayload) {
    const input = requirePlatformMemberPayload(payload);
    const userId = requireText(input.userId, "用户 ID");
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException("用户不存在");

    const existing = await this.memberRepository.findOne({ where: { userId } });
    if (existing) throw new BadRequestException("用户已经是平台成员");

    try {
      const roleId = await this.resolvePlatformRoleId(input.roleId);
      const member = await this.memberRepository.save(
        this.memberRepository.create({
          displayName:
            normalizeNullableText(input.displayName) ??
            user.nickname ??
            user.displayName,
          roleId,
          status: normalizePlatformMemberStatus(input.status),
          userId,
        }),
      );
      return toPlatformMemberDto(await this.getMemberOrThrow(member.id));
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new BadRequestException("用户已经是平台成员");
      }
      throw error;
    }
  }

  async update(memberId: string, payload: Partial<PlatformMemberPayload>) {
    const input = requirePlatformMemberPayload(payload);
    await this.memberRepository.manager.transaction(async (manager) => {
      const member = await this.getMemberOrThrow(memberId, manager, true);
      const wasActivePlatformAdmin = isActivePlatformAdminMember(member);
      let nextRole = member.role;

      if (input.displayName !== undefined) {
        member.displayName = normalizeNullableText(input.displayName);
      }
      if (input.roleId !== undefined) {
        nextRole = await this.resolvePlatformRole(input.roleId, manager);
        member.roleId = nextRole?.id ?? null;
      }
      if (input.status !== undefined) {
        member.status = normalizePlatformMemberStatus(input.status);
      }

      if (
        wasActivePlatformAdmin &&
        !isActivePlatformAdminState(nextRole, member.status)
      ) {
        await this.assertAnotherActivePlatformAdmin(member.id, manager);
      }

      if (
        input.roleId !== undefined ||
        (input.status !== undefined && member.status !== "active")
      ) {
        await manager.update(
          IntegrationToken,
          {
            organizationId: IsNull(),
            ownerUserId: member.userId,
            revokedAt: IsNull(),
            scope: "platform",
          },
          { revokedAt: new Date() },
        );
      }
      await manager.update(
        PlatformMember,
        { id: member.id },
        {
          displayName: member.displayName,
          roleId: member.roleId,
          status: member.status,
        },
      );
    });
    return toPlatformMemberDto(await this.getMemberOrThrow(memberId));
  }

  async remove(memberId: string) {
    await this.memberRepository.manager.transaction(async (manager) => {
      const member = await this.getMemberOrThrow(memberId, manager, true);
      if (isActivePlatformAdminMember(member)) {
        await this.assertAnotherActivePlatformAdmin(member.id, manager);
      }
      await manager.update(
        IntegrationToken,
        {
          organizationId: IsNull(),
          ownerUserId: member.userId,
          revokedAt: IsNull(),
          scope: "platform",
        },
        { revokedAt: new Date() },
      );
      await manager.delete(PlatformMember, { id: member.id });
    });
  }

  private async getMemberOrThrow(
    memberId: string,
    manager?: EntityManager,
    lockForUpdate = false,
  ) {
    const options = {
      lock: lockForUpdate ? ({ mode: "pessimistic_write" } as const) : undefined,
      relations: { role: true, user: true },
      where: { id: memberId },
    };
    const member = manager
      ? await manager.findOne(PlatformMember, options)
      : await this.memberRepository.findOne(options);
    if (!member) throw new NotFoundException("平台成员不存在");
    return member;
  }

  private async resolvePlatformRoleId(roleId: string | null | undefined) {
    return (await this.resolvePlatformRole(roleId))?.id ?? null;
  }

  private async resolvePlatformRole(
    roleId: string | null | undefined,
    manager?: EntityManager,
  ) {
    if (roleId === null || roleId === undefined) return null;
    if (typeof roleId !== "string" || !roleId.trim()) {
      throw new BadRequestException("角色 ID不能为空");
    }
    const role = manager
      ? await manager.findOne(Role, { where: { id: roleId.trim() } })
      : await this.roleRepository.findOne({ where: { id: roleId.trim() } });
    if (!role || role.scope !== "platform" || role.organizationId !== null) {
      throw new BadRequestException("角色不是平台角色");
    }
    return role;
  }

  private async assertAnotherActivePlatformAdmin(
    currentMemberId: string,
    manager: EntityManager,
  ) {
    const activeMembers = await manager.find(PlatformMember, {
      lock: { mode: "pessimistic_write" },
      relations: { role: true },
      where: { status: "active" },
    });
    const hasAnotherPlatformAdmin = activeMembers.some(
      (member) =>
        member.id !== currentMemberId &&
        member.role?.name === PLATFORM_ADMIN_ROLE_NAME,
    );
    if (!hasAnotherPlatformAdmin) {
      throw new BadRequestException("平台至少需要保留一个 Platform Admin");
    }
  }
}

function requirePlatformMemberPayload(
  value: PlatformMemberPayload | Partial<PlatformMemberPayload>,
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

function normalizeNullableText(value: string | null | undefined) {
  if (value !== null && value !== undefined && typeof value !== "string") {
    throw new BadRequestException("显示名称格式不正确");
  }
  const text = value?.trim();
  return text || null;
}

function normalizePlatformMemberStatus(
  value: string | null | undefined,
): PlatformMemberStatus {
  if (value === null || value === undefined) return "active";
  if (value === "active" || value === "disabled") return value;
  throw new BadRequestException("平台成员状态无效");
}

function isActivePlatformAdminMember(member: PlatformMember) {
  return isActivePlatformAdminState(member.role, member.status);
}

function isActivePlatformAdminState(
  role: Role | null | undefined,
  status: PlatformMemberStatus,
) {
  return status === "active" && role?.name === PLATFORM_ADMIN_ROLE_NAME;
}

function isUniqueConstraintError(error: unknown) {
  const typed = error as {
    code?: string;
    driverError?: { code?: string };
  };
  return typed.code === "23505" || typed.driverError?.code === "23505";
}

function toPlatformMemberDto(member: PlatformMember) {
  return {
    displayName: member.displayName,
    id: member.id,
    role: member.role,
    roleId: member.roleId,
    status: member.status,
    user: member.user ? toUserDto(member.user) : undefined,
    userId: member.userId,
  };
}
