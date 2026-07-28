import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AI_ARTIFACT_SCHEMA_VERSION,
  AI_CONVERSATION_SCHEMA_VERSION,
  AI_MESSAGE_SCHEMA_VERSION,
  AiArtifactSchema,
  AiAssistantMessageSchema,
  AiConversationSubmissionSchema,
  CreateAiConversationRequestSchema,
  SendAiConversationMessageRequestSchema,
} from "./conversations.js";

const CONVERSATION_ID = "11111111-1111-4111-8111-111111111111";
const AGENT_VERSION_ID = "22222222-2222-4222-8222-222222222222";
const CLIENT_REQUEST_ID = "33333333-3333-4333-8333-333333333333";
const USER_MESSAGE_ID = "44444444-4444-4444-8444-444444444444";
const RUN_ID = "55555555-5555-4555-8555-555555555555";
const FILE_ID = "66666666-6666-4666-8666-666666666666";
const NOW = "2026-07-27T08:00:00.000Z";

describe("AI conversation contracts", () => {
  it("accepts strict first and follow-up message requests", () => {
    const message = { content: "Summarize this file", fileIds: [FILE_ID] };
    assert.equal(
      CreateAiConversationRequestSchema.safeParse({
        agentVersionId: AGENT_VERSION_ID,
        clientRequestId: CLIENT_REQUEST_ID,
        message,
      }).success,
      true,
    );
    assert.equal(
      SendAiConversationMessageRequestSchema.safeParse({
        clientRequestId: CLIENT_REQUEST_ID,
        message,
      }).success,
      true,
    );
  });

  it("requires UUID idempotency and content or unique attachments", () => {
    for (const request of [
      { clientRequestId: "not-a-uuid", message: { content: "hello" } },
      { clientRequestId: CLIENT_REQUEST_ID, message: { content: "   " } },
      {
        clientRequestId: CLIENT_REQUEST_ID,
        message: { content: "", fileIds: [FILE_ID, FILE_ID] },
      },
    ]) {
      assert.equal(
        SendAiConversationMessageRequestSchema.safeParse(request).success,
        false,
      );
    }
  });

  it("rejects client-selected scope, execution context, and secrets", () => {
    const base = {
      agentVersionId: AGENT_VERSION_ID,
      clientRequestId: CLIENT_REQUEST_ID,
      message: { content: "hello" },
    };
    for (const injected of [
      { workspaceId: CONVERSATION_ID },
      { ownerAccountId: USER_MESSAGE_ID },
      { runId: RUN_ID },
      { providerGrants: [] },
      { endpoint: "https://provider.invalid" },
      { secret: "credential" },
    ]) {
      assert.equal(
        CreateAiConversationRequestSchema.safeParse({
          ...base,
          ...injected,
        }).success,
        false,
      );
    }
  });

  it("validates the paired user and queued assistant response", () => {
    const submission = submissionPayload();
    assert.equal(AiConversationSubmissionSchema.safeParse(submission).success, true);
    assert.equal(
      AiAssistantMessageSchema.safeParse({
        ...submission.responseMessage,
        content: "premature output",
      }).success,
      false,
    );
    assert.equal(
      AiAssistantMessageSchema.safeParse({
        ...submission.responseMessage,
        finishedAt: NOW,
      }).success,
      false,
    );
    assert.equal(
      AiAssistantMessageSchema.safeParse({
        ...submission.responseMessage,
        content: "partial output",
        startedAt: NOW,
        status: "running",
      }).success,
      true,
    );
  });

  it("keeps execution snapshots and storage coordinates off the public response", () => {
    const submission = submissionPayload() as Record<string, unknown>;
    for (const [field, value] of [
      ["historySnapshot", []],
      ["modelReferenceIntent", { endpoint: "private" }],
      ["graphContentDigest", "a".repeat(64)],
      ["objectKey", "private/object"],
    ] as const) {
      assert.equal(
        AiConversationSubmissionSchema.safeParse({ ...submission, [field]: value })
          .success,
        false,
      );
    }
  });

  it("validates inline and downloadable Artifact lifecycle without file IDs", () => {
    const artifact = {
      content: { answer: 42 },
      conversationId: CONVERSATION_ID,
      createdAt: NOW,
      downloadAvailable: false,
      failedAt: null,
      failureCode: null,
      id: FILE_ID,
      messageId: RUN_ID,
      readyAt: NOW,
      schemaVersion: AI_ARTIFACT_SCHEMA_VERSION,
      status: "ready" as const,
      title: "Answer",
      type: "json" as const,
      updatedAt: NOW,
    };
    assert.equal(AiArtifactSchema.safeParse(artifact).success, true);
    assert.equal(
      AiArtifactSchema.safeParse({ ...artifact, fileObjectId: FILE_ID }).success,
      false,
    );
    assert.equal(
      AiArtifactSchema.safeParse({
        ...artifact,
        downloadAvailable: true,
        status: "pending",
      }).success,
      false,
    );
  });
});

function submissionPayload() {
  return {
    conversation: {
      agentVersionId: AGENT_VERSION_ID,
      createdAt: NOW,
      id: CONVERSATION_ID,
      lastMessageAt: NOW,
      messageSequence: 2,
      schemaVersion: AI_CONVERSATION_SCHEMA_VERSION,
      status: "active" as const,
      title: "Summarize this file",
      updatedAt: NOW,
    },
    deduplicated: false,
    execution: {
      agentVersionId: AGENT_VERSION_ID,
      clientRequestId: CLIENT_REQUEST_ID,
      createdAt: NOW,
      outputNodeId: "compose",
      runId: RUN_ID,
      status: "queued" as const,
    },
    requestMessage: {
      attachments: [
        {
          byteSize: 10,
          fileId: FILE_ID,
          mimeType: "text/plain",
          originalName: "prompt.txt",
        },
      ],
      content: "Summarize this file",
      conversationId: CONVERSATION_ID,
      createdAt: NOW,
      finishedAt: NOW,
      id: USER_MESSAGE_ID,
      replyToMessageId: null,
      role: "user" as const,
      runId: null,
      schemaVersion: AI_MESSAGE_SCHEMA_VERSION,
      sequence: 1,
      startedAt: null,
      status: "completed" as const,
      updatedAt: NOW,
    },
    responseMessage: {
      attachments: [],
      content: null,
      conversationId: CONVERSATION_ID,
      createdAt: NOW,
      errorCode: null,
      finishedAt: null,
      id: RUN_ID,
      replyToMessageId: USER_MESSAGE_ID,
      role: "assistant" as const,
      runId: RUN_ID,
      schemaVersion: AI_MESSAGE_SCHEMA_VERSION,
      sequence: 2,
      startedAt: null,
      status: "queued" as const,
      updatedAt: NOW,
    },
  };
}
