import { Body, Controller, Delete, Get, Headers, Param, Patch, Post } from "@nestjs/common";
import { NotificationDestinationsService } from "./notification-destinations.service.js";

@Controller("admin/notification-destinations")
/**
 * Notification destination endpoints migrated from Xpert analytics.
 */
export class NotificationDestinationsController {
  constructor(private readonly service: NotificationDestinationsService) {}

  @Get()
  list(@Headers("authorization") authorization?: string) {
    return this.service.list(authorization);
  }

  @Get("types")
  types(@Headers("authorization") authorization?: string) {
    return this.service.types(authorization);
  }

  @Get(":destinationId")
  getOne(
    @Headers("authorization") authorization: string | undefined,
    @Param("destinationId") destinationId: string,
  ) {
    return this.service.getOne(authorization, destinationId);
  }

  @Get(":destinationId/groups")
  groups(
    @Headers("authorization") authorization: string | undefined,
    @Param("destinationId") destinationId: string,
  ) {
    return this.service.groups(authorization, destinationId);
  }

  @Post()
  create(
    @Headers("authorization") authorization: string | undefined,
    @Body() payload: unknown,
  ) {
    return this.service.create(authorization, payload);
  }

  @Patch(":destinationId")
  update(
    @Headers("authorization") authorization: string | undefined,
    @Param("destinationId") destinationId: string,
    @Body() payload: unknown,
  ) {
    return this.service.update(authorization, destinationId, payload);
  }

  @Delete(":destinationId")
  delete(
    @Headers("authorization") authorization: string | undefined,
    @Param("destinationId") destinationId: string,
  ) {
    return this.service.delete(authorization, destinationId);
  }
}
