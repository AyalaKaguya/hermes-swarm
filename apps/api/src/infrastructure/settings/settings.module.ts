import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { OrganizationSetting, PlatformSetting, TenantSetting } from "@hermes-swarm/core";
import { DatabaseModule } from "../../common/database/database.module.js";
import { RedisModule } from "../../common/redis/redis.module.js";
import { SettingsController } from "./settings.controller.js";
import { SettingsService } from "./settings.service.js";
import { PLATFORM_DATA_SOURCE } from "../../common/database/database.constants.js";

@Module({
  imports: [
    RedisModule,
    DatabaseModule,
    TypeOrmModule.forFeature([OrganizationSetting, TenantSetting]),
    TypeOrmModule.forFeature([PlatformSetting], PLATFORM_DATA_SOURCE),
  ],
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
