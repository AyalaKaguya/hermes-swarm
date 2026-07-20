import { createHash } from "node:crypto";
import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from "@nestjs/common";
import { RedisService } from "../redis/redis.service.js";

type RateLimitRule = {
  key: string;
  limit: number;
  windowSeconds: number;
};

@Injectable()
export class AuthRateLimitService {
  private readonly logger = new Logger(AuthRateLimitService.name);
  private readonly fallback = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly redis: RedisService) {}

  async assertAllowed(
    rules: RateLimitRule[],
    response?: { setHeader?: (name: string, value: string) => void },
  ) {
    for (const rule of rules) {
      const retryAfter = await this.consume(rule);
      if (retryAfter <= 0) continue;
      response?.setHeader?.("Retry-After", String(retryAfter));
      throw new HttpException(
        {
          code: "AUTH_RATE_LIMITED",
          message: "请求过于频繁，请稍后重试",
          retryAfter,
          statusCode: 429,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async consume(rule: RateLimitRule) {
    const key = `auth-rate:v1:${rule.key}`;
    try {
      const client = await this.redis.getClient();
      const count = await client.incr(key);
      if (count === 1) await client.expire(key, rule.windowSeconds);
      if (count <= rule.limit) return 0;
      const ttl = await client.ttl(key);
      return Math.max(1, ttl);
    } catch (error) {
      this.logger.warn(
        `Redis rate limiter unavailable; using conservative process fallback: ${String(error)}`,
      );
      return this.consumeFallback(key, rule);
    }
  }

  private consumeFallback(key: string, rule: RateLimitRule) {
    const now = Date.now();
    const current = this.fallback.get(key);
    const windowMs = rule.windowSeconds * 1000;
    const state =
      !current || current.resetAt <= now
        ? { count: 0, resetAt: now + windowMs }
        : current;
    state.count += 1;
    this.fallback.set(key, state);
    const conservativeLimit = Math.max(1, Math.floor(rule.limit / 2));
    return state.count > conservativeLimit
      ? Math.max(1, Math.ceil((state.resetAt - now) / 1000))
      : 0;
  }
}

export function rateLimitHash(value: unknown) {
  return createHash("sha256")
    .update(String(value ?? "").trim().toLowerCase())
    .digest("base64url");
}

export function requestIp(request: any) {
  return request?.ip ?? request?.socket?.remoteAddress ?? "unknown";
}
