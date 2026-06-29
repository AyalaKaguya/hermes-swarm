import {
  Body,
  Controller,
  Get,
  Headers,
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
} from "../tenancy/tenancy.types.js";
import { RequirePermission } from "../rbac/require-permission.decorator.js";
import { UsersService } from "./users.service.js";

@Controller("admin/users")
/**
 * Exposes migrated user management endpoints under the admin namespace.
 */
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /**
   * Lists organization users visible to the current admin.
   */
  @Get()
  @RequirePermission({ action: "read", entity: "user", scope: "platform" })
  list(@Headers("authorization") authorization?: string) {
    return this.usersService.list(authorization);
  }

  /**
   * Searches organization users by a normalized free-text query.
   */
  @Get("search")
  @RequirePermission({ action: "read", entity: "user", scope: "platform" })
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
  @RequirePermission({ action: "create", entity: "user", scope: "platform" })
  create(
    @Headers("authorization") authorization: string | undefined,
    @Body() payload: CreateUserPayload,
  ) {
    return this.usersService.create(authorization, payload);
  }

  /**
   * Updates an existing user profile or administrative state.
   */
  @Patch(":userId")
  @RequirePermission({ action: "update", entity: "user", scope: "own" })
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
  @RequirePermission({ action: "update", entity: "user", scope: "own" })
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
  @RequirePermission({ action: "update", entity: "user", scope: "own" })
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
