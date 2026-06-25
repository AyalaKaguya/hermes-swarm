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
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Get("organization")
  current(@Headers("authorization") authorization?: string) {
    return this.organizationsService.current(authorization);
  }

  @Patch("organization")
  updateCurrent(
    @Headers("authorization") authorization: string | undefined,
    @Body() payload: UpdateOrganizationPayload,
  ) {
    return this.organizationsService.updateCurrent(authorization, payload);
  }

  @Get("organizations")
  list(@Headers("authorization") authorization?: string) {
    return this.organizationsService.list(authorization);
  }

  @Post("organizations")
  create(
    @Headers("authorization") authorization: string | undefined,
    @Body() payload: CreateOrganizationPayload,
  ) {
    return this.organizationsService.create(authorization, payload);
  }

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
