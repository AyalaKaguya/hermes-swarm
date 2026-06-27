import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Group, User } from "@hermes-swarm/core";
import { In, Repository } from "typeorm";
import { TenancyService } from "./tenancy.service.js";
import type { AuthContext } from "./tenancy.types.js";

export type CreateGroupPayload = {
  name: string;
  description?: string | null;
};

export type UpdateGroupPayload = {
  name?: string;
  description?: string | null;
};

export type UpdateGroupMembersPayload = {
  userIds?: string[];
};

function toGroupDto(group: Group) {
  const members = group.members ?? [];
  return {
    id: group.id,
    name: group.name,
    description: group.description,
    organizationId: group.organizationId,
    memberIds: members.map((member) => member.id),
    memberCount: members.length,
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
  };
}

@Injectable()
export class GroupsService {
  constructor(
    @InjectRepository(Group)
    private readonly groupRepository: Repository<Group>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly tenancyService: TenancyService,
  ) {}

  async listGroups(authorization: string | undefined) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    this.tenancyService.ensurePermission(context, "groups", "view");
    return this.listGroupsByOrganizationId(context.organizationId);
  }

  async listGroupsForOrganization(context: AuthContext, organizationId: string) {
    await this.tenancyService.getOrganizationById(context, organizationId);
    return this.listGroupsByOrganizationId(organizationId);
  }

  async getGroup(authorization: string | undefined, groupId: string) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    this.tenancyService.ensurePermission(context, "groups", "view");
    return toGroupDto(await this.getGroupOrThrow(context.organizationId, groupId));
  }

  async createGroup(authorization: string | undefined, payload: CreateGroupPayload) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    this.tenancyService.ensurePermission(context, "groups", "manage");
    return this.createGroupForOrganizationId(context.organizationId, payload);
  }

  async createGroupForOrganization(
    context: AuthContext,
    organizationId: string,
    payload: CreateGroupPayload,
  ) {
    this.tenancyService.ensureOrganizationAccess(context, organizationId, "manage");
    await this.tenancyService.getOrganizationById(context, organizationId);
    return this.createGroupForOrganizationId(organizationId, payload);
  }

  async updateGroup(authorization: string | undefined, groupId: string, payload: UpdateGroupPayload) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    this.tenancyService.ensurePermission(context, "groups", "manage");
    return this.updateGroupForOrganizationId(
      context.organizationId,
      groupId,
      payload,
    );
  }

  async updateGroupForOrganization(
    context: AuthContext,
    organizationId: string,
    groupId: string,
    payload: UpdateGroupPayload,
  ) {
    this.tenancyService.ensureOrganizationAccess(context, organizationId, "manage");
    await this.tenancyService.getOrganizationById(context, organizationId);
    return this.updateGroupForOrganizationId(organizationId, groupId, payload);
  }

  async updateMembers(authorization: string | undefined, groupId: string, payload: UpdateGroupMembersPayload) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    this.tenancyService.ensurePermission(context, "groups", "manage");
    return this.updateMembersForOrganizationId(
      context.organizationId,
      groupId,
      payload,
    );
  }

  async updateMembersForOrganization(
    context: AuthContext,
    organizationId: string,
    groupId: string,
    payload: UpdateGroupMembersPayload,
  ) {
    this.tenancyService.ensureOrganizationAccess(context, organizationId, "manage");
    await this.tenancyService.getOrganizationById(context, organizationId);
    return this.updateMembersForOrganizationId(organizationId, groupId, payload);
  }

  async deleteGroup(authorization: string | undefined, groupId: string) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    this.tenancyService.ensurePermission(context, "groups", "manage");
    await this.deleteGroupForOrganizationId(context.organizationId, groupId);
  }

  async deleteGroupForOrganization(
    context: AuthContext,
    organizationId: string,
    groupId: string,
  ) {
    this.tenancyService.ensureOrganizationAccess(context, organizationId, "manage");
    await this.tenancyService.getOrganizationById(context, organizationId);
    await this.deleteGroupForOrganizationId(organizationId, groupId);
  }

  private async listGroupsByOrganizationId(organizationId: string) {
    const groups = await this.groupRepository.find({
      where: { organizationId },
      relations: { members: true },
      order: { createdAt: "ASC" },
    });
    return groups.map(toGroupDto);
  }

  private async createGroupForOrganizationId(
    organizationId: string,
    payload: CreateGroupPayload,
  ) {
    const name = payload.name?.trim();
    if (!name) throw new BadRequestException("用户组名称不能为空");
    const group = await this.groupRepository.save(
      this.groupRepository.create({
        name,
        description: payload.description?.trim() || null,
        organizationId,
        members: [],
      }),
    );
    return toGroupDto(group);
  }

  private async updateGroupForOrganizationId(
    organizationId: string,
    groupId: string,
    payload: UpdateGroupPayload,
  ) {
    const group = await this.getGroupOrThrow(organizationId, groupId);
    if (payload.name !== undefined) group.name = payload.name.trim() || group.name;
    if (payload.description !== undefined) group.description = payload.description?.trim() ?? null;
    return toGroupDto(await this.groupRepository.save(group));
  }

  private async updateMembersForOrganizationId(
    organizationId: string,
    groupId: string,
    payload: UpdateGroupMembersPayload,
  ) {
    const group = await this.getGroupOrThrow(organizationId, groupId);
    const requestedIds = Array.from(new Set(payload.userIds ?? []));
    const members = requestedIds.length
      ? await this.userRepository.find({
          where: {
            id: In(requestedIds),
            organizationId,
          },
        })
      : [];

    if (members.length !== requestedIds.length) {
      throw new BadRequestException("用户组成员必须属于当前组织");
    }

    group.members = members;
    return toGroupDto(await this.groupRepository.save(group));
  }

  private async deleteGroupForOrganizationId(
    organizationId: string,
    groupId: string,
  ) {
    const group = await this.getGroupOrThrow(organizationId, groupId);
    await this.groupRepository.remove(group);
  }

  private async getGroupOrThrow(organizationId: string, groupId: string) {
    const group = await this.groupRepository.findOne({
      where: { id: groupId, organizationId },
      relations: { members: true },
    });
    if (!group) throw new NotFoundException("用户组不存在");
    return group;
  }
}
