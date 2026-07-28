import type { RunnableConfig } from "@langchain/core/runnables";
import { Command } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import {
  GRAPH_EXECUTION_OUTCOME_SCHEMA_VERSION,
  parseGraphExecutionOutcome,
  type GraphEngineAdapter,
  type GraphEngineExecutionRequest,
  type HermesJsonValue,
} from "@hermes-swarm/agent-sdk";
import { HermesLangGraphCheckpointer } from "./hermes-langgraph-checkpointer.js";

export interface LangGraphProgram {
  getState(config: RunnableConfig): Promise<Readonly<{
    next: readonly string[];
    tasks?: readonly Readonly<{ interrupts?: readonly unknown[] }>[];
  }>>;
  invoke(input: unknown, config: RunnableConfig): Promise<unknown>;
}

export interface LangGraphProgramCompiler {
  compile(input: Readonly<{
    checkpointer: BaseCheckpointSaver;
    definition: HermesJsonValue;
  }>): LangGraphProgram;
}

export class LangGraphEngineAdapter implements GraphEngineAdapter {
  readonly descriptor = Object.freeze({
    checkpointVersion: "langgraph.checkpoint/v4-jsonplus/v1",
    kind: "langgraph.state" as const,
  });

  constructor(private readonly compiler: LangGraphProgramCompiler) {
    if (!compiler || typeof compiler.compile !== "function") {
      throw new Error("LangGraph program compiler is invalid.");
    }
  }

  async execute(request: GraphEngineExecutionRequest) {
    if (request.signal.aborted) return cancelledOutcome();
    if (request.envelope.checkpoint.namespace !== "") {
      throw new Error("LangGraph execution requires the root checkpoint namespace.");
    }
    const checkpointer = new HermesLangGraphCheckpointer(
      request.envelope.lease.runId,
      request.checkpoints,
    );
    const program = this.compiler.compile({
      checkpointer,
      definition: request.envelope.graphDefinition,
    });
    if (
      !program ||
      typeof program.invoke !== "function" ||
      typeof program.getState !== "function"
    ) {
      throw new Error("LangGraph program is invalid.");
    }

    const checkpointId = request.envelope.checkpoint.adapterCheckpointKey;
    const hasResumeInput = Object.hasOwn(request.envelope, "resumeInput");
    if (hasResumeInput && !request.checkpoint) {
      throw new Error("LangGraph resume requires a durable checkpoint.");
    }
    const graphInput = hasResumeInput
      ? new Command({ resume: request.envelope.resumeInput })
      : request.checkpoint
        ? null
        : request.envelope.input;
    const invokeConfig: RunnableConfig = {
      configurable: {
        checkpoint_id: checkpointId,
        checkpoint_ns: request.envelope.checkpoint.namespace,
        thread_id: request.envelope.lease.runId,
      },
      signal: request.signal,
    };
    const output = await program.invoke(graphInput, invokeConfig);
    if (request.signal.aborted) return cancelledOutcome();
    const latestConfig: RunnableConfig = {
      configurable: {
        checkpoint_ns: request.envelope.checkpoint.namespace,
        thread_id: request.envelope.lease.runId,
      },
    };
    const snapshot = await program.getState(latestConfig);
    if (request.signal.aborted) return cancelledOutcome();
    if (isWaitingSnapshot(snapshot)) {
      const latest = await request.checkpoints.loadLatest(
        request.envelope.checkpoint.namespace,
      );
      if (!latest) {
        throw new Error("LangGraph paused without a durable checkpoint.");
      }
      return parseGraphExecutionOutcome({
        checkpoint: {
          adapterCheckpointKey: latest.checkpoint.adapterCheckpointKey,
          checkpointId: latest.checkpoint.checkpointId,
          namespace: latest.checkpoint.namespace,
          sequence: latest.checkpoint.sequence,
        },
        schemaVersion: GRAPH_EXECUTION_OUTCOME_SCHEMA_VERSION,
        status: "waiting",
      });
    }
    return parseGraphExecutionOutcome({
      output,
      schemaVersion: GRAPH_EXECUTION_OUTCOME_SCHEMA_VERSION,
      status: "succeeded",
    });
  }
}

function isWaitingSnapshot(value: unknown) {
  if (
    value === null ||
    typeof value !== "object" ||
    !("next" in value) ||
    !Array.isArray(value.next) ||
    !value.next.every((item) => typeof item === "string")
  ) {
    throw new Error("LangGraph state snapshot is invalid.");
  }
  if (value.next.length > 0) return true;
  if (!("tasks" in value) || value.tasks === undefined) return false;
  if (!Array.isArray(value.tasks)) {
    throw new Error("LangGraph state snapshot is invalid.");
  }
  return value.tasks.some(
    (task) =>
      task !== null &&
      typeof task === "object" &&
      "interrupts" in task &&
      Array.isArray(task.interrupts) &&
      task.interrupts.length > 0,
  );
}

function cancelledOutcome() {
  return parseGraphExecutionOutcome({
    schemaVersion: GRAPH_EXECUTION_OUTCOME_SCHEMA_VERSION,
    status: "cancelled",
  });
}
