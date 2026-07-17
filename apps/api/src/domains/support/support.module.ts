import { Module } from "@nestjs/common";
import { JobsModule } from "../../common/jobs/jobs.module.js";
import { TicketArchiveJobService } from "./jobs/ticket-archive-job.service.js";
import { TicketsModule } from "./tickets/tickets.module.js";

@Module({
  imports: [JobsModule, TicketsModule],
  providers: [TicketArchiveJobService],
  exports: [TicketArchiveJobService],
})
export class SupportModule {}
