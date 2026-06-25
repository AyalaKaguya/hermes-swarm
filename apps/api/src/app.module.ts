import { Module } from "@nestjs/common";
import { AdminModule } from "./admin/admin.module.js";
import { DatabaseModule } from "./common/database/database.module.js";
import { HealthModule } from "./common/health/health.module.js";

@Module({
  imports: [DatabaseModule, HealthModule, AdminModule],
})
export class AppModule {}
