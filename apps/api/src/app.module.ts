import { Module } from "@nestjs/common";
import { DatabaseModule } from "./common/database/database.module.js";
import { HealthModule } from "./common/health/health.module.js";

@Module({
  imports: [DatabaseModule, HealthModule],
})
export class AppModule {}
