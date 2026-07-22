import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  Account,
  IntegrationToken,
  Role,
  WorkspaceMembership,
} from "@hermes-swarm/core";
import { AuthModule } from "../auth/auth.module.js";
import { AccountController, UsersController } from "./users.controller.js";
import { UsersService } from "./users.service.js";
import { DatabaseModule } from "../../common/database/database.module.js";

@Module({
  imports: [
    AuthModule,
    DatabaseModule,
    TypeOrmModule.forFeature([IntegrationToken, Account, Role, WorkspaceMembership]),
  ],
  controllers: [AccountController, UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
