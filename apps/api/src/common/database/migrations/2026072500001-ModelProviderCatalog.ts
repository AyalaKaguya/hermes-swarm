import type { MigrationInterface, QueryRunner } from "typeorm";

export class ModelProviderCatalog2026072500001 implements MigrationInterface {
  name = "ModelProviderCatalog2026072500001";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "platform_model_providers" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "name" character varying(120) NOT NULL,
        "driver" character varying(64) NOT NULL,
        "base_url" character varying(500) NOT NULL,
        "status" character varying(24) NOT NULL DEFAULT 'disabled',
        "config" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "revision" integer NOT NULL DEFAULT 1,
        "secret_id" uuid,
        "secret_envelope" text,
        "secret_revision" integer NOT NULL DEFAULT 0,
        "secret_updated_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_platform_model_providers" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_platform_model_providers_name" UNIQUE ("name"),
        CONSTRAINT "UQ_platform_model_providers_secret_id" UNIQUE ("secret_id"),
        CONSTRAINT "CHK_platform_model_providers_status"
          CHECK ("status" IN ('enabled', 'disabled')),
        CONSTRAINT "CHK_platform_model_providers_revision"
          CHECK ("revision" > 0),
        CONSTRAINT "CHK_platform_model_providers_secret_state" CHECK (
          (
            "secret_id" IS NULL AND "secret_envelope" IS NULL
            AND "secret_updated_at" IS NULL AND "secret_revision" = 0
          ) OR (
            "secret_id" IS NOT NULL AND "secret_envelope" IS NOT NULL
            AND "secret_updated_at" IS NOT NULL AND "secret_revision" > 0
          )
        )
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "workspace_model_providers" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "workspace_id" uuid NOT NULL,
        "name" character varying(120) NOT NULL,
        "driver" character varying(64) NOT NULL,
        "base_url" character varying(500) NOT NULL,
        "status" character varying(24) NOT NULL DEFAULT 'disabled',
        "config" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "revision" integer NOT NULL DEFAULT 1,
        "secret_id" uuid,
        "secret_envelope" text,
        "secret_revision" integer NOT NULL DEFAULT 0,
        "secret_updated_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_workspace_model_providers" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_workspace_model_providers_workspace_id_id"
          UNIQUE ("workspace_id", "id"),
        CONSTRAINT "UQ_workspace_model_providers_workspace_name"
          UNIQUE ("workspace_id", "name"),
        CONSTRAINT "UQ_workspace_model_providers_secret_id" UNIQUE ("secret_id"),
        CONSTRAINT "FK_workspace_model_providers_workspace"
          FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_workspace_model_providers_status"
          CHECK ("status" IN ('enabled', 'disabled')),
        CONSTRAINT "CHK_workspace_model_providers_revision"
          CHECK ("revision" > 0),
        CONSTRAINT "CHK_workspace_model_providers_secret_state" CHECK (
          (
            "secret_id" IS NULL AND "secret_envelope" IS NULL
            AND "secret_updated_at" IS NULL AND "secret_revision" = 0
          ) OR (
            "secret_id" IS NOT NULL AND "secret_envelope" IS NOT NULL
            AND "secret_updated_at" IS NOT NULL AND "secret_revision" > 0
          )
        )
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_workspace_model_providers_workspace_status" ON "workspace_model_providers" ("workspace_id", "status")`,
    );

    await queryRunner.query(`
      CREATE TABLE "platform_model_deployments" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "provider_id" uuid NOT NULL,
        "name" character varying(120) NOT NULL,
        "model_id" character varying(240) NOT NULL,
        "capability" character varying(32) NOT NULL,
        "status" character varying(24) NOT NULL DEFAULT 'disabled',
        "config" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "revision" integer NOT NULL DEFAULT 1,
        CONSTRAINT "PK_platform_model_deployments" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_platform_model_deployments_id_capability"
          UNIQUE ("id", "capability"),
        CONSTRAINT "UQ_platform_model_deployments_provider_name"
          UNIQUE ("provider_id", "name"),
        CONSTRAINT "UQ_platform_model_deployments_provider_model"
          UNIQUE ("provider_id", "model_id", "capability"),
        CONSTRAINT "FK_platform_model_deployments_provider"
          FOREIGN KEY ("provider_id") REFERENCES "platform_model_providers"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_platform_model_deployments_capability" CHECK (
          "capability" IN ('chat', 'embedding', 'rerank', 'speechToText', 'textToSpeech')
        ),
        CONSTRAINT "CHK_platform_model_deployments_status"
          CHECK ("status" IN ('enabled', 'disabled')),
        CONSTRAINT "CHK_platform_model_deployments_revision"
          CHECK ("revision" > 0)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_platform_model_deployments_provider_status" ON "platform_model_deployments" ("provider_id", "status")`,
    );

    await queryRunner.query(`
      CREATE TABLE "workspace_model_deployments" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "workspace_id" uuid NOT NULL,
        "provider_id" uuid NOT NULL,
        "name" character varying(120) NOT NULL,
        "model_id" character varying(240) NOT NULL,
        "capability" character varying(32) NOT NULL,
        "status" character varying(24) NOT NULL DEFAULT 'disabled',
        "config" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "revision" integer NOT NULL DEFAULT 1,
        CONSTRAINT "PK_workspace_model_deployments" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_workspace_model_deployments_workspace_id_id"
          UNIQUE ("workspace_id", "id"),
        CONSTRAINT "UQ_workspace_model_deployments_workspace_id_capability"
          UNIQUE ("workspace_id", "id", "capability"),
        CONSTRAINT "UQ_workspace_model_deployments_provider_name"
          UNIQUE ("workspace_id", "provider_id", "name"),
        CONSTRAINT "UQ_workspace_model_deployments_provider_model"
          UNIQUE ("workspace_id", "provider_id", "model_id", "capability"),
        CONSTRAINT "FK_workspace_model_deployments_workspace"
          FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_workspace_model_deployments_provider"
          FOREIGN KEY ("workspace_id", "provider_id")
          REFERENCES "workspace_model_providers"("workspace_id", "id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_workspace_model_deployments_capability" CHECK (
          "capability" IN ('chat', 'embedding', 'rerank', 'speechToText', 'textToSpeech')
        ),
        CONSTRAINT "CHK_workspace_model_deployments_status"
          CHECK ("status" IN ('enabled', 'disabled')),
        CONSTRAINT "CHK_workspace_model_deployments_revision"
          CHECK ("revision" > 0)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_workspace_model_deployments_workspace_status" ON "workspace_model_deployments" ("workspace_id", "status")`,
    );

    await queryRunner.query(`
      CREATE TABLE "workspace_model_grants" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "workspace_id" uuid NOT NULL,
        "platform_deployment_id" uuid NOT NULL,
        "enabled" boolean NOT NULL DEFAULT true,
        "expires_at" TIMESTAMP WITH TIME ZONE,
        "revision" integer NOT NULL DEFAULT 1,
        CONSTRAINT "PK_workspace_model_grants" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_workspace_model_grants_workspace_deployment"
          UNIQUE ("workspace_id", "platform_deployment_id"),
        CONSTRAINT "FK_workspace_model_grants_workspace"
          FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_workspace_model_grants_deployment"
          FOREIGN KEY ("platform_deployment_id")
          REFERENCES "platform_model_deployments"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_workspace_model_grants_revision" CHECK ("revision" > 0)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_workspace_model_grants_deployment" ON "workspace_model_grants" ("platform_deployment_id", "workspace_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "workspace_model_defaults" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "workspace_id" uuid NOT NULL,
        "capability" character varying(32) NOT NULL,
        "platform_deployment_id" uuid,
        "workspace_deployment_id" uuid,
        CONSTRAINT "PK_workspace_model_defaults" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_workspace_model_defaults_workspace_capability"
          UNIQUE ("workspace_id", "capability"),
        CONSTRAINT "CHK_workspace_model_defaults_capability" CHECK (
          "capability" IN ('chat', 'embedding', 'rerank', 'speechToText', 'textToSpeech')
        ),
        CONSTRAINT "CHK_workspace_model_defaults_single_deployment" CHECK (
          ("platform_deployment_id" IS NOT NULL)::integer
          + ("workspace_deployment_id" IS NOT NULL)::integer = 1
        ),
        CONSTRAINT "FK_workspace_model_defaults_workspace"
          FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_workspace_model_defaults_platform_capability"
          FOREIGN KEY ("platform_deployment_id", "capability")
          REFERENCES "platform_model_deployments"("id", "capability") ON DELETE RESTRICT,
        CONSTRAINT "FK_workspace_model_defaults_platform_grant"
          FOREIGN KEY ("workspace_id", "platform_deployment_id")
          REFERENCES "workspace_model_grants"("workspace_id", "platform_deployment_id") ON DELETE CASCADE,
        CONSTRAINT "FK_workspace_model_defaults_workspace_deployment"
          FOREIGN KEY ("workspace_id", "workspace_deployment_id", "capability")
          REFERENCES "workspace_model_deployments"("workspace_id", "id", "capability") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_workspace_model_defaults_platform_deployment" ON "workspace_model_defaults" ("platform_deployment_id") WHERE "platform_deployment_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_workspace_model_defaults_workspace_deployment" ON "workspace_model_defaults" ("workspace_id", "workspace_deployment_id") WHERE "workspace_deployment_id" IS NOT NULL`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "workspace_model_defaults"`);
    await queryRunner.query(`DROP TABLE "workspace_model_grants"`);
    await queryRunner.query(`DROP TABLE "workspace_model_deployments"`);
    await queryRunner.query(`DROP TABLE "platform_model_deployments"`);
    await queryRunner.query(`DROP TABLE "workspace_model_providers"`);
    await queryRunner.query(`DROP TABLE "platform_model_providers"`);
  }
}
