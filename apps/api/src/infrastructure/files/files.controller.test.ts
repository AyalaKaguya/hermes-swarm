import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BadRequestException,
  NotFoundException,
  PayloadTooLargeException,
} from "@nestjs/common";
import { FilesController, UploadExceptionFilter } from "./files.controller.js";

const workspacePrincipal = {
  principalType: "workspace" as const,
  userId: "11111111-1111-4111-8111-111111111111",
  workspaceId: "22222222-2222-4222-8222-222222222222",
};

describe("FilesController", () => {
  it("requires an explicit small-upload purpose", async () => {
    const controller = new FilesController({} as any);
    await assert.rejects(
      async () => controller.upload(workspacePrincipal as any, undefined, undefined),
      BadRequestException,
    );
  });

  it("delegates avatar uploads using account scope", async () => {
    let received: unknown;
    const controller = new FilesController({
      uploadImage: async (...args: unknown[]) => {
        received = args;
        return { fileId: "file-1", status: "success" };
      },
    } as any);
    const file = { buffer: Buffer.from("image"), mimetype: "image/png" };
    await controller.upload(workspacePrincipal as any, file, "avatar");
    assert.deepEqual(received, [
      workspacePrincipal,
      file,
      { purpose: "avatar", scope: "account" },
    ]);
  });

  it("delegates platform uploads using a platform temporary scope", async () => {
    let received: unknown;
    const principal = { ...workspacePrincipal, principalType: "platform", workspaceId: null };
    const controller = new FilesController({
      uploadImage: async (...args: unknown[]) => {
        received = args;
        return { fileId: "file-1", status: "success" };
      },
    } as any);
    await controller.uploadForPlatform(principal as any, undefined);
    assert.deepEqual(received, [
      principal,
      undefined,
      { purpose: "ticket_attachment", scope: "platform" },
    ]);
  });

  it("redirects only after the file service authorizes content", async () => {
    const controller = new FilesController({
      getContentUrl: async () => "https://storage.example/signed",
    } as any);
    const response = {
      status: 0,
      url: "",
      redirect(status: number, url: string) {
        this.status = status;
        this.url = url;
      },
    };
    await controller.content(workspacePrincipal as any, "file-1", response);
    assert.equal(response.status, 302);
    assert.equal(response.url, "https://storage.example/signed");
  });

  it("rejects legacy read requests outside generated image filenames", async () => {
    const controller = new FilesController({} as any);
    await assert.rejects(
      () => controller.readLegacy("../secret.png", createFakeSendFileResponse()),
      NotFoundException,
    );
    await assert.rejects(
      () => controller.readLegacy("manual.png", createFakeSendFileResponse()),
      NotFoundException,
    );
  });

  it("returns not found for missing legacy generated image files", async () => {
    const controller = new FilesController({} as any);
    await assert.rejects(
      () =>
        controller.readLegacy(
          "1700000000000-0123456789abcdef-123e4567-e89b-12d3-a456-426614174000.png",
          createFakeSendFileResponse(),
        ),
      NotFoundException,
    );
  });

  it("maps upload size limit errors to a stable 400 response", () => {
    const response = createFakeResponse();
    const filter = new UploadExceptionFilter();
    filter.catch(new PayloadTooLargeException("File too large"), {
      switchToHttp: () => ({ getResponse: () => response }),
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
      switchToHttp: () => ({ getResponse: () => response }),
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
  return { sendFile() {} };
}
