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
  purpose: "platform_user",
  purposeLabel: "平台用户",
  purposeOrder: 10,
  scope: "platform",
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
    description: "查看平台用户列表。",
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
    description: "按邮箱、昵称或名称搜索平台用户。",
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
    description: "创建新的平台用户账号。",
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
  @Patch("platform/:userId")
  @AccessOperation({
    description: "更新平台用户的基础资料和状态。",
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

  /**
   * Deletes a global user through platform user management.
   */
  @Delete("platform/:userId")
  @AccessOperation({
    description: "删除平台用户账号。",
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

  /**
   * Updates an existing user profile or administrative state.
   */
  @Patch(":userId")
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
  update(
    @Headers("authorization") authorization: string | undefined,
    @Param("userId") userId: string,
    @Body() payload: UpdateUserPayload,
  ) {
    return this.usersService.update(authorization, userId, payload);
  }

  /**
   * Changes a user's password through admin or self-service flow.
   */
  @Post(":userId/password")
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
    @Param("userId") userId: string,
    @Body() payload: UpdateUserPasswordPayload,
  ) {
    return this.usersService.updatePassword(authorization, userId, payload);
  }

  /**
   * Updates the preferred language of the selected user.
   */
  @Patch(":userId/preferred-language")
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
    @Param("userId") userId: string,
    @Body() payload: UpdatePreferredLanguagePayload,
  ) {
    return this.usersService.updatePreferredLanguage(
      authorization,
      userId,
      payload,
    );
  }
}
