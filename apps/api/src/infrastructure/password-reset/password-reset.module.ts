import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Account, PasswordReset } from "@hermes-swarm/core";
import { MailModule } from "../mail/mail.module.js";
import { SettingsModule } from "../settings/settings.module.js";
import { PasswordResetController } from "./password-reset.controller.js";
import { PasswordResetService } from "./password-reset.service.js";
import { DatabaseModule } from "../../common/database/database.module.js";
import { AuthModule } from "../auth/auth.module.js";

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    MailModule,
    SettingsModule,
    TypeOrmModule.forFeature([Account, PasswordReset]),
  ],
  controllers: [PasswordResetController],
  providers: [PasswordResetService],
})
export class PasswordResetModule {}
