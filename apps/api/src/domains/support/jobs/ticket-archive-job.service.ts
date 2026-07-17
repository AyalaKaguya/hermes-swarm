import { Injectable } from "@nestjs/common";
import { TenantJobExecutor } from "../../../common/jobs/tenant-job-executor.service.js";
import { TenantJobFanoutService } from "../../../common/jobs/tenant-job-fanout.service.js";
import type { TenantJobEnvelope } from "../../../common/jobs/tenant-job.types.js";
import { TicketsService } from "../tickets/tickets.service.js";

export const TICKET_ARCHIVE_JOB = "tickets.archive-expired";

export type TicketArchiveJobPayload = { requestedAt: string };

@Injectable()
export class TicketArchiveJobService {
  constructor(
    private readonly executor: TenantJobExecutor,
    private readonly fanout: TenantJobFanoutService,
    private readonly ticketsService: TicketsService,
  ) {}

  execute(job: TenantJobEnvelope<TicketArchiveJobPayload>) {
    if (job.name !== TICKET_ARCHIVE_JOB) {
      throw new Error(`Unsupported ticket job: ${job.name}`);
    }
    return this.executor.execute(job, () =>
      this.ticketsService.archiveExpiredTickets(job.tenantId),
    );
  }

  /** Entry point for an external scheduler. This method does not install a timer. */
  runForAllActiveTenants(runId: string, requestedAt = new Date().toISOString()) {
    return this.fanout.fanOut({
      dispatch: (job) => this.execute(job),
      name: TICKET_ARCHIVE_JOB,
      payload: () => ({ requestedAt }),
      runId,
    });
  }
}
