import { Injectable } from "@nestjs/common";
import { WorkspaceJobExecutor } from "../../../common/jobs/workspace-job-executor.service.js";
import { WorkspaceJobFanoutService } from "../../../common/jobs/workspace-job-fanout.service.js";
import type { WorkspaceJobEnvelope } from "../../../common/jobs/workspace-job.types.js";
import { TicketsService } from "../tickets/tickets.service.js";

export const TICKET_ARCHIVE_JOB = "tickets.archive-expired";

export type TicketArchiveJobPayload = { requestedAt: string };

@Injectable()
export class TicketArchiveJobService {
  constructor(
    private readonly executor: WorkspaceJobExecutor,
    private readonly fanout: WorkspaceJobFanoutService,
    private readonly ticketsService: TicketsService,
  ) {}

  execute(job: WorkspaceJobEnvelope<TicketArchiveJobPayload>) {
    if (job.name !== TICKET_ARCHIVE_JOB) {
      throw new Error(`Unsupported ticket job: ${job.name}`);
    }
    return this.executor.execute(job, () =>
      this.ticketsService.archiveExpiredTickets(job.workspaceId),
    );
  }

  /** Entry point for an external scheduler. This method does not install a timer. */
  runForAllActiveWorkspaces(runId: string, requestedAt = new Date().toISOString()) {
    return this.fanout.fanOut({
      dispatch: (job) => this.execute(job),
      name: TICKET_ARCHIVE_JOB,
      payload: () => ({ requestedAt }),
      runId,
    });
  }
}
