import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import type { EntityManager } from "typeorm";
import { MailLogsService } from "./mail-logs.service.js";
import { MailSmtpService } from "./mail-smtp.service.js";
import { MailTemplatesService } from "./mail-templates.service.js";
import type {
  EmailLogPayload,
  EmailTemplatePayload,
  EmailTemplatePreviewPayload,
  SmtpPayload,
} from "./mail.types.js";

export type {
  EmailLogPayload,
  EmailTemplatePayload,
  EmailTemplatePreviewPayload,
  SmtpPayload,
} from "./mail.types.js";

/**
 * Stable integration facade for the existing mail controllers and senders.
 * SMTP, templates, and logs each live in their own focused service.
 */
@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);

  constructor(
    private readonly smtpService: MailSmtpService,
    private readonly templatesService: MailTemplatesService,
    private readonly logsService: MailLogsService,
  ) {}

  async onModuleInit() {
    await this.templatesService.ensureDefaultPlatformTemplates().catch((error) => {
      this.logger.warn(`Failed to seed platform email templates: ${error}`);
    });
  }

  getPlatformSmtp() {
    return this.smtpService.getPlatformSmtp();
  }

  getWorkspaceSmtp() {
    return this.smtpService.getWorkspaceSmtp();
  }

  saveWorkspaceSmtp(payload: SmtpPayload) {
    return this.smtpService.saveWorkspaceSmtp(payload);
  }

  savePlatformSmtp(payload: SmtpPayload) {
    return this.smtpService.savePlatformSmtp(payload);
  }

  validateSmtp(payload: SmtpPayload) {
    return this.smtpService.validateSmtp(payload);
  }

  listPlatformTemplates() {
    return this.templatesService.listPlatformTemplates();
  }

  listWorkspaceTemplates() {
    return this.templatesService.listWorkspaceTemplates();
  }

  createWorkspaceTemplate(payload: EmailTemplatePayload) {
    return this.templatesService.createWorkspaceTemplate(payload);
  }

  updateWorkspaceTemplate(templateId: string, payload: EmailTemplatePayload) {
    return this.templatesService.updateWorkspaceTemplate(templateId, payload);
  }

  deleteWorkspaceTemplate(templateId: string) {
    return this.templatesService.deleteWorkspaceTemplate(templateId);
  }

  createPlatformTemplate(payload: EmailTemplatePayload) {
    return this.templatesService.createPlatformTemplate(payload);
  }

  updatePlatformTemplate(templateId: string, payload: EmailTemplatePayload) {
    return this.templatesService.updatePlatformTemplate(templateId, payload);
  }

  deletePlatformTemplate(templateId: string) {
    return this.templatesService.deletePlatformTemplate(templateId);
  }

  ensureDefaultPlatformTemplates(manager?: EntityManager) {
    return this.templatesService.ensureDefaultPlatformTemplates(manager);
  }

  previewTemplate(payload: EmailTemplatePreviewPayload) {
    return this.templatesService.previewTemplate(payload);
  }

  listLogs() {
    return this.logsService.listLogs();
  }

  createLog(payload: EmailLogPayload) {
    return this.logsService.createLog(payload);
  }
}
