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
/**
 * Exposes the management shell endpoints that bootstrap the admin UI and keep
 * legacy `/api/admin/*` routes stable while feature-specific controllers are
 * split into their own modules.
 */
export class AdminController {
  constructor(private readonly tenancyService: TenancyService) {}

  /**
   * Returns public initialization data used before an admin session exists.
   */
  @Get("bootstrap")
  getPublicBootstrap() {
    return this.tenancyService.getPublicBootstrap();
  }

  /**
   * Creates the first organization and owner account during initial setup.
   */
  @Post("onboarding")
  onboard(@Body() payload: OnboardingPayload) {
    return this.tenancyService.onboard(payload);
  }

  /**
   * Keeps the historical admin login path as an alias for the auth module.
   */
  @Post("login")
  login(@Body() payload: LoginPayload) {
    return this.tenancyService.login(payload);
  }

  /**
   * Returns the complete authenticated admin state for the active organization.
   */
  @Get("snapshot")
  async getSnapshot(@Headers("authorization") authorization?: string) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    return this.tenancyService.getSnapshot(context);
  }

  /**
   * Lists roles available inside the current organization.
   */
  @Get("roles")
  async listRoles(@Headers("authorization") authorization?: string) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    return this.tenancyService.listRoles(context);
  }

  /**
   * Replaces a role permission set using the migrated menu permission model.
   */
  @Put("roles/:roleId/permissions")
  async replaceRolePermissions(
    @Headers("authorization") authorization: string | undefined,
    @Param("roleId") roleId: string,
    @Body() payload: ReplaceRolePermissionsPayload,
  ) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    return this.tenancyService.replaceRolePermissions(context, roleId, payload);
  }

  /**
   * Lists all admin menu definitions used to build management navigation.
   */
  @Get("menus")
  async listMenus(@Headers("authorization") authorization?: string) {
    await this.tenancyService.requireAuthContext(authorization);
    return this.tenancyService.listMenus();
  }

  /**
   * Creates a menu item and backfills its permissions for existing roles.
   */
  @Post("menus")
  async createMenu(
    @Headers("authorization") authorization: string | undefined,
    @Body() payload: CreateMenuPayload,
  ) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    return this.tenancyService.createMenu(context, payload);
  }

  /**
   * Updates a menu item and keeps role permission keys aligned with menu codes.
   */
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
