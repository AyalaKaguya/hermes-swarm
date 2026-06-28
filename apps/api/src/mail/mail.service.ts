import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { CustomSmtp, EmailLog, EmailTemplate } from "@hermes-swarm/core";
import { IsNull, Repository } from "typeorm";
import { TenancyService } from "../tenancy/tenancy.service.js";

/**
 * Payload accepted when creating or updating custom SMTP settings.
 */
type SmtpPayload = {
  fromAddress?: string | null;
  host?: string;
  isValidated?: boolean;
  password?: string | null;
  port?: number;
  secure?: boolean;
  username?: string | null;
};

/**
 * Payload accepted when creating or updating customizable email templates.
 */
type EmailTemplatePayload = {
  hbs?: string;
  languageCode?: string;
  mjml?: string | null;
  name?: string;
  organizationId?: string | null;
  subject?: string | null;
};

/**
 * Payload accepted when recording a sent, queued, skipped, or failed email.
 */
type EmailLogPayload = {
  content?: string | null;
  email?: string;
  isArchived?: boolean;
  organizationId?: string | null;
  status?: "queued" | "sent" | "failed" | "skipped";
  subject?: string | null;
  templateName?: string | null;
};

type MailScopeOptions = {
  scope?: string;
};

@Injectable()
/**
 * Implements the migrated mail settings surface: SMTP configuration, template
 * CRUD, validation, and sent-email log records.
 */
export class MailService {
  constructor(
    @InjectRepository(CustomSmtp)
    private readonly smtpRepository: Repository<CustomSmtp>,
    @InjectRepository(EmailTemplate)
    private readonly emailTemplateRepository: Repository<EmailTemplate>,
    @InjectRepository(EmailLog)
    private readonly emailLogRepository: Repository<EmailLog>,
    private readonly tenancyService: TenancyService,
  ) {}

  /**
   * Returns the organization SMTP configuration, falling back to global config.
   */
  async getSmtp(
    authorization: string | undefined,
    options: MailScopeOptions = {},
  ) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    const organizationId = this.resolveSmtpOrganizationId(
      context,
      "view",
      options.scope,
    );
    const record = await this.findSmtpRecord(organizationId);
    return record ? toSmtpDto(record) : null;
  }

  /**
   * Creates or updates the SMTP configuration for the current organization.
   */
  async saveSmtp(
    authorization: string | undefined,
    payload: SmtpPayload,
    options: MailScopeOptions = {},
  ) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    const organizationId = this.resolveSmtpOrganizationId(
      context,
      "manage",
      options.scope,
    );
    const entity = await this.findOrCreateSmtpRecord(organizationId);
    applySmtpPayload(entity, payload);
    entity.organizationId = organizationId;
    entity.isValidated = Boolean(payload.isValidated);
    return toSmtpDto(await this.smtpRepository.save(entity));
  }

  /**
   * Validates SMTP input shape without sending mail or requiring nodemailer.
   */
  async validateSmtp(
    authorization: string | undefined,
    payload: SmtpPayload,
    options: MailScopeOptions = {},
  ) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    this.resolveSmtpOrganizationId(context, "manage", options.scope);
    return validateSmtpPayload(payload);
  }

  /**
   * Lists organization-specific and global email templates.
   */
  async listTemplates(authorization: string | undefined) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    this.tenancyService.ensurePermission(context, "email-templates", "view");
    const templates = await this.emailTemplateRepository.find({
      where: [{ organizationId: context.organizationId }, { organizationId: IsNull() }],
      order: { name: "ASC", languageCode: "ASC" },
    });
    return templates.map(toTemplateDto);
  }

  /**
   * Creates a customizable email template for the current organization.
   */
  async createTemplate(
    authorization: string | undefined,
    payload: EmailTemplatePayload,
  ) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    this.tenancyService.ensurePermission(context, "email-templates", "manage");
    const template = this.emailTemplateRepository.create({
      hbs: requireText(payload.hbs, "模板内容"),
      languageCode: requireText(payload.languageCode, "语言编码"),
      mjml: normalizeOptionalText(payload.mjml),
      name: requireText(payload.name, "模板名称"),
      organizationId: payload.organizationId ?? context.organizationId,
      subject: normalizeOptionalText(payload.subject),
    });
    return toTemplateDto(await this.emailTemplateRepository.save(template));
  }

  /**
   * Updates a customizable email template by id.
   */
  async updateTemplate(
    authorization: string | undefined,
    templateId: string,
    payload: EmailTemplatePayload,
  ) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    this.tenancyService.ensurePermission(context, "email-templates", "manage");
    const template = await this.emailTemplateRepository.findOne({
      where: { id: templateId },
    });
    if (!template) {
      throw new NotFoundException("邮件模板不存在");
    }
    if (payload.name !== undefined) template.name = requireText(payload.name, "模板名称");
    if (payload.languageCode !== undefined) template.languageCode = requireText(payload.languageCode, "语言编码");
    if (payload.hbs !== undefined) template.hbs = requireText(payload.hbs, "模板内容");
    if (payload.mjml !== undefined) template.mjml = normalizeOptionalText(payload.mjml);
    if (payload.subject !== undefined) template.subject = normalizeOptionalText(payload.subject);
    if (payload.organizationId !== undefined) template.organizationId = payload.organizationId;
    return toTemplateDto(await this.emailTemplateRepository.save(template));
  }

  /**
   * Deletes an email template by id.
   */
  async deleteTemplate(authorization: string | undefined, templateId: string) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    this.tenancyService.ensurePermission(context, "email-templates", "manage");
    const template = await this.emailTemplateRepository.findOne({
      where: { id: templateId },
    });
    if (!template) {
      throw new NotFoundException("邮件模板不存在");
    }
    await this.emailTemplateRepository.remove(template);
    return { id: templateId };
  }

  /**
   * Lists sent-email records for the current organization.
   */
  async listLogs(authorization: string | undefined) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    this.tenancyService.ensurePermission(context, "email-templates", "view");
    const logs = await this.emailLogRepository.find({
      where: { organizationId: context.organizationId },
      order: { createdAt: "DESC" },
    });
    return logs.map(toLogDto);
  }

  /**
   * Creates an email log record for migrated mail workflows.
   */
  async createLog(authorization: string | undefined, payload: EmailLogPayload) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    this.tenancyService.ensurePermission(context, "email-templates", "manage");
    const log = this.emailLogRepository.create({
      content: normalizeOptionalText(payload.content),
      email: requireText(payload.email, "收件邮箱"),
      isArchived: Boolean(payload.isArchived),
      organizationId: payload.organizationId ?? context.organizationId,
      status: payload.status ?? "queued",
      subject: normalizeOptionalText(payload.subject),
      templateName: normalizeOptionalText(payload.templateName),
    });
    return toLogDto(await this.emailLogRepository.save(log));
  }

  /**
   * Finds the best SMTP record for an organization, with global fallback.
   */
  private resolveSmtpOrganizationId(
    context: Awaited<ReturnType<TenancyService["requireAuthContext"]>>,
    action: "manage" | "view",
    scope?: string,
  ) {
    if (scope === "platform" || context.scopeLevel === "platform") {
      this.tenancyService.ensurePlatformScope(context, "tenant", action);
      return null;
    }

    this.tenancyService.ensurePermission(context, "custom-smtp", action);
    return context.organizationId;
  }

  private async findSmtpRecord(organizationId: string | null) {
    if (!organizationId) {
      return this.smtpRepository.findOne({
        where: { organizationId: IsNull() },
        order: { createdAt: "DESC" },
      });
    }

    return this.smtpRepository.findOne({
      where: [{ organizationId }, { organizationId: IsNull() }],
      order: { createdAt: "DESC" },
    });
  }

  /**
   * Returns an existing SMTP record or an unsaved organization default.
   */
  private async findOrCreateSmtpRecord(organizationId: string | null) {
    const existing = await this.smtpRepository.findOne({
      where: organizationId ? { organizationId } : { organizationId: IsNull() },
      order: { createdAt: "DESC" },
    });
    return (
      existing ??
      this.smtpRepository.create({
        fromAddress: null,
        host: "",
        organizationId,
        password: null,
        port: 587,
        secure: false,
        username: null,
      })
    );
  }
}

/**
 * Applies partial SMTP input onto an entity while preserving unspecified fields.
 */
function applySmtpPayload(entity: CustomSmtp, payload: SmtpPayload) {
  if (payload.fromAddress !== undefined) entity.fromAddress = normalizeOptionalText(payload.fromAddress);
  if (payload.host !== undefined) entity.host = requireText(payload.host, "SMTP Host");
  if (payload.port !== undefined) entity.port = normalizePort(payload.port);
  if (payload.secure !== undefined) entity.secure = Boolean(payload.secure);
  if (payload.username !== undefined) entity.username = normalizeOptionalText(payload.username);
  if (payload.password !== undefined) entity.password = normalizeOptionalText(payload.password);
}

/**
 * Validates SMTP host and port fields and returns a safe public summary.
 */
function validateSmtpPayload(payload: SmtpPayload) {
  const host = payload.host?.trim();
  const port = normalizePort(payload.port ?? 587);
  if (!host) {
    throw new BadRequestException("SMTP Host 不能为空");
  }
  return {
    fromAddress: normalizeOptionalText(payload.fromAddress),
    host,
    isValid: true,
    port,
    secure: Boolean(payload.secure),
    username: normalizeOptionalText(payload.username),
  };
}

/**
 * Removes sensitive SMTP fields from API responses.
 */
function toSmtpDto(entity: CustomSmtp) {
  return {
    fromAddress: entity.fromAddress,
    host: entity.host,
    id: entity.id,
    isValidated: entity.isValidated,
    organizationId: entity.organizationId,
    port: entity.port,
    secure: entity.secure,
    username: entity.username,
  };
}

/**
 * Projects email template entities into API responses.
 */
function toTemplateDto(entity: EmailTemplate) {
  return {
    hbs: entity.hbs,
    id: entity.id,
    languageCode: entity.languageCode,
    mjml: entity.mjml,
    name: entity.name,
    organizationId: entity.organizationId,
    subject: entity.subject,
  };
}

/**
 * Projects sent-email log entities into API responses.
 */
function toLogDto(entity: EmailLog) {
  return {
    content: entity.content,
    email: entity.email,
    id: entity.id,
    isArchived: entity.isArchived,
    organizationId: entity.organizationId,
    status: entity.status,
    subject: entity.subject,
    templateName: entity.templateName,
  };
}

/**
 * Validates required text input with a localized field label.
 */
function requireText(value: string | undefined, label: string) {
  const text = value?.trim();
  if (!text) {
    throw new BadRequestException(`${label}不能为空`);
  }
  return text;
}

/**
 * Trims optional text and stores empty values as null.
 */
function normalizeOptionalText(value: string | null | undefined) {
  const text = value?.trim();
  return text || null;
}

/**
 * Normalizes and validates SMTP port numbers.
 */
function normalizePort(value: number | string | undefined) {
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new BadRequestException("端口格式不正确");
  }
  return port;
}
