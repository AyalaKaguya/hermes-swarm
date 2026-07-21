import { Global, Module } from "@nestjs/common";
import { DiscoveryModule } from "@nestjs/core";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  AccessAuditLog,
  Permission,
  PlatformMembership,
  Role,
  RolePermission,
  WorkspaceMembership,
} from "@hermes-swarm/core";
import { AccessAuditInterceptor } from "./access-audit.interceptor.js";
import { AccessAuditService } from "./access-audit.service.js";
import { AccessCatalogService } from "./access-catalog.service.js";
import { AccessScopeService } from "./access-scope.service.js";
import { AccessService } from "./access-service.js";
import { PLATFORM_DATA_SOURCE } from "./tokens.js";
import { RoleGrantPolicyService } from "./role-grant-policy.service.js";

@Global()
@Module({
  imports: [
    DiscoveryModule,
    TypeOrmModule.forFeature([
      RolePermission,
      WorkspaceMembership,
    ]),
    TypeOrmModule.forFeature(
      [
        Permission,
        AccessAuditLog,
        PlatformMembership,
        Role,
        RolePermission,
      ],
      PLATFORM_DATA_SOURCE,
    ),
  ],
  providers: [
    AccessAuditInterceptor,
    AccessAuditService,
    AccessCatalogService,
    AccessScopeService,
    AccessService,
    RoleGrantPolicyService,
  ],
  exports: [
    AccessAuditInterceptor,
    AccessAuditService,
    AccessCatalogService,
    AccessScopeService,
    AccessService,
    RoleGrantPolicyService,
  ],
})
export class AccessNestModule {}
