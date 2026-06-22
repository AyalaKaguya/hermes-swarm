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
  AdminLoginPayload,
  CreateMenuPayload,
  CreateOrganizationPayload,
  CreateTenantPayload,
  CreateUserPayload,
  OnboardingPayload,
  ReplaceRolePermissionsPayload,
  UpdateMenuPayload,
  UpdateOrganizationPayload,
  UpdateTenantPayload,
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
  login(@Body() payload: AdminLoginPayload) {
    return this.tenancyService.login(payload);
  }

  @Get("tenant-admin")
  async getSnapshot(@Headers("authorization") authorization?: string) {
    const context = await this.tenancyService.requireAdminContext(authorization);
    return this.tenancyService.getSnapshot(context);
  }

  @Get("tenants")
  async listTenants(@Headers("authorization") authorization?: string) {
    const context = await this.tenancyService.requireAdminContext(authorization);
    return this.tenancyService.listTenants(context);
  }

  @Post("tenants")
  async createTenant(
    @Headers("authorization") authorization: string | undefined,
    @Body() payload: CreateTenantPayload,
  ) {
    const context = await this.tenancyService.requireAdminContext(authorization);
    return this.tenancyService.createTenant(context, payload);
  }

  @Patch("tenants/:tenantId")
  async updateTenant(
    @Headers("authorization") authorization: string | undefined,
    @Param("tenantId") tenantId: string,
    @Body() payload: UpdateTenantPayload,
  ) {
    const context = await this.tenancyService.requireAdminContext(authorization);
    return this.tenancyService.updateTenant(context, tenantId, payload);
  }

  @Get("organizations")
  async listOrganizations(@Headers("authorization") authorization?: string) {
    const context = await this.tenancyService.requireAdminContext(authorization);
    return this.tenancyService.listOrganizations(context);
  }

  @Post("organizations")
  async createOrganization(
    @Headers("authorization") authorization: string | undefined,
    @Body() payload: CreateOrganizationPayload,
  ) {
    const context = await this.tenancyService.requireAdminContext(authorization);
    return this.tenancyService.createOrganization(context, payload);
  }

  @Patch("organizations/:organizationId")
  async updateOrganization(
    @Headers("authorization") authorization: string | undefined,
    @Param("organizationId") organizationId: string,
    @Body() payload: UpdateOrganizationPayload,
  ) {
    const context = await this.tenancyService.requireAdminContext(authorization);
    return this.tenancyService.updateOrganization(
      context,
      organizationId,
      payload,
    );
  }

  @Get("organizations/:organizationId/users")
  async listUsers(
    @Headers("authorization") authorization: string | undefined,
    @Param("organizationId") organizationId: string,
  ) {
    const context = await this.tenancyService.requireAdminContext(authorization);
    return this.tenancyService.listUsers(context, organizationId);
  }

  @Post("organizations/:organizationId/users")
  async createUser(
    @Headers("authorization") authorization: string | undefined,
    @Param("organizationId") organizationId: string,
    @Body() payload: CreateUserPayload,
  ) {
    const context = await this.tenancyService.requireAdminContext(authorization);
    return this.tenancyService.createUser(context, organizationId, payload);
  }

  @Patch("organizations/:organizationId/users/:userId")
  async updateUser(
    @Headers("authorization") authorization: string | undefined,
    @Param("organizationId") organizationId: string,
    @Param("userId") userId: string,
    @Body() payload: UpdateUserPayload,
  ) {
    const context = await this.tenancyService.requireAdminContext(authorization);
    return this.tenancyService.updateUser(
      context,
      organizationId,
      userId,
      payload,
    );
  }

  @Get("roles")
  async listRoles(@Headers("authorization") authorization?: string) {
    const context = await this.tenancyService.requireAdminContext(authorization);
    return this.tenancyService.listRoles(context);
  }

  @Put("roles/:roleId/permissions")
  async replaceRolePermissions(
    @Headers("authorization") authorization: string | undefined,
    @Param("roleId") roleId: string,
    @Body() payload: ReplaceRolePermissionsPayload,
  ) {
    const context = await this.tenancyService.requireAdminContext(authorization);
    return this.tenancyService.replaceRolePermissions(context, roleId, payload);
  }

  @Get("menus")
  async listMenus(@Headers("authorization") authorization?: string) {
    await this.tenancyService.requireAdminContext(authorization);
    return this.tenancyService.listMenus();
  }

  @Post("menus")
  async createMenu(
    @Headers("authorization") authorization: string | undefined,
    @Body() payload: CreateMenuPayload,
  ) {
    const context = await this.tenancyService.requireAdminContext(authorization);
    return this.tenancyService.createMenu(context, payload);
  }

  @Patch("menus/:menuId")
  async updateMenu(
    @Headers("authorization") authorization: string | undefined,
    @Param("menuId") menuId: string,
    @Body() payload: UpdateMenuPayload,
  ) {
    const context = await this.tenancyService.requireAdminContext(authorization);
    return this.tenancyService.updateMenu(context, menuId, payload);
  }
}
