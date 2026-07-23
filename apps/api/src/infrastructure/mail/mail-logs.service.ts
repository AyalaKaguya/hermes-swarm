import { BadRequestException, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { EmailLog } from "@hermes-swarm/core";
import { Repository } from "typeorm";
import { WorkspaceContextService } from "../../common/database/workspace-context.service.js";
import type { EmailLogPayload } from "./mail.types.js";
import {
  normalizeBoolean,
  normalizeEmailLogStatus,
  normalizeOptionalText,
  parseEmailLogPayload,
  requireText,
} from "./mail-validation.js";

@Injectable()
export class MailLogsService {
  constructor(
    @InjectRepository(EmailLog)
    private readonly emailLogRepository: Repository<EmailLog>,
    private readonly workspaceContext: WorkspaceContextService,
  ) {}

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

  private requireWorkspaceId() {
    const workspaceId = this.workspaceContext.current(false)?.workspaceId;
    if (!workspaceId) throw new BadRequestException("请求缺少工作空间上下文");
    return workspaceId;
  }
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
