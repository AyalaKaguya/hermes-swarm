import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { TenantContextService } from "./tenant-context.service.js";
import { PLATFORM_DATA_SOURCE } from "./database.constants.js";
import { DatabaseRoleValidatorService } from "./database-role-validator.service.js";
import { DATABASE_ENTITIES } from "./database-entities.js";

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const redisCacheEnabled = configService.getOrThrow<boolean>(
          "redis.cacheEnabled",
        );
        return {
          type: "postgres",
          url: configService.getOrThrow<string>("database.tenantUrl"),
          entities: [...DATABASE_ENTITIES],
          autoLoadEntities: true,
          // Development and isolated tests synchronize directly from entities.
          // Production schema changes run before API replicas start.
          synchronize: configService.getOrThrow<boolean>(
            "database.synchronize",
          ),
          cache: redisCacheEnabled
            ? {
                alwaysEnabled: configService.getOrThrow<boolean>(
                  "redis.cacheAlwaysEnabled",
                ),
                duration: configService.getOrThrow<number>(
                  "redis.cacheDurationMs",
                ),
                ignoreErrors: configService.getOrThrow<boolean>(
                  "redis.cacheIgnoreErrors",
                ),
                options: {
                  url: configService.getOrThrow<string>("redis.url"),
                },
                type: "redis" as const,
              }
            : false,
        };
      },
    }),
    TypeOrmModule.forRootAsync({
      name: PLATFORM_DATA_SOURCE,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: "postgres",
        url: configService.getOrThrow<string>("database.platformUrl"),
        entities: [...DATABASE_ENTITIES],
        autoLoadEntities: true,
        synchronize: false,
      }),
    }),
  ],
  providers: [DatabaseRoleValidatorService, TenantContextService],
  exports: [TenantContextService],
})
export class DatabaseModule {}
