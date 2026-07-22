import { MigrationInterface, QueryRunner } from "typeorm";

export class WorkspaceModelBaseline2026071500001 implements MigrationInterface {
    name = 'WorkspaceModelBaseline2026071500001'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
        await queryRunner.query(`CREATE TABLE "custom_smtp" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "workspace_id" uuid NOT NULL, "from_address" character varying(240), "host" character varying(240) NOT NULL, "port" integer NOT NULL DEFAULT '587', "secure" boolean NOT NULL DEFAULT false, "username" character varying(240), "password" character varying(500), "is_validated" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_1f4efe1edc0cc9cb2261584b335" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_848de9eb4c0bc0216f6a0590b7" ON "custom_smtp"  ("workspace_id") `);
        await queryRunner.query(`CREATE TABLE "email_sent" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "workspace_id" uuid NOT NULL, "template_name" character varying(120), "email" character varying(240) NOT NULL, "subject" character varying(240), "content" text, "status" character varying(24) NOT NULL DEFAULT 'queued', "is_archived" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_54f534a4ca70e28c8236514045c" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_ba367d498a4ed1ad9277333d83" ON "email_sent"  ("workspace_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_75ad4c431e7b109792ecaf4b9a" ON "email_sent"  ("workspace_id", "created_at") `);
        await queryRunner.query(`CREATE TABLE "email_templates" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "workspace_id" uuid NOT NULL, "name" character varying(120) NOT NULL, "is_system" boolean NOT NULL DEFAULT false, "description" character varying(240), "language_code" character varying(16) NOT NULL DEFAULT 'en', "subject" character varying(240), "mjml" text, "hbs" text NOT NULL, CONSTRAINT "PK_06c564c515d8cdb40b6f3bfbbb4" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_2982dc30aa931f4db2ff53c648" ON "email_templates"  ("workspace_id") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_email_templates_workspace_name_language" ON "email_templates"  ("workspace_id", "name", "language_code") `);
        await queryRunner.query(`CREATE TABLE "platform_email_templates" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "name" character varying(120) NOT NULL, "is_system" boolean NOT NULL DEFAULT false, "description" character varying(240), "language_code" character varying(16) NOT NULL DEFAULT 'en', "subject" character varying(240), "mjml" text, "hbs" text NOT NULL, CONSTRAINT "PK_26508335be0d305ad80000f77a9" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_platform_email_templates_name_language" ON "platform_email_templates"  ("name", "language_code") `);
        await queryRunner.query(`CREATE TABLE "platform_smtp" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "from_address" character varying(240), "host" character varying(240) NOT NULL, "port" integer NOT NULL DEFAULT '587', "secure" boolean NOT NULL DEFAULT false, "username" character varying(240), "password" character varying(500), "is_validated" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_225e3aa389bacc9b3055aa4d048" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "conversations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "workspace_id" uuid NOT NULL, "source_type" character varying(80) NOT NULL, "source_id" uuid NOT NULL, "subject" character varying(240) NOT NULL, "status" character varying(24) NOT NULL DEFAULT 'open', "last_message_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_ee34f4f7ced4ec8681f26bf04ef" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_664e8d7cbdae35df5cae341352" ON "conversations"  ("workspace_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_7a6cf42edc3d5388603b179714" ON "conversations"  ("workspace_id", "status", "updated_at") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_fc3184eae5727c79b416f5740f" ON "conversations"  ("workspace_id", "source_type", "source_id") `);
        await queryRunner.query(`CREATE TABLE "conversation_messages" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "workspace_id" uuid NOT NULL, "conversation_id" uuid NOT NULL, "author_user_id" uuid, "kind" character varying(24) NOT NULL DEFAULT 'message', "body" text NOT NULL, "attachments" jsonb, "metadata" jsonb, CONSTRAINT "PK_113248f25c4c0a7c179b3f5a609" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_12ae69a28377f0ff99c856e8bb" ON "conversation_messages"  ("workspace_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_8e166abf2dd2ee28670e53e680" ON "conversation_messages"  ("conversation_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_0ed44977e7a02e315832ffe0e9" ON "conversation_messages"  ("author_user_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_ba4b0e866a6b5f3d38364f08a7" ON "conversation_messages"  ("workspace_id", "conversation_id", "created_at") `);
        await queryRunner.query(`CREATE TABLE "conversation_participants" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "workspace_id" uuid NOT NULL, "conversation_id" uuid NOT NULL, "user_id" uuid NOT NULL, "role" character varying(24) NOT NULL DEFAULT 'participant', "joined_reason" character varying(24) NOT NULL, "last_read_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_61b51428ad9453f5921369fbe94" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_1482b617a3891a3893ee9a8901" ON "conversation_participants"  ("workspace_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_1559e8a16b828f2e836a231280" ON "conversation_participants"  ("conversation_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_377d4041a495b81ee1a85ae026" ON "conversation_participants"  ("user_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_e2b9fd5d5d3fd4ae9e39046d77" ON "conversation_participants"  ("workspace_id", "user_id", "updated_at") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_027c7306442e4b21f3b38b5967" ON "conversation_participants"  ("workspace_id", "conversation_id", "user_id") `);
        await queryRunner.query(`CREATE TABLE "user_notifications" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "workspace_id" uuid NOT NULL, "recipient_user_id" uuid NOT NULL, "actor_user_id" uuid, "kind" character varying(24) NOT NULL DEFAULT 'info', "title" character varying(240) NOT NULL, "body" text, "source_type" character varying(80), "source_id" uuid, "payload" jsonb, "status" character varying(16) NOT NULL DEFAULT 'unread', "read_at" TIMESTAMP WITH TIME ZONE, "dismissed_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_569622b0fd6e6ab3661de985a2b" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_14c3aac4fa45210bfd61640e67" ON "user_notifications"  ("workspace_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_fb5bd0191f165e00ee59a62c0d" ON "user_notifications"  ("recipient_user_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_b0031b42ab42728a9eef8b3965" ON "user_notifications"  ("actor_user_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_cc923489266c6af059d408e303" ON "user_notifications"  ("workspace_id", "recipient_user_id", "status", "created_at") `);
        await queryRunner.query(`CREATE TABLE "tickets" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "workspace_id" uuid NOT NULL, "requester_user_id" uuid NOT NULL, "assignee_user_id" uuid, "conversation_id" uuid, "subject" character varying(240) NOT NULL, "participant_user_ids" uuid array NOT NULL DEFAULT ARRAY[]::uuid[], "status" character varying(24) NOT NULL DEFAULT 'open', "requester_closed_at" TIMESTAMP WITH TIME ZONE, "handler_closed_at" TIMESTAMP WITH TIME ZONE, "last_message_at" TIMESTAMP WITH TIME ZONE, "archived_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_343bc942ae261cf7a1377f48fd0" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_d4beb915a8f7487afcb2d073c0" ON "tickets"  ("workspace_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_ed892ec8f6f6b0791bf87831cd" ON "tickets"  ("requester_user_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_53d19b120a46de906e8fb2660d" ON "tickets"  ("assignee_user_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_9d19b18bc1a9734b2bfde504bf" ON "tickets"  ("conversation_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_tickets_workspace_status_updated" ON "tickets"  ("workspace_id", "status", "updated_at") `);
        await queryRunner.query(`CREATE TABLE "ticket_messages" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "workspace_id" uuid NOT NULL, "ticket_id" uuid NOT NULL, "author_user_id" uuid, "kind" character varying(24) NOT NULL DEFAULT 'message', "body" text NOT NULL, "attachments" jsonb, CONSTRAINT "PK_37beb692dedf7eccb4e519ccec1" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_e7688c49fe65ef5526664a1540" ON "ticket_messages"  ("workspace_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_75b3a5f421dbf7b73778da519c" ON "ticket_messages"  ("ticket_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_3e88c03ef5510fba29faf03fc8" ON "ticket_messages"  ("author_user_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_bbe50eb66bb489fd477cf86f97" ON "ticket_messages"  ("workspace_id", "ticket_id", "created_at") `);
        await queryRunner.query(`CREATE TABLE "platform_settings" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "name" character varying(160) NOT NULL, "value" text, "value_type" character varying(32) NOT NULL DEFAULT 'string', "value_options" jsonb, "scope" character varying(80) NOT NULL DEFAULT 'global', CONSTRAINT "PK_2934aeb70ec285196dcab4a2e96" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_1e65868846c19869bd41115aff" ON "platform_settings"  ("name") `);
        await queryRunner.query(`CREATE TABLE "workspace_settings" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "workspace_id" uuid NOT NULL, "name" character varying(120) NOT NULL, "value" text, "value_type" character varying(32) NOT NULL DEFAULT 'string', "value_options" jsonb, CONSTRAINT "PK_69225c0ca64bcbbf9af8a217043" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_a6abc1c3ed0df635955fc852f1" ON "workspace_settings"  ("workspace_id") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_workspace_settings_name" ON "workspace_settings"  ("workspace_id", "name") `);
        await queryRunner.query(`CREATE TABLE "access_audit_logs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "workspace_id" uuid, "actor_id" uuid, "principal_type" character varying(24) NOT NULL, "permission" character varying(220) NOT NULL, "result" character varying(16) NOT NULL, "target_workspace_id" uuid, "http_method" character varying(16), "http_path" character varying(500), "status_code" integer, "error_code" character varying(120), CONSTRAINT "PK_92362eda47f20e6eff693801adc" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_access_audit_actor" ON "access_audit_logs"  ("actor_id", "created_at") `);
        await queryRunner.query(`CREATE INDEX "IDX_access_audit_workspace" ON "access_audit_logs"  ("workspace_id", "created_at") `);
        await queryRunner.query(`CREATE INDEX "IDX_access_audit_created_at" ON "access_audit_logs"  ("created_at") `);
        await queryRunner.query(`CREATE TABLE "email_verifications" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "token" character varying(500) NOT NULL, "user_id" uuid NOT NULL, "valid_until" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "REL_c4f1838323ae1dff5aa0014891" UNIQUE ("user_id"), CONSTRAINT "PK_c1ea2921e767f83cd44c0af203f" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_595be4c36e66b21d3fd14c73a2" ON "email_verifications"  ("token") `);
        await queryRunner.query(`CREATE INDEX "IDX_c4f1838323ae1dff5aa0014891" ON "email_verifications"  ("user_id") `);
        await queryRunner.query(`CREATE TABLE "integration_tokens" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "workspace_id" uuid NOT NULL, "owner_user_id" uuid NOT NULL, "scope" character varying(24) NOT NULL, "note" character varying(160), "token_hash" character varying(64) NOT NULL, "token_prefix" character varying(32) NOT NULL, "permissions" jsonb NOT NULL DEFAULT '[]'::jsonb, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "last_used_at" TIMESTAMP WITH TIME ZONE, "revoked_at" TIMESTAMP WITH TIME ZONE, "revoked_reason" character varying(80), CONSTRAINT "PK_1bae04d34fd9d6c620a507e9800" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_23dc65264e645db6ce2611a261" ON "integration_tokens"  ("workspace_id") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_integration_tokens_hash" ON "integration_tokens"  ("token_hash") `);
        await queryRunner.query(`CREATE INDEX "IDX_integration_tokens_owner" ON "integration_tokens"  ("owner_user_id") `);
        await queryRunner.query(`CREATE TABLE "invites" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "context_type" character varying(24) NOT NULL DEFAULT 'workspace', "workspace_id" uuid, "token" character varying(500) NOT NULL, "email" character varying(240), "status" character varying(24) NOT NULL DEFAULT 'invited', "expire_date" TIMESTAMP WITH TIME ZONE, "action_date" TIMESTAMP WITH TIME ZONE, "closed_at" TIMESTAMP WITH TIME ZONE, "accepted_count" integer NOT NULL DEFAULT '0', "accepted_user_id" uuid, "invited_by_id" uuid, "role_id" uuid NOT NULL, CONSTRAINT "CHK_invites_context_workspace" CHECK ((context_type = 'platform' AND workspace_id IS NULL) OR (context_type = 'workspace' AND workspace_id IS NOT NULL)), CONSTRAINT "PK_aa52e96b44a714372f4dd31a0af" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_a3ad8c552d7c4c5320758376c1" ON "invites"  ("workspace_id") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_18a9a6c85f7cc6f42ebef3b318" ON "invites"  ("token") `);
        await queryRunner.query(`CREATE INDEX "IDX_01076ebb6349b0140f9c22eb47" ON "invites"  ("accepted_user_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_997b4c1cbb58bd9467ab0f8e0e" ON "invites"  ("invited_by_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_invites_role" ON "invites" ("role_id")`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_invites_active_workspace_email" ON "invites"  ("workspace_id", "email") WHERE context_type = 'workspace' AND status = 'invited' AND email IS NOT NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_invites_active_platform_email" ON "invites"  ("email") WHERE context_type = 'platform' AND status = 'invited' AND email IS NOT NULL`);
        await queryRunner.query(`CREATE TABLE "password_reset" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "email" character varying(240) NOT NULL, "token" character varying(500) NOT NULL, CONSTRAINT "PK_8515e60a2cc41584fa4784f52ce" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_password_reset_email" ON "password_reset" ("email")`);
        await queryRunner.query(`CREATE INDEX "IDX_36e929b98372d961bb63bd4b4e" ON "password_reset"  ("token") `);
        await queryRunner.query(`CREATE TABLE "permissions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "code" character varying(220), "entity" character varying(80) NOT NULL, "entity_label" character varying(120), "entity_order" integer, "purpose" character varying(80), "purpose_label" character varying(120), "purpose_order" integer, "operation" character varying(80), "operation_label" character varying(120), "operation_order" integer, "action" character varying(24), "scope" character varying(24) NOT NULL, "description" character varying(240), "is_dangerous" boolean NOT NULL DEFAULT false, "source" character varying(32) NOT NULL DEFAULT 'controller', "default_roles" jsonb, CONSTRAINT "PK_920331560282b8bd21bb02290df" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_8dad765629e83229da6feda1c1" ON "permissions"  ("code") `);
        await queryRunner.query(`CREATE TABLE "platform_memberships" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "account_id" uuid NOT NULL, "role_id" uuid, "status" character varying(24) NOT NULL DEFAULT 'active', "removed_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "CHK_platform_membership_role_status" CHECK ((status = 'removed' AND role_id IS NULL) OR (status IN ('active', 'disabled') AND role_id IS NOT NULL)), CONSTRAINT "PK_platform_memberships" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_platform_memberships_account" ON "platform_memberships" ("account_id")`);
        await queryRunner.query(`CREATE INDEX "IDX_platform_memberships_role" ON "platform_memberships" ("role_id")`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_platform_memberships_account" ON "platform_memberships" ("account_id")`);
        await queryRunner.query(`CREATE TABLE "role_permissions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "role_id" uuid NOT NULL, "permission_id" uuid NOT NULL, "enabled" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_84059017c90bfcb701b8fa42297" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_178199805b901ccd220ab7740e" ON "role_permissions"  ("role_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_17022daf3f885f7d35423e9971" ON "role_permissions"  ("permission_id") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_role_permissions_role_permission" ON "role_permissions" ("role_id", "permission_id")`);
        await queryRunner.query(`CREATE TABLE "roles" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "workspace_id" uuid, "scope" character varying(24) NOT NULL DEFAULT 'workspace', "name" character varying(80) NOT NULL, "label" character varying(120) NOT NULL, "display_name" character varying(120), "color" character varying(40), "description" text, "is_system" boolean NOT NULL DEFAULT false, CONSTRAINT "CHK_roles_scope_workspace" CHECK ((scope = 'platform' AND workspace_id IS NULL) OR (scope = 'workspace' AND workspace_id IS NOT NULL)), CONSTRAINT "PK_c1433d71a4838793a49dcad46ab" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_e59a01f4fe46ebbece575d9a0f" ON "roles"  ("workspace_id") `);
        await queryRunner.query(`CREATE TABLE "workspaces" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "name" character varying(120) NOT NULL, "slug" character varying(80) NOT NULL, "subdomain" character varying(80), "status" character varying(24) NOT NULL DEFAULT 'provisioning', "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_53be67a04681c66b87ee27c9321" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_workspaces_active_subdomain" ON "workspaces"  ("subdomain") WHERE subdomain IS NOT NULL AND deleted_at IS NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_workspaces_active_slug" ON "workspaces"  ("slug") WHERE deleted_at IS NULL`);
        await queryRunner.query(`CREATE TABLE "workspace_applications" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "requested_name" character varying(120) NOT NULL, "requested_slug" character varying(80) NOT NULL, "requested_subdomain" character varying(80), "owner_email" character varying(160) NOT NULL, "owner_display_name" character varying(120) NOT NULL, "preferred_language" character varying(16) NOT NULL DEFAULT 'zh-Hans', "email_verification_token_hash" character varying(240), "cancellation_token_hash" character varying(240), "email_verified_at" TIMESTAMP WITH TIME ZONE, "status" character varying(40) NOT NULL DEFAULT 'pending_email_verification', "reviewed_by_account_id" uuid, "reviewed_at" TIMESTAMP WITH TIME ZONE, "review_note" text, "workspace_id" uuid, CONSTRAINT "PK_fcf676d43b4f71f9955558cc57b" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_eef07ea747642deed7a4f8c736" ON "workspace_applications"  ("owner_email") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_workspace_applications_active_slug" ON "workspace_applications"  ("requested_slug") WHERE status IN ('pending_email_verification', 'pending_review', 'approved')`);
        await queryRunner.query(`CREATE TABLE "user_workspace_roles" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "workspace_id" uuid NOT NULL, "user_id" uuid NOT NULL, "role_id" uuid, "status" character varying(24) NOT NULL DEFAULT 'active', "removed_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "CHK_workspace_membership_role_status" CHECK ((status = 'removed' AND role_id IS NULL) OR (status IN ('active', 'disabled') AND role_id IS NOT NULL)), CONSTRAINT "PK_7174671598961c30d50f887c322" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_66b61e2e8b6620a700adb8af97" ON "user_workspace_roles"  ("workspace_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_52c20b54099ee6de952e17f715" ON "user_workspace_roles"  ("user_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_5fb993cbf81427a9a03258cb60" ON "user_workspace_roles"  ("role_id") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_user_workspace_roles" ON "user_workspace_roles"  ("workspace_id", "user_id") `);
        await queryRunner.query(`CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "type" character varying(24) NOT NULL DEFAULT 'user', "display_name" character varying(120) NOT NULL, "nickname" character varying(120), "first_name" character varying(80), "last_name" character varying(80), "email" character varying(160) NOT NULL, "username" character varying(80), "password_hash" character varying(240), "credential_version" integer NOT NULL DEFAULT 0, "credentials_changed_at" TIMESTAMP WITH TIME ZONE, "refresh_token" character varying(240), "image_url" character varying(500), "avatar_url" character varying(500), "preferred_language" character varying(16), "email_verified" boolean NOT NULL DEFAULT false, "mobile" character varying(32), "time_zone" character varying(40), "third_party_id" character varying(120), "status" character varying(24) NOT NULL DEFAULT 'active', "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_fe0bb3f6520ee0469504521e71" ON "users"  ("username") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_users_email" ON "users" (lower("email")) WHERE "deleted_at" IS NULL`);
        await queryRunner.query(`ALTER TABLE "custom_smtp" ADD CONSTRAINT "FK_848de9eb4c0bc0216f6a0590b74" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "email_sent" ADD CONSTRAINT "FK_ba367d498a4ed1ad9277333d83e" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "email_templates" ADD CONSTRAINT "FK_2982dc30aa931f4db2ff53c6487" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "conversations" ADD CONSTRAINT "FK_664e8d7cbdae35df5cae341352a" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "conversation_messages" ADD CONSTRAINT "FK_12ae69a28377f0ff99c856e8bb7" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "conversation_messages" ADD CONSTRAINT "FK_8e166abf2dd2ee28670e53e6803" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "conversation_messages" ADD CONSTRAINT "FK_0ed44977e7a02e315832ffe0e9f" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "conversation_participants" ADD CONSTRAINT "FK_1482b617a3891a3893ee9a89013" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "conversation_participants" ADD CONSTRAINT "FK_1559e8a16b828f2e836a2312800" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "conversation_participants" ADD CONSTRAINT "FK_377d4041a495b81ee1a85ae026f" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "user_notifications" ADD CONSTRAINT "FK_14c3aac4fa45210bfd61640e67b" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "user_notifications" ADD CONSTRAINT "FK_fb5bd0191f165e00ee59a62c0dc" FOREIGN KEY ("recipient_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "user_notifications" ADD CONSTRAINT "FK_b0031b42ab42728a9eef8b39655" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "tickets" ADD CONSTRAINT "FK_d4beb915a8f7487afcb2d073c01" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "tickets" ADD CONSTRAINT "FK_ed892ec8f6f6b0791bf87831cd9" FOREIGN KEY ("requester_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "tickets" ADD CONSTRAINT "FK_53d19b120a46de906e8fb2660dd" FOREIGN KEY ("assignee_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "tickets" ADD CONSTRAINT "FK_9d19b18bc1a9734b2bfde504bf2" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "ticket_messages" ADD CONSTRAINT "FK_e7688c49fe65ef5526664a1540e" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "ticket_messages" ADD CONSTRAINT "FK_75b3a5f421dbf7b73778da519cb" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "ticket_messages" ADD CONSTRAINT "FK_3e88c03ef5510fba29faf03fc82" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "workspace_settings" ADD CONSTRAINT "FK_a6abc1c3ed0df635955fc852f1c" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "email_verifications" ADD CONSTRAINT "FK_c4f1838323ae1dff5aa00148915" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "integration_tokens" ADD CONSTRAINT "FK_23dc65264e645db6ce2611a2612" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "invites" ADD CONSTRAINT "FK_a3ad8c552d7c4c5320758376c1b" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "invites" ADD CONSTRAINT "FK_01076ebb6349b0140f9c22eb474" FOREIGN KEY ("accepted_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "invites" ADD CONSTRAINT "FK_997b4c1cbb58bd9467ab0f8e0e3" FOREIGN KEY ("invited_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "role_permissions" ADD CONSTRAINT "FK_178199805b901ccd220ab7740ec" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "role_permissions" ADD CONSTRAINT "FK_17022daf3f885f7d35423e9971e" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "roles" ADD CONSTRAINT "FK_e59a01f4fe46ebbece575d9a0fc" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "workspace_applications" ADD CONSTRAINT "FK_workspace_applications_reviewer_account" FOREIGN KEY ("reviewed_by_account_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "workspace_applications" ADD CONSTRAINT "FK_324d1973ddcfa08c25a7cce0bab" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "user_workspace_roles" ADD CONSTRAINT "FK_66b61e2e8b6620a700adb8af976" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "user_workspace_roles" ADD CONSTRAINT "FK_52c20b54099ee6de952e17f7150" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "user_workspace_roles" ADD CONSTRAINT "FK_5fb993cbf81427a9a03258cb604" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "platform_memberships" ADD CONSTRAINT "FK_platform_memberships_account" FOREIGN KEY ("account_id") REFERENCES "users"("id") ON DELETE RESTRICT`);
        await queryRunner.query(`ALTER TABLE "platform_memberships" ADD CONSTRAINT "FK_platform_memberships_role" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT`);

        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_roles_workspace_identity" ON "roles" ("workspace_id", "id")`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_conversations_workspace_identity" ON "conversations" ("workspace_id", "id")`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_tickets_workspace_identity" ON "tickets" ("workspace_id", "id")`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_roles_workspace_name" ON "roles" ("workspace_id", lower("name")) WHERE scope = 'workspace'`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_roles_platform_name" ON "roles" (lower("name")) WHERE scope = 'platform'`);

        await queryRunner.query(`CREATE OR REPLACE FUNCTION enforce_context_role_scope() RETURNS trigger AS $$
          DECLARE role_scope character varying(24);
          BEGIN
            IF NEW.role_id IS NULL THEN RETURN NEW; END IF;
            SELECT scope INTO role_scope FROM roles WHERE id = NEW.role_id;
            IF role_scope IS NULL THEN RAISE EXCEPTION 'role does not exist'; END IF;
            IF TG_TABLE_NAME = 'platform_memberships' AND role_scope <> 'platform' THEN
              RAISE EXCEPTION 'platform membership requires a platform role';
            END IF;
            IF TG_TABLE_NAME = 'user_workspace_roles' AND role_scope <> 'workspace' THEN
              RAISE EXCEPTION 'workspace membership requires a workspace role';
            END IF;
            IF TG_TABLE_NAME = 'invites' AND role_scope <> (to_jsonb(NEW)->>'context_type') THEN
              RAISE EXCEPTION 'invite role scope must match invite context';
            END IF;
            RETURN NEW;
          END;
        $$ LANGUAGE plpgsql`);
        await queryRunner.query(`CREATE TRIGGER "TR_platform_memberships_role_scope" BEFORE INSERT OR UPDATE OF "role_id" ON "platform_memberships" FOR EACH ROW EXECUTE FUNCTION enforce_context_role_scope()`);
        await queryRunner.query(`CREATE TRIGGER "TR_workspace_memberships_role_scope" BEFORE INSERT OR UPDATE OF "role_id" ON "user_workspace_roles" FOR EACH ROW EXECUTE FUNCTION enforce_context_role_scope()`);
        await queryRunner.query(`CREATE TRIGGER "TR_invites_role_scope" BEFORE INSERT OR UPDATE OF "role_id", "context_type" ON "invites" FOR EACH ROW EXECUTE FUNCTION enforce_context_role_scope()`);
        await queryRunner.query(`CREATE OR REPLACE FUNCTION enforce_role_permission_scope() RETURNS trigger AS $$
          DECLARE role_scope character varying(24);
          DECLARE permission_scope character varying(24);
          BEGIN
            SELECT scope INTO role_scope FROM roles WHERE id = NEW.role_id;
            SELECT scope INTO permission_scope FROM permissions WHERE id = NEW.permission_id;
            IF role_scope = 'platform' AND permission_scope <> 'platform' THEN
              RAISE EXCEPTION 'platform roles may only receive platform permissions';
            END IF;
            IF role_scope = 'workspace' AND permission_scope NOT IN ('workspace', 'own') THEN
              RAISE EXCEPTION 'workspace roles may only receive workspace or own permissions';
            END IF;
            RETURN NEW;
          END;
        $$ LANGUAGE plpgsql`);
        await queryRunner.query(`CREATE TRIGGER "TR_role_permissions_scope" BEFORE INSERT OR UPDATE OF "role_id", "permission_id" ON "role_permissions" FOR EACH ROW EXECUTE FUNCTION enforce_role_permission_scope()`);

        await queryRunner.query(`ALTER TABLE "integration_tokens" ADD CONSTRAINT "CHK_integration_tokens_workspace_scope" CHECK (scope = 'workspace')`);
        await queryRunner.query(`ALTER TABLE "user_workspace_roles" ADD CONSTRAINT "FK_user_workspace_roles_workspace_role" FOREIGN KEY ("workspace_id", "role_id") REFERENCES "roles"("workspace_id", "id") ON DELETE RESTRICT`);
        await queryRunner.query(`ALTER TABLE "conversation_messages" ADD CONSTRAINT "FK_conversation_messages_workspace_conversation" FOREIGN KEY ("workspace_id", "conversation_id") REFERENCES "conversations"("workspace_id", "id") ON DELETE CASCADE`);
        await queryRunner.query(`ALTER TABLE "conversation_messages" ADD CONSTRAINT "FK_conversation_messages_workspace_author" FOREIGN KEY ("workspace_id", "author_user_id") REFERENCES "user_workspace_roles"("workspace_id", "user_id") ON DELETE RESTRICT`);
        await queryRunner.query(`ALTER TABLE "conversation_participants" ADD CONSTRAINT "FK_conversation_participants_workspace_conversation" FOREIGN KEY ("workspace_id", "conversation_id") REFERENCES "conversations"("workspace_id", "id") ON DELETE CASCADE`);
        await queryRunner.query(`ALTER TABLE "conversation_participants" ADD CONSTRAINT "FK_conversation_participants_workspace_user" FOREIGN KEY ("workspace_id", "user_id") REFERENCES "user_workspace_roles"("workspace_id", "user_id") ON DELETE RESTRICT`);
        await queryRunner.query(`ALTER TABLE "tickets" ADD CONSTRAINT "FK_tickets_workspace_requester" FOREIGN KEY ("workspace_id", "requester_user_id") REFERENCES "user_workspace_roles"("workspace_id", "user_id") ON DELETE RESTRICT`);
        await queryRunner.query(`ALTER TABLE "tickets" ADD CONSTRAINT "FK_tickets_workspace_assignee" FOREIGN KEY ("workspace_id", "assignee_user_id") REFERENCES "user_workspace_roles"("workspace_id", "user_id") ON DELETE RESTRICT`);
        await queryRunner.query(`ALTER TABLE "tickets" ADD CONSTRAINT "FK_tickets_workspace_conversation" FOREIGN KEY ("workspace_id", "conversation_id") REFERENCES "conversations"("workspace_id", "id") ON DELETE SET NULL`);
        await queryRunner.query(`ALTER TABLE "ticket_messages" ADD CONSTRAINT "FK_ticket_messages_workspace_ticket" FOREIGN KEY ("workspace_id", "ticket_id") REFERENCES "tickets"("workspace_id", "id") ON DELETE CASCADE`);
        await queryRunner.query(`ALTER TABLE "ticket_messages" ADD CONSTRAINT "FK_ticket_messages_workspace_author" FOREIGN KEY ("workspace_id", "author_user_id") REFERENCES "user_workspace_roles"("workspace_id", "user_id") ON DELETE RESTRICT`);
        await queryRunner.query(`ALTER TABLE "user_notifications" ADD CONSTRAINT "FK_user_notifications_workspace_recipient" FOREIGN KEY ("workspace_id", "recipient_user_id") REFERENCES "user_workspace_roles"("workspace_id", "user_id") ON DELETE RESTRICT`);
        await queryRunner.query(`ALTER TABLE "user_notifications" ADD CONSTRAINT "FK_user_notifications_workspace_actor" FOREIGN KEY ("workspace_id", "actor_user_id") REFERENCES "user_workspace_roles"("workspace_id", "user_id") ON DELETE RESTRICT`);
        await queryRunner.query(`ALTER TABLE "integration_tokens" ADD CONSTRAINT "FK_integration_tokens_workspace_owner" FOREIGN KEY ("workspace_id", "owner_user_id") REFERENCES "user_workspace_roles"("workspace_id", "user_id") ON DELETE RESTRICT`);
        await queryRunner.query(`ALTER TABLE "invites" ADD CONSTRAINT "FK_invites_workspace_accepted_user" FOREIGN KEY ("workspace_id", "accepted_user_id") REFERENCES "user_workspace_roles"("workspace_id", "user_id") ON DELETE RESTRICT`);
        await queryRunner.query(`ALTER TABLE "invites" ADD CONSTRAINT "FK_invites_workspace_invited_by" FOREIGN KEY ("workspace_id", "invited_by_id") REFERENCES "user_workspace_roles"("workspace_id", "user_id") ON DELETE RESTRICT`);
        await queryRunner.query(`ALTER TABLE "invites" ADD CONSTRAINT "FK_invites_role" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT`);
        await queryRunner.query(`ALTER TABLE "invites" ADD CONSTRAINT "FK_invites_workspace_role" FOREIGN KEY ("workspace_id", "role_id") REFERENCES "roles"("workspace_id", "id") ON DELETE RESTRICT`);

    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        for (const [table, constraint] of [
            ["invites", "FK_invites_workspace_workspace_role"], ["invites", "FK_invites_workspace_invited_by"], ["invites", "FK_invites_workspace_accepted_user"],
            ["integration_tokens", "FK_integration_tokens_workspace_owner"], ["email_verifications", "FK_email_verifications_workspace_user"],
            ["user_notifications", "FK_user_notifications_workspace_actor"], ["user_notifications", "FK_user_notifications_workspace_recipient"],
            ["ticket_messages", "FK_ticket_messages_workspace_author"], ["ticket_messages", "FK_ticket_messages_workspace_ticket"],
            ["tickets", "FK_tickets_workspace_conversation"], ["tickets", "FK_tickets_workspace_assignee"], ["tickets", "FK_tickets_workspace_requester"],
            ["conversation_participants", "FK_conversation_participants_workspace_user"], ["conversation_participants", "FK_conversation_participants_workspace_conversation"],
            ["conversation_messages", "FK_conversation_messages_workspace_author"], ["conversation_messages", "FK_conversation_messages_workspace_conversation"],
            ["user_workspace_roles", "FK_user_workspace_roles_workspace_role"], ["user_workspace_roles", "FK_user_workspace_roles_workspace_user"],
            ["role_permissions", "FK_role_permissions_workspace_role"],
        ] as const) {
            await queryRunner.query(`ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "${constraint}"`);
        }
        await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "FK_109638590074998bb72a2f2cf08"`);
        await queryRunner.query(`ALTER TABLE "user_workspace_roles" DROP CONSTRAINT "FK_5fb993cbf81427a9a03258cb604"`);
        await queryRunner.query(`ALTER TABLE "user_workspace_roles" DROP CONSTRAINT "FK_52c20b54099ee6de952e17f7150"`);
        await queryRunner.query(`ALTER TABLE "user_workspace_roles" DROP CONSTRAINT "FK_66b61e2e8b6620a700adb8af976"`);
        await queryRunner.query(`ALTER TABLE "workspace_applications" DROP CONSTRAINT "FK_324d1973ddcfa08c25a7cce0bab"`);
        await queryRunner.query(`ALTER TABLE "workspace_applications" DROP CONSTRAINT "FK_8adb974013a5e21652b3fec0ea4"`);
        await queryRunner.query(`ALTER TABLE "roles" DROP CONSTRAINT "FK_e59a01f4fe46ebbece575d9a0fc"`);
        await queryRunner.query(`ALTER TABLE "role_permissions" DROP CONSTRAINT "FK_17022daf3f885f7d35423e9971e"`);
        await queryRunner.query(`ALTER TABLE "role_permissions" DROP CONSTRAINT "FK_178199805b901ccd220ab7740ec"`);
        await queryRunner.query(`ALTER TABLE "role_permissions" DROP CONSTRAINT "FK_d6fcb39857e2116aff96b97df0b"`);
        await queryRunner.query(`ALTER TABLE "password_reset" DROP CONSTRAINT "FK_2ec7e8eaad7c044ee702c48f622"`);
        await queryRunner.query(`ALTER TABLE "invites" DROP CONSTRAINT "FK_997b4c1cbb58bd9467ab0f8e0e3"`);
        await queryRunner.query(`ALTER TABLE "invites" DROP CONSTRAINT "FK_01076ebb6349b0140f9c22eb474"`);
        await queryRunner.query(`ALTER TABLE "invites" DROP CONSTRAINT "FK_a3ad8c552d7c4c5320758376c1b"`);
        await queryRunner.query(`ALTER TABLE "integration_tokens" DROP CONSTRAINT "FK_23dc65264e645db6ce2611a2612"`);
        await queryRunner.query(`ALTER TABLE "email_verifications" DROP CONSTRAINT "FK_c4f1838323ae1dff5aa00148915"`);
        await queryRunner.query(`ALTER TABLE "email_verifications" DROP CONSTRAINT "FK_0f78c2f8d74e9d0c58270e49737"`);
        await queryRunner.query(`ALTER TABLE "workspace_settings" DROP CONSTRAINT "FK_a6abc1c3ed0df635955fc852f1c"`);
        await queryRunner.query(`ALTER TABLE "ticket_messages" DROP CONSTRAINT "FK_3e88c03ef5510fba29faf03fc82"`);
        await queryRunner.query(`ALTER TABLE "ticket_messages" DROP CONSTRAINT "FK_75b3a5f421dbf7b73778da519cb"`);
        await queryRunner.query(`ALTER TABLE "ticket_messages" DROP CONSTRAINT "FK_e7688c49fe65ef5526664a1540e"`);
        await queryRunner.query(`ALTER TABLE "tickets" DROP CONSTRAINT "FK_9d19b18bc1a9734b2bfde504bf2"`);
        await queryRunner.query(`ALTER TABLE "tickets" DROP CONSTRAINT "FK_53d19b120a46de906e8fb2660dd"`);
        await queryRunner.query(`ALTER TABLE "tickets" DROP CONSTRAINT "FK_ed892ec8f6f6b0791bf87831cd9"`);
        await queryRunner.query(`ALTER TABLE "tickets" DROP CONSTRAINT "FK_d4beb915a8f7487afcb2d073c01"`);
        await queryRunner.query(`ALTER TABLE "user_notifications" DROP CONSTRAINT "FK_b0031b42ab42728a9eef8b39655"`);
        await queryRunner.query(`ALTER TABLE "user_notifications" DROP CONSTRAINT "FK_fb5bd0191f165e00ee59a62c0dc"`);
        await queryRunner.query(`ALTER TABLE "user_notifications" DROP CONSTRAINT "FK_14c3aac4fa45210bfd61640e67b"`);
        await queryRunner.query(`ALTER TABLE "conversation_participants" DROP CONSTRAINT "FK_377d4041a495b81ee1a85ae026f"`);
        await queryRunner.query(`ALTER TABLE "conversation_participants" DROP CONSTRAINT "FK_1559e8a16b828f2e836a2312800"`);
        await queryRunner.query(`ALTER TABLE "conversation_participants" DROP CONSTRAINT "FK_1482b617a3891a3893ee9a89013"`);
        await queryRunner.query(`ALTER TABLE "conversation_messages" DROP CONSTRAINT "FK_0ed44977e7a02e315832ffe0e9f"`);
        await queryRunner.query(`ALTER TABLE "conversation_messages" DROP CONSTRAINT "FK_8e166abf2dd2ee28670e53e6803"`);
        await queryRunner.query(`ALTER TABLE "conversation_messages" DROP CONSTRAINT "FK_12ae69a28377f0ff99c856e8bb7"`);
        await queryRunner.query(`ALTER TABLE "conversations" DROP CONSTRAINT "FK_664e8d7cbdae35df5cae341352a"`);
        await queryRunner.query(`ALTER TABLE "email_templates" DROP CONSTRAINT "FK_2982dc30aa931f4db2ff53c6487"`);
        await queryRunner.query(`ALTER TABLE "email_sent" DROP CONSTRAINT "FK_ba367d498a4ed1ad9277333d83e"`);
        await queryRunner.query(`ALTER TABLE "custom_smtp" DROP CONSTRAINT "FK_848de9eb4c0bc0216f6a0590b74"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_users_workspace_identity"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_users_workspace_email"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_fe0bb3f6520ee0469504521e71"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_109638590074998bb72a2f2cf0"`);
        await queryRunner.query(`DROP TABLE "users"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_user_workspace_roles"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_5fb993cbf81427a9a03258cb60"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_52c20b54099ee6de952e17f715"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_66b61e2e8b6620a700adb8af97"`);
        await queryRunner.query(`DROP TABLE "user_workspace_roles"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_workspace_applications_active_slug"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_eef07ea747642deed7a4f8c736"`);
        await queryRunner.query(`DROP TABLE "workspace_applications"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_workspaces_active_slug"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_workspaces_active_subdomain"`);
        await queryRunner.query(`DROP TABLE "workspaces"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_roles_workspace_name"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_e59a01f4fe46ebbece575d9a0f"`);
        await queryRunner.query(`DROP TABLE "roles"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_ed6a34575e6c8e056496451a5d"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_2034ff8830f4c9ed8b345e64fb"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_0ab5175ebb91e7a07f850acf42"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_17022daf3f885f7d35423e9971"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_178199805b901ccd220ab7740e"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_d6fcb39857e2116aff96b97df0"`);
        await queryRunner.query(`DROP TABLE "role_permissions"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_8dad765629e83229da6feda1c1"`);
        await queryRunner.query(`DROP TABLE "permissions"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_36e929b98372d961bb63bd4b4e"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_86f7d41bc58f3860784cd6ce83"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_2ec7e8eaad7c044ee702c48f62"`);
        await queryRunner.query(`DROP TABLE "password_reset"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_invites_active_workspace_email"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_invites_workspace_role"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_997b4c1cbb58bd9467ab0f8e0e"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_01076ebb6349b0140f9c22eb47"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_18a9a6c85f7cc6f42ebef3b318"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_a3ad8c552d7c4c5320758376c1"`);
        await queryRunner.query(`DROP TABLE "invites"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_integration_tokens_owner"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_integration_tokens_hash"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_23dc65264e645db6ce2611a261"`);
        await queryRunner.query(`DROP TABLE "integration_tokens"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_c4f1838323ae1dff5aa0014891"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_595be4c36e66b21d3fd14c73a2"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_0f78c2f8d74e9d0c58270e4973"`);
        await queryRunner.query(`DROP TABLE "email_verifications"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_access_audit_created_at"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_access_audit_workspace"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_access_audit_actor"`);
        await queryRunner.query(`DROP TABLE "access_audit_logs"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_workspace_settings_name"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_a6abc1c3ed0df635955fc852f1"`);
        await queryRunner.query(`DROP TABLE "workspace_settings"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_1e65868846c19869bd41115aff"`);
        await queryRunner.query(`DROP TABLE "platform_settings"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_bbe50eb66bb489fd477cf86f97"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_3e88c03ef5510fba29faf03fc8"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_75b3a5f421dbf7b73778da519c"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_e7688c49fe65ef5526664a1540"`);
        await queryRunner.query(`DROP TABLE "ticket_messages"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_9ad9678e5afe98f7b9cbe36835"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_9d19b18bc1a9734b2bfde504bf"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_53d19b120a46de906e8fb2660d"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_ed892ec8f6f6b0791bf87831cd"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_3888d0e9675fae34ba7c056ca9"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_d4beb915a8f7487afcb2d073c0"`);
        await queryRunner.query(`DROP TABLE "tickets"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_cc923489266c6af059d408e303"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_b0031b42ab42728a9eef8b3965"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_fb5bd0191f165e00ee59a62c0d"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_14c3aac4fa45210bfd61640e67"`);
        await queryRunner.query(`DROP TABLE "user_notifications"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_027c7306442e4b21f3b38b5967"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_e2b9fd5d5d3fd4ae9e39046d77"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_377d4041a495b81ee1a85ae026"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_1559e8a16b828f2e836a231280"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_1482b617a3891a3893ee9a8901"`);
        await queryRunner.query(`DROP TABLE "conversation_participants"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_ba4b0e866a6b5f3d38364f08a7"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_0ed44977e7a02e315832ffe0e9"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_8e166abf2dd2ee28670e53e680"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_12ae69a28377f0ff99c856e8bb"`);
        await queryRunner.query(`DROP TABLE "conversation_messages"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_fc3184eae5727c79b416f5740f"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_7a6cf42edc3d5388603b179714"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_664e8d7cbdae35df5cae341352"`);
        await queryRunner.query(`DROP TABLE "conversations"`);
        await queryRunner.query(`DROP TABLE "platform_smtp"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_platform_email_templates_name_language"`);
        await queryRunner.query(`DROP TABLE "platform_email_templates"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_email_templates_workspace_name_language"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_2982dc30aa931f4db2ff53c648"`);
        await queryRunner.query(`DROP TABLE "email_templates"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_75ad4c431e7b109792ecaf4b9a"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_ba367d498a4ed1ad9277333d83"`);
        await queryRunner.query(`DROP TABLE "email_sent"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_848de9eb4c0bc0216f6a0590b7"`);
        await queryRunner.query(`DROP TABLE "custom_smtp"`);
    }

}
