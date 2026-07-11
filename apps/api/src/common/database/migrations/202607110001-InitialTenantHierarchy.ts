import type { MigrationInterface, QueryRunner } from "typeorm";
import { TENANT_DATABASE_GUCS } from "../tenant-database.constants.js";

export const TENANT_RLS_TABLES = [
  "users",
  "organizations",
  "departments",
  "roles",
  "role_permissions",
  "user_organizations",
  "user_departments",
  "user_tenant_roles",
  "user_organization_roles",
  "user_department_roles",
  "department_dispatch_relations",
  "tenant_settings",
  "organization_settings",
  "invites",
  "organization_contacts",
  "organization_languages",
  "organization_groups",
  "organization_group_members",
  "notification_destinations",
  "custom_smtp",
  "email_sent",
  "email_templates",
  "conversations",
  "conversation_messages",
  "conversation_participants",
  "tickets",
  "ticket_messages",
  "user_notifications",
  "integration_tokens",
  "password_reset",
  "email_verifications",
] as const;

/** Existing business tables that must be tenant-owned in a following migration. */
export const TENANT_RLS_GAPS = [] as const;

const idAndTimestamps = `
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()`;

export class InitialTenantHierarchy202607110001 implements MigrationInterface {
  name = "InitialTenantHierarchy202607110001";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);

    await queryRunner.query(`
      CREATE TABLE tenants (
        ${idAndTimestamps},
        name varchar(120) NOT NULL,
        slug varchar(80) NOT NULL,
        subdomain varchar(80),
        status varchar(24) NOT NULL DEFAULT 'provisioning',
        deleted_at timestamptz,
        CONSTRAINT chk_tenants_status CHECK (status IN ('provisioning','active','suspended','archived'))
      );
      CREATE UNIQUE INDEX uq_tenants_active_slug ON tenants (lower(slug)) WHERE deleted_at IS NULL;
      CREATE UNIQUE INDEX uq_tenants_active_subdomain ON tenants (lower(subdomain)) WHERE subdomain IS NOT NULL AND deleted_at IS NULL;

      CREATE TABLE permissions (
        ${idAndTimestamps},
        code varchar(220), entity varchar(80) NOT NULL, entity_label varchar(120), entity_order integer,
        purpose varchar(80), purpose_label varchar(120), purpose_order integer,
        operation varchar(80), operation_label varchar(120), operation_order integer,
        action varchar(24), scope varchar(24) NOT NULL, description varchar(240),
        is_dangerous boolean NOT NULL DEFAULT false, source varchar(32) NOT NULL DEFAULT 'controller',
        default_roles jsonb
      );
      CREATE UNIQUE INDEX uq_permissions_code ON permissions (code) WHERE code IS NOT NULL;

      CREATE TABLE platform_users (
        ${idAndTimestamps}, email varchar(160) NOT NULL, display_name varchar(120) NOT NULL,
        password_hash varchar(240), preferred_language varchar(16) NOT NULL DEFAULT 'zh-CN',
        status varchar(24) NOT NULL DEFAULT 'active', deleted_at timestamptz
      );
      CREATE UNIQUE INDEX uq_platform_users_email ON platform_users (lower(email)) WHERE deleted_at IS NULL;
      CREATE TABLE platform_roles (
        ${idAndTimestamps}, name varchar(80) NOT NULL UNIQUE, label varchar(120) NOT NULL,
        description text, is_system boolean NOT NULL DEFAULT false
      );
      CREATE TABLE platform_user_roles (
        ${idAndTimestamps}, platform_user_id uuid NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
        platform_role_id uuid NOT NULL REFERENCES platform_roles(id) ON DELETE CASCADE,
        UNIQUE (platform_user_id, platform_role_id)
      );
      CREATE TABLE platform_role_permissions (
        ${idAndTimestamps}, platform_role_id uuid NOT NULL REFERENCES platform_roles(id) ON DELETE CASCADE,
        permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
        enabled boolean NOT NULL DEFAULT true, UNIQUE (platform_role_id, permission_id)
      );
      CREATE TABLE access_audit_logs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        created_at timestamptz NOT NULL DEFAULT now(),
        tenant_id uuid, organization_id uuid, department_id uuid, actor_id uuid,
        principal_type varchar(24) NOT NULL, permission varchar(220) NOT NULL,
        result varchar(16) NOT NULL, target_tenant_id uuid,
        http_method varchar(16), http_path varchar(500), status_code integer,
        error_code varchar(120),
        CONSTRAINT chk_access_audit_result CHECK (result IN ('allowed','denied','error')),
        CONSTRAINT chk_access_audit_principal CHECK (
          principal_type IN ('anonymous','integration','platform','tenant'))
      );
      CREATE INDEX idx_access_audit_created_at ON access_audit_logs (created_at);
      CREATE INDEX idx_access_audit_tenant ON access_audit_logs (tenant_id, created_at);
      CREATE INDEX idx_access_audit_actor ON access_audit_logs (actor_id, created_at);
      CREATE FUNCTION prevent_access_audit_mutation() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'access_audit_logs is append-only';
      END;
      $$;
      CREATE TRIGGER trg_access_audit_immutable
        BEFORE UPDATE OR DELETE ON access_audit_logs
        FOR EACH ROW EXECUTE FUNCTION prevent_access_audit_mutation();
      CREATE TABLE platform_email_templates (
        ${idAndTimestamps}, name varchar(120) NOT NULL,
        is_system boolean NOT NULL DEFAULT false, description varchar(240),
        language_code varchar(16) NOT NULL DEFAULT 'en', subject varchar(240),
        mjml text, hbs text NOT NULL,
        CONSTRAINT uq_platform_email_templates_name_language UNIQUE (name, language_code)
      );
      CREATE TABLE platform_smtp (
        ${idAndTimestamps}, from_address varchar(240), host varchar(240) NOT NULL,
        port integer NOT NULL DEFAULT 587, secure boolean NOT NULL DEFAULT false,
        username varchar(240), password varchar(500),
        is_validated boolean NOT NULL DEFAULT false,
        CONSTRAINT chk_platform_smtp_port CHECK (port BETWEEN 1 AND 65535)
      );
      CREATE TABLE platform_settings (
        ${idAndTimestamps}, name varchar(160) NOT NULL,
        value text, value_type varchar(32) NOT NULL DEFAULT 'string',
        value_options jsonb, scope varchar(80) NOT NULL DEFAULT 'global',
        CONSTRAINT uq_platform_settings_name UNIQUE (name)
      );
      CREATE TABLE tenant_applications (
        ${idAndTimestamps}, requested_name varchar(120) NOT NULL, requested_slug varchar(80) NOT NULL,
        requested_subdomain varchar(80), owner_email varchar(160) NOT NULL,
        owner_display_name varchar(120) NOT NULL, preferred_language varchar(16) NOT NULL DEFAULT 'zh-CN',
        email_verification_token_hash varchar(240),
        cancellation_token_hash varchar(240),
        email_verified_at timestamptz, status varchar(40) NOT NULL DEFAULT 'pending_email_verification',
        reviewed_by_platform_user_id uuid REFERENCES platform_users(id) ON DELETE SET NULL,
        reviewed_at timestamptz, review_note text, tenant_id uuid REFERENCES tenants(id) ON DELETE RESTRICT,
        CONSTRAINT chk_tenant_applications_status CHECK (status IN ('pending_email_verification','pending_review','approved','rejected','cancelled'))
      );
      CREATE UNIQUE INDEX uq_tenant_applications_active_slug ON tenant_applications (lower(requested_slug))
        WHERE status IN ('pending_email_verification','pending_review','approved');

      CREATE TABLE users (
        ${idAndTimestamps}, tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
        type varchar(24) NOT NULL DEFAULT 'user', display_name varchar(120) NOT NULL,
        nickname varchar(120), first_name varchar(80), last_name varchar(80), email varchar(160) NOT NULL,
        username varchar(80), password_hash varchar(240), refresh_token varchar(240), image_url varchar(500),
        avatar_url varchar(500), preferred_language varchar(16) NOT NULL DEFAULT 'zh-CN',
        email_verified boolean NOT NULL DEFAULT false, mobile varchar(32), time_zone varchar(40),
        third_party_id varchar(120), status varchar(24) NOT NULL DEFAULT 'active', deleted_at timestamptz,
        UNIQUE (tenant_id, id)
      );
      CREATE UNIQUE INDEX uq_users_tenant_email ON users (tenant_id, lower(email)) WHERE deleted_at IS NULL;
      CREATE INDEX idx_users_tenant ON users (tenant_id);

      CREATE TABLE organizations (
        ${idAndTimestamps}, tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
        name varchar(120) NOT NULL, created_by_user_id uuid, slug varchar(80) NOT NULL, subdomain varchar(80),
        status varchar(24) NOT NULL DEFAULT 'active', is_default boolean NOT NULL DEFAULT false,
        profile_link varchar(240), banner varchar(500), total_employees integer, short_description text,
        client_focus text, overview text, image_url varchar(500), logo_url varchar(500), currency varchar(12),
        time_zone varchar(40), region_code varchar(40), brand_color varchar(40), date_format varchar(40),
        official_name varchar(180), website varchar(240), preferred_language varchar(16), deleted_at timestamptz,
        UNIQUE (tenant_id, id),
        FOREIGN KEY (tenant_id, created_by_user_id) REFERENCES users(tenant_id, id) ON DELETE RESTRICT
      );
      CREATE UNIQUE INDEX uq_organizations_active_slug ON organizations (tenant_id, lower(slug)) WHERE deleted_at IS NULL;
      CREATE UNIQUE INDEX uq_organizations_active_subdomain ON organizations (tenant_id, lower(subdomain)) WHERE subdomain IS NOT NULL AND deleted_at IS NULL;
      CREATE UNIQUE INDEX uq_organizations_single_default ON organizations (tenant_id) WHERE is_default AND deleted_at IS NULL;

      CREATE TABLE departments (
        ${idAndTimestamps}, tenant_id uuid NOT NULL, organization_id uuid NOT NULL,
        parent_department_id uuid, name varchar(120) NOT NULL, slug varchar(80) NOT NULL,
        code varchar(80), description text, status varchar(24) NOT NULL DEFAULT 'active', deleted_at timestamptz,
        UNIQUE (tenant_id, id), UNIQUE (tenant_id, organization_id, id),
        FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations(tenant_id, id) ON DELETE RESTRICT,
        FOREIGN KEY (tenant_id, organization_id, parent_department_id) REFERENCES departments(tenant_id, organization_id, id) ON DELETE RESTRICT,
        CONSTRAINT chk_departments_not_self_parent CHECK (parent_department_id IS NULL OR parent_department_id <> id)
      );
      CREATE UNIQUE INDEX uq_departments_active_slug ON departments (tenant_id, organization_id, lower(slug)) WHERE deleted_at IS NULL;

      CREATE TABLE roles (
        ${idAndTimestamps}, tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
        scope varchar(24) NOT NULL DEFAULT 'tenant', organization_id uuid, department_id uuid,
        name varchar(80) NOT NULL, label varchar(120) NOT NULL, display_name varchar(120), color varchar(40),
        description text, is_system boolean NOT NULL DEFAULT false,
        UNIQUE (tenant_id, id),
        UNIQUE (tenant_id, organization_id, id),
        UNIQUE (tenant_id, organization_id, department_id, id),
        FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations(tenant_id, id) ON DELETE RESTRICT,
        FOREIGN KEY (tenant_id, organization_id, department_id) REFERENCES departments(tenant_id, organization_id, id) ON DELETE RESTRICT,
        CONSTRAINT chk_roles_scope_columns CHECK (
          (scope='tenant' AND organization_id IS NULL AND department_id IS NULL) OR
          (scope='organization' AND organization_id IS NOT NULL AND department_id IS NULL) OR
          (scope='department' AND organization_id IS NOT NULL AND department_id IS NOT NULL))
      );
      CREATE UNIQUE INDEX uq_roles_tenant_name ON roles (tenant_id, lower(name)) WHERE scope='tenant';
      CREATE UNIQUE INDEX uq_roles_organization_name ON roles (tenant_id, organization_id, lower(name)) WHERE scope='organization';
      CREATE UNIQUE INDEX uq_roles_department_name ON roles (tenant_id, department_id, lower(name)) WHERE scope='department';

      CREATE TABLE role_permissions (
        ${idAndTimestamps}, tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
        organization_id uuid, department_id uuid, role_id uuid NOT NULL, permission_id uuid REFERENCES permissions(id) ON DELETE CASCADE,
        permission varchar(160) NOT NULL, enabled boolean NOT NULL DEFAULT false,
        FOREIGN KEY (tenant_id, role_id) REFERENCES roles(tenant_id, id) ON DELETE CASCADE,
        FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations(tenant_id, id) ON DELETE RESTRICT,
        FOREIGN KEY (tenant_id, organization_id, role_id) REFERENCES roles(tenant_id, organization_id, id) ON DELETE CASCADE,
        FOREIGN KEY (tenant_id, organization_id, department_id) REFERENCES departments(tenant_id, organization_id, id) ON DELETE RESTRICT,
        FOREIGN KEY (tenant_id, organization_id, department_id, role_id) REFERENCES roles(tenant_id, organization_id, department_id, id) ON DELETE CASCADE,
        UNIQUE (tenant_id, role_id, permission), UNIQUE (tenant_id, role_id, permission_id)
      );

      CREATE TABLE user_organizations (
        ${idAndTimestamps}, tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
        user_id uuid NOT NULL, organization_id uuid NOT NULL, role_id uuid,
        display_name varchar(120), is_default boolean NOT NULL DEFAULT false,
        status varchar(24) NOT NULL DEFAULT 'active', joined_at timestamptz,
        UNIQUE (tenant_id, id), UNIQUE (tenant_id, organization_id, id), UNIQUE (tenant_id, user_id, organization_id),
        FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE,
        FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations(tenant_id, id) ON DELETE RESTRICT,
        FOREIGN KEY (tenant_id, organization_id, role_id) REFERENCES roles(tenant_id, organization_id, id) ON DELETE RESTRICT
      );
      CREATE UNIQUE INDEX uq_user_organizations_single_default ON user_organizations (tenant_id, user_id)
        WHERE is_default AND status='active';

      CREATE TABLE user_departments (
        ${idAndTimestamps}, tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
        organization_id uuid NOT NULL, membership_id uuid NOT NULL, department_id uuid NOT NULL,
        is_default boolean NOT NULL DEFAULT false, status varchar(24) NOT NULL DEFAULT 'active', joined_at timestamptz,
        FOREIGN KEY (tenant_id, organization_id, membership_id) REFERENCES user_organizations(tenant_id, organization_id, id) ON DELETE CASCADE,
        FOREIGN KEY (tenant_id, organization_id, department_id) REFERENCES departments(tenant_id, organization_id, id) ON DELETE RESTRICT,
        UNIQUE (tenant_id, id),
        UNIQUE (tenant_id, organization_id, department_id, id),
        UNIQUE (tenant_id, membership_id, department_id)
      );
      CREATE UNIQUE INDEX uq_user_departments_single_default ON user_departments (tenant_id, membership_id)
        WHERE is_default AND status='active';

      CREATE TABLE user_tenant_roles (
        ${idAndTimestamps}, tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
        user_id uuid NOT NULL, role_id uuid NOT NULL,
        FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE,
        FOREIGN KEY (tenant_id, role_id) REFERENCES roles(tenant_id, id) ON DELETE CASCADE,
        UNIQUE (tenant_id, user_id, role_id)
      );
      CREATE TABLE user_organization_roles (
        ${idAndTimestamps}, tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
        organization_id uuid NOT NULL, membership_id uuid NOT NULL, role_id uuid NOT NULL,
        FOREIGN KEY (tenant_id, organization_id, membership_id) REFERENCES user_organizations(tenant_id, organization_id, id) ON DELETE CASCADE,
        FOREIGN KEY (tenant_id, organization_id, role_id) REFERENCES roles(tenant_id, organization_id, id) ON DELETE CASCADE,
        UNIQUE (tenant_id, membership_id, role_id)
      );
      CREATE TABLE user_department_roles (
        ${idAndTimestamps}, tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
        organization_id uuid NOT NULL, department_id uuid NOT NULL,
        user_department_id uuid NOT NULL, role_id uuid NOT NULL,
        FOREIGN KEY (tenant_id, organization_id, department_id, user_department_id) REFERENCES user_departments(tenant_id, organization_id, department_id, id) ON DELETE CASCADE,
        FOREIGN KEY (tenant_id, organization_id, department_id, role_id) REFERENCES roles(tenant_id, organization_id, department_id, id) ON DELETE CASCADE,
        UNIQUE (tenant_id, user_department_id, role_id)
      );

      CREATE TABLE department_dispatch_relations (
        ${idAndTimestamps}, tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
        source_department_id uuid NOT NULL, target_department_id uuid NOT NULL,
        type varchar(24) NOT NULL, priority integer NOT NULL DEFAULT 100,
        is_enabled boolean NOT NULL DEFAULT true, policy jsonb NOT NULL DEFAULT '{}'::jsonb,
        FOREIGN KEY (tenant_id, source_department_id) REFERENCES departments(tenant_id, id) ON DELETE RESTRICT,
        FOREIGN KEY (tenant_id, target_department_id) REFERENCES departments(tenant_id, id) ON DELETE RESTRICT,
        UNIQUE (tenant_id, source_department_id, target_department_id, type),
        CONSTRAINT chk_department_dispatch_not_self CHECK (source_department_id <> target_department_id),
        CONSTRAINT chk_department_dispatch_type CHECK (type IN ('handoff','escalation','collaboration','fallback'))
      );
    `);

    await queryRunner.query(this.tenantFeatureTablesSql());
    await this.enableTenantRls(queryRunner);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const tables = [
      ...TENANT_RLS_TABLES.slice().reverse(),
      "tenant_applications",
      "platform_settings",
      "platform_smtp",
      "platform_email_templates",
      "platform_role_permissions",
      "platform_user_roles",
      "platform_roles",
      "platform_users",
      "permissions",
      "tenants",
    ];
    for (const table of tables) {
      await queryRunner.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
    }
  }

  private tenantFeatureTablesSql(): string {
    const base = `${idAndTimestamps}, tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT, organization_id uuid, FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations(tenant_id, id) ON DELETE RESTRICT`;
    return `
      CREATE TABLE organization_groups (
        ${idAndTimestamps}, tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
        organization_id uuid NOT NULL, name varchar(80) NOT NULL, display_name varchar(120) NOT NULL,
        color varchar(40), description text, created_by_user_id uuid,
        UNIQUE (tenant_id, id), UNIQUE (tenant_id, organization_id, id),
        UNIQUE (tenant_id, organization_id, name),
        FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations(tenant_id, id) ON DELETE RESTRICT,
        FOREIGN KEY (tenant_id, created_by_user_id) REFERENCES users(tenant_id, id) ON DELETE RESTRICT
      );
      CREATE TABLE organization_group_members (
        ${idAndTimestamps}, tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
        organization_id uuid NOT NULL, group_id uuid NOT NULL, membership_id uuid NOT NULL, user_id uuid NOT NULL,
        FOREIGN KEY (tenant_id, organization_id, group_id) REFERENCES organization_groups(tenant_id, organization_id, id) ON DELETE CASCADE,
        FOREIGN KEY (tenant_id, organization_id, membership_id) REFERENCES user_organizations(tenant_id, organization_id, id) ON DELETE CASCADE,
        FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE,
        UNIQUE (tenant_id, group_id, membership_id)
      );
      CREATE TABLE tenant_settings (${idAndTimestamps}, tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT, name varchar(120) NOT NULL, value text, value_type varchar(32) NOT NULL DEFAULT 'string', value_options jsonb, UNIQUE (tenant_id, name));
      CREATE TABLE organization_settings (${base}, name varchar(120) NOT NULL, value text, value_type varchar(32) NOT NULL DEFAULT 'string', value_options jsonb, UNIQUE (tenant_id, organization_id, name));
      CREATE TABLE invites (${base}, token varchar(500) NOT NULL UNIQUE, email varchar(240), status varchar(24) NOT NULL DEFAULT 'invited', expire_date timestamptz, action_date timestamptz, closed_at timestamptz, accepted_count integer NOT NULL DEFAULT 0, accepted_user_id uuid, invited_by_id uuid, role_id uuid, FOREIGN KEY (tenant_id, accepted_user_id) REFERENCES users(tenant_id, id) ON DELETE RESTRICT, FOREIGN KEY (tenant_id, invited_by_id) REFERENCES users(tenant_id, id) ON DELETE RESTRICT, FOREIGN KEY (tenant_id, organization_id, role_id) REFERENCES roles(tenant_id, organization_id, id) ON DELETE RESTRICT, UNIQUE (tenant_id, organization_id, email));
      CREATE TABLE organization_contacts (${base}, name varchar(120) NOT NULL, primary_email varchar(240) NOT NULL, primary_phone varchar(80), contact_type varchar(40) NOT NULL DEFAULT 'client', notes text, image_url varchar(500), invite_status varchar(40));
      CREATE TABLE organization_languages (${base}, language_code varchar(16) NOT NULL, name varchar(80) NOT NULL, level varchar(40) NOT NULL DEFAULT 'intermediate', UNIQUE (tenant_id, organization_id, language_code));
      CREATE TABLE notification_destinations (${base}, name varchar(120) NOT NULL, type varchar(80) NOT NULL, options jsonb);
      CREATE TABLE custom_smtp (${base}, from_address varchar(240), host varchar(240) NOT NULL, port integer NOT NULL DEFAULT 587, secure boolean NOT NULL DEFAULT false, username varchar(240), password varchar(500), is_validated boolean NOT NULL DEFAULT false);
      CREATE TABLE email_sent (${base}, template_name varchar(120), email varchar(240) NOT NULL, subject varchar(240), content text, status varchar(24) NOT NULL DEFAULT 'queued', is_archived boolean NOT NULL DEFAULT false);
      CREATE TABLE email_templates (${base}, name varchar(120) NOT NULL, is_system boolean NOT NULL DEFAULT false, description varchar(240), language_code varchar(16) NOT NULL DEFAULT 'en', subject varchar(240), mjml text, hbs text NOT NULL);
      CREATE UNIQUE INDEX uq_email_templates_tenant_name_language ON email_templates (tenant_id, name, language_code) WHERE organization_id IS NULL;
      CREATE UNIQUE INDEX uq_email_templates_org_name_language ON email_templates (tenant_id, organization_id, name, language_code) WHERE organization_id IS NOT NULL;

      CREATE TABLE conversations (
        ${idAndTimestamps}, tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
        source_type varchar(80) NOT NULL, source_id uuid NOT NULL, scope varchar(24) NOT NULL,
        organization_id uuid, department_id uuid, subject varchar(240) NOT NULL,
        status varchar(24) NOT NULL DEFAULT 'open', last_message_at timestamptz,
        UNIQUE (tenant_id, id), UNIQUE (tenant_id, source_type, source_id),
        FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations(tenant_id, id) ON DELETE RESTRICT,
        FOREIGN KEY (tenant_id, organization_id, department_id) REFERENCES departments(tenant_id, organization_id, id) ON DELETE RESTRICT,
        CONSTRAINT chk_conversations_scope CHECK (
          (scope='tenant' AND organization_id IS NULL AND department_id IS NULL) OR
          (scope='organization' AND organization_id IS NOT NULL AND department_id IS NULL) OR
          (scope='department' AND organization_id IS NOT NULL AND department_id IS NOT NULL))
      );
      CREATE TABLE conversation_messages (
        ${idAndTimestamps}, tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
        conversation_id uuid NOT NULL, author_user_id uuid, kind varchar(24) NOT NULL DEFAULT 'message',
        body text NOT NULL, attachments jsonb, metadata jsonb,
        FOREIGN KEY (tenant_id, conversation_id) REFERENCES conversations(tenant_id, id) ON DELETE CASCADE,
        FOREIGN KEY (tenant_id, author_user_id) REFERENCES users(tenant_id, id) ON DELETE RESTRICT
      );
      CREATE TABLE conversation_participants (
        ${idAndTimestamps}, tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
        conversation_id uuid NOT NULL, user_id uuid NOT NULL, role varchar(24) NOT NULL DEFAULT 'participant',
        joined_reason varchar(24) NOT NULL, last_read_at timestamptz,
        FOREIGN KEY (tenant_id, conversation_id) REFERENCES conversations(tenant_id, id) ON DELETE CASCADE,
        FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE,
        UNIQUE (tenant_id, conversation_id, user_id)
      );
      CREATE TABLE tickets (
        ${idAndTimestamps}, tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
        scope varchar(24) NOT NULL, organization_id uuid, department_id uuid,
        requester_user_id uuid NOT NULL, assignee_user_id uuid, conversation_id uuid,
        subject varchar(240) NOT NULL, participant_user_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
        status varchar(24) NOT NULL DEFAULT 'open', requester_closed_at timestamptz,
        handler_closed_at timestamptz, last_message_at timestamptz, archived_at timestamptz,
        UNIQUE (tenant_id, id),
        FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations(tenant_id, id) ON DELETE RESTRICT,
        FOREIGN KEY (tenant_id, organization_id, department_id) REFERENCES departments(tenant_id, organization_id, id) ON DELETE RESTRICT,
        FOREIGN KEY (tenant_id, requester_user_id) REFERENCES users(tenant_id, id) ON DELETE RESTRICT,
        FOREIGN KEY (tenant_id, assignee_user_id) REFERENCES users(tenant_id, id) ON DELETE RESTRICT,
        FOREIGN KEY (tenant_id, conversation_id) REFERENCES conversations(tenant_id, id) ON DELETE RESTRICT,
        CONSTRAINT chk_tickets_scope CHECK (
          (scope='tenant' AND organization_id IS NULL AND department_id IS NULL) OR
          (scope='organization' AND organization_id IS NOT NULL AND department_id IS NULL) OR
          (scope='department' AND organization_id IS NOT NULL AND department_id IS NOT NULL))
      );
      CREATE TABLE ticket_messages (
        ${idAndTimestamps}, tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
        ticket_id uuid NOT NULL, author_user_id uuid, kind varchar(24) NOT NULL DEFAULT 'message',
        body text NOT NULL, attachments jsonb,
        FOREIGN KEY (tenant_id, ticket_id) REFERENCES tickets(tenant_id, id) ON DELETE CASCADE,
        FOREIGN KEY (tenant_id, author_user_id) REFERENCES users(tenant_id, id) ON DELETE RESTRICT
      );
      CREATE TABLE user_notifications (
        ${idAndTimestamps}, tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
        recipient_user_id uuid NOT NULL, actor_user_id uuid, organization_id uuid, department_id uuid,
        kind varchar(24) NOT NULL DEFAULT 'info', title varchar(240) NOT NULL, body text,
        source_type varchar(80), source_id uuid, payload jsonb, status varchar(16) NOT NULL DEFAULT 'unread',
        read_at timestamptz, dismissed_at timestamptz,
        FOREIGN KEY (tenant_id, recipient_user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE,
        FOREIGN KEY (tenant_id, actor_user_id) REFERENCES users(tenant_id, id) ON DELETE RESTRICT,
        FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations(tenant_id, id) ON DELETE RESTRICT,
        FOREIGN KEY (tenant_id, organization_id, department_id) REFERENCES departments(tenant_id, organization_id, id) ON DELETE RESTRICT
      );
      CREATE TABLE integration_tokens (
        ${idAndTimestamps}, tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
        owner_user_id uuid NOT NULL, scope varchar(24) NOT NULL, organization_id uuid, department_id uuid,
        note varchar(160), token_hash varchar(64) NOT NULL UNIQUE, token_prefix varchar(32) NOT NULL,
        permissions jsonb NOT NULL DEFAULT '[]'::jsonb, expires_at timestamptz NOT NULL,
        last_used_at timestamptz, revoked_at timestamptz, revoked_reason varchar(80),
        FOREIGN KEY (tenant_id, owner_user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE,
        FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations(tenant_id, id) ON DELETE RESTRICT,
        FOREIGN KEY (tenant_id, organization_id, department_id) REFERENCES departments(tenant_id, organization_id, id) ON DELETE RESTRICT,
        CONSTRAINT chk_integration_tokens_scope CHECK (
          (scope='tenant' AND organization_id IS NULL AND department_id IS NULL) OR
          (scope='organization' AND organization_id IS NOT NULL AND department_id IS NULL) OR
          (scope='department' AND organization_id IS NOT NULL AND department_id IS NOT NULL))
      );
      CREATE TABLE password_reset (
        ${idAndTimestamps}, tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
        email varchar(240) NOT NULL, token varchar(500) NOT NULL
      );
      CREATE INDEX idx_password_reset_tenant_email ON password_reset (tenant_id, lower(email));
      CREATE INDEX idx_password_reset_token ON password_reset (token);
      CREATE TABLE email_verifications (
        ${idAndTimestamps}, tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
        token varchar(500) NOT NULL UNIQUE, user_id uuid NOT NULL,
        valid_until timestamptz NOT NULL,
        FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE,
        UNIQUE (tenant_id, user_id)
      );
    `;
  }

  private async enableTenantRls(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hermes_tenant_app') THEN
          CREATE ROLE hermes_tenant_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
        ELSE
          ALTER ROLE hermes_tenant_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
        END IF;
      END $$
    `);
    const predicate = `(tenant_id = NULLIF(current_setting('${TENANT_DATABASE_GUCS.tenantId}', true), '')::uuid)`;
    for (const table of TENANT_RLS_TABLES) {
      await queryRunner.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      await queryRunner.query(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
      await queryRunner.query(`CREATE POLICY "tenant_isolation_${table}" ON "${table}" USING ${predicate} WITH CHECK ${predicate}`);
      await queryRunner.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "${table}" TO hermes_tenant_app`);
    }
    const tenantPredicate = `(id = NULLIF(current_setting('${TENANT_DATABASE_GUCS.tenantId}', true), '')::uuid)`;
    await queryRunner.query(`ALTER TABLE tenants ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE tenants FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(
      `CREATE POLICY tenant_isolation_tenants ON tenants USING ${tenantPredicate} WITH CHECK ${tenantPredicate}`,
    );
    await queryRunner.query(
      `GRANT SELECT ON TABLE tenants, permissions TO hermes_tenant_app`,
    );
    await queryRunner.query(
      `GRANT UPDATE (name, status, updated_at) ON TABLE tenants TO hermes_tenant_app`,
    );
  }
}
