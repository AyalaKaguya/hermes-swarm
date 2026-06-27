import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Put,
} from "@nestjs/common";
import type {
  CreateOrganizationPayload,
  CreateUserPayload,
  SaveSettingsPayload,
  UpdateOrganizationPayload,
  UpdateUserPayload,
} from "../tenancy/tenancy.types.js";
import type {
  CreateGroupPayload,
  UpdateGroupMembersPayload,
  UpdateGroupPayload,
} from "../tenancy/groups.service.js";
import { OrganizationsService } from "./organizations.service.js";

@Controller("admin")
/**
 * Exposes current-organization and organization-list management endpoints
 * under the shared admin route namespace.
 */
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  /**
   * Returns the active organization for the authenticated admin.
   */
  @Get("organization")
  current(@Headers("authorization") authorization?: string) {
    return this.organizationsService.current(authorization);
  }

  /**
   * Updates the active organization for the authenticated admin.
   */
  @Patch("organization")
  updateCurrent(
    @Headers("authorization") authorization: string | undefined,
    @Body() payload: UpdateOrganizationPayload,
  ) {
    return this.organizationsService.updateCurrent(authorization, payload);
  }

  /**
   * Lists organizations managed through the admin backend.
   */
  @Get("organizations")
  list(@Headers("authorization") authorization?: string) {
    return this.organizationsService.list(authorization);
  }

  /**
   * Returns a managed organization selected by id.
   */
  @Get("organizations/:organizationId")
  get(
    @Headers("authorization") authorization: string | undefined,
    @Param("organizationId") organizationId: string,
  ) {
    return this.organizationsService.get(authorization, organizationId);
  }

  /**
   * Returns organization settings selected by explicit organization id.
   */
  @Get("organizations/:organizationId/settings")
  listSettings(
    @Headers("authorization") authorization: string | undefined,
    @Param("organizationId") organizationId: string,
  ) {
    return this.organizationsService.listSettings(
      authorization,
      organizationId,
    );
  }

  /**
   * Creates a managed organization and provisions its admin infrastructure.
   */
  @Post("organizations")
  create(
    @Headers("authorization") authorization: string | undefined,
    @Body() payload: CreateOrganizationPayload,
  ) {
    return this.organizationsService.create(authorization, payload);
  }

  /**
   * Updates a managed organization selected by id.
   */
  @Patch("organizations/:organizationId")
  update(
    @Headers("authorization") authorization: string | undefined,
    @Param("organizationId") organizationId: string,
    @Body() payload: UpdateOrganizationPayload,
  ) {
    return this.organizationsService.update(
      authorization,
      organizationId,
      payload,
    );
  }

  /**
   * Saves organization settings selected by explicit organization id.
   */
  @Put("organizations/:organizationId/settings")
  saveSettings(
    @Headers("authorization") authorization: string | undefined,
    @Param("organizationId") organizationId: string,
    @Body() payload: SaveSettingsPayload,
  ) {
    return this.organizationsService.saveSettings(
      authorization,
      organizationId,
      payload,
    );
  }

  /**
   * Lists users in a managed organization selected by id.
   */
  @Get("organizations/:organizationId/users")
  listUsers(
    @Headers("authorization") authorization: string | undefined,
    @Param("organizationId") organizationId: string,
  ) {
    return this.organizationsService.listUsers(authorization, organizationId);
  }

  /**
   * Creates a user in a managed organization selected by id.
   */
  @Post("organizations/:organizationId/users")
  createUser(
    @Headers("authorization") authorization: string | undefined,
    @Param("organizationId") organizationId: string,
    @Body() payload: CreateUserPayload,
  ) {
    return this.organizationsService.createUser(
      authorization,
      organizationId,
      payload,
    );
  }

  /**
   * Updates a user in a managed organization selected by id.
   */
  @Patch("organizations/:organizationId/users/:userId")
  updateUser(
    @Headers("authorization") authorization: string | undefined,
    @Param("organizationId") organizationId: string,
    @Param("userId") userId: string,
    @Body() payload: UpdateUserPayload,
  ) {
    return this.organizationsService.updateUser(
      authorization,
      organizationId,
      userId,
      payload,
    );
  }

  /**
   * Lists roles in a managed organization selected by id.
   */
  @Get("organizations/:organizationId/roles")
  listRoles(
    @Headers("authorization") authorization: string | undefined,
    @Param("organizationId") organizationId: string,
  ) {
    return this.organizationsService.listRoles(authorization, organizationId);
  }

  /**
   * Lists user groups in a managed organization selected by id.
   */
  @Get("organizations/:organizationId/groups")
  listGroups(
    @Headers("authorization") authorization: string | undefined,
    @Param("organizationId") organizationId: string,
  ) {
    return this.organizationsService.listGroups(authorization, organizationId);
  }

  /**
   * Creates a user group in a managed organization selected by id.
   */
  @Post("organizations/:organizationId/groups")
  createGroup(
    @Headers("authorization") authorization: string | undefined,
    @Param("organizationId") organizationId: string,
    @Body() payload: CreateGroupPayload,
  ) {
    return this.organizationsService.createGroup(
      authorization,
      organizationId,
      payload,
    );
  }

  /**
   * Updates a user group in a managed organization selected by id.
   */
  @Patch("organizations/:organizationId/groups/:groupId")
  updateGroup(
    @Headers("authorization") authorization: string | undefined,
    @Param("organizationId") organizationId: string,
    @Param("groupId") groupId: string,
    @Body() payload: UpdateGroupPayload,
  ) {
    return this.organizationsService.updateGroup(
      authorization,
      organizationId,
      groupId,
      payload,
    );
  }

  /**
   * Replaces members for a user group in a managed organization selected by id.
   */
  @Put("organizations/:organizationId/groups/:groupId/members")
  updateGroupMembers(
    @Headers("authorization") authorization: string | undefined,
    @Param("organizationId") organizationId: string,
    @Param("groupId") groupId: string,
    @Body() payload: UpdateGroupMembersPayload,
  ) {
    return this.organizationsService.updateGroupMembers(
      authorization,
      organizationId,
      groupId,
      payload,
    );
  }

  /**
   * Deletes a user group in a managed organization selected by id.
   */
  @Delete("organizations/:organizationId/groups/:groupId")
  deleteGroup(
    @Headers("authorization") authorization: string | undefined,
    @Param("organizationId") organizationId: string,
    @Param("groupId") groupId: string,
  ) {
    return this.organizationsService.deleteGroup(
      authorization,
      organizationId,
      groupId,
    );
  }
}
