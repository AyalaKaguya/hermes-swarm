import type { MigrationInterface, QueryRunner } from "typeorm";

export class ControlledToolGateway2026072500003 implements MigrationInterface {
  name = "ControlledToolGateway2026072500003";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "tool_definitions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "name" character varying(128) NOT NULL,
        "display_name" character varying(120) NOT NULL,
        "description" text NOT NULL,
        "status" character varying(24) NOT NULL DEFAULT 'disabled',
        "revision" integer NOT NULL DEFAULT 1,
        CONSTRAINT "PK_tool_definitions" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_tool_definitions_name" UNIQUE ("name"),
        CONSTRAINT "CHK_tool_definitions_status"
          CHECK ("status" IN ('enabled', 'disabled')),
        CONSTRAINT "CHK_tool_definitions_revision" CHECK ("revision" > 0)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "tool_network_policies" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "name" character varying(120) NOT NULL,
        "scheme" character varying(8) NOT NULL,
        "host" character varying(253) NOT NULL,
        "port" integer NOT NULL,
        "path_prefix" character varying(500) NOT NULL,
        "status" character varying(24) NOT NULL DEFAULT 'disabled',
        "revision" integer NOT NULL DEFAULT 1,
        CONSTRAINT "PK_tool_network_policies" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_tool_network_policies_name" UNIQUE ("name"),
        CONSTRAINT "UQ_tool_network_policies_endpoint"
          UNIQUE ("scheme", "host", "port", "path_prefix"),
        CONSTRAINT "CHK_tool_network_policies_scheme"
          CHECK ("scheme" IN ('https', 'http')),
        CONSTRAINT "CHK_tool_network_policies_port"
          CHECK ("port" BETWEEN 1 AND 65535),
        CONSTRAINT "CHK_tool_network_policies_path"
          CHECK (left("path_prefix", 1) = '/'),
        CONSTRAINT "CHK_tool_network_policies_status"
          CHECK ("status" IN ('enabled', 'disabled')),
        CONSTRAINT "CHK_tool_network_policies_revision" CHECK ("revision" > 0)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "tool_definition_versions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "tool_definition_id" uuid NOT NULL,
        "version" character varying(64) NOT NULL,
        "schema_version" character varying(48) NOT NULL DEFAULT 'hermes.tool-definition/v1',
        "driver_type" character varying(32) NOT NULL,
        "status" character varying(24) NOT NULL DEFAULT 'draft',
        "revision" integer NOT NULL DEFAULT 1,
        "content_locked" boolean NOT NULL DEFAULT true,
        "content_digest" character(64) NOT NULL,
        "input_schema" jsonb NOT NULL,
        "output_schema" jsonb NOT NULL,
        "driver_config" jsonb NOT NULL,
        "required_permissions" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "output_redaction_paths" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "allows_artifact" boolean NOT NULL DEFAULT false,
        "timeout_ms" integer NOT NULL,
        "max_response_bytes" integer NOT NULL,
        "retry" jsonb NOT NULL,
        "side_effect" character varying(24) NOT NULL,
        "idempotency" character varying(24) NOT NULL,
        CONSTRAINT "PK_tool_definition_versions" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_tool_definition_versions_definition_version"
          UNIQUE ("tool_definition_id", "version"),
        CONSTRAINT "FK_tool_definition_versions_definition"
          FOREIGN KEY ("tool_definition_id")
          REFERENCES "tool_definitions"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_tool_definition_versions_driver"
          CHECK ("driver_type" IN ('internal', 'http', 'mcpStreamableHttp')),
        CONSTRAINT "CHK_tool_definition_versions_schema_version"
          CHECK ("schema_version" = 'hermes.tool-definition/v1'),
        CONSTRAINT "CHK_tool_definition_versions_status"
          CHECK ("status" IN ('draft', 'published', 'disabled')),
        CONSTRAINT "CHK_tool_definition_versions_revision" CHECK ("revision" > 0),
        CONSTRAINT "CHK_tool_definition_versions_lock_state"
          CHECK ("content_locked" OR "status" = 'draft'),
        CONSTRAINT "CHK_tool_definition_versions_digest"
          CHECK ("content_digest" ~ '^[a-f0-9]{64}$'),
        CONSTRAINT "CHK_tool_definition_versions_schema_objects" CHECK (
          jsonb_typeof("input_schema") = 'object'
          AND jsonb_typeof("output_schema") = 'object'
          AND jsonb_typeof("driver_config") = 'object'
          AND jsonb_typeof("retry") = 'object'
        ),
        CONSTRAINT "CHK_tool_definition_versions_array_fields" CHECK (
          jsonb_typeof("required_permissions") = 'array'
          AND jsonb_typeof("output_redaction_paths") = 'array'
        ),
        CONSTRAINT "CHK_tool_definition_versions_timeout"
          CHECK ("timeout_ms" BETWEEN 100 AND 120000),
        CONSTRAINT "CHK_tool_definition_versions_response_bytes"
          CHECK ("max_response_bytes" BETWEEN 1024 AND 10485760),
        CONSTRAINT "CHK_tool_definition_versions_side_effect"
          CHECK ("side_effect" IN ('none', 'reversible', 'irreversible')),
        CONSTRAINT "CHK_tool_definition_versions_idempotency"
          CHECK ("idempotency" IN ('notRequired', 'required', 'unsupported'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_tool_definition_versions_definition_status" ON "tool_definition_versions" ("tool_definition_id", "status")`,
    );

    await queryRunner.query(`
      CREATE TABLE "tool_definition_network_policies" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "tool_definition_version_id" uuid NOT NULL,
        "network_policy_id" uuid NOT NULL,
        CONSTRAINT "PK_tool_definition_network_policies" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_tool_definition_network_policies_version_policy"
          UNIQUE ("tool_definition_version_id", "network_policy_id"),
        CONSTRAINT "FK_tool_definition_network_policies_version"
          FOREIGN KEY ("tool_definition_version_id")
          REFERENCES "tool_definition_versions"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_tool_definition_network_policies_policy"
          FOREIGN KEY ("network_policy_id")
          REFERENCES "tool_network_policies"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_tool_definition_network_policies_policy" ON "tool_definition_network_policies" ("network_policy_id", "tool_definition_version_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "workspace_tool_connections" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "workspace_id" uuid NOT NULL,
        "network_policy_id" uuid NOT NULL,
        "name" character varying(120) NOT NULL,
        "driver_type" character varying(32) NOT NULL,
        "base_url" character varying(500) NOT NULL,
        "auth_type" character varying(24) NOT NULL DEFAULT 'none',
        "auth_header_name" character varying(120),
        "status" character varying(24) NOT NULL DEFAULT 'disabled',
        "revision" integer NOT NULL DEFAULT 1,
        "secret_id" uuid,
        "secret_envelope" text,
        "secret_revision" integer NOT NULL DEFAULT 0,
        "secret_updated_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_workspace_tool_connections" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_workspace_tool_connections_id_workspace_id"
          UNIQUE ("id", "workspace_id"),
        CONSTRAINT "UQ_workspace_tool_connections_workspace_name"
          UNIQUE ("workspace_id", "name"),
        CONSTRAINT "UQ_workspace_tool_connections_secret_id" UNIQUE ("secret_id"),
        CONSTRAINT "FK_workspace_tool_connections_workspace"
          FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_workspace_tool_connections_network_policy"
          FOREIGN KEY ("network_policy_id")
          REFERENCES "tool_network_policies"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_workspace_tool_connections_driver"
          CHECK ("driver_type" IN ('http', 'mcpStreamableHttp')),
        CONSTRAINT "CHK_workspace_tool_connections_auth"
          CHECK ("auth_type" IN ('none', 'bearer', 'header')),
        CONSTRAINT "CHK_workspace_tool_connections_header" CHECK (
          ("auth_type" = 'header' AND "auth_header_name" IS NOT NULL)
          OR ("auth_type" <> 'header' AND "auth_header_name" IS NULL)
        ),
        CONSTRAINT "CHK_workspace_tool_connections_status"
          CHECK ("status" IN ('enabled', 'disabled')),
        CONSTRAINT "CHK_workspace_tool_connections_revision" CHECK ("revision" > 0),
        CONSTRAINT "CHK_workspace_tool_connections_secret_state" CHECK (
          (
            "secret_id" IS NULL AND "secret_envelope" IS NULL
            AND "secret_updated_at" IS NULL AND "secret_revision" = 0
          ) OR (
            "secret_id" IS NOT NULL AND "secret_envelope" IS NOT NULL
            AND "secret_updated_at" IS NOT NULL AND "secret_revision" > 0
          )
        ),
        CONSTRAINT "CHK_workspace_tool_connections_enabled_secret" CHECK (
          "status" = 'disabled' OR "auth_type" = 'none' OR "secret_id" IS NOT NULL
        ),
        CONSTRAINT "CHK_workspace_tool_connections_none_has_no_secret" CHECK (
          "auth_type" <> 'none' OR "secret_id" IS NULL
        )
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_workspace_tool_connections_workspace_status" ON "workspace_tool_connections" ("workspace_id", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_workspace_tool_connections_workspace_policy" ON "workspace_tool_connections" ("workspace_id", "network_policy_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "workspace_tool_grants" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "workspace_id" uuid NOT NULL,
        "tool_definition_id" uuid NOT NULL,
        "tool_version" character varying(64) NOT NULL,
        "connection_id" uuid,
        "enabled" boolean NOT NULL DEFAULT false,
        "expires_at" TIMESTAMP WITH TIME ZONE,
        "revision" integer NOT NULL DEFAULT 1,
        CONSTRAINT "PK_workspace_tool_grants" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_workspace_tool_grants_workspace_tool_version"
          UNIQUE ("workspace_id", "tool_definition_id", "tool_version"),
        CONSTRAINT "FK_workspace_tool_grants_workspace"
          FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_workspace_tool_grants_tool_version"
          FOREIGN KEY ("tool_definition_id", "tool_version")
          REFERENCES "tool_definition_versions"("tool_definition_id", "version") ON DELETE RESTRICT,
        CONSTRAINT "FK_workspace_tool_grants_connection"
          FOREIGN KEY ("connection_id", "workspace_id")
          REFERENCES "workspace_tool_connections"("id", "workspace_id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_workspace_tool_grants_revision" CHECK ("revision" > 0)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_workspace_tool_grants_workspace_enabled" ON "workspace_tool_grants" ("workspace_id", "enabled")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_workspace_tool_grants_definition" ON "workspace_tool_grants" ("tool_definition_id", "tool_version", "workspace_id")`,
    );

    await queryRunner.query(`
      CREATE FUNCTION prevent_tool_definition_version_content_update()
      RETURNS trigger AS $$
      BEGIN
        IF OLD."content_locked" AND NOT NEW."content_locked" THEN
          RAISE EXCEPTION 'tool version content lock cannot be removed';
        END IF;
        IF OLD."status" <> 'draft' AND NEW."status" = 'draft' THEN
          RAISE EXCEPTION 'published tool version cannot return to draft';
        END IF;
        IF NEW."tool_definition_id" IS DISTINCT FROM OLD."tool_definition_id"
          OR NEW."version" IS DISTINCT FROM OLD."version"
          OR NEW."schema_version" IS DISTINCT FROM OLD."schema_version"
          OR NEW."driver_type" IS DISTINCT FROM OLD."driver_type"
          OR NEW."content_digest" IS DISTINCT FROM OLD."content_digest"
          OR NEW."input_schema" IS DISTINCT FROM OLD."input_schema"
          OR NEW."output_schema" IS DISTINCT FROM OLD."output_schema"
          OR NEW."driver_config" IS DISTINCT FROM OLD."driver_config"
          OR NEW."required_permissions" IS DISTINCT FROM OLD."required_permissions"
          OR NEW."output_redaction_paths" IS DISTINCT FROM OLD."output_redaction_paths"
          OR NEW."allows_artifact" IS DISTINCT FROM OLD."allows_artifact"
          OR NEW."timeout_ms" IS DISTINCT FROM OLD."timeout_ms"
          OR NEW."max_response_bytes" IS DISTINCT FROM OLD."max_response_bytes"
          OR NEW."retry" IS DISTINCT FROM OLD."retry"
          OR NEW."side_effect" IS DISTINCT FROM OLD."side_effect"
          OR NEW."idempotency" IS DISTINCT FROM OLD."idempotency"
        THEN
          RAISE EXCEPTION 'published tool version content is immutable';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TR_tool_definition_versions_immutable"
      BEFORE UPDATE ON "tool_definition_versions"
      FOR EACH ROW EXECUTE FUNCTION prevent_tool_definition_version_content_update()
    `);
    await queryRunner.query(`
      CREATE FUNCTION prevent_locked_tool_version_policy_update()
      RETURNS trigger AS $$
      DECLARE
        old_locked boolean := false;
        new_locked boolean := false;
      BEGIN
        IF TG_OP = 'UPDATE' THEN
          RAISE EXCEPTION 'tool version network policy content is immutable';
        END IF;
        IF TG_OP = 'DELETE' THEN
          SELECT "content_locked" INTO old_locked
          FROM "tool_definition_versions"
          WHERE "id" = OLD."tool_definition_version_id"
          FOR UPDATE;
        END IF;
        IF TG_OP = 'INSERT' THEN
          SELECT "content_locked" INTO new_locked
          FROM "tool_definition_versions"
          WHERE "id" = NEW."tool_definition_version_id"
          FOR UPDATE;
        END IF;
        IF COALESCE(old_locked, false) OR COALESCE(new_locked, false) THEN
          RAISE EXCEPTION 'tool version network policy content is immutable';
        END IF;
        IF TG_OP = 'DELETE' THEN
          RETURN OLD;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TR_tool_definition_network_policies_immutable"
      BEFORE INSERT OR UPDATE OR DELETE ON "tool_definition_network_policies"
      FOR EACH ROW EXECUTE FUNCTION prevent_locked_tool_version_policy_update()
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER "TR_tool_definition_network_policies_immutable" ON "tool_definition_network_policies"`,
    );
    await queryRunner.query(
      `DROP FUNCTION prevent_locked_tool_version_policy_update`,
    );
    await queryRunner.query(
      `DROP TRIGGER "TR_tool_definition_versions_immutable" ON "tool_definition_versions"`,
    );
    await queryRunner.query(
      `DROP FUNCTION prevent_tool_definition_version_content_update`,
    );
    await queryRunner.query(`DROP TABLE "workspace_tool_grants"`);
    await queryRunner.query(`DROP TABLE "workspace_tool_connections"`);
    await queryRunner.query(`DROP TABLE "tool_definition_network_policies"`);
    await queryRunner.query(`DROP TABLE "tool_definition_versions"`);
    await queryRunner.query(`DROP TABLE "tool_network_policies"`);
    await queryRunner.query(`DROP TABLE "tool_definitions"`);
  }
}
