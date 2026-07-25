import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { RuntimeRunHandlerRegistry } from "@hermes-swarm/agent-sdk";
import { CORE_DATABASE_ENTITIES } from "@hermes-swarm/core/database-entities";
import {
  getWorkerEnvFilePaths,
  validateWorkerRuntimeEnvironment,
  workerRuntimeConfig,
  type WorkerRuntimeConfig,
} from "./config/worker-runtime.config.js";
import { WorkerDependenciesHealthProbeService } from "./health/worker-dependencies-health-probe.service.js";
import { WorkerHealthServerService } from "./health/worker-health-server.service.js";
import {
  WORKER_HEALTH_PROBE,
  WorkerHealthService,
} from "./health/worker-health.service.js";
import { WorkerLifecycleService } from "./lifecycle/worker-lifecycle.service.js";
import { WORKER_CONSUMER } from "./lifecycle/worker-lifecycle.types.js";
import { OutboxDispatcherService } from "./outbox/outbox-dispatcher.service.js";
import {
  OUTBOX_STORE,
  RUNTIME_QUEUE,
} from "./outbox/outbox.types.js";
import { TypeOrmOutboxStore } from "./outbox/typeorm-outbox.store.js";
import { BullMqRuntimeQueueService } from "./queue/bullmq-runtime-queue.service.js";
import { RUNTIME_JOB_PROCESSOR } from "./queue/runtime-job-processor.js";
import { RuntimeRunConsumerService } from "./queue/runtime-run-consumer.service.js";
import { RUNTIME_RUN_STORE } from "./runtime/runtime-run.types.js";
import { TrustedRunContextService } from "./runtime/trusted-run-context.service.js";
import { TypeOrmRuntimeCheckpointStore } from "./runtime/typeorm-runtime-checkpoint.store.js";
import { TypeOrmRuntimeRunStore } from "./runtime/typeorm-runtime-run.store.js";
import { WorkerIdentityService } from "./runtime/worker-identity.service.js";

@Module({
  imports: [
    ConfigModule.forRoot({
      envFilePath: getWorkerEnvFilePaths(),
      isGlobal: true,
      load: [workerRuntimeConfig],
      validate: validateWorkerRuntimeEnvironment,
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const config = configService.getOrThrow<WorkerRuntimeConfig>("worker");
        return {
          type: "postgres" as const,
          url: config.postgresUrl,
          entities: [...CORE_DATABASE_ENTITIES],
          logging: false,
          migrationsRun: false,
          synchronize: false,
        };
      },
    }),
  ],
  providers: [
    WorkerIdentityService,
    TypeOrmOutboxStore,
    TypeOrmRuntimeCheckpointStore,
    TypeOrmRuntimeRunStore,
    TrustedRunContextService,
    RuntimeRunConsumerService,
    BullMqRuntimeQueueService,
    OutboxDispatcherService,
    WorkerDependenciesHealthProbeService,
    WorkerHealthService,
    WorkerHealthServerService,
    WorkerLifecycleService,
    {
      provide: RuntimeRunHandlerRegistry,
      useFactory: () => new RuntimeRunHandlerRegistry(Object.freeze([])),
    },
    { provide: OUTBOX_STORE, useExisting: TypeOrmOutboxStore },
    { provide: RUNTIME_RUN_STORE, useExisting: TypeOrmRuntimeRunStore },
    { provide: RUNTIME_JOB_PROCESSOR, useExisting: RuntimeRunConsumerService },
    { provide: RUNTIME_QUEUE, useExisting: BullMqRuntimeQueueService },
    { provide: WORKER_CONSUMER, useExisting: BullMqRuntimeQueueService },
    {
      provide: WORKER_HEALTH_PROBE,
      useExisting: WorkerDependenciesHealthProbeService,
    },
  ],
  exports: [
    RuntimeRunHandlerRegistry,
    TrustedRunContextService,
    TypeOrmRuntimeCheckpointStore,
  ],
})
export class WorkerModule {}
