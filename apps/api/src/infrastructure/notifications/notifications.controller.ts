import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Query } from "@nestjs/common";
import type { UserNotificationStatus } from "@hermes-swarm/core";
import { NotificationsService } from "./notifications.service.js";

@Controller("admin/notifications")
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  list(
    @Headers("authorization") authorization: string | undefined,
    @Query("status") status?: UserNotificationStatus,
    @Query("take") take?: string,
  ) {
    return this.notificationsService.listForAuthorization(authorization, {
      status: status === "read" || status === "unread" ? status : undefined,
      take: take ? Number.parseInt(take, 10) : undefined,
    });
  }

  @Get("unread-count")
  unreadCount(@Headers("authorization") authorization: string | undefined) {
    return this.notificationsService.unreadCount(authorization);
  }

  @Post()
  send(
    @Headers("authorization") authorization: string | undefined,
    @Body() payload: unknown,
  ) {
    return this.notificationsService.sendFromAuthorization(
      authorization,
      payload,
    );
  }

  @Patch(":notificationId/read")
  markRead(
    @Headers("authorization") authorization: string | undefined,
    @Param("notificationId") notificationId: string,
  ) {
    return this.notificationsService.markRead(authorization, notificationId);
  }

  @Patch("read")
  markAllRead(@Headers("authorization") authorization: string | undefined) {
    return this.notificationsService.markAllRead(authorization);
  }

  @Delete("read")
  dismissRead(@Headers("authorization") authorization: string | undefined) {
    return this.notificationsService.dismissRead(authorization);
  }

  @Delete(":notificationId")
  dismiss(
    @Headers("authorization") authorization: string | undefined,
    @Param("notificationId") notificationId: string,
  ) {
    return this.notificationsService.dismiss(authorization, notificationId);
  }
}
