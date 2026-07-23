import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { EmailTemplate, PlatformEmailTemplate } from "@hermes-swarm/core";
import Handlebars from "handlebars";
import { Repository, type EntityManager } from "typeorm";
import { WorkspaceContextService } from "../../common/database/workspace-context.service.js";
import {
  DEFAULT_PLATFORM_EMAIL_TEMPLATES,
  DEFAULT_WORKSPACE_EMAIL_TEMPLATES,
  EMAIL_TEMPLATE_PREVIEW_LOCALS,
  isWorkspaceMailTemplate,
} from "./mail-template-defaults.js";
import type {
  EmailTemplatePayload,
  EmailTemplatePreviewPayload,
} from "./mail.types.js";
import {
  applyTemplatePatch,
  isUniqueConstraintError,
  normalizeBoolean,
  normalizeOptionalText,
  parseTemplatePayload,
  parseTemplatePreviewPayload,
  requireText,
  saveTemplateOrThrow,
  toTemplateDto,
} from "./mail-validation.js";

@Injectable()
export class MailTemplatesService {
  constructor(
    @InjectRepository(EmailTemplate)
    private readonly emailTemplateRepository: Repository<EmailTemplate>,
    @InjectRepository(PlatformEmailTemplate)
    private readonly platformTemplateRepository: Repository<PlatformEmailTemplate>,
    private readonly workspaceContext: WorkspaceContextService,
  ) {}

  async listPlatformTemplates() {
    await this.ensureDefaultPlatformTemplates();
    return (
      await this.platformTemplateRepository.find({
        order: { name: "ASC", languageCode: "ASC" },
      })
    ).map((template) => toTemplateDto(template));
  }

  async listWorkspaceTemplates() {
    const workspaceId = this.requireWorkspaceId();
    await Promise.all([
      this.ensureDefaultPlatformTemplates(),
      this.ensureDefaultWorkspaceTemplates(workspaceId),
    ]);
    const [platformTemplates, workspaceTemplates] = await Promise.all([
      this.platformTemplateRepository.find({
        order: { name: "ASC", languageCode: "ASC" },
      }).then((templates) =>
        templates.filter((template) => isWorkspaceMailTemplate(template.name)),
      ),
      this.emailTemplateRepository.find({
        order: { name: "ASC", languageCode: "ASC" },
        where: { workspaceId },
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
    return toTemplateDto(
      await saveTemplateOrThrow(this.emailTemplateRepository, template),
    );
  }

  async updateWorkspaceTemplate(
    templateId: string,
    payload: EmailTemplatePayload,
  ) {
    const template = await this.getWorkspaceTemplateOrThrow(templateId);
    applyTemplatePatch(template, parseTemplatePayload(payload));
    return toTemplateDto(
      await saveTemplateOrThrow(this.emailTemplateRepository, template),
    );
  }

  async deleteWorkspaceTemplate(templateId: string) {
    const template = await this.getWorkspaceTemplateOrThrow(templateId);
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

  private async getWorkspaceTemplateOrThrow(templateId: string) {
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
}

function templateKey(template: Pick<EmailTemplate, "languageCode" | "name">) {
  return `${template.name}:${template.languageCode}`;
}
