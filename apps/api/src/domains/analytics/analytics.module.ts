import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Account, AnalysisView, Ticket } from "@hermes-swarm/core";
import { DatabaseModule } from "../../common/database/database.module.js";
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
    TypeOrmModule.forFeature([Account, AnalysisView, Ticket]),
  ],
  controllers: [AnalyticsController, AnalysisViewController],
  providers: [
    AnalyticsAuthorizationContextFactory,
    AnalyticsQueryGateway,
    AnalyticsSourceRegistry,
    AnalysisViewService,
    SupportTicketsAnalyticsAdapter,
  ],
  exports: [AnalyticsQueryGateway, AnalyticsSourceRegistry],
})
export class AnalyticsModule {}
