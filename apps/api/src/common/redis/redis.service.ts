import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createClient, type RedisClientType } from "redis";

@Injectable()
export class RedisService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private clientPromise: Promise<RedisClientType> | null = null;

  constructor(private readonly configService: ConfigService) {}

  async getClient() {
    if (!this.clientPromise) {
      this.clientPromise = this.connect();
    }
    return this.clientPromise;
  }

  async onApplicationBootstrap() {
    const client = await this.getClient();
    await client.ping();
  }

  async ping() {
    return (await this.getClient()).ping();
  }

  async onModuleDestroy() {
    if (!this.clientPromise) return;
    try {
      const client = await this.clientPromise;
      await client.quit();
    } catch (error) {
      this.logger.warn(`Redis disconnect failed: ${String(error)}`);
    }
  }

  private async connect() {
    const client = createClient({
      url: this.configService.getOrThrow<string>("redis.url"),
    }) as RedisClientType;
    client.on("error", (error) => {
      this.logger.warn(`Redis connection error: ${String(error)}`);
    });
    await client.connect();
    return client;
  }
}