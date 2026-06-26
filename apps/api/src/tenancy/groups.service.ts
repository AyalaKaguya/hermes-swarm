import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Group, User } from "@hermes-swarm/core";
import { In, Repository } from "typeorm";
import { TenancyService } from "./tenancy.service.js";

type CreateGroupPayload = {
  name: string;
  description?: string | null;
};

type UpdateGroupPayload = {
  name?: string;
  description?: string | null;
};

type UpdateGroupMembersPayload = {
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
    const groups = await this.groupRepository.find({
      where: { organizationId: context.organizationId },
      relations: { members: true },
      order: { createdAt: "ASC" },
    });
    return groups.map(toGroupDto);
  }

  async getGroup(authorization: string | undefined, groupId: string) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    this.tenancyService.ensurePermission(context, "groups", "view");
    const group = await this.groupRepository.findOne({
      where: { id: groupId, organizationId: context.organizationId },
      relations: { members: true },
    });
    if (!group) throw new NotFoundException("用户组不存在");
    return toGroupDto(group);
  }

  async createGroup(authorization: string | undefined, payload: CreateGroupPayload) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    this.tenancyService.ensurePermission(context, "groups", "manage");
    const name = payload.name?.trim();
    if (!name) throw new BadRequestException("用户组名称不能为空");
    const group = await this.groupRepository.save(
      this.groupRepository.create({
        name,
        description: payload.description?.trim() || null,
        organizationId: context.organizationId,
        members: [],
      }),
    );
    return toGroupDto(group);
  }

  async updateGroup(authorization: string | undefined, groupId: string, payload: UpdateGroupPayload) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    this.tenancyService.ensurePermission(context, "groups", "manage");
    const group = await this.groupRepository.findOne({
      where: { id: groupId, organizationId: context.organizationId },
      relations: { members: true },
    });
    if (!group) throw new NotFoundException("用户组不存在");
    if (payload.name !== undefined) group.name = payload.name.trim() || group.name;
    if (payload.description !== undefined) group.description = payload.description?.trim() ?? null;
    return toGroupDto(await this.groupRepository.save(group));
  }

  async updateMembers(authorization: string | undefined, groupId: string, payload: UpdateGroupMembersPayload) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    this.tenancyService.ensurePermission(context, "groups", "manage");
    const group = await this.groupRepository.findOne({
      where: { id: groupId, organizationId: context.organizationId },
      relations: { members: true },
    });
    if (!group) throw new NotFoundException("用户组不存在");

    const requestedIds = Array.from(new Set(payload.userIds ?? []));
    const members = requestedIds.length
      ? await this.userRepository.find({
          where: {
            id: In(requestedIds),
            organizationId: context.organizationId,
          },
        })
      : [];

    if (members.length !== requestedIds.length) {
      throw new BadRequestException("用户组成员必须属于当前组织");
    }

    group.members = members;
    return toGroupDto(await this.groupRepository.save(group));
  }

  async deleteGroup(authorization: string | undefined, groupId: string) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    this.tenancyService.ensurePermission(context, "groups", "manage");
    const group = await this.groupRepository.findOne({
      where: { id: groupId, organizationId: context.organizationId },
      relations: { members: true },
    });
    if (!group) throw new NotFoundException("用户组不存在");
    await this.groupRepository.remove(group);
  }
}
