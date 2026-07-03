import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  UnauthorizedException,
} from "@nestjs/common";
import { parseAuthSessionToken } from "../auth/auth-session.js";
import {
  AccessOperation,
  AccessResource,
} from "@hermes-swarm/rbac";
import {
  GroupsService,
  type OrganizationGroupPayload,
  type ReplaceOrganizationGroupMembersPayload,
} from "./groups.service.js";

@Controller("admin/organizations/:organizationId")
@AccessResource({
  entity: "group",
  entityLabel: "用户组",
  entityOrder: 50,
  purpose: "organization_group",
  purposeLabel: "组织用户组",
  purposeOrder: 10,
  scope: "organization",
})
export class GroupsController {
  constructor(
    @Inject(GroupsService)
    private readonly groupsService: GroupsService,
  ) {}

  @Get("groups")
  @AccessOperation({
    description: "查看当前组织的用户组列表。",
    label: "查看用户组列表",
    operation: "list",
    sortOrder: 10,
  })
  list(@Param("organizationId") organizationId: string) {
    return this.groupsService.list(organizationId);
  }

  @Post("groups")
  @AccessOperation({
    description: "创建当前组织的用户组。",
    label: "创建用户组",
    operation: "create",
    sortOrder: 20,
  })
  create(
    @Headers("authorization") authorization: string | undefined,
    @Param("organizationId") organizationId: string,
    @Body() payload: OrganizationGroupPayload,
  ) {
    return this.groupsService.create(
      organizationId,
      requireSessionUserId(authorization),
      payload,
    );
  }

  @Get("groups/:groupId")
  @AccessOperation({
    description: "查看当前组织的用户组详情。",
    label: "查看用户组详情",
    operation: "view",
    sortOrder: 30,
  })
  get(
    @Param("organizationId") organizationId: string,
    @Param("groupId") groupId: string,
  ) {
    return this.groupsService.get(organizationId, groupId);
  }

  @Patch("groups/:groupId")
  @AccessOperation({
    description: "更新当前组织的用户组信息。",
    label: "更新用户组",
    operation: "update_basic",
    sortOrder: 40,
  })
  update(
    @Param("organizationId") organizationId: string,
    @Param("groupId") groupId: string,
    @Body() payload: Partial<OrganizationGroupPayload>,
  ) {
    return this.groupsService.update(organizationId, groupId, payload);
  }

  @Delete("groups/:groupId")
  @AccessOperation({
    description: "删除当前组织的用户组。",
    isDangerous: true,
    label: "删除用户组",
    operation: "delete",
    sortOrder: 90,
  })
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param("organizationId") organizationId: string,
    @Param("groupId") groupId: string,
  ) {
    await this.groupsService.remove(organizationId, groupId);
  }

  @Get("groups/:groupId/members")
  @AccessOperation({
    description: "查看用户组成员。",
    label: "查看用户组成员",
    operation: "list_members",
    sortOrder: 50,
  })
  listMembers(
    @Param("organizationId") organizationId: string,
    @Param("groupId") groupId: string,
  ) {
    return this.groupsService.listMembers(organizationId, groupId);
  }

  @Put("groups/:groupId/members")
  @AccessOperation({
    description: "替换用户组成员。",
    label: "配置用户组成员",
    operation: "replace_members",
    sortOrder: 60,
  })
  replaceMembers(
    @Param("organizationId") organizationId: string,
    @Param("groupId") groupId: string,
    @Body() payload: ReplaceOrganizationGroupMembersPayload,
  ) {
    return this.groupsService.replaceMembers(
      organizationId,
      groupId,
      payload,
    );
  }

}

function requireSessionUserId(authorization: string | undefined) {
  const token = authorization?.replace(/^Bearer\s+/i, "").trim();
  const session = parseAuthSessionToken(token);
  if (!session) throw new UnauthorizedException("登录已失效，请重新登录");
  return session.userId;
}
