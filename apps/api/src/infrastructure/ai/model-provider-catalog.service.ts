import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import {
  AI_API_VERSION,
  type CreatePlatformModelDeploymentRequest,
  type CreatePlatformModelProviderRequest,
  type CreateWorkspaceModelDeploymentRequest,
  type CreateWorkspaceModelGrantRequest,
  type CreateWorkspaceModelProviderRequest,
  type ModelCapability,
  type ModelReference,
  type ProviderSecretWriteRequest,
  type SetWorkspaceDefaultModelRequest,
  type UpdatePlatformModelDeploymentRequest,
  type UpdatePlatformModelProviderRequest,
  type UpdateWorkspaceModelDeploymentRequest,
  type UpdateWorkspaceModelGrantRequest,
  type UpdateWorkspaceModelProviderRequest,
} from "@hermes-swarm/api-contracts/ai";
import {
  PlatformModelDeployment as PlatformModelDeploymentEntity,
  PlatformModelProvider as PlatformModelProviderEntity,
  WorkspaceModelDefault as WorkspaceModelDefaultEntity,
  WorkspaceModelDeployment as WorkspaceModelDeploymentEntity,
  WorkspaceModelGrant as WorkspaceModelGrantEntity,
  WorkspaceModelProvider as WorkspaceModelProviderEntity,
} from "@hermes-swarm/core";
import type { ObjectLiteral, Repository } from "typeorm";
import { WorkspaceContextService } from "../../common/database/workspace-context.service.js";
import {
  ModelProviderConfigurationError,
  ModelProviderDriverRegistryError,
} from "./model-provider-driver.js";
import { ModelProviderDriverRegistry } from "./model-provider-driver.registry.js";
import { ProviderSecretService } from "./provider-secret.service.js";

type ProviderEntity = PlatformModelProviderEntity | WorkspaceModelProviderEntity;
type DeploymentEntity =
  | PlatformModelDeploymentEntity
  | WorkspaceModelDeploymentEntity;

@Injectable()
export class ModelProviderCatalogService {
  constructor(
    @InjectRepository(PlatformModelProviderEntity)
    private readonly platformProviderRepository: Repository<PlatformModelProviderEntity>,
    @InjectRepository(WorkspaceModelProviderEntity)
    private readonly workspaceProviderRepository: Repository<WorkspaceModelProviderEntity>,
    @InjectRepository(PlatformModelDeploymentEntity)
    private readonly platformDeploymentRepository: Repository<PlatformModelDeploymentEntity>,
    @InjectRepository(WorkspaceModelDeploymentEntity)
    private readonly workspaceDeploymentRepository: Repository<WorkspaceModelDeploymentEntity>,
    @InjectRepository(WorkspaceModelGrantEntity)
    private readonly workspaceGrantRepository: Repository<WorkspaceModelGrantEntity>,
    @InjectRepository(WorkspaceModelDefaultEntity)
    private readonly workspaceDefaultRepository: Repository<WorkspaceModelDefaultEntity>,
    private readonly workspaceContext: WorkspaceContextService,
    private readonly driverRegistry: ModelProviderDriverRegistry,
    private readonly providerSecrets: ProviderSecretService,
  ) {}

  async listPlatformProviders() {
    const providers = await this.platformProviderRepository.find({
      order: { name: "ASC" },
    });
    return providers.map((provider) => this.toPlatformProvider(provider));
  }

  async getPlatformProvider(providerId: string) {
    return this.toPlatformProvider(await this.requirePlatformProvider(providerId));
  }

  async createPlatformProvider(payload: CreatePlatformModelProviderRequest) {
    const normalized = this.normalizeProvider(payload.driver, payload.baseUrl);
    const secret = payload.secret
      ? this.createSecretColumns(payload.secret)
      : emptySecretColumns();
    assertProviderCanUseStatus(payload.status, secret.secretId);
    const provider = this.platformProviderRepository.create({
      baseUrl: normalized.baseUrl,
      config: {},
      driver: payload.driver,
      name: payload.name.trim(),
      revision: 1,
      status: payload.status,
      ...secret,
    });
    return this.toPlatformProvider(
      await saveOrConflict(this.platformProviderRepository, provider),
    );
  }

  async updatePlatformProvider(
    providerId: string,
    payload: UpdatePlatformModelProviderRequest,
  ) {
    const provider = await this.requirePlatformProvider(providerId);
    const patch = this.providerPatch(provider, payload);
    await updateOrConflict(
      this.platformProviderRepository,
      { id: provider.id },
      { ...patch, revision: () => "revision + 1" },
      "Model provider changed before the update completed",
    );
    return this.getPlatformProvider(provider.id);
  }

  async deletePlatformProvider(providerId: string) {
    const provider = await this.requirePlatformProvider(providerId);
    assertDisabled(provider.status, "Model provider");
    await deleteOrConflict(
      this.platformProviderRepository,
      { id: provider.id },
      "Model provider is still referenced by a deployment",
    );
  }

  async rotatePlatformProviderSecret(
    providerId: string,
    payload: ProviderSecretWriteRequest,
  ) {
    const provider = await this.requirePlatformProvider(providerId);
    await this.replaceProviderSecret(
      this.platformProviderRepository,
      { id: provider.id },
      provider,
      payload,
    );
    const updated = await this.requirePlatformProvider(provider.id);
    return { secret: this.providerSecretMetadata(updated) };
  }

  async listWorkspaceProviders() {
    const workspaceId = this.currentWorkspaceId();
    const providers = await this.workspaceProviderRepository.find({
      order: { name: "ASC" },
      where: { workspaceId },
    });
    return providers.map((provider) => this.toWorkspaceProvider(provider));
  }

  async getWorkspaceProvider(providerId: string) {
    const workspaceId = this.currentWorkspaceId();
    return this.toWorkspaceProvider(
      await this.requireWorkspaceProvider(workspaceId, providerId),
    );
  }

  async createWorkspaceProvider(payload: CreateWorkspaceModelProviderRequest) {
    const workspaceId = this.currentWorkspaceId();
    const normalized = this.normalizeProvider(payload.driver, payload.baseUrl);
    const secret = payload.secret
      ? this.createSecretColumns(payload.secret)
      : emptySecretColumns();
    assertProviderCanUseStatus(payload.status, secret.secretId);
    const provider = this.workspaceProviderRepository.create({
      baseUrl: normalized.baseUrl,
      config: {},
      driver: payload.driver,
      name: payload.name.trim(),
      revision: 1,
      status: payload.status,
      workspaceId,
      ...secret,
    });
    return this.toWorkspaceProvider(
      await saveOrConflict(this.workspaceProviderRepository, provider),
    );
  }

  async updateWorkspaceProvider(
    providerId: string,
    payload: UpdateWorkspaceModelProviderRequest,
  ) {
    const workspaceId = this.currentWorkspaceId();
    const provider = await this.requireWorkspaceProvider(workspaceId, providerId);
    const patch = this.providerPatch(provider, payload);
    await updateOrConflict(
      this.workspaceProviderRepository,
      { id: provider.id, workspaceId },
      { ...patch, revision: () => "revision + 1" },
      "Model provider changed before the update completed",
    );
    return this.getWorkspaceProvider(provider.id);
  }

  async deleteWorkspaceProvider(providerId: string) {
    const workspaceId = this.currentWorkspaceId();
    const provider = await this.requireWorkspaceProvider(workspaceId, providerId);
    assertDisabled(provider.status, "Model provider");
    await deleteOrConflict(
      this.workspaceProviderRepository,
      { id: provider.id, workspaceId },
      "Model provider is still referenced by a deployment",
    );
  }

  async rotateWorkspaceProviderSecret(
    providerId: string,
    payload: ProviderSecretWriteRequest,
  ) {
    const workspaceId = this.currentWorkspaceId();
    const provider = await this.requireWorkspaceProvider(workspaceId, providerId);
    await this.replaceProviderSecret(
      this.workspaceProviderRepository,
      { id: provider.id, workspaceId },
      provider,
      payload,
    );
    const updated = await this.requireWorkspaceProvider(workspaceId, provider.id);
    return { secret: this.providerSecretMetadata(updated) };
  }

  async listPlatformDeployments(providerId: string) {
    await this.requirePlatformProvider(providerId);
    const deployments = await this.platformDeploymentRepository.find({
      order: { name: "ASC" },
      where: { providerId },
    });
    return deployments.map(toPlatformDeployment);
  }

  async getPlatformDeployment(providerId: string, deploymentId: string) {
    return toPlatformDeployment(
      await this.requirePlatformDeployment(deploymentId, providerId),
    );
  }

  async createPlatformDeployment(
    providerId: string,
    payload: CreatePlatformModelDeploymentRequest,
  ) {
    const provider = await this.requirePlatformProvider(providerId);
    this.assertDriverCapability(provider.driver, payload.capability);
    if (payload.status === "enabled") this.assertProviderReady(provider);
    const deployment = this.platformDeploymentRepository.create({
      capability: payload.capability,
      config: {},
      modelId: payload.modelId.trim(),
      name: payload.name.trim(),
      providerId: provider.id,
      revision: 1,
      status: payload.status,
    });
    return toPlatformDeployment(
      await saveOrConflict(this.platformDeploymentRepository, deployment),
    );
  }

  async updatePlatformDeployment(
    deploymentId: string,
    payload: UpdatePlatformModelDeploymentRequest,
  ) {
    const deployment = await this.requirePlatformDeployment(deploymentId);
    const providerId = deployment.providerId;
    if (payload.status === "enabled" || payload.capability !== undefined) {
      const provider = await this.requirePlatformProvider(providerId);
      if (payload.capability !== undefined) {
        this.assertDriverCapability(provider.driver, payload.capability);
      }
      if (payload.status === "enabled") this.assertProviderReady(provider);
    }
    const patch = deploymentPatch(payload);
    await updateOrConflict(
      this.platformDeploymentRepository,
      { id: deployment.id, providerId },
      { ...patch, revision: () => "revision + 1" },
      "Model deployment changed before the update completed",
    );
    return this.getPlatformDeployment(providerId, deployment.id);
  }

  async deletePlatformDeployment(providerId: string, deploymentId: string) {
    const deployment = await this.requirePlatformDeployment(
      deploymentId,
      providerId,
    );
    assertDisabled(deployment.status, "Model deployment");
    await deleteOrConflict(
      this.platformDeploymentRepository,
      { id: deployment.id, providerId },
      "Model deployment is still granted or selected as a default",
    );
  }

  async listWorkspaceDeployments(providerId: string) {
    const workspaceId = this.currentWorkspaceId();
    await this.requireWorkspaceProvider(workspaceId, providerId);
    const deployments = await this.workspaceDeploymentRepository.find({
      order: { name: "ASC" },
      where: { providerId, workspaceId },
    });
    return deployments.map(toWorkspaceDeployment);
  }

  async getWorkspaceDeployment(providerId: string, deploymentId: string) {
    const workspaceId = this.currentWorkspaceId();
    return toWorkspaceDeployment(
      await this.requireWorkspaceDeployment(
        workspaceId,
        deploymentId,
        providerId,
      ),
    );
  }

  async createWorkspaceDeployment(
    providerId: string,
    payload: CreateWorkspaceModelDeploymentRequest,
  ) {
    const workspaceId = this.currentWorkspaceId();
    const provider = await this.requireWorkspaceProvider(workspaceId, providerId);
    this.assertDriverCapability(provider.driver, payload.capability);
    if (payload.status === "enabled") this.assertProviderReady(provider);
    const deployment = this.workspaceDeploymentRepository.create({
      capability: payload.capability,
      config: {},
      modelId: payload.modelId.trim(),
      name: payload.name.trim(),
      providerId: provider.id,
      revision: 1,
      status: payload.status,
      workspaceId,
    });
    return toWorkspaceDeployment(
      await saveOrConflict(this.workspaceDeploymentRepository, deployment),
    );
  }

  async updateWorkspaceDeployment(
    deploymentId: string,
    payload: UpdateWorkspaceModelDeploymentRequest,
  ) {
    const workspaceId = this.currentWorkspaceId();
    const deployment = await this.requireWorkspaceDeployment(
      workspaceId,
      deploymentId,
    );
    const providerId = deployment.providerId;
    if (payload.status === "enabled" || payload.capability !== undefined) {
      const provider = await this.requireWorkspaceProvider(workspaceId, providerId);
      if (payload.capability !== undefined) {
        this.assertDriverCapability(provider.driver, payload.capability);
      }
      if (payload.status === "enabled") this.assertProviderReady(provider);
    }
    await updateOrConflict(
      this.workspaceDeploymentRepository,
      { id: deployment.id, providerId, workspaceId },
      { ...deploymentPatch(payload), revision: () => "revision + 1" },
      "Model deployment changed before the update completed",
    );
    return this.getWorkspaceDeployment(providerId, deployment.id);
  }

  async deleteWorkspaceDeployment(providerId: string, deploymentId: string) {
    const workspaceId = this.currentWorkspaceId();
    const deployment = await this.requireWorkspaceDeployment(
      workspaceId,
      deploymentId,
      providerId,
    );
    assertDisabled(deployment.status, "Model deployment");
    await deleteOrConflict(
      this.workspaceDeploymentRepository,
      { id: deployment.id, providerId, workspaceId },
      "Model deployment is still selected as a default",
    );
  }

  async listWorkspaceGrants(workspaceId: string) {
    const grants = await this.workspaceGrantRepository.find({
      order: { createdAt: "ASC" },
      where: { workspaceId },
    });
    return grants.map(toWorkspaceGrant);
  }

  async listCurrentWorkspaceGrants() {
    return this.listWorkspaceGrants(this.currentWorkspaceId());
  }

  async createWorkspaceGrant(
    workspaceId: string,
    payload: CreateWorkspaceModelGrantRequest,
  ) {
    const deployment = await this.requirePlatformDeployment(
      payload.platformDeploymentId,
    );
    const enabled = payload.enabled ?? true;
    const expiresAt = parseNullableDate(payload.expiresAt);
    if (enabled) {
      await this.assertPlatformDeploymentAvailable(
        deployment,
        expiresAt,
      );
    }
    const grant = this.workspaceGrantRepository.create({
      enabled,
      expiresAt,
      platformDeploymentId: deployment.id,
      revision: 1,
      workspaceId,
    });
    return toWorkspaceGrant(
      await saveOrConflict(this.workspaceGrantRepository, grant),
    );
  }

  async updateWorkspaceGrant(
    workspaceId: string,
    grantId: string,
    payload: UpdateWorkspaceModelGrantRequest,
  ) {
    const grant = await this.requireWorkspaceGrant(workspaceId, grantId);
    const enabled = payload.enabled ?? grant.enabled;
    const expiresAt = payload.expiresAt === undefined
      ? grant.expiresAt
      : parseNullableDate(payload.expiresAt);
    if (enabled) {
      const deployment = await this.requirePlatformDeployment(
        grant.platformDeploymentId,
      );
      await this.assertPlatformDeploymentAvailable(deployment, expiresAt);
    }
    await updateOrConflict(
      this.workspaceGrantRepository,
      { id: grant.id, workspaceId },
      { enabled, expiresAt, revision: () => "revision + 1" },
      "Model grant changed before the update completed",
    );
    return toWorkspaceGrant(await this.requireWorkspaceGrant(workspaceId, grant.id));
  }

  async deleteWorkspaceGrant(workspaceId: string, grantId: string) {
    await this.requireWorkspaceGrant(workspaceId, grantId);
    await deleteOrConflict(
      this.workspaceGrantRepository,
      { id: grantId, workspaceId },
      "Model grant could not be removed",
    );
  }

  async listWorkspaceDefaults() {
    const workspaceId = this.currentWorkspaceId();
    const defaults = await this.workspaceDefaultRepository.find({
      order: { capability: "ASC" },
      where: { workspaceId },
    });
    return defaults.map(toWorkspaceDefault);
  }

  async setWorkspaceDefault(payload: SetWorkspaceDefaultModelRequest) {
    const workspaceId = this.currentWorkspaceId();
    await this.assertDefaultDeploymentAvailable(workspaceId, payload);
    const existing = await this.workspaceDefaultRepository.findOne({
      where: { capability: payload.capability, workspaceId },
    });
    const value = this.workspaceDefaultRepository.create({
      ...(existing ?? {}),
      capability: payload.capability,
      platformDeploymentId: payload.platformDeploymentId ?? null,
      workspaceDeploymentId: payload.workspaceDeploymentId ?? null,
      workspaceId,
    });
    return toWorkspaceDefault(
      await saveOrConflict(this.workspaceDefaultRepository, value),
    );
  }

  async deleteWorkspaceDefault(capability: ModelCapability) {
    const workspaceId = this.currentWorkspaceId();
    const result = await this.workspaceDefaultRepository.delete({
      capability,
      workspaceId,
    });
    if (result.affected !== 1) throw new NotFoundException("Default model not found");
  }

  async resolveWorkspaceDefault(
    capability: ModelCapability,
  ): Promise<ModelReference> {
    const workspaceId = this.currentWorkspaceId();
    const selected = await this.workspaceDefaultRepository.findOne({
      where: { capability, workspaceId },
    });
    if (!selected) throw new NotFoundException("Default model is not configured");

    if (selected.workspaceDeploymentId) {
      const deployment = await this.requireWorkspaceDeployment(
        workspaceId,
        selected.workspaceDeploymentId,
      );
      if (deployment.capability !== capability) {
        throw unavailable("Default model capability no longer matches");
      }
      assertDeploymentReady(deployment);
      this.assertProviderReady(
        await this.requireWorkspaceProvider(workspaceId, deployment.providerId),
      );
      return {
        apiVersion: AI_API_VERSION,
        capability,
        deploymentId: deployment.id,
        modelId: deployment.modelId,
        providerScope: "workspace",
      };
    }

    if (!selected.platformDeploymentId) {
      throw unavailable("Default model reference is invalid");
    }
    const deployment = await this.requirePlatformDeployment(
      selected.platformDeploymentId,
    );
    if (deployment.capability !== capability) {
      throw unavailable("Default model capability no longer matches");
    }
    assertDeploymentReady(deployment);
    this.assertProviderReady(
      await this.requirePlatformProvider(deployment.providerId),
    );
    const grant = await this.workspaceGrantRepository.findOne({
      where: {
        platformDeploymentId: deployment.id,
        workspaceId,
      },
    });
    assertGrantActive(grant);
    return {
      apiVersion: AI_API_VERSION,
      capability,
      deploymentId: deployment.id,
      modelId: deployment.modelId,
      providerScope: "platform",
    };
  }

  /**
   * Validates a credential-free pinned Model reference against the current
   * trusted Workspace. Provider endpoints and secrets never cross this
   * catalog boundary.
   */
  async resolveWorkspaceModelReference(
    reference: ModelReference,
  ): Promise<ModelReference> {
    const workspaceId = this.currentWorkspaceId();
    if (reference.providerScope === "workspace") {
      const deployment = await this.requireWorkspaceDeployment(
        workspaceId,
        reference.deploymentId,
      );
      assertReferenceMatchesDeployment(reference, deployment);
      assertDeploymentReady(deployment);
      this.assertProviderReady(
        await this.requireWorkspaceProvider(workspaceId, deployment.providerId),
      );
      return toModelReference(deployment, "workspace");
    }

    const deployment = await this.requirePlatformDeployment(
      reference.deploymentId,
    );
    assertReferenceMatchesDeployment(reference, deployment);
    await this.assertPlatformDeploymentAvailableForWorkspace(
      workspaceId,
      deployment,
    );
    return toModelReference(deployment, "platform");
  }

  private async assertDefaultDeploymentAvailable(
    workspaceId: string,
    payload: SetWorkspaceDefaultModelRequest,
  ) {
    if (payload.workspaceDeploymentId) {
      const deployment = await this.requireWorkspaceDeployment(
        workspaceId,
        payload.workspaceDeploymentId,
      );
      if (deployment.capability !== payload.capability) {
        throw new BadRequestException("Default model capability does not match");
      }
      assertDeploymentReady(deployment);
      this.assertProviderReady(
        await this.requireWorkspaceProvider(workspaceId, deployment.providerId),
      );
      return;
    }
    const deployment = await this.requirePlatformDeployment(
      payload.platformDeploymentId!,
    );
    if (deployment.capability !== payload.capability) {
      throw new BadRequestException("Default model capability does not match");
    }
    await this.assertPlatformDeploymentAvailableForWorkspace(
      workspaceId,
      deployment,
    );
  }

  private async assertPlatformDeploymentAvailable(
    deployment: PlatformModelDeploymentEntity,
    expiresAt: Date | null,
  ) {
    assertDeploymentReady(deployment);
    this.assertProviderReady(
      await this.requirePlatformProvider(deployment.providerId),
    );
    assertFutureExpiry(expiresAt);
  }

  private async assertPlatformDeploymentAvailableForWorkspace(
    workspaceId: string,
    deployment: PlatformModelDeploymentEntity,
  ) {
    await this.assertPlatformDeploymentAvailable(deployment, null);
    const grant = await this.workspaceGrantRepository.findOne({
      where: { platformDeploymentId: deployment.id, workspaceId },
    });
    assertGrantActive(grant);
  }

  private providerPatch(
    provider: ProviderEntity,
    payload: UpdatePlatformModelProviderRequest | UpdateWorkspaceModelProviderRequest,
  ) {
    const patch: Record<string, unknown> = {};
    if (payload.baseUrl !== undefined) {
      patch.baseUrl = this.normalizeProvider(
        provider.driver,
        payload.baseUrl,
      ).baseUrl;
    }
    if (payload.name !== undefined) patch.name = payload.name.trim();
    if (payload.status !== undefined) {
      assertProviderCanUseStatus(payload.status, provider.secretId);
      if (payload.status === "enabled") {
        this.normalizeProvider(
          provider.driver,
          typeof patch.baseUrl === "string" ? patch.baseUrl : provider.baseUrl,
        );
      }
      patch.status = payload.status;
    }
    return patch;
  }

  private normalizeProvider(driver: string, baseUrl: string) {
    let normalized: unknown;
    try {
      normalized = this.driverRegistry
        .resolve(driver)
        .normalizeConfiguration({ baseUrl });
    } catch (error) {
      if (
        error instanceof ModelProviderConfigurationError ||
        error instanceof ModelProviderDriverRegistryError
      ) {
        throw new BadRequestException({
          code: error.code,
          message: error.message,
        });
      }
      throw error;
    }
    if (
      !normalized ||
      typeof normalized !== "object" ||
      !("baseUrl" in normalized) ||
      typeof normalized.baseUrl !== "string"
    ) {
      throw new BadRequestException("Model provider driver returned invalid configuration");
    }
    return { baseUrl: normalized.baseUrl };
  }

  private assertProviderReady(provider: ProviderEntity) {
    assertProviderCredentialReady(provider);
    // Endpoint policy is live configuration. Revalidate it on every enable or
    // resolution so a tightened host/HTTPS allowlist takes effect immediately.
    try {
      this.normalizeProvider(provider.driver, provider.baseUrl);
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw unavailable("Model provider endpoint no longer satisfies policy");
      }
      throw error;
    }
  }

  private assertDriverCapability(driver: string, capability: ModelCapability) {
    if (!this.driverRegistry.resolve(driver).descriptor.capabilities.includes(capability)) {
      throw new BadRequestException(
        "Model provider driver does not support this capability",
      );
    }
  }

  private createSecretColumns(payload: ProviderSecretWriteRequest) {
    return {
      secretEnvelope: this.encryptProviderSecret(payload.apiKey),
      secretId: randomUUID(),
      secretRevision: 1,
      secretUpdatedAt: new Date(),
    };
  }

  private async replaceProviderSecret<T extends ProviderEntity>(
    repository: Repository<T>,
    criteria: Record<string, string>,
    provider: T,
    payload: ProviderSecretWriteRequest,
  ) {
    const now = new Date();
    await updateOrConflict(
      repository,
      criteria,
      {
        revision: () => "revision + 1",
        secretEnvelope: this.encryptProviderSecret(payload.apiKey),
        secretId: provider.secretId ?? randomUUID(),
        secretRevision: () => "secret_revision + 1",
        secretUpdatedAt: now,
      },
      "Model provider changed before the secret was replaced",
    );
  }

  private encryptProviderSecret(value: string) {
    try {
      return this.providerSecrets.encrypt(value);
    } catch {
      throw new BadRequestException({
        code: "AI_PROVIDER_SECRET_INVALID",
        message: "Provider secret is invalid",
      });
    }
  }

  private providerSecretMetadata(provider: ProviderEntity) {
    return this.providerSecrets.metadata({
      id: provider.secretId,
      revision: provider.secretRevision,
      updatedAt: provider.secretUpdatedAt,
    });
  }

  private toPlatformProvider(provider: PlatformModelProviderEntity) {
    return {
      apiVersion: AI_API_VERSION,
      baseUrl: provider.baseUrl,
      createdAt: provider.createdAt.toISOString(),
      driver: provider.driver,
      id: provider.id,
      name: provider.name,
      revision: provider.revision,
      secret: this.providerSecretMetadata(provider),
      status: provider.status,
      updatedAt: provider.updatedAt.toISOString(),
    };
  }

  private toWorkspaceProvider(provider: WorkspaceModelProviderEntity) {
    return {
      ...this.toPlatformProvider(provider),
      workspaceId: provider.workspaceId,
    };
  }

  private currentWorkspaceId() {
    const context = this.workspaceContext.current();
    if (!context.workspaceId.trim()) {
      throw new ConflictException("Workspace context is invalid");
    }
    return context.workspaceId;
  }

  private async requirePlatformProvider(providerId: string) {
    const provider = await this.platformProviderRepository.findOne({
      where: { id: providerId },
    });
    if (!provider) throw new NotFoundException("Model provider not found");
    return provider;
  }

  private async requireWorkspaceProvider(workspaceId: string, providerId: string) {
    const provider = await this.workspaceProviderRepository.findOne({
      where: { id: providerId, workspaceId },
    });
    if (!provider) throw new NotFoundException("Model provider not found");
    return provider;
  }

  private async requirePlatformDeployment(
    deploymentId: string,
    providerId?: string,
  ) {
    const deployment = await this.platformDeploymentRepository.findOne({
      where: {
        id: deploymentId,
        ...(providerId ? { providerId } : {}),
      },
    });
    if (!deployment) throw new NotFoundException("Model deployment not found");
    return deployment;
  }

  private async requireWorkspaceDeployment(
    workspaceId: string,
    deploymentId: string,
    providerId?: string,
  ) {
    const deployment = await this.workspaceDeploymentRepository.findOne({
      where: {
        id: deploymentId,
        workspaceId,
        ...(providerId ? { providerId } : {}),
      },
    });
    if (!deployment) throw new NotFoundException("Model deployment not found");
    return deployment;
  }

  private async requireWorkspaceGrant(workspaceId: string, grantId: string) {
    const grant = await this.workspaceGrantRepository.findOne({
      where: { id: grantId, workspaceId },
    });
    if (!grant) throw new NotFoundException("Model grant not found");
    return grant;
  }
}

function emptySecretColumns() {
  return {
    secretEnvelope: null,
    secretId: null,
    secretRevision: 0,
    secretUpdatedAt: null,
  };
}

function assertProviderCanUseStatus(status: string, secretId: string | null) {
  if (status === "enabled" && !secretId) {
    throw new BadRequestException(
      "A model provider must have a credential before it can be enabled",
    );
  }
}

function assertProviderCredentialReady(provider: ProviderEntity) {
  if (
    provider.status !== "enabled" ||
    !provider.secretId ||
    provider.secretRevision < 1 ||
    !provider.secretUpdatedAt
  ) {
    throw unavailable("Model provider is not enabled with a credential");
  }
}

function assertDeploymentReady(deployment: DeploymentEntity) {
  if (deployment.status !== "enabled") {
    throw unavailable("Model deployment is disabled");
  }
}

function assertReferenceMatchesDeployment(
  reference: ModelReference,
  deployment: DeploymentEntity,
) {
  if (
    reference.capability !== deployment.capability ||
    reference.modelId !== deployment.modelId
  ) {
    throw unavailable("Pinned model reference no longer matches its deployment");
  }
}

function toModelReference(
  deployment: DeploymentEntity,
  providerScope: ModelReference["providerScope"],
): ModelReference {
  return {
    apiVersion: AI_API_VERSION,
    capability: deployment.capability,
    deploymentId: deployment.id,
    modelId: deployment.modelId,
    providerScope,
  };
}

function assertGrantActive(grant: WorkspaceModelGrantEntity | null) {
  if (!grant?.enabled) throw unavailable("Workspace model grant is unavailable");
  if (grant.expiresAt && grant.expiresAt.getTime() <= Date.now()) {
    throw unavailable("Workspace model grant has expired");
  }
}

function assertFutureExpiry(value: Date | null) {
  if (value && value.getTime() <= Date.now()) {
    throw new BadRequestException("An enabled model grant must expire in the future");
  }
}

function assertDisabled(status: string, resource: string) {
  if (status !== "disabled") {
    throw new ConflictException(`${resource} must be disabled before deletion`);
  }
}

function deploymentPatch(
  payload:
    | UpdatePlatformModelDeploymentRequest
    | UpdateWorkspaceModelDeploymentRequest,
) {
  return {
    ...(payload.capability === undefined
      ? {}
      : { capability: payload.capability }),
    ...(payload.modelId === undefined
      ? {}
      : { modelId: payload.modelId.trim() }),
    ...(payload.name === undefined ? {} : { name: payload.name.trim() }),
    ...(payload.status === undefined ? {} : { status: payload.status }),
  };
}

function parseNullableDate(value: string | null | undefined) {
  return value ? new Date(value) : null;
}

function toPlatformDeployment(deployment: PlatformModelDeploymentEntity) {
  return {
    apiVersion: AI_API_VERSION,
    capability: deployment.capability,
    createdAt: deployment.createdAt.toISOString(),
    id: deployment.id,
    modelId: deployment.modelId,
    name: deployment.name,
    providerId: deployment.providerId,
    revision: deployment.revision,
    status: deployment.status,
    updatedAt: deployment.updatedAt.toISOString(),
  };
}

function toWorkspaceDeployment(deployment: WorkspaceModelDeploymentEntity) {
  return {
    ...toPlatformDeployment(deployment),
    workspaceId: deployment.workspaceId,
  };
}

function toWorkspaceGrant(grant: WorkspaceModelGrantEntity) {
  return {
    apiVersion: AI_API_VERSION,
    createdAt: grant.createdAt.toISOString(),
    enabled: grant.enabled,
    expiresAt: grant.expiresAt?.toISOString() ?? null,
    id: grant.id,
    platformDeploymentId: grant.platformDeploymentId,
    revision: grant.revision,
    updatedAt: grant.updatedAt.toISOString(),
    workspaceId: grant.workspaceId,
  };
}

function toWorkspaceDefault(value: WorkspaceModelDefaultEntity) {
  return {
    apiVersion: AI_API_VERSION,
    capability: value.capability,
    createdAt: value.createdAt.toISOString(),
    id: value.id,
    platformDeploymentId: value.platformDeploymentId,
    updatedAt: value.updatedAt.toISOString(),
    workspaceDeploymentId: value.workspaceDeploymentId,
    workspaceId: value.workspaceId,
  };
}

async function saveOrConflict<T extends ObjectLiteral>(
  repository: Repository<T>,
  value: T,
) {
  try {
    return await repository.save(value);
  } catch (error) {
    if (isConstraintError(error)) {
      throw new ConflictException("Model catalog entry conflicts with existing data");
    }
    throw error;
  }
}

async function updateOrConflict<T extends ObjectLiteral>(
  repository: Repository<T>,
  criteria: Record<string, unknown>,
  patch: Record<string, unknown>,
  missingMessage: string,
) {
  try {
    const result = await repository.update(criteria as never, patch as never);
    if (result.affected !== 1) throw new ConflictException(missingMessage);
  } catch (error) {
    if (error instanceof ConflictException) throw error;
    if (isConstraintError(error)) {
      throw new ConflictException("Model catalog entry conflicts with existing data");
    }
    throw error;
  }
}

async function deleteOrConflict<T extends ObjectLiteral>(
  repository: Repository<T>,
  criteria: Record<string, unknown>,
  conflictMessage: string,
) {
  try {
    const result = await repository.delete(criteria as never);
    if (result.affected !== 1) throw new NotFoundException("Model catalog entry not found");
  } catch (error) {
    if (error instanceof NotFoundException) throw error;
    if (isConstraintError(error)) throw new ConflictException(conflictMessage);
    throw error;
  }
}

function isConstraintError(error: unknown) {
  const code = (error as { code?: unknown })?.code;
  return code === "23503" || code === "23505";
}

function unavailable(message: string) {
  return new ConflictException(message);
}
