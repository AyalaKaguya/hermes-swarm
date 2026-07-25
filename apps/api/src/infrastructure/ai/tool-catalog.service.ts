import { createHash, randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import {
  AI_API_VERSION,
  AiObjectJsonSchema,
  ResolvedToolExecutionDescriptorSchema,
  type BindWorkspaceToolGrantConnectionRequest,
  type CreatePlatformToolDefinitionRequest,
  type CreatePlatformToolNetworkPolicyRequest,
  type CreatePlatformToolVersionRequest,
  type CreateWorkspaceToolConnectionRequest,
  type CreateWorkspaceToolGrantRequest,
  type ResolvedToolExecutionDescriptor,
  type ToolConnectionSecretWriteRequest,
  type ToolDefinition as RuntimeToolDefinition,
  type ToolVersionDriverConfig,
  type UpdatePlatformToolDefinitionRequest,
  type UpdatePlatformToolNetworkPolicyRequest,
  type UpdatePlatformToolVersionStatusRequest,
  type UpdateWorkspaceToolConnectionRequest,
  type UpdateWorkspaceToolGrantRequest,
} from "@hermes-swarm/api-contracts/ai";
import {
  ToolDefinition as ToolDefinitionEntity,
  ToolDefinitionNetworkPolicy as ToolDefinitionNetworkPolicyEntity,
  ToolDefinitionVersion as ToolDefinitionVersionEntity,
  ToolNetworkPolicy as ToolNetworkPolicyEntity,
  WorkspaceToolConnection as WorkspaceToolConnectionEntity,
  WorkspaceToolGrant as WorkspaceToolGrantEntity,
} from "@hermes-swarm/core";
import {
  DataSource,
  In,
  type ObjectLiteral,
  type Repository,
} from "typeorm";
import { WorkspaceContextService } from "../../common/database/workspace-context.service.js";
import { ToolConnectionSecretService } from "./tool-connection-secret.service.js";
import {
  assertTargetMatchesApprovedEndpoint,
  normalizeApprovedEndpoint,
  ToolSecurityPolicyError,
} from "./tool-security/index.js";

type SecretColumns = Pick<
  WorkspaceToolConnectionEntity,
  "secretEnvelope" | "secretId" | "secretRevision" | "secretUpdatedAt"
>;

@Injectable()
export class ToolCatalogService {
  private readonly allowHttpInDevelopment: boolean;

  constructor(
    @InjectRepository(ToolDefinitionEntity)
    private readonly toolDefinitionRepository: Repository<ToolDefinitionEntity>,
    @InjectRepository(ToolDefinitionVersionEntity)
    private readonly toolVersionRepository: Repository<ToolDefinitionVersionEntity>,
    @InjectRepository(ToolNetworkPolicyEntity)
    private readonly networkPolicyRepository: Repository<ToolNetworkPolicyEntity>,
    @InjectRepository(ToolDefinitionNetworkPolicyEntity)
    private readonly versionPolicyRepository: Repository<ToolDefinitionNetworkPolicyEntity>,
    @InjectRepository(WorkspaceToolConnectionEntity)
    private readonly connectionRepository: Repository<WorkspaceToolConnectionEntity>,
    @InjectRepository(WorkspaceToolGrantEntity)
    private readonly grantRepository: Repository<WorkspaceToolGrantEntity>,
    private readonly dataSource: DataSource,
    private readonly workspaceContext: WorkspaceContextService,
    private readonly connectionSecrets: ToolConnectionSecretService,
    config: ConfigService,
  ) {
    this.allowHttpInDevelopment =
      config.get<string>("NODE_ENV", "") === "development" &&
      config.get<boolean>("ai.allowHttpInDevelopment", false) === true;
  }

  async listPlatformToolDefinitions() {
    const definitions = await this.toolDefinitionRepository.find({
      order: { name: "ASC" },
    });
    return definitions.map(toPlatformToolDefinition);
  }

  async createPlatformToolDefinition(
    payload: CreatePlatformToolDefinitionRequest,
  ) {
    const definition = this.toolDefinitionRepository.create({
      description: payload.description.trim(),
      displayName: payload.displayName.trim(),
      name: payload.name.trim(),
      revision: 1,
      status: payload.status,
    });
    return toPlatformToolDefinition(
      await saveOrConflict(
        this.toolDefinitionRepository,
        definition,
        "Tool Definition conflicts with existing data",
      ),
    );
  }

  async updatePlatformToolDefinition(
    toolDefinitionId: string,
    payload: UpdatePlatformToolDefinitionRequest,
  ) {
    const definition = await this.requireToolDefinition(toolDefinitionId);
    await updateOrConflict(
      this.toolDefinitionRepository,
      { id: definition.id, revision: payload.expectedRevision },
      {
        ...(payload.description === undefined
          ? {}
          : { description: payload.description.trim() }),
        ...(payload.displayName === undefined
          ? {}
          : { displayName: payload.displayName.trim() }),
        ...(payload.name === undefined ? {} : { name: payload.name.trim() }),
        ...(payload.status === undefined ? {} : { status: payload.status }),
        revision: () => "revision + 1",
      },
      "Tool Definition changed before the update completed",
      "Tool Definition conflicts with existing data",
    );
    return toPlatformToolDefinition(
      await this.requireToolDefinition(definition.id),
    );
  }

  async listPlatformToolVersions(toolDefinitionId: string) {
    await this.requireToolDefinition(toolDefinitionId);
    const versions = await this.toolVersionRepository.find({
      order: { createdAt: "DESC" },
      where: { toolDefinitionId },
    });
    const policies = await this.policyIdsByVersion(versions.map(({ id }) => id));
    return versions.map((version) =>
      toPlatformToolVersion(version, policies.get(version.id) ?? []),
    );
  }

  async createPlatformToolVersion(
    toolDefinitionId: string,
    payload: CreatePlatformToolVersionRequest,
  ) {
    await this.requireToolDefinition(toolDefinitionId);
    const networkPolicyIds = [...payload.networkPolicyIds].sort();
    const outputRedactionPaths = [...payload.outputRedactionPaths].sort();
    const requiredPermissions = [...payload.requiredPermissions].sort();
    await this.requireNetworkPolicies(networkPolicyIds);
    const contentDigest = digestToolVersion({
      ...payload,
      networkPolicyIds,
      outputRedactionPaths,
      requiredPermissions,
    });

    try {
      return await this.dataSource.transaction(async (manager) => {
        const versionRepository = manager.getRepository(ToolDefinitionVersionEntity);
        const policyRepository = manager.getRepository(
          ToolDefinitionNetworkPolicyEntity,
        );
        const version = versionRepository.create({
          allowsArtifact: payload.allowsArtifact,
          contentLocked: false,
          contentDigest,
          driverConfig: payload.driverConfig,
          driverType: payload.driverType,
          idempotency: payload.idempotency,
          inputSchema: payload.inputSchema,
          maxResponseBytes: payload.maxResponseBytes,
          outputRedactionPaths,
          outputSchema: payload.outputSchema,
          requiredPermissions,
          retry: payload.retry,
          revision: 1,
          schemaVersion: payload.schemaVersion,
          sideEffect: payload.sideEffect,
          status: "draft",
          timeoutMs: payload.timeoutMs,
          toolDefinitionId,
          version: payload.version,
        });
        const saved = await versionRepository.save(version);
        if (networkPolicyIds.length > 0) {
          await policyRepository.save(
            networkPolicyIds.map((networkPolicyId) =>
              policyRepository.create({
                networkPolicyId,
                toolDefinitionVersionId: saved.id,
              }),
            ),
          );
        }
        await versionRepository.update(
          { id: saved.id },
          { contentLocked: true, status: payload.status },
        );
        const finalized = await versionRepository.findOneByOrFail({ id: saved.id });
        return toPlatformToolVersion(finalized, networkPolicyIds);
      });
    } catch (error) {
      if (isConstraintError(error)) {
        throw new ConflictException(
          "Tool Version conflicts with existing data",
        );
      }
      throw error;
    }
  }

  async updatePlatformToolVersionStatus(
    toolDefinitionId: string,
    version: string,
    payload: UpdatePlatformToolVersionStatusRequest,
  ) {
    const current = await this.requireToolVersion(toolDefinitionId, version);
    assertVersionStatusTransition(current.status, payload.status);
    await updateOrConflict(
      this.toolVersionRepository,
      { id: current.id, revision: payload.expectedRevision },
      { status: payload.status, revision: () => "revision + 1" },
      "Tool Version changed before the update completed",
      "Tool Version conflicts with existing data",
    );
    const updated = await this.requireToolVersion(toolDefinitionId, version);
    return toPlatformToolVersion(
      updated,
      await this.policyIdsForVersion(updated.id),
    );
  }

  async listPlatformToolNetworkPolicies() {
    const policies = await this.networkPolicyRepository.find({
      order: { name: "ASC" },
    });
    return policies.map(toPlatformToolNetworkPolicy);
  }

  async createPlatformToolNetworkPolicy(
    payload: CreatePlatformToolNetworkPolicyRequest,
  ) {
    const normalized = this.normalizeNetworkPolicy(payload);
    const policy = this.networkPolicyRepository.create({
      ...normalized,
      name: payload.name.trim(),
      revision: 1,
      status: payload.status,
    });
    return toPlatformToolNetworkPolicy(
      await saveOrConflict(
        this.networkPolicyRepository,
        policy,
        "Tool Network Policy conflicts with existing data",
      ),
    );
  }

  async updatePlatformToolNetworkPolicy(
    networkPolicyId: string,
    payload: UpdatePlatformToolNetworkPolicyRequest,
  ) {
    const current = await this.requireNetworkPolicy(networkPolicyId);
    const normalized = this.normalizeNetworkPolicy({
      host: payload.host ?? current.host,
      pathPrefix: payload.pathPrefix ?? current.pathPrefix,
      port: payload.port ?? current.port,
      scheme: payload.scheme ?? current.scheme,
    });
    await updateOrConflict(
      this.networkPolicyRepository,
      { id: current.id, revision: payload.expectedRevision },
      {
        ...normalized,
        ...(payload.name === undefined ? {} : { name: payload.name.trim() }),
        ...(payload.status === undefined ? {} : { status: payload.status }),
        revision: () => "revision + 1",
      },
      "Tool Network Policy changed before the update completed",
      "Tool Network Policy conflicts with existing data",
    );
    return toPlatformToolNetworkPolicy(
      await this.requireNetworkPolicy(current.id),
    );
  }

  async listWorkspaceToolConnections() {
    const workspaceId = this.currentWorkspaceId();
    const connections = await this.connectionRepository.find({
      order: { name: "ASC" },
      where: { workspaceId },
    });
    return connections.map((connection) => this.toWorkspaceConnection(connection));
  }

  async createWorkspaceToolConnection(
    payload: CreateWorkspaceToolConnectionRequest,
  ) {
    const workspaceId = this.currentWorkspaceId();
    const policy = await this.requireNetworkPolicy(payload.networkPolicyId);
    const baseUrl = this.normalizeConnectionBaseUrl(payload.baseUrl, policy);
    const secret = payload.secret
      ? this.createSecretColumns(payload.secret)
      : emptySecretColumns();
    const authHeaderName = payload.authType === "header"
      ? payload.authHeaderName ?? null
      : null;
    assertConnectionState({
      authHeaderName,
      authType: payload.authType,
      policyStatus: policy.status,
      secretId: secret.secretId,
      status: payload.status,
    });
    const connection = this.connectionRepository.create({
      authHeaderName,
      authType: payload.authType,
      baseUrl,
      driverType: payload.driverType,
      name: payload.name.trim(),
      networkPolicyId: policy.id,
      revision: 1,
      status: payload.status,
      workspaceId,
      ...secret,
    });
    return this.toWorkspaceConnection(
      await saveOrConflict(
        this.connectionRepository,
        connection,
        "Tool Connection conflicts with existing data",
      ),
    );
  }

  async updateWorkspaceToolConnection(
    connectionId: string,
    payload: UpdateWorkspaceToolConnectionRequest,
  ) {
    const workspaceId = this.currentWorkspaceId();
    const current = await this.requireWorkspaceConnection(
      workspaceId,
      connectionId,
    );
    const policy = await this.requireNetworkPolicy(
      payload.networkPolicyId ?? current.networkPolicyId,
    );
    const authType = payload.authType ?? current.authType;
    const authHeaderName = authType === "header"
      ? payload.authHeaderName === undefined
        ? current.authHeaderName
        : payload.authHeaderName
      : null;
    const clearSecret = authType === "none" && current.secretId !== null;
    const secretId = clearSecret ? null : current.secretId;
    const status = payload.status ?? current.status;
    const baseUrl = this.normalizeConnectionBaseUrl(
      payload.baseUrl ?? current.baseUrl,
      policy,
    );
    assertConnectionState({
      authHeaderName,
      authType,
      policyStatus: policy.status,
      secretId,
      status,
    });
    await updateOrConflict(
      this.connectionRepository,
      {
        id: current.id,
        revision: payload.expectedRevision,
        workspaceId,
      },
      {
        authHeaderName,
        authType,
        baseUrl,
        ...(payload.name === undefined ? {} : { name: payload.name.trim() }),
        networkPolicyId: policy.id,
        revision: () => "revision + 1",
        status,
        ...(clearSecret ? emptySecretColumns() : {}),
      },
      "Tool Connection changed before the update completed",
      "Tool Connection conflicts with existing data",
    );
    return this.toWorkspaceConnection(
      await this.requireWorkspaceConnection(workspaceId, current.id),
    );
  }

  async rotateWorkspaceToolConnectionSecret(
    connectionId: string,
    payload: ToolConnectionSecretWriteRequest,
  ) {
    const workspaceId = this.currentWorkspaceId();
    const connection = await this.requireWorkspaceConnection(
      workspaceId,
      connectionId,
    );
    if (connection.authType === "none") {
      throw new BadRequestException({
        code: "AI_TOOL_CONNECTION_AUTH_DISABLED",
        message: "A connection without authentication cannot store a credential",
      });
    }
    const encrypted = this.encryptConnectionSecret(payload.value);
    const now = new Date();
    await updateOrConflict(
      this.connectionRepository,
      { id: connection.id, revision: connection.revision, workspaceId },
      {
        revision: () => "revision + 1",
        secretEnvelope: encrypted,
        secretId: connection.secretId ?? randomUUID(),
        secretRevision: () => "secret_revision + 1",
        secretUpdatedAt: now,
      },
      "Tool Connection changed before the credential rotation completed",
      "Tool Connection credential conflicts with existing data",
    );
    const updated = await this.requireWorkspaceConnection(
      workspaceId,
      connection.id,
    );
    return { secret: this.connectionSecretMetadata(updated) };
  }

  async listWorkspaceToolGrants() {
    const workspaceId = this.currentWorkspaceId();
    const grants = await this.grantRepository.find({
      order: { createdAt: "DESC" },
      where: { workspaceId },
    });
    return Promise.all(grants.map((grant) => this.toWorkspaceGrant(grant)));
  }

  async createWorkspaceToolGrant(payload: CreateWorkspaceToolGrantRequest) {
    const workspaceId = this.currentWorkspaceId();
    const version = await this.requireToolVersion(
      payload.toolDefinitionId,
      payload.toolVersion,
    );
    const definition = await this.requireToolDefinition(
      payload.toolDefinitionId,
    );
    if (definition.status !== "enabled" || version.status !== "published") {
      throw new BadRequestException(
        "Only enabled, published Tool Versions can be granted",
      );
    }
    const expiresAt = parseNullableDate(payload.expiresAt);
    assertFutureExpiry(expiresAt);
    const grant = this.grantRepository.create({
      connectionId: null,
      enabled: payload.enabled,
      expiresAt,
      revision: 1,
      toolDefinitionId: payload.toolDefinitionId,
      toolVersion: payload.toolVersion,
      workspaceId,
    });
    if (payload.enabled) await this.assertGrantReady(grant, version);
    return this.toWorkspaceGrant(
      await saveOrConflict(
        this.grantRepository,
        grant,
        "Tool Grant conflicts with existing data",
      ),
    );
  }

  async updateWorkspaceToolGrant(
    grantId: string,
    payload: UpdateWorkspaceToolGrantRequest,
  ) {
    const workspaceId = this.currentWorkspaceId();
    const current = await this.requireWorkspaceGrant(workspaceId, grantId);
    const enabled = payload.enabled ?? current.enabled;
    const expiresAt = payload.expiresAt === undefined
      ? current.expiresAt
      : parseNullableDate(payload.expiresAt);
    if (enabled || payload.expiresAt !== undefined) assertFutureExpiry(expiresAt);
    if (enabled) {
      await this.assertGrantReady(
        { ...current, enabled, expiresAt },
        await this.requireToolVersion(
          current.toolDefinitionId,
          current.toolVersion,
        ),
      );
    }
    await updateOrConflict(
      this.grantRepository,
      { id: current.id, revision: payload.expectedRevision, workspaceId },
      { enabled, expiresAt, revision: () => "revision + 1" },
      "Tool Grant changed before the update completed",
      "Tool Grant conflicts with existing data",
    );
    return this.toWorkspaceGrant(
      await this.requireWorkspaceGrant(workspaceId, current.id),
    );
  }

  async bindWorkspaceToolGrantConnection(
    grantId: string,
    payload: BindWorkspaceToolGrantConnectionRequest,
  ) {
    const workspaceId = this.currentWorkspaceId();
    const current = await this.requireWorkspaceGrant(workspaceId, grantId);
    const version = await this.requireToolVersion(
      current.toolDefinitionId,
      current.toolVersion,
    );
    if (payload.connectionId !== null || version.driverType === "internal") {
      await this.assertGrantBinding(workspaceId, version, payload.connectionId);
    } else if (current.enabled) {
      throw toolUnavailable("An enabled external Tool Grant cannot be unbound");
    }
    const candidate = { ...current, connectionId: payload.connectionId };
    if (current.enabled) await this.assertGrantReady(candidate, version);
    await updateOrConflict(
      this.grantRepository,
      { id: current.id, revision: payload.expectedRevision, workspaceId },
      { connectionId: payload.connectionId, revision: () => "revision + 1" },
      "Tool Grant changed before the connection binding completed",
      "Tool Grant conflicts with existing data",
    );
    return this.toWorkspaceGrant(
      await this.requireWorkspaceGrant(workspaceId, current.id),
    );
  }

  /**
   * Resolves only public, revision-pinned execution metadata. Endpoint and
   * credential material stay behind the future Worker connection broker.
   */
  async resolveWorkspaceTool(
    toolDefinitionId: string,
    version: string,
  ): Promise<ResolvedToolExecutionDescriptor> {
    const workspaceId = this.currentWorkspaceId();
    const grant = await this.grantRepository.findOne({
      where: { toolDefinitionId, toolVersion: version, workspaceId },
    });
    if (!grant) throw toolUnavailable("Tool Grant is unavailable");
    const toolVersion = await this.requireToolVersion(toolDefinitionId, version);
    const resolved = await this.assertGrantReady(grant, toolVersion);
    const definition = resolved.definition;
    const networkPolicies = resolved.policies.map(({ id, revision }) => ({
      id,
      revision,
    }));
    const tool: RuntimeToolDefinition = {
      allowsArtifact: toolVersion.allowsArtifact,
      ...(resolved.connection
        ? { connectionId: resolved.connection.id }
        : {}),
      description: definition.description,
      driverType: toolVersion.driverType,
      id: definition.id,
      idempotency: toolVersion.idempotency,
      inputSchema: AiObjectJsonSchema.parse(toolVersion.inputSchema),
      maxResponseBytes: toolVersion.maxResponseBytes,
      name: definition.name,
      networkPolicyIds: networkPolicies.map(({ id }) => id),
      outputRedactionPaths: [...toolVersion.outputRedactionPaths],
      outputSchema: AiObjectJsonSchema.parse(toolVersion.outputSchema),
      requiredPermissions: [...toolVersion.requiredPermissions],
      retry: toolVersion.retry,
      schemaVersion: toolVersion.schemaVersion,
      sideEffect: toolVersion.sideEffect,
      timeoutMs: toolVersion.timeoutMs,
      version: toolVersion.version,
    };
    return ResolvedToolExecutionDescriptorSchema.parse({
      apiVersion: AI_API_VERSION,
      connectionRevision: resolved.connection?.revision ?? null,
      driverConfig: toolVersion.driverConfig as ToolVersionDriverConfig,
      grantId: grant.id,
      grantRevision: grant.revision,
      networkPolicies,
      tool,
      toolDefinitionRevision: definition.revision,
      toolVersionId: toolVersion.id,
      toolVersionRevision: toolVersion.revision,
    });
  }

  private async assertGrantReady(
    grant: Pick<
      WorkspaceToolGrantEntity,
      | "connectionId"
      | "enabled"
      | "expiresAt"
      | "toolDefinitionId"
      | "toolVersion"
      | "workspaceId"
    >,
    version: ToolDefinitionVersionEntity,
  ) {
    if (!grant.enabled) throw toolUnavailable("Tool Grant is disabled");
    if (grant.expiresAt && grant.expiresAt.getTime() <= Date.now()) {
      throw toolUnavailable("Tool Grant has expired");
    }
    const definition = await this.requireToolDefinition(grant.toolDefinitionId);
    if (definition.status !== "enabled") {
      throw toolUnavailable("Tool Definition is disabled");
    }
    if (version.status !== "published") {
      throw toolUnavailable("Tool Version is not published");
    }
    const policyIds = await this.policyIdsForVersion(version.id);
    const policies = await this.requireNetworkPolicies(policyIds);
    if (policies.some(({ status }) => status !== "enabled")) {
      throw toolUnavailable("A Tool Network Policy is disabled");
    }
    const connection = await this.assertGrantBinding(
      grant.workspaceId,
      version,
      grant.connectionId,
      policies,
    );
    if (connection) {
      if (connection.status !== "enabled") {
        throw toolUnavailable("Tool Connection is disabled");
      }
      assertConnectionState({
        authHeaderName: connection.authHeaderName,
        authType: connection.authType,
        policyStatus: policies.find(({ id }) => id === connection.networkPolicyId)
          ?.status ?? "disabled",
        secretId: connection.secretId,
        status: connection.status,
      });
      const policy = policies.find(({ id }) => id === connection.networkPolicyId);
      if (!policy) throw toolUnavailable("Tool Connection policy is unavailable");
      this.normalizeConnectionBaseUrl(connection.baseUrl, policy);
    }
    return { connection, definition, policies };
  }

  private async assertGrantBinding(
    workspaceId: string,
    version: ToolDefinitionVersionEntity,
    connectionId: string | null,
    knownPolicies?: ToolNetworkPolicyEntity[],
  ) {
    const policyIds = knownPolicies
      ? knownPolicies.map(({ id }) => id)
      : await this.policyIdsForVersion(version.id);
    if (version.driverType === "internal") {
      if (connectionId !== null || policyIds.length > 0) {
        throw new BadRequestException({
          code: "AI_TOOL_CONNECTION_INVALID",
          message: "Internal tools cannot use a Workspace Connection",
        });
      }
      return null;
    }
    if (!connectionId) {
      throw toolUnavailable("External tools require a Workspace Connection");
    }
    const connection = await this.requireWorkspaceConnection(
      workspaceId,
      connectionId,
    );
    if (connection.driverType !== version.driverType) {
      throw new BadRequestException({
        code: "AI_TOOL_CONNECTION_INVALID",
        message: "Tool Connection driver does not match the Tool Version",
      });
    }
    if (!policyIds.includes(connection.networkPolicyId)) {
      throw new BadRequestException({
        code: "AI_TOOL_CONNECTION_INVALID",
        message: "Tool Connection policy is not approved by the Tool Version",
      });
    }
    return connection;
  }

  private async isGrantConfigured(grant: WorkspaceToolGrantEntity) {
    const version = await this.toolVersionRepository.findOne({
      where: {
        toolDefinitionId: grant.toolDefinitionId,
        version: grant.toolVersion,
      },
    });
    if (!version) return false;
    const policyIds = await this.policyIdsForVersion(version.id);
    if (version.driverType === "internal") {
      return grant.connectionId === null && policyIds.length === 0;
    }
    if (!grant.connectionId) return false;
    const connection = await this.connectionRepository.findOne({
      where: { id: grant.connectionId, workspaceId: grant.workspaceId },
    });
    return Boolean(
      connection &&
        connection.driverType === version.driverType &&
        policyIds.includes(connection.networkPolicyId),
    );
  }

  private normalizeNetworkPolicy(input: {
    host: string;
    pathPrefix: string;
    port: number;
    scheme: "http" | "https";
  }) {
    try {
      const endpoint = normalizeApprovedEndpoint(
        `${input.scheme}://${input.host}:${input.port}${input.pathPrefix}`,
        { allowHttpInDevelopment: this.allowHttpInDevelopment },
      );
      return {
        host: endpoint.hostname,
        pathPrefix: endpoint.pathPrefix,
        port: endpoint.port,
        scheme: endpoint.scheme,
      };
    } catch (error) {
      throw mapToolSecurityError(error);
    }
  }

  private normalizeConnectionBaseUrl(
    baseUrl: string,
    policy: ToolNetworkPolicyEntity,
  ) {
    try {
      const approved = normalizeApprovedEndpoint(
        `${policy.scheme}://${policy.host}:${policy.port}${policy.pathPrefix}`,
        { allowHttpInDevelopment: this.allowHttpInDevelopment },
      );
      return assertTargetMatchesApprovedEndpoint(baseUrl, approved, {
        allowHttpInDevelopment: this.allowHttpInDevelopment,
      }).url;
    } catch (error) {
      throw mapToolSecurityError(error);
    }
  }

  private createSecretColumns(
    payload: ToolConnectionSecretWriteRequest,
  ): SecretColumns {
    return {
      secretEnvelope: this.encryptConnectionSecret(payload.value),
      secretId: randomUUID(),
      secretRevision: 1,
      secretUpdatedAt: new Date(),
    };
  }

  private encryptConnectionSecret(value: string) {
    try {
      return this.connectionSecrets.encrypt(value);
    } catch {
      throw new BadRequestException({
        code: "AI_TOOL_CONNECTION_SECRET_INVALID",
        message: "Tool Connection credential is invalid",
      });
    }
  }

  private connectionSecretMetadata(connection: WorkspaceToolConnectionEntity) {
    return this.connectionSecrets.metadata({
      id: connection.secretId,
      revision: connection.secretRevision,
      updatedAt: connection.secretUpdatedAt,
    });
  }

  private toWorkspaceConnection(connection: WorkspaceToolConnectionEntity) {
    return {
      apiVersion: AI_API_VERSION,
      authHeaderName: connection.authHeaderName,
      authType: connection.authType,
      baseUrl: connection.baseUrl,
      createdAt: connection.createdAt.toISOString(),
      driverType: connection.driverType,
      id: connection.id,
      name: connection.name,
      networkPolicyId: connection.networkPolicyId,
      revision: connection.revision,
      secret: this.connectionSecretMetadata(connection),
      status: connection.status,
      updatedAt: connection.updatedAt.toISOString(),
      workspaceId: connection.workspaceId,
    };
  }

  private async toWorkspaceGrant(grant: WorkspaceToolGrantEntity) {
    return {
      apiVersion: AI_API_VERSION,
      configured: await this.isGrantConfigured(grant),
      connectionId: grant.connectionId,
      createdAt: grant.createdAt.toISOString(),
      enabled: grant.enabled,
      expiresAt: grant.expiresAt?.toISOString() ?? null,
      id: grant.id,
      revision: grant.revision,
      toolDefinitionId: grant.toolDefinitionId,
      toolVersion: grant.toolVersion,
      updatedAt: grant.updatedAt.toISOString(),
      workspaceId: grant.workspaceId,
    };
  }

  private currentWorkspaceId() {
    const context = this.workspaceContext.current();
    if (!context.workspaceId.trim()) {
      throw new ConflictException("Workspace context is invalid");
    }
    return context.workspaceId;
  }

  private async requireToolDefinition(toolDefinitionId: string) {
    const definition = await this.toolDefinitionRepository.findOne({
      where: { id: toolDefinitionId },
    });
    if (!definition) throw new NotFoundException("Tool Definition not found");
    return definition;
  }

  private async requireToolVersion(toolDefinitionId: string, version: string) {
    const toolVersion = await this.toolVersionRepository.findOne({
      where: { toolDefinitionId, version },
    });
    if (!toolVersion) throw new NotFoundException("Tool Version not found");
    return toolVersion;
  }

  private async requireNetworkPolicy(networkPolicyId: string) {
    const policy = await this.networkPolicyRepository.findOne({
      where: { id: networkPolicyId },
    });
    if (!policy) throw new NotFoundException("Tool Network Policy not found");
    return policy;
  }

  private async requireNetworkPolicies(networkPolicyIds: readonly string[]) {
    if (networkPolicyIds.length === 0) return [];
    const policies = await this.networkPolicyRepository.findBy({
      id: In([...networkPolicyIds]),
    });
    if (policies.length !== networkPolicyIds.length) {
      throw new NotFoundException("Tool Network Policy not found");
    }
    const byId = new Map(policies.map((policy) => [policy.id, policy]));
    return networkPolicyIds.map((id) => byId.get(id)!);
  }

  private async requireWorkspaceConnection(
    workspaceId: string,
    connectionId: string,
  ) {
    const connection = await this.connectionRepository.findOne({
      where: { id: connectionId, workspaceId },
    });
    if (!connection) throw new NotFoundException("Tool Connection not found");
    return connection;
  }

  private async requireWorkspaceGrant(workspaceId: string, grantId: string) {
    const grant = await this.grantRepository.findOne({
      where: { id: grantId, workspaceId },
    });
    if (!grant) throw new NotFoundException("Tool Grant not found");
    return grant;
  }

  private async policyIdsForVersion(toolDefinitionVersionId: string) {
    const links = await this.versionPolicyRepository.find({
      order: { networkPolicyId: "ASC" },
      where: { toolDefinitionVersionId },
    });
    return links.map(({ networkPolicyId }) => networkPolicyId);
  }

  private async policyIdsByVersion(toolDefinitionVersionIds: string[]) {
    const result = new Map<string, string[]>();
    if (toolDefinitionVersionIds.length === 0) return result;
    const links = await this.versionPolicyRepository.findBy({
      toolDefinitionVersionId: In(toolDefinitionVersionIds),
    });
    for (const link of links) {
      const ids = result.get(link.toolDefinitionVersionId) ?? [];
      ids.push(link.networkPolicyId);
      result.set(link.toolDefinitionVersionId, ids);
    }
    for (const ids of result.values()) ids.sort();
    return result;
  }
}

function toPlatformToolDefinition(definition: ToolDefinitionEntity) {
  return {
    apiVersion: AI_API_VERSION,
    createdAt: definition.createdAt.toISOString(),
    description: definition.description,
    displayName: definition.displayName,
    id: definition.id,
    name: definition.name,
    revision: definition.revision,
    status: definition.status,
    updatedAt: definition.updatedAt.toISOString(),
  };
}

function toPlatformToolVersion(
  version: ToolDefinitionVersionEntity,
  networkPolicyIds: string[],
) {
  return {
    allowsArtifact: version.allowsArtifact,
    apiVersion: AI_API_VERSION,
    contentDigest: version.contentDigest,
    createdAt: version.createdAt.toISOString(),
    driverConfig: version.driverConfig as ToolVersionDriverConfig,
    driverType: version.driverType,
    idempotency: version.idempotency,
    inputSchema: version.inputSchema,
    maxResponseBytes: version.maxResponseBytes,
    networkPolicyIds,
    outputRedactionPaths: [...version.outputRedactionPaths],
    outputSchema: version.outputSchema,
    requiredPermissions: [...version.requiredPermissions],
    retry: version.retry,
    revision: version.revision,
    schemaVersion: version.schemaVersion,
    sideEffect: version.sideEffect,
    status: version.status,
    timeoutMs: version.timeoutMs,
    toolDefinitionId: version.toolDefinitionId,
    updatedAt: version.updatedAt.toISOString(),
    version: version.version,
  };
}

function toPlatformToolNetworkPolicy(policy: ToolNetworkPolicyEntity) {
  return {
    apiVersion: AI_API_VERSION,
    createdAt: policy.createdAt.toISOString(),
    host: policy.host,
    id: policy.id,
    name: policy.name,
    pathPrefix: policy.pathPrefix,
    port: policy.port,
    revision: policy.revision,
    scheme: policy.scheme,
    status: policy.status,
    updatedAt: policy.updatedAt.toISOString(),
  };
}

function digestToolVersion(payload: CreatePlatformToolVersionRequest) {
  const content = {
    allowsArtifact: payload.allowsArtifact,
    driverConfig: payload.driverConfig,
    driverType: payload.driverType,
    idempotency: payload.idempotency,
    inputSchema: payload.inputSchema,
    maxResponseBytes: payload.maxResponseBytes,
    networkPolicyIds: [...payload.networkPolicyIds].sort(),
    outputRedactionPaths: [...payload.outputRedactionPaths].sort(),
    outputSchema: payload.outputSchema,
    requiredPermissions: [...payload.requiredPermissions].sort(),
    retry: payload.retry,
    schemaVersion: payload.schemaVersion,
    sideEffect: payload.sideEffect,
    timeoutMs: payload.timeoutMs,
    version: payload.version,
  };
  return createHash("sha256").update(stableJson(content)).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function emptySecretColumns(): SecretColumns {
  return {
    secretEnvelope: null,
    secretId: null,
    secretRevision: 0,
    secretUpdatedAt: null,
  };
}

function assertConnectionState(input: {
  authHeaderName: string | null;
  authType: "bearer" | "header" | "none";
  policyStatus: string;
  secretId: string | null;
  status: string;
}) {
  if (input.authType === "header" && !input.authHeaderName) {
    throw new BadRequestException("Header authentication requires a header name");
  }
  if (input.authType !== "header" && input.authHeaderName) {
    throw new BadRequestException(
      "Authentication header is only valid for header authentication",
    );
  }
  if (input.authType === "none" && input.secretId) {
    throw new BadRequestException(
      "A connection without authentication cannot store a credential",
    );
  }
  if (input.status === "enabled") {
    if (input.policyStatus !== "enabled") {
      throw new BadRequestException(
        "Tool Network Policy must be enabled before the Connection",
      );
    }
    if (input.authType !== "none" && !input.secretId) {
      throw new BadRequestException(
        "Authenticated Tool Connections require a credential before enablement",
      );
    }
  }
}

function assertVersionStatusTransition(current: string, next: string) {
  if (
    (current === "published" && next === "draft") ||
    (current === "disabled" && next === "draft")
  ) {
    throw new BadRequestException(
      "A published Tool Version cannot return to draft status",
    );
  }
}

function assertFutureExpiry(value: Date | null) {
  if (value && value.getTime() <= Date.now()) {
    throw new BadRequestException("Tool Grant expiry must be in the future");
  }
}

function parseNullableDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException("Tool Grant expiry is invalid");
  }
  return date;
}

function mapToolSecurityError(error: unknown): Error {
  if (error instanceof ToolSecurityPolicyError) {
    return new BadRequestException({ code: error.code, message: error.message });
  }
  return error instanceof Error ? error : new Error("Tool security policy failed");
}

function toolUnavailable(message: string) {
  return new ConflictException({ code: "AI_TOOL_UNAVAILABLE", message });
}

async function saveOrConflict<T extends ObjectLiteral>(
  repository: Repository<T>,
  value: T,
  conflictMessage: string,
) {
  try {
    return await repository.save(value);
  } catch (error) {
    if (isConstraintError(error)) throw new ConflictException(conflictMessage);
    throw error;
  }
}

async function updateOrConflict<T extends ObjectLiteral>(
  repository: Repository<T>,
  criteria: Record<string, unknown>,
  patch: Record<string, unknown>,
  staleMessage: string,
  conflictMessage: string,
) {
  try {
    const result = await repository.update(criteria as never, patch as never);
    if (result.affected !== 1) throw new ConflictException(staleMessage);
  } catch (error) {
    if (error instanceof ConflictException) throw error;
    if (isConstraintError(error)) throw new ConflictException(conflictMessage);
    throw error;
  }
}

function isConstraintError(error: unknown) {
  const code = (error as { code?: unknown })?.code;
  return code === "23503" || code === "23505" || code === "23514";
}
