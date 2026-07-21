import type { MigrationInterface, QueryRunner } from "typeorm";

export class CredentialVersion2026072000001 implements MigrationInterface {
  name = "CredentialVersion2026072000001";

  async up(queryRunner: QueryRunner) {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "credential_version" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "credentials_changed_at" timestamptz`,
    );
  }

  async down(queryRunner: QueryRunner) {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "credentials_changed_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "credential_version"`,
    );
  }
}
