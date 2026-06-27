import { Injectable } from "@nestjs/common";
import type {
  CreateOrganizationPayload,
  CreateUserPayload,
  SaveSettingsPayload,
  UpdateOrganizationPayload,
  UpdateUserPayload,
} from "../tenancy/tenancy.types.js";
import { TenancyService } from "../tenancy/tenancy.service.js";
import {
  GroupsService,
  type CreateGroupPayload,
  type UpdateGroupMembersPayload,
  type UpdateGroupPayload,
} from "../tenancy/groups.service.js";

@Injectable()
/**
 * Handles tenant/organization management using the current Organization model
 * as the migrated boundary for xpert tenant and organization concepts.
 */
export class OrganizationsService {
  constructor(
    private readonly groupsService: GroupsService,
    private readonly tenancyService: TenancyService,
  ) {}

  /**
   * Returns the organization associated with the current admin session.
   */
  async current(authorization: string | undefined) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    return this.tenancyService.getCurrentOrganization(context);
  }

  /**
   * Updates the current organization profile and operational settings.
   */
  async updateCurrent(
    authorization: string | undefined,
    payload: UpdateOrganizationPayload,
  ) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    return this.tenancyService.updateOrganization(context, payload);
  }

  /**
   * Lists organizations available to admins with organization view access.
   */
  async list(authorization: string | undefined) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    return this.tenancyService.listOrganizations(context);
  }

  /**
   * Loads one organization by explicit id.
   */
  async get(authorization: string | undefined, organizationId: string) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    return this.tenancyService.getOrganizationById(context, organizationId);
  }

  /**
   * Lists settings for an organization selected by explicit id.
   */
  async listSettings(authorization: string | undefined, organizationId: string) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    return this.tenancyService.listSettingsForOrganization(
      context,
      organizationId,
    );
  }

  /**
   * Creates an organization and initializes its roles, permissions, and defaults.
   */
  async create(
    authorization: string | undefined,
    payload: CreateOrganizationPayload,
  ) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    return this.tenancyService.createOrganization(context, payload);
  }

  /**
   * Updates an organization selected by id from the admin organization list.
   */
  async update(
    authorization: string | undefined,
    organizationId: string,
    payload: UpdateOrganizationPayload,
  ) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    return this.tenancyService.updateOrganizationById(
      context,
      organizationId,
      payload,
    );
  }

  /**
   * Saves settings for an organization selected by explicit id.
   */
  async saveSettings(
    authorization: string | undefined,
    organizationId: string,
    payload: SaveSettingsPayload,
  ) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    return this.tenancyService.saveSettingsForOrganization(
      context,
      organizationId,
      payload,
    );
  }

  /**
   * Lists users for an organization selected by explicit id.
   */
  async listUsers(authorization: string | undefined, organizationId: string) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    return this.tenancyService.listUsersForOrganization(context, organizationId);
  }

  /**
   * Creates a user for an organization selected by explicit id.
   */
  async createUser(
    authorization: string | undefined,
    organizationId: string,
    payload: CreateUserPayload,
  ) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    return this.tenancyService.createUserForOrganization(
      context,
      organizationId,
      payload,
    );
  }

  /**
   * Updates a user for an organization selected by explicit id.
   */
  async updateUser(
    authorization: string | undefined,
    organizationId: string,
    userId: string,
    payload: UpdateUserPayload,
  ) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    return this.tenancyService.updateUserForOrganization(
      context,
      organizationId,
      userId,
      payload,
    );
  }

  /**
   * Lists roles for an organization selected by explicit id.
   */
  async listRoles(authorization: string | undefined, organizationId: string) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    return this.tenancyService.listRolesForOrganization(context, organizationId);
  }

  /**
   * Lists user groups for an organization selected by explicit id.
   */
  async listGroups(authorization: string | undefined, organizationId: string) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    return this.groupsService.listGroupsForOrganization(context, organizationId);
  }

  /**
   * Creates a user group for an organization selected by explicit id.
   */
  async createGroup(
    authorization: string | undefined,
    organizationId: string,
    payload: CreateGroupPayload,
  ) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    return this.groupsService.createGroupForOrganization(
      context,
      organizationId,
      payload,
    );
  }

  /**
   * Updates a user group for an organization selected by explicit id.
   */
  async updateGroup(
    authorization: string | undefined,
    organizationId: string,
    groupId: string,
    payload: UpdateGroupPayload,
  ) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    return this.groupsService.updateGroupForOrganization(
      context,
      organizationId,
      groupId,
      payload,
    );
  }

  /**
   * Replaces user group members for an organization selected by explicit id.
   */
  async updateGroupMembers(
    authorization: string | undefined,
    organizationId: string,
    groupId: string,
    payload: UpdateGroupMembersPayload,
  ) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    return this.groupsService.updateMembersForOrganization(
      context,
      organizationId,
      groupId,
      payload,
    );
  }

  /**
   * Deletes a user group for an organization selected by explicit id.
   */
  async deleteGroup(
    authorization: string | undefined,
    organizationId: string,
    groupId: string,
  ) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    return this.groupsService.deleteGroupForOrganization(
      context,
      organizationId,
      groupId,
    );
  }
}
