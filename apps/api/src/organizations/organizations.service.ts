import { Injectable } from "@nestjs/common";
import type {
  CreateOrganizationPayload,
  UpdateOrganizationPayload,
} from "../tenancy/tenancy.types.js";
import { TenancyService } from "../tenancy/tenancy.service.js";

@Injectable()
export class OrganizationsService {
  constructor(private readonly tenancyService: TenancyService) {}

  async current(authorization: string | undefined) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    return this.tenancyService.getCurrentOrganization(context);
  }

  async updateCurrent(
    authorization: string | undefined,
    payload: UpdateOrganizationPayload,
  ) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    return this.tenancyService.updateOrganization(context, payload);
  }

  async list(authorization: string | undefined) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    return this.tenancyService.listOrganizations(context);
  }

  async create(
    authorization: string | undefined,
    payload: CreateOrganizationPayload,
  ) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    return this.tenancyService.createOrganization(context, payload);
  }

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
