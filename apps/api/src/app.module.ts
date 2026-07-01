import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AdminModule } from "./admin/admin.module.js";
import { DatabaseModule } from "./common/database/database.module.js";
import {
  appRuntimeConfig,
  databaseRuntimeConfig,
  getApiEnvFilePaths,
  redisRuntimeConfig,
  validateRuntimeConfig,
} from "./common/config/runtime-config.js";
import { HealthModule } from "./common/health/health.module.js";
import { RbacModule } from "./rbac/rbac.module.js";

@Module({
  imports: [
    ConfigModule.forRoot({
      envFilePath: getApiEnvFilePaths(),
      isGlobal: true,
      load: [appRuntimeConfig, databaseRuntimeConfig, redisRuntimeConfig],
      validate: validateRuntimeConfig,
    }),
    DatabaseModule,
    HealthModule,
    RbacModule,
    AdminModule,
  ],
})
export class AppModule {}
