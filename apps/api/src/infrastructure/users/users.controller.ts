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
  Query,
} from "@nestjs/common";
import type {
  CreateUserPayload,
  SearchUsersQuery,
  UpdatePreferredLanguagePayload,
  UpdateUserPasswordPayload,
  UpdateUserPayload,
} from "../../common/admin-api.types.js";
import {
  AccessOperation,
  AccessResource,
} from "@hermes-swarm/rbac";
import { UsersService } from "./users.service.js";

@Controller("admin/users")
@AccessResource({
  entity: "user",
  entityLabel: "用户",
  entityOrder: 10,
  purpose: "tenant_user",
  purposeLabel: "工作空间用户",
  purposeOrder: 10,
  scope: "tenant",
})
/**
 * Exposes migrated user management endpoints under the admin namespace.
 */
export class UsersController {
  constructor(
    @Inject(UsersService)
    private readonly usersService: UsersService,
  ) {}

  /**
   * Lists organization users visible to the current admin.
   */
  @Get()
  @AccessOperation({
    description: "查看当前工作空间的用户列表。",
    label: "查看用户列表",
    operation: "list",
    sortOrder: 10,
  })
  list(@Headers("authorization") authorization?: string) {
    return this.usersService.list(authorization);
  }

  /**
   * Searches organization users by a normalized free-text query.
   */
  @Get("search")
  @AccessOperation({
    description: "按邮箱、昵称或名称搜索当前工作空间用户。",
    label: "搜索用户",
    operation: "search",
    sortOrder: 20,
  })
  search(
    @Headers("authorization") authorization: string | undefined,
    @Query() query: SearchUsersQuery,
  ) {
    return this.usersService.search(authorization, query);
  }

  /**
   * Creates a user in the current organization.
   */
  @Post()
  @AccessOperation({
    description: "在当前工作空间创建用户账号。",
    label: "创建用户",
    operation: "create",
    sortOrder: 30,
  })
  create(
    @Headers("authorization") authorization: string | undefined,
    @Body() payload: CreateUserPayload,
  ) {
    return this.usersService.create(authorization, payload);
  }

  /**
   * Updates a global user through platform user management.
   */
  @Patch("me")
  @AccessOperation({
    description: "更新自己的个人资料。",
    entity: "user",
    entityLabel: "用户",
    operation: "update_profile",
    label: "更新个人资料",
    purpose: "self_profile",
    purposeLabel: "个人资料",
    scope: "own",
    sortOrder: 10,
  })
  updateSelf(
    @Headers("authorization") authorization: string | undefined,
    @Body() payload: UpdateUserPayload,
  ) {
    return this.usersService.updateSelf(authorization, payload);
  }

  @Post("me/password")
  @AccessOperation({
    description: "修改自己的登录密码。",
    entity: "user",
    entityLabel: "用户",
    operation: "change_password",
    label: "修改密码",
    purpose: "self_profile",
    purposeLabel: "个人资料",
    scope: "own",
    sortOrder: 20,
  })
  updatePassword(
    @Headers("authorization") authorization: string | undefined,
    @Body() payload: UpdateUserPasswordPayload,
  ) {
    return this.usersService.updatePassword(authorization, payload);
  }

  @Patch("me/preferred-language")
  @AccessOperation({
    description: "修改自己的界面语言偏好。",
    entity: "user",
    entityLabel: "用户",
    operation: "update_language",
    label: "修改语言偏好",
    purpose: "self_profile",
    purposeLabel: "个人资料",
    scope: "own",
    sortOrder: 30,
  })
  updatePreferredLanguage(
    @Headers("authorization") authorization: string | undefined,
    @Body() payload: UpdatePreferredLanguagePayload,
  ) {
    return this.usersService.updatePreferredLanguage(authorization, payload);
  }

  @Patch(":userId")
  @AccessOperation({
    description: "更新当前工作空间用户的基础资料和状态。",
    label: "更新用户",
    operation: "update_basic",
    sortOrder: 40,
  })
  updateManaged(
    @Headers("authorization") authorization: string | undefined,
    @Param("userId") userId: string,
    @Body() payload: UpdateUserPayload,
  ) {
    return this.usersService.updateManaged(authorization, userId, payload);
  }

  @Put(":userId/role")
  @AccessOperation({
    description: "替换当前工作空间用户的工作空间角色。",
    label: "配置工作空间角色",
    operation: "replace_roles",
    sortOrder: 50,
  })
  replaceTenantRoles(
    @Headers("authorization") authorization: string | undefined,
    @Param("userId") userId: string,
    @Body() payload: { roleId?: string },
  ) {
    return this.usersService.replaceTenantRole(
      authorization,
      userId,
      typeof payload?.roleId === "string" ? payload.roleId : "",
    );
  }

  @Delete(":userId")
  @AccessOperation({
    description: "删除当前工作空间用户账号。",
    isDangerous: true,
    label: "删除用户",
    operation: "delete",
    sortOrder: 90,
  })
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteManaged(
    @Headers("authorization") authorization: string | undefined,
    @Param("userId") userId: string,
  ) {
    await this.usersService.deleteManaged(authorization, userId);
  }
}
