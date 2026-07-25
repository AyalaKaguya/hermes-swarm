import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  PlatformModelDeployment,
  PlatformModelProvider,
  WorkspaceModelDefault,
  WorkspaceModelDeployment,
  WorkspaceModelGrant,
  WorkspaceModelProvider,
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

@Module({
  imports: [
    DatabaseModule,
    TypeOrmModule.forFeature([
      PlatformModelDeployment,
      PlatformModelProvider,
      WorkspaceModelDefault,
      WorkspaceModelDeployment,
      WorkspaceModelGrant,
      WorkspaceModelProvider,
    ]),
  ],
  controllers: [
    PlatformModelProviderCatalogController,
    WorkspaceModelProviderCatalogController,
  ],
  providers: [
    OpenAiCompatibleProviderDriver,
    ProviderSecretService,
    ModelProviderCatalogService,
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
  ],
})
export class AiModule {}
