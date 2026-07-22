import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Workspace } from "@hermes-swarm/core";
import { IsNull, Repository } from "typeorm";
import type { WorkspaceJobEnvelope } from "./workspace-job.types.js";

@Injectable()
export class WorkspaceJobFanoutService {
  constructor(
    @InjectRepository(Workspace)
    private readonly platformWorkspaceRepository: Repository<Workspace>,
  ) {}

  /**
   * Platform orchestration stops at workspace discovery. Every dispatched unit is
   * an ordinary workspace job with its own workspace context and idempotency key.
   */
  async fanOut<Payload, Result>(input: {
    dispatch: (job: WorkspaceJobEnvelope<Payload>) => Promise<Result>;
    name: string;
    payload: (workspaceId: string) => Payload;
    runId: string;
  }) {
    const workspaces = await this.platformWorkspaceRepository.find({
      order: { id: "ASC" },
      select: { id: true },
      where: { deletedAt: IsNull(), status: "active" },
    });
    return Promise.all(
      workspaces.map((workspace) =>
        input.dispatch({
          idempotencyKey: input.runId,
          name: input.name,
          payload: input.payload(workspace.id),
          workspaceId: workspace.id,
        }),
      ),
    );
  }
}
