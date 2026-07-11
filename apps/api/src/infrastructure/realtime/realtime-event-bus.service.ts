import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { RedisClientType } from "redis";
import { RedisService } from "../../common/redis/redis.service.js";
import { TenantContextService } from "../../common/database/tenant-context.service.js";
import { RealtimeService, type RealtimeEvent } from "./realtime.service.js";

const REALTIME_EVENTS_CHANNEL_PREFIX = "realtime.events.v1";
const REALTIME_EVENTS_PATTERN = `${REALTIME_EVENTS_CHANNEL_PREFIX}:*`;

type RealtimeBusEvent = RealtimeEvent & {
  id: string;
  originInstanceId: string;
  publishedAt: string;
  recipientUserIds: string[];
  tenantId: string;
};

@Injectable()
export class RealtimeEventBus implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeEventBus.name);
  private readonly instanceId = randomUUID();
  private subscriber: RedisClientType | null = null;

  constructor(
    private readonly redisService: RedisService,
    private readonly realtimeService: RealtimeService,
    private readonly tenantContext: TenantContextService,
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
    tenantId: string,
    userId: string,
    event: RealtimeEvent,
  ): Promise<void>;
  async publishToUser(
    tenantOrUserId: string,
    userOrEvent: string | RealtimeEvent,
    maybeEvent?: RealtimeEvent,
  ) {
    const explicitTenant = typeof userOrEvent === "string";
    const tenantId = requireTenantId(
      explicitTenant ? tenantOrUserId : this.currentTenantId,
    );
    const userId = explicitTenant ? userOrEvent : tenantOrUserId;
    const event = explicitTenant
      ? maybeEvent!
      : (userOrEvent as RealtimeEvent);
    return this.publishToUsers(tenantId, [userId], event);
  }

  publishToUsers(userIds: string[], event: RealtimeEvent): Promise<void>;
  publishToUsers(
    tenantId: string,
    userIds: string[],
    event: RealtimeEvent,
  ): Promise<void>;
  async publishToUsers(
    tenantOrUserIds: string | string[],
    userIdsOrEvent: string[] | RealtimeEvent,
    maybeEvent?: RealtimeEvent,
  ) {
    const explicitTenant = typeof tenantOrUserIds === "string";
    const tenantId = requireTenantId(
      explicitTenant ? tenantOrUserIds : this.currentTenantId,
    );
    const userIds = explicitTenant
      ? (userIdsOrEvent as string[])
      : tenantOrUserIds;
    const event = explicitTenant
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
      tenantId,
    };
    this.deliver(busEvent);
    await (await this.redisService.getClient()).publish(
      realtimeEventsChannel(tenantId),
      JSON.stringify(busEvent),
    );
  }

  private handleRemoteEvent(serialized: string, channel: string) {
    try {
      const event = JSON.parse(serialized) as RealtimeBusEvent;
      if (
        event.originInstanceId === this.instanceId ||
        !event.id ||
        !event.tenantId ||
        channel !== realtimeEventsChannel(event.tenantId) ||
        !event.type ||
        !Array.isArray(event.recipientUserIds)
      ) return;
      this.deliver(event);
    } catch (error) {
      this.logger.warn(`Ignoring invalid realtime event: ${String(error)}`);
    }
  }

  private deliver(event: RealtimeBusEvent) {
    this.realtimeService.publishToUsers(event.tenantId, event.recipientUserIds, {
      id: event.id,
      payload: event.payload,
      type: event.type,
    });
  }

  private get currentTenantId() {
    return this.tenantContext.current()!.tenantId;
  }
}

function realtimeEventsChannel(tenantId: string) {
  return `${REALTIME_EVENTS_CHANNEL_PREFIX}:${tenantId}`;
}

function requireTenantId(value: string) {
  const tenantId = value.trim();
  if (!tenantId) throw new Error("Realtime tenant id is required");
  return tenantId;
}
