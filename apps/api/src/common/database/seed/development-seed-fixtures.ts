import { createHash } from "node:crypto";
import {
  EmailTemplate,
  IntegrationToken,
  Invite,
  Role,
  Ticket,
  Account,
  UserNotification,
  WorkspaceMembership,
  type AccountStatus,
} from "@hermes-swarm/core";
import type { EntityManager } from "typeorm";
import { hashPassword } from "../../security/password-hash.js";

export type DevelopmentFixtureRoles = {
  workspaceAdmin: Role;
  workspaceMember: Role;
  workspaceOwner: Role;
};

export type DevelopmentFixtureCounts = {
  emailTemplates: number;
  integrationTokens: number;
  invites: number;
  notifications: number;
  tickets: number;
  users: number;
};

export type DevelopmentFixtureResult = {
  counts: DevelopmentFixtureCounts;
};

type FixtureContext = {
  manager: EntityManager;
  owner: Account;
  ownerPassword: string;
  roles: DevelopmentFixtureRoles;
  workspaceId: string;
};

export const DEVELOPMENT_FIXTURE_SCENARIOS = Object.freeze({
  ticketStatuses: ["open", "closed", "archived"],
  userStates: ["active", "disabled"],
});

export async function seedDevelopmentFixtures(
  context: FixtureContext,
): Promise<DevelopmentFixtureResult> {
  const { manager, owner, ownerPassword, roles, workspaceId } = context;
  const administrator = await ensureUser(manager, {
    displayName: "工作空间管理员",
    email: "workspace-admin@hermes.local",
    password: ownerPassword,
    status: "active",
    workspaceId,
  });
  const engineer = await ensureUser(manager, {
    displayName: "平台工程师",
    email: "engineer@hermes.local",
    password: ownerPassword,
    status: "active",
    workspaceId,
  });
  const supportAgent = await ensureUser(manager, {
    displayName: "客户支持专员",
    email: "support@hermes.local",
    password: ownerPassword,
    status: "active",
    workspaceId,
  });
  await ensureUser(manager, {
    displayName: "已停用成员",
    email: "disabled@hermes.local",
    password: ownerPassword,
    status: "disabled",
    workspaceId,
  });

  await ensureWorkspaceRole(
    manager,
    workspaceId,
    administrator.id,
    roles.workspaceAdmin.id,
  );
  await ensureWorkspaceRole(
    manager,
    workspaceId,
    engineer.id,
    roles.workspaceMember.id,
  );
  await ensureWorkspaceRole(
    manager,
    workspaceId,
    supportAgent.id,
    roles.workspaceMember.id,
  );

  const tickets = [
    await ensureTicket(manager, {
      requesterUserId: engineer.id,
      status: "open",
      subject: "Engineering workspace access",
      workspaceId,
    }),
    await ensureTicket(manager, {
      requesterUserId: supportAgent.id,
      status: "closed",
      subject: "Customer notification delivery",
      workspaceId,
    }),
    await ensureTicket(manager, {
      requesterUserId: supportAgent.id,
      status: "archived",
      subject: "Archived email template issue",
      workspaceId,
    }),
  ];

  await ensureNotification(manager, {
    body: "A development ticket is ready for review.",
    recipientUserId: administrator.id,
    sourceId: tickets[0].id,
    workspaceId,
    title: "工单待处理",
  });
  await ensureTemplate(manager, workspaceId, "workspace-invite", "zh-CN");
  await ensureTemplate(manager, workspaceId, "password-reset", "zh-CN");
  await ensureInvite(
    manager,
    workspaceId,
    "invited@hermes.local",
    owner.id,
    roles.workspaceMember.id,
  );
  await ensureInactiveToken(manager, workspaceId, owner.id, "revoked");
  await ensureInactiveToken(manager, workspaceId, owner.id, "expired");

  return {
    counts: {
      emailTemplates: 2,
      integrationTokens: 2,
      invites: 1,
      notifications: 1,
      tickets: 3,
      users: 5,
    },
  };
}

async function ensureUser(
  manager: EntityManager,
  input: {
    displayName: string;
    email: string;
    password: string;
  status: AccountStatus;
    workspaceId: string;
  },
) {
  let entity = await manager.findOne(Account, {
    where: { email: input.email },
    withDeleted: true,
  });
  entity ??= manager.create(Account, {
    email: input.email,
  });
  Object.assign(entity, {
    deletedAt: null,
    displayName: input.displayName,
    emailVerified: true,
    passwordHash: await hashPassword(input.password),
    preferredLanguage: "zh-CN",
    status: input.status,
    type: "user",
  });
  return manager.save(Account, entity);
}

async function ensureWorkspaceRole(
  manager: EntityManager,
  workspaceId: string,
  userId: string,
  roleId: string,
) {
  await manager.upsert(
    WorkspaceMembership,
    {
      accountId: userId,
      removedAt: null,
      roleId,
      status: "active",
      workspaceId,
    },
    ["workspaceId", "accountId"],
  );
}

async function ensureTicket(
  manager: EntityManager,
  input: {
    requesterUserId: string;
    status: "open" | "closed" | "archived";
    subject: string;
    workspaceId: string;
  },
) {
  let entity = await manager.findOne(Ticket, {
    where: { subject: input.subject, workspaceId: input.workspaceId },
  });
  entity ??= manager.create(Ticket, {
    participantUserIds: [input.requesterUserId],
    requesterUserId: input.requesterUserId,
    subject: input.subject,
    workspaceId: input.workspaceId,
  });
  Object.assign(entity, {
    archivedAt:
      input.status === "archived"
        ? new Date("2026-01-20T09:00:00.000Z")
        : null,
    status: input.status,
  });
  return manager.save(Ticket, entity);
}

async function ensureNotification(
  manager: EntityManager,
  input: {
    body: string;
    recipientUserId: string;
    sourceId: string;
    workspaceId: string;
    title: string;
  },
) {
  let entity = await manager.findOne(UserNotification, {
    where: {
      recipientUserId: input.recipientUserId,
      sourceId: input.sourceId,
      workspaceId: input.workspaceId,
    },
  });
  entity ??= manager.create(UserNotification, {
    kind: "info",
    recipientUserId: input.recipientUserId,
    sourceId: input.sourceId,
    sourceType: "ticket",
    status: "unread",
    workspaceId: input.workspaceId,
    title: input.title,
  });
  entity.body = input.body;
  return manager.save(UserNotification, entity);
}

async function ensureTemplate(
  manager: EntityManager,
  workspaceId: string,
  name: string,
  languageCode: string,
) {
  let entity = await manager.findOne(EmailTemplate, {
    where: { languageCode, name, workspaceId },
  });
  entity ??= manager.create(EmailTemplate, { languageCode, name, workspaceId });
  Object.assign(entity, {
    description: `Workspace ${name} template`,
    hbs: "<p>{{workspaceName}}</p><p><a href=\"{{actionLink}}\">继续</a></p>",
    isSystem: true,
    subject: "{{workspaceName}}",
  });
  return manager.save(EmailTemplate, entity);
}

async function ensureInvite(
  manager: EntityManager,
  workspaceId: string,
  email: string,
  invitedById: string,
  workspaceRoleId: string,
) {
  let entity = await manager.findOne(Invite, {
    where: { email, status: "invited", workspaceId },
  });
  entity ??= manager.create(Invite, {
    email,
    status: "invited",
    workspaceId,
    token: `dev-invite-${createHash("sha256")
      .update(`${workspaceId}:${email}`)
      .digest("hex")}`,
  });
  entity.invitedById = invitedById;
  entity.workspaceRoleId = workspaceRoleId;
  return manager.save(Invite, entity);
}

async function ensureInactiveToken(
  manager: EntityManager,
  workspaceId: string,
  ownerUserId: string,
  state: "expired" | "revoked",
) {
  const tokenHash = createHash("sha256")
    .update(`${workspaceId}:${state}`)
    .digest("hex");
  let entity = await manager.findOne(IntegrationToken, { where: { tokenHash } });
  entity ??= manager.create(IntegrationToken, {
    expiresAt:
      state === "expired"
        ? new Date("2025-01-01T00:00:00.000Z")
        : new Date("2030-01-01T00:00:00.000Z"),
    note: `Development ${state} token`,
    ownerUserId,
    permissions: [],
    scope: "workspace",
    tokenHash,
    tokenPrefix: `dev_${state}`,
    workspaceId,
  });
  entity.revokedAt =
    state === "revoked" ? new Date("2026-01-20T00:00:00.000Z") : null;
  entity.revokedReason = state === "revoked" ? "development-fixture" : null;
  return manager.save(IntegrationToken, entity);
}
