import { BadRequestException } from "@nestjs/common";
import {
  CustomSmtp,
  EmailTemplate,
  PlatformEmailTemplate,
  PlatformSmtp,
} from "@hermes-swarm/core";
import { QueryFailedError, Repository } from "typeorm";
import type {
  EmailLogPayload,
  EmailTemplatePayload,
  EmailTemplatePreviewPayload,
  SmtpPayload,
} from "./mail.types.js";

export function parseSmtpPayload(payload: unknown): SmtpPayload {
  return assertPayloadObject(payload, "SMTP 配置");
}

export function parseTemplatePayload(payload: unknown): EmailTemplatePayload {
  return assertPayloadObject(payload, "邮件模板");
}

export function parseTemplatePreviewPayload(
  payload: unknown,
): EmailTemplatePreviewPayload {
  return assertPayloadObject(payload, "邮件模板预览");
}

export function parseEmailLogPayload(payload: unknown): EmailLogPayload {
  return assertPayloadObject(payload, "邮件日志");
}

export function applySmtpPayload(
  entity: CustomSmtp | PlatformSmtp,
  payload: SmtpPayload,
) {
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

export function normalizeSmtpRecordForSave(entity: CustomSmtp | PlatformSmtp) {
  entity.host = requireText(entity.host, "SMTP Host", 240);
  entity.port = normalizePort(entity.port ?? 587);
  entity.secure = normalizeBoolean(entity.secure, "安全连接");
}

export function validateSmtpPayload(payload: SmtpPayload) {
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

export function toSmtpDto(entity: CustomSmtp | PlatformSmtp) {
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

export function applyTemplatePatch(
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

export function toTemplateDto(
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

export async function saveTemplateOrThrow<
  T extends EmailTemplate | PlatformEmailTemplate,
>(
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

export function requireText(value: unknown, label: string, maxLength?: number) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new BadRequestException(`${label}不能为空`);
  if (maxLength !== undefined && text.length > maxLength) {
    throw new BadRequestException(`${label}过长`);
  }
  return text;
}

export function normalizeOptionalText(value: unknown, maxLength?: number) {
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

export function normalizeBoolean(
  value: unknown,
  label: string,
  defaultValue = false,
) {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value !== "boolean") {
    throw new BadRequestException(`${label}格式不正确`);
  }
  return value;
}

export function normalizeEmailLogStatus(value: unknown) {
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

export function normalizePort(value: number | string | undefined) {
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new BadRequestException("端口格式不正确");
  }
  return port;
}

export function isUniqueConstraintError(error: unknown) {
  if (!(error instanceof QueryFailedError)) return false;
  const driverError = error.driverError as { code?: string } | undefined;
  return driverError?.code === "23505";
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
