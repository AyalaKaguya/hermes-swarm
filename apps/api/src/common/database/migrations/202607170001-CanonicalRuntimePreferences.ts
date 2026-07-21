import type { MigrationInterface, QueryRunner } from "typeorm";

export class CanonicalRuntimePreferences2026071700001
  implements MigrationInterface
{
  name = "CanonicalRuntimePreferences2026071700001";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "users"
      SET "preferred_language" = CASE
        WHEN "preferred_language" IN ('zh', 'zh-CN') THEN 'zh-Hans'
        WHEN "preferred_language" IN ('zh-TW', 'zh-HK') THEN 'zh-Hant'
        WHEN "preferred_language" IN ('en-US', 'en-GB') THEN 'en'
        ELSE "preferred_language"
      END
    `);
    await queryRunner.query(`
      ALTER TABLE "users"
      ALTER COLUMN "preferred_language" DROP DEFAULT,
      ALTER COLUMN "preferred_language" DROP NOT NULL
    `);
    await queryRunner.query(`
      UPDATE "workspace_applications"
      SET "preferred_language" = CASE
        WHEN "preferred_language" IN ('zh', 'zh-CN') THEN 'zh-Hans'
        WHEN "preferred_language" IN ('zh-TW', 'zh-HK') THEN 'zh-Hant'
        WHEN "preferred_language" IN ('en-US', 'en-GB') THEN 'en'
        ELSE "preferred_language"
      END
    `);
    await queryRunner.query(`
      ALTER TABLE "workspace_applications"
      ALTER COLUMN "preferred_language" SET DEFAULT 'zh-Hans'
    `);
    await queryRunner.query(`
      UPDATE "platform_settings"
      SET "value" = CASE
        WHEN "value" IN ('zh', 'zh-CN') THEN 'zh-Hans'
        WHEN "value" IN ('zh-TW', 'zh-HK') THEN 'zh-Hant'
        WHEN "value" IN ('en-US', 'en-GB') THEN 'en'
        ELSE "value"
      END
      WHERE "name" = 'workspace.defaultLanguage'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "users"
      SET "preferred_language" = CASE
        WHEN "preferred_language" IS NULL THEN 'zh-CN'
        WHEN "preferred_language" = 'zh-Hans' THEN 'zh-CN'
        WHEN "preferred_language" = 'zh-Hant' THEN 'zh-TW'
        ELSE "preferred_language"
      END
    `);
    await queryRunner.query(`
      ALTER TABLE "users"
      ALTER COLUMN "preferred_language" SET DEFAULT 'zh-CN',
      ALTER COLUMN "preferred_language" SET NOT NULL
    `);
    await queryRunner.query(`
      UPDATE "workspace_applications"
      SET "preferred_language" = CASE
        WHEN "preferred_language" = 'zh-Hans' THEN 'zh-CN'
        WHEN "preferred_language" = 'zh-Hant' THEN 'zh-TW'
        ELSE "preferred_language"
      END
    `);
    await queryRunner.query(`
      ALTER TABLE "workspace_applications"
      ALTER COLUMN "preferred_language" SET DEFAULT 'zh-CN'
    `);
    await queryRunner.query(`
      UPDATE "platform_settings"
      SET "value" = CASE
        WHEN "value" = 'zh-Hans' THEN 'zh-CN'
        WHEN "value" = 'zh-Hant' THEN 'zh-TW'
        ELSE "value"
      END
      WHERE "name" = 'workspace.defaultLanguage'
    `);
  }
}
