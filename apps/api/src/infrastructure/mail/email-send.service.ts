import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import Handlebars from "handlebars";
import nodemailer from "nodemailer";
import { IsNull, Repository } from "typeorm";
import { CustomSmtp, EmailLog, EmailTemplate } from "@hermes-swarm/core";
import { PLATFORM_SETTING_KEYS } from "@hermes-swarm/core/settings/definitions";
import { SettingsService } from "../settings/settings.service.js";

export type EmailLanguageCode = "en" | "zh-CN" | "zh-Hans" | "zh-Hant";

export type SendEmailContext = {
  email: string;
  organizationId: string | null;
  templateName: string;
  languageCode?: EmailLanguageCode;
  locals?: Record<string, unknown>;
};

export type SendEmailFailureReason =
  | "recipient_missing"
  | "send_failed"
  | "smtp_not_configured"
  | "template_not_found";

export type SendEmailResult =
  | { sent: true; reason?: never }
  | { sent: false; reason: SendEmailFailureReason };

@Injectable()
export class EmailSendService {
  private readonly logger = new Logger(EmailSendService.name);

  constructor(
    @InjectRepository(CustomSmtp)
    private readonly smtpRepository: Repository<CustomSmtp>,
    @InjectRepository(EmailTemplate)
    private readonly templateRepository: Repository<EmailTemplate>,
    @InjectRepository(EmailLog)
    private readonly emailLogRepository: Repository<EmailLog>,
    private readonly settingsService: SettingsService,
  ) {}

  async send(ctx: SendEmailContext): Promise<SendEmailResult> {
    const recipient = ctx.email?.trim();
    if (!recipient) {
      await this.recordLog({
        content: null,
        email: "",
        organizationId: ctx.organizationId,
        status: "skipped",
        subject: null,
        templateName: ctx.templateName,
      });
      return { sent: false, reason: "recipient_missing" };
    }

    let smtp: CustomSmtp | null;
    try {
      smtp = await this.findSmtpRecord(ctx.organizationId);
    } catch (error) {
      this.logger.error("Failed to resolve SMTP config:", error);
      await this.recordLog({
        content: null,
        email: recipient,
        organizationId: ctx.organizationId,
        status: "failed",
        subject: null,
        templateName: ctx.templateName,
      });
      return { sent: false, reason: "send_failed" };
    }

    if (!smtp || !smtp.host) {
      this.logger.warn(`No SMTP config for org ${ctx.organizationId}`);
      await this.recordLog({
        content: null,
        email: recipient,
        organizationId: ctx.organizationId,
        status: "skipped",
        subject: null,
        templateName: ctx.templateName,
      });
      return { sent: false, reason: "smtp_not_configured" };
    }

    const langCode = ctx.languageCode || "zh-CN";
    let template: EmailTemplate | null;
    try {
      template = await this.resolveTemplate(
        ctx.templateName,
        langCode,
        ctx.organizationId,
      );
    } catch (error) {
      this.logger.error("Failed to resolve email template:", error);
      await this.recordLog({
        content: null,
        email: recipient,
        organizationId: ctx.organizationId,
        status: "failed",
        subject: null,
        templateName: ctx.templateName,
      });
      return { sent: false, reason: "send_failed" };
    }

    if (!template) {
      this.logger.warn(`No template "${ctx.templateName}" for lang "${langCode}"`);
      await this.recordLog({
        content: null,
        email: recipient,
        organizationId: ctx.organizationId,
        status: "skipped",
        subject: null,
        templateName: ctx.templateName,
      });
      return { sent: false, reason: "template_not_found" };
    }

    try {
      const transporter = this.createTransporter(smtp);
      const compiled = Handlebars.compile(template.hbs);
      const html = compiled(ctx.locals ?? {});
      const subject = template.subject
        ? Handlebars.compile(template.subject)(ctx.locals ?? {})
        : ctx.templateName;

      await transporter.sendMail({
        from: smtp.fromAddress || "noreply@hermes-swarm.local",
        to: recipient,
        subject,
        html,
      });

      await this.recordLog({
        content: html,
        email: recipient,
        organizationId: ctx.organizationId,
        status: "sent",
        subject,
        templateName: ctx.templateName,
      });
      return { sent: true };
    } catch (error) {
      this.logger.error(`Failed to send email:`, error);
      await this.recordLog({
        content: null,
        email: recipient,
        organizationId: ctx.organizationId,
        status: "failed",
        subject: null,
        templateName: ctx.templateName,
      });
      return { sent: false, reason: "send_failed" };
    }
  }

  private createTransporter(smtp: CustomSmtp): ReturnType<typeof nodemailer.createTransport> {
    return nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port || 587,
      secure: smtp.secure || false,
      auth: smtp.username && smtp.password
        ? { user: smtp.username, pass: smtp.password }
        : undefined,
    });
  }

  private async resolveTemplate(
    name: string,
    languageCode: string,
    organizationId: string | null,
  ): Promise<EmailTemplate | null> {
    const languageCodes = getTemplateLanguageCandidates(languageCode);

    if (organizationId) {
      for (const candidate of languageCodes) {
        const template = await this.templateRepository.findOne({
          where: { name, languageCode: candidate, organizationId },
        });
        if (template) return template;
      }
    }

    for (const candidate of languageCodes) {
      const template = await this.templateRepository.findOne({
        where: { name, languageCode: candidate, organizationId: IsNull() },
      });
      if (template) return template;
    }

    return null;
  }

  private async findSmtpRecord(
    organizationId: string | null,
  ): Promise<CustomSmtp | null> {
    if (organizationId) {
      const organizationSmtp = await this.smtpRepository.findOne({
        where: { organizationId },
        order: { createdAt: "DESC" },
      });
      if (organizationSmtp) return organizationSmtp;
    }

    const publicSmtpEnabled = await this.settingsService.getPlatformValue(
      PLATFORM_SETTING_KEYS.publicSmtpEnabled,
      "false",
    );
    if (publicSmtpEnabled !== "true") return null;

    return this.smtpRepository.findOne({
      where: { organizationId: IsNull() },
      order: { createdAt: "DESC" },
    });
  }

  private async recordLog(entry: {
    content: string | null;
    email: string;
    organizationId: string | null;
    status: "sent" | "failed" | "skipped";
    subject: string | null;
    templateName: string;
  }) {
    try {
      await this.emailLogRepository.save(
        this.emailLogRepository.create(normalizeEmailLogEntry(entry)),
      );
    } catch (error) {
      this.logger.error("Failed to record email log:", error);
    }
  }

  async verifySmtp(smtp: CustomSmtp): Promise<boolean> {
    try {
      return await this.createTransporter(smtp).verify();
    } catch {
      return false;
    }
  }
}

function normalizeEmailLogEntry(entry: {
  content: string | null;
  email: string;
  organizationId: string | null;
  status: "sent" | "failed" | "skipped";
  subject: string | null;
  templateName: string;
}) {
  return {
    ...entry,
    email: fitEmailLogText(entry.email, 240, { fallback: "" }) ?? "",
    subject: fitEmailLogText(entry.subject, 240, { nullable: true }),
    templateName: fitEmailLogText(entry.templateName, 120, {
      fallback: null,
      nullable: true,
    }),
  };
}

function fitEmailLogText(
  value: string | null | undefined,
  maxLength: number,
  options: { fallback?: string | null; nullable?: boolean } = {},
) {
  if (value === undefined || value === null) {
    return options.nullable ? null : options.fallback ?? "";
  }
  const normalized = String(value).trim();
  if (!normalized) return options.nullable ? null : options.fallback ?? "";
  return normalized.length > maxLength
    ? normalized.slice(0, maxLength)
    : normalized;
}

function getTemplateLanguageCandidates(languageCode: string) {
  const normalized = languageCode.trim();
  const candidates = [normalized];

  if (normalized === "zh-Hans" || normalized === "zh-CN" || normalized === "zh") {
    candidates.push("zh-CN", "zh-Hans", "zh");
  } else if (normalized === "zh-Hant") {
    candidates.push("zh-TW", "zh-HK");
  }

  candidates.push("en");
  return [...new Set(candidates.filter(Boolean))];
}
