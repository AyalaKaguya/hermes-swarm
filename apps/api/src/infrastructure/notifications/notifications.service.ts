import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import {
  UserNotification,
  UserOrganization,
  type UserNotificationKind,
  type UserNotificationStatus,
} from "@hermes-swarm/core";
import { In, IsNull, Repository } from "typeorm";
import { AuthSessionService } from "../auth/auth-session.service.js";
import { RealtimeService } from "../realtime/realtime.service.js";

export type CreateUserNotificationInput = {
  actorUserId?: string | null;
  body?: string | null;
  kind?: UserNotificationKind;
  organizationId?: string | null;
  payload?: Record<string, unknown> | null;
  recipientUserId: string;
  sourceId?: string | null;
  sourceType?: string | null;
  title: string;
};

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(UserNotification)
    private readonly notificationRepository: Repository<UserNotification>,
    @InjectRepository(UserOrganization)
    private readonly membershipRepository: Repository<UserOrganization>,
    @Inject(AuthSessionService)
    private readonly authSessionService: AuthSessionService,
    @Inject(RealtimeService)
    private readonly realtimeService: RealtimeService,
  ) {}

  async createForUser(input: CreateUserNotificationInput) {
    const notification = await this.notificationRepository.save(
      this.notificationRepository.create({
        body: input.body ?? null,
        actorUserId: input.actorUserId ?? null,
        kind: input.kind ?? "info",
        organizationId: input.organizationId ?? null,
        payload: input.payload ?? null,
        recipientUserId: input.recipientUserId,
        sourceId: input.sourceId ?? null,
        sourceType: input.sourceType ?? null,
        status: "unread",
        title: normalizeTitle(input.title),
      }),
    );
    const dto = toNotificationDto(notification);
    this.realtimeService.publishToUser(input.recipientUserId, {
      type: "notification.created",
      payload: dto,
    });
    return dto;
  }

  async createForUsers(userIds: string[], input: Omit<CreateUserNotificationInput, "recipientUserId">) {
    const notifications = [];
    for (const userId of new Set(userIds)) {
      notifications.push(await this.createForUser({ ...input, recipientUserId: userId }));
    }
    return notifications;
  }

  async sendFromAuthorization(
    authorization: string | undefined,
    payload: unknown,
  ) {
    const session = await this.requireSession(authorization);
    const input = parseSendNotificationPayload(payload);
    if (input.organizationId) {
      await this.requireSameOrganizationRecipients(
        session.userId,
        input.organizationId,
        input.recipientUserIds,
      );
    }
    return this.createForUsers(input.recipientUserIds, {
      actorUserId: session.userId,
      body: input.body,
      kind: input.kind,
      organizationId: input.organizationId,
      payload: input.payload,
      sourceId: null,
      sourceType: "user",
      title: input.title,
    });
  }

  async listForAuthorization(
    authorization: string | undefined,
    options: { status?: UserNotificationStatus; take?: number } = {},
  ) {
    const session = await this.requireSession(authorization);
    const take = Math.min(Math.max(options.take ?? 50, 1), 100);
    const items = await this.notificationRepository.find({
      order: { createdAt: "DESC" },
      take,
      where: {
        ...(options.status ? { status: options.status } : {}),
        dismissedAt: IsNull(),
        recipientUserId: session.userId,
      },
    });
    return items.map(toNotificationDto);
  }

  async unreadCount(authorization: string | undefined) {
    const session = await this.requireSession(authorization);
    return {
      count: await this.notificationRepository.count({
        where: {
          dismissedAt: IsNull(),
          recipientUserId: session.userId,
          status: "unread",
        },
      }),
    };
  }

  async markRead(authorization: string | undefined, notificationId: string) {
    const session = await this.requireSession(authorization);
    const notification = await this.notificationRepository.findOne({
      where: { id: notificationId, recipientUserId: session.userId },
    });
    if (!notification) throw new NotFoundException("通知不存在");
    if (notification.status === "unread") {
      notification.status = "read";
      notification.readAt = new Date();
      await this.notificationRepository.save(notification);
    }
    return toNotificationDto(notification);
  }

  async markSourceRead(
    userId: string,
    sourceType: string,
    sourceId: string,
  ) {
    await this.notificationRepository.update(
      {
        recipientUserId: userId,
        sourceId,
        sourceType,
        status: "unread",
      },
      {
        readAt: new Date(),
        status: "read",
      },
    );
  }

  async markAllRead(authorization: string | undefined) {
    const session = await this.requireSession(authorization);
    await this.notificationRepository.update(
      {
        recipientUserId: session.userId,
        status: "unread",
      },
      {
        readAt: new Date(),
        status: "read",
      },
    );
    return { ok: true };
  }

  async dismissRead(authorization: string | undefined) {
    const session = await this.requireSession(authorization);
    await this.notificationRepository.update(
      {
        dismissedAt: IsNull(),
        recipientUserId: session.userId,
        status: "read",
      },
      {
        dismissedAt: new Date(),
      },
    );
    return { ok: true };
  }

  async dismiss(authorization: string | undefined, notificationId: string) {
    const session = await this.requireSession(authorization);
    const notification = await this.notificationRepository.findOne({
      where: { id: notificationId, recipientUserId: session.userId },
    });
    if (!notification) throw new NotFoundException("通知不存在");
    notification.dismissedAt = new Date();
    await this.notificationRepository.save(notification);
  }

  private async requireSession(authorization: string | undefined) {
    try {
      return await this.authSessionService.validateAccessToken(
        authorization?.replace(/^Bearer\s+/i, "").trim(),
      );
    } catch {
      throw new UnauthorizedException("登录已失效，请重新登录");
    }
  }

  private async requireSameOrganizationRecipients(
    senderUserId: string,
    organizationId: string,
    recipientUserIds: string[],
  ) {
    const memberships = await this.membershipRepository.find({
      where: {
        organizationId,
        status: "active",
        userId: In([senderUserId, ...recipientUserIds]),
      },
    });
    const memberIds = new Set(memberships.map((membership) => membership.userId));
    if (!memberIds.has(senderUserId)) {
      throw new UnauthorizedException("不是当前组织成员");
    }
    const missing = recipientUserIds.filter((userId) => !memberIds.has(userId));
    if (missing.length > 0) {
      throw new BadRequestException("接收人不属于当前组织");
    }
  }
}

function normalizeTitle(value: string) {
  const title = value.trim();
  if (!title) throw new BadRequestException("通知标题不能为空");
  return title.slice(0, 240);
}

function toNotificationDto(notification: UserNotification) {
  return {
    actorUserId: notification.actorUserId,
    body: notification.body,
    createdAt: notification.createdAt,
    dismissedAt: notification.dismissedAt,
    id: notification.id,
    kind: notification.kind,
    organizationId: notification.organizationId,
    payload: notification.payload,
    readAt: notification.readAt,
    sourceId: notification.sourceId,
    sourceType: notification.sourceType,
    status: notification.status,
    title: notification.title,
    updatedAt: notification.updatedAt,
  };
}

function parseSendNotificationPayload(payload: unknown) {
  const value = assertObject(payload);
  const recipientUserIds = Reflect.get(value, "recipientUserIds");
  if (!Array.isArray(recipientUserIds) || recipientUserIds.length === 0) {
    throw new BadRequestException("接收人不能为空");
  }
  const title = normalizeTitle(requireString(Reflect.get(value, "title"), "通知标题"));
  const kind = Reflect.get(value, "kind");
  return {
    body: optionalString(Reflect.get(value, "body")),
    kind: isNotificationKind(kind) ? kind : "info",
    organizationId: optionalString(Reflect.get(value, "organizationId")),
    payload: isRecord(Reflect.get(value, "payload"))
      ? (Reflect.get(value, "payload") as Record<string, unknown>)
      : null,
    recipientUserIds: [
      ...new Set(recipientUserIds.map((item) => requireString(item, "接收人"))),
    ],
    title,
  };
}

function assertObject(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new BadRequestException("请求内容无效");
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function requireString(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new BadRequestException(`${label}不能为空`);
  }
  return value.trim();
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isNotificationKind(value: unknown): value is UserNotificationKind {
  return (
    value === "error" ||
    value === "info" ||
    value === "success" ||
    value === "warning"
  );
}
