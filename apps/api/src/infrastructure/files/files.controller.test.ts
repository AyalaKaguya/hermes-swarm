import assert from "node:assert/strict";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import {
  BadRequestException,
  NotFoundException,
  PayloadTooLargeException,
  UnauthorizedException,
} from "@nestjs/common";
import { FilesController, UploadExceptionFilter } from "./files.controller.js";

describe("FilesController", () => {
  it("rejects missing uploads with a business error", async () => {
    const controller = new FilesController({
      validateAccessToken: async () => ({ sessionId: "s1", userId: "user-1" }),
    } as any);

    await assert.rejects(
      () => controller.upload("Bearer token", undefined),
      BadRequestException,
    );
  });

  it("rejects unsupported image mime types before writing files", async () => {
    const controller = new FilesController({
      validateAccessToken: async () => ({ sessionId: "s1", userId: "user-1" }),
    } as any);

    await assert.rejects(
      () =>
        controller.upload("Bearer token", {
          buffer: Buffer.from("not an image"),
          mimetype: "text/plain",
          originalname: "note.txt",
          size: 12,
        }),
      BadRequestException,
    );
  });

  it("rejects empty image buffers", async () => {
    const controller = new FilesController({
      validateAccessToken: async () => ({ sessionId: "s1", userId: "user-1" }),
    } as any);

    await assert.rejects(
      () =>
        controller.upload("Bearer token", {
          buffer: Buffer.alloc(0),
          mimetype: "image/png",
          originalname: "empty.png",
          size: 0,
        }),
      BadRequestException,
    );
  });

  it("rejects oversized buffers even when the interceptor is bypassed", async () => {
    const controller = new FilesController({
      validateAccessToken: async () => ({ sessionId: "s1", userId: "user-1" }),
    } as any);
    const buffer = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(2 * 1024 * 1024),
    ]);

    await assert.rejects(
      () =>
        controller.upload("Bearer token", {
          buffer,
          mimetype: "image/png",
          originalname: "large.png",
          size: 8,
        }),
      (error: unknown) =>
        error instanceof BadRequestException &&
        (error.getResponse() as { code?: string }).code ===
          "UPLOAD_FILE_TOO_LARGE",
    );
  });

  it("rejects files whose bytes do not match the declared image mime type", async () => {
    const controller = new FilesController({
      validateAccessToken: async () => ({ sessionId: "s1", userId: "user-1" }),
    } as any);

    await assert.rejects(
      () =>
        controller.upload("Bearer token", {
          buffer: Buffer.from("not actually a png"),
          mimetype: "image/png",
          originalname: "spoof.png",
          size: 18,
        }),
      BadRequestException,
    );
  });

  it("stores valid images with a generated filename", async () => {
    const controller = new FilesController({
      validateAccessToken: async () => ({ sessionId: "s1", userId: "user-1" }),
    } as any);
    const buffer = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from("payload"),
    ]);
    let storedPath: string | null = null;

    try {
      const result = await controller.upload("Bearer token", {
        buffer,
        mimetype: "image/png",
        originalname: "avatar.png",
        size: buffer.length,
      });

      assert.equal(result.mimeType, "image/png");
      assert.equal(result.size, buffer.length);
      assert.match(
        result.name,
        /^\d{10,}-[a-f0-9]{16}-[0-9a-f-]{36}\.png$/,
      );
      assert.equal(result.url, `/api/admin/files/${result.name}`);
      storedPath = path.resolve(process.cwd(), "uploads", "avatars", result.name);
    } finally {
      if (storedPath) {
        await unlink(storedPath).catch(() => undefined);
      }
    }
  });

  it("rejects read requests outside generated image filenames", async () => {
    const controller = new FilesController({
      validateAccessToken: async () => ({ sessionId: "s1", userId: "user-1" }),
    } as any);

    await assert.rejects(
      () => controller.read("../secret.png", createFakeSendFileResponse()),
      NotFoundException,
    );
    await assert.rejects(
      () => controller.read("manual.png", createFakeSendFileResponse()),
      NotFoundException,
    );
  });

  it("returns not found for missing generated image files", async () => {
    const controller = new FilesController({
      validateAccessToken: async () => ({ sessionId: "s1", userId: "user-1" }),
    } as any);

    await assert.rejects(
      () =>
        controller.read(
          "1700000000000-0123456789abcdef-123e4567-e89b-12d3-a456-426614174000.png",
          createFakeSendFileResponse(),
        ),
      NotFoundException,
    );
  });

  it("maps missing sessions to a stable unauthorized error", async () => {
    const controller = new FilesController({
      validateAccessToken: async () => {
        throw new Error("invalid token");
      },
    } as any);

    await assert.rejects(
      () => controller.upload("Bearer bad", undefined),
      UnauthorizedException,
    );
  });

  it("maps upload size limit errors to a stable 400 response", () => {
    const response = createFakeResponse();
    const filter = new UploadExceptionFilter();

    filter.catch(new PayloadTooLargeException("File too large"), {
      switchToHttp: () => ({
        getResponse: () => response,
      }),
    } as any);

    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.body, {
      code: "UPLOAD_FILE_TOO_LARGE",
      message: "图片不能超过 2 MB",
      statusCode: 400,
    });
  });

  it("keeps regular bad request responses intact in the upload filter", () => {
    const response = createFakeResponse();
    const filter = new UploadExceptionFilter();

    filter.catch(new BadRequestException("请选择要上传的图片"), {
      switchToHttp: () => ({
        getResponse: () => response,
      }),
    } as any);

    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.body, {
      error: "Bad Request",
      message: "请选择要上传的图片",
      statusCode: 400,
    });
  });
});

function createFakeResponse() {
  return {
    body: null as unknown,
    statusCode: 0,
    json(body: unknown) {
      this.body = body;
      return this;
    },
    status(statusCode: number) {
      this.statusCode = statusCode;
      return this;
    },
  };
}

function createFakeSendFileResponse() {
  return {
    sentFile: null as string | null,
    sendFile(filepath: string) {
      this.sentFile = filepath;
    },
  };
}
