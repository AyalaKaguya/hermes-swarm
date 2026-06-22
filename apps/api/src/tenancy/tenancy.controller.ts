import { Body, Controller, Get, Param, Patch, Post, Put } from "@nestjs/common";
import {
  CreateMenuPayload,
  CreateOrganizationPayload,
  CreateUserPayload,
  UpdateMenuPayload,
  UpdateOrganizationPayload,
  UpdateUserPayload,
  UpsertMenuPermissionsPayload,
} from "./tenancy.types.js";
import { TenancyService } from "./tenancy.service.js";

@Controller("admin")
export class TenancyController {
  constructor(private readonly tenancyService: TenancyService) {}

  @Get("tenant-admin")
  getSnapshot() {
    return this.tenancyService.getSnapshot();
  }

  @Get("organizations")
  listOrganizations() {
    return this.tenancyService.listOrganizations();
  }

  @Post("organizations")
  createOrganization(@Body() payload: CreateOrganizationPayload) {
    return this.tenancyService.createOrganization(payload);
  }

  @Patch("organizations/:organizationId")
  updateOrganization(
    @Param("organizationId") organizationId: string,
    @Body() payload: UpdateOrganizationPayload,
  ) {
    return this.tenancyService.updateOrganization(organizationId, payload);
  }

  @Get("organizations/:organizationId/users")
  listUsers(@Param("organizationId") organizationId: string) {
    return this.tenancyService.listUsers(organizationId);
  }

  @Post("organizations/:organizationId/users")
  createUser(
    @Param("organizationId") organizationId: string,
    @Body() payload: CreateUserPayload,
  ) {
    return this.tenancyService.createUser(organizationId, payload);
  }

  @Patch("organizations/:organizationId/users/:userId")
  updateUser(
    @Param("organizationId") organizationId: string,
    @Param("userId") userId: string,
    @Body() payload: UpdateUserPayload,
  ) {
    return this.tenancyService.updateUser(organizationId, userId, payload);
  }

  @Get("menus")
  listMenus() {
    return this.tenancyService.listMenus();
  }

  @Post("menus")
  createMenu(@Body() payload: CreateMenuPayload) {
    return this.tenancyService.createMenu(payload);
  }

  @Patch("menus/:menuId")
  updateMenu(
    @Param("menuId") menuId: string,
    @Body() payload: UpdateMenuPayload,
  ) {
    return this.tenancyService.updateMenu(menuId, payload);
  }

  @Get("organizations/:organizationId/users/:userId/menu-permissions")
  listUserMenuPermissions(
    @Param("organizationId") organizationId: string,
    @Param("userId") userId: string,
  ) {
    return this.tenancyService.listUserMenuPermissions(organizationId, userId);
  }

  @Put("organizations/:organizationId/users/:userId/menu-permissions")
  replaceUserMenuPermissions(
    @Param("organizationId") organizationId: string,
    @Param("userId") userId: string,
    @Body() payload: UpsertMenuPermissionsPayload,
  ) {
    return this.tenancyService.replaceUserMenuPermissions(
      organizationId,
      userId,
      payload,
    );
  }
}
