import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  Account,
  AnalysisQueryRun,
  AnalysisView,
  DatasetArtifact,
  FileObject,
  RuntimeRun,
  Ticket,
} from "@hermes-swarm/core";
import { DatabaseModule } from "../../common/database/database.module.js";
import { JobsModule } from "../../common/jobs/jobs.module.js";
import { FilesModule } from "../../infrastructure/files/files.module.js";
import { AnalysisQueryArtifactGcService } from "./analysis-query-artifact-gc.service.js";
import { AnalysisQueryRunService } from "./analysis-query-run.service.js";
import { AnalysisViewController } from "./analysis-view.controller.js";
import { AnalysisViewService } from "./analysis-view.service.js";
import { AnalyticsAuthorizationContextFactory } from "./analytics-authorization-context.factory.js";
import { AnalyticsController } from "./analytics.controller.js";
import { AnalyticsQueryGateway } from "./analytics-query.gateway.js";
import { AnalyticsSourceRegistry } from "./analytics-source.registry.js";
import { SupportTicketsAnalyticsAdapter } from "./support-tickets-analytics.adapter.js";

@Module({
  imports: [
    DatabaseModule,
    FilesModule,
    JobsModule,
    TypeOrmModule.forFeature([
      Account,
      AnalysisQueryRun,
      AnalysisView,
      DatasetArtifact,
      FileObject,
      RuntimeRun,
      Ticket,
    ]),
  ],
  controllers: [AnalyticsController, AnalysisViewController],
  providers: [
    AnalyticsAuthorizationContextFactory,
    AnalysisQueryArtifactGcService,
    AnalyticsQueryGateway,
    AnalyticsSourceRegistry,
    AnalysisQueryRunService,
    AnalysisViewService,
    SupportTicketsAnalyticsAdapter,
  ],
  exports: [
    AnalysisQueryArtifactGcService,
    AnalyticsQueryGateway,
    AnalyticsSourceRegistry,
  ],
})
export class AnalyticsModule {}
