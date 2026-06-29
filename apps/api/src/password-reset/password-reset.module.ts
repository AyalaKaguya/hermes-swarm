import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { PasswordReset, User } from "@hermes-swarm/core";
import { PasswordResetController } from "./password-reset.controller.js";
import { PasswordResetService } from "./password-reset.service.js";

@Module({
  imports: [TypeOrmModule.forFeature([PasswordReset, User])],
  controllers: [PasswordResetController],
  providers: [PasswordResetService],
})
export class PasswordResetModule {}
