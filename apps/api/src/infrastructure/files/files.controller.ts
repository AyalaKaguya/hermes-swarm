import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  Controller,
  ExceptionFilter,
  Get,
  Headers,
  HttpException,
  InternalServerErrorException,
  NotFoundException,
  Param,
  PayloadTooLargeException,
  Post,
  Res,
  UploadedFile,
  UseFilters,
  UseInterceptors,
  UnauthorizedException,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { AccessOperation, AccessResource, PublicAccess } from "@hermes-swarm/rbac";
import { AuthSessionService } from "../auth/auth-session.service.js";

type UploadedImage = {
  buffer?: Buffer;
  mimetype?: string;
  originalname?: string;
  size?: number;
};

const UPLOAD_ROOT = path.resolve(process.cwd(), "uploads", "avatars");
const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/gif": ".gif",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};
const STORED_IMAGE_FILENAME_PATTERN =
  /^\d{10,}-[a-f0-9]{16}-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:gif|jpe?g|png|webp)$/i;
const MAX_IMAGE_SIZE = 2 * 1024 * 1024;

@Catch()
export class UploadExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse();

    if (isUploadSizeLimitError(exception)) {
      return response.status(400).json({
        code: "UPLOAD_FILE_TOO_LARGE",
        message: `图片不能超过 ${formatBytes(MAX_IMAGE_SIZE)}`,
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
        : {
            message: String(body),
            statusCode,
          },
    );
  }
}

@Controller("admin/files")
@AccessResource({
  entity: "file",
  entityLabel: "文件",
  entityOrder: 95,
  purpose: "image_upload",
  purposeLabel: "图片上传",
  purposeOrder: 10,
  scope: "own",
})
export class FilesController {
  constructor(private readonly authSessionService: AuthSessionService) {}

  @Post("upload")
  @AccessOperation({
    description: "上传当前账号可访问的图片资源。",
    label: "上传图片",
    operation: "upload",
    sortOrder: 10,
  })
  @UseFilters(UploadExceptionFilter)
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: MAX_IMAGE_SIZE } }),
  )
  async upload(
    @Headers("authorization") authorization: string | undefined,
    @UploadedFile() file?: UploadedImage,
  ) {
    await requireSessionUserId(this.authSessionService, authorization);

    const buffer = file?.buffer;
    const declaredMimeType = file?.mimetype;
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw new BadRequestException("请选择要上传的图片");
    }
    if (buffer.length > MAX_IMAGE_SIZE) {
      throw new BadRequestException({
        code: "UPLOAD_FILE_TOO_LARGE",
        message: `图片不能超过 ${formatBytes(MAX_IMAGE_SIZE)}`,
        statusCode: 400,
      });
    }

    const detectedMimeType = detectImageMimeType(buffer);
    if (!detectedMimeType || detectedMimeType !== declaredMimeType) {
      throw new BadRequestException("仅支持 PNG、JPG、GIF 或 WebP 图片");
    }

    const extension = IMAGE_EXTENSIONS[detectedMimeType];
    if (!extension) {
      throw new BadRequestException("仅支持 PNG、JPG、GIF 或 WebP 图片");
    }

    await mkdir(UPLOAD_ROOT, { recursive: true });
    const digest = createHash("sha256")
      .update(buffer)
      .digest("hex")
      .slice(0, 16);
    const filename = `${Date.now()}-${digest}-${randomUUID()}${extension}`;
    const filepath = path.join(UPLOAD_ROOT, filename);
    await writeFileAtomically(filepath, buffer);

    return {
      destinations: [
        {
          kind: "storage",
          status: "success",
          url: `/api/admin/files/${filename}`,
        },
      ],
      mimeType: detectedMimeType,
      name: filename,
      originalName: file?.originalname,
      size: buffer.length,
      status: "success",
      url: `/api/admin/files/${filename}`,
    };
  }

  @Post("platform/upload")
  @AccessOperation({
    description: "上传用于平台工单回复的图片资源。",
    label: "上传平台图片",
    operation: "upload",
    scope: "platform",
    sortOrder: 20,
  })
  @UseFilters(UploadExceptionFilter)
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: MAX_IMAGE_SIZE } }),
  )
  uploadForPlatform(
    @Headers("authorization") authorization: string | undefined,
    @UploadedFile() file?: UploadedImage,
  ) {
    return this.upload(authorization, file);
  }

  @Get(":filename")
  @PublicAccess({ reason: "Generated images are served by opaque filenames." })
  async read(@Param("filename") filename: string, @Res() response: any) {
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

async function requireSessionUserId(
  authSessionService: AuthSessionService,
  authorization: string | undefined,
) {
  const token = authorization?.replace(/^Bearer\s+/i, "").trim();
  try {
    const session = await authSessionService.validateAccessToken(token);
    return session.userId;
  } catch {
    throw new UnauthorizedException("登录已失效，请重新登录");
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

function formatBytes(value: number) {
  if (value % (1024 * 1024) === 0) return `${value / (1024 * 1024)} MB`;
  if (value % 1024 === 0) return `${value / 1024} KB`;
  return `${value} B`;
}

function detectImageMimeType(buffer: Buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return "image/png";
  }

  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return "image/jpeg";
  }

  if (
    buffer.length >= 6 &&
    (buffer.subarray(0, 6).equals(GIF_87A_SIGNATURE) ||
      buffer.subarray(0, 6).equals(GIF_89A_SIGNATURE))
  ) {
    return "image/gif";
  }

  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).equals(RIFF_SIGNATURE) &&
    buffer.subarray(8, 12).equals(WEBP_SIGNATURE)
  ) {
    return "image/webp";
  }

  return null;
}

async function writeFileAtomically(filepath: string, buffer: Buffer) {
  const tempPath = path.join(
    path.dirname(filepath),
    `.${path.basename(filepath)}.${randomUUID()}.tmp`,
  );

  try {
    await writeFile(tempPath, buffer);
    await rename(tempPath, filepath);
  } catch (error) {
    await unlink(tempPath).catch(() => undefined);
    throw error;
  }
}

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const GIF_87A_SIGNATURE = Buffer.from("GIF87a", "ascii");
const GIF_89A_SIGNATURE = Buffer.from("GIF89a", "ascii");
const RIFF_SIGNATURE = Buffer.from("RIFF", "ascii");
const WEBP_SIGNATURE = Buffer.from("WEBP", "ascii");
