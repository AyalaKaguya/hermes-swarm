import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { DataSource } from "typeorm";
import { RedisService } from "../redis/redis.service.js";

@Controller("health")
export class HealthController {
  constructor(
    private readonly dataSource: DataSource,
    private readonly redisService: RedisService,
  ) {}

  @Get()
  async check() {
    return this.ready();
  }

  @Get("live")
  live() {
    return { status: "ok" };
  }

  @Get("ready")
  async ready() {
    try {
      await Promise.all([
        this.dataSource.query("SELECT 1"),
        this.redisService.ping(),
      ]);
    } catch {
      throw new ServiceUnavailableException({
        message: "依赖服务不可用",
        status: "error",
      });
    }
    return { status: "ok", db: "connected", redis: "connected" };
  }
}