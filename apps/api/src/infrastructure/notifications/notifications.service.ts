import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import {
  Account,
  UserNotification,
  type UserNotificationKind,
  type UserNotificationStatus,
} from "@hermes-swarm/core";
import { In, IsNull } from "typeorm";
import { WorkspaceContextService } from "../../common/database/workspace-context.service.js";
import { AuthSessionService } from "../auth/auth-session.service.js";
import { RealtimeEventBus } from "../realtime/realtime-event-bus.service.js";

export type CreateUserNotificationInput = {
  actorUserId?: string | null;
  body?: string | null;
  kind?: UserNotificationKind;
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
    private readonly workspaceContext: WorkspaceContextService,
    @Inject(AuthSessionService)
    private readonly authSessionService: AuthSessionService,
    @Inject(RealtimeEventBus)
    private readonly realtimeEventBus: RealtimeEventBus,
  ) {}

  async createForUser(input: CreateUserNotificationInput) {
    const workspaceId = this.workspaceId;
    const entityInput = toNotificationEntityInput(input, workspaceId);
    await this.requireWorkspaceRecipients(workspaceId, [entityInput.recipientUserId]);
    const notification = await this.notifications.save(
      this.notifications.create(entityInput),
    );
    const dto = toNotificationDto(notification);
    this.publishCreatedNotification(workspaceId, entityInput.recipientUserId, dto);
    return dto;
  }

  async createForUsers(
    userIds: string[],
    input: Omit<CreateUserNotificationInput, "recipientUserId">,
  ) {
    const recipientUserIds = normalizeRecipientUserIds(userIds);
    if (recipientUserIds.length === 0) return [];
    const workspaceId = this.workspaceId;
    await this.requireWorkspaceRecipients(workspaceId, recipientUserIds);

    const savedNotifications = await this.notifications.save(
      recipientUserIds.map((recipientUserId) =>
        this.notifications.create(
          toNotificationEntityInput({ ...input, recipientUserId }, workspaceId),
        ),
      ),
    );
    const dtos = savedNotifications.map(toNotificationDto);
    for (let index = 0; index < dtos.length; index += 1) {
      this.publishCreatedNotification(
        workspaceId,
        recipientUserIds[index]!,
        dtos[index]!,
      );
    }
    return dtos;
  }

  async sendFromAuthorization(
    authorization: string | undefined,
    payload: unknown,
  ) {
    const session = await this.requireSession(authorization);
    this.requireSessionWorkspaceId(session);
    const input = parseSendNotificationPayload(payload);
    return this.createForUsers(input.recipientUserIds, {
      actorUserId: session.userId,
      body: input.body,
      kind: input.kind,
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
    const workspaceId = this.requireSessionWorkspaceId(session);
    const take = normalizeTake(options.take);
    const status = normalizeNotificationStatus(options.status);
    const items = await this.notifications.find({
      order: { createdAt: "DESC" },
      take,
      where: {
        ...(status ? { status } : {}),
        dismissedAt: IsNull(),
        recipientUserId: session.userId,
        workspaceId,
      },
    });
    return items.map(toNotificationDto);
  }

  async unreadCount(authorization: string | undefined) {
    const session = await this.requireSession(authorization);
    const workspaceId = this.requireSessionWorkspaceId(session);
    return {
      count: await this.notifications.count({
        where: {
          dismissedAt: IsNull(),
          recipientUserId: session.userId,
          status: "unread",
          workspaceId,
        },
      }),
    };
  }

  async markRead(authorization: string | undefined, notificationId: string) {
    const session = await this.requireSession(authorization);
    const workspaceId = this.requireSessionWorkspaceId(session);
    const notification = await this.notifications.findOne({
      where: {
        dismissedAt: IsNull(),
        id: notificationId,
        recipientUserId: session.userId,
        workspaceId,
      },
    });
    if (!notification) throw new NotFoundException("通知不存在");
    if (notification.status === "unread") {
      notification.status = "read";
      notification.readAt = new Date();
      await this.notifications.save(notification);
    }
    return toNotificationDto(notification);
  }

  async markSourceRead(
    userId: string,
    sourceType: string,
    sourceId: string,
  ) {
    const workspaceId = this.workspaceId;
    await this.notifications.update(
      {
        dismissedAt: IsNull(),
        recipientUserId: userId,
        sourceId,
        sourceType,
        status: "unread",
        workspaceId,
      },
      {
        readAt: new Date(),
        status: "read",
      },
    );
  }

  async markAllRead(authorization: string | undefined) {
    const session = await this.requireSession(authorization);
    const workspaceId = this.requireSessionWorkspaceId(session);
    await this.notifications.update(
      {
        dismissedAt: IsNull(),
        recipientUserId: session.userId,
        status: "unread",
        workspaceId,
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
    const workspaceId = this.requireSessionWorkspaceId(session);
    await this.notifications.update(
      {
        dismissedAt: IsNull(),
        recipientUserId: session.userId,
        status: "read",
        workspaceId,
      },
      {
        dismissedAt: new Date(),
      },
    );
    return { ok: true };
  }

  async dismiss(authorization: string | undefined, notificationId: string) {
    const session = await this.requireSession(authorization);
    const workspaceId = this.requireSessionWorkspaceId(session);
    const notification = await this.notifications.findOne({
      where: {
        dismissedAt: IsNull(),
        id: notificationId,
        recipientUserId: session.userId,
        workspaceId,
      },
    });
    if (!notification) throw new NotFoundException("通知不存在");
    notification.dismissedAt = new Date();
    await this.notifications.save(notification);
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

  private publishCreatedNotification(
    workspaceId: string,
    recipientUserId: string,
    dto: ReturnType<typeof toNotificationDto>,
  ) {
    try {
      void Promise.resolve(
        this.realtimeEventBus.publishToUser(workspaceId, recipientUserId, {
          type: "notification.created",
          payload: dto,
        }),
      ).catch((error) => {
        this.logger.warn(
          `notification realtime publish failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
    } catch (error) {
      this.logger.warn(
        `notification realtime publish failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private requireSessionWorkspaceId(session: { workspaceId?: string | null }) {
    const workspaceId = session.workspaceId?.trim();
    if (!workspaceId || workspaceId !== this.workspaceId) {
      throw new UnauthorizedException("登录会话工作空间上下文无效");
    }
    return workspaceId;
  }

  private async requireWorkspaceRecipients(workspaceId: string, userIds: string[]) {
    const users = await this.users.find({
      select: { id: true },
      where: { id: In(userIds), status: "active" },
    });
    const found = new Set(users.map((user) => user.id));
    if (userIds.some((userId) => !found.has(userId))) {
      throw new BadRequestException("接收人不属于当前工作空间或不可用");
    }
  }

  private get workspaceId() {
    return this.workspaceContext.current()!.workspaceId;
  }

  private get notifications() {
    return this.workspaceContext.repository(UserNotification);
  }

  private get users() {
    return this.workspaceContext.repository(Account);
  }
}

function toNotificationEntityInput(
  input: CreateUserNotificationInput,
  workspaceId: string,
) {
  return {
    body: optionalString(input.body),
    actorUserId: optionalString(input.actorUserId),
    kind: normalizeNotificationKind(input.kind),
    payload: input.payload && isRecord(input.payload) ? input.payload : null,
    recipientUserId: requireString(input.recipientUserId, "接收人"),
    sourceId: optionalString(input.sourceId),
    sourceType: optionalString(input.sourceType, {
      label: "通知来源类型",
      maxLength: 80,
    }),
    status: "unread" as const,
    title: normalizeTitle(input.title),
    workspaceId,
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
    payload: notification.payload,
    readAt: notification.readAt,
    sourceId: notification.sourceId,
    sourceType: notification.sourceType,
    status: notification.status,
    title: notification.title,
    workspaceId: notification.workspaceId,
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
