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
          synchronize: true, // dev only
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
