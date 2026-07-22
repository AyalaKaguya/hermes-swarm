import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { EmailSendService } from "./email-send.service.js";
import {
  CustomSmtp,
  EmailLog,
  EmailTemplate,
  PlatformEmailTemplate,
  PlatformSmtp,
} from "@hermes-swarm/core";
import { DatabaseModule } from "../../common/database/database.module.js";
import { WorkspaceMailController } from "./mail.controller.js";
import { MailService } from "./mail.service.js";
import { PlatformMailController } from "./platform-mail.controller.js";
import { SettingsModule } from "../settings/settings.module.js";
import { PlatformEmailSendService } from "./platform-email-send.service.js";

@Module({
  imports: [
    SettingsModule,
    DatabaseModule,
    TypeOrmModule.forFeature([
      CustomSmtp,
      EmailTemplate,
      EmailLog,
      PlatformEmailTemplate,
      PlatformSmtp,
    ]),
  ],
  controllers: [WorkspaceMailController, PlatformMailController],
  providers: [MailService, EmailSendService, PlatformEmailSendService],
  exports: [MailService, EmailSendService, PlatformEmailSendService],
})
export class MailModule {}
