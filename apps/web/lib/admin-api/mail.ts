import type { AuthenticatedAdminSessionMarker } from "@/lib/authenticated-admin";
import type { EmailTemplateDto, SmtpConfig } from "@hermes-swarm/api-contracts";
import { fetchAdmin } from "./client";

export function getSmtpConfig(session: AuthenticatedAdminSessionMarker) {
  return fetchAdmin<SmtpConfig | null>("/workspace/mail/smtp", {});
}

export function saveSmtpConfig(
  session: AuthenticatedAdminSessionMarker,
  payload: {
    fromAddress?: string | null;
    host?: string;
    isValidated?: boolean;
    password?: string | null;
    port?: number;
    secure?: boolean;
    username?: string | null;
  },
) {
  return fetchAdmin<SmtpConfig>("/workspace/mail/smtp", {
    body: payload,
    method: "PUT",
  });
}

export function validateSmtpConfig(
  session: AuthenticatedAdminSessionMarker,
  payload: {
    fromAddress?: string | null;
    host?: string;
    password?: string | null;
    port?: number;
    secure?: boolean;
    username?: string | null;
  },
) {
  return fetchAdmin<{ ok: boolean }>("/workspace/mail/smtp/validate", {
    body: payload,
    method: "POST",
  });
}

export function getPlatformSmtpConfig(session: AuthenticatedAdminSessionMarker) {
  return fetchAdmin<SmtpConfig | null>("/platform/mail/smtp", {});
}

export function savePlatformSmtpConfig(
  session: AuthenticatedAdminSessionMarker,
  payload: {
    fromAddress?: string | null;
    host?: string;
    isValidated?: boolean;
    password?: string | null;
    port?: number;
    secure?: boolean;
    username?: string | null;
  },
) {
  return fetchAdmin<SmtpConfig>("/platform/mail/smtp", {
    body: payload,
    method: "PATCH",
  });
}

export function validatePlatformSmtpConfig(
  session: AuthenticatedAdminSessionMarker,
  payload: {
    fromAddress?: string | null;
    host?: string;
    password?: string | null;
    port?: number;
    secure?: boolean;
    username?: string | null;
  },
) {
  return fetchAdmin<{ ok: boolean }>("/platform/mail/smtp/validate", {
    body: payload,
    method: "POST",
  });
}

export function listEmailTemplates(session: AuthenticatedAdminSessionMarker) {
  return fetchAdmin<EmailTemplateDto[]>("/workspace/mail/templates", {});
}

export function createEmailTemplate(
  session: AuthenticatedAdminSessionMarker,
  payload: {
    description?: string | null;
    hbs: string;
    languageCode: string;
    mjml?: string | null;
    name: string;
    subject?: string | null;
  },
) {
  return fetchAdmin<EmailTemplateDto>("/workspace/mail/templates", {
    body: payload,
    method: "POST",
  });
}

export function updateEmailTemplate(
  session: AuthenticatedAdminSessionMarker,
  templateId: string,
  payload: Partial<{
    description: string | null;
    hbs: string;
    languageCode: string;
    mjml: string | null;
    name: string;
    subject: string | null;
  }>,
) {
  return fetchAdmin<EmailTemplateDto>(
    `/workspace/mail/templates/${templateId}`,
    { body: payload, method: "PATCH" },
  );
}

export function deleteEmailTemplate(
  session: AuthenticatedAdminSessionMarker,
  templateId: string,
) {
  return fetchAdmin<void>(`/workspace/mail/templates/${templateId}`, {
    method: "DELETE",
  });
}

export function previewEmailTemplate(
  session: AuthenticatedAdminSessionMarker,
  payload: { hbs: string; subject?: string | null },
  scope: "platform" | "workspace" = "workspace",
) {
  const path = scope === "platform"
    ? "/platform/mail/templates/preview"
    : "/workspace/mail/templates/preview";
  return fetchAdmin<{ html: string; subject: string }>(path, {
    body: payload,
    method: "POST",
  });
}

export function listPlatformEmailTemplates(session: AuthenticatedAdminSessionMarker) {
  return fetchAdmin<EmailTemplateDto[]>("/platform/mail/templates", {});
}

export function createPlatformEmailTemplate(
  session: AuthenticatedAdminSessionMarker,
  payload: {
    description?: string | null;
    hbs?: string;
    languageCode?: string;
    mjml?: string | null;
    name?: string;
    subject?: string | null;
  },
) {
  return fetchAdmin<EmailTemplateDto>("/platform/mail/templates", {
    body: payload,
    method: "POST",
  });
}

export function updatePlatformEmailTemplate(
  session: AuthenticatedAdminSessionMarker,
  templateId: string,
  payload: Partial<{
    description: string | null;
    hbs: string;
    languageCode: string;
    mjml: string | null;
    name: string;
    subject: string | null;
  }>,
) {
  return fetchAdmin<EmailTemplateDto>(
    `/platform/mail/templates/${templateId}`,
    { body: payload, method: "PATCH" },
  );
}

export function deletePlatformEmailTemplate(
  session: AuthenticatedAdminSessionMarker,
  templateId: string,
) {
  return fetchAdmin<void>(`/platform/mail/templates/${templateId}`, {
    method: "DELETE",
  });
}
