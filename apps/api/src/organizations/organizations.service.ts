import { Injectable } from "@nestjs/common";
import type {
  CreateOrganizationPayload,
  UpdateOrganizationPayload,
} from "../tenancy/tenancy.types.js";
import { TenancyService } from "../tenancy/tenancy.service.js";

@Injectable()
/**
 * Handles tenant/organization management using the current Organization model
 */
export class OrganizationsService {
  constructor(private readonly tenancyService: TenancyService) {}

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
}
