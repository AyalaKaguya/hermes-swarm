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
  Put,
  Query,
} from "@nestjs/common";
import type {
  SearchUsersQuery,
  UpdateRuntimePreferencesPayload,
  UpdateSelfProfilePayload,
  UpdateAccountPasswordPayload,
} from "../../common/admin-api.types.js";
import {
  AccessOperation,
  AccessResource,
  PublicAccess,
} from "@hermes-swarm/rbac";
import { UsersService } from "./users.service.js";

@Controller("admin/workspace/members")
@AccessResource({
  entity: "membership",
  entityLabel: "成员关系",
  entityOrder: 10,
  purpose: "workspace_member",
  purposeLabel: "工作空间成员",
  purposeOrder: 10,
  scope: "workspace",
})
export class UsersController {
  constructor(
    @Inject(UsersService)
    private readonly usersService: UsersService,
  ) {}

  @Get()
  @AccessOperation({
    description: "查看当前工作空间的成员关系、状态和角色。",
    label: "查看成员列表",
    operation: "list",
    sortOrder: 10,
  })
  list(@Headers("authorization") authorization?: string) {
    return this.usersService.list(authorization);
  }

  @Get("search")
  @AccessOperation({
    description: "搜索当前工作空间已有成员。",
    label: "搜索成员",
    operation: "search",
    sortOrder: 20,
  })
  search(
    @Headers("authorization") authorization: string | undefined,
    @Query() query: SearchUsersQuery,
  ) {
    return this.usersService.search(authorization, query);
  }

  @Put(":membershipId/role")
  @AccessOperation({
    description: "替换当前成员关系的工作空间角色。",
    label: "配置成员角色",
    operation: "replace_role",
    sortOrder: 40,
  })
  replaceRole(
    @Headers("authorization") authorization: string | undefined,
    @Param("membershipId") membershipId: string,
    @Body() payload: { roleId?: string },
  ) {
    return this.usersService.replaceWorkspaceRole(
      authorization,
      membershipId,
      typeof payload?.roleId === "string" ? payload.roleId : "",
    );
  }

  @Patch(":membershipId/status")
  @AccessOperation({
    description: "停用、恢复或重新激活当前工作空间成员关系。",
    isDangerous: true,
    label: "更新成员状态",
    operation: "update_status",
    sortOrder: 50,
  })
  updateStatus(
    @Headers("authorization") authorization: string | undefined,
    @Param("membershipId") membershipId: string,
    @Body() payload: { roleId?: string; status?: "active" | "disabled" | "removed" },
  ) {
    return this.usersService.updateMembershipStatus(
      authorization,
      membershipId,
      payload?.status ?? "disabled",
      payload?.roleId,
    );
  }

  @Delete(":membershipId")
  @AccessOperation({
    description: "移除当前工作空间成员关系，不删除全局账号。",
    isDangerous: true,
    label: "移除成员",
    operation: "remove",
    sortOrder: 90,
  })
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Headers("authorization") authorization: string | undefined,
    @Param("membershipId") membershipId: string,
  ) {
    return this.usersService.removeMembership(authorization, membershipId);
  }
}

@Controller("admin/account")
@AccessResource({
  entity: "account",
  entityLabel: "账号",
  purpose: "self_profile",
  purposeLabel: "全局账号",
  scope: "own",
})
export class AccountController {
  constructor(
    @Inject(UsersService)
    private readonly usersService: UsersService,
  ) {}

  @Get()
  @PublicAccess({ reason: "Current account session validation is handled by UsersService." })
  get(@Headers("authorization") authorization?: string) {
    return this.usersService.getAccount(authorization);
  }

  @Patch()
  @AccessOperation({
    description: "更新适用于所有工作空间的全局账号资料。",
    label: "更新全局账号资料",
    operation: "update_profile",
    sortOrder: 10,
  })
  update(
    @Headers("authorization") authorization: string | undefined,
    @Body() payload: UpdateSelfProfilePayload,
  ) {
    return this.usersService.updateAccount(authorization, payload);
  }

  @Patch("preferences")
  @AccessOperation({
    description: "更新适用于所有工作空间的语言和时区。",
    label: "更新全局账号偏好",
    operation: "update_preferences",
    sortOrder: 20,
  })
  preferences(
    @Headers("authorization") authorization: string | undefined,
    @Body() payload: UpdateRuntimePreferencesPayload,
  ) {
    return this.usersService.updateRuntimePreferences(authorization, payload);
  }

  @Patch("password")
  @AccessOperation({
    description: "修改全局账号密码并撤销所有工作空间会话。",
    isDangerous: true,
    label: "修改全局账号密码",
    operation: "change_password",
    sortOrder: 30,
  })
  password(
    @Headers("authorization") authorization: string | undefined,
    @Body() payload: UpdateAccountPasswordPayload,
  ) {
    return this.usersService.updatePassword(authorization, payload);
  }
}
