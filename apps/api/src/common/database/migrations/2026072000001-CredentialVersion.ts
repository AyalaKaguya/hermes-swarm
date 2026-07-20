import type { MigrationInterface, QueryRunner } from "typeorm";

export class CredentialVersion2026072000001 implements MigrationInterface {
  name = "CredentialVersion2026072000001";

  async up(queryRunner: QueryRunner) {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "credential_version" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "credentials_changed_at" timestamptz`,
    );
    await queryRunner.query(
      `ALTER TABLE "platform_users" ADD COLUMN "credential_version" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "platform_users" ADD COLUMN "credentials_changed_at" timestamptz`,
    );
  }

  async down(queryRunner: QueryRunner) {
    await queryRunner.query(
      `ALTER TABLE "platform_users" DROP COLUMN "credentials_changed_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "platform_users" DROP COLUMN "credential_version"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "credentials_changed_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "credential_version"`,
    );
  }
}
