import { Global, Module } from "@nestjs/common";
import { RedisService } from "./redis.service.js";
import { AuthRateLimitService } from "../security/auth-rate-limit.service.js";

@Global()
@Module({
  providers: [RedisService, AuthRateLimitService],
  exports: [RedisService, AuthRateLimitService],
})
export class RedisModule {}
