import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  Invite,
  Organization,
  Role,
  User,
  UserOrganization,
} from "@hermes-swarm/core";
import { AuthModule } from "../auth/auth.module.js";
import { InviteController } from "./invite.controller.js";
import { InviteService } from "./invite.service.js";

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([Invite, User, Organization, Role, UserOrganization]),
  ],
  controllers: [InviteController],
  providers: [InviteService],
  exports: [InviteService],
})
export class InviteModule {}
