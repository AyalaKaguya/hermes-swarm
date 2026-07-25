import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../common/database/database.module.js";
import { AnalyticsQueryGateway } from "./analytics-query.gateway.js";
import { AnalyticsSourceRegistry } from "./analytics-source.registry.js";

@Module({
  imports: [DatabaseModule],
  providers: [AnalyticsQueryGateway, AnalyticsSourceRegistry],
  exports: [AnalyticsQueryGateway, AnalyticsSourceRegistry],
})
export class AnalyticsModule {}
