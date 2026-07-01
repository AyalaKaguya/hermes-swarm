import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  Organization,
  OrganizationGroup,
  OrganizationGroupMember,
  UserOrganization,
} from "@hermes-swarm/core";
import { GroupsController } from "./groups.controller.js";
import { GroupsService } from "./groups.service.js";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Organization,
      OrganizationGroup,
      OrganizationGroupMember,
      UserOrganization,
    ]),
  ],
  controllers: [GroupsController],
  providers: [GroupsService],
})
export class GroupsModule {}
