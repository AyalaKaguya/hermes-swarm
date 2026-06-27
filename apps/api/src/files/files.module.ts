import { Module } from "@nestjs/common";
import { TenancyModule } from "../tenancy/tenancy.module.js";
import { FilesController } from "./files.controller.js";

@Module({
  imports: [TenancyModule],
  controllers: [FilesController],
})
export class FilesModule {}
