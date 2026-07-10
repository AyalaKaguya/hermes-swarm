import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";

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
          url: configService.getOrThrow<string>("database.url"),
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
  ],
})
export class DatabaseModule {}
