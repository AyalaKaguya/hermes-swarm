import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { PlatformMember, Role, User } from "@hermes-swarm/core";
import { PlatformMembersController } from "./platform-members.controller.js";
import { PlatformMembersService } from "./platform-members.service.js";

@Module({
  imports: [TypeOrmModule.forFeature([PlatformMember, Role, User])],
  controllers: [PlatformMembersController],
  providers: [PlatformMembersService],
  exports: [PlatformMembersService],
})
export class PlatformMembersModule {}
