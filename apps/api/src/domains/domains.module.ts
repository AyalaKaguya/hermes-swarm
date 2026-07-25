import { Module } from "@nestjs/common";
import { AnalyticsModule } from "./analytics/analytics.module.js";
import { SupportModule } from "./support/support.module.js";

@Module({
  imports: [AnalyticsModule, SupportModule],
})
export class DomainsModule {}
