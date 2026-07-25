import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  Param,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import {
  RUN_EVENT_ERROR_CODES,
  type RunEvent,
} from "@hermes-swarm/api-contracts/ai";
import { AccessOperation, AccessResource } from "@hermes-swarm/rbac";
import { RequireFeature } from "../feature-access/require-feature.decorator.js";
import { RuntimeRunEventsService } from "./runtime-run-events.service.js";

const WORKSPACE_ADMIN = ["workspace-owner", "workspace-admin"];
const MAX_EVENT_SEQUENCE = 2_147_483_647;

type RuntimeRunEventHistoryQuery = {
  afterSequence: number;
  limit: number;
};

type RuntimeRunEventStreamQuery = {
  afterSequence?: number;
};

type SseRequest = {
  off?: (event: "close", listener: () => void) => void;
  on: (event: "close", listener: () => void) => void;
};

type SseResponse = {
  end: () => void;
  flushHeaders?: () => void;
  once?: (event: "drain", listener: () => void) => void;
  removeListener?: (event: "drain", listener: () => void) => void;
  setHeader: (name: string, value: string) => void;
  status: (statusCode: number) => SseResponse;
  writableEnded?: boolean;
  write: (chunk: string) => boolean;
};

@Controller("admin/ai/runs")
@RequireFeature("feature:ai:enabled")
@AccessResource({
  entity: "runtime-run",
  entityLabel: "AI 运行记录",
  entityOrder: 75,
  purpose: "run_events",
  purposeLabel: "运行事件",
  purposeOrder: 10,
  scope: "workspace",
})
export class RuntimeRunEventsController {
  constructor(private readonly events: RuntimeRunEventsService) {}

  @Get(":runId/events")
  @AccessOperation({
    defaultRoles: WORKSPACE_ADMIN,
    description: "按顺序读取当前工作空间 AI 运行的持久事件。",
    label: "查看运行事件",
    operation: "read_events",
    sortOrder: 10,
  })
  list(
    @Param("runId") runId: string,
    @Query() query: RuntimeRunEventHistoryQuery,
  ) {
    return this.events.list(runId, query);
  }

  @Get(":runId/events/stream")
  @AccessOperation({
    defaultRoles: WORKSPACE_ADMIN,
    description: "从持久游标恢复并持续接收当前工作空间 AI 运行事件。",
    label: "订阅运行事件",
    operation: "stream_events",
    sortOrder: 20,
  })
  async stream(
    @Param("runId") runId: string,
    @Query() query: RuntimeRunEventStreamQuery,
    @Headers("last-event-id") lastEventId: string | string[] | undefined,
    @Req() request: SseRequest,
    @Res() response: SseResponse,
  ) {
    const afterSequence = resolveAfterSequence(
      query.afterSequence,
      lastEventId,
    );
    const abortController = new AbortController();
    const handleClose = () => abortController.abort();
    let streamOpened = false;
    request.on("close", handleClose);

    try {
      const stream = await this.events.openStream(
        runId,
        afterSequence,
        abortController.signal,
      );
      response.status(200);
      response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      response.setHeader("Cache-Control", "no-cache, no-transform");
      response.setHeader("Connection", "keep-alive");
      response.setHeader("X-Accel-Buffering", "no");
      response.flushHeaders?.();
      streamOpened = true;

      for await (const event of stream) {
        if (abortController.signal.aborted) break;
        const accepted = response.write(toSseFrame(event));
        if (!accepted) {
          await waitForDrain(response, abortController.signal);
        }
      }
    } finally {
      request.off?.("close", handleClose);
      if (streamOpened && !response.writableEnded) response.end();
    }
  }
}

export function resolveAfterSequence(
  queryAfterSequence: number | undefined,
  lastEventId: string | string[] | undefined,
) {
  const headerValue = Array.isArray(lastEventId) ? lastEventId[0] : lastEventId;
  const headerSequence =
    headerValue === undefined
      ? 0
      : parseSequence(headerValue, "Last-Event-ID");
  const querySequence = queryAfterSequence ?? 0;
  if (
    !Number.isSafeInteger(querySequence) ||
    querySequence < 0 ||
    querySequence > MAX_EVENT_SEQUENCE
  ) {
    throw invalidCursor();
  }
  return Math.max(querySequence, headerSequence);
}

export function toSseFrame(event: RunEvent) {
  return `id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

function parseSequence(value: string, source: string) {
  if (!/^(0|[1-9]\d*)$/.test(value)) throw invalidCursor(source);
  const sequence = Number(value);
  if (
    !Number.isSafeInteger(sequence) ||
    sequence < 0 ||
    sequence > MAX_EVENT_SEQUENCE
  ) {
    throw invalidCursor(source);
  }
  return sequence;
}

function waitForDrain(response: SseResponse, signal: AbortSignal) {
  if (signal.aborted || !response.once) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const finish = () => {
      signal.removeEventListener("abort", finish);
      response.removeListener?.("drain", finish);
      resolve();
    };
    signal.addEventListener("abort", finish, { once: true });
    response.once?.("drain", finish);
  });
}

function invalidCursor(source = "cursor") {
  return new BadRequestException({
    code: RUN_EVENT_ERROR_CODES.invalidCursor,
    message: `${source} is not a valid Runtime Run event cursor.`,
    statusCode: 400,
  });
}
