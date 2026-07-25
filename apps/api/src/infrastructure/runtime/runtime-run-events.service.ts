import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import {
  RunEventSchema,
  RUN_EVENT_ERROR_CODES,
  type RunEvent,
  type RunStatus,
} from "@hermes-swarm/api-contracts/ai";
import { RuntimeRun, RuntimeRunEvent } from "@hermes-swarm/core";
import { And, LessThanOrEqual, MoreThan, type Repository } from "typeorm";
import { WorkspaceContextService } from "../../common/database/workspace-context.service.js";

const TERMINAL_RUN_STATUSES = new Set<RunStatus>([
  "cancelled",
  "failed",
  "succeeded",
  "timedOut",
]);
const STREAM_BATCH_SIZE = 200;
const STREAM_POLL_INTERVAL_MS = 250;
const MAX_EVENT_SEQUENCE = 2_147_483_647;

export type RuntimeRunEventHistoryQuery = Readonly<{
  afterSequence: number;
  limit: number;
}>;

export type RuntimeRunEventPage = Readonly<{
  eventSequence: number;
  hasMore: boolean;
  items: RunEvent[];
  nextAfterSequence: number | null;
  runStatus: RunStatus;
}>;

type RuntimeRunSnapshot = Readonly<{
  eventSequence: number;
  status: RunStatus;
}>;

@Injectable()
export class RuntimeRunEventsService {
  constructor(
    @InjectRepository(RuntimeRun)
    private readonly runRepository: Repository<RuntimeRun>,
    @InjectRepository(RuntimeRunEvent)
    private readonly eventRepository: Repository<RuntimeRunEvent>,
    private readonly workspaceContext: WorkspaceContextService,
  ) {}

  async list(
    runId: string,
    query: RuntimeRunEventHistoryQuery,
  ): Promise<RuntimeRunEventPage> {
    const workspaceId = this.requireWorkspaceId();
    const snapshot = await this.loadSnapshot(workspaceId, runId);
    if (query.afterSequence > snapshot.eventSequence) throw invalidCursor();
    const rows = await this.loadEvents(
      workspaceId,
      runId,
      query.afterSequence,
      snapshot.eventSequence,
      query.limit + 1,
    );
    const hasMore = rows.length > query.limit;
    const visibleRows = hasMore ? rows.slice(0, query.limit) : rows;
    const items = visibleRows.map(toRunEvent);

    return {
      eventSequence: snapshot.eventSequence,
      hasMore,
      items,
      nextAfterSequence:
        hasMore && items.length > 0 ? items[items.length - 1]!.sequence : null,
      runStatus: snapshot.status,
    };
  }

  async openStream(
    runId: string,
    afterSequence: number,
    signal: AbortSignal,
  ): Promise<AsyncIterable<RunEvent>> {
    const workspaceId = this.requireWorkspaceId();
    const snapshot = await this.loadSnapshot(workspaceId, runId);
    if (afterSequence > snapshot.eventSequence) throw invalidCursor();

    return this.iterateEvents({
      afterSequence,
      initialSnapshot: snapshot,
      runId,
      signal,
      workspaceId,
    });
  }

  private async *iterateEvents(input: {
    afterSequence: number;
    initialSnapshot: RuntimeRunSnapshot;
    runId: string;
    signal: AbortSignal;
    workspaceId: string;
  }): AsyncGenerator<RunEvent> {
    let cursor = input.afterSequence;
    let snapshot = input.initialSnapshot;

    while (!input.signal.aborted) {
      const rows = await this.loadEvents(
        input.workspaceId,
        input.runId,
        cursor,
        snapshot.eventSequence,
        STREAM_BATCH_SIZE,
      );
      for (const row of rows) {
        const event = toRunEvent(row);
        cursor = event.sequence;
        yield event;
        if (input.signal.aborted) return;
      }

      if (rows.length === STREAM_BATCH_SIZE) continue;
      if (
        TERMINAL_RUN_STATUSES.has(snapshot.status) &&
        cursor >= snapshot.eventSequence
      ) {
        return;
      }

      await waitForNextPoll(input.signal);
      if (input.signal.aborted) return;
      snapshot = await this.loadSnapshot(input.workspaceId, input.runId);
    }
  }

  private async loadSnapshot(
    workspaceId: string,
    runId: string,
  ): Promise<RuntimeRunSnapshot> {
    const run = await this.runRepository.findOne({
      select: { eventSequence: true, status: true },
      where: { id: runId, workspaceId },
    });
    if (!run) throw runUnavailable();
    if (
      !Number.isSafeInteger(run.eventSequence) ||
      run.eventSequence < 0 ||
      run.eventSequence > MAX_EVENT_SEQUENCE
    ) {
      throw new Error("Runtime Run event sequence invariant failed");
    }
    return { eventSequence: run.eventSequence, status: run.status };
  }

  private loadEvents(
    workspaceId: string,
    runId: string,
    afterSequence: number,
    throughSequence: number,
    take: number,
  ) {
    return this.eventRepository.find({
      order: { sequence: "ASC" },
      take,
      where: {
        runId,
        sequence: And(
          MoreThan(afterSequence),
          LessThanOrEqual(throughSequence),
        ),
        workspaceId,
      },
    });
  }

  private requireWorkspaceId() {
    const workspaceId = this.workspaceContext.current().workspaceId;
    if (!isUuid(workspaceId)) {
      throw new Error("Runtime Run Workspace context invariant failed");
    }
    return workspaceId.toLowerCase();
  }
}

function toRunEvent(row: RuntimeRunEvent): RunEvent {
  return RunEventSchema.parse({
    callId: row.callId,
    eventKey: row.eventKey,
    id: row.id,
    nodeId: row.nodeId,
    occurredAt: row.occurredAt.toISOString(),
    payload: row.payload,
    runId: row.runId,
    schemaVersion: row.schemaVersion,
    sequence: row.sequence,
    type: row.type,
    workspaceId: row.workspaceId,
  });
}

function waitForNextPoll(signal: AbortSignal) {
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(finish, STREAM_POLL_INTERVAL_MS);
    signal.addEventListener("abort", finish, { once: true });

    function finish() {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    }
  });
}

function runUnavailable() {
  return new NotFoundException({
    code: RUN_EVENT_ERROR_CODES.runUnavailable,
    message: "Runtime Run is unavailable.",
    statusCode: 404,
  });
}

function invalidCursor() {
  return new BadRequestException({
    code: RUN_EVENT_ERROR_CODES.invalidCursor,
    message: "Runtime Run event cursor is invalid.",
    statusCode: 400,
  });
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}
