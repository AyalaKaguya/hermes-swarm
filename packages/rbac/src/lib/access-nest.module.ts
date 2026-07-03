import { Module } from "@nestjs/common";
import { DiscoveryModule } from "@nestjs/core";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  Permission,
  PlatformMember,
  Role,
  RolePermission,
  UserOrganization,
} from "@hermes-swarm/core";
import { AccessAuditInterceptor } from "./access-audit.interceptor.js";
import { AccessCatalogService } from "./access-catalog.service.js";
import { AccessScopeService } from "./access-scope.service.js";
import { AccessService } from "./access-service.js";

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
    AccessAuditInterceptor,
    AccessCatalogService,
    AccessScopeService,
    AccessService,
  ],
  exports: [
    AccessAuditInterceptor,
    AccessCatalogService,
    AccessScopeService,
    AccessService,
  ],
})
export class AccessNestModule {}

