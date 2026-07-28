import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getMetadataArgsStorage } from "typeorm";
import { WorkspaceOwnedBaseEntity } from "../../identity/entities/workspace-owned-base.entity.js";
import { AgentExecutionRequest } from "./agent-execution-request.entity.js";
import { AiArtifact } from "./ai-artifact.entity.js";
import { AiConversation } from "./ai-conversation.entity.js";
import { AiMessageFile } from "./ai-message-file.entity.js";
import { AiMessage } from "./ai-message.entity.js";

const tables = new Map<Function, string>([
  [AiConversation, "ai_conversations"],
  [AiMessage, "ai_messages"],
  [AiMessageFile, "ai_message_files"],
  [AgentExecutionRequest, "agent_execution_requests"],
  [AiArtifact, "ai_artifacts"],
]);

describe("AI conversation entity metadata", () => {
  it("registers independent versioned conversation tables", () => {
    const metadata = getMetadataArgsStorage();
    for (const [entity, tableName] of tables) {
      assert.equal(
        metadata.tables.find((item) => item.target === entity)?.name,
        tableName,
      );
      assert.ok(
        entity.prototype instanceof WorkspaceOwnedBaseEntity,
        `${entity.name} must be workspace owned`,
      );
      const workspaceId = metadata.columns.find(
        (item) =>
          item.target === WorkspaceOwnedBaseEntity &&
          item.propertyName === "workspaceId",
      );
      assert.ok(workspaceId, `${entity.name} must declare workspaceId`);
      assert.notEqual(workspaceId.options.nullable, true);
    }
  });

  it("anchors every cross-resource relation to the trusted workspace", () => {
    const joins = getMetadataArgsStorage().joinColumns;
    const columns = (entity: Function, propertyName: string) =>
      joins
        .filter(
          (item) =>
            item.target === entity && item.propertyName === propertyName,
        )
        .map((item) => [item.name, item.referencedColumnName]);

    assert.deepEqual(columns(AiConversation, "ownerMembership"), [
      ["workspace_id", "workspaceId"],
      ["owner_account_id", "accountId"],
    ]);
    assert.deepEqual(columns(AiConversation, "agentVersion"), [
      ["workspace_id", "workspaceId"],
      ["agent_version_id", "id"],
    ]);
    assert.deepEqual(columns(AiMessage, "conversation"), [
      ["workspace_id", "workspaceId"],
      ["conversation_id", "id"],
    ]);
    assert.deepEqual(columns(AiMessageFile, "fileObject"), [
      ["workspace_id", "workspaceId"],
      ["file_object_id", "id"],
    ]);
    assert.deepEqual(columns(AgentExecutionRequest, "runtimeRun"), [
      ["workspace_id", "workspaceId"],
      ["id", "id"],
    ]);
    assert.deepEqual(columns(AiArtifact, "executionRequest"), [
      ["workspace_id", "workspaceId"],
      ["execution_request_id", "id"],
    ]);
  });

  it("enforces owner idempotency and one assistant per Runtime Run", () => {
    const indices = getMetadataArgsStorage().indices;
    const expected = new Map<string, readonly string[]>([
      [
        "UQ_agent_execution_requests_workspace_owner_client_request",
        ["workspaceId", "ownerAccountId", "clientRequestId"],
      ],
      [
        "UQ_ai_messages_workspace_runtime_run",
        ["workspaceId", "runtimeRunId"],
      ],
      [
        "UQ_ai_message_files_workspace_file",
        ["workspaceId", "fileObjectId"],
      ],
      [
        "UQ_ai_artifacts_workspace_execution_ordinal",
        ["workspaceId", "executionRequestId", "ordinal"],
      ],
    ]);

    for (const [name, columns] of expected) {
      const index = indices.find((item) => item.name === name);
      assert.ok(index, `${name} must exist`);
      assert.equal(index.unique, true);
      assert.deepEqual(index.columns, columns);
    }
  });

  it("represents fail-closed lifecycle and JSON snapshot checks", () => {
    const checks = getMetadataArgsStorage().checks;
    for (const name of [
      "CHK_ai_conversations_status",
      "CHK_ai_messages_role_status",
      "CHK_ai_messages_assistant_content",
      "CHK_ai_message_files_ordinal",
      "CHK_agent_execution_requests_json_shapes",
      "CHK_agent_execution_requests_request_digest",
      "CHK_ai_artifacts_lifecycle",
    ]) {
      assert.ok(checks.some((item) => item.name === name), `${name} must exist`);
    }
    assert.match(
      String(
        checks.find(
          (item) => item.name === "CHK_ai_messages_assistant_content",
        )?.expression,
      ),
      /status.*running/,
    );
    assert.match(
      String(
        checks.find(
          (item) => item.name === "CHK_agent_execution_requests_json_shapes",
        )?.expression,
      ),
      /resolved_model_reference/,
    );
  });
});
