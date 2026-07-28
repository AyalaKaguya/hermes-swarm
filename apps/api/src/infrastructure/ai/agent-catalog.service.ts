import { createHash } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { UuidSchema } from "@hermes-swarm/api-contracts";
import {
  AGENT_CATALOG_ERROR_CODES,
  AI_API_VERSION,
  AgentDefinitionSchema,
  CreateAgentRequestSchema,
  PublishAgentDraftRequestSchema,
  ReplaceAgentDraftRequestSchema,
  UpdateAgentRequestSchema,
  type Agent,
  type AgentDefinition,
  type AgentDraft,
  type AgentVersion,
  type AgentVersionSummary,
  type CreateAgentRequest,
  type PublishAgentDraftRequest,
  type ReplaceAgentDraftRequest,
  type UpdateAgentRequest,
} from "@hermes-swarm/api-contracts/ai";
import {
  Agent as AgentEntity,
  AgentDraft as AgentDraftEntity,
  AgentVersion as AgentVersionEntity,
} from "@hermes-swarm/core";
import {
  DataSource,
  type EntityManager,
  type ObjectLiteral,
  type Repository,
} from "typeorm";
import type { ZodType } from "zod";
import { WorkspaceContextService } from "../../common/database/workspace-context.service.js";
import { ModelProviderCatalogService } from "./model-provider-catalog.service.js";
import { ToolCatalogService } from "./tool-catalog.service.js";

const ERROR = AGENT_CATALOG_ERROR_CODES;

@Injectable()
export class AgentCatalogService {
  constructor(
    @InjectRepository(AgentEntity)
    private readonly agentRepository: Repository<AgentEntity>,
    @InjectRepository(AgentDraftEntity)
    private readonly draftRepository: Repository<AgentDraftEntity>,
    @InjectRepository(AgentVersionEntity)
    private readonly versionRepository: Repository<AgentVersionEntity>,
    private readonly dataSource: DataSource,
    private readonly workspaceContext: WorkspaceContextService,
    private readonly modelCatalog: ModelProviderCatalogService,
    private readonly toolCatalog: ToolCatalogService,
  ) {}

  async listAgents(): Promise<Agent[]> {
    const workspaceId = this.currentWorkspaceId();
    const agents = await this.agentRepository.find({
      order: { updatedAt: "DESC" },
      where: { workspaceId },
    });
    return agents.map(toAgent);
  }

  async getAgent(agentId: string): Promise<Agent> {
    const workspaceId = this.currentWorkspaceId();
    return toAgent(await this.requireAgent(this.agentRepository, workspaceId, agentId));
  }

  async createAgent(payload: CreateAgentRequest): Promise<Agent> {
    const workspaceId = this.currentWorkspaceId();
    const parsed = parseRequest(CreateAgentRequestSchema, payload);
    const definition = normalizeDefinition(parsed);

    try {
      return await this.dataSource.transaction(async (manager) => {
        const agents = manager.getRepository(AgentEntity);
        const drafts = manager.getRepository(AgentDraftEntity);
        const agent = await agents.save(
          agents.create({
            description: parsed.description,
            latestVersion: 0,
            name: parsed.name,
            revision: 1,
            status: parsed.status,
            workspaceId,
          }),
        );
        await drafts.save(
          drafts.create({
            agentId: agent.id,
            apiVersion: AI_API_VERSION,
            graph: definition.graph as AgentDraftEntity["graph"],
            modelReferences:
              definition.modelReferences as AgentDraftEntity["modelReferences"],
            revision: 1,
            toolReferences:
              definition.toolReferences as AgentDraftEntity["toolReferences"],
            workspaceId,
          }),
        );
        return toAgent(agent);
      });
    } catch (error) {
      if (isConstraintError(error)) {
        throw versionedConflict(
          ERROR.revisionConflict,
          "Agent conflicts with existing workspace data",
        );
      }
      throw error;
    }
  }

  async updateAgent(
    agentId: string,
    payload: UpdateAgentRequest,
  ): Promise<Agent> {
    const workspaceId = this.currentWorkspaceId();
    const parsed = parseRequest(UpdateAgentRequestSchema, payload);
    await this.requireAgent(this.agentRepository, workspaceId, agentId);

    const patch = {
      ...(parsed.description === undefined
        ? {}
        : { description: parsed.description }),
      ...(parsed.name === undefined ? {} : { name: parsed.name }),
      ...(parsed.status === undefined ? {} : { status: parsed.status }),
      revision: () => "revision + 1",
    };
    await updateOrConflict(
      this.agentRepository,
      { id: agentId, revision: parsed.expectedRevision, workspaceId },
      patch,
      ERROR.revisionConflict,
      "Agent changed before the update completed",
    );
    return toAgent(
      await this.requireAgent(this.agentRepository, workspaceId, agentId),
    );
  }

  async getDraft(agentId: string): Promise<AgentDraft> {
    const workspaceId = this.currentWorkspaceId();
    await this.requireAgent(this.agentRepository, workspaceId, agentId);
    return toDraft(
      await this.requireDraft(this.draftRepository, workspaceId, agentId),
    );
  }

  async replaceDraft(
    agentId: string,
    payload: ReplaceAgentDraftRequest,
  ): Promise<AgentDraft> {
    const workspaceId = this.currentWorkspaceId();
    const parsed = parseRequest(ReplaceAgentDraftRequestSchema, payload);
    const definition = normalizeDefinition(parsed);
    await this.requireAgent(this.agentRepository, workspaceId, agentId);

    await updateOrConflict(
      this.draftRepository,
      {
        agentId,
        revision: parsed.expectedRevision,
        workspaceId,
      },
      {
        graph: definition.graph,
        modelReferences: definition.modelReferences,
        revision: () => "revision + 1",
        toolReferences: definition.toolReferences,
      },
      ERROR.draftRevisionConflict,
      "Agent Draft changed before the update completed",
    );
    return toDraft(
      await this.requireDraft(this.draftRepository, workspaceId, agentId),
    );
  }

  async listVersions(agentId: string): Promise<AgentVersionSummary[]> {
    const workspaceId = this.currentWorkspaceId();
    await this.requireAgent(this.agentRepository, workspaceId, agentId);
    const versions = await this.versionRepository.find({
      order: { version: "DESC" },
      where: { agentId, workspaceId },
    });
    return versions.map(toVersionSummary);
  }

  async getVersion(agentId: string, version: number | string): Promise<AgentVersion> {
    const workspaceId = this.currentWorkspaceId();
    const parsedVersion = parseVersionNumber(version);
    await this.requireAgent(this.agentRepository, workspaceId, agentId);
    const entity = await this.versionRepository.findOne({
      where: { agentId, version: parsedVersion, workspaceId },
    });
    if (!entity) throw agentNotFound();
    return toVersion(entity);
  }

  async publishDraft(
    agentId: string,
    payload: PublishAgentDraftRequest,
  ): Promise<AgentVersion> {
    const workspaceId = this.currentWorkspaceId();
    const parsed = parseRequest(PublishAgentDraftRequestSchema, payload);

    try {
      return await this.dataSource.transaction(async (manager) => {
        const agents = manager.getRepository(AgentEntity);
        const drafts = manager.getRepository(AgentDraftEntity);
        const versions = manager.getRepository(AgentVersionEntity);
        const agent = await this.requireAgent(
          agents,
          workspaceId,
          agentId,
          manager,
        );
        if (agent.status === "archived") {
          throw versionedConflict(
            ERROR.archived,
            "Archived Agents cannot publish new Versions",
          );
        }
        const draft = await this.requireDraft(
          drafts,
          workspaceId,
          agentId,
          manager,
        );
        if (draft.revision !== parsed.expectedRevision) {
          throw versionedConflict(
            ERROR.draftRevisionConflict,
            "Agent Draft changed before publication completed",
          );
        }

        const alreadyPublished = await versions.findOne({
          where: {
            agentId,
            draftRevision: draft.revision,
            workspaceId,
          },
        });
        if (alreadyPublished) {
          throw versionedConflict(
            ERROR.versionConflict,
            "This Agent Draft revision is already published",
          );
        }

        // Clone the locked Draft once; every persisted field and the digest are
        // derived from this exact revision, never from a later repository read.
        const snapshot = normalizeDefinition(draft);
        await this.assertAvailableReferences(snapshot);
        const nextVersion = agent.latestVersion + 1;
        const contentDigest = digestAgentDefinition(snapshot, draft.apiVersion);
        const saved = await versions.save(
          versions.create({
            agentId,
            apiVersion: draft.apiVersion,
            contentDigest,
            draftRevision: draft.revision,
            graph: snapshot.graph as AgentVersionEntity["graph"],
            modelReferences:
              snapshot.modelReferences as AgentVersionEntity["modelReferences"],
            toolReferences:
              snapshot.toolReferences as AgentVersionEntity["toolReferences"],
            version: nextVersion,
            workspaceId,
          }),
        );
        const counter = await agents.update(
          { id: agent.id, latestVersion: agent.latestVersion, workspaceId },
          { latestVersion: nextVersion },
        );
        if (counter.affected !== 1) {
          throw versionedConflict(
            ERROR.versionConflict,
            "Agent Version number changed before publication completed",
          );
        }
        return toVersion(saved);
      });
    } catch (error) {
      if (error instanceof ConflictException || error instanceof NotFoundException) {
        throw error;
      }
      if (isConstraintError(error)) {
        throw versionedConflict(
          ERROR.versionConflict,
          "Agent Version conflicts with an existing publication",
        );
      }
      throw error;
    }
  }

  private currentWorkspaceId() {
    const workspaceId = this.workspaceContext.current(false)?.workspaceId.trim();
    if (!workspaceId || !UuidSchema.safeParse(workspaceId).success) {
      throw agentNotFound();
    }
    return workspaceId;
  }

  private async assertAvailableReferences(definition: AgentDefinition) {
    try {
      await Promise.all(
        definition.toolReferences.map(({ toolDefinitionId, version }) =>
          this.toolCatalog.resolveWorkspaceTool(toolDefinitionId, version),
        ),
      );
      await Promise.all(
        definition.modelReferences.map((reference) =>
          this.modelCatalog.resolveWorkspaceModelReference(reference),
        ),
      );
      await Promise.all(
        [...workspaceDefaultCapabilities(definition)].map((capability) =>
          this.modelCatalog.resolveWorkspaceDefault(capability),
        ),
      );
    } catch (error) {
      if (!isExpectedReferenceUnavailable(error)) throw error;
      throw versionedConflict(
        ERROR.referenceUnavailable,
        "Agent Draft references an unavailable Model or Tool",
      );
    }
  }

  private async requireAgent(
    repository: Repository<AgentEntity>,
    workspaceId: string,
    agentId: string,
    manager?: EntityManager,
  ) {
    if (!UuidSchema.safeParse(agentId).success) throw agentNotFound();
    const agent = await repository.findOne({
      ...(manager ? { lock: { mode: "pessimistic_write" as const } } : {}),
      where: { id: agentId, workspaceId },
    });
    if (!agent) throw agentNotFound();
    return agent;
  }

  private async requireDraft(
    repository: Repository<AgentDraftEntity>,
    workspaceId: string,
    agentId: string,
    manager?: EntityManager,
  ) {
    const draft = await repository.findOne({
      ...(manager ? { lock: { mode: "pessimistic_read" as const } } : {}),
      where: { agentId, workspaceId },
    });
    if (!draft) throw agentNotFound();
    return draft;
  }
}

export function digestAgentDefinition(
  definition: AgentDefinition,
  apiVersion = AI_API_VERSION,
) {
  return createHash("sha256")
    .update(
      JSON.stringify(
        canonicalize({ apiVersion, ...definition }),
      ),
    )
    .digest("hex");
}

function normalizeDefinition(input: {
  graph: unknown;
  modelReferences: unknown;
  toolReferences: unknown;
}): AgentDefinition {
  const parsed = parseRequest(AgentDefinitionSchema, {
    graph: input.graph,
    modelReferences: input.modelReferences,
    toolReferences: input.toolReferences,
  });
  return {
    graph: structuredClone(parsed.graph),
    modelReferences: structuredClone(parsed.modelReferences).sort((left, right) =>
      modelReferenceKey(left).localeCompare(modelReferenceKey(right)),
    ),
    toolReferences: structuredClone(parsed.toolReferences).sort((left, right) =>
      toolReferenceKey(left).localeCompare(toolReferenceKey(right)),
    ),
  };
}

function toAgent(entity: AgentEntity): Agent {
  return {
    apiVersion: AI_API_VERSION,
    createdAt: entity.createdAt.toISOString(),
    description: entity.description,
    id: entity.id,
    latestVersion: entity.latestVersion,
    name: entity.name,
    revision: entity.revision,
    status: entity.status,
    updatedAt: entity.updatedAt.toISOString(),
  };
}

function toDraft(entity: AgentDraftEntity): AgentDraft {
  return {
    agentId: entity.agentId,
    apiVersion: entity.apiVersion,
    createdAt: entity.createdAt.toISOString(),
    revision: entity.revision,
    updatedAt: entity.updatedAt.toISOString(),
    ...normalizeDefinition(entity),
  };
}

function toVersionSummary(entity: AgentVersionEntity): AgentVersionSummary {
  return {
    agentId: entity.agentId,
    apiVersion: entity.apiVersion,
    contentDigest: entity.contentDigest,
    draftRevision: entity.draftRevision,
    id: entity.id,
    publishedAt: entity.createdAt.toISOString(),
    version: entity.version,
  };
}

function toVersion(entity: AgentVersionEntity): AgentVersion {
  return {
    ...toVersionSummary(entity),
    ...normalizeDefinition(entity),
  };
}

function parseRequest<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new BadRequestException({
      code: ERROR.definitionInvalid,
      message: "Agent request is invalid",
      statusCode: 400,
    });
  }
  return result.data;
}

function parseVersionNumber(value: number | string) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new BadRequestException({
      code: ERROR.versionInvalid,
      message: "Agent Version must be a positive integer",
      statusCode: 400,
    });
  }
  return parsed;
}

function agentNotFound() {
  return new NotFoundException({
    code: ERROR.notFound,
    message: "Agent not found",
    statusCode: 404,
  });
}

function versionedConflict(code: string, message: string) {
  return new ConflictException({ code, message, statusCode: 409 });
}

async function updateOrConflict<T extends ObjectLiteral>(
  repository: Repository<T>,
  criteria: Record<string, unknown>,
  patch: Record<string, unknown>,
  code: string,
  message: string,
) {
  try {
    const result = await repository.update(criteria as never, patch as never);
    if (result.affected !== 1) throw versionedConflict(code, message);
  } catch (error) {
    if (error instanceof ConflictException) throw error;
    if (isConstraintError(error)) {
      throw versionedConflict(code, "Agent conflicts with existing workspace data");
    }
    throw error;
  }
}

function isConstraintError(error: unknown) {
  const code = (error as { code?: unknown })?.code;
  return code === "23503" || code === "23505";
}

function isExpectedReferenceUnavailable(error: unknown) {
  return error instanceof BadRequestException ||
    error instanceof ConflictException ||
    error instanceof NotFoundException;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]),
  );
}

function modelReferenceKey(model: AgentDefinition["modelReferences"][number]) {
  return [
    model.providerScope,
    model.deploymentId,
    model.modelId,
    model.capability,
  ].join(":");
}

function toolReferenceKey(tool: AgentDefinition["toolReferences"][number]) {
  return `${tool.toolDefinitionId}:${tool.version}`;
}

function workspaceDefaultCapabilities(definition: AgentDefinition) {
  const capabilities = new Set<
    AgentDefinition["modelReferences"][number]["capability"]
  >();
  for (const node of definition.graph.nodes) {
    if (node.type !== "model") continue;
    const binding = node.config.model;
    if (binding.mode === "workspaceDefault") {
      capabilities.add(binding.capability);
    } else if (
      binding.mode === "requestOverride" &&
      binding.fallback.mode === "workspaceDefault"
    ) {
      capabilities.add(binding.capability);
    }
  }
  return capabilities;
}
