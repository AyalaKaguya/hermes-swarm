import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";
import { EmailTemplate } from "@hermes-swarm/core";
import nodemailer from "nodemailer";
import { getMetadataArgsStorage, QueryFailedError } from "typeorm";
import { EmailSendService } from "./email-send.service.js";
import { MailService } from "./mail.service.js";

describe("MailService templates", () => {
  it("declares separate unique indexes for platform and organization templates", () => {
    const indices = getMetadataArgsStorage().indices.filter(
      (index) => index.target === EmailTemplate,
    );

    assert.ok(
      indices.some(
        (index) =>
          index.name === "UQ_email_templates_platform_name_language" &&
          getIndexUnique(index) === true &&
          getIndexWhere(index) === "\"organization_id\" IS NULL",
      ),
    );
    assert.ok(
      indices.some(
        (index) =>
          index.name === "UQ_email_templates_org_name_language" &&
          getIndexUnique(index) === true &&
          getIndexWhere(index) === "\"organization_id\" IS NOT NULL",
      ),
    );
  });

  it("seeds platform and organization system templates and prefers organization templates for display", async () => {
    const state = createMailService();

    await state.service.ensureDefaultPlatformTemplates();
    await state.service.ensureDefaultTemplatesForOrganization("org-1");

    const platformTemplates = await state.service.listTemplates(null);
    assert.deepEqual(
      platformTemplates.map((template) => template.name).sort(),
      ["organization-invite", "password-reset"],
    );
    assert.ok(platformTemplates.every((template) => template.isSystem));
    assert.ok(platformTemplates.every((template) => template.organizationId === null));

    const organizationTemplates = await state.service.listTemplates("org-1");
    assert.deepEqual(
      organizationTemplates.map((template) => template.name).sort(),
      ["organization-invite", "password-reset"],
    );
    assert.ok(
      organizationTemplates.every(
        (template) => template.organizationId === "org-1",
      ),
    );
  });

  it("allows editing system template content but protects identity fields and deletion", async () => {
    const state = createMailService();
    await state.service.ensureDefaultPlatformTemplates();
    const [template] = await state.service.listTemplates(null);

    const updated = await state.service.updateTemplate(null, template.id, {
      hbs: "<p>updated</p>",
      subject: "Updated subject",
    });

    assert.equal(updated.hbs, "<p>updated</p>");
    assert.equal(updated.subject, "Updated subject");

    await assert.rejects(
      () =>
        state.service.updateTemplate(null, template.id, {
          name: "renamed-template",
        }),
      BadRequestException,
    );
    await assert.rejects(
      () =>
        state.service.updateTemplate(null, template.id, {
          languageCode: "en",
        }),
      BadRequestException,
    );
    await assert.rejects(
      () => state.service.deleteTemplate(null, template.id),
      BadRequestException,
    );
  });

  it("resolves organization templates before platform fallback templates", async () => {
    const state = createEmailSendService();
    state.emailTemplates.push(
      emailTemplateRecord({
        hbs: "<p>platform-en</p>",
        id: "template-platform",
        languageCode: "en",
        name: "organization-invite",
        organizationId: null,
        subject: "Platform",
      }),
      emailTemplateRecord({
        hbs: "<p>org-zh</p>",
        id: "template-org",
        languageCode: "zh-CN",
        name: "organization-invite",
        organizationId: "org-1",
        subject: "Organization",
      }),
    );

    const organizationTemplate = await (state.service as any).resolveTemplate(
      "organization-invite",
      "zh-Hans",
      "org-1",
    );
    assert.equal(organizationTemplate.hbs, "<p>org-zh</p>");

    const platformFallback = await (state.service as any).resolveTemplate(
      "organization-invite",
      "zh-Hant",
      "org-1",
    );
    assert.equal(platformFallback.hbs, "<p>platform-en</p>");
  });

  it("continues default template seeding when a concurrent insert wins the race", async () => {
    const state = createMailService({
      simulateConcurrentPlatformTemplateSeed: true,
    });

    await state.service.ensureDefaultPlatformTemplates();

    assert.deepEqual(
      state.emailTemplates.map((template) => template.name).sort(),
      ["organization-invite", "password-reset"],
    );
  });

  it("rejects malformed template payloads before repository writes", async () => {
    const state = createMailService();

    await assert.rejects(
      () => state.service.createTemplate(null, null as any),
      BadRequestException,
    );
    await assert.rejects(
      () =>
        state.service.createTemplate(null, {
          hbs: "<p>body</p>",
          languageCode: "zh-CN",
          name: "x".repeat(121),
        }),
      BadRequestException,
    );

    assert.equal(state.emailTemplates.length, 0);
  });

  it("maps template uniqueness failures to a business error", async () => {
    const state = createMailService({
      failTemplateSaveWithUniqueConstraint: true,
    });

    await assert.rejects(
      () =>
        state.service.createTemplate(null, {
          hbs: "<p>body</p>",
          languageCode: "zh-CN",
          name: "password-reset",
        }),
      BadRequestException,
    );
  });
});

describe("MailService SMTP resolution", () => {
  it("uses organization SMTP first and gates global SMTP behind public SMTP setting", async () => {
    const state = createEmailSendService({ publicSmtpEnabled: false });
    state.smtpTemplates.push(
      smtpRecord({ host: "global.smtp.local", id: "smtp-global", organizationId: null }),
      smtpRecord({ host: "org.smtp.local", id: "smtp-org", organizationId: "org-1" }),
    );

    const organizationSmtp = await (state.service as any).findSmtpRecord("org-1");
    assert.equal(organizationSmtp.host, "org.smtp.local");

    const disabledGlobal = await (state.service as any).findSmtpRecord(null);
    assert.equal(disabledGlobal, null);

    state.publicSmtpEnabled = true;
    const enabledGlobal = await (state.service as any).findSmtpRecord(null);
    assert.equal(enabledGlobal.host, "global.smtp.local");
  });

  it("rejects malformed SMTP payloads before saving", async () => {
    const state = createMailService();

    await assert.rejects(
      () => state.service.saveSmtp("org-1", null as any),
      BadRequestException,
    );
    await assert.rejects(
      () =>
        state.service.saveSmtp("org-1", {
          host: "x".repeat(241),
        }),
      BadRequestException,
    );
    await assert.rejects(
      () =>
        state.service.saveSmtp("org-1", {
          port: 587,
        }),
      BadRequestException,
    );
    await assert.rejects(
      () =>
        state.service.saveSmtp("org-1", {
          host: "smtp.local",
          secure: "false" as any,
        }),
      BadRequestException,
    );
    assert.throws(
      () =>
        state.service.validateSmtp({
          host: "smtp.local",
          port: 0,
        }),
      BadRequestException,
    );
    assert.throws(
      () =>
        state.service.validateSmtp({
          host: "smtp.local",
          secure: "false" as any,
        }),
      BadRequestException,
    );

    assert.equal(state.smtpTemplates.length, 0);
  });

  it("allows partial SMTP updates only after a valid host exists", async () => {
    const state = createMailService();
    state.smtpTemplates.push(
      smtpRecord({ host: "smtp.local", id: "smtp-org", organizationId: "org-1" }),
    );

    const updated = await state.service.saveSmtp("org-1", {
      port: 2525,
    });

    assert.equal(updated.host, "smtp.local");
    assert.equal(updated.port, 2525);
    assert.equal(state.smtpTemplates.length, 1);
  });
});

describe("MailService logs", () => {
  it("rejects malformed log payloads and invalid statuses before saving", async () => {
    const state = createMailService();

    await assert.rejects(
      () => state.service.createLog("org-1", null as any),
      BadRequestException,
    );
    await assert.rejects(
      () =>
        state.service.createLog("org-1", {
          email: "user@example.com",
          status: "delivered" as any,
        }),
      BadRequestException,
    );

    assert.equal(state.emailLogs.length, 0);
  });

  it("hides archived email logs from default list results", async () => {
    const state = createMailService();
    await state.service.createLog("org-1", {
      email: "visible@example.com",
      isArchived: false,
      status: "sent",
    });
    await state.service.createLog("org-1", {
      email: "archived@example.com",
      isArchived: true,
      status: "sent",
    });

    const logs = await state.service.listLogs("org-1");

    assert.deepEqual(
      logs.map((log) => log.email),
      ["visible@example.com"],
    );
  });
});

describe("EmailSendService send", () => {
  it("returns a skipped result and records an audit row when no SMTP is configured", async () => {
    const state = createEmailSendService({ publicSmtpEnabled: false });

    const result = await state.service.send({
      email: "user@example.com",
      organizationId: null,
      templateName: "password-reset",
    });

    assert.deepEqual(result, {
      reason: "smtp_not_configured",
      sent: false,
    });
    assert.equal(state.emailLogs.length, 1);
    assert.equal(state.emailLogs[0].status, "skipped");
    assert.equal(state.emailLogs[0].templateName, "password-reset");
  });

  it("returns a skipped result and records an audit row when the template is missing", async () => {
    const state = createEmailSendService({ publicSmtpEnabled: true });
    state.smtpTemplates.push(
      smtpRecord({
        host: "global.smtp.local",
        id: "smtp-global",
        organizationId: null,
      }),
    );

    const result = await state.service.send({
      email: "user@example.com",
      organizationId: null,
      templateName: "password-reset",
    });

    assert.deepEqual(result, {
      reason: "template_not_found",
      sent: false,
    });
    assert.equal(state.emailLogs.length, 1);
    assert.equal(state.emailLogs[0].status, "skipped");
  });

  it("returns send_failed and records failure when the transporter rejects", async () => {
    const state = createEmailSendService({ publicSmtpEnabled: true });
    state.smtpTemplates.push(
      smtpRecord({
        host: "global.smtp.local",
        id: "smtp-global",
        organizationId: null,
      }),
    );
    state.emailTemplates.push(
      emailTemplateRecord({
        hbs: "<p>Hello {{name}}</p>",
        id: "template",
        languageCode: "zh-CN",
        name: "password-reset",
        organizationId: null,
        subject: "Hi {{name}}",
      }),
    );

    const result = await withMockedTransporter(
      {
        async sendMail() {
          throw new Error("smtp unavailable");
        },
      },
      () =>
        state.service.send({
          email: "user@example.com",
          organizationId: null,
          templateName: "password-reset",
          locals: { name: "Ayala" },
        }),
    );

    assert.deepEqual(result, {
      reason: "send_failed",
      sent: false,
    });
    assert.equal(state.emailLogs.length, 1);
    assert.equal(state.emailLogs[0].status, "failed");
  });

  it("sends with empty locals, compiles subject and body, and records sent status", async () => {
    const state = createEmailSendService({ publicSmtpEnabled: true });
    const deliveries: any[] = [];
    state.smtpTemplates.push(
      smtpRecord({
        host: "global.smtp.local",
        id: "smtp-global",
        organizationId: null,
      }),
    );
    state.emailTemplates.push(
      emailTemplateRecord({
        hbs: "<p>Hello {{name}}</p>",
        id: "template",
        languageCode: "zh-CN",
        name: "password-reset",
        organizationId: null,
        subject: "Hi {{name}}",
      }),
    );

    const result = await withMockedTransporter(
      {
        async sendMail(message: any) {
          deliveries.push(message);
          return { messageId: "mail-1" };
        },
      },
      () =>
        state.service.send({
          email: "user@example.com",
          organizationId: null,
          templateName: "password-reset",
        }),
    );

    assert.deepEqual(result, { sent: true });
    assert.equal(deliveries.length, 1);
    assert.equal(deliveries[0].to, "user@example.com");
    assert.equal(deliveries[0].subject, "Hi ");
    assert.equal(deliveries[0].html, "<p>Hello </p>");
    assert.equal(state.emailLogs.length, 1);
    assert.equal(state.emailLogs[0].status, "sent");
    assert.equal(state.emailLogs[0].content, "<p>Hello </p>");
  });

  it("normalizes audit fields before saving skipped delivery logs", async () => {
    const state = createEmailSendService({ publicSmtpEnabled: false });

    const result = await state.service.send({
      email: `${"u".repeat(241)}@example.com`,
      organizationId: null,
      templateName: "template-".repeat(20),
    });

    assert.deepEqual(result, {
      reason: "smtp_not_configured",
      sent: false,
    });
    assert.equal(state.emailLogs.length, 1);
    assert.equal(state.emailLogs[0].email.length, 240);
    assert.equal(state.emailLogs[0].templateName.length, 120);
  });

  it("keeps sending while constraining long rendered subjects in audit logs", async () => {
    const state = createEmailSendService({ publicSmtpEnabled: true });
    const deliveries: any[] = [];
    const subject = `Subject ${"x".repeat(260)}`;
    state.smtpTemplates.push(
      smtpRecord({
        host: "global.smtp.local",
        id: "smtp-global",
        organizationId: null,
      }),
    );
    state.emailTemplates.push(
      emailTemplateRecord({
        hbs: "<p>Hello</p>",
        id: "template",
        languageCode: "zh-CN",
        name: "password-reset",
        organizationId: null,
        subject,
      }),
    );

    const result = await withMockedTransporter(
      {
        async sendMail(message: any) {
          deliveries.push(message);
          return { messageId: "mail-1" };
        },
      },
      () =>
        state.service.send({
          email: "user@example.com",
          organizationId: null,
          templateName: "password-reset",
        }),
    );

    assert.deepEqual(result, { sent: true });
    assert.equal(deliveries[0].subject, subject);
    assert.equal(state.emailLogs.length, 1);
    assert.equal(state.emailLogs[0].subject.length, 240);
  });
});

function createMailService(
  options: {
    failTemplateSaveWithUniqueConstraint?: boolean;
    simulateConcurrentPlatformTemplateSeed?: boolean;
  } = {},
) {
  const emailTemplates: any[] = [];
  const smtpTemplates: any[] = [];
  const emailLogs: any[] = [];
  let simulatedConcurrentInsert = false;

  const service = new MailService(
    createRepository(smtpTemplates) as any,
    createRepository(emailTemplates, {
      async onSave(record, saveDefault) {
        if (options.failTemplateSaveWithUniqueConstraint) {
          throw new QueryFailedError("INSERT", [], { code: "23505" } as any);
        }
        if (
          options.simulateConcurrentPlatformTemplateSeed &&
          !simulatedConcurrentInsert &&
          record.organizationId === null &&
          record.name === "organization-invite"
        ) {
          simulatedConcurrentInsert = true;
          await saveDefault(record);
          throw new QueryFailedError("INSERT", [], { code: "23505" } as any);
        }
        return saveDefault(record);
      },
    }) as any,
    createRepository(emailLogs) as any,
  );

  return {
    emailLogs,
    emailTemplates,
    service,
    smtpTemplates,
  };
}

function createEmailSendService(options: { publicSmtpEnabled?: boolean } = {}) {
  const emailTemplates: any[] = [];
  const smtpTemplates: any[] = [];
  const emailLogs: any[] = [];
  const state = {
    publicSmtpEnabled: Boolean(options.publicSmtpEnabled),
  };
  const service = new EmailSendService(
    createRepository(smtpTemplates) as any,
    createRepository(emailTemplates) as any,
    createRepository(emailLogs) as any,
    {
      async getPlatformValue() {
        return state.publicSmtpEnabled ? "true" : "false";
      },
    } as any,
  );

  return {
    emailLogs,
    emailTemplates,
    get publicSmtpEnabled() {
      return state.publicSmtpEnabled;
    },
    set publicSmtpEnabled(value: boolean) {
      state.publicSmtpEnabled = value;
    },
    service,
    smtpTemplates,
  };
}

function createRepository(
  records: any[],
  options: {
    onSave?: (
      record: any,
      saveDefault: (record: any) => Promise<any>,
    ) => Promise<any>;
  } = {},
) {
  async function saveDefault(record: any) {
    const next = { ...record, id: record.id ?? `${records.length + 1}` };
    const index = records.findIndex((item) => item.id === next.id);
    if (index >= 0) {
      records[index] = next;
    } else {
      records.push(next);
    }
    return next;
  }

  const repository = {
    create(value: any) {
      return {
        createdAt: new Date("2026-01-01T00:00:00Z"),
        id: `${records.length + 1}`,
        updatedAt: new Date("2026-01-01T00:00:00Z"),
        ...value,
      };
    },
    manager: {
      async findOne(_target: unknown, options: any) {
        return repository.findOne(options);
      },
      async save(_target: unknown, record: any) {
        return repository.save(record);
      },
    },
    async find({ where, order }: any = {}) {
      const candidates = where === undefined ? [{}] : Array.isArray(where) ? where : [where];
      const matched = records.filter((record) =>
        candidates.some((candidate) => matchesWhere(record, candidate)),
      );
      if (order?.name && order?.languageCode) {
        return [...matched].sort(
          (left, right) =>
            left.name.localeCompare(right.name) ||
            left.languageCode.localeCompare(right.languageCode),
        );
      }
      return matched;
    },
    async findOne({ where }: any) {
      const candidates = Array.isArray(where) ? where : [where];
      return (
        records.find((record) =>
          candidates.some((candidate) => matchesWhere(record, candidate)),
        ) ?? null
      );
    },
    async remove(record: any) {
      const index = records.findIndex((item) => item.id === record.id);
      if (index >= 0) records.splice(index, 1);
      return record;
    },
    async save(record: any) {
      return options.onSave
        ? options.onSave(record, saveDefault)
        : saveDefault(record);
    },
  };

  return repository;
}

function matchesWhere(record: any, where: Record<string, unknown>) {
  return Object.entries(where).every(([key, expected]) => {
    if (isNullOperator(expected)) return record[key] === null;
    return record[key] === expected;
  });
}

function isNullOperator(value: unknown) {
  return Boolean(value && typeof value === "object");
}

function smtpRecord(input: {
  host: string;
  id: string;
  organizationId: string | null;
}) {
  return {
    fromAddress: "noreply@example.com",
    host: input.host,
    id: input.id,
    isValidated: true,
    organizationId: input.organizationId,
    password: null,
    port: 587,
    secure: false,
    username: null,
  };
}

function emailTemplateRecord(input: {
  hbs: string;
  id: string;
  languageCode: string;
  name: string;
  organizationId: string | null;
  subject: string;
}) {
  return {
    description: null,
    hbs: input.hbs,
    id: input.id,
    isSystem: true,
    languageCode: input.languageCode,
    mjml: null,
    name: input.name,
    organizationId: input.organizationId,
    subject: input.subject,
  };
}

async function withMockedTransporter<T>(
  transporter: { sendMail?: (message: any) => Promise<any>; verify?: () => Promise<boolean> },
  action: () => Promise<T>,
) {
  const mutableNodemailer = nodemailer as unknown as {
    createTransport: (options: unknown) => unknown;
  };
  const originalCreateTransport = mutableNodemailer.createTransport;
  mutableNodemailer.createTransport = () => ({
    sendMail: transporter.sendMail ?? (async () => ({ messageId: "mail" })),
    verify: transporter.verify ?? (async () => true),
  });
  try {
    return await action();
  } finally {
    mutableNodemailer.createTransport = originalCreateTransport;
  }
}

function getIndexUnique(index: unknown) {
  const value = index as {
    options?: { unique?: boolean };
    unique?: boolean;
  };
  return value.options?.unique ?? value.unique;
}

function getIndexWhere(index: unknown) {
  const value = index as {
    options?: { where?: string };
    where?: string;
  };
  return value.options?.where ?? value.where;
}
