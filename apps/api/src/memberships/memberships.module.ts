import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  Organization,
  Role,
  User,
  UserOrganization,
} from "@hermes-swarm/core";
import { MembershipsController } from "./memberships.controller.js";
import { MembershipsService } from "./memberships.service.js";

@Module({
  imports: [
    TypeOrmModule.forFeature([Organization, Role, User, UserOrganization]),
  ],
  controllers: [MembershipsController],
  providers: [MembershipsService],
  exports: [MembershipsService],
})
export class MembershipsModule {}
