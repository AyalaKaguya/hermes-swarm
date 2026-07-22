import { Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { DatabaseModule } from "./common/database/database.module.js";
import { DomainsModule } from "./domains/domains.module.js";
import {
  appRuntimeConfig,
  authRuntimeConfig,
  databaseRuntimeConfig,
  getApiEnvFilePaths,
  redisRuntimeConfig,
  settingsRuntimeConfig,
  validateRuntimeConfig,
} from "./common/config/runtime-config.js";
import { HealthModule } from "./common/health/health.module.js";
import { InfrastructureModule } from "./infrastructure/infrastructure.module.js";
import { RedisModule } from "./common/redis/redis.module.js";
import { RbacModule } from "@hermes-swarm/rbac";
import { AuthModule } from "./infrastructure/auth/auth.module.js";
import { AuthSessionService } from "./infrastructure/auth/auth-session.service.js";
import { WorkspaceContextInterceptor } from "./common/database/workspace-context.interceptor.js";
import { AdminContractInterceptor } from "./common/contracts/contract-validation.js";

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
        settingsRuntimeConfig,
      ],
      validate: validateRuntimeConfig,
    }),
    RedisModule,
    DatabaseModule,
    HealthModule,
    RbacModule.register({
      authSessionService: AuthSessionService,
      imports: [AuthModule],
    }),
    InfrastructureModule,
    DomainsModule,
  ],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: AdminContractInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: WorkspaceContextInterceptor,
    },
  ],
})
export class AppModule {}
