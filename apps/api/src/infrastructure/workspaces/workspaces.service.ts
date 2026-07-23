import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Workspace } from "@hermes-swarm/core";
import { Repository } from "typeorm";
import { WorkspaceContextService } from "../../common/database/workspace-context.service.js";
import { toWorkspaceDto } from "../users/user-dto.js";
import type { UpdateWorkspacePayload } from "./workspace.types.js";

export {
  buildWorkspaceApplicationLinks,
  buildWorkspaceOwnerActivationLink,
} from "./workspace-applications.service.js";

@Injectable()
export class WorkspacesService {
  constructor(
    @InjectRepository(Workspace)
    private readonly workspaceRepository: Repository<Workspace>,
    private readonly workspaceContext: WorkspaceContextService,
  ) {}

  async listWorkspaces() {
    const workspaces = await this.workspaceRepository.find({
      order: { createdAt: "DESC" },
    });
    return workspaces.map(toWorkspaceDto);
  }

  async updateWorkspaceStatus(workspaceId: string, status: unknown) {
    if (status !== "active" && status !== "suspended" && status !== "archived") {
      throw new BadRequestException("工作空间状态无效");
    }
    const id = requireText(workspaceId, "工作空间");
    return this.workspaceRepository.manager.transaction(async (manager) => {
      const workspace = await manager.findOne(Workspace, {
        lock: { mode: "pessimistic_write" },
        where: { id },
      });
      if (!workspace) throw new NotFoundException("工作空间不存在");
      if (workspace.status === status) return toWorkspaceDto(workspace);
      if (!isAllowedWorkspaceStatusTransition(workspace.status, status)) {
        throw new BadRequestException(
          workspace.status === "provisioning"
            ? "工作空间必须由 Owner 完成激活后才能启用或挂起"
            : "工作空间状态转换无效",
        );
      }
      workspace.status = status;
      return toWorkspaceDto(await manager.save(Workspace, workspace));
    });
  }

  async get(workspaceId: string) {
    const id = this.requireWorkspaceExecution(workspaceId);
    const workspace = await this.workspaceRepository.findOne({
      where: { id },
    });
    if (!workspace) throw new NotFoundException("工作空间不存在");
    return toWorkspaceDto(workspace);
  }

  async update(workspaceId: string, payload: UpdateWorkspacePayload) {
    const id = this.requireWorkspaceExecution(workspaceId);
    const workspace = await this.workspaceRepository.findOne({
      where: { id },
    });
    if (!workspace) throw new NotFoundException("工作空间不存在");
    if (payload?.name !== undefined) {
      workspace.name = requireText(payload.name, "工作空间名称");
    }
    return toWorkspaceDto(await this.workspaceRepository.save(workspace));
  }

  private requireWorkspaceExecution(workspaceId: string) {
    const id = requireText(workspaceId, "工作空间");
    if (this.workspaceContext.current()!.workspaceId !== id) {
      throw new NotFoundException("工作空间不存在");
    }
    return id;
  }
}

function requireText(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new BadRequestException(`${label}不能为空`);
  }
  return value.trim();
}

function isAllowedWorkspaceStatusTransition(
  current: Workspace["status"],
  next: "active" | "archived" | "suspended",
) {
  if (current === "provisioning") return next === "archived";
  if (current === "active") return next === "suspended" || next === "archived";
  if (current === "suspended") return next === "active" || next === "archived";
  return false;
}
