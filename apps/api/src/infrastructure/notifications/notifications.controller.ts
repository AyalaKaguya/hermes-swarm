import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import type { UserNotificationStatus } from "@hermes-swarm/core";
import { NotificationsService } from "./notifications.service.js";

@Controller("admin/notifications")
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  list(
    @Headers("authorization") authorization: string | undefined,
    @Query("status") status?: string | string[],
    @Query("take") take?: string | string[],
  ) {
    return this.notificationsService.listForAuthorization(authorization, {
      status: parseNotificationStatus(status),
      take: parseNotificationTake(take),
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

function parseNotificationStatus(
  value: string | string[] | undefined,
): UserNotificationStatus | undefined {
  if (value === undefined || value === "") return undefined;
  if (value === "read" || value === "unread") return value;
  throw new BadRequestException("通知状态无效");
}

function parseNotificationTake(value: string | string[] | undefined) {
  if (value === undefined || value === "") return undefined;
  if (Array.isArray(value)) throw new BadRequestException("通知数量无效");
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new BadRequestException("通知数量无效");
  }
  return parsed;
}
