import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Invite, Organization, Role, User } from "@hermes-swarm/core";
import { TenancyModule } from "../tenancy/tenancy.module.js";
import { InviteController } from "./invite.controller.js";
import { InviteService } from "./invite.service.js";

@Module({
  imports: [
    TypeOrmModule.forFeature([Invite, User, Organization, Role]),
    TenancyModule,
  ],
  controllers: [InviteController],
  providers: [InviteService],
  exports: [InviteService],
})
export class InviteModule {}
