import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { EmailSendService } from "./email-send.service.js";
import { CustomSmtp, EmailLog, EmailTemplate } from "@hermes-swarm/core";
import { MailController } from "./mail.controller.js";
import { MailService } from "./mail.service.js";
import { PlatformMailController } from "./platform-mail.controller.js";
import { SettingsModule } from "../settings/settings.module.js";

@Module({
  imports: [
    SettingsModule,
    TypeOrmModule.forFeature([CustomSmtp, EmailTemplate, EmailLog]),
  ],
  controllers: [MailController, PlatformMailController],
  providers: [MailService, EmailSendService],
  exports: [MailService, EmailSendService],
})
export class MailModule {}
