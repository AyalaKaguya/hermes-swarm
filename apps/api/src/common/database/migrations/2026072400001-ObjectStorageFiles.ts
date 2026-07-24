import type { MigrationInterface, QueryRunner } from "typeorm";

export class ObjectStorageFiles2026072400001 implements MigrationInterface {
  name = "ObjectStorageFiles2026072400001";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "file_objects" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "scope_type" character varying(24) NOT NULL,
        "workspace_id" uuid,
        "created_by_account_id" uuid,
        "purpose" character varying(48) NOT NULL,
        "status" character varying(24) NOT NULL DEFAULT 'pending',
        "retention" character varying(24) NOT NULL DEFAULT 'temporary',
        "storage_backend" character varying(24) NOT NULL DEFAULT 's3',
        "bucket" character varying(160) NOT NULL,
        "object_key" character varying(500) NOT NULL,
        "original_name" character varying(240) NOT NULL,
        "mime_type" character varying(160) NOT NULL,
        "byte_size" integer NOT NULL,
        "sha256" character varying(64),
        "etag" character varying(200),
        "failure_code" character varying(120),
        "expires_at" TIMESTAMP WITH TIME ZONE,
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_file_objects" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_file_objects_scope_workspace" CHECK (
          ("scope_type" = 'workspace' AND "workspace_id" IS NOT NULL)
          OR ("scope_type" IN ('account', 'platform') AND "workspace_id" IS NULL)
        ),
        CONSTRAINT "UQ_file_objects_workspace_id_id" UNIQUE ("workspace_id", "id"),
        CONSTRAINT "FK_file_objects_workspace" FOREIGN KEY ("workspace_id")
          REFERENCES "workspaces"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_file_objects_creator" FOREIGN KEY ("created_by_account_id")
          REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_file_objects_bucket_key" ON "file_objects" ("bucket", "object_key")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_file_objects_scope_status_created" ON "file_objects" ("scope_type", "workspace_id", "status", "created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_file_objects_expiration" ON "file_objects" ("status", "expires_at")`,
    );

    await queryRunner.query(`
      ALTER TABLE "conversation_messages"
      ADD CONSTRAINT "UQ_conversation_messages_workspace_id_id"
      UNIQUE ("workspace_id", "id")
    `);
    await queryRunner.query(`
      CREATE TABLE "conversation_message_files" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "workspace_id" uuid NOT NULL,
        "message_id" uuid NOT NULL,
        "file_object_id" uuid NOT NULL,
        "ordinal" smallint NOT NULL,
        CONSTRAINT "PK_conversation_message_files" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_conversation_message_files_object"
          UNIQUE ("workspace_id", "message_id", "file_object_id"),
        CONSTRAINT "UQ_conversation_message_files_ordinal"
          UNIQUE ("workspace_id", "message_id", "ordinal"),
        CONSTRAINT "FK_conversation_message_files_workspace"
          FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_conversation_message_files_message"
          FOREIGN KEY ("workspace_id", "message_id")
          REFERENCES "conversation_messages"("workspace_id", "id") ON DELETE CASCADE,
        CONSTRAINT "FK_conversation_message_files_object"
          FOREIGN KEY ("workspace_id", "file_object_id")
          REFERENCES "file_objects"("workspace_id", "id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_conversation_message_files_file" ON "conversation_message_files" ("workspace_id", "file_object_id")`,
    );

    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN "avatar_file_object_id" uuid,
      ADD CONSTRAINT "FK_users_avatar_file_object"
        FOREIGN KEY ("avatar_file_object_id") REFERENCES "file_objects"("id") ON DELETE SET NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "FK_users_avatar_file_object", DROP COLUMN "avatar_file_object_id"`,
    );
    await queryRunner.query(`DROP TABLE "conversation_message_files"`);
    await queryRunner.query(
      `ALTER TABLE "conversation_messages" DROP CONSTRAINT "UQ_conversation_messages_workspace_id_id"`,
    );
    await queryRunner.query(`DROP TABLE "file_objects"`);
  }
}
