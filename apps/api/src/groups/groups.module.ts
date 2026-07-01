import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  Organization,
  OrganizationFeatureGroupAccess,
  OrganizationGroup,
  OrganizationGroupMember,
  UserOrganization,
} from "@hermes-swarm/core";
import { FeatureAccessModule } from "../feature-access/feature-access.module.js";
import { GroupsController } from "./groups.controller.js";
import { GroupsService } from "./groups.service.js";

@Module({
  imports: [
    FeatureAccessModule,
    TypeOrmModule.forFeature([
      Organization,
      OrganizationFeatureGroupAccess,
      OrganizationGroup,
      OrganizationGroupMember,
      UserOrganization,
    ]),
  ],
  controllers: [GroupsController],
  providers: [GroupsService],
})
export class GroupsModule {}
