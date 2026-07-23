import type { EmailTemplatePayload } from "./mail.types.js";

export const DEFAULT_WORKSPACE_EMAIL_TEMPLATES = [
  {
    description: "发送给被邀请加入工作空间的用户。",
    hbs: [
      "<p>{{workspaceName}} 邀请你加入工作空间。</p>",
      "<p><a href=\"{{inviteLink}}\">打开邀请链接</a></p>",
      "<p>有效期：{{expiresAt}}</p>",
    ].join("\n"),
    languageCode: "zh-CN",
    mjml: null,
    name: "workspace-invite",
    subject: "邀请加入 {{workspaceName}}",
  },
  {
    description: "发送给请求重置密码的用户。",
    hbs: [
      "<p>你正在重置 Hermes Swarm 账号密码。</p>",
      "<p><a href=\"{{resetLink}}\">打开重置密码链接</a></p>",
      "<p>该链接将在 {{expiresIn}} 后失效。</p>",
    ].join("\n"),
    languageCode: "zh-CN",
    mjml: null,
    name: "password-reset",
    subject: "重置密码",
  },
  {
    description: "Sent to users invited to join a workspace.",
    hbs: [
      "<p>{{workspaceName}} invited you to join the workspace.</p>",
      "<p><a href=\"{{inviteLink}}\">Open invitation</a></p>",
      "<p>Expires at: {{expiresAt}}</p>",
    ].join("\n"),
    languageCode: "en",
    mjml: null,
    name: "workspace-invite",
    subject: "Invitation to join {{workspaceName}}",
  },
  {
    description: "Sent to users who request a password reset.",
    hbs: [
      "<p>You requested a password reset for your Hermes Swarm account.</p>",
      "<p><a href=\"{{resetLink}}\">Reset password</a></p>",
      "<p>This link expires in {{expiresIn}}.</p>",
    ].join("\n"),
    languageCode: "en",
    mjml: null,
    name: "password-reset",
    subject: "Reset your password",
  },
] satisfies EmailTemplatePayload[];

const DEFAULT_CONTROL_PLANE_EMAIL_TEMPLATES = [
  {
    description: "发送给新平台成员的账号邀请邮件。",
    hbs: [
      "<p>你好：</p>",
      "<p>你已受邀加入 Hermes Swarm 平台控制台。</p>",
      "<p><a href=\"{{inviteLink}}\">接受邀请并创建账号</a></p>",
      "<p>邀请有效期至 {{expiresAt}}。</p>",
    ].join("\n"),
    languageCode: "zh-CN",
    mjml: null,
    name: "platform-invite",
    subject: "加入 Hermes Swarm 平台控制台",
  },
  {
    description: "Sent to new platform members to create their account.",
    hbs: [
      "<p>Hello,</p>",
      "<p>You have been invited to the Hermes Swarm platform console.</p>",
      "<p><a href=\"{{inviteLink}}\">Accept the invitation and create your account</a></p>",
      "<p>This invitation is valid until {{expiresAt}}.</p>",
    ].join("\n"),
    languageCode: "en",
    mjml: null,
    name: "platform-invite",
    subject: "Join the Hermes Swarm platform console",
  },
  {
    description: "发送给工作空间申请人的邮箱验证邮件。",
    hbs: [
      "<p>{{ownerDisplayName}}，你好：</p>",
      "<p>请验证邮箱，以继续申请工作空间 {{requestedName}}。</p>",
      "<p><a href=\"{{verificationLink}}\">验证邮箱</a></p>",
      "<p>如果不再申请，可<a href=\"{{cancellationLink}}\">取消申请</a>。</p>",
    ].join("\n"),
    languageCode: "zh-CN",
    mjml: null,
    name: "workspace-application-verification",
    subject: "验证邮箱以继续申请 {{requestedName}}",
  },
  {
    description: "Sent to workspace applicants to verify their email address.",
    hbs: [
      "<p>Hello {{ownerDisplayName}},</p>",
      "<p>Verify your email to continue the application for {{requestedName}}.</p>",
      "<p><a href=\"{{verificationLink}}\">Verify email</a></p>",
      "<p>If you no longer wish to apply, <a href=\"{{cancellationLink}}\">cancel the application</a>.</p>",
    ].join("\n"),
    languageCode: "en",
    mjml: null,
    name: "workspace-application-verification",
    subject: "Verify your email for {{requestedName}}",
  },
  {
    description: "工作空间获批后发送给 Owner 的账号激活邮件。",
    hbs: [
      "<p>{{ownerDisplayName}}，你好：</p>",
      "<p>工作空间 {{workspaceName}} 已获批准。</p>",
      "<p><a href=\"{{activationLink}}\">设置密码并激活工作空间</a></p>",
      "<p>激活链接将在 {{expiresIn}} 后失效。</p>",
    ].join("\n"),
    languageCode: "zh-CN",
    mjml: null,
    name: "workspace-owner-activation",
    subject: "激活工作空间 {{workspaceName}}",
  },
  {
    description: "Sent to the owner after a workspace application is approved.",
    hbs: [
      "<p>Hello {{ownerDisplayName}},</p>",
      "<p>Your workspace {{workspaceName}} has been approved.</p>",
      "<p><a href=\"{{activationLink}}\">Set a password and activate the workspace</a></p>",
      "<p>This activation link expires in {{expiresIn}}.</p>",
    ].join("\n"),
    languageCode: "en",
    mjml: null,
    name: "workspace-owner-activation",
    subject: "Activate {{workspaceName}}",
  },
] satisfies EmailTemplatePayload[];

export const DEFAULT_PLATFORM_EMAIL_TEMPLATES = [
  ...DEFAULT_WORKSPACE_EMAIL_TEMPLATES,
  ...DEFAULT_CONTROL_PLANE_EMAIL_TEMPLATES,
];

export function isWorkspaceMailTemplate(name: string) {
  return DEFAULT_WORKSPACE_EMAIL_TEMPLATES.some(
    (definition) => definition.name === name,
  );
}

export const EMAIL_TEMPLATE_PREVIEW_LOCALS = {
  email: "alex@example.com",
  expiresAt: "2026-07-18 18:00",
  expiresIn: "30 minutes",
  inviteLink: "https://app.hermes.local/invitations/example",
  name: "Alex Chen",
  ownerDisplayName: "Alex Chen",
  requestedName: "Hermes Development",
  resetLink: "https://app.hermes.local/reset-password/example",
  verificationLink: "https://app.hermes.local/apply?applicationId=example&token=example",
  cancellationLink: "https://app.hermes.local/apply?applicationId=example&cancelToken=example",
  activationLink: "https://app.hermes.local/reset-password?email=alex%40example.com&token=example",
  workspaceName: "Hermes Development",
};
