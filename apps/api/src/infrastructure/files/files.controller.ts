import {
  ArgumentsHost,
  BadRequestException,
  Body,
  Catch,
  Controller,
  Delete,
  ExceptionFilter,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
  NotFoundException,
  Param,
  PayloadTooLargeException,
  Post,
  Res,
  UploadedFile,
  UseFilters,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type {
  CompleteFileObjectPayload,
  CreateFileObjectPayload,
} from "@hermes-swarm/api-contracts";
import {
  AccessOperation,
  AccessResource,
  CurrentPrincipal,
  PublicAccess,
  type AccessAuthSession,
} from "@hermes-swarm/rbac";
import { stat } from "node:fs/promises";
import path from "node:path";
import {
  FileObjectService,
  type UploadedFileBuffer,
} from "./file-object.service.js";
import { MAX_AVATAR_BYTES } from "./image-file-validation.js";

const UPLOAD_ROOT = path.resolve(process.cwd(), "uploads", "avatars");
const STORED_IMAGE_FILENAME_PATTERN =
  /^\d{10,}-[a-f0-9]{16}-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:gif|jpe?g|png|webp)$/i;

@Catch()
export class UploadExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse();
    if (isUploadSizeLimitError(exception)) {
      return response.status(400).json({
        code: "UPLOAD_FILE_TOO_LARGE",
        message: "图片不能超过 2 MB",
        statusCode: 400,
      });
    }
    const httpException =
      exception instanceof HttpException
        ? exception
        : new InternalServerErrorException("文件上传失败");
    const statusCode = httpException.getStatus();
    const body = httpException.getResponse();
    return response.status(statusCode).json(
      typeof body === "object" && body !== null
        ? body
        : { message: String(body), statusCode },
    );
  }
}

@Controller("admin/files")
@AccessResource({
  entity: "file",
  entityLabel: "文件",
  entityOrder: 95,
  purpose: "file_object",
  purposeLabel: "文件对象",
  purposeOrder: 10,
  scope: "own",
})
export class FilesController {
  constructor(private readonly fileObjects: FileObjectService) {}

  @Post("upload")
  @AccessOperation({
    description: "上传当前账号头像或当前工作空间工单图片。",
    label: "上传小图片",
    operation: "upload",
    sortOrder: 10,
  })
  @UseFilters(UploadExceptionFilter)
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: MAX_AVATAR_BYTES } }),
  )
  upload(
    @CurrentPrincipal() principal: AccessAuthSession,
    @UploadedFile() file?: UploadedFileBuffer,
    @Body("purpose") purpose?: string,
  ) {
    if (purpose !== "avatar" && purpose !== "ticket_attachment") {
      throw new BadRequestException({
        code: "FILE_PURPOSE_REQUIRED",
        message: "必须指定 avatar 或 ticket_attachment 用途",
        statusCode: 400,
      });
    }
    return this.fileObjects.uploadImage(principal, file, {
      purpose,
      scope: purpose === "avatar" ? "account" : "workspace",
    });
  }

  @Post("platform/upload")
  @AccessOperation({
    description: "上传用于平台工单回复的临时图片对象。",
    label: "上传平台图片",
    operation: "upload",
    scope: "platform",
    sortOrder: 20,
  })
  @UseFilters(UploadExceptionFilter)
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: MAX_AVATAR_BYTES } }),
  )
  uploadForPlatform(
    @CurrentPrincipal() principal: AccessAuthSession,
    @UploadedFile() file?: UploadedFileBuffer,
  ) {
    return this.fileObjects.uploadImage(principal, file, {
      purpose: "ticket_attachment",
      scope: "platform",
    });
  }

  @Post("objects")
  @AccessOperation({
    description: "创建通用文件对象上传意图并签发短期 PUT 地址。",
    label: "创建上传意图",
    operation: "create",
    sortOrder: 30,
  })
  createObject(
    @CurrentPrincipal() principal: AccessAuthSession,
    @Body() payload: CreateFileObjectPayload,
  ) {
    return this.fileObjects.createUploadIntent(principal, payload);
  }

  @Post("objects/:fileId/complete")
  @AccessOperation({
    description: "重新读取并校验上传对象，然后幂等完成文件。",
    label: "确认上传完成",
    operation: "complete",
    sortOrder: 40,
  })
  completeObject(
    @CurrentPrincipal() principal: AccessAuthSession,
    @Param("fileId") fileId: string,
    @Body() payload: CompleteFileObjectPayload,
  ) {
    return this.fileObjects.complete(principal, fileId, payload);
  }

  @Get("objects/:fileId")
  @AccessOperation({
    description: "读取当前可信作用域内的文件元数据。",
    label: "查看文件元数据",
    operation: "get",
    sortOrder: 50,
  })
  getObject(
    @CurrentPrincipal() principal: AccessAuthSession,
    @Param("fileId") fileId: string,
  ) {
    return this.fileObjects.getMetadata(principal, fileId);
  }

  @Get("objects/:fileId/content")
  @AccessOperation({
    description: "鉴权后重定向到五分钟有效的对象下载地址。",
    label: "下载文件",
    operation: "download",
    sortOrder: 60,
  })
  async content(
    @CurrentPrincipal() principal: AccessAuthSession,
    @Param("fileId") fileId: string,
    @Res() response: { redirect(status: number, url: string): void },
  ) {
    response.redirect(
      HttpStatus.FOUND,
      await this.fileObjects.getContentUrl(principal, fileId),
    );
  }

  @Delete("objects/:fileId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @AccessOperation({
    description: "删除当前创建者尚未绑定的临时文件对象。",
    isDangerous: true,
    label: "删除临时文件",
    operation: "delete",
    sortOrder: 70,
  })
  deleteObject(
    @CurrentPrincipal() principal: AccessAuthSession,
    @Param("fileId") fileId: string,
  ) {
    return this.fileObjects.deleteTemporary(principal, fileId);
  }

  @Get(":filename")
  @PublicAccess({ reason: "Legacy opaque local image URLs remain read-only during migration." })
  async readLegacy(@Param("filename") filename: string, @Res() response: any) {
    if (!STORED_IMAGE_FILENAME_PATTERN.test(filename)) {
      throw new NotFoundException();
    }
    const resolved = path.resolve(UPLOAD_ROOT, filename);
    const relative = path.relative(UPLOAD_ROOT, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new NotFoundException();
    }
    try {
      await stat(resolved);
    } catch {
      throw new NotFoundException();
    }
    response.sendFile(resolved);
  }
}

function isUploadSizeLimitError(exception: unknown) {
  const typed = exception as {
    code?: string;
    getStatus?: () => number;
    message?: string;
    name?: string;
  };
  return (
    exception instanceof PayloadTooLargeException ||
    typed.code === "LIMIT_FILE_SIZE" ||
    (typed.name === "MulterError" && typed.code === "LIMIT_FILE_SIZE") ||
    typed.getStatus?.() === 413 ||
    typed.message === "File too large"
  );
}
