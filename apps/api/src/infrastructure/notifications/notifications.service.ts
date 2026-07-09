import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
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
  private readonly logger = new Logger(NotificationsService.name);

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
    const entityInput = toNotificationEntityInput(input);
    const notification = await this.notificationRepository.save(
      this.notificationRepository.create(entityInput),
    );
    const dto = toNotificationDto(notification);
    this.publishCreatedNotification(entityInput.recipientUserId, dto);
    return dto;
  }

  async createForUsers(
    userIds: string[],
    input: Omit<CreateUserNotificationInput, "recipientUserId">,
  ) {
    const recipientUserIds = normalizeRecipientUserIds(userIds);
    if (recipientUserIds.length === 0) return [];

    const savedNotifications = await this.notificationRepository.manager.transaction(
      async (manager) => {
        const repository = manager.getRepository(UserNotification);
        const notifications = recipientUserIds.map((recipientUserId) =>
          repository.create(
            toNotificationEntityInput({ ...input, recipientUserId }),
          ),
        );
        return repository.save(notifications);
      },
    );
    const dtos = savedNotifications.map(toNotificationDto);
    for (let index = 0; index < dtos.length; index += 1) {
      this.publishCreatedNotification(recipientUserIds[index]!, dtos[index]!);
    }
    return dtos;
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
    const take = normalizeTake(options.take);
    const status = normalizeNotificationStatus(options.status);
    const items = await this.notificationRepository.find({
      order: { createdAt: "DESC" },
      take,
      where: {
        ...(status ? { status } : {}),
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
      where: {
        dismissedAt: IsNull(),
        id: notificationId,
        recipientUserId: session.userId,
      },
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
        dismissedAt: IsNull(),
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
        dismissedAt: IsNull(),
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
      where: {
        dismissedAt: IsNull(),
        id: notificationId,
        recipientUserId: session.userId,
      },
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

  private publishCreatedNotification(
    recipientUserId: string,
    dto: ReturnType<typeof toNotificationDto>,
  ) {
    try {
      this.realtimeService.publishToUser(recipientUserId, {
        type: "notification.created",
        payload: dto,
      });
    } catch (error) {
      this.logger.warn(
        `notification realtime publish failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

function toNotificationEntityInput(input: CreateUserNotificationInput) {
  return {
    body: optionalString(input.body),
    actorUserId: optionalString(input.actorUserId),
    kind: normalizeNotificationKind(input.kind),
    organizationId: optionalString(input.organizationId),
    payload: input.payload && isRecord(input.payload) ? input.payload : null,
    recipientUserId: requireString(input.recipientUserId, "接收人"),
    sourceId: optionalString(input.sourceId),
    sourceType: optionalString(input.sourceType, {
      label: "通知来源类型",
      maxLength: 80,
    }),
    status: "unread" as const,
    title: normalizeTitle(input.title),
  };
}

function normalizeTitle(value: unknown) {
  const title = requireString(value, "通知标题");
  if (!title) throw new BadRequestException("通知标题不能为空");
  if (title.length > 240) {
    throw new BadRequestException("通知标题不能超过 240 个字符");
  }
  return title;
}

function normalizeRecipientUserIds(userIds: unknown) {
  if (!Array.isArray(userIds)) {
    throw new BadRequestException("接收人列表无效");
  }
  return [
    ...new Set(userIds.map((item) => requireString(item, "接收人"))),
  ];
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
  const title = normalizeTitle(Reflect.get(value, "title"));
  const kind = Reflect.get(value, "kind");
  return {
    body: optionalString(Reflect.get(value, "body")),
    kind: normalizeNotificationKind(kind),
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

function optionalString(
  value: unknown,
  options: { label: string; maxLength: number } | null = null,
) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new BadRequestException(`${options?.label ?? "字段"}无效`);
  }
  const normalized = value.trim();
  if (!normalized) return null;
  if (options && normalized.length > options.maxLength) {
    throw new BadRequestException(
      `${options.label}不能超过 ${options.maxLength} 个字符`,
    );
  }
  return normalized;
}

function isNotificationKind(value: unknown): value is UserNotificationKind {
  return (
    value === "error" ||
    value === "info" ||
    value === "success" ||
    value === "warning"
  );
}

function normalizeNotificationKind(value: unknown): UserNotificationKind {
  if (value === undefined || value === null || value === "") return "info";
  if (!isNotificationKind(value)) {
    throw new BadRequestException("通知类型无效");
  }
  return value;
}

function normalizeTake(value: number | undefined) {
  if (value === undefined) return 50;
  if (!Number.isInteger(value)) {
    throw new BadRequestException("通知数量无效");
  }
  return Math.min(Math.max(value, 1), 100);
}

function normalizeNotificationStatus(
  value: unknown,
): UserNotificationStatus | undefined {
  if (value === undefined) return undefined;
  if (value === "read" || value === "unread") return value;
  throw new BadRequestException("通知状态无效");
}
