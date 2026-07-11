import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  PlatformRole,
  PlatformUser,
  PlatformUserRole,
} from "@hermes-swarm/core";
import { PlatformMembersController } from "./platform-members.controller.js";
import { PlatformMembersService } from "./platform-members.service.js";
import { PLATFORM_DATA_SOURCE } from "../../common/database/database.constants.js";

@Module({
  imports: [
    TypeOrmModule.forFeature(
      [PlatformRole, PlatformUser, PlatformUserRole],
      PLATFORM_DATA_SOURCE,
    ),
  ],
  controllers: [PlatformMembersController],
  providers: [PlatformMembersService],
  exports: [PlatformMembersService],
})
export class PlatformMembersModule {}
