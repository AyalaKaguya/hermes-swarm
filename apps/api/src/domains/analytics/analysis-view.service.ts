import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import {
  AnalysisViewSchema,
  AnalysisViewIdSchema,
  CreateAnalysisViewRequestSchema,
  DeleteAnalysisViewRequestSchema,
  UpdateAnalysisViewRequestSchema,
  VisualizationSpecSchema,
  type AnalysisQuery,
  type AnalysisView,
  type CreateAnalysisViewRequest,
  type DatasetResultField,
  type DeleteAnalysisViewRequest,
  type UpdateAnalysisViewRequest,
  type VisualizationSpec,
} from "@hermes-swarm/api-contracts/analytics";
import { AnalysisView as AnalysisViewEntity } from "@hermes-swarm/core";
import type { Repository } from "typeorm";
import { WorkspaceContextService } from "../../common/database/workspace-context.service.js";
import { AnalyticsQueryGateway } from "./analytics-query.gateway.js";
import type { AnalyticsAuthorizationContext } from "./analytics-source.adapter.js";

@Injectable()
export class AnalysisViewService {
  constructor(
    private readonly workspaceContext: WorkspaceContextService,
    private readonly gateway: AnalyticsQueryGateway,
    @InjectRepository(AnalysisViewEntity)
    private readonly views: Repository<AnalysisViewEntity>,
  ) {}

  async list(): Promise<AnalysisView[]> {
    const workspaceId = this.currentWorkspaceId();
    const views = await this.views.find({
      order: { updatedAt: "DESC" },
      where: { workspaceId },
    });
    return views.map(toAnalysisView);
  }

  async get(viewId: string): Promise<AnalysisView> {
    return toAnalysisView(
      await this.requireWorkspaceView(this.currentWorkspaceId(), viewId),
    );
  }

  async create(
    payload: unknown,
    authorization: AnalyticsAuthorizationContext,
  ): Promise<AnalysisView> {
    const input = parseCreateRequest(payload);
    const workspaceId = this.currentWorkspaceId();
    const definition = await this.validateDefinition(input, authorization);
    const entity = this.views.create({
      datasetId: definition.datasetId,
      name: definition.name,
      query: definition.query,
      revision: 1,
      visualization: definition.visualization,
      workspaceId,
    });

    try {
      return toAnalysisView(await this.views.save(entity));
    } catch (error) {
      if (isUniqueViolation(error)) throw viewNameConflict();
      throw error;
    }
  }

  async update(
    viewId: string,
    payload: unknown,
    authorization: AnalyticsAuthorizationContext,
  ): Promise<AnalysisView> {
    const input = parseUpdateRequest(payload);
    const workspaceId = this.currentWorkspaceId();
    const currentEntity = await this.requireWorkspaceView(workspaceId, viewId);
    const current = toAnalysisView(currentEntity);
    if (current.revision !== input.expectedRevision) throw staleView();

    const candidate: CreateAnalysisViewRequest = {
      datasetId: input.datasetId ?? current.datasetId,
      name: input.name ?? current.name,
      query: input.query ?? current.query,
      visualization: input.visualization ?? current.visualization,
    };
    const definitionChanged =
      input.datasetId !== undefined ||
      input.query !== undefined ||
      input.visualization !== undefined;
    const definition = definitionChanged
      ? await this.validateDefinition(candidate, authorization)
      : candidate;
    const updatedAt = new Date();

    try {
      const result = await this.views.update(
        {
          id: current.id,
          revision: input.expectedRevision,
          workspaceId,
        },
        {
          datasetId: definition.datasetId,
          name: definition.name,
          query: definition.query,
          revision: () => '"revision" + 1',
          updatedAt,
          visualization: definition.visualization,
        },
      );
      if (result.affected !== 1) throw staleView();
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      if (isUniqueViolation(error)) throw viewNameConflict();
      throw error;
    }

    return toAnalysisView(await this.requireWorkspaceView(workspaceId, current.id));
  }

  async delete(viewId: string, payload: unknown): Promise<void> {
    const input = parseDeleteRequest(payload);
    const workspaceId = this.currentWorkspaceId();
    const current = await this.requireWorkspaceView(workspaceId, viewId);
    if (current.revision !== input.expectedRevision) throw staleView();

    const result = await this.views.delete({
      id: current.id,
      revision: input.expectedRevision,
      workspaceId,
    });
    if (result.affected !== 1) throw staleView();
  }

  private async validateDefinition(
    input: CreateAnalysisViewRequest,
    authorization: AnalyticsAuthorizationContext,
  ): Promise<CreateAnalysisViewRequest> {
    if (input.datasetId !== input.query.sourceKey) throw invalidView();
    const validated = await this.gateway.validate(input.query, authorization);
    const visualization = parseVisualization(input.visualization);
    validateVisualizationAgainstResult(visualization, validated.resultSchema);
    return {
      datasetId: input.datasetId,
      name: input.name.trim(),
      query: validated.query,
      visualization,
    };
  }

  private async requireWorkspaceView(workspaceId: string, viewId: string) {
    if (!isUuid(viewId)) throw viewNotFound();
    const view = await this.views.findOne({
      where: { id: viewId, workspaceId },
    });
    if (!view) throw viewNotFound();
    return view;
  }

  private currentWorkspaceId() {
    const workspaceId = this.workspaceContext.current(false)?.workspaceId.trim();
    if (!workspaceId) {
      throw new InternalServerErrorException({
        code: "ANALYTICS_CONTEXT_REQUIRED",
        message: "A trusted workspace context is required for analysis views.",
      });
    }
    return workspaceId;
  }
}

function parseCreateRequest(value: unknown): CreateAnalysisViewRequest {
  const parsed = CreateAnalysisViewRequestSchema.safeParse(value);
  if (!parsed.success) throw invalidView();
  return parsed.data;
}

function parseUpdateRequest(value: unknown): UpdateAnalysisViewRequest {
  const parsed = UpdateAnalysisViewRequestSchema.safeParse(value);
  if (!parsed.success) throw invalidView();
  return parsed.data;
}

function parseDeleteRequest(value: unknown): DeleteAnalysisViewRequest {
  const parsed = DeleteAnalysisViewRequestSchema.safeParse(value);
  if (!parsed.success) throw invalidView();
  return parsed.data;
}

function parseVisualization(value: unknown): VisualizationSpec {
  const parsed = VisualizationSpecSchema.safeParse(value);
  if (!parsed.success) throw invalidVisualization();
  return parsed.data;
}

function validateVisualizationAgainstResult(
  visualization: VisualizationSpec,
  resultSchema: readonly DatasetResultField[],
) {
  const fields = new Map(resultSchema.map((field) => [field.key, field]));
  const requireField = (key: string) => {
    const field = fields.get(key);
    if (!field) throw invalidVisualization();
    return field;
  };
  const requireNumericField = (key: string) => {
    const field = requireField(key);
    if (field.scalarType !== "number") throw invalidVisualization();
  };

  switch (visualization.type) {
    case "table":
      visualization.columns?.forEach((column) => requireField(column.field));
      break;
    case "kpi":
      if (resultSchema.length !== 1) throw invalidVisualization();
      requireNumericField(visualization.measure);
      break;
    case "bar":
    case "line":
    case "area":
      requireField(visualization.x);
      visualization.series.forEach((series) => requireNumericField(series.field));
      break;
    case "pie":
      requireField(visualization.dimension);
      requireNumericField(visualization.measure);
      break;
  }
}

function toAnalysisView(entity: AnalysisViewEntity): AnalysisView {
  const parsed = AnalysisViewSchema.safeParse({
    createdAt: toIsoDate(entity.createdAt),
    datasetId: entity.datasetId,
    id: entity.id,
    name: entity.name,
    query: entity.query,
    revision: entity.revision,
    updatedAt: toIsoDate(entity.updatedAt),
    visualization: entity.visualization,
    workspaceId: entity.workspaceId,
  });
  if (!parsed.success) {
    throw new InternalServerErrorException({
      code: "ANALYTICS_VIEW_INVALID",
      message: "Stored analysis view does not match its contract.",
    });
  }
  return parsed.data;
}

function toIsoDate(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "invalid";
}

function invalidView() {
  return new BadRequestException({
    code: "ANALYTICS_VIEW_INVALID",
    message: "Analysis view did not match its contract.",
  });
}

function invalidVisualization() {
  return new BadRequestException({
    code: "ANALYTICS_VISUALIZATION_INVALID",
    message: "Visualization fields are incompatible with the analysis query.",
  });
}

function viewNotFound() {
  return new NotFoundException({
    code: "ANALYTICS_VIEW_NOT_FOUND",
    message: "Analysis view was not found.",
  });
}

function staleView() {
  return new ConflictException({
    code: "ANALYTICS_VIEW_REVISION_CONFLICT",
    message: "Analysis view changed before the operation completed.",
  });
}

function viewNameConflict() {
  return new ConflictException({
    code: "ANALYTICS_VIEW_NAME_CONFLICT",
    message: "An analysis view with this name already exists.",
  });
}

function isUniqueViolation(error: unknown) {
  const code = (error as { code?: unknown })?.code;
  return code === "23505";
}

function isUuid(value: string) {
  return AnalysisViewIdSchema.safeParse(value).success;
}
