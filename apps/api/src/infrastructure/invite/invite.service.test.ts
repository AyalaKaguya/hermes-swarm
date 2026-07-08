import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";
import { hashPassword } from "../../common/security/password-hash.js";
import { InviteService } from "./invite.service.js";

const ORGANIZATION_ID = "org-1";
const INVITER_ID = "user-inviter";
const ROLE_ID = "role-member";

describe("InviteService", () => {
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
});

function createInviteService(options: {
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

  const service = new InviteService(
    inviteRepository as any,
    userRepository as any,
    {
      async findOne({ where }: any) {
        return where.id === organization.id ? organization : null;
      },
    } as any,
    {
      async findOne({ where }: any) {
        return where.id === role.id &&
          where.organizationId === role.organizationId &&
          where.scope === role.scope
          ? role
          : null;
      },
    } as any,
    membershipRepository as any,
    {
      async send(payload: any) {
        sentEmails.push(payload);
      },
    } as any,
    {
      async createForUser(payload: any) {
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
