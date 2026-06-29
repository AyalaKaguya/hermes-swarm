import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { RequirePermission } from "../rbac/require-permission.decorator.js";
import { NotificationDestinationsService } from "./notification-destinations.service.js";

@Controller("admin/organizations/:organizationId/notification-destinations")
export class NotificationDestinationsController {
  constructor(private readonly service: NotificationDestinationsService) {}

  @Get()
  @RequirePermission({
    action: "read",
    entity: "notification",
    scope: "organization",
  })
  list(@Param("organizationId") organizationId: string) {
    return this.service.list(organizationId);
  }

  @Get("types")
  @RequirePermission({
    action: "read",
    entity: "notification",
    scope: "organization",
  })
  types() {
    return this.service.types();
  }

  @Get(":destinationId")
  @RequirePermission({
    action: "read",
    entity: "notification",
    scope: "organization",
  })
  getOne(
    @Param("organizationId") organizationId: string,
    @Param("destinationId") destinationId: string,
  ) {
    return this.service.getOne(organizationId, destinationId);
  }

  @Get(":destinationId/groups")
  @RequirePermission({
    action: "read",
    entity: "notification",
    scope: "organization",
  })
  groups(
    @Param("organizationId") organizationId: string,
    @Param("destinationId") destinationId: string,
  ) {
    return this.service.groups(organizationId, destinationId);
  }

  @Post()
  @RequirePermission({
    action: "create",
    entity: "notification",
    scope: "organization",
  })
  create(
    @Param("organizationId") organizationId: string,
    @Body() payload: unknown,
  ) {
    return this.service.create(organizationId, payload);
  }

  @Patch(":destinationId")
  @RequirePermission({
    action: "update",
    entity: "notification",
    scope: "organization",
  })
  update(
    @Param("organizationId") organizationId: string,
    @Param("destinationId") destinationId: string,
    @Body() payload: unknown,
  ) {
    return this.service.update(organizationId, destinationId, payload);
  }

  @Delete(":destinationId")
  @RequirePermission({
    action: "delete",
    entity: "notification",
    scope: "organization",
  })
  delete(
    @Param("organizationId") organizationId: string,
    @Param("destinationId") destinationId: string,
  ) {
    return this.service.delete(organizationId, destinationId);
  }
}
