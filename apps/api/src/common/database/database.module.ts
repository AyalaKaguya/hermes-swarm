import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { getPostgresUrl } from "@hermes-swarm/core/config/database";
import {
  getTypeOrmRedisCacheOptions,
  typeormRedisCacheConfig,
} from "@hermes-swarm/core/config/redis";

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: () => ({
        type: "postgres",
        url: getPostgresUrl(),
        autoLoadEntities: true,
        synchronize: true, // dev only
        cache: typeormRedisCacheConfig.enabled
          ? getTypeOrmRedisCacheOptions()
          : false,
      }),
    }),
  ],
})
export class DatabaseModule {}
