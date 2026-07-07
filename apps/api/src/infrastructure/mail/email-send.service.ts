import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import Handlebars from "handlebars";
import nodemailer from "nodemailer";
import { Repository } from "typeorm";
import { CustomSmtp, EmailLog, EmailTemplate } from "@hermes-swarm/core";

export type EmailLanguageCode = "en" | "zh-CN" | "zh-Hans" | "zh-Hant";

export type SendEmailContext = {
  email: string;
  organizationId: string;
  templateName: string;
  languageCode?: EmailLanguageCode;
  locals?: Record<string, unknown>;
};

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
  ) {}

  async send(ctx: SendEmailContext): Promise<void> {
    const smtp = await this.findSmtpRecord(ctx.organizationId);
    if (!smtp || !smtp.host) {
      this.logger.warn(`No SMTP config for org ${ctx.organizationId}`);
      return;
    }

    const langCode = ctx.languageCode || "zh-CN";
    const template = await this.resolveTemplate(ctx.templateName, langCode, ctx.organizationId);
    if (!template) {
      this.logger.warn(`No template "${ctx.templateName}" for lang "${langCode}"`);
      return;
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
        to: ctx.email,
        subject,
        html,
      });

      await this.recordLog({
        content: html,
        email: ctx.email,
        organizationId: ctx.organizationId,
        status: "sent",
        subject,
        templateName: ctx.templateName,
      });
    } catch (error) {
      this.logger.error(`Failed to send email:`, error);
      await this.recordLog({
        content: null,
        email: ctx.email,
        organizationId: ctx.organizationId,
        status: "failed",
        subject: null,
        templateName: ctx.templateName,
      });
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
    organizationId: string,
  ): Promise<EmailTemplate | null> {
    let template = await this.templateRepository.findOne({
      where: { name, languageCode, organizationId },
    });
    if (template) return template;
    template = await this.templateRepository.findOne({
      where: { name, languageCode: "en", organizationId },
    });
    if (template) return template;
    template = await this.templateRepository.findOne({
      where: { name, languageCode, organizationId: null as unknown as string },
    });
    if (template) return template;
    return this.templateRepository.findOne({
      where: { name, languageCode: "en", organizationId: null as unknown as string },
    });
  }

  private async findSmtpRecord(organizationId: string): Promise<CustomSmtp | null> {
    return this.smtpRepository.findOne({
      where: [{ organizationId }, { organizationId: null as unknown as string }],
      order: { createdAt: "DESC" },
    });
  }

  private async recordLog(entry: {
    content: string | null;
    email: string;
    organizationId: string;
    status: "sent" | "failed";
    subject: string | null;
    templateName: string;
  }) {
    try {
      await this.emailLogRepository.save(this.emailLogRepository.create(entry));
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
