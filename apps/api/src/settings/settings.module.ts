import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { SystemSetting } from "@hermes-swarm/core";
import { TenancyModule } from "../tenancy/tenancy.module.js";
import { SettingsController } from "./settings.controller.js";
import { SettingsService } from "./settings.service.js";

@Module({
  imports: [TenancyModule, TypeOrmModule.forFeature([SystemSetting])],
  controllers: [SettingsController],
  providers: [SettingsService],
})
export class SettingsModule {}
