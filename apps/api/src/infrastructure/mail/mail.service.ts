import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from "@nestjs/common";
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
  description?: string | null;
  hbs?: string;
  isSystem?: boolean;
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
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);

  constructor(
    @InjectRepository(CustomSmtp)
    private readonly smtpRepository: Repository<CustomSmtp>,
    @InjectRepository(EmailTemplate)
    private readonly emailTemplateRepository: Repository<EmailTemplate>,
    @InjectRepository(EmailLog)
    private readonly emailLogRepository: Repository<EmailLog>,
  ) {}

  async onModuleInit() {
    await this.ensureDefaultPlatformTemplates().catch((error) => {
      this.logger.warn(`Failed to seed platform email templates: ${error}`);
    });
  }

  async getSmtp(organizationId: string) {
    const record = await this.findSmtpRecord(organizationId);
    return record ? toSmtpDto(record) : null;
  }

  async getPlatformSmtp() {
    const record = await this.findGlobalSmtpRecord();
    return record ? toSmtpDto(record) : null;
  }

  async saveSmtp(organizationId: string, payload: SmtpPayload) {
    const entity = await this.findOrCreateSmtpRecord(organizationId);
    applySmtpPayload(entity, payload);
    entity.organizationId = organizationId;
    entity.isValidated = Boolean(payload.isValidated);
    return toSmtpDto(await this.smtpRepository.save(entity));
  }

  async savePlatformSmtp(payload: SmtpPayload) {
    const entity = await this.findOrCreateSmtpRecord(null);
    applySmtpPayload(entity, payload);
    entity.organizationId = null;
    entity.isValidated = Boolean(payload.isValidated);
    return toSmtpDto(await this.smtpRepository.save(entity));
  }

  validateSmtp(payload: SmtpPayload) {
    return validateSmtpPayload(payload);
  }

  async listTemplates(organizationId: string | null) {
    if (organizationId === null) {
      await this.ensureDefaultPlatformTemplates();
    } else {
      await this.ensureDefaultTemplatesForOrganization(organizationId);
    }

    const where =
      organizationId === null
        ? { organizationId: IsNull() }
        : [{ organizationId }, { organizationId: IsNull() }];
    const templates = await this.emailTemplateRepository.find({
      where,
      order: { name: "ASC", languageCode: "ASC" },
    });
    return dedupeTemplatesForDisplay(templates, organizationId).map(toTemplateDto);
  }

  async createTemplate(organizationId: string | null, payload: EmailTemplatePayload) {
    const template = this.emailTemplateRepository.create({
      description: normalizeOptionalText(payload.description),
      hbs: requireText(payload.hbs, "模板内容"),
      isSystem: Boolean(payload.isSystem),
      languageCode: requireText(payload.languageCode, "语言编码"),
      mjml: normalizeOptionalText(payload.mjml),
      name: requireText(payload.name, "模板名称"),
      organizationId,
      subject: normalizeOptionalText(payload.subject),
    });
    return toTemplateDto(await this.emailTemplateRepository.save(template));
  }

  async updateTemplate(
    organizationId: string | null,
    templateId: string,
    payload: EmailTemplatePayload,
  ) {
    const template = await this.getTemplateOrThrow(organizationId, templateId);
    if (payload.name !== undefined) {
      const nextName = requireText(payload.name, "模板名称");
      if (template.isSystem && nextName !== template.name) {
        throw new BadRequestException("系统模板名称不能修改");
      }
      template.name = nextName;
    }
    if (payload.description !== undefined) {
      template.description = normalizeOptionalText(payload.description);
    }
    if (payload.languageCode !== undefined) {
      const nextLanguageCode = requireText(payload.languageCode, "语言编码");
      if (template.isSystem && nextLanguageCode !== template.languageCode) {
        throw new BadRequestException("系统模板语言不能修改");
      }
      template.languageCode = nextLanguageCode;
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

  async deleteTemplate(organizationId: string | null, templateId: string) {
    const template = await this.getTemplateOrThrow(organizationId, templateId);
    if (template.isSystem) throw new BadRequestException("系统模板不能删除");
    await this.emailTemplateRepository.remove(template);
    return { id: templateId };
  }

  async ensureDefaultTemplatesForOrganization(organizationId: string) {
    await this.ensureDefaultTemplates(organizationId);
  }

  async ensureDefaultPlatformTemplates() {
    await this.ensureDefaultTemplates(null);
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

  private async getTemplateOrThrow(organizationId: string | null, templateId: string) {
    const template = await this.emailTemplateRepository.findOne({
      where: {
        id: templateId,
        organizationId: organizationId ?? IsNull(),
      },
    });
    if (!template) throw new NotFoundException("邮件模板不存在");
    return template;
  }

  private async findSmtpRecord(organizationId: string) {
    const organizationRecord = await this.smtpRepository.findOne({
      where: { organizationId },
      order: { createdAt: "DESC" },
    });
    return organizationRecord ?? this.findGlobalSmtpRecord();
  }

  private async findGlobalSmtpRecord() {
    return this.smtpRepository.findOne({
      where: { organizationId: IsNull() },
      order: { createdAt: "DESC" },
    });
  }

  private async findOrCreateSmtpRecord(organizationId: string | null) {
    const existing = await this.smtpRepository.findOne({
      where:
        organizationId === null
          ? { organizationId: IsNull() }
          : { organizationId },
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

  private async ensureDefaultTemplates(organizationId: string | null) {
    for (const definition of DEFAULT_EMAIL_TEMPLATES) {
      const existing = await this.emailTemplateRepository.findOne({
        where: {
          languageCode: definition.languageCode,
          name: definition.name,
          organizationId: organizationId ?? IsNull(),
        },
      });
      if (existing) continue;
      await this.emailTemplateRepository.save(
        this.emailTemplateRepository.create({
          ...definition,
          isSystem: true,
          organizationId: organizationId as string | null,
        }),
      );
    }
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
    description: entity.description,
    hbs: entity.hbs,
    id: entity.id,
    isSystem: entity.isSystem,
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

function dedupeTemplatesForDisplay(
  templates: EmailTemplate[],
  organizationId: string | null,
) {
  if (organizationId === null) return templates;

  const templatesByKey = new Map<string, EmailTemplate>();
  for (const template of templates) {
    const key = `${template.name}:${template.languageCode}`;
    const existing = templatesByKey.get(key);
    if (!existing || (!existing.organizationId && template.organizationId)) {
      templatesByKey.set(key, template);
    }
  }

  return [...templatesByKey.values()].sort(
    (left, right) =>
      left.name.localeCompare(right.name, "zh-Hans") ||
      left.languageCode.localeCompare(right.languageCode, "zh-Hans"),
  );
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

const DEFAULT_EMAIL_TEMPLATES = [
  {
    description: "发送给被邀请加入组织的用户。",
    hbs: [
      "<p>{{organizationName}} 邀请你加入组织。</p>",
      "<p><a href=\"{{inviteLink}}\">打开邀请链接</a></p>",
      "<p>有效期：{{expiresAt}}</p>",
    ].join("\n"),
    languageCode: "zh-CN",
    mjml: null,
    name: "organization-invite",
    subject: "邀请加入 {{organizationName}}",
  },
  {
    description: "发送给请求重置密码的用户。",
    hbs: [
      "<p>你正在重置 Hermes Swarm 账号密码。</p>",
      "<p><a href=\"{{resetLink}}\">打开重置密码链接</a></p>",
      "<p>该链接将在 {{expiresIn}} 后失效。</p>",
    ].join("\n"),
    languageCode: "zh-CN",
    mjml: null,
    name: "password-reset",
    subject: "重置密码",
  },
] satisfies EmailTemplatePayload[];
