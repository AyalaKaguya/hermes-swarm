import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { FilesController } from "./files.controller.js";

@Module({
  imports: [AuthModule],
  controllers: [FilesController],
})
export class FilesModule {}
