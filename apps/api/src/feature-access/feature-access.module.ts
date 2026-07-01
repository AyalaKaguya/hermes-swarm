import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { SettingsModule } from "../settings/settings.module.js";
import { FeatureAccessGuard } from "./feature-access.guard.js";
import { FeatureAccessService } from "./feature-access.service.js";

@Module({
  imports: [SettingsModule],
  providers: [
    FeatureAccessService,
    {
      provide: APP_GUARD,
      useClass: FeatureAccessGuard,
    },
  ],
  exports: [FeatureAccessService],
})
export class FeatureAccessModule {}
