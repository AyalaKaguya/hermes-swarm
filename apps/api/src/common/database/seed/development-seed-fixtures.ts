import { createHash } from "node:crypto";
import {
  EmailTemplate,
  IntegrationToken,
  Invite,
  Organization,
  Role,
  RolePermission,
  Ticket,
  User,
  UserNotification,
  UserOrganization,
  UserOrganizationRole,
  UserTenantRole,
  type UserStatus,
} from "@hermes-swarm/core";
import type { EntityManager } from "typeorm";
import { hashPassword } from "../../security/password-hash.js";

export type DevelopmentFixtureRoles = {
  organizationAdmin: Role;
  organizationMember: Role;
  organizationOwner: Role;
  organizationViewer: Role;
  tenantAdmin: Role;
  tenantMember: Role;
  tenantOwner: Role;
};

export type DevelopmentFixtureCounts = {
  emailTemplates: number;
  integrationTokens: number;
  invites: number;
  memberships: number;
  notifications: number;
  organizations: number;
  tickets: number;
  users: number;
};

export type DevelopmentFixtureResult = {
  counts: DevelopmentFixtureCounts;
};

type FixtureContext = {
  manager: EntityManager;
  organization: Organization;
  owner: User;
  ownerPassword: string;
  roles: DevelopmentFixtureRoles;
  tenantId: string;
};

export const DEVELOPMENT_FIXTURE_SCENARIOS = Object.freeze({
  organizationTree: ["root", "engineering", "support"],
  ticketStatuses: ["open", "closed", "archived"],
  userStates: ["active", "disabled", "multi-organization"],
});

export async function seedDevelopmentFixtures(
  context: FixtureContext,
): Promise<DevelopmentFixtureResult> {
  const { manager, organization: root, owner, ownerPassword, roles, tenantId } = context;
  const engineering = await ensureOrganization(manager, {
    createdByUserId: owner.id,
    name: "Engineering",
    parentOrganizationId: root.id,
    slug: "engineering",
    tenantId,
  });
  const support = await ensureOrganization(manager, {
    createdByUserId: owner.id,
    name: "Customer Support",
    parentOrganizationId: root.id,
    slug: "customer-support",
    tenantId,
  });
  const engineeringRoles = await ensureOrganizationRoleSet(
    manager,
    tenantId,
    engineering.id,
    roles,
  );
  const supportRoles = await ensureOrganizationRoleSet(
    manager,
    tenantId,
    support.id,
    roles,
  );

  const orgAdmin = await ensureUser(manager, {
    displayName: "工作空间管理员",
    email: "org-admin@hermes.local",
    password: ownerPassword,
    status: "active",
    tenantId,
  });
  const engineer = await ensureUser(manager, {
    displayName: "平台工程师",
    email: "engineer@hermes.local",
    password: ownerPassword,
    status: "active",
    tenantId,
  });
  const supportAgent = await ensureUser(manager, {
    displayName: "客户支持专员",
    email: "support@hermes.local",
    password: ownerPassword,
    status: "active",
    tenantId,
  });
  const disabled = await ensureUser(manager, {
    displayName: "已停用用户",
    email: "disabled@hermes.local",
    password: ownerPassword,
    status: "disabled",
    tenantId,
  });

  await ensureTenantRole(manager, tenantId, orgAdmin.id, roles.tenantAdmin.id);
  await ensureTenantRole(manager, tenantId, engineer.id, roles.tenantMember.id);
  await ensureTenantRole(manager, tenantId, supportAgent.id, roles.tenantMember.id);

  const ownerMembership = await ensureMembership(manager, {
    isDefault: true,
    organizationId: root.id,
    status: "active",
    tenantId,
    user: owner,
  });
  const adminMembership = await ensureMembership(manager, {
    isDefault: true,
    organizationId: root.id,
    status: "active",
    tenantId,
    user: orgAdmin,
  });
  const engineerRootMembership = await ensureMembership(manager, {
    isDefault: false,
    organizationId: root.id,
    status: "active",
    tenantId,
    user: engineer,
  });
  const engineerMembership = await ensureMembership(manager, {
    isDefault: true,
    organizationId: engineering.id,
    status: "active",
    tenantId,
    user: engineer,
  });
  const supportMembership = await ensureMembership(manager, {
    isDefault: true,
    organizationId: support.id,
    status: "active",
    tenantId,
    user: supportAgent,
  });
  await ensureMembership(manager, {
    isDefault: true,
    organizationId: support.id,
    status: "disabled",
    tenantId,
    user: disabled,
  });

  await ensureOrganizationRole(manager, tenantId, root.id, ownerMembership.id, roles.organizationOwner.id);
  await ensureOrganizationRole(manager, tenantId, root.id, adminMembership.id, roles.organizationAdmin.id);
  await ensureOrganizationRole(manager, tenantId, root.id, engineerRootMembership.id, roles.organizationViewer.id);
  await ensureOrganizationRole(manager, tenantId, engineering.id, engineerMembership.id, engineeringRoles.organizationMember.id);
  await ensureOrganizationRole(manager, tenantId, support.id, supportMembership.id, supportRoles.organizationMember.id);

  const tickets = [
    await ensureTicket(manager, {
      organizationId: engineering.id,
      requesterUserId: engineer.id,
      status: "open",
      subject: "Engineering workspace access",
      tenantId,
    }),
    await ensureTicket(manager, {
      organizationId: support.id,
      requesterUserId: supportAgent.id,
      status: "closed",
      subject: "Customer notification delivery",
      tenantId,
    }),
    await ensureTicket(manager, {
      organizationId: support.id,
      requesterUserId: supportAgent.id,
      status: "archived",
      subject: "Archived email template issue",
      tenantId,
    }),
  ];

  await ensureNotification(manager, {
    body: "A development ticket is ready for review.",
    recipientUserId: orgAdmin.id,
    sourceId: tickets[0].id,
    tenantId,
    title: "工单待处理",
  });
  await ensureTemplate(manager, tenantId, "organization-invite", "zh-CN");
  await ensureTemplate(manager, tenantId, "password-reset", "zh-CN");
  await ensureInvite(
    manager,
    tenantId,
    "invited@hermes.local",
    support.id,
    supportRoles.organizationMember.id,
    roles.tenantMember.id,
  );
  await ensureInactiveToken(manager, tenantId, owner.id, "revoked");
  await ensureInactiveToken(manager, tenantId, owner.id, "expired");

  return {
    counts: {
      emailTemplates: 2,
      integrationTokens: 2,
      invites: 1,
      memberships: 6,
      notifications: 1,
      organizations: 3,
      tickets: 3,
      users: 5,
    },
  };
}

async function ensureOrganization(
  manager: EntityManager,
  input: {
    createdByUserId: string;
    name: string;
    parentOrganizationId: string;
    slug: string;
    tenantId: string;
  },
) {
  let entity = await manager.findOne(Organization, {
    where: { slug: input.slug, tenantId: input.tenantId },
    withDeleted: true,
  });
  entity ??= manager.create(Organization, input);
  Object.assign(entity, { ...input, deletedAt: null, status: "active" });
  return manager.save(Organization, entity);
}

async function ensureUser(
  manager: EntityManager,
  input: {
    displayName: string;
    email: string;
    password: string;
    status: UserStatus;
    tenantId: string;
  },
) {
  let entity = await manager.findOne(User, {
    where: { email: input.email, tenantId: input.tenantId },
    withDeleted: true,
  });
  entity ??= manager.create(User, { email: input.email, tenantId: input.tenantId });
  Object.assign(entity, {
    deletedAt: null,
    displayName: input.displayName,
    emailVerified: true,
    passwordHash: await hashPassword(input.password),
    preferredLanguage: "zh-CN",
    status: input.status,
    type: "user",
  });
  return manager.save(User, entity);
}

async function ensureMembership(
  manager: EntityManager,
  input: {
    isDefault: boolean;
    organizationId: string;
    status: "active" | "disabled";
    tenantId: string;
    user: User;
  },
) {
  let entity = await manager.findOne(UserOrganization, {
    where: {
      organizationId: input.organizationId,
      tenantId: input.tenantId,
      userId: input.user.id,
    },
  });
  entity ??= manager.create(UserOrganization, {
    organizationId: input.organizationId,
    tenantId: input.tenantId,
    userId: input.user.id,
  });
  Object.assign(entity, {
    displayName: input.user.displayName,
    isDefault: input.isDefault,
    joinedAt: entity.joinedAt ?? new Date("2026-01-16T09:00:00.000Z"),
    status: input.status,
  });
  return manager.save(UserOrganization, entity);
}

async function ensureTenantRole(
  manager: EntityManager,
  tenantId: string,
  userId: string,
  roleId: string,
) {
  await manager.delete(UserTenantRole, { tenantId, userId });
  await manager.save(UserTenantRole, { roleId, tenantId, userId });
}

async function ensureOrganizationRole(
  manager: EntityManager,
  tenantId: string,
  organizationId: string,
  membershipId: string,
  roleId: string,
) {
  await manager.delete(UserOrganizationRole, { membershipId, tenantId });
  await manager.save(UserOrganizationRole, {
    membershipId,
    organizationId,
    roleId,
    tenantId,
  });
}

async function ensureOrganizationRoleSet(
  manager: EntityManager,
  tenantId: string,
  organizationId: string,
  templates: DevelopmentFixtureRoles,
) {
  const entries = [
    ["organizationOwner", templates.organizationOwner],
    ["organizationAdmin", templates.organizationAdmin],
    ["organizationMember", templates.organizationMember],
    ["organizationViewer", templates.organizationViewer],
  ] as const;
  const result = {} as Pick<DevelopmentFixtureRoles,
    "organizationOwner" | "organizationAdmin" | "organizationMember" | "organizationViewer">;
  for (const [key, template] of entries) {
    let role = await manager.findOne(Role, {
      where: { name: template.name, organizationId, tenantId },
    });
    role ??= await manager.save(Role, manager.create(Role, {
      color: template.color,
      description: template.description,
      displayName: template.displayName,
      isSystem: true,
      label: template.label,
      name: template.name,
      organizationId,
      scope: "organization",
      tenantId,
    }));
    const templatePermissions = await manager.find(RolePermission, {
      where: { roleId: template.id, tenantId },
    });
    await manager.delete(RolePermission, { roleId: role.id, tenantId });
    for (const permission of templatePermissions) {
      await manager.save(RolePermission, manager.create(RolePermission, {
        enabled: permission.enabled,
        permission: permission.permission,
        permissionId: permission.permissionId,
        roleId: role.id,
        tenantId,
      }));
    }
    result[key] = role;
  }
  return result;
}

async function ensureTicket(
  manager: EntityManager,
  input: {
    organizationId: string;
    requesterUserId: string;
    status: "open" | "closed" | "archived";
    subject: string;
    tenantId: string;
  },
) {
  let entity = await manager.findOne(Ticket, {
    where: { subject: input.subject, tenantId: input.tenantId },
  });
  entity ??= manager.create(Ticket, {
    participantUserIds: [input.requesterUserId],
    requesterUserId: input.requesterUserId,
    sourceOrganizationId: input.organizationId,
    subject: input.subject,
    tenantId: input.tenantId,
  });
  Object.assign(entity, {
    archivedAt: input.status === "archived" ? new Date("2026-01-20T09:00:00.000Z") : null,
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
    tenantId: string;
    title: string;
  },
) {
  let entity = await manager.findOne(UserNotification, {
    where: { recipientUserId: input.recipientUserId, sourceId: input.sourceId, tenantId: input.tenantId },
  });
  entity ??= manager.create(UserNotification, {
    kind: "info",
    recipientUserId: input.recipientUserId,
    sourceId: input.sourceId,
    sourceType: "ticket",
    status: "unread",
    tenantId: input.tenantId,
    title: input.title,
  });
  entity.body = input.body;
  return manager.save(UserNotification, entity);
}

async function ensureTemplate(
  manager: EntityManager,
  tenantId: string,
  name: string,
  languageCode: string,
) {
  let entity = await manager.findOne(EmailTemplate, {
    where: { languageCode, name, tenantId },
  });
  entity ??= manager.create(EmailTemplate, { languageCode, name, tenantId });
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
  tenantId: string,
  email: string,
  organizationId: string,
  roleId: string,
  workspaceRoleId: string,
) {
  let entity = await manager.findOne(Invite, {
    where: { email, status: "invited", tenantId },
  });
  entity ??= manager.create(Invite, {
    email,
    status: "invited",
    tenantId,
    token: `dev-invite-${createHash("sha256").update(`${tenantId}:${email}`).digest("hex")}`,
  });
  entity.organizationAssignments = [{ isDefault: true, organizationId, roleId }];
  entity.workspaceRoleId = workspaceRoleId;
  return manager.save(Invite, entity);
}

async function ensureInactiveToken(
  manager: EntityManager,
  tenantId: string,
  ownerUserId: string,
  state: "expired" | "revoked",
) {
  const tokenHash = createHash("sha256").update(`${tenantId}:${state}`).digest("hex");
  let entity = await manager.findOne(IntegrationToken, { where: { tokenHash } });
  entity ??= manager.create(IntegrationToken, {
    expiresAt:
      state === "expired"
        ? new Date("2025-01-01T00:00:00.000Z")
        : new Date("2030-01-01T00:00:00.000Z"),
    note: `Development ${state} token`,
    ownerUserId,
    permissions: [],
    scope: "tenant",
    tenantId,
    tokenHash,
    tokenPrefix: `dev_${state}`,
  });
  entity.revokedAt = state === "revoked" ? new Date("2026-01-20T00:00:00.000Z") : null;
  entity.revokedReason = state === "revoked" ? "development-fixture" : null;
  return manager.save(IntegrationToken, entity);
}
