import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  OrganizationFeatureGroupAccess,
  OrganizationGroup,
  OrganizationGroupMember,
} from "@hermes-swarm/core";
import { RbacModule } from "../rbac/rbac.module.js";
import { SettingsModule } from "../settings/settings.module.js";
import { FeatureAccessGuard } from "./feature-access.guard.js";
import { FeatureAccessService } from "./feature-access.service.js";

@Module({
  imports: [
    RbacModule,
    SettingsModule,
    TypeOrmModule.forFeature([
      OrganizationFeatureGroupAccess,
      OrganizationGroup,
      OrganizationGroupMember,
    ]),
  ],
  providers: [
    FeatureAccessService,
    {
      provide: APP_GUARD,
      useClass: FeatureAccessGuard,
    },
  ],
  exports: [FeatureAccessService],
})
export class FeatureAccessModule {}
