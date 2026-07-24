import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { QueryRunner } from "typeorm";
import { ObjectStorageFiles2026072400001 } from "./migrations/2026072400001-ObjectStorageFiles.js";

describe("object storage files migration", () => {
  it("creates scoped file metadata and composite ticket attachment constraints", async () => {
    const statements: string[] = [];
    const migration = new ObjectStorageFiles2026072400001();
    assert.match(migration.name, /\d{13}$/);
    await migration.up({
      query: async (sql: string) => {
        statements.push(sql);
        return undefined;
      },
    } as unknown as QueryRunner);
    const sql = statements.join("\n");
    assert.match(sql, /CREATE TABLE "file_objects"/);
    assert.match(sql, /CHK_file_objects_scope_workspace/);
    assert.match(sql, /UQ_file_objects_bucket_key/);
    assert.match(sql, /CREATE TABLE "conversation_message_files"/);
    assert.match(sql, /FOREIGN KEY \("workspace_id", "message_id"\)/);
    assert.match(sql, /FOREIGN KEY \("workspace_id", "file_object_id"\)/);
    assert.match(sql, /avatar_file_object_id/);
    assert.doesNotMatch(sql, /ROW LEVEL SECURITY|CREATE POLICY/i);
  });

  it("removes only the schema introduced by this migration on rollback", async () => {
    const statements: string[] = [];
    await new ObjectStorageFiles2026072400001().down({
      query: async (sql: string) => {
        statements.push(sql);
        return undefined;
      },
    } as unknown as QueryRunner);
    const sql = statements.join("\n");
    assert.match(sql, /DROP TABLE "conversation_message_files"/);
    assert.match(sql, /DROP TABLE "file_objects"/);
    assert.doesNotMatch(sql, /DROP TABLE "users"|DROP TABLE "conversation_messages"/);
  });
});
