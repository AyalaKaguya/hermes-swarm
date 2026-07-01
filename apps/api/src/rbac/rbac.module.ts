import { Module } from "@nestjs/common";
import { APP_GUARD, DiscoveryModule } from "@nestjs/core";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  Permission,
  PlatformMember,
  Role,
  RolePermission,
  UserOrganization,
} from "@hermes-swarm/core";
import { RbacGuard } from "./rbac.guard.js";
import { PermissionsController } from "./permissions.controller.js";
import { RbacCatalogService } from "./rbac-catalog.service.js";
import { RbacService } from "./rbac.service.js";

@Module({
  imports: [
    DiscoveryModule,
    TypeOrmModule.forFeature([
      Permission,
      PlatformMember,
      Role,
      RolePermission,
      UserOrganization,
    ]),
  ],
  providers: [
    RbacCatalogService,
    RbacService,
    {
      provide: APP_GUARD,
      useClass: RbacGuard,
    },
  ],
  controllers: [PermissionsController],
  exports: [RbacCatalogService, RbacService],
})
export class RbacModule {}
