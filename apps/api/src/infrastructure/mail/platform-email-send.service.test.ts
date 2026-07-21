import assert from "node:assert/strict";
import { describe, it } from "node:test";
import nodemailer from "nodemailer";
import { PlatformEmailSendService } from "./platform-email-send.service.js";

describe("PlatformEmailSendService", () => {
  it("sends localized control-plane mail without a workspace context", async () => {
    const deliveries: any[] = [];
    const service = createService({
      templates: [{
        hbs: "<p>Activate {{workspaceName}}</p>",
        languageCode: "en",
        name: "workspace-owner-activation",
        subject: "Activate {{workspaceName}}",
      }],
    });
    const mutable = nodemailer as unknown as { createTransport: (value: unknown) => any };
    const original = mutable.createTransport;
    mutable.createTransport = () => ({
      sendMail: async (message: any) => deliveries.push(message),
    });
    try {
      assert.deepEqual(
        await service.send({
          email: "owner@example.com",
          languageCode: "en",
          locals: { workspaceName: "North" },
          templateName: "workspace-owner-activation",
        }),
        { sent: true },
      );
    } finally {
      mutable.createTransport = original;
    }
    assert.equal(deliveries[0]?.subject, "Activate North");
    assert.equal(deliveries[0]?.html, "<p>Activate North</p>");
  });

  it("fails safely when platform SMTP is unavailable", async () => {
    const service = createService({ smtp: null });
    assert.deepEqual(
      await service.send({
        email: "owner@example.com",
        templateName: "workspace-application-verification",
      }),
      { reason: "smtp_not_configured", sent: false },
    );
  });
});

function createService(options: { smtp?: any; templates?: any[] } = {}) {
  const templates = options.templates ?? [];
  return new PlatformEmailSendService(
    {
      findOne: async ({ where }: any) =>
        templates.find(
          (item) =>
            item.name === where.name && item.languageCode === where.languageCode,
        ) ?? null,
    } as any,
    {
      findOne: async () =>
        options.smtp === undefined
          ? {
              fromAddress: "noreply@example.com",
              host: "smtp.example.com",
              password: null,
              port: 587,
              secure: false,
              username: null,
            }
          : options.smtp,
    } as any,
    { ensureDefaultPlatformTemplates: async () => undefined } as any,
  );
}
