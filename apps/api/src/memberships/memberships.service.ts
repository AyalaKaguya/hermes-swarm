import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import {
  Organization,
  Role,
  User,
  UserOrganization,
} from "@hermes-swarm/core";
import { Repository } from "typeorm";
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
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
  ) {}

  async list(organizationId: string) {
    await this.ensureOrganization(organizationId);
    const memberships = await this.membershipRepository.find({
      order: { createdAt: "ASC" },
      relations: { role: true, user: true },
      where: { organizationId },
    });
    return memberships.map(toMembershipDto);
  }

  async create(organizationId: string, payload: MembershipPayload) {
    await this.ensureOrganization(organizationId);
    const userId = requireText(payload.userId, "用户 ID");
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException("用户不存在");

    const existing = await this.membershipRepository.findOne({
      where: { organizationId, userId },
    });
    if (existing) throw new BadRequestException("用户已经在该组织中");

    const roleId = await this.resolveRoleId(organizationId, payload.roleId);
    const membership = this.membershipRepository.create({
      displayName: normalizeNullableText(payload.displayName) ?? user.nickname ?? user.displayName,
      joinedAt: new Date(),
      organizationId,
      roleId,
      status: payload.status ?? "active",
      userId,
    });
    return toMembershipDto(
      await this.membershipRepository.save(membership),
    );
  }

  async update(
    organizationId: string,
    membershipId: string,
    payload: Partial<MembershipPayload>,
  ) {
    const membership = await this.getMembershipOrThrow(
      organizationId,
      membershipId,
    );

    if (payload.displayName !== undefined) {
      membership.displayName = normalizeNullableText(payload.displayName);
    }
    if (payload.roleId !== undefined) {
      membership.roleId = await this.resolveRoleId(
        organizationId,
        payload.roleId,
      );
    }
    if (payload.status !== undefined) {
      membership.status = payload.status;
    }
    membership.updatedAt = new Date();

    return toMembershipDto(await this.membershipRepository.save(membership));
  }

  async remove(organizationId: string, membershipId: string) {
    const membership = await this.getMembershipOrThrow(
      organizationId,
      membershipId,
    );
    await this.membershipRepository.delete({ id: membership.id });
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
  ) {
    const membership = await this.membershipRepository.findOne({
      relations: { role: true, user: true },
      where: { id: membershipId, organizationId },
    });
    if (!membership) throw new NotFoundException("组织成员不存在");
    return membership;
  }

  private async resolveRoleId(
    organizationId: string,
    roleId: string | null | undefined,
  ) {
    if (roleId === null || roleId === undefined) return null;
    const role = await this.roleRepository.findOne({
      where: { id: roleId },
    });
    if (!role || role.scope !== "organization" || role.organizationId !== organizationId) {
      throw new BadRequestException("角色不属于该组织");
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

function toMembershipDto(membership: UserOrganization) {
  return {
    displayName: membership.displayName,
    id: membership.id,
    joinedAt: membership.joinedAt,
    organizationId: membership.organizationId,
    role: membership.role,
    roleId: membership.roleId,
    status: membership.status,
    user: membership.user,
    userId: membership.userId,
  };
}
