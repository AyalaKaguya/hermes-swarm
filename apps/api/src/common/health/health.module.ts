import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller.js";
import { FilesModule } from "../../infrastructure/files/files.module.js";

@Module({
  imports: [FilesModule],
  controllers: [HealthController],
})
export class HealthModule {}
