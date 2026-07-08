import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { PasswordReset, User, UserOrganization } from "@hermes-swarm/core";
import { MailModule } from "../mail/mail.module.js";
import { SettingsModule } from "../settings/settings.module.js";
import { PasswordResetController } from "./password-reset.controller.js";
import { PasswordResetService } from "./password-reset.service.js";

@Module({
  imports: [
    MailModule,
    SettingsModule,
    TypeOrmModule.forFeature([PasswordReset, User, UserOrganization]),
  ],
  controllers: [PasswordResetController],
  providers: [PasswordResetService],
})
export class PasswordResetModule {}
