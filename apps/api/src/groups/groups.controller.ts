import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  UnauthorizedException,
} from "@nestjs/common";
import { parseAuthSessionToken } from "../auth/auth-session.js";
import {
  FeatureAccessService,
  type FeatureAccessPayload,
} from "../feature-access/feature-access.service.js";
import { RequirePermission } from "../rbac/require-permission.decorator.js";
import {
  GroupsService,
  type OrganizationGroupPayload,
  type ReplaceOrganizationGroupMembersPayload,
} from "./groups.service.js";

@Controller("admin/organizations/:organizationId")
export class GroupsController {
  constructor(
    private readonly featureAccessService: FeatureAccessService,
    private readonly groupsService: GroupsService,
  ) {}

  @Get("groups")
  @RequirePermission({ action: "read", entity: "group", scope: "organization" })
  list(@Param("organizationId") organizationId: string) {
    return this.groupsService.list(organizationId);
  }

  @Post("groups")
  @RequirePermission({
    action: "create",
    entity: "group",
    scope: "organization",
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
  @RequirePermission({ action: "read", entity: "group", scope: "organization" })
  get(
    @Param("organizationId") organizationId: string,
    @Param("groupId") groupId: string,
  ) {
    return this.groupsService.get(organizationId, groupId);
  }

  @Patch("groups/:groupId")
  @RequirePermission({
    action: "update",
    entity: "group",
    scope: "organization",
  })
  update(
    @Param("organizationId") organizationId: string,
    @Param("groupId") groupId: string,
    @Body() payload: Partial<OrganizationGroupPayload>,
  ) {
    return this.groupsService.update(organizationId, groupId, payload);
  }

  @Delete("groups/:groupId")
  @RequirePermission({
    action: "delete",
    entity: "group",
    scope: "organization",
  })
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param("organizationId") organizationId: string,
    @Param("groupId") groupId: string,
  ) {
    await this.groupsService.remove(organizationId, groupId);
  }

  @Get("groups/:groupId/members")
  @RequirePermission({ action: "read", entity: "group", scope: "organization" })
  listMembers(
    @Param("organizationId") organizationId: string,
    @Param("groupId") groupId: string,
  ) {
    return this.groupsService.listMembers(organizationId, groupId);
  }

  @Put("groups/:groupId/members")
  @RequirePermission({
    action: "update",
    entity: "group",
    scope: "organization",
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

  @Get("feature-access")
  @RequirePermission({
    action: "read",
    entity: "setting",
    scope: "organization",
  })
  listFeatureAccess(@Param("organizationId") organizationId: string) {
    return this.featureAccessService.list(organizationId);
  }

  @Put("feature-access")
  @RequirePermission({
    action: "update",
    entity: "setting",
    scope: "organization",
  })
  replaceFeatureAccess(
    @Param("organizationId") organizationId: string,
    @Body() payload: FeatureAccessPayload,
  ) {
    return this.featureAccessService.replace(organizationId, payload);
  }
}

function requireSessionUserId(authorization: string | undefined) {
  const token = authorization?.replace(/^Bearer\s+/i, "").trim();
  const session = parseAuthSessionToken(token);
  if (!session) throw new UnauthorizedException("登录已失效，请重新登录");
  return session.userId;
}
