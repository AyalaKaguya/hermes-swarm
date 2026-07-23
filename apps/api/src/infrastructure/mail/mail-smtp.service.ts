import { BadRequestException, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { CustomSmtp, PlatformSmtp } from "@hermes-swarm/core";
import { Repository } from "typeorm";
import { WorkspaceContextService } from "../../common/database/workspace-context.service.js";
import type { SmtpPayload } from "./mail.types.js";
import {
  applySmtpPayload,
  normalizeBoolean,
  normalizeSmtpRecordForSave,
  parseSmtpPayload,
  toSmtpDto,
  validateSmtpPayload,
} from "./mail-validation.js";

@Injectable()
export class MailSmtpService {
  constructor(
    @InjectRepository(CustomSmtp)
    private readonly smtpRepository: Repository<CustomSmtp>,
    @InjectRepository(PlatformSmtp)
    private readonly platformSmtpRepository: Repository<PlatformSmtp>,
    private readonly workspaceContext: WorkspaceContextService,
  ) {}

  async getPlatformSmtp() {
    const record = await this.platformSmtpRepository.findOne({
      order: { createdAt: "DESC" },
    });
    return record ? toSmtpDto(record) : null;
  }

  async getWorkspaceSmtp() {
    const record = await this.findWorkspaceSmtpRecord();
    return record ? toSmtpDto(record) : null;
  }

  async saveWorkspaceSmtp(payload: SmtpPayload) {
    const parsedPayload = parseSmtpPayload(payload);
    const entity = await this.findOrCreateWorkspaceSmtpRecord();
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

  private async findWorkspaceSmtpRecord() {
    return this.smtpRepository.findOne({
      where: { workspaceId: this.requireWorkspaceId() },
      order: { createdAt: "DESC" },
    });
  }

  private async findOrCreateWorkspaceSmtpRecord() {
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

  private requireWorkspaceId() {
    const workspaceId = this.workspaceContext.current(false)?.workspaceId;
    if (!workspaceId) throw new BadRequestException("请求缺少工作空间上下文");
    return workspaceId;
  }
}
