import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  PlatformModelDeployment,
  PlatformModelProvider,
  ToolDefinition,
  ToolDefinitionNetworkPolicy,
  ToolDefinitionVersion,
  ToolNetworkPolicy,
  WorkspaceModelDefault,
  WorkspaceModelDeployment,
  WorkspaceModelGrant,
  WorkspaceModelProvider,
  WorkspaceToolConnection,
  WorkspaceToolGrant,
} from "@hermes-swarm/core";
import { DatabaseModule } from "../../common/database/database.module.js";
import {
  PlatformModelProviderCatalogController,
  WorkspaceModelProviderCatalogController,
} from "./model-provider-catalog.controller.js";
import { ModelProviderCatalogService } from "./model-provider-catalog.service.js";
import { ModelProviderDriverRegistry } from "./model-provider-driver.registry.js";
import { OpenAiCompatibleProviderDriver } from "./openai-compatible-provider.driver.js";
import { ProviderSecretService } from "./provider-secret.service.js";
import {
  PlatformToolCatalogController,
  WorkspaceToolCatalogController,
} from "./tool-catalog.controller.js";
import { ToolCatalogService } from "./tool-catalog.service.js";
import { ToolConnectionSecretService } from "./tool-connection-secret.service.js";

@Module({
  imports: [
    DatabaseModule,
    TypeOrmModule.forFeature([
      PlatformModelDeployment,
      PlatformModelProvider,
      ToolDefinition,
      ToolDefinitionNetworkPolicy,
      ToolDefinitionVersion,
      ToolNetworkPolicy,
      WorkspaceModelDefault,
      WorkspaceModelDeployment,
      WorkspaceModelGrant,
      WorkspaceModelProvider,
      WorkspaceToolConnection,
      WorkspaceToolGrant,
    ]),
  ],
  controllers: [
    PlatformModelProviderCatalogController,
    WorkspaceModelProviderCatalogController,
    PlatformToolCatalogController,
    WorkspaceToolCatalogController,
  ],
  providers: [
    OpenAiCompatibleProviderDriver,
    ProviderSecretService,
    ModelProviderCatalogService,
    ToolConnectionSecretService,
    ToolCatalogService,
    {
      provide: ModelProviderDriverRegistry,
      inject: [OpenAiCompatibleProviderDriver],
      useFactory: (openAiCompatible: OpenAiCompatibleProviderDriver) =>
        new ModelProviderDriverRegistry([openAiCompatible]),
    },
  ],
  exports: [
    ModelProviderCatalogService,
    ModelProviderDriverRegistry,
    ProviderSecretService,
    ToolCatalogService,
    ToolConnectionSecretService,
  ],
})
export class AiModule {}
