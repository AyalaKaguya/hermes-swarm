import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  NotFoundException,
  Param,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
  UnauthorizedException,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseAuthSessionToken } from "../tenancy/admin-session.js";

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
const MAX_IMAGE_SIZE = 2 * 1024 * 1024;

@Controller("admin/files")
export class FilesController {
  @Post("upload")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_IMAGE_SIZE } }))
  async upload(
    @Headers("authorization") authorization: string | undefined,
    @UploadedFile() file?: UploadedImage,
  ) {
    requireSessionUserId(authorization);

    if (!file?.buffer) {
      throw new BadRequestException("请选择要上传的图片");
    }

    const extension = IMAGE_EXTENSIONS[file.mimetype ?? ""];
    if (!extension) {
      throw new BadRequestException("仅支持 PNG、JPG、GIF 或 WebP 图片");
    }

    await mkdir(UPLOAD_ROOT, { recursive: true });
    const digest = createHash("sha256").update(file.buffer).digest("hex").slice(0, 16);
    const filename = `${Date.now()}-${digest}-${randomUUID()}${extension}`;
    const filepath = path.join(UPLOAD_ROOT, filename);
    await writeFile(filepath, file.buffer);

    return {
      destinations: [
        {
          kind: "storage",
          status: "success",
          url: `/api/admin/files/${filename}`,
        },
      ],
      mimeType: file.mimetype,
      name: filename,
      originalName: file.originalname,
      size: file.size ?? file.buffer.length,
      status: "success",
      url: `/api/admin/files/${filename}`,
    };
  }

  @Get(":filename")
  async read(@Param("filename") filename: string, @Res() response: any) {
    if (!/^[\w.-]+$/.test(filename)) {
      throw new NotFoundException();
    }

    const filepath = path.join(UPLOAD_ROOT, filename);
    const resolved = path.resolve(filepath);
    if (!resolved.startsWith(`${UPLOAD_ROOT}${path.sep}`)) {
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

function requireSessionUserId(authorization: string | undefined) {
  const token = authorization?.replace(/^Bearer\s+/i, "").trim();
  const session = parseAuthSessionToken(token);
  if (!session) throw new UnauthorizedException("登录已失效，请重新登录");
  return session.userId;
}
