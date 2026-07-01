import { BadRequestException, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import {
  OrganizationFeatureGroupAccess,
  OrganizationGroup,
  OrganizationGroupMember,
} from "@hermes-swarm/core";
import { FEATURE_SETTING_DEFINITIONS } from "@hermes-swarm/core/settings/definitions";
import { In, Repository } from "typeorm";
import { RbacService } from "../rbac/rbac.service.js";
import { SettingsService } from "../settings/settings.service.js";

export type FeatureAccessPayload = {
  featureKey?: string;
  groupIds?: string[];
};

@Injectable()
export class FeatureAccessService {
  constructor(
    @InjectRepository(OrganizationFeatureGroupAccess)
    private readonly accessRepository: Repository<OrganizationFeatureGroupAccess>,
    @InjectRepository(OrganizationGroup)
    private readonly groupRepository: Repository<OrganizationGroup>,
    @InjectRepository(OrganizationGroupMember)
    private readonly groupMemberRepository: Repository<OrganizationGroupMember>,
    private readonly rbacService: RbacService,
    private readonly settingsService: SettingsService,
  ) {}

  async list(organizationId: string) {
    const rows = await this.accessRepository.find({
      order: { featureKey: "ASC", createdAt: "ASC" },
      relations: { group: true },
      where: { organizationId },
    });

    const byFeature = new Map<string, OrganizationFeatureGroupAccess[]>();
    for (const row of rows) {
      byFeature.set(row.featureKey, [
        ...(byFeature.get(row.featureKey) ?? []),
        row,
      ]);
    }

    return [...byFeature.entries()].map(([featureKey, items]) => ({
      featureKey,
      groupIds: items.map((item) => item.groupId),
      groups: items
        .map((item) => item.group)
        .filter((group): group is OrganizationGroup => Boolean(group))
        .map(toGroupBriefDto),
    }));
  }

  async replace(organizationId: string, payload: FeatureAccessPayload) {
    const featureKey = requireOrganizationFeatureKey(payload.featureKey);
    const groupIds = normalizeUuidList(payload.groupIds, "用户组");

    if (groupIds.length > 0) {
      const groups = await this.groupRepository.find({
        where: { id: In(groupIds), organizationId },
      });
      if (groups.length !== groupIds.length) {
        throw new BadRequestException("用户组不属于当前组织");
      }
    }

    await this.accessRepository.delete({ featureKey, organizationId });
    if (groupIds.length > 0) {
      await this.accessRepository.save(
        groupIds.map((groupId) =>
          this.accessRepository.create({
            featureKey,
            groupId,
            organizationId,
          }),
        ),
      );
    }

    return this.get(organizationId, featureKey);
  }

  async get(organizationId: string, featureKey: string) {
    const rows = await this.accessRepository.find({
      order: { createdAt: "ASC" },
      relations: { group: true },
      where: { featureKey, organizationId },
    });
    return {
      featureKey,
      groupIds: rows.map((row) => row.groupId),
      groups: rows
        .map((row) => row.group)
        .filter((group): group is OrganizationGroup => Boolean(group))
        .map(toGroupBriefDto),
    };
  }

  async isFeatureEnabledForUser(
    organizationId: string,
    featureKey: string,
    userId: string,
  ) {
    requireOrganizationFeatureKey(featureKey);

    const value = await this.settingsService.getOrganizationValue(
      organizationId,
      featureKey,
      "false",
    );
    if (value !== "true") return false;

    const restrictions = await this.accessRepository.find({
      select: { groupId: true, id: true },
      where: { featureKey, organizationId },
    });
    const groupIds = restrictions.map((item) => item.groupId);
    if (groupIds.length === 0) return true;

    if (await this.canBypassGroupAccess(userId, organizationId)) {
      return true;
    }

    const matchedMemberships = await this.groupMemberRepository.count({
      where: {
        groupId: In(groupIds),
        organizationId,
        userId,
      },
    });
    return matchedMemberships > 0;
  }

  private async canBypassGroupAccess(userId: string, organizationId: string) {
    return (
      (await this.rbacService.can(
        userId,
        { action: "update", entity: "setting", scope: "organization" },
        organizationId,
      )) ||
      (await this.rbacService.can(
        userId,
        { action: "update", entity: "group", scope: "organization" },
        organizationId,
      ))
    );
  }
}

const ORGANIZATION_FEATURE_KEYS: Set<string> = new Set(
  FEATURE_SETTING_DEFINITIONS.filter(
    (definition) => definition.scope === "organization",
  ).map((definition) => definition.key),
);

function requireOrganizationFeatureKey(value: string | undefined) {
  const featureKey = value?.trim();
  if (!featureKey) throw new BadRequestException("功能标识不能为空");
  if (!ORGANIZATION_FEATURE_KEYS.has(featureKey)) {
    throw new BadRequestException("功能标识不属于组织功能");
  }
  return featureKey;
}

function normalizeUuidList(value: unknown, label: string) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new BadRequestException(`${label}列表格式无效`);
  }
  return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))];
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
