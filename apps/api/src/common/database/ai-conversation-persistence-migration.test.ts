import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AiConversationPersistence2026072800001 } from "./migrations/2026072800001-AiConversationPersistence.js";

describe("AiConversationPersistence2026072800001", () => {
  it("creates owner-private workspace conversation and execution records", async () => {
    const statements: string[] = [];
    await new AiConversationPersistence2026072800001().up({
      query: async (statement: string) => {
        statements.push(statement.replace(/\s+/g, " ").trim());
      },
    } as never);

    const sql = statements.join("\n");
    for (const table of [
      "ai_conversations",
      "ai_messages",
      "ai_message_files",
      "agent_execution_requests",
      "ai_artifacts",
    ]) {
      assert.match(sql, new RegExp(`CREATE TABLE "${table}"`));
    }
    assert.match(
      sql,
      /FOREIGN KEY \("workspace_id", "owner_account_id"\) REFERENCES "user_workspace_roles"\("workspace_id", "user_id"\)/,
    );
    assert.match(
      sql,
      /FOREIGN KEY \("workspace_id", "agent_version_id"\) REFERENCES "agent_versions"\("workspace_id", "id"\)/,
    );
    assert.match(
      sql,
      /FOREIGN KEY \("workspace_id", "runtime_run_id"\) REFERENCES "runtime_runs"\("workspace_id", "id"\)/,
    );
    assert.match(
      sql,
      /FOREIGN KEY \("workspace_id", "id"\) REFERENCES "runtime_runs"\("workspace_id", "id"\)/,
    );
    assert.match(
      sql,
      /FOREIGN KEY \("workspace_id", "file_object_id"\) REFERENCES "file_objects"\("workspace_id", "id"\)/,
    );
    assert.match(
      sql,
      /UQ_agent_execution_requests_workspace_owner_client_request/,
    );
    assert.match(sql, /resolved_model_reference/);
    assert.match(sql, /CHK_ai_messages_assistant_content/);
    assert.match(sql, /CHK_ai_artifacts_lifecycle/);
    assert.doesNotMatch(sql, /ROW LEVEL SECURITY|CREATE POLICY|set_config/i);

    const messageCompositeIndex = statements.findIndex((statement) =>
      statement.includes("UQ_ai_messages_workspace_conversation_id"),
    );
    const messageReplyForeignKey = statements.findIndex((statement) =>
      statement.includes('ADD CONSTRAINT "FK_ai_messages_reply"'),
    );
    assert.ok(messageCompositeIndex >= 0);
    assert.ok(messageReplyForeignKey > messageCompositeIndex);
  });

  it("declares rollback unsafe", async () => {
    await assert.rejects(
      () => new AiConversationPersistence2026072800001().down(),
      /cannot be rolled back safely/,
    );
  });
});
