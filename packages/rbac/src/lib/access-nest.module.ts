import { Module } from "@nestjs/common";
import { DiscoveryModule } from "@nestjs/core";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  AccessAuditLog,
  Permission,
  PlatformRole,
  PlatformRolePermission,
  PlatformUserRole,
  Role,
  RolePermission,
  UserDepartment,
  UserDepartmentRole,
  UserOrganization,
  UserOrganizationRole,
  UserTenantRole,
} from "@hermes-swarm/core";
import { AccessAuditInterceptor } from "./access-audit.interceptor.js";
import { AccessAuditService } from "./access-audit.service.js";
import { AccessCatalogService } from "./access-catalog.service.js";
import { AccessScopeService } from "./access-scope.service.js";
import { AccessService } from "./access-service.js";
import { PLATFORM_DATA_SOURCE } from "./tokens.js";

@Module({
  imports: [
    DiscoveryModule,
    TypeOrmModule.forFeature([
      RolePermission,
      UserDepartment,
      UserDepartmentRole,
      UserOrganization,
      UserOrganizationRole,
      UserTenantRole,
    ]),
    TypeOrmModule.forFeature(
      [
        Permission,
        AccessAuditLog,
        PlatformRole,
        PlatformRolePermission,
        PlatformUserRole,
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
  ],
  exports: [
    AccessAuditInterceptor,
    AccessAuditService,
    AccessCatalogService,
    AccessScopeService,
    AccessService,
  ],
})
export class AccessNestModule {}
