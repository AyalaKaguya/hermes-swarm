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
  LoginPayload,
  OnboardingPayload,
  ReplaceRolePermissionsPayload,
  UpdateMenuPayload,
} from "../tenancy/tenancy.types.js";
import { TenancyService } from "../tenancy/tenancy.service.js";

@Controller("admin")
export class AdminController {
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
