import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { CustomSmtp, EmailLog, EmailTemplate } from "@hermes-swarm/core";
import { IsNull, QueryFailedError, Repository, type EntityManager } from "typeorm";

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
    const parsedPayload = parseSmtpPayload(payload);
    const entity = await this.findOrCreateSmtpRecord(organizationId);
    applySmtpPayload(entity, parsedPayload);
    entity.organizationId = organizationId;
    entity.isValidated = normalizeBoolean(parsedPayload.isValidated, "验证状态");
    normalizeSmtpRecordForSave(entity);
    return toSmtpDto(await this.smtpRepository.save(entity));
  }

  async savePlatformSmtp(payload: SmtpPayload) {
    const parsedPayload = parseSmtpPayload(payload);
    const entity = await this.findOrCreateSmtpRecord(null);
    applySmtpPayload(entity, parsedPayload);
    entity.organizationId = null;
    entity.isValidated = normalizeBoolean(parsedPayload.isValidated, "验证状态");
    normalizeSmtpRecordForSave(entity);
    return toSmtpDto(await this.smtpRepository.save(entity));
  }

  validateSmtp(payload: SmtpPayload) {
    return validateSmtpPayload(parseSmtpPayload(payload));
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
    const parsedPayload = parseTemplatePayload(payload);
    const template = this.emailTemplateRepository.create({
      description: normalizeOptionalText(parsedPayload.description, 240),
      hbs: requireText(parsedPayload.hbs, "模板内容"),
      isSystem: normalizeBoolean(parsedPayload.isSystem, "系统模板"),
      languageCode: requireText(parsedPayload.languageCode, "语言编码", 16),
      mjml: normalizeOptionalText(parsedPayload.mjml),
      name: requireText(parsedPayload.name, "模板名称", 120),
      organizationId,
      subject: normalizeOptionalText(parsedPayload.subject, 240),
    });
    return toTemplateDto(await saveTemplateOrThrow(this.emailTemplateRepository, template));
  }

  async updateTemplate(
    organizationId: string | null,
    templateId: string,
    payload: EmailTemplatePayload,
  ) {
    const parsedPayload = parseTemplatePayload(payload);
    const template = await this.getTemplateOrThrow(organizationId, templateId);
    if (parsedPayload.name !== undefined) {
      const nextName = requireText(parsedPayload.name, "模板名称", 120);
      if (template.isSystem && nextName !== template.name) {
        throw new BadRequestException("系统模板名称不能修改");
      }
      template.name = nextName;
    }
    if (parsedPayload.description !== undefined) {
      template.description = normalizeOptionalText(parsedPayload.description, 240);
    }
    if (parsedPayload.languageCode !== undefined) {
      const nextLanguageCode = requireText(parsedPayload.languageCode, "语言编码", 16);
      if (template.isSystem && nextLanguageCode !== template.languageCode) {
        throw new BadRequestException("系统模板语言不能修改");
      }
      template.languageCode = nextLanguageCode;
    }
    if (parsedPayload.hbs !== undefined) {
      template.hbs = requireText(parsedPayload.hbs, "模板内容");
    }
    if (parsedPayload.mjml !== undefined) {
      template.mjml = normalizeOptionalText(parsedPayload.mjml);
    }
    if (parsedPayload.subject !== undefined) {
      template.subject = normalizeOptionalText(parsedPayload.subject, 240);
    }
    return toTemplateDto(await saveTemplateOrThrow(this.emailTemplateRepository, template));
  }

  async deleteTemplate(organizationId: string | null, templateId: string) {
    const template = await this.getTemplateOrThrow(organizationId, templateId);
    if (template.isSystem) throw new BadRequestException("系统模板不能删除");
    await this.emailTemplateRepository.remove(template);
    return { id: templateId };
  }

  async ensureDefaultTemplatesForOrganization(
    organizationId: string,
    manager?: EntityManager,
  ) {
    await this.ensureDefaultTemplates(organizationId, manager);
  }

  async ensureDefaultPlatformTemplates(manager?: EntityManager) {
    await this.ensureDefaultTemplates(null, manager);
  }

  async listLogs(organizationId: string) {
    const logs = await this.emailLogRepository.find({
      where: { isArchived: false, organizationId },
      order: { createdAt: "DESC" },
    });
    return logs.map(toLogDto);
  }

  async createLog(organizationId: string, payload: EmailLogPayload) {
    const parsedPayload = parseEmailLogPayload(payload);
    const log = this.emailLogRepository.create({
      content: normalizeOptionalText(parsedPayload.content),
      email: requireText(parsedPayload.email, "收件邮箱", 240),
      isArchived: normalizeBoolean(parsedPayload.isArchived, "归档状态"),
      organizationId,
      status: normalizeEmailLogStatus(parsedPayload.status),
      subject: normalizeOptionalText(parsedPayload.subject, 240),
      templateName: normalizeOptionalText(parsedPayload.templateName, 120),
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

  private async ensureDefaultTemplates(
    organizationId: string | null,
    manager: EntityManager = this.emailTemplateRepository.manager,
  ) {
    for (const definition of DEFAULT_EMAIL_TEMPLATES) {
      const existing = await manager.findOne(EmailTemplate, {
        where: {
          languageCode: definition.languageCode,
          name: definition.name,
          organizationId: organizationId ?? IsNull(),
        },
      });
      if (existing) continue;
      try {
        await manager.save(
          EmailTemplate,
          this.emailTemplateRepository.create({
            ...definition,
            isSystem: true,
            organizationId: organizationId as string | null,
          }),
        );
      } catch (error) {
        if (isUniqueConstraintError(error)) continue;
        throw error;
      }
    }
  }
}

async function saveTemplateOrThrow(
  repository: Repository<EmailTemplate>,
  template: EmailTemplate,
) {
  try {
    return await repository.save(template);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new BadRequestException("邮件模板已存在");
    }
    throw error;
  }
}

function parseSmtpPayload(payload: unknown): SmtpPayload {
  return assertPayloadObject(payload, "SMTP 配置");
}

function parseTemplatePayload(payload: unknown): EmailTemplatePayload {
  return assertPayloadObject(payload, "邮件模板");
}

function parseEmailLogPayload(payload: unknown): EmailLogPayload {
  return assertPayloadObject(payload, "邮件日志");
}

function assertPayloadObject<T extends Record<string, unknown>>(
  payload: unknown,
  label: string,
): T {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new BadRequestException(`${label}请求体不能为空`);
  }
  return payload as T;
}

function applySmtpPayload(entity: CustomSmtp, payload: SmtpPayload) {
  if (payload.fromAddress !== undefined) {
    entity.fromAddress = normalizeOptionalText(payload.fromAddress, 240);
  }
  if (payload.host !== undefined) {
    entity.host = requireText(payload.host, "SMTP Host", 240);
  }
  if (payload.port !== undefined) entity.port = normalizePort(payload.port);
  if (payload.secure !== undefined) {
    entity.secure = normalizeBoolean(payload.secure, "安全连接");
  }
  if (payload.username !== undefined) {
    entity.username = normalizeOptionalText(payload.username, 240);
  }
  if (payload.password !== undefined) {
    entity.password = normalizeOptionalText(payload.password, 500);
  }
}

function normalizeSmtpRecordForSave(entity: CustomSmtp) {
  entity.host = requireText(entity.host, "SMTP Host", 240);
  entity.port = normalizePort(entity.port ?? 587);
  entity.secure = normalizeBoolean(entity.secure, "安全连接");
}

function validateSmtpPayload(payload: SmtpPayload) {
  const host = requireText(payload.host, "SMTP Host", 240);
  const port = normalizePort(payload.port ?? 587);
  return {
    fromAddress: normalizeOptionalText(payload.fromAddress, 240),
    host,
    isValid: true,
    port,
    secure: normalizeBoolean(payload.secure, "安全连接"),
    username: normalizeOptionalText(payload.username, 240),
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

function requireText(value: unknown, label: string, maxLength?: number) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new BadRequestException(`${label}不能为空`);
  if (maxLength !== undefined && text.length > maxLength) {
    throw new BadRequestException(`${label}过长`);
  }
  return text;
}

function normalizeOptionalText(value: unknown, maxLength?: number) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new BadRequestException("文本格式不正确");
  }
  const text = value.trim();
  if (maxLength !== undefined && text.length > maxLength) {
    throw new BadRequestException("文本过长");
  }
  return text || null;
}

function normalizeBoolean(value: unknown, label: string, defaultValue = false) {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value !== "boolean") {
    throw new BadRequestException(`${label}格式不正确`);
  }
  return value;
}

function normalizeEmailLogStatus(value: unknown) {
  if (value === undefined) return "queued";
  if (
    value === "failed" ||
    value === "queued" ||
    value === "sent" ||
    value === "skipped"
  ) {
    return value;
  }
  throw new BadRequestException("邮件状态无效");
}

function normalizePort(value: number | string | undefined) {
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new BadRequestException("端口格式不正确");
  }
  return port;
}

function isUniqueConstraintError(error: unknown) {
  if (!(error instanceof QueryFailedError)) return false;
  const driverError = error.driverError as { code?: string } | undefined;
  return driverError?.code === "23505";
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
