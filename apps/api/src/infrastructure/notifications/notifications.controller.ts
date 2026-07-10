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
import { AccessOperation, AccessResource } from "@hermes-swarm/rbac";
import { NotificationsService } from "./notifications.service.js";

@Controller("admin/notifications")
@AccessResource({
  entity: "notification",
  entityLabel: "通知",
  entityOrder: 80,
  purpose: "personal_notification",
  purposeLabel: "个人通知",
  purposeOrder: 10,
  scope: "own",
})
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @AccessOperation({
    description: "查看当前账号收到的通知。",
    label: "查看通知",
    operation: "list",
    sortOrder: 10,
  })
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
  @AccessOperation({
    description: "查看当前账号未读通知数量。",
    label: "查看未读通知",
    operation: "unread_count",
    sortOrder: 20,
  })
  unreadCount(@Headers("authorization") authorization: string | undefined) {
    return this.notificationsService.unreadCount(authorization);
  }

  @Post()
  @AccessOperation({
    description: "向当前账号可见范围内的用户发送通知。",
    label: "发送通知",
    operation: "send",
    sortOrder: 30,
  })
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
  @AccessOperation({
    description: "将当前账号的一条通知标记为已读。",
    label: "标记通知已读",
    operation: "mark_read",
    sortOrder: 40,
  })
  markRead(
    @Headers("authorization") authorization: string | undefined,
    @Param("notificationId") notificationId: string,
  ) {
    return this.notificationsService.markRead(authorization, notificationId);
  }

  @Patch("read")
  @AccessOperation({
    description: "将当前账号的全部通知标记为已读。",
    label: "全部标记已读",
    operation: "mark_all_read",
    sortOrder: 50,
  })
  markAllRead(@Headers("authorization") authorization: string | undefined) {
    return this.notificationsService.markAllRead(authorization);
  }

  @Delete("read")
  @AccessOperation({
    description: "清除当前账号已读的通知。",
    label: "清除已读通知",
    operation: "dismiss_read",
    sortOrder: 60,
  })
  dismissRead(@Headers("authorization") authorization: string | undefined) {
    return this.notificationsService.dismissRead(authorization);
  }

  @Delete(":notificationId")
  @AccessOperation({
    description: "移除当前账号的一条通知。",
    label: "移除通知",
    operation: "dismiss",
    sortOrder: 70,
  })
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
