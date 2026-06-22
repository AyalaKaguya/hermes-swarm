import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  Menu,
  MenuPermission,
  Organization,
  TenantUser,
} from "@hermes-swarm/core";
import { TenancyController } from "./tenancy.controller.js";
import { TenancyService } from "./tenancy.service.js";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Organization,
      TenantUser,
      Menu,
      MenuPermission,
    ]),
  ],
  controllers: [TenancyController],
  providers: [TenancyService],
})
export class TenancyModule {}
