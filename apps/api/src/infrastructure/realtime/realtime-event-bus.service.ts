import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { RedisClientType } from "redis";
import { PublicRealtimeEnvelopeSchema } from "@hermes-swarm/api-contracts/realtime";
import { RedisService } from "../../common/redis/redis.service.js";
import { WorkspaceContextService } from "../../common/database/workspace-context.service.js";
import { RealtimeService, type RealtimeEvent } from "./realtime.service.js";

const REALTIME_EVENTS_CHANNEL_PREFIX = "realtime.events.v1";
const REALTIME_EVENTS_PATTERN = `${REALTIME_EVENTS_CHANNEL_PREFIX}:*`;

type RealtimeBusEvent = RealtimeEvent & {
  id: string;
  originInstanceId: string;
  publishedAt: string;
  recipientUserIds: string[];
  workspaceId: string;
};

@Injectable()
export class RealtimeEventBus implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeEventBus.name);
  private readonly instanceId = randomUUID();
  private subscriber: RedisClientType | null = null;

  constructor(
    private readonly redisService: RedisService,
    private readonly realtimeService: RealtimeService,
    private readonly workspaceContext: WorkspaceContextService,
  ) {}

  async onApplicationBootstrap() {
    const publisher = await this.redisService.getClient();
    this.subscriber = publisher.duplicate() as RedisClientType;
    this.subscriber.on("error", (error) => {
      this.logger.warn(`Realtime Redis subscriber error: ${String(error)}`);
    });
    await this.subscriber.connect();
    await this.subscriber.pSubscribe(
      REALTIME_EVENTS_PATTERN,
      (serialized, channel) => {
        this.handleRemoteEvent(serialized, channel);
      },
    );
  }

  async onModuleDestroy() {
    if (!this.subscriber) return;
    try {
      await this.subscriber.pUnsubscribe(REALTIME_EVENTS_PATTERN);
      await this.subscriber.quit();
    } catch (error) {
      this.logger.warn(`Realtime Redis subscriber shutdown failed: ${String(error)}`);
    } finally {
      this.subscriber = null;
    }
  }

  publishToUser(userId: string, event: RealtimeEvent): Promise<void>;
  publishToUser(
    workspaceId: string,
    userId: string,
    event: RealtimeEvent,
  ): Promise<void>;
  async publishToUser(
    workspaceOrUserId: string,
    userOrEvent: string | RealtimeEvent,
    maybeEvent?: RealtimeEvent,
  ) {
    const explicitWorkspace = typeof userOrEvent === "string";
    const workspaceId = requireWorkspaceId(
      explicitWorkspace ? workspaceOrUserId : this.currentWorkspaceId,
    );
    const userId = explicitWorkspace ? userOrEvent : workspaceOrUserId;
    const event = explicitWorkspace
      ? maybeEvent!
      : (userOrEvent as RealtimeEvent);
    return this.publishToUsers(workspaceId, [userId], event);
  }

  publishToUsers(userIds: string[], event: RealtimeEvent): Promise<void>;
  publishToUsers(
    workspaceId: string,
    userIds: string[],
    event: RealtimeEvent,
  ): Promise<void>;
  async publishToUsers(
    workspaceOrUserIds: string | string[],
    userIdsOrEvent: string[] | RealtimeEvent,
    maybeEvent?: RealtimeEvent,
  ) {
    const explicitWorkspace = typeof workspaceOrUserIds === "string";
    const workspaceId = requireWorkspaceId(
      explicitWorkspace ? workspaceOrUserIds : this.currentWorkspaceId,
    );
    const userIds = explicitWorkspace
      ? (userIdsOrEvent as string[])
      : workspaceOrUserIds;
    const event = explicitWorkspace
      ? maybeEvent!
      : (userIdsOrEvent as RealtimeEvent);
    const recipientUserIds = [...new Set(userIds.filter(Boolean))];
    if (recipientUserIds.length === 0) return;
    const busEvent: RealtimeBusEvent = {
      ...event,
      id: event.id ?? randomUUID(),
      originInstanceId: this.instanceId,
      publishedAt: new Date().toISOString(),
      recipientUserIds,
      workspaceId,
    };
    if (!this.isPublicEvent(busEvent)) return;
    this.deliver(busEvent);
    await (await this.redisService.getClient()).publish(
      realtimeEventsChannel(workspaceId),
      JSON.stringify(busEvent),
    );
  }

  private handleRemoteEvent(serialized: string, channel: string) {
    try {
      const event = JSON.parse(serialized) as RealtimeBusEvent;
      if (
        event.originInstanceId === this.instanceId ||
        !event.id ||
        !event.workspaceId ||
        channel !== realtimeEventsChannel(event.workspaceId) ||
        !event.type ||
        !Array.isArray(event.recipientUserIds)
      ) return;
      if (this.isPublicEvent(event)) this.deliver(event);
    } catch (error) {
      this.logger.warn(`Ignoring invalid realtime event: ${String(error)}`);
    }
  }

  private isPublicEvent(event: RealtimeBusEvent) {
    const result = PublicRealtimeEnvelopeSchema.safeParse({
      id: event.id,
      payload: toWireValue(event.payload ?? null),
      sentAt: event.publishedAt,
      type: event.type,
      workspaceId: event.workspaceId,
    });
    if (!result.success) {
      this.logger.warn(JSON.stringify({
        code: "REALTIME_CONTRACT_MISMATCH",
        issues: result.error.issues.map((issue) => issue.path.join(".") || "event"),
        type: event.type,
      }));
    }
    return result.success;
  }

  private deliver(event: RealtimeBusEvent) {
    this.realtimeService.publishToUsers(event.workspaceId, event.recipientUserIds, {
      id: event.id,
      payload: event.payload,
      type: event.type,
    });
  }

  private get currentWorkspaceId() {
    return this.workspaceContext.current()!.workspaceId;
  }
}

function realtimeEventsChannel(workspaceId: string) {
  return `${REALTIME_EVENTS_CHANNEL_PREFIX}:${workspaceId}`;
}

function requireWorkspaceId(value: string) {
  const workspaceId = value.trim();
  if (!workspaceId) throw new Error("Realtime workspace id is required");
  return workspaceId;
}

function toWireValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(toWireValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, toWireValue(item)]),
  );
}
