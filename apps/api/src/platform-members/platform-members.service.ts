import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { PlatformMember, Role, User } from "@hermes-swarm/core";
import { Repository } from "typeorm";
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
  ) {}

  async list() {
    const members = await this.memberRepository.find({
      order: { createdAt: "ASC" },
      relations: { role: true, user: true },
    });
    return members.map(toPlatformMemberDto);
  }

  async create(payload: PlatformMemberPayload) {
    const userId = requireText(payload.userId, "用户 ID");
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException("用户不存在");

    const existing = await this.memberRepository.findOne({ where: { userId } });
    if (existing) throw new BadRequestException("用户已经是平台成员");

    const roleId = await this.resolvePlatformRoleId(payload.roleId);
    const member = await this.memberRepository.save(
      this.memberRepository.create({
        displayName: normalizeNullableText(payload.displayName) ?? user.nickname ?? user.displayName,
        roleId,
        status: payload.status ?? "active",
        userId,
      }),
    );
    return toPlatformMemberDto(member);
  }

  async update(memberId: string, payload: Partial<PlatformMemberPayload>) {
    const member = await this.getMemberOrThrow(memberId);
    if (payload.displayName !== undefined) {
      member.displayName = normalizeNullableText(payload.displayName);
    }
    if (payload.roleId !== undefined) {
      member.roleId = await this.resolvePlatformRoleId(payload.roleId);
    }
    if (payload.status !== undefined) {
      member.status = payload.status;
    }
    await this.memberRepository.update(
      { id: member.id },
      {
        displayName: member.displayName,
        roleId: member.roleId,
        status: member.status,
      },
    );
    return toPlatformMemberDto(await this.getMemberOrThrow(member.id));
  }

  async remove(memberId: string) {
    const member = await this.getMemberOrThrow(memberId);
    await this.memberRepository.delete({ id: member.id });
  }

  private async getMemberOrThrow(memberId: string) {
    const member = await this.memberRepository.findOne({
      relations: { role: true, user: true },
      where: { id: memberId },
    });
    if (!member) throw new NotFoundException("平台成员不存在");
    return member;
  }

  private async resolvePlatformRoleId(roleId: string | null | undefined) {
    if (roleId === null || roleId === undefined) return null;
    const role = await this.roleRepository.findOne({ where: { id: roleId } });
    if (!role || role.scope !== "platform" || role.organizationId !== null) {
      throw new BadRequestException("角色不是平台角色");
    }
    return role.id;
  }
}

function requireText(value: string | undefined, label: string) {
  const text = value?.trim();
  if (!text) throw new BadRequestException(`${label}不能为空`);
  return text;
}

function normalizeNullableText(value: string | null | undefined) {
  const text = value?.trim();
  return text || null;
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
