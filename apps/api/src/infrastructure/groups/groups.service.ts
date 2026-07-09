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
  UserOrganization,
} from "@hermes-swarm/core";
import { In, Repository } from "typeorm";

export type OrganizationGroupPayload = {
  color?: string | null;
  description?: string | null;
  displayName?: string;
  name?: string;
};

export type ReplaceOrganizationGroupMembersPayload = {
  membershipIds?: string[];
};

@Injectable()
export class GroupsService {
  constructor(
    @InjectRepository(Organization)
    private readonly organizationRepository: Repository<Organization>,
    @InjectRepository(OrganizationGroup)
    private readonly groupRepository: Repository<OrganizationGroup>,
    @InjectRepository(OrganizationGroupMember)
    private readonly groupMemberRepository: Repository<OrganizationGroupMember>,
    @InjectRepository(UserOrganization)
    private readonly membershipRepository: Repository<UserOrganization>,
  ) {}

  async list(organizationId: string) {
    await this.ensureOrganization(organizationId);
    const groups = await this.groupRepository.find({
      order: { createdAt: "ASC" },
      where: { organizationId },
    });
    const memberCounts = await this.countMembers(groups.map((group) => group.id));
    return groups.map((group) =>
      toGroupDto(group, memberCounts.get(group.id) ?? 0),
    );
  }

  async get(organizationId: string, groupId: string) {
    const group = await this.getGroupOrThrow(organizationId, groupId);
    const memberCount = await this.groupMemberRepository.count({
      where: { groupId: group.id, organizationId },
    });
    return toGroupDto(group, memberCount);
  }

  async create(
    organizationId: string,
    createdByUserId: string,
    payload: OrganizationGroupPayload,
  ) {
    await this.ensureOrganization(organizationId);
    const displayName = requireText(
      payload.displayName ?? payload.name,
      "用户组名称",
    );
    const name = normalizeSlug(payload.name ?? displayName, "group");
    await this.assertUniqueGroupName(organizationId, name);

    let group: OrganizationGroup;
    try {
      group = await this.groupRepository.save(
        this.groupRepository.create({
          color: normalizeNullableText(payload.color),
          createdByUserId,
          description: normalizeNullableText(payload.description),
          displayName,
          name,
          organizationId,
        }),
      );
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new BadRequestException("用户组标识已被使用");
      }
      throw error;
    }
    return toGroupDto(group, 0);
  }

  async update(
    organizationId: string,
    groupId: string,
    payload: Partial<OrganizationGroupPayload>,
  ) {
    const group = await this.getGroupOrThrow(organizationId, groupId);

    if (payload.displayName !== undefined) {
      group.displayName = requireText(payload.displayName, "用户组名称");
    }
    if (payload.name !== undefined) {
      const name = normalizeSlug(payload.name, "group");
      if (name !== group.name) {
        await this.assertUniqueGroupName(organizationId, name, group.id);
      }
      group.name = name;
    }
    if (payload.color !== undefined) {
      group.color = normalizeNullableText(payload.color);
    }
    if (payload.description !== undefined) {
      group.description = normalizeNullableText(payload.description);
    }

    let saved: OrganizationGroup;
    try {
      saved = await this.groupRepository.save(group);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new BadRequestException("用户组标识已被使用");
      }
      throw error;
    }
    const memberCount = await this.groupMemberRepository.count({
      where: { groupId: saved.id, organizationId },
    });
    return toGroupDto(saved, memberCount);
  }

  async remove(organizationId: string, groupId: string) {
    const group = await this.getGroupOrThrow(organizationId, groupId);
    await this.groupRepository.manager.transaction(async (manager) => {
      await manager.delete(OrganizationGroupMember, {
        groupId: group.id,
        organizationId,
      });
      await manager.delete(OrganizationGroup, { id: group.id, organizationId });
    });
  }

  async listMembers(organizationId: string, groupId: string) {
    await this.getGroupOrThrow(organizationId, groupId);
    const members = await this.groupMemberRepository.find({
      order: { createdAt: "ASC" },
      relations: {
        group: true,
        membership: { role: true, user: true },
        user: true,
      },
      where: { groupId, organizationId },
    });
    return members.map(toGroupMemberDto);
  }

  async replaceMembers(
    organizationId: string,
    groupId: string,
    payload: ReplaceOrganizationGroupMembersPayload,
  ) {
    const group = await this.getGroupOrThrow(organizationId, groupId);
    const membershipIds = normalizeUuidList(payload.membershipIds, "成员");

    const memberships =
      membershipIds.length === 0
        ? []
        : await this.membershipRepository.find({
            relations: { role: true, user: true },
            where: { id: In(membershipIds), organizationId },
          });
    if (memberships.length !== membershipIds.length) {
      throw new BadRequestException("成员不属于当前组织");
    }

    await this.groupMemberRepository.manager.transaction(async (manager) => {
      await manager.delete(OrganizationGroupMember, {
        groupId: group.id,
        organizationId,
      });
      if (memberships.length > 0) {
        await manager.save(
          OrganizationGroupMember,
          memberships.map((membership) =>
            this.groupMemberRepository.create({
              groupId: group.id,
              membershipId: membership.id,
              organizationId,
              userId: membership.userId,
            }),
          ),
        );
      }
    });
    return this.listMembers(organizationId, group.id);
  }

  private async ensureOrganization(organizationId: string) {
    const organization = await this.organizationRepository.findOne({
      where: { id: organizationId },
    });
    if (!organization) throw new NotFoundException("组织不存在");
  }

  private async getGroupOrThrow(organizationId: string, groupId: string) {
    const group = await this.groupRepository.findOne({
      where: { id: groupId, organizationId },
    });
    if (!group) throw new NotFoundException("用户组不存在");
    return group;
  }

  private async assertUniqueGroupName(
    organizationId: string,
    name: string,
    exceptGroupId?: string,
  ) {
    const existing = await this.groupRepository.findOne({
      where: { name, organizationId },
    });
    if (existing && existing.id !== exceptGroupId) {
      throw new BadRequestException("用户组标识已被使用");
    }
  }

  private async countMembers(groupIds: string[]) {
    if (groupIds.length === 0) return new Map<string, number>();
    const rows = (await this.groupMemberRepository
      .createQueryBuilder("member")
      .select("member.groupId", "groupId")
      .addSelect("COUNT(member.id)", "count")
      .where("member.groupId IN (:...groupIds)", { groupIds })
      .groupBy("member.groupId")
      .getRawMany()) as Array<{ count: string; groupId: string }>;
    return new Map(
      rows.map((row) => [row.groupId, Number.parseInt(row.count, 10) || 0]),
    );
  }
}

function requireText(value: string | undefined | null, label: string) {
  const text = value?.trim();
  if (!text) throw new BadRequestException(`${label}不能为空`);
  return text;
}

function normalizeNullableText(value: string | null | undefined) {
  const text = value?.trim();
  return text || null;
}

function normalizeSlug(value: string | undefined, fallbackPrefix: string) {
  const slug = value
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || `${fallbackPrefix}-${Date.now().toString(36)}`;
}

function normalizeUuidList(value: unknown, label: string) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new BadRequestException(`${label}列表格式无效`);
  }
  return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))];
}

function isUniqueConstraintError(error: unknown) {
  const typed = error as { code?: string; driverError?: { code?: string } };
  return typed.code === "23505" || typed.driverError?.code === "23505";
}

function toGroupDto(group: OrganizationGroup, memberCount: number) {
  return {
    color: group.color,
    createdAt: group.createdAt,
    createdByUserId: group.createdByUserId,
    description: group.description,
    displayName: group.displayName,
    id: group.id,
    memberCount,
    name: group.name,
    organizationId: group.organizationId,
    updatedAt: group.updatedAt,
  };
}

function toGroupMemberDto(member: OrganizationGroupMember) {
  return {
    group: member.group
      ? {
          color: member.group.color,
          displayName: member.group.displayName,
          id: member.group.id,
          name: member.group.name,
          organizationId: member.group.organizationId,
        }
      : null,
    groupId: member.groupId,
    id: member.id,
    membership: member.membership
      ? {
          displayName: member.membership.displayName,
          id: member.membership.id,
          joinedAt: member.membership.joinedAt,
          organizationId: member.membership.organizationId,
          role: member.membership.role,
          roleId: member.membership.roleId,
          status: member.membership.status,
          user: member.membership.user,
          userId: member.membership.userId,
        }
      : null,
    membershipId: member.membershipId,
    organizationId: member.organizationId,
    user: member.user,
    userId: member.userId,
  };
}
