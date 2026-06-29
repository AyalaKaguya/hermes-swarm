import { Module } from "@nestjs/common";
import { AdminModule } from "./admin/admin.module.js";
import { DatabaseModule } from "./common/database/database.module.js";
import { HealthModule } from "./common/health/health.module.js";
import { RbacModule } from "./rbac/rbac.module.js";

@Module({
  imports: [DatabaseModule, HealthModule, RbacModule, AdminModule],
})
export class AppModule {}
