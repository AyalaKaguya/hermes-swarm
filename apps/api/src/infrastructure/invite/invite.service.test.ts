import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";
import { hashPassword } from "../../common/security/password-hash.js";
import { InviteService } from "./invite.service.js";

const ORGANIZATION_ID = "org-1";
const INVITER_ID = "user-inviter";
const ROLE_ID = "role-member";
const TENANT_ID = "tenant-1";

describe("InviteService", () => {
  it("rejects malformed invite payloads with controlled errors", async () => {
    const state = createInviteService();

    await assert.rejects(
      () =>
        state.service.createBulkForOrganization(
          ORGANIZATION_ID,
          INVITER_ID,
          null as any,
        ),
      { message: "请求内容无效" },
    );
    await assert.rejects(
      () =>
        state.service.createBulkForOrganization(
          ORGANIZATION_ID,
          INVITER_ID,
          { emailIds: "member@example.com" } as any,
        ),
      { message: "邮箱列表无效" },
    );
    await assert.rejects(
      () =>
        state.service.createBulkForOrganization(
          ORGANIZATION_ID,
          INVITER_ID,
          { emailIds: [42] } as any,
        ),
      { message: "邮箱格式不正确" },
    );
    await assert.rejects(
      () =>
        state.service.createBulkForOrganization(
          ORGANIZATION_ID,
          INVITER_ID,
          { emailIds: ["member@example.com"], expiresIn: "soon" as any },
        ),
      { message: "邀请有效期无效" },
    );
    await assert.rejects(
      () => state.service.accept(null as any),
      { message: "请求内容无效" },
    );
    await assert.rejects(
      () => state.service.accept({ action: "archive" } as any),
      { message: "邀请操作无效" },
    );
  });

  it("deduplicates normalized invite emails while reporting ignored originals", async () => {
    const state = createInviteService();

    const created = await state.service.createBulkForOrganization(
      ORGANIZATION_ID,
      INVITER_ID,
      {
        emailIds: [" Member@Example.com ", "member@example.com"],
        expiresIn: "3d",
        roleId: ROLE_ID,
      },
    );

    assert.equal(created.total, 1);
    assert.equal(created.ignored, 1);
    assert.equal(created.items[0].email, "member@example.com");
    assert.equal(state.invites.length, 1);
    assert.equal(state.sentEmails.length, 1);
  });

  it("creates reusable public invite links and keeps counting accepted users", async () => {
    const state = createInviteService();

    const created = await state.service.createBulkForOrganization(
      ORGANIZATION_ID,
      INVITER_ID,
      { emailIds: [], expiresIn: "7d", roleId: ROLE_ID },
    );

    assert.equal(created.total, 1);
    assert.equal(created.items[0].email, null);
    assert.equal(created.items[0].acceptedCount, 0);
    assert.ok(created.items[0].link?.includes("token="));
    assert.equal(created.items[0].link?.includes("email="), false);
    assert.equal(state.sentEmails.length, 0);
    assert.equal(state.notifications.length, 0);

    const token = tokenFromLink(created.items[0].link);
    const validated = await state.service.validateByToken(undefined, token);
    assert.equal(validated.organization?.id, ORGANIZATION_ID);
    assert.equal(validated.email, null);

    const accepted = await state.service.accept({
      action: "accept",
      displayName: "External User",
      email: "external@example.com",
      password: "password-123",
      token,
    });

    assert.equal(accepted.status, "invited");
    assert.equal(accepted.acceptedCount, 1);
    assert.equal(state.memberships.length, 1);
    assert.equal(state.memberships[0].userId, "user-2");
    assert.equal(state.memberships[0].roleId, ROLE_ID);
    assert.equal(state.notifications.at(-1)?.recipientUserId, "user-2");
  });

  it("sends email and in-app notification for directed invites to existing users", async () => {
    const state = createInviteService({
      users: [
        userRecord({
          email: "member@example.com",
          id: "user-member",
          passwordHash: hashPassword("current-password"),
        }),
      ],
    });

    const created = await state.service.createBulkForOrganization(
      ORGANIZATION_ID,
      INVITER_ID,
      { emailIds: [" Member@Example.com "], expiresIn: "3d", roleId: ROLE_ID },
    );

    assert.equal(created.total, 1);
    assert.equal(created.items[0].email, "member@example.com");
    assert.equal(created.items[0].existingUser, true);
    assert.ok(created.items[0].link?.includes("email=member%40example.com"));
    assert.equal(state.sentEmails.length, 1);
    assert.equal(state.sentEmails[0].email, "member@example.com");
    assert.equal(state.notifications.length, 1);
    assert.equal(state.notifications[0].recipientUserId, "user-member");

    const token = tokenFromLink(created.items[0].link);
    await assert.rejects(
      () => state.service.validateByToken("other@example.com", token),
      BadRequestException,
    );

    const accepted = await state.service.accept({
      action: "accept",
      email: "member@example.com",
      token,
    });

    assert.equal(accepted.status, "accepted");
    assert.equal(accepted.acceptedCount, 1);
    assert.equal(state.memberships.length, 1);
    assert.equal(state.memberships[0].userId, "user-member");
  });

  it("keeps directed invite creation successful when invite notification fails", async () => {
    const state = createInviteService({
      failNotification: true,
      users: [
        userRecord({
          email: "member@example.com",
          id: "user-member",
          passwordHash: hashPassword("current-password"),
        }),
      ],
    });

    const created = await state.service.createBulkForOrganization(
      ORGANIZATION_ID,
      INVITER_ID,
      { emailIds: ["member@example.com"], expiresIn: "3d", roleId: ROLE_ID },
    );

    assert.equal(created.total, 1);
    assert.equal(state.invites.length, 1);
    assert.equal(state.sentEmails.length, 1);
    assert.equal(state.notifications.length, 0);
  });

  it("keeps directed invite creation successful when invite email fails", async () => {
    const state = createInviteService({
      failEmailSend: true,
      users: [
        userRecord({
          email: "member@example.com",
          id: "user-member",
          passwordHash: hashPassword("current-password"),
        }),
      ],
    });

    const created = await state.service.createBulkForOrganization(
      ORGANIZATION_ID,
      INVITER_ID,
      { emailIds: ["member@example.com"], expiresIn: "3d", roleId: ROLE_ID },
    );

    assert.equal(created.total, 1);
    assert.equal(state.invites.length, 1);
    assert.equal(state.sentEmails.length, 0);
    assert.equal(state.notifications.length, 1);
  });

  it("requires password verification when a public link is used by an existing account", async () => {
    const state = createInviteService({
      users: [
        userRecord({
          email: "existing@example.com",
          id: "user-existing",
          passwordHash: hashPassword("correct-password"),
        }),
      ],
    });
    const created = await state.service.createBulkForOrganization(
      ORGANIZATION_ID,
      INVITER_ID,
      { emailIds: [], expiresIn: "3d", roleId: ROLE_ID },
    );
    const token = tokenFromLink(created.items[0].link);

    await assert.rejects(
      () =>
        state.service.accept({
          action: "accept",
          email: "existing@example.com",
          password: "wrong-password",
          token,
        }),
      BadRequestException,
    );

    const accepted = await state.service.accept({
      action: "accept",
      email: "existing@example.com",
      password: "correct-password",
      token,
    });

    assert.equal(accepted.acceptedUserId, "user-existing");
    assert.equal(state.memberships.length, 1);
  });

  it("rejects malformed public invite acceptance fields without creating rows", async () => {
    const state = createInviteService();
    const created = await state.service.createBulkForOrganization(
      ORGANIZATION_ID,
      INVITER_ID,
      { emailIds: [], expiresIn: "3d", roleId: ROLE_ID },
    );
    const token = tokenFromLink(created.items[0].link);

    await assert.rejects(
      () =>
        state.service.accept({
          action: "accept",
          displayName: 42 as any,
          email: "external@example.com",
          password: "password-123",
          token,
        }),
      { message: "用户名称格式不正确" },
    );
    await assert.rejects(
      () =>
        state.service.accept({
          action: "accept",
          displayName: "External User",
          email: "external@example.com",
          password: 12345678 as any,
          token,
        }),
      { message: "密码格式不正确" },
    );

    assert.equal(state.users.some((user) => user.email === "external@example.com"), false);
    assert.equal(state.memberships.length, 0);
    assert.equal(state.invites[0].acceptedCount, 0);
  });

  it("keeps invite acceptance successful when accepted notification fails", async () => {
    const state = createInviteService({ failNotification: true });
    const created = await state.service.createBulkForOrganization(
      ORGANIZATION_ID,
      INVITER_ID,
      { emailIds: [], expiresIn: "3d", roleId: ROLE_ID },
    );
    const token = tokenFromLink(created.items[0].link);

    const accepted = await state.service.accept({
      action: "accept",
      displayName: "External User",
      email: "external@example.com",
      password: "password-123",
      token,
    });

    assert.equal(accepted.acceptedCount, 1);
    assert.equal(state.memberships.length, 1);
    assert.equal(state.notifications.length, 0);
  });

  it("does not close or resend already accepted directed invites", async () => {
    const state = createInviteService({
      users: [
        userRecord({
          email: "member@example.com",
          id: "user-member",
          passwordHash: hashPassword("current-password"),
        }),
      ],
    });
    const created = await state.service.createBulkForOrganization(
      ORGANIZATION_ID,
      INVITER_ID,
      { emailIds: ["member@example.com"], expiresIn: "3d", roleId: ROLE_ID },
    );
    const inviteId = created.items[0].id;
    const token = tokenFromLink(created.items[0].link);

    const accepted = await state.service.accept({
      action: "accept",
      email: "member@example.com",
      token,
    });

    assert.equal(accepted.status, "accepted");
    await assert.rejects(
      () => state.service.deleteForOrganization(ORGANIZATION_ID, inviteId),
      BadRequestException,
    );
    await assert.rejects(
      () =>
        state.service.resendForOrganization(
          ORGANIZATION_ID,
          INVITER_ID,
          inviteId,
        ),
      BadRequestException,
    );
    assert.equal(state.invites[0].status, "accepted");
    assert.equal(state.invites[0].closedAt, null);
    assert.equal(state.memberships.length, 1);
  });

  it("rolls back user and membership creation when invite acceptance update fails", async () => {
    const state = createInviteService({ failTransactionalInviteSave: true });
    const created = await state.service.createBulkForOrganization(
      ORGANIZATION_ID,
      INVITER_ID,
      { emailIds: [], expiresIn: "3d", roleId: ROLE_ID },
    );
    const token = tokenFromLink(created.items[0].link);

    await assert.rejects(() =>
      state.service.accept({
        action: "accept",
        displayName: "Rollback User",
        email: "rollback@example.com",
        password: "password-123",
        token,
      }),
    );

    assert.equal(state.users.some((user) => user.email === "rollback@example.com"), false);
    assert.equal(state.memberships.length, 0);
    assert.equal(state.notifications.length, 0);
    assert.equal(state.invites[0].acceptedCount, 0);
    assert.equal(state.invites[0].acceptedUserId, null);
  });
});

function createInviteService(options: {
  failEmailSend?: boolean;
  failNotification?: boolean;
  failTransactionalInviteSave?: boolean;
  users?: ReturnType<typeof userRecord>[];
} = {}) {
  const invites: any[] = [];
  const users = [
    userRecord({ email: "inviter@example.com", id: INVITER_ID }),
    ...(options.users ?? []),
  ];
  const memberships: any[] = [];
  const sentEmails: any[] = [];
  const notifications: any[] = [];
  const organization = {
    id: ORGANIZATION_ID,
    imageUrl: null,
    logoUrl: null,
    name: "Hermes",
    shortDescription: "Hermes organization",
    slug: "hermes",
  };
  const role = {
    color: null,
    displayName: "Member",
    id: ROLE_ID,
    isSystem: true,
    label: "Member",
    name: "member",
    organizationId: ORGANIZATION_ID,
    scope: "organization",
    tenantId: TENANT_ID,
  };

  for (const user of users) user.tenantId = TENANT_ID;

  const transactionManager = {
    async query() {},
    async findOne(target: { name?: string }, { where }: any) {
      if (target.name === "Invite") {
        return invites.find((row) =>
          Object.entries(where).every(([key, value]) => row[key] === value),
        ) ?? null;
      }
      if (target.name === "User") {
        return users.find((row) =>
          Object.entries(where).every(([key, value]) => row[key] === value),
        ) ?? null;
      }
      if (target.name === "UserOrganization") {
        return memberships.find((row) =>
          Object.entries(where).every(([key, value]) => row[key] === value),
        ) ?? null;
      }
      return null;
    },
    async save(target: { name?: string }, value: any) {
      if (target.name === "User") {
        users.push(value);
        return value;
      }
      if (target.name === "UserOrganization") {
        memberships.push(value);
        return value;
      }
      if (target.name === "Invite") {
        if (options.failTransactionalInviteSave) throw new Error("invite save failed");
        const index = invites.findIndex((invite) => invite.id === value.id);
        if (index >= 0) invites[index] = value;
        else invites.push(value);
      }
      return value;
    },
  };

  const inviteRepository = {
    create(value: any) {
      return {
        acceptedCount: 0,
        actionDate: null,
        acceptedUserId: null,
        closedAt: null,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        id: `invite-${invites.length + 1}`,
        invitedBy: null,
        role: null,
        ...value,
      };
    },
    createQueryBuilder() {
      const query: Record<string, any> = {};
      const builder = {
        andWhere(_sql: string, params?: Record<string, any>) {
          Object.assign(query, params);
          return builder;
        },
        getRawMany: async () =>
          invites
            .filter(
              (invite) =>
                invite.organizationId === query.orgId &&
                query.emails?.includes(invite.email) &&
                invite.status === query.status &&
                !invite.closedAt &&
                (!invite.expireDate || invite.expireDate >= query.now),
            )
            .map((invite) => ({ email: invite.email })),
        select() {
          return builder;
        },
        where(_sql: string, params?: Record<string, any>) {
          Object.assign(query, params);
          return builder;
        },
      };
      return builder;
    },
    async find({ where }: any) {
      const candidates = Array.isArray(where) ? where : [where];
      return invites.filter((invite) =>
        candidates.some((candidate) =>
          Object.entries(candidate).every(
            ([key, value]) => invite[key] === value,
          ),
        ),
      );
    },
    async findOne({ where }: any) {
      return (
        invites.find((invite) =>
          Object.entries(where).every(([key, value]) => invite[key] === value),
        ) ?? null
      );
    },
    async save(value: any) {
      if (Array.isArray(value)) {
        return Promise.all(value.map((item) => this.save(item)));
      }
      const index = invites.findIndex((invite) => invite.id === value.id);
      if (index >= 0) {
        invites[index] = value;
      } else {
        invites.push(value);
      }
      return value;
    },
    manager: {
      async transaction(callback: (manager: any) => Promise<unknown>) {
        const snapshots = {
          invites: cloneRows(invites),
          memberships: cloneRows(memberships),
          users: cloneRows(users),
        };
        try {
          return await callback(transactionManager);
        } catch (error) {
          replaceRows(invites, snapshots.invites);
          replaceRows(memberships, snapshots.memberships);
          replaceRows(users, snapshots.users);
          throw error;
        }
      },
    },
  };

  const userRepository = {
    create(value: any) {
      return {
        avatarUrl: null,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        firstName: null,
        id: `user-${users.length + 1}`,
        imageUrl: null,
        lastName: null,
        mobile: null,
        nickname: null,
        timeZone: null,
        updatedAt: new Date("2026-01-01T00:00:00Z"),
        username: null,
        ...value,
      };
    },
    async findOne({ where }: any) {
      return (
        users.find((user) =>
          Object.entries(where).every(([key, value]) => user[key] === value),
        ) ?? null
      );
    },
    async save(user: any) {
      users.push(user);
      return user;
    },
  };

  const membershipRepository = {
    create(value: any) {
      return { id: `membership-${memberships.length + 1}`, ...value };
    },
    createQueryBuilder() {
      const query: Record<string, any> = {};
      const builder = {
        andWhere(_sql: string, params?: Record<string, any>) {
          Object.assign(query, params);
          return builder;
        },
        getRawMany: async () =>
          memberships
            .filter((membership) => membership.organizationId === query.orgId)
            .map((membership) =>
              users.find((user) => user.id === membership.userId),
            )
            .filter(
              (user): user is ReturnType<typeof userRecord> =>
                Boolean(user) && query.emails?.includes(user.email),
            )
            .map((user) => ({ email: user.email })),
        innerJoin() {
          return builder;
        },
        select() {
          return builder;
        },
        where(_sql: string, params?: Record<string, any>) {
          Object.assign(query, params);
          return builder;
        },
      };
      return builder;
    },
    async findOne({ where }: any) {
      return (
        memberships.find((membership) =>
          Object.entries(where).every(
            ([key, value]) => membership[key] === value,
          ),
        ) ?? null
      );
    },
    async save(membership: any) {
      memberships.push(membership);
      return membership;
    },
  };

  const organizationRepository = {
      async findOne({ where }: any) {
        return where.id === organization.id && where.tenantId === TENANT_ID
          ? { ...organization, tenantId: TENANT_ID }
          : null;
      },
    } as any;
  const roleRepository = {
      async findOne({ where }: any) {
        return where.id === role.id &&
          where.organizationId === role.organizationId &&
          where.scope === role.scope
          ? role
          : null;
      },
    } as any;
  let activeContext: any = null;
  const baseContext = { manager: transactionManager, tenantId: TENANT_ID };
  const tenantContext = {
    current(required = true) {
      if (activeContext) return activeContext;
      return required ? baseContext : null;
    },
    repository(target: { name?: string }) {
      if (target.name === "Invite") return inviteRepository;
      if (target.name === "User") return userRepository;
      if (target.name === "Organization") return organizationRepository;
      if (target.name === "Role") return roleRepository;
      return membershipRepository;
    },
    run(context: any, work: () => unknown) {
      activeContext = context;
      return Promise.resolve(work()).finally(() => {
        activeContext = null;
      });
    },
  } as any;
  const dataSource = {
    transaction: inviteRepository.manager.transaction,
  } as any;
  const service = new InviteService(
    dataSource,
    tenantContext,
    {
      async send(payload: any) {
        if (options.failEmailSend) {
          throw new Error("email failed");
        }
        sentEmails.push(payload);
      },
    } as any,
    {
      async createForUser(payload: any) {
        if (options.failNotification) {
          throw new Error("notification failed");
        }
        notifications.push(payload);
      },
    } as any,
    {
      async getPlatformValue(_key: string, fallback: string) {
        return fallback;
      },
    } as any,
  );

  return {
    invites,
    memberships,
    notifications,
    sentEmails,
    service,
    users,
  };
}

function userRecord(input: {
  email: string;
  id: string;
  passwordHash?: string;
}) {
  return {
    avatarUrl: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    displayName: input.email.split("@")[0],
    email: input.email,
    emailVerified: true,
    firstName: null,
    id: input.id,
    imageUrl: null,
    lastName: null,
    mobile: null,
    nickname: null,
    passwordHash: input.passwordHash ?? hashPassword("password-123"),
    preferredLanguage: "zh-CN",
    status: "active",
    tenantId: TENANT_ID,
    timeZone: null,
    type: "user",
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    username: null,
  };
}

function tokenFromLink(link: string | null | undefined) {
  assert.ok(link);
  const token = new URL(link).searchParams.get("token");
  assert.ok(token);
  return token;
}

function cloneRows<T extends Record<string, unknown>>(rows: T[]) {
  return rows.map((row) => ({ ...row }));
}

function replaceRows<T>(target: T[], rows: T[]) {
  target.splice(0, target.length, ...rows);
}
