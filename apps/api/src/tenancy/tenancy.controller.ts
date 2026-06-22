import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Put,
} from "@nestjs/common";
import {
  CreateMenuPayload,
  CreateUserPayload,
  LoginPayload,
  OnboardingPayload,
  ReplaceRolePermissionsPayload,
  UpdateMenuPayload,
  UpdateOrganizationPayload,
  UpdateUserPayload,
} from "./tenancy.types.js";
import { TenancyService } from "./tenancy.service.js";

@Controller("admin")
export class TenancyController {
  constructor(private readonly tenancyService: TenancyService) {}

  @Get("bootstrap")
  getPublicBootstrap() {
    return this.tenancyService.getPublicBootstrap();
  }

  @Post("onboarding")
  onboard(@Body() payload: OnboardingPayload) {
    return this.tenancyService.onboard(payload);
  }

  @Post("login")
  login(@Body() payload: LoginPayload) {
    return this.tenancyService.login(payload);
  }

  @Get("snapshot")
  async getSnapshot(@Headers("authorization") authorization?: string) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    return this.tenancyService.getSnapshot(context);
  }

  @Get("organization")
  async getOrganization(@Headers("authorization") authorization?: string) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    return this.tenancyService.getCurrentOrganization(context);
  }

  @Patch("organization")
  async updateOrganization(
    @Headers("authorization") authorization: string | undefined,
    @Body() payload: UpdateOrganizationPayload,
  ) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    return this.tenancyService.updateOrganization(context, payload);
  }

  @Get("users")
  async listUsers(@Headers("authorization") authorization?: string) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    return this.tenancyService.listUsers(context);
  }

  @Post("users")
  async createUser(
    @Headers("authorization") authorization: string | undefined,
    @Body() payload: CreateUserPayload,
  ) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    return this.tenancyService.createUser(context, payload);
  }

  @Patch("users/:userId")
  async updateUser(
    @Headers("authorization") authorization: string | undefined,
    @Param("userId") userId: string,
    @Body() payload: UpdateUserPayload,
  ) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    return this.tenancyService.updateUser(context, userId, payload);
  }

  @Get("roles")
  async listRoles(@Headers("authorization") authorization?: string) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    return this.tenancyService.listRoles(context);
  }

  @Put("roles/:roleId/permissions")
  async replaceRolePermissions(
    @Headers("authorization") authorization: string | undefined,
    @Param("roleId") roleId: string,
    @Body() payload: ReplaceRolePermissionsPayload,
  ) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    return this.tenancyService.replaceRolePermissions(context, roleId, payload);
  }

  @Get("settings")
  async listSettings(@Headers("authorization") authorization?: string) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    return this.tenancyService.listSettings(context);
  }

  @Get("menus")
  async listMenus(@Headers("authorization") authorization?: string) {
    await this.tenancyService.requireAuthContext(authorization);
    return this.tenancyService.listMenus();
  }

  @Post("menus")
  async createMenu(
    @Headers("authorization") authorization: string | undefined,
    @Body() payload: CreateMenuPayload,
  ) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    return this.tenancyService.createMenu(context, payload);
  }

  @Patch("menus/:menuId")
  async updateMenu(
    @Headers("authorization") authorization: string | undefined,
    @Param("menuId") menuId: string,
    @Body() payload: UpdateMenuPayload,
  ) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    return this.tenancyService.updateMenu(context, menuId, payload);
  }
}
