import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import type {
  CreateOrganizationPayload,
  UpdateOrganizationPayload,
} from "../tenancy/tenancy.types.js";
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
}
