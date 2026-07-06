import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { Injectable, INestApplication, Module } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { TypeOrmModule } from "@nestjs/typeorm";
import request from "supertest";
import { DataSource, Repository } from "typeorm";
import {
  Conversation,
  ConversationMessage,
  ConversationParticipant,
  NotificationDestination,
  Organization,
  OrganizationGroup,
  OrganizationGroupMember,
  OrganizationSetting,
  Permission,
  PlatformMember,
  PlatformSetting,
  Role,
  RolePermission,
  Ticket,
  TicketMessage,
  User,
  UserNotification,
  UserOrganization,
} from "@hermes-swarm/core";
import { RbacModule } from "@hermes-swarm/rbac";
import {
  createAuthSessionToken,
  parseAuthSessionToken,
} from "../infrastructure/auth/auth-session.js";
import { AuthSessionService } from "../infrastructure/auth/auth-session.service.js";
import { RedisService } from "../common/redis/redis.service.js";
import { RealtimeService } from "../infrastructure/realtime/realtime.service.js";
import { TicketsModule } from "../infrastructure/tickets/tickets.module.js";

const e2eDatabaseUrl =
  process.env.POSTGRES_E2E_URL ??
  process.env.POSTGRES_URL?.replace(/\/[^/]+$/, "/hermes-e2e") ??
  "postgresql://hermes:hermes_dev_pwd@localhost:5432/hermes-e2e";

const ids = {
  conversationHandlerRole: "00000000-0000-4000-8000-000000000331",
  conversationMentionedRole: "00000000-0000-4000-8000-000000000332",
  conversationObserverRole: "00000000-0000-4000-8000-000000000333",
  conversationRequesterRole: "00000000-0000-4000-8000-000000000334",
  handlerUser: "00000000-0000-4000-8000-000000000121",
  mentionedUser: "00000000-0000-4000-8000-000000000122",
  observerUser: "00000000-0000-4000-8000-000000000123",
  organization: "00000000-0000-4000-8000-000000000221",
  requesterUser: "00000000-0000-4000-8000-000000000124",
};

const permissions = {
  createTicket: "ticket.conversation.create_organization:organization",
  handleTicket: "ticket.conversation.handle:organization",
  listTicket: "ticket.conversation.list_organization:organization",
};

const tokens = {
  handler: token(ids.handlerUser),
  mentioned: token(ids.mentionedUser),
  observer: token(ids.observerUser),
  requester: token(ids.requesterUser),
};

@Injectable()
class E2EAuthSessionService {
  async validateAccessToken(value: string | undefined) {
    const payload = parseAuthSessionToken(value);
    if (!payload) throw new Error("Invalid auth token");
    return {
      sessionId: payload.sessionId,
      userId: payload.userId,
    };
  }
}

@Module({
  providers: [E2EAuthSessionService],
  exports: [E2EAuthSessionService],
})
class E2EAuthSessionModule {}

describe("Conversation capability e2e", { concurrency: false }, () => {
  let app: INestApplication;
  let dataSource: DataSource;

  before(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: "postgres",
          url: e2eDatabaseUrl,
          entities: [
            Conversation,
            ConversationMessage,
            ConversationParticipant,
            NotificationDestination,
            Organization,
            OrganizationGroup,
            OrganizationGroupMember,
            OrganizationSetting,
            Permission,
            PlatformMember,
            PlatformSetting,
            Role,
            RolePermission,
            Ticket,
            TicketMessage,
            User,
            UserNotification,
            UserOrganization,
          ],
          cache: false,
          dropSchema: true,
          retryAttempts: 0,
          synchronize: true,
        }),
        RbacModule.register({
          authSessionService: E2EAuthSessionService,
          imports: [E2EAuthSessionModule],
        }),
        TicketsModule,
      ],
    })
      .overrideProvider(AuthSessionService)
      .useClass(E2EAuthSessionService)
      .overrideProvider(RedisService)
      .useValue({
        async getClient() {
          return null;
        },
      })
      .overrideProvider(RealtimeService)
      .useValue({
        publishToUser() {},
        publishToUsers() {},
      })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
    dataSource = app.get(DataSource);
  });

  beforeEach(async () => {
    await resetDatabase(dataSource);
    await seedDatabase(dataSource);
  });

  after(async () => {
    await app?.close();
  });

  it("routes ticket messages through reusable conversations, participants, and notifications", async () => {
    const created = await request(app.getHttpServer())
      .post(`/admin/organizations/${ids.organization}/tickets`)
      .set(auth(tokens.requester))
      .send({
        body: "请处理 @mentioned@hermes.local",
        subject: "Need help",
      })
      .expect(201)
      .expect(({ body }) => {
        assert.equal(body.subject, "Need help");
        assert.equal(body.firstMessage.sourceType, "ticket");
        assert.equal(body.firstMessage.ticketId, body.id);
        assert.equal(typeof body.conversationId, "string");
      });

    const ticketId = created.body.id as string;
    const conversationId = created.body.conversationId as string;
    await assertParticipants(conversationId, [
      ids.mentionedUser,
      ids.requesterUser,
    ]);

    let notifications = await notificationRepository().find({
      order: { createdAt: "ASC" },
      where: { sourceId: ticketId, sourceType: "ticket" },
    });
    assert.deepEqual(
      notifications.map((item) => item.recipientUserId),
      [ids.mentionedUser],
    );
    assert.match(notifications[0]!.title, /提到了你/);

    await request(app.getHttpServer())
      .get(`/admin/organizations/${ids.organization}/tickets`)
      .set(auth(tokens.mentioned))
      .expect(200)
      .expect(({ body }) => {
        assert.deepEqual(
          body.map((item: { id: string }) => item.id),
          [ticketId],
        );
      });

    await request(app.getHttpServer())
      .get(`/admin/organizations/${ids.organization}/tickets`)
      .set(auth(tokens.observer))
      .expect(200)
      .expect(({ body }) => {
        assert.deepEqual(body, []);
      });

    await request(app.getHttpServer())
      .get(`/admin/organizations/${ids.organization}/tickets`)
      .set(auth(tokens.handler))
      .expect(200)
      .expect(({ body }) => {
        assert.deepEqual(
          body.map((item: { id: string }) => item.id),
          [ticketId],
        );
      });

    assert.equal(
      await notificationRepository().count({
        where: {
          recipientUserId: ids.handlerUser,
          sourceId: ticketId,
          sourceType: "ticket",
        },
      }),
      0,
    );

    await request(app.getHttpServer())
      .post(`/admin/tickets/${ticketId}/messages`)
      .set(auth(tokens.handler))
      .send({ body: "我来处理" })
      .expect(201)
      .expect(({ body }) => {
        assert.equal(body.conversationId, conversationId);
        assert.equal(body.sourceId, ticketId);
        assert.equal(body.sourceType, "ticket");
      });

    await assertParticipants(conversationId, [
      ids.handlerUser,
      ids.mentionedUser,
      ids.requesterUser,
    ]);

    notifications = await notificationRepository().find({
      order: { createdAt: "ASC" },
      where: { sourceId: ticketId, sourceType: "ticket" },
    });
    assert.deepEqual(
      notifications.map((item) => item.recipientUserId).sort(),
      [ids.mentionedUser, ids.mentionedUser, ids.requesterUser].sort(),
    );
    assert.equal(
      notifications.filter((item) => item.title === "工单新消息：Need help")
        .length,
      2,
    );
  });

  it("migrates legacy ticket messages into the conversation store on first read", async () => {
    const ticket = await ticketRepository().save(
      ticketRepository().create({
        lastMessageAt: new Date("2026-07-06T00:00:00Z"),
        organizationId: ids.organization,
        participantUserIds: [ids.requesterUser],
        requesterUserId: ids.requesterUser,
        scope: "organization",
        status: "open",
        subject: "Legacy ticket",
      }),
    );
    const legacyMessage = await legacyMessageRepository().save(
      legacyMessageRepository().create({
        authorUserId: ids.requesterUser,
        body: "legacy message",
        kind: "message",
        ticketId: ticket.id,
      }),
    );

    await request(app.getHttpServer())
      .get(`/admin/tickets/${ticket.id}/messages`)
      .set(auth(tokens.requester))
      .expect(200)
      .expect(({ body }) => {
        assert.equal(body.length, 1);
        assert.equal(body[0].body, "legacy message");
        assert.equal(body[0].ticketId, ticket.id);
      });

    const conversation = await conversationRepository().findOneByOrFail({
      sourceId: ticket.id,
      sourceType: "ticket",
    });
    const messages = await conversationMessageRepository().find({
      where: { conversationId: conversation.id },
    });
    assert.equal(messages.length, 1);
    assert.equal(messages[0]!.metadata?.legacyTicketMessageId, legacyMessage.id);
  });

  async function assertParticipants(conversationId: string, userIds: string[]) {
    const participants = await participantRepository().find({
      order: { userId: "ASC" },
      where: { conversationId },
    });
    assert.deepEqual(
      participants.map((participant) => participant.userId),
      [...userIds].sort(),
    );
  }

  function conversationRepository() {
    return dataSource.getRepository(Conversation);
  }

  function conversationMessageRepository() {
    return dataSource.getRepository(ConversationMessage);
  }

  function legacyMessageRepository() {
    return dataSource.getRepository(TicketMessage);
  }

  function notificationRepository() {
    return dataSource.getRepository(UserNotification);
  }

  function participantRepository() {
    return dataSource.getRepository(ConversationParticipant);
  }

  function ticketRepository() {
    return dataSource.getRepository(Ticket);
  }
});

async function seedDatabase(dataSource: DataSource) {
  const users = dataSource.getRepository(User);
  const organizations = dataSource.getRepository(Organization);
  const roles = dataSource.getRepository(Role);
  const memberships = dataSource.getRepository(UserOrganization);
  const rolePermissions = dataSource.getRepository(RolePermission);
  const platformSettings = dataSource.getRepository(PlatformSetting);

  await users.save([
    user(users, ids.handlerUser, "handler@hermes.local", "Handler"),
    user(users, ids.mentionedUser, "mentioned@hermes.local", "Mentioned"),
    user(users, ids.observerUser, "observer@hermes.local", "Observer"),
    user(users, ids.requesterUser, "requester@hermes.local", "Requester"),
  ]);

  await organizations.save(
    organizations.create({
      id: ids.organization,
      banner: null,
      brandColor: null,
      clientFocus: null,
      createdByUserId: ids.requesterUser,
      currency: null,
      dateFormat: null,
      imageUrl: null,
      isDefault: true,
      logoUrl: null,
      name: "Hermes",
      officialName: "Hermes",
      overview: null,
      preferredLanguage: "zh-CN",
      profileLink: null,
      regionCode: null,
      shortDescription: null,
      slug: "hermes",
      status: "active",
      subdomain: "hermes",
      timeZone: null,
      totalEmployees: null,
      website: null,
    }),
  );

  await roles.save([
    role(roles, ids.conversationHandlerRole, "handler", "Handler"),
    role(roles, ids.conversationMentionedRole, "member", "Member"),
    role(roles, ids.conversationObserverRole, "observer", "Observer"),
    role(roles, ids.conversationRequesterRole, "requester", "Requester"),
  ]);

  await memberships.save([
    membership(
      memberships,
      ids.handlerUser,
      ids.organization,
      ids.conversationHandlerRole,
    ),
    membership(
      memberships,
      ids.mentionedUser,
      ids.organization,
      ids.conversationMentionedRole,
    ),
    membership(
      memberships,
      ids.observerUser,
      ids.organization,
      ids.conversationObserverRole,
    ),
    membership(
      memberships,
      ids.requesterUser,
      ids.organization,
      ids.conversationRequesterRole,
    ),
  ]);

  await platformSettings.save(
    platformSettings.create({
      name: "platform.ticketing.visible",
      value: "true",
      valueOptions: null,
      valueType: "boolean",
    }),
  );

  await rolePermissions.save([
    ...rolePermission(rolePermissions, ids.conversationHandlerRole, [
      permissions.handleTicket,
      permissions.listTicket,
    ]),
    ...rolePermission(rolePermissions, ids.conversationMentionedRole, [
      permissions.listTicket,
    ]),
    ...rolePermission(rolePermissions, ids.conversationObserverRole, [
      permissions.listTicket,
    ]),
    ...rolePermission(rolePermissions, ids.conversationRequesterRole, [
      permissions.createTicket,
      permissions.listTicket,
    ]),
  ]);
}

async function resetDatabase(dataSource: DataSource) {
  const tables = dataSource.entityMetadatas
    .map((metadata) => quoteTablePath(metadata.tablePath))
    .join(", ");
  if (!tables) return;
  await dataSource.query(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
}

function quoteTablePath(tablePath: string) {
  return tablePath
    .split(".")
    .map((part) => `"${part.replaceAll('"', '""')}"`)
    .join(".");
}

function user(
  repository: Repository<User>,
  id: string,
  email: string,
  displayName: string,
) {
  return repository.create({
    id,
    avatarUrl: null,
    displayName,
    email,
    emailVerified: true,
    firstName: null,
    imageUrl: null,
    lastName: null,
    mobile: null,
    nickname: displayName,
    passwordHash: null,
    preferredLanguage: "zh-CN",
    refreshToken: null,
    status: "active",
    thirdPartyId: null,
    timeZone: null,
    type: "user",
    username: email.split("@")[0]!,
  });
}

function role(
  repository: Repository<Role>,
  id: string,
  name: string,
  label: string,
) {
  return repository.create({
    id,
    color: null,
    description: null,
    displayName: label,
    isSystem: false,
    label,
    name,
    organizationId: ids.organization,
    scope: "organization",
  });
}

function membership(
  repository: Repository<UserOrganization>,
  userId: string,
  organizationId: string,
  roleId: string,
) {
  return repository.create({
    displayName: null,
    joinedAt: new Date(),
    organizationId,
    roleId,
    status: "active",
    userId,
  });
}

function rolePermission(
  repository: Repository<RolePermission>,
  roleId: string,
  values: string[],
) {
  return values.map((permission) =>
    repository.create({
      enabled: true,
      organizationId: ids.organization,
      permission,
      permissionId: null,
      roleId,
    }),
  );
}

function auth(tokenValue: string) {
  return { Authorization: `Bearer ${tokenValue}` };
}

function token(userId: string) {
  return createAuthSessionToken({
    jti: `jti-${userId}`,
    sessionId: `session-${userId}`,
    userId,
  });
}
