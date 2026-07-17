import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AuthSessionService } from "../infrastructure/auth/auth-session.service.js";
import { InviteController } from "../infrastructure/invite/invite.controller.js";
import { InviteService } from "../infrastructure/invite/invite.service.js";
import { UsersController } from "../infrastructure/users/users.controller.js";
import { UsersService } from "../infrastructure/users/users.service.js";

describe("workspace admin route contract e2e", { concurrency: false }, () => {
  let app: INestApplication;
  const calls: Array<{ method: string; value?: unknown }> = [];

  before(async () => {
    const users = {
      create: async (_authorization: string, value: unknown) => ({ id: "user-2", ...value as object }),
      deleteManaged: async (_authorization: string, userId: string) => calls.push({ method: "deleteUser", value: userId }),
      list: async () => [{ email: "owner@example.com", id: "user-1", tenantRole: null }],
      replaceTenantRole: async (_authorization: string, userId: string, roleId: string) => ({ id: userId, roleId }),
      updateManaged: async (_authorization: string, userId: string, value: unknown) => ({ id: userId, ...value as object }),
    };
    const invites = {
      create: async (userId: string, value: unknown) => ({ id: "invite-1", invitedById: userId, ...value as object }),
      list: async () => [{ email: "member@example.com", id: "invite-1", status: "invited" }],
      resend: async (inviteId: string, userId: string) => ({ id: inviteId, invitedById: userId, status: "invited" }),
      revoke: async (inviteId: string) => calls.push({ method: "revokeInvite", value: inviteId }),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [InviteController, UsersController],
      providers: [
        { provide: UsersService, useValue: users },
        { provide: InviteService, useValue: invites },
        {
          provide: AuthSessionService,
          useValue: { validateAccessToken: async () => ({ userId: "user-1" }) },
        },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  after(async () => {
    await app?.close();
  });

  it("exposes workspace user CRUD and role replacement without legacy tenant paths", async () => {
    await request(app.getHttpServer()).get("/admin/users").expect(200).expect(({ body }) => {
      assert.equal(body[0].id, "user-1");
    });
    await request(app.getHttpServer())
      .patch("/admin/users/user-2")
      .set("Authorization", "Bearer token")
      .send({ status: "disabled" })
      .expect(200)
      .expect(({ body }) => assert.equal(body.status, "disabled"));
    await request(app.getHttpServer())
      .put("/admin/users/user-2/role")
      .set("Authorization", "Bearer token")
      .send({ roleId: "role-1" })
      .expect(200)
      .expect(({ body }) => assert.equal(body.roleId, "role-1"));
    await request(app.getHttpServer())
      .delete("/admin/users/user-2")
      .set("Authorization", "Bearer token")
      .expect(204);
    assert.deepEqual(calls.find((call) => call.method === "deleteUser")?.value, "user-2");
  });

  it("exposes one workspace invite with multiple organization assignments", async () => {
    await request(app.getHttpServer()).get("/admin/invites").expect(200);
    await request(app.getHttpServer())
      .post("/admin/invites")
      .set("Authorization", "Bearer token")
      .send({
        email: "member@example.com",
        organizations: [
          { isDefault: true, organizationId: "org-1", roleId: "role-org-1" },
          { organizationId: "org-2", roleId: "role-org-2" },
        ],
        workspaceRoleId: "role-tenant",
      })
      .expect(201)
      .expect(({ body }) => {
        assert.equal(body.invitedById, "user-1");
        assert.equal(body.organizations.length, 2);
      });
    await request(app.getHttpServer())
      .post("/admin/invites/invite-1/resend")
      .set("Authorization", "Bearer token")
      .expect(201);
    await request(app.getHttpServer()).delete("/admin/invites/invite-1").expect(204);
    assert.deepEqual(calls.find((call) => call.method === "revokeInvite")?.value, "invite-1");
  });
});
