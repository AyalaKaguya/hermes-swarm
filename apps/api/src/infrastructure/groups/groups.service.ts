import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  Organization,
  OrganizationGroup,
  OrganizationGroupMember,
  UserOrganization,
} from "@hermes-swarm/core";
import { In } from "typeorm";
import { TenantContextService } from "../../common/database/tenant-context.service.js";

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
  constructor(private readonly tenantContext: TenantContextService) {}

  async list(organizationId: string) {
    await this.ensureOrganization(organizationId);
    const groups = await this.groups.find({
      order: { createdAt: "ASC" },
      where: { organizationId, tenantId: this.tenantId },
    });
    const memberCounts = await this.countMembers(groups.map((group) => group.id));
    return groups.map((group) =>
      toGroupDto(group, memberCounts.get(group.id) ?? 0),
    );
  }

  async get(organizationId: string, groupId: string) {
    const group = await this.getGroupOrThrow(organizationId, groupId);
    const memberCount = await this.groupMembers.count({
      where: { groupId: group.id, organizationId, tenantId: this.tenantId },
    });
    return toGroupDto(group, memberCount);
  }

  async create(
    organizationId: string,
    createdByUserId: string,
    payload: OrganizationGroupPayload,
  ) {
    const input = requirePayloadObject(payload);
    await this.ensureOrganization(organizationId);
    const displayName = requireText(
      input.displayName ?? input.name,
      "用户组名称",
    );
    const name = normalizeSlug(input.name ?? displayName, "group");
    await this.assertUniqueGroupName(organizationId, name);

    let group: OrganizationGroup;
    try {
      group = await this.groups.save(
        this.groups.create({
          color: normalizeNullableText(input.color),
          createdByUserId,
          description: normalizeNullableText(input.description),
          displayName,
          name,
          organizationId,
          tenantId: this.tenantId,
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
    const input = requirePayloadObject(payload);
    const group = await this.getGroupOrThrow(organizationId, groupId);

    if (input.displayName !== undefined) {
      group.displayName = requireText(input.displayName, "用户组名称");
    }
    if (input.name !== undefined) {
      const name = normalizeSlug(input.name, "group");
      if (name !== group.name) {
        await this.assertUniqueGroupName(organizationId, name, group.id);
      }
      group.name = name;
    }
    if (input.color !== undefined) {
      group.color = normalizeNullableText(input.color);
    }
    if (input.description !== undefined) {
      group.description = normalizeNullableText(input.description);
    }

    let saved: OrganizationGroup;
    try {
      saved = await this.groups.save(group);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new BadRequestException("用户组标识已被使用");
      }
      throw error;
    }
    const memberCount = await this.groupMembers.count({
      where: { groupId: saved.id, organizationId, tenantId: this.tenantId },
    });
    return toGroupDto(saved, memberCount);
  }

  async remove(organizationId: string, groupId: string) {
    const group = await this.getGroupOrThrow(organizationId, groupId);
    await this.manager.delete(OrganizationGroupMember, {
      groupId: group.id,
      organizationId,
      tenantId: this.tenantId,
    });
    await this.manager.delete(OrganizationGroup, {
      id: group.id,
      organizationId,
      tenantId: this.tenantId,
    });
  }

  async listMembers(organizationId: string, groupId: string) {
    await this.getGroupOrThrow(organizationId, groupId);
    const members = await this.groupMembers.find({
      order: { createdAt: "ASC" },
      relations: {
        group: true,
        membership: { role: true, user: true },
        user: true,
      },
      where: { groupId, organizationId, tenantId: this.tenantId },
    });
    return members.map(toGroupMemberDto);
  }

  async replaceMembers(
    organizationId: string,
    groupId: string,
    payload: ReplaceOrganizationGroupMembersPayload,
  ) {
    const input = requirePayloadObject(payload);
    const group = await this.getGroupOrThrow(organizationId, groupId);
    const membershipIds = normalizeUuidList(input.membershipIds, "成员");

    const memberships =
      membershipIds.length === 0
        ? []
        : await this.memberships.find({
            relations: { role: true, user: true },
            where: {
              id: In(membershipIds),
              organizationId,
              tenantId: this.tenantId,
            },
          });
    if (memberships.length !== membershipIds.length) {
      throw new BadRequestException("成员不属于当前组织");
    }

    await this.manager.delete(OrganizationGroupMember, {
      groupId: group.id,
      organizationId,
      tenantId: this.tenantId,
    });
    if (memberships.length > 0) {
      await this.manager.save(
        OrganizationGroupMember,
        memberships.map((membership) =>
          this.groupMembers.create({
            groupId: group.id,
            membershipId: membership.id,
            organizationId,
            tenantId: this.tenantId,
            userId: membership.userId,
          }),
        ),
      );
    }
    return this.listMembers(organizationId, group.id);
  }

  private async ensureOrganization(organizationId: string) {
    const organization = await this.organizations.findOne({
      where: { id: organizationId, tenantId: this.tenantId },
    });
    if (!organization) throw new NotFoundException("组织不存在");
  }

  private async getGroupOrThrow(organizationId: string, groupId: string) {
    const group = await this.groups.findOne({
      where: { id: groupId, organizationId, tenantId: this.tenantId },
    });
    if (!group) throw new NotFoundException("用户组不存在");
    return group;
  }

  private async assertUniqueGroupName(
    organizationId: string,
    name: string,
    exceptGroupId?: string,
  ) {
    const existing = await this.groups.findOne({
      where: { name, organizationId, tenantId: this.tenantId },
    });
    if (existing && existing.id !== exceptGroupId) {
      throw new BadRequestException("用户组标识已被使用");
    }
  }

  private async countMembers(groupIds: string[]) {
    if (groupIds.length === 0) return new Map<string, number>();
    const rows = (await this.groupMembers
      .createQueryBuilder("member")
      .select("member.groupId", "groupId")
      .addSelect("COUNT(member.id)", "count")
      .where("member.groupId IN (:...groupIds)", { groupIds })
      .andWhere("member.tenantId = :tenantId", { tenantId: this.tenantId })
      .groupBy("member.groupId")
      .getRawMany()) as Array<{ count: string; groupId: string }>;
    return new Map(
      rows.map((row) => [row.groupId, Number.parseInt(row.count, 10) || 0]),
    );
  }

  private get tenantId() {
    return this.tenantContext.current()!.tenantId;
  }

  private get manager() {
    return this.tenantContext.current()!.manager;
  }

  private get organizations() {
    return this.tenantContext.repository(Organization);
  }

  private get groups() {
    return this.tenantContext.repository(OrganizationGroup);
  }

  private get groupMembers() {
    return this.tenantContext.repository(OrganizationGroupMember);
  }

  private get memberships() {
    return this.tenantContext.repository(UserOrganization);
  }
}

function requirePayloadObject<T extends object>(value: T) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException("请求内容无效");
  }
  return value;
}

function requireText(value: string | undefined | null, label: string) {
  if (value !== undefined && value !== null && typeof value !== "string") {
    throw new BadRequestException(`${label}格式不正确`);
  }
  const text = value?.trim();
  if (!text) throw new BadRequestException(`${label}不能为空`);
  return text;
}

function normalizeNullableText(value: string | null | undefined) {
  if (value !== undefined && value !== null && typeof value !== "string") {
    throw new BadRequestException("文本格式不正确");
  }
  const text = value?.trim();
  return text || null;
}

function normalizeSlug(value: string | undefined, fallbackPrefix: string) {
  if (value !== undefined && typeof value !== "string") {
    throw new BadRequestException("用户组标识格式不正确");
  }
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
  const normalized = value.map((item) => {
    if (typeof item !== "string") {
      throw new BadRequestException(`${label}列表格式无效`);
    }
    return item.trim();
  });
  return [...new Set(normalized.filter(Boolean))];
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
