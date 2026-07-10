import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { RedisClientType } from "redis";
import { RedisService } from "../../common/redis/redis.service.js";
import { RealtimeService, type RealtimeEvent } from "./realtime.service.js";

const REALTIME_EVENTS_CHANNEL = "realtime.events.v1";

type RealtimeBusEvent = RealtimeEvent & {
  id: string;
  originInstanceId: string;
  publishedAt: string;
  recipientUserIds: string[];
};

@Injectable()
export class RealtimeEventBus implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeEventBus.name);
  private readonly instanceId = randomUUID();
  private subscriber: RedisClientType | null = null;

  constructor(
    private readonly redisService: RedisService,
    private readonly realtimeService: RealtimeService,
  ) {}

  async onApplicationBootstrap() {
    const publisher = await this.redisService.getClient();
    this.subscriber = publisher.duplicate() as RedisClientType;
    this.subscriber.on("error", (error) => {
      this.logger.warn(`Realtime Redis subscriber error: ${String(error)}`);
    });
    await this.subscriber.connect();
    await this.subscriber.subscribe(REALTIME_EVENTS_CHANNEL, (serialized) => {
      this.handleRemoteEvent(serialized);
    });
  }

  async onModuleDestroy() {
    if (!this.subscriber) return;
    try {
      await this.subscriber.unsubscribe(REALTIME_EVENTS_CHANNEL);
      await this.subscriber.quit();
    } catch (error) {
      this.logger.warn(`Realtime Redis subscriber shutdown failed: ${String(error)}`);
    } finally {
      this.subscriber = null;
    }
  }

  async publishToUser(userId: string, event: RealtimeEvent) {
    return this.publishToUsers([userId], event);
  }

  async publishToUsers(userIds: string[], event: RealtimeEvent) {
    const recipientUserIds = [...new Set(userIds.filter(Boolean))];
    if (recipientUserIds.length === 0) return;
    const busEvent: RealtimeBusEvent = {
      ...event,
      id: event.id ?? randomUUID(),
      originInstanceId: this.instanceId,
      publishedAt: new Date().toISOString(),
      recipientUserIds,
    };
    this.deliver(busEvent);
    await (await this.redisService.getClient()).publish(
      REALTIME_EVENTS_CHANNEL,
      JSON.stringify(busEvent),
    );
  }

  private handleRemoteEvent(serialized: string) {
    try {
      const event = JSON.parse(serialized) as RealtimeBusEvent;
      if (
        event.originInstanceId === this.instanceId ||
        !event.id ||
        !event.type ||
        !Array.isArray(event.recipientUserIds)
      ) return;
      this.deliver(event);
    } catch (error) {
      this.logger.warn(`Ignoring invalid realtime event: ${String(error)}`);
    }
  }

  private deliver(event: RealtimeBusEvent) {
    this.realtimeService.publishToUsers(event.recipientUserIds, {
      id: event.id,
      payload: event.payload,
      type: event.type,
    });
  }
}