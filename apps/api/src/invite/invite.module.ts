import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  Invite,
  Organization,
  Role,
  User,
  UserOrganization,
} from "@hermes-swarm/core";
import { InviteController } from "./invite.controller.js";
import { InviteService } from "./invite.service.js";

@Module({
  imports: [
    TypeOrmModule.forFeature([Invite, User, Organization, Role, UserOrganization]),
  ],
  controllers: [InviteController],
  providers: [InviteService],
  exports: [InviteService],
})
export class InviteModule {}
