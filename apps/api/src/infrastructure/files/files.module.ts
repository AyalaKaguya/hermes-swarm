import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { FileObject } from "@hermes-swarm/core";
import { DatabaseModule } from "../../common/database/database.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { FileObjectService } from "./file-object.service.js";
import { FilesController } from "./files.controller.js";
import { ObjectStorage } from "./object-storage.js";
import { S3ObjectStorageService } from "./s3-object-storage.service.js";

@Module({
  imports: [AuthModule, DatabaseModule, TypeOrmModule.forFeature([FileObject])],
  controllers: [FilesController],
  providers: [
    FileObjectService,
    { provide: ObjectStorage, useClass: S3ObjectStorageService },
  ],
  exports: [FileObjectService, ObjectStorage],
})
export class FilesModule {}
