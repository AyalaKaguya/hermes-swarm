import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import Handlebars from "handlebars";
import nodemailer from "nodemailer";
import {
  PlatformEmailTemplate,
  PlatformSmtp,
} from "@hermes-swarm/core";
import { Repository } from "typeorm";
import { PLATFORM_DATA_SOURCE } from "../../common/database/database.constants.js";
import { MailService } from "./mail.service.js";
import type {
  EmailLanguageCode,
  SendEmailResult,
} from "./email-send.service.js";

export type SendPlatformEmailContext = {
  email: string;
  languageCode?: EmailLanguageCode;
  locals?: Record<string, unknown>;
  templateName: string;
};

/** Sends control-plane mail without creating or reading a tenant context. */
@Injectable()
export class PlatformEmailSendService {
  private readonly logger = new Logger(PlatformEmailSendService.name);

  constructor(
    @InjectRepository(PlatformEmailTemplate, PLATFORM_DATA_SOURCE)
    private readonly templateRepository: Repository<PlatformEmailTemplate>,
    @InjectRepository(PlatformSmtp, PLATFORM_DATA_SOURCE)
    private readonly smtpRepository: Repository<PlatformSmtp>,
    private readonly mailService: MailService,
  ) {}

  async send(ctx: SendPlatformEmailContext): Promise<SendEmailResult> {
    const recipient = ctx.email?.trim();
    if (!recipient) return { sent: false, reason: "recipient_missing" };

    try {
      await this.mailService.ensureDefaultPlatformTemplates();
      const smtp = await this.smtpRepository.findOne({
        order: { createdAt: "DESC" },
      });
      if (!smtp?.host) return { sent: false, reason: "smtp_not_configured" };

      const template = await this.resolveTemplate(
        ctx.templateName,
        ctx.languageCode ?? "zh-CN",
      );
      if (!template) return { sent: false, reason: "template_not_found" };

      const locals = ctx.locals ?? {};
      const subject = template.subject
        ? Handlebars.compile(template.subject)(locals)
        : ctx.templateName;
      const html = Handlebars.compile(template.hbs)(locals);
      await nodemailer
        .createTransport({
          auth:
            smtp.username && smtp.password
              ? { pass: smtp.password, user: smtp.username }
              : undefined,
          host: smtp.host,
          port: smtp.port || 587,
          secure: smtp.secure || false,
        })
        .sendMail({
          from: smtp.fromAddress || "noreply@hermes-swarm.local",
          html,
          subject,
          to: recipient,
        });
      return { sent: true };
    } catch (error) {
      this.logger.error("Platform email delivery failed", error);
      return { sent: false, reason: "send_failed" };
    }
  }

  private async resolveTemplate(name: string, languageCode: string) {
    for (const candidate of getLanguageCandidates(languageCode)) {
      const template = await this.templateRepository.findOne({
        where: { languageCode: candidate, name },
      });
      if (template) return template;
    }
    return null;
  }
}

function getLanguageCandidates(languageCode: string) {
  const normalized = languageCode.trim();
  const candidates = [normalized];
  if (normalized === "zh-Hans" || normalized === "zh-CN" || normalized === "zh") {
    candidates.push("zh-CN", "zh-Hans", "zh");
  }
  candidates.push("en");
  return [...new Set(candidates.filter(Boolean))];
}
