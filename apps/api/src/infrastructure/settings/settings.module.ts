import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { PlatformSetting, WorkspaceSetting } from "@hermes-swarm/core";
import { DatabaseModule } from "../../common/database/database.module.js";
import { RedisModule } from "../../common/redis/redis.module.js";
import { SettingsController } from "./settings.controller.js";
import { SettingsService } from "./settings.service.js";

@Module({
  imports: [
    RedisModule,
    DatabaseModule,
    TypeOrmModule.forFeature([WorkspaceSetting, PlatformSetting]),
  ],
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
