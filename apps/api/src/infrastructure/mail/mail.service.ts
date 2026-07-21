import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import {
  CustomSmtp,
  EmailLog,
  EmailTemplate,
  PlatformEmailTemplate,
  PlatformSmtp,
} from "@hermes-swarm/core";
import { WorkspaceContextService } from "../../common/database/workspace-context.service.js";
import { PLATFORM_DATA_SOURCE } from "../../common/database/database.constants.js";
import Handlebars from "handlebars";
import { QueryFailedError, Repository, type EntityManager } from "typeorm";

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

type EmailTemplatePreviewPayload = {
  hbs?: string;
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
    private readonly smtpBaseRepository: Repository<CustomSmtp>,
    @InjectRepository(EmailTemplate)
    private readonly emailTemplateBaseRepository: Repository<EmailTemplate>,
    @InjectRepository(EmailLog)
    private readonly emailLogBaseRepository: Repository<EmailLog>,
    @InjectRepository(PlatformEmailTemplate, PLATFORM_DATA_SOURCE)
    private readonly platformTemplateRepository: Repository<PlatformEmailTemplate>,
    @InjectRepository(PlatformSmtp, PLATFORM_DATA_SOURCE)
    private readonly platformSmtpRepository: Repository<PlatformSmtp>,
    private readonly workspaceContext: WorkspaceContextService,
  ) {}

  async onModuleInit() {
    await this.ensureDefaultPlatformTemplates().catch((error) => {
      this.logger.warn(`Failed to seed platform email templates: ${error}`);
    });
  }

  async getPlatformSmtp() {
    const record = await this.platformSmtpRepository.findOne({
      order: { createdAt: "DESC" },
    });
    return record ? toSmtpDto(record) : null;
  }

  async getWorkspaceSmtp() {
    const record = await this.findGlobalSmtpRecord();
    return record ? toSmtpDto(record) : null;
  }

  async saveWorkspaceSmtp(payload: SmtpPayload) {
    const parsedPayload = parseSmtpPayload(payload);
    const entity = await this.findOrCreateSmtpRecord();
    applySmtpPayload(entity, parsedPayload);
    entity.isValidated = normalizeBoolean(parsedPayload.isValidated, "验证状态");
    normalizeSmtpRecordForSave(entity);
    return toSmtpDto(await this.smtpRepository.save(entity));
  }

  async savePlatformSmtp(payload: SmtpPayload) {
    const parsedPayload = parseSmtpPayload(payload);
    const entity =
      (await this.platformSmtpRepository.findOne({
        order: { createdAt: "DESC" },
      })) ??
      this.platformSmtpRepository.create({
        fromAddress: null,
        host: "",
        isValidated: false,
        password: null,
        port: 587,
        secure: false,
        username: null,
      });
    applySmtpPayload(entity, parsedPayload);
    entity.isValidated = normalizeBoolean(parsedPayload.isValidated, "验证状态");
    normalizeSmtpRecordForSave(entity);
    return toSmtpDto(await this.platformSmtpRepository.save(entity));
  }

  validateSmtp(payload: SmtpPayload) {
    return validateSmtpPayload(parseSmtpPayload(payload));
  }

  async listPlatformTemplates() {
    await this.ensureDefaultPlatformTemplates();
    return (
      await this.platformTemplateRepository.find({
        order: { name: "ASC", languageCode: "ASC" },
      })
    ).map((template) => toTemplateDto(template));
  }

  async listWorkspaceTemplates() {
    await Promise.all([
      this.ensureDefaultPlatformTemplates(),
      this.ensureDefaultWorkspaceTemplates(this.requireWorkspaceId()),
    ]);
    const [platformTemplates, workspaceTemplates] = await Promise.all([
      this.platformTemplateRepository.find({
        order: { name: "ASC", languageCode: "ASC" },
      }).then((templates) =>
        templates.filter((template) => isWorkspaceMailTemplate(template.name)),
      ),
      this.emailTemplateRepository.find({
        order: { name: "ASC", languageCode: "ASC" },
        where: { workspaceId: this.requireWorkspaceId() },
      }),
    ]);
    const byKey = new Map(
      platformTemplates.map((item) => [
        templateKey(item),
        toTemplateDto(item, { hasPlatformDefault: true, inherited: true }),
      ]),
    );
    for (const template of workspaceTemplates) {
      byKey.set(
        templateKey(template),
        toTemplateDto(template, { hasPlatformDefault: true, inherited: false }),
      );
    }
    return [...byKey.values()];
  }

  async createWorkspaceTemplate(payload: EmailTemplatePayload) {
    const parsed = parseTemplatePayload(payload);
    const template = this.emailTemplateRepository.create({
      description: normalizeOptionalText(parsed.description, 240),
      hbs: requireText(parsed.hbs, "模板内容"),
      isSystem: false,
      languageCode: requireText(parsed.languageCode, "语言编码", 16),
      mjml: normalizeOptionalText(parsed.mjml),
      name: requireText(parsed.name, "模板名称", 120),
      subject: normalizeOptionalText(parsed.subject, 240),
      workspaceId: this.requireWorkspaceId(),
    });
    return toTemplateDto(await saveTemplateOrThrow(this.emailTemplateRepository, template));
  }

  async updateWorkspaceTemplate(templateId: string, payload: EmailTemplatePayload) {
    const template = await this.getTemplateOrThrow(templateId);
    applyTemplatePatch(template, parseTemplatePayload(payload));
    return toTemplateDto(await saveTemplateOrThrow(this.emailTemplateRepository, template));
  }

  async deleteWorkspaceTemplate(templateId: string) {
    const template = await this.getTemplateOrThrow(templateId);
    if (template.isSystem) throw new BadRequestException("系统模板不能删除");
    await this.emailTemplateRepository.remove(template);
    return { id: templateId };
  }

  async createPlatformTemplate(payload: EmailTemplatePayload) {
    const parsedPayload = parseTemplatePayload(payload);
    const template = this.platformTemplateRepository.create({
      description: normalizeOptionalText(parsedPayload.description, 240),
      hbs: requireText(parsedPayload.hbs, "模板内容"),
      isSystem: normalizeBoolean(parsedPayload.isSystem, "系统模板"),
      languageCode: requireText(parsedPayload.languageCode, "语言编码", 16),
      mjml: normalizeOptionalText(parsedPayload.mjml),
      name: requireText(parsedPayload.name, "模板名称", 120),
      subject: normalizeOptionalText(parsedPayload.subject, 240),
    });
    return toTemplateDto(
      await saveTemplateOrThrow(this.platformTemplateRepository, template),
    );
  }

  async updatePlatformTemplate(
    templateId: string,
    payload: EmailTemplatePayload,
  ) {
    const parsedPayload = parseTemplatePayload(payload);
    const template = await this.getPlatformTemplateOrThrow(templateId);
    applyTemplatePatch(template, parsedPayload);
    return toTemplateDto(
      await saveTemplateOrThrow(this.platformTemplateRepository, template),
    );
  }

  async deletePlatformTemplate(templateId: string) {
    const template = await this.getPlatformTemplateOrThrow(templateId);
    if (template.isSystem) throw new BadRequestException("系统模板不能删除");
    await this.platformTemplateRepository.remove(template);
    return { id: templateId };
  }

  async ensureDefaultPlatformTemplates(manager?: EntityManager) {
    const repository = manager
      ? manager.getRepository(PlatformEmailTemplate)
      : this.platformTemplateRepository;
    for (const definition of DEFAULT_PLATFORM_EMAIL_TEMPLATES) {
      const existing = await repository.findOne({
        where: { languageCode: definition.languageCode, name: definition.name },
      });
      if (existing) continue;
      try {
        await repository.save(
          repository.create({ ...definition, isSystem: true }),
        );
      } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;
      }
    }
  }

  previewTemplate(payload: EmailTemplatePreviewPayload) {
    const parsedPayload = parseTemplatePreviewPayload(payload);
    const hbs = requireText(parsedPayload.hbs, "模板内容");
    const subject = normalizeOptionalText(parsedPayload.subject, 240) ?? "";
    try {
      return {
        html: Handlebars.compile(hbs)(EMAIL_TEMPLATE_PREVIEW_LOCALS),
        subject: Handlebars.compile(subject)(EMAIL_TEMPLATE_PREVIEW_LOCALS),
      };
    } catch {
      throw new BadRequestException("邮件模板语法无效");
    }
  }

  async listLogs() {
    const logs = await this.emailLogRepository.find({
      where: {
        isArchived: false,
        workspaceId: this.requireWorkspaceId(),
      },
      order: { createdAt: "DESC" },
    });
    return logs.map(toLogDto);
  }

  async createLog(payload: EmailLogPayload) {
    const parsedPayload = parseEmailLogPayload(payload);
    const log = this.emailLogRepository.create({
      content: normalizeOptionalText(parsedPayload.content),
      email: requireText(parsedPayload.email, "收件邮箱", 240),
      isArchived: normalizeBoolean(parsedPayload.isArchived, "归档状态"),
      workspaceId: this.requireWorkspaceId(),
      status: normalizeEmailLogStatus(parsedPayload.status),
      subject: normalizeOptionalText(parsedPayload.subject, 240),
      templateName: normalizeOptionalText(parsedPayload.templateName, 120),
    });
    return toLogDto(await this.emailLogRepository.save(log));
  }

  private async getTemplateOrThrow(templateId: string) {
    const template = await this.emailTemplateRepository.findOne({
      where: {
        id: templateId,
        workspaceId: this.requireWorkspaceId(),
      },
    });
    if (!template) throw new NotFoundException("邮件模板不存在");
    return template;
  }

  private async getPlatformTemplateOrThrow(templateId: string) {
    const template = await this.platformTemplateRepository.findOne({
      where: { id: templateId },
    });
    if (!template) throw new NotFoundException("邮件模板不存在");
    return template;
  }

  private async findGlobalSmtpRecord() {
    return this.smtpRepository.findOne({
      where: { workspaceId: this.requireWorkspaceId() },
      order: { createdAt: "DESC" },
    });
  }

  private async findOrCreateSmtpRecord() {
    const existing = await this.smtpRepository.findOne({
      where: { workspaceId: this.requireWorkspaceId() },
      order: { createdAt: "DESC" },
    });
    return (
      existing ??
      this.smtpRepository.create({
        fromAddress: null,
        host: "",
        workspaceId: this.requireWorkspaceId(),
        password: null,
        port: 587,
        secure: false,
        username: null,
      })
    );
  }

  private async ensureDefaultWorkspaceTemplates(
    workspaceId: string,
    manager: EntityManager = this.emailTemplateRepository.manager,
  ) {
    for (const definition of DEFAULT_WORKSPACE_EMAIL_TEMPLATES) {
      const existing = await manager.findOne(EmailTemplate, {
        where: {
          languageCode: definition.languageCode,
          name: definition.name,
          workspaceId,
        },
      });
      if (existing) continue;
      try {
        await manager.save(
          EmailTemplate,
          this.emailTemplateRepository.create({
            ...definition,
            isSystem: true,
            workspaceId,
          }),
        );
      } catch (error) {
        if (isUniqueConstraintError(error)) continue;
        throw error;
      }
    }
  }

  private requireWorkspaceId() {
    const workspaceId = this.workspaceContext.current(false)?.workspaceId;
    if (!workspaceId) throw new BadRequestException("请求缺少工作空间上下文");
    return workspaceId;
  }

  private get smtpRepository() {
    return this.workspaceContext.current(false)?.manager?.getRepository(CustomSmtp) ??
      this.smtpBaseRepository;
  }

  private get emailTemplateRepository() {
    return this.workspaceContext.current(false)?.manager?.getRepository(EmailTemplate) ??
      this.emailTemplateBaseRepository;
  }

  private get emailLogRepository() {
    return this.workspaceContext.current(false)?.manager?.getRepository(EmailLog) ??
      this.emailLogBaseRepository;
  }
}

async function saveTemplateOrThrow<T extends EmailTemplate | PlatformEmailTemplate>(
  repository: Repository<T>,
  template: T,
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

function parseTemplatePreviewPayload(payload: unknown): EmailTemplatePreviewPayload {
  return assertPayloadObject(payload, "邮件模板预览");
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

function applySmtpPayload(entity: CustomSmtp | PlatformSmtp, payload: SmtpPayload) {
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

function normalizeSmtpRecordForSave(entity: CustomSmtp | PlatformSmtp) {
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

function toSmtpDto(entity: CustomSmtp | PlatformSmtp) {
  return {
    fromAddress: entity.fromAddress,
    host: entity.host,
    id: entity.id,
    isValidated: entity.isValidated,
    port: entity.port,
    secure: entity.secure,
    username: entity.username,
  };
}

function toTemplateDto(
  entity: EmailTemplate | PlatformEmailTemplate,
  metadata: { hasPlatformDefault?: boolean; inherited?: boolean } = {},
) {
  return {
    description: entity.description,
    hbs: entity.hbs,
    hasPlatformDefault: Boolean(metadata.hasPlatformDefault),
    id: entity.id,
    inherited: Boolean(metadata.inherited),
    isSystem: entity.isSystem,
    languageCode: entity.languageCode,
    mjml: entity.mjml,
    name: entity.name,
    subject: entity.subject,
  };
}

function applyTemplatePatch(
  template: EmailTemplate | PlatformEmailTemplate,
  payload: EmailTemplatePayload,
) {
  if (payload.name !== undefined) {
    const name = requireText(payload.name, "模板名称", 120);
    if (template.isSystem && name !== template.name) {
      throw new BadRequestException("系统模板名称不能修改");
    }
    template.name = name;
  }
  if (payload.languageCode !== undefined) {
    const languageCode = requireText(payload.languageCode, "语言编码", 16);
    if (template.isSystem && languageCode !== template.languageCode) {
      throw new BadRequestException("系统模板语言不能修改");
    }
    template.languageCode = languageCode;
  }
  if (payload.description !== undefined) {
    template.description = normalizeOptionalText(payload.description, 240);
  }
  if (payload.hbs !== undefined) template.hbs = requireText(payload.hbs, "模板内容");
  if (payload.mjml !== undefined) template.mjml = normalizeOptionalText(payload.mjml);
  if (payload.subject !== undefined) {
    template.subject = normalizeOptionalText(payload.subject, 240);
  }
}

function templateKey(template: Pick<EmailTemplate, "languageCode" | "name">) {
  return `${template.name}:${template.languageCode}`;
}

function toLogDto(entity: EmailLog) {
  return {
    content: entity.content,
    email: entity.email,
    id: entity.id,
    isArchived: entity.isArchived,
    status: entity.status,
    subject: entity.subject,
    templateName: entity.templateName,
  };
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

const DEFAULT_WORKSPACE_EMAIL_TEMPLATES = [
  {
    description: "发送给被邀请加入工作空间的用户。",
    hbs: [
      "<p>{{workspaceName}} 邀请你加入工作空间。</p>",
      "<p><a href=\"{{inviteLink}}\">打开邀请链接</a></p>",
      "<p>有效期：{{expiresAt}}</p>",
    ].join("\n"),
    languageCode: "zh-CN",
    mjml: null,
    name: "workspace-invite",
    subject: "邀请加入 {{workspaceName}}",
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
  {
    description: "Sent to users invited to join a workspace.",
    hbs: [
      "<p>{{workspaceName}} invited you to join the workspace.</p>",
      "<p><a href=\"{{inviteLink}}\">Open invitation</a></p>",
      "<p>Expires at: {{expiresAt}}</p>",
    ].join("\n"),
    languageCode: "en",
    mjml: null,
    name: "workspace-invite",
    subject: "Invitation to join {{workspaceName}}",
  },
  {
    description: "Sent to users who request a password reset.",
    hbs: [
      "<p>You requested a password reset for your Hermes Swarm account.</p>",
      "<p><a href=\"{{resetLink}}\">Reset password</a></p>",
      "<p>This link expires in {{expiresIn}}.</p>",
    ].join("\n"),
    languageCode: "en",
    mjml: null,
    name: "password-reset",
    subject: "Reset your password",
  },
] satisfies EmailTemplatePayload[];

const DEFAULT_CONTROL_PLANE_EMAIL_TEMPLATES = [
  {
    description: "发送给新平台成员的账号邀请邮件。",
    hbs: [
      "<p>你好：</p>",
      "<p>你已受邀加入 Hermes Swarm 平台控制台。</p>",
      "<p><a href=\"{{inviteLink}}\">接受邀请并创建账号</a></p>",
      "<p>邀请有效期至 {{expiresAt}}。</p>",
    ].join("\n"),
    languageCode: "zh-CN",
    mjml: null,
    name: "platform-invite",
    subject: "加入 Hermes Swarm 平台控制台",
  },
  {
    description: "Sent to new platform members to create their account.",
    hbs: [
      "<p>Hello,</p>",
      "<p>You have been invited to the Hermes Swarm platform console.</p>",
      "<p><a href=\"{{inviteLink}}\">Accept the invitation and create your account</a></p>",
      "<p>This invitation is valid until {{expiresAt}}.</p>",
    ].join("\n"),
    languageCode: "en",
    mjml: null,
    name: "platform-invite",
    subject: "Join the Hermes Swarm platform console",
  },
  {
    description: "发送给工作空间申请人的邮箱验证邮件。",
    hbs: [
      "<p>{{ownerDisplayName}}，你好：</p>",
      "<p>请验证邮箱，以继续申请工作空间 {{requestedName}}。</p>",
      "<p><a href=\"{{verificationLink}}\">验证邮箱</a></p>",
      "<p>如果不再申请，可<a href=\"{{cancellationLink}}\">取消申请</a>。</p>",
    ].join("\n"),
    languageCode: "zh-CN",
    mjml: null,
    name: "workspace-application-verification",
    subject: "验证邮箱以继续申请 {{requestedName}}",
  },
  {
    description: "Sent to workspace applicants to verify their email address.",
    hbs: [
      "<p>Hello {{ownerDisplayName}},</p>",
      "<p>Verify your email to continue the application for {{requestedName}}.</p>",
      "<p><a href=\"{{verificationLink}}\">Verify email</a></p>",
      "<p>If you no longer wish to apply, <a href=\"{{cancellationLink}}\">cancel the application</a>.</p>",
    ].join("\n"),
    languageCode: "en",
    mjml: null,
    name: "workspace-application-verification",
    subject: "Verify your email for {{requestedName}}",
  },
  {
    description: "工作空间获批后发送给 Owner 的账号激活邮件。",
    hbs: [
      "<p>{{ownerDisplayName}}，你好：</p>",
      "<p>工作空间 {{workspaceName}} 已获批准。</p>",
      "<p><a href=\"{{activationLink}}\">设置密码并激活工作空间</a></p>",
      "<p>激活链接将在 {{expiresIn}} 后失效。</p>",
    ].join("\n"),
    languageCode: "zh-CN",
    mjml: null,
    name: "workspace-owner-activation",
    subject: "激活工作空间 {{workspaceName}}",
  },
  {
    description: "Sent to the owner after a workspace application is approved.",
    hbs: [
      "<p>Hello {{ownerDisplayName}},</p>",
      "<p>Your workspace {{workspaceName}} has been approved.</p>",
      "<p><a href=\"{{activationLink}}\">Set a password and activate the workspace</a></p>",
      "<p>This activation link expires in {{expiresIn}}.</p>",
    ].join("\n"),
    languageCode: "en",
    mjml: null,
    name: "workspace-owner-activation",
    subject: "Activate {{workspaceName}}",
  },
] satisfies EmailTemplatePayload[];

const DEFAULT_PLATFORM_EMAIL_TEMPLATES = [
  ...DEFAULT_WORKSPACE_EMAIL_TEMPLATES,
  ...DEFAULT_CONTROL_PLANE_EMAIL_TEMPLATES,
];

function isWorkspaceMailTemplate(name: string) {
  return DEFAULT_WORKSPACE_EMAIL_TEMPLATES.some(
    (definition) => definition.name === name,
  );
}

const EMAIL_TEMPLATE_PREVIEW_LOCALS = {
  email: "alex@example.com",
  expiresAt: "2026-07-18 18:00",
  expiresIn: "30 minutes",
  inviteLink: "https://app.hermes.local/invitations/example",
  name: "Alex Chen",
  ownerDisplayName: "Alex Chen",
  requestedName: "Hermes Development",
  resetLink: "https://app.hermes.local/reset-password/example",
  verificationLink: "https://app.hermes.local/apply?applicationId=example&token=example",
  cancellationLink: "https://app.hermes.local/apply?applicationId=example&cancelToken=example",
  activationLink: "https://app.hermes.local/reset-password?email=alex%40example.com&token=example",
  workspaceName: "Hermes Development",
};
