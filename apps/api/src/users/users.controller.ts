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
  list(@Headers("authorization") authorization?: string) {
    return this.usersService.list(authorization);
  }

  /**
   * Searches organization users by a normalized free-text query.
   */
  @Get("search")
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
