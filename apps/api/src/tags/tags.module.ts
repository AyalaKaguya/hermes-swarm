import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Tag } from "@hermes-swarm/core";
import { TenancyModule } from "../tenancy/tenancy.module.js";
import { TagsController } from "./tags.controller.js";
import { TagsService } from "./tags.service.js";

@Module({
  imports: [TenancyModule, TypeOrmModule.forFeature([Tag])],
  controllers: [TagsController],
  providers: [TagsService],
})
export class TagsModule {}
