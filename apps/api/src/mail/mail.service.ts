import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { CustomSmtp, EmailLog, EmailTemplate } from "@hermes-swarm/core";
import { IsNull, Repository } from "typeorm";

type SmtpPayload = {
  fromAddress?: string | null;
  host?: string;
  isValidated?: boolean;
  password?: string | null;
  port?: number;
  secure?: boolean;
  username?: string | null;
};

type EmailTemplatePayload = {
  hbs?: string;
  languageCode?: string;
  mjml?: string | null;
  name?: string;
  subject?: string | null;
};

type EmailLogPayload = {
  content?: string | null;
  email?: string;
  isArchived?: boolean;
  status?: "queued" | "sent" | "failed" | "skipped";
  subject?: string | null;
  templateName?: string | null;
};

@Injectable()
export class MailService {
  constructor(
    @InjectRepository(CustomSmtp)
    private readonly smtpRepository: Repository<CustomSmtp>,
    @InjectRepository(EmailTemplate)
    private readonly emailTemplateRepository: Repository<EmailTemplate>,
    @InjectRepository(EmailLog)
    private readonly emailLogRepository: Repository<EmailLog>,
  ) {}

  async getSmtp(organizationId: string) {
    const record = await this.findSmtpRecord(organizationId);
    return record ? toSmtpDto(record) : null;
  }

  async saveSmtp(organizationId: string, payload: SmtpPayload) {
    const entity = await this.findOrCreateSmtpRecord(organizationId);
    applySmtpPayload(entity, payload);
    entity.organizationId = organizationId;
    entity.isValidated = Boolean(payload.isValidated);
    return toSmtpDto(await this.smtpRepository.save(entity));
  }

  validateSmtp(payload: SmtpPayload) {
    return validateSmtpPayload(payload);
  }

  async listTemplates(organizationId: string) {
    const templates = await this.emailTemplateRepository.find({
      where: [{ organizationId }, { organizationId: IsNull() }],
      order: { name: "ASC", languageCode: "ASC" },
    });
    return templates.map(toTemplateDto);
  }

  async createTemplate(organizationId: string, payload: EmailTemplatePayload) {
    const template = this.emailTemplateRepository.create({
      hbs: requireText(payload.hbs, "模板内容"),
      languageCode: requireText(payload.languageCode, "语言编码"),
      mjml: normalizeOptionalText(payload.mjml),
      name: requireText(payload.name, "模板名称"),
      organizationId,
      subject: normalizeOptionalText(payload.subject),
    });
    return toTemplateDto(await this.emailTemplateRepository.save(template));
  }

  async updateTemplate(
    organizationId: string,
    templateId: string,
    payload: EmailTemplatePayload,
  ) {
    const template = await this.getTemplateOrThrow(organizationId, templateId);
    if (payload.name !== undefined) {
      template.name = requireText(payload.name, "模板名称");
    }
    if (payload.languageCode !== undefined) {
      template.languageCode = requireText(payload.languageCode, "语言编码");
    }
    if (payload.hbs !== undefined) {
      template.hbs = requireText(payload.hbs, "模板内容");
    }
    if (payload.mjml !== undefined) {
      template.mjml = normalizeOptionalText(payload.mjml);
    }
    if (payload.subject !== undefined) {
      template.subject = normalizeOptionalText(payload.subject);
    }
    return toTemplateDto(await this.emailTemplateRepository.save(template));
  }

  async deleteTemplate(organizationId: string, templateId: string) {
    const template = await this.getTemplateOrThrow(organizationId, templateId);
    await this.emailTemplateRepository.remove(template);
    return { id: templateId };
  }

  async listLogs(organizationId: string) {
    const logs = await this.emailLogRepository.find({
      where: { organizationId },
      order: { createdAt: "DESC" },
    });
    return logs.map(toLogDto);
  }

  async createLog(organizationId: string, payload: EmailLogPayload) {
    const log = this.emailLogRepository.create({
      content: normalizeOptionalText(payload.content),
      email: requireText(payload.email, "收件邮箱"),
      isArchived: Boolean(payload.isArchived),
      organizationId,
      status: payload.status ?? "queued",
      subject: normalizeOptionalText(payload.subject),
      templateName: normalizeOptionalText(payload.templateName),
    });
    return toLogDto(await this.emailLogRepository.save(log));
  }

  private async getTemplateOrThrow(organizationId: string, templateId: string) {
    const template = await this.emailTemplateRepository.findOne({
      where: { id: templateId, organizationId },
    });
    if (!template) throw new NotFoundException("邮件模板不存在");
    return template;
  }

  private async findSmtpRecord(organizationId: string) {
    return this.smtpRepository.findOne({
      where: [{ organizationId }, { organizationId: IsNull() }],
      order: { createdAt: "DESC" },
    });
  }

  private async findOrCreateSmtpRecord(organizationId: string) {
    const existing = await this.smtpRepository.findOne({
      where: { organizationId },
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

function applySmtpPayload(entity: CustomSmtp, payload: SmtpPayload) {
  if (payload.fromAddress !== undefined) {
    entity.fromAddress = normalizeOptionalText(payload.fromAddress);
  }
  if (payload.host !== undefined) {
    entity.host = requireText(payload.host, "SMTP Host");
  }
  if (payload.port !== undefined) entity.port = normalizePort(payload.port);
  if (payload.secure !== undefined) entity.secure = Boolean(payload.secure);
  if (payload.username !== undefined) {
    entity.username = normalizeOptionalText(payload.username);
  }
  if (payload.password !== undefined) {
    entity.password = normalizeOptionalText(payload.password);
  }
}

function validateSmtpPayload(payload: SmtpPayload) {
  const host = payload.host?.trim();
  const port = normalizePort(payload.port ?? 587);
  if (!host) throw new BadRequestException("SMTP Host 不能为空");
  return {
    fromAddress: normalizeOptionalText(payload.fromAddress),
    host,
    isValid: true,
    port,
    secure: Boolean(payload.secure),
    username: normalizeOptionalText(payload.username),
  };
}

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

function requireText(value: string | undefined, label: string) {
  const text = value?.trim();
  if (!text) throw new BadRequestException(`${label}不能为空`);
  return text;
}

function normalizeOptionalText(value: string | null | undefined) {
  const text = value?.trim();
  return text || null;
}

function normalizePort(value: number | string | undefined) {
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new BadRequestException("端口格式不正确");
  }
  return port;
}
