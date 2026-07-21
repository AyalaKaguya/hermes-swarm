import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";
import {
  CustomSmtp,
  EmailLog,
  EmailTemplate,
  WorkspaceOwnedBaseEntity,
} from "@hermes-swarm/core";
import { MailService } from "./mail.service.js";

describe("MailService workspace ownership", () => {
  it("stores SMTP and templates directly at workspace scope", () => {
    assert.equal(
      CustomSmtp.prototype instanceof WorkspaceOwnedBaseEntity,
      true,
    );
    assert.equal(
      EmailTemplate.prototype instanceof WorkspaceOwnedBaseEntity,
      true,
    );
  });

  it("creates workspace templates with the current workspace id", async () => {
    const state = createState();
    const created = await state.service.createWorkspaceTemplate({
      hbs: "<p>{{workspaceName}}</p>",
      languageCode: "zh-CN",
      name: "workspace-invite",
      subject: "{{workspaceName}} 邀请",
    });
    assert.equal(created.name, "workspace-invite");
    assert.equal(state.templates[0]?.workspaceId, "workspace-a");
  });

  it("saves one workspace SMTP configuration", async () => {
    const state = createState();
    const smtp = await state.service.saveWorkspaceSmtp({
      fromAddress: "noreply@example.com",
      host: "smtp.example.com",
      port: 587,
      secure: false,
    });
    assert.equal(smtp.host, "smtp.example.com");
    assert.equal(state.smtp[0]?.workspaceId, "workspace-a");
  });

  it("renders safe template previews and rejects malformed SMTP", () => {
    const state = createState();
    assert.match(
      state.service.previewTemplate({ hbs: "<p>{{workspaceName}}</p>" }).html,
      /Hermes/,
    );
    assert.throws(
      () => state.service.validateSmtp({ host: "", port: 70000 }),
      BadRequestException,
    );
  });

  it("queries only unarchived workspace email logs", async () => {
    const state = createState();
    await state.service.listLogs();
    assert.deepEqual(state.logQueries[0]?.where, {
      isArchived: false,
      workspaceId: "workspace-a",
    });
  });
});

function createState() {
  const templates: Array<Record<string, any>> = [];
  const smtp: Array<Record<string, any>> = [];
  const logQueries: any[] = [];
  const templateRepository = {
    create: (value: any) => ({ id: `template-${templates.length + 1}`, createdAt: new Date(), updatedAt: new Date(), ...value }),
    findOne: async () => null,
    save: async (value: any) => { templates.push(value); return value; },
  };
  const smtpRepository = {
    create: (value: any) => ({ id: "smtp-a", workspaceId: "workspace-a", ...value }),
    findOne: async () => smtp[0] ?? null,
    save: async (value: any) => { if (!smtp.includes(value)) smtp.push(value); return value; },
  };
  const logRepository = {
    find: async (query: any) => { logQueries.push(query); return []; },
  };
  const manager = {
    getRepository: (target: unknown) => {
      if (target === EmailTemplate) return templateRepository;
      if (target === CustomSmtp) return smtpRepository;
      if (target === EmailLog) return logRepository;
      throw new Error("unexpected repository");
    },
  };
  const emptyPlatformRepository = {
    create: (value: any) => value,
    find: async () => [],
    findOne: async () => null,
    save: async (value: any) => value,
  };
  const service = new MailService(
    smtpRepository as never,
    templateRepository as never,
    logRepository as never,
    emptyPlatformRepository as never,
    emptyPlatformRepository as never,
    { current: () => ({ manager, workspaceId: "workspace-a" }) } as never,
  );
  return { logQueries, service, smtp, templates };
}
