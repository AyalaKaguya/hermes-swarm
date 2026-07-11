import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  Department,
  DepartmentDispatchRelation,
  Organization,
  UserDepartment,
  UserOrganization,
} from "@hermes-swarm/core";
import { DepartmentsController } from "./departments.controller.js";
import { DepartmentDispatchResolverService } from "./department-dispatch-resolver.service.js";
import { DepartmentsService } from "./departments.service.js";
import { DatabaseModule } from "../../common/database/database.module.js";

@Module({
  imports: [
    DatabaseModule,
    TypeOrmModule.forFeature([
      Department,
      DepartmentDispatchRelation,
      Organization,
      UserDepartment,
      UserOrganization,
    ]),
  ],
  controllers: [DepartmentsController],
  providers: [DepartmentDispatchResolverService, DepartmentsService],
  exports: [DepartmentDispatchResolverService, DepartmentsService],
})
export class DepartmentsModule {}
