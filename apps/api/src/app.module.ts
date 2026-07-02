import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AdminModule } from "./admin/admin.module.js";
import { DatabaseModule } from "./common/database/database.module.js";
import {
  appRuntimeConfig,
  authRuntimeConfig,
  databaseRuntimeConfig,
  getApiEnvFilePaths,
  redisRuntimeConfig,
  validateRuntimeConfig,
} from "./common/config/runtime-config.js";
import { HealthModule } from "./common/health/health.module.js";
import { RedisModule } from "./common/redis/redis.module.js";
import { RbacModule } from "./rbac/rbac.module.js";

@Module({
  imports: [
    ConfigModule.forRoot({
      envFilePath: getApiEnvFilePaths(),
      isGlobal: true,
      load: [
        appRuntimeConfig,
        authRuntimeConfig,
        databaseRuntimeConfig,
        redisRuntimeConfig,
      ],
      validate: validateRuntimeConfig,
    }),
    RedisModule,
    DatabaseModule,
    HealthModule,
    RbacModule,
    AdminModule,
  ],
})
export class AppModule {}
