import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";
import { EmailSendService } from "./email-send.service.js";
import { MailService } from "./mail.service.js";

describe("MailService templates", () => {
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
});

function createMailService() {
  const emailTemplates: any[] = [];
  const smtpTemplates: any[] = [];
  const emailLogs: any[] = [];

  const service = new MailService(
    createRepository(smtpTemplates) as any,
    createRepository(emailTemplates) as any,
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

function createRepository(records: any[]) {
  return {
    create(value: any) {
      return {
        createdAt: new Date("2026-01-01T00:00:00Z"),
        id: `${records.length + 1}`,
        updatedAt: new Date("2026-01-01T00:00:00Z"),
        ...value,
      };
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
      const next = { ...record, id: record.id ?? `${records.length + 1}` };
      const index = records.findIndex((item) => item.id === next.id);
      if (index >= 0) {
        records[index] = next;
      } else {
        records.push(next);
      }
      return next;
    },
  };
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
