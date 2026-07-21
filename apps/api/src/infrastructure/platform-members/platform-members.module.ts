import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  Account,
  PlatformMembership,
  Role,
} from "@hermes-swarm/core";
import { PlatformMembersController } from "./platform-members.controller.js";
import { PlatformMembersService } from "./platform-members.service.js";
import { PLATFORM_DATA_SOURCE } from "../../common/database/database.constants.js";
import { InviteModule } from "../invite/invite.module.js";
import { AuthModule } from "../auth/auth.module.js";

@Module({
  imports: [
    AuthModule,
    InviteModule,
    TypeOrmModule.forFeature(
      [Account, PlatformMembership, Role],
      PLATFORM_DATA_SOURCE,
    ),
  ],
  controllers: [PlatformMembersController],
  providers: [PlatformMembersService],
  exports: [PlatformMembersService],
})
export class PlatformMembersModule {}
