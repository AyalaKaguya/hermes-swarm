import "reflect-metadata";
import { pathToFileURL } from "node:url";
import type { DataSource, EntityManager } from "typeorm";
import migrationDataSource from "../../common/database/migration-data-source.js";
import { settingsRuntimeConfig } from "../../common/config/runtime-config.js";
import {
  decryptSettingSecret,
  encryptSettingSecret,
  isEncryptedSettingSecret,
  type SettingSecretKeyring,
} from "./settings-secret-codec.js";

const SETTING_TABLES = ["platform_settings", "workspace_settings"] as const;

export type SettingSecretRotationSummary = {
  failed: number;
  rotated: number;
  skipped: number;
};

export async function rotateSettingSecrets(
  dataSource: Pick<DataSource, "transaction">,
  keyring: SettingSecretKeyring,
): Promise<SettingSecretRotationSummary> {
  if (!keyring.currentKey.trim() || !keyring.currentKeyId.trim()) {
    throw new Error("Current settings encryption key and key ID are required");
  }
  return dataSource.transaction((manager) => rotateWithManager(manager, keyring));
}

async function rotateWithManager(
  manager: EntityManager,
  keyring: SettingSecretKeyring,
) {
  const summary: SettingSecretRotationSummary = {
    failed: 0,
    rotated: 0,
    skipped: 0,
  };
  for (const table of SETTING_TABLES) {
    const rows = (await manager.query(
      `SELECT "id", "value" FROM "${table}" WHERE "value_type" = 'secret' AND "value" IS NOT NULL FOR UPDATE`,
    )) as Array<{ id: string; value: string }>;
    for (const row of rows) {
      if (
        !isEncryptedSettingSecret(row.value) ||
        row.value.startsWith(`enc:v2:${keyring.currentKeyId}:`)
      ) {
        summary.skipped += 1;
        continue;
      }
      try {
        const plaintext = decryptSettingSecret(row.value, keyring);
        const encrypted = encryptSettingSecret(plaintext, keyring);
        await manager.query(
          `UPDATE "${table}" SET "value" = $1, "updated_at" = NOW() WHERE "id" = $2 AND "value" = $3`,
          [encrypted, row.id, row.value],
        );
        summary.rotated += 1;
      } catch {
        summary.failed += 1;
      }
    }
  }
  return summary;
}

export async function runSettingSecretRotation() {
  const currentKey = process.env.SETTINGS_ENCRYPTION_KEY?.trim();
  const currentKeyId = process.env.SETTINGS_ENCRYPTION_KEY_ID?.trim();
  if (!currentKey || !currentKeyId) {
    throw new Error(
      "SETTINGS_ENCRYPTION_KEY and SETTINGS_ENCRYPTION_KEY_ID are required",
    );
  }
  const settings = settingsRuntimeConfig();
  try {
    await migrationDataSource.initialize();
    const summary = await rotateSettingSecrets(migrationDataSource, {
      currentKey,
      currentKeyId,
      previousKeys: settings.previousEncryptionKeys,
    });
    process.stdout.write(`${JSON.stringify(summary)}\n`);
    if (summary.failed > 0) process.exitCode = 1;
  } finally {
    if (migrationDataSource.isInitialized) await migrationDataSource.destroy();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSettingSecretRotation().catch((error) => {
    process.stderr.write(`Settings secret rotation failed: ${String(error)}\n`);
    process.exitCode = 1;
  });
}
