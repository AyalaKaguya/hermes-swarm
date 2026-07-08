import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { EmailSendService } from "./email-send.service.js";
import { CustomSmtp, EmailLog, EmailTemplate } from "@hermes-swarm/core";
import { MailController } from "./mail.controller.js";
import { MailService } from "./mail.service.js";

@Module({
  imports: [
    TypeOrmModule.forFeature([CustomSmtp, EmailTemplate, EmailLog]),
  ],
  controllers: [MailController],
  providers: [MailService, EmailSendService],
  exports: [MailService, EmailSendService],
})
export class MailModule {}
