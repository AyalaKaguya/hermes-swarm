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
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  list(@Headers("authorization") authorization?: string) {
    return this.usersService.list(authorization);
  }

  @Get("search")
  search(
    @Headers("authorization") authorization: string | undefined,
    @Query() query: SearchUsersQuery,
  ) {
    return this.usersService.search(authorization, query);
  }

  @Post()
  create(
    @Headers("authorization") authorization: string | undefined,
    @Body() payload: CreateUserPayload,
  ) {
    return this.usersService.create(authorization, payload);
  }

  @Patch(":userId")
  update(
    @Headers("authorization") authorization: string | undefined,
    @Param("userId") userId: string,
    @Body() payload: UpdateUserPayload,
  ) {
    return this.usersService.update(authorization, userId, payload);
  }

  @Post(":userId/password")
  updatePassword(
    @Headers("authorization") authorization: string | undefined,
    @Param("userId") userId: string,
    @Body() payload: UpdateUserPasswordPayload,
  ) {
    return this.usersService.updatePassword(authorization, userId, payload);
  }

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
