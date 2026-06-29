import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  Permission,
  PlatformMember,
  RolePermission,
  UserOrganization,
} from "@hermes-swarm/core";
import { RbacGuard } from "./rbac.guard.js";
import { RbacService } from "./rbac.service.js";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Permission,
      PlatformMember,
      RolePermission,
      UserOrganization,
    ]),
  ],
  providers: [
    RbacService,
    {
      provide: APP_GUARD,
      useClass: RbacGuard,
    },
  ],
  exports: [RbacService],
})
export class RbacModule {}
