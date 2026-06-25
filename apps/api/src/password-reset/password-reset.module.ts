import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { PasswordReset, User } from "@hermes-swarm/core";
import { TenancyModule } from "../tenancy/tenancy.module.js";
import { PasswordResetController } from "./password-reset.controller.js";
import { PasswordResetService } from "./password-reset.service.js";

@Module({
  imports: [TypeOrmModule.forFeature([PasswordReset, User]), TenancyModule],
  controllers: [PasswordResetController],
  providers: [PasswordResetService],
})
export class PasswordResetModule {}
