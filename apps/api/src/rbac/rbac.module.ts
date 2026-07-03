import { Module } from "@nestjs/common";
import {
  ACCESS_AUTH_SESSION_SERVICE,
  AccessGuard,
  AccessNestModule,
} from "@hermes-swarm/nest-access";
import { APP_GUARD } from "@nestjs/core";
import { AuthModule } from "../auth/auth.module.js";
import { AuthSessionService } from "../auth/auth-session.service.js";
import { PermissionsController } from "./permissions.controller.js";

@Module({
  imports: [AuthModule, AccessNestModule],
  providers: [
    {
      provide: ACCESS_AUTH_SESSION_SERVICE,
      useExisting: AuthSessionService,
    },
    {
      provide: APP_GUARD,
      useClass: AccessGuard,
    },
  ],
  controllers: [PermissionsController],
  exports: [AccessNestModule],
})
export class RbacModule {}
