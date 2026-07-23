export type SmtpPayload = {
  fromAddress?: string | null;
  host?: string;
  isValidated?: boolean;
  password?: string | null;
  port?: number;
  secure?: boolean;
  username?: string | null;
};

export type EmailTemplatePayload = {
  description?: string | null;
  hbs?: string;
  isSystem?: boolean;
  languageCode?: string;
  mjml?: string | null;
  name?: string;
  subject?: string | null;
};

export type EmailTemplatePreviewPayload = {
  hbs?: string;
  subject?: string | null;
};

export type EmailLogPayload = {
  content?: string | null;
  email?: string;
  isArchived?: boolean;
  status?: "queued" | "sent" | "failed" | "skipped";
  subject?: string | null;
  templateName?: string | null;
};
