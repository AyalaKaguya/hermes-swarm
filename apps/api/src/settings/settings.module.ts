import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { OrganizationSetting, PlatformSetting } from "@hermes-swarm/core";
import { RedisModule } from "../common/redis/redis.module.js";
import { SettingsController } from "./settings.controller.js";
import { SettingsService } from "./settings.service.js";

@Module({
  imports: [
    RedisModule,
    TypeOrmModule.forFeature([OrganizationSetting, PlatformSetting]),
  ],
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
