import "reflect-metadata";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { Injectable, INestApplication, Module } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { TypeOrmModule } from "@nestjs/typeorm";
import request from "supertest";
import { DataSource, Repository } from "typeorm";
import {
  CustomSmtp,
  EmailLog,
  EmailTemplate,
  Invite,
  NotificationDestination,
  Organization,
  OrganizationContact,
  OrganizationGroup,
  OrganizationGroupMember,
  OrganizationLanguage,
  OrganizationSetting,
  PasswordReset,
  Permission,
  PlatformMember,
  PlatformSetting,
  Role,
  RolePermission,
  User,
  UserOrganization,
} from "@hermes-swarm/core";
import { RbacModule } from "@hermes-swarm/rbac";
import { createAuthSessionToken, parseAuthSessionToken } from "../auth/auth-session.js";
import { RedisService } from "../common/redis/redis.service.js";
import { OrganizationsController } from "../organizations/organizations.controller.js";
import { OrganizationsService } from "../organizations/organizations.service.js";
import { SettingsService } from "../settings/settings.service.js";
import { UsersController } from "../users/users.controller.js";
import { UsersService } from "../users/users.service.js";

type Persona = "ordinary" | "orgScoped" | "platformAdmin";

const e2eDatabaseUrl =
  process.env.POSTGRES_E2E_URL ??
  process.env.POSTGRES_URL?.replace(/\/[^/]+$/, "/hermes-e2e") ??
  "postgresql://hermes:hermes_dev_pwd@localhost:5432/hermes-e2e";

const ids = {
  acmeOrg: "00000000-0000-4000-8000-000000000202",
  hermesOrg: "00000000-0000-4000-8000-000000000201",
  ordinaryRole: "00000000-0000-4000-8000-000000000303",
  ordinaryUser: "00000000-0000-4000-8000-000000000103",
  orgScopedRole: "00000000-0000-4000-8000-000000000302",
  orgScopedUser: "00000000-0000-4000-8000-000000000102",
  platformRole: "00000000-0000-4000-8000-000000000301",
  platformUser: "00000000-0000-4000-8000-000000000101",
};

const tokenByPersona: Record<Persona, string> = {
  ordinary: token(ids.ordinaryUser),
  orgScoped: token(ids.orgScopedUser),
  platformAdmin: token(ids.platformUser),
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

describe("API RBAC e2e with database", { concurrency: false }, () => {
  let app: INestApplication;
  let dataSource: DataSource;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: "postgres",
          url: e2eDatabaseUrl,
          entities: [
            CustomSmtp,
            EmailLog,
            EmailTemplate,
            Invite,
            NotificationDestination,
            Organization,
            OrganizationContact,
            OrganizationGroup,
            OrganizationGroupMember,
            OrganizationLanguage,
            OrganizationSetting,
            PasswordReset,
            Permission,
            PlatformMember,
            PlatformSetting,
            Role,
            RolePermission,
            User,
            UserOrganization,
          ],
          cache: false,
          dropSchema: true,
          retryAttempts: 0,
          synchronize: true,
        }),
        TypeOrmModule.forFeature([
          Organization,
          OrganizationSetting,
          Permission,
          PlatformMember,
          PlatformSetting,
          Role,
          RolePermission,
          User,
          UserOrganization,
        ]),
        RbacModule.register({
          authSessionService: E2EAuthSessionService,
          imports: [E2EAuthSessionModule],
        }),
      ],
      controllers: [OrganizationsController, UsersController],
      providers: [
        OrganizationsService,
        SettingsService,
        UsersService,
        {
          provide: RedisService,
          useValue: {
            async getClient() {
              return null;
            },
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    dataSource = app.get(DataSource);
    await seedDatabase(dataSource);
  });

  afterEach(async () => {
    await app?.close();
  });

  it("requires a valid bearer token before high-privilege APIs run", async () => {
    await request(app.getHttpServer())
      .get("/admin/organizations")
      .expect(401);
  });

  it("denies platform organization APIs to ordinary and org-scoped users", async () => {
    await request(app.getHttpServer())
      .get("/admin/organizations")
      .set(auth(tokenByPersona.ordinary))
      .expect(403)
      .expect(({ body }) => {
        assert.equal(body.code, "RBAC_PERMISSION_DENIED");
        assert.equal(body.permission.id, "organization.platform_organization.list:platform");
      });

    await request(app.getHttpServer())
      .post("/admin/organizations")
      .set(auth(tokenByPersona.orgScoped))
      .send({ name: "Forbidden Org", slug: "forbidden" })
      .expect(403)
      .expect(({ body }) => {
        assert.equal(body.permission.id, "organization.platform_organization.create:platform");
      });

    assert.equal(await organizationCount(), 2);
  });

  it("allows platform admins to list and create platform organizations through real services", async () => {
    await request(app.getHttpServer())
      .get("/admin/organizations")
      .set(auth(tokenByPersona.platformAdmin))
      .expect(200)
      .expect(({ body }) => {
        assert.deepEqual(
          body.map((item: { slug: string }) => item.slug),
          ["hermes", "acme"],
        );
      });

    await request(app.getHttpServer())
      .post("/admin/organizations")
      .set(auth(tokenByPersona.platformAdmin))
      .send({ name: "Allowed Org", slug: "allowed" })
      .expect(201)
      .expect(({ body }) => {
        assert.equal(body.slug, "allowed");
        assert.equal(body.createdByUserId, ids.platformUser);
      });

    assert.equal(await organizationCount(), 3);
  });

  it("keeps organization-scoped permissions inside the user's organization", async () => {
    await request(app.getHttpServer())
      .get(`/admin/organizations/${ids.hermesOrg}`)
      .set(auth(tokenByPersona.orgScoped))
      .expect(200)
      .expect(({ body }) => {
        assert.equal(body.id, ids.hermesOrg);
        assert.equal(body.slug, "hermes");
      });

    await request(app.getHttpServer())
      .get(`/admin/organizations/${ids.acmeOrg}`)
      .set(auth(tokenByPersona.orgScoped))
      .expect(403)
      .expect(({ body }) => {
        assert.equal(body.permission.id, "organization.profile.view:organization");
      });
  });

  it("denies organization resources to ordinary users without the resource permission", async () => {
    await request(app.getHttpServer())
      .get(`/admin/organizations/${ids.hermesOrg}`)
      .set(auth(tokenByPersona.ordinary))
      .expect(403);
  });

  it("enforces own-scope profile APIs at the HTTP boundary and persists allowed updates", async () => {
    await request(app.getHttpServer())
      .patch(`/admin/users/${ids.orgScopedUser}`)
      .set(auth(tokenByPersona.orgScoped))
      .send({ displayName: "Updated Self" })
      .expect(200)
      .expect(({ body }) => {
        assert.equal(body.id, ids.orgScopedUser);
        assert.equal(body.displayName, "Updated Self");
      });

    await request(app.getHttpServer())
      .patch(`/admin/users/${ids.ordinaryUser}`)
      .set(auth(tokenByPersona.orgScoped))
      .send({ displayName: "Should Not Update" })
      .expect(403)
      .expect(({ body }) => {
        assert.equal(body.permission.id, "user.self_profile.update_profile:own");
      });

    const ordinary = await userRepository().findOneByOrFail({
      id: ids.ordinaryUser,
    });
    assert.equal(ordinary.displayName, "Ordinary User");
  });

  it("denies platform user search to org-scoped users but allows platform admins", async () => {
    await request(app.getHttpServer())
      .get("/admin/users/search?search=admin")
      .set(auth(tokenByPersona.orgScoped))
      .expect(403)
      .expect(({ body }) => {
        assert.equal(body.permission.id, "user.platform_user.search:platform");
      });

    await request(app.getHttpServer())
      .get("/admin/users/search?search=admin")
      .set(auth(tokenByPersona.platformAdmin))
      .expect(200)
      .expect(({ body }) => {
        assert.deepEqual(
          body.map((item: { id: string }) => item.id),
          [ids.platformUser],
        );
      });
  });

  function organizationCount() {
    return organizationRepository().count();
  }

  function organizationRepository() {
    return dataSource.getRepository(Organization);
  }

  function userRepository() {
    return dataSource.getRepository(User);
  }
});

async function seedDatabase(dataSource: DataSource) {
  const users = dataSource.getRepository(User);
  const organizations = dataSource.getRepository(Organization);
  const roles = dataSource.getRepository(Role);
  const memberships = dataSource.getRepository(UserOrganization);
  const platformMembers = dataSource.getRepository(PlatformMember);
  const rolePermissions = dataSource.getRepository(RolePermission);
  const platformSettings = dataSource.getRepository(PlatformSetting);

  await users.save([
    user(users, ids.platformUser, "admin@hermes.local", "Platform Admin"),
    user(users, ids.orgScopedUser, "member@hermes.local", "Org Scoped User"),
    user(users, ids.ordinaryUser, "ordinary@hermes.local", "Ordinary User"),
  ]);

  await organizations.save([
    organization(organizations, ids.hermesOrg, "Hermes", "hermes", true),
    organization(organizations, ids.acmeOrg, "Acme Labs", "acme", false),
  ]);

  await roles.save([
    role(roles, ids.platformRole, "platform-admin", "Platform Admin", "platform", null),
    role(roles, ids.orgScopedRole, "member", "Member", "organization", ids.hermesOrg),
    role(roles, ids.ordinaryRole, "viewer", "Viewer", "organization", ids.hermesOrg),
  ]);

  await memberships.save([
    membership(memberships, ids.orgScopedUser, ids.hermesOrg, ids.orgScopedRole),
    membership(memberships, ids.ordinaryUser, ids.hermesOrg, ids.ordinaryRole),
  ]);

  await platformMembers.save(
    platformMembers.create({
      displayName: "Platform Admin",
      roleId: ids.platformRole,
      status: "active",
      userId: ids.platformUser,
    }),
  );

  await platformSettings.save(
    platformSettings.create({
      name: "platform.allowOrganizationCreation",
      value: "true",
      valueOptions: null,
      valueType: "boolean",
    }),
  );

  await rolePermissions.save([
    ...permissions(rolePermissions, ids.platformRole, null, [
      "organization.platform_organization.list:platform",
      "organization.platform_organization.create:platform",
      "organization.profile.view:organization",
      "user.platform_user.search:platform",
      "user.self_profile.update_profile:own",
    ]),
    ...permissions(rolePermissions, ids.orgScopedRole, ids.hermesOrg, [
      "organization.profile.view:organization",
      "user.self_profile.update_profile:own",
    ]),
    ...permissions(rolePermissions, ids.ordinaryRole, ids.hermesOrg, [
      "user.self_profile.update_profile:own",
    ]),
  ]);
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
    username: null,
  });
}

function organization(
  repository: Repository<Organization>,
  id: string,
  name: string,
  slug: string,
  isDefault: boolean,
) {
  return repository.create({
    id,
    banner: null,
    brandColor: null,
    clientFocus: null,
    createdByUserId: ids.platformUser,
    currency: null,
    dateFormat: null,
    imageUrl: null,
    isDefault,
    logoUrl: null,
    name,
    officialName: name,
    overview: null,
    preferredLanguage: "zh-CN",
    profileLink: null,
    regionCode: null,
    shortDescription: null,
    slug,
    status: "active",
    subdomain: slug,
    timeZone: null,
    totalEmployees: null,
    website: null,
  });
}

function role(
  repository: Repository<Role>,
  id: string,
  name: string,
  label: string,
  scope: Role["scope"],
  organizationId: string | null,
) {
  return repository.create({
    id,
    color: null,
    description: null,
    displayName: label,
    isSystem: true,
    label,
    name,
    organizationId,
    scope,
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

function permissions(
  repository: Repository<RolePermission>,
  roleId: string,
  organizationId: string | null,
  values: string[],
) {
  return values.map((permission) =>
    repository.create({
      enabled: true,
      organizationId,
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
