import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Tenant } from "@hermes-swarm/core";
import { IsNull, Repository } from "typeorm";
import { PLATFORM_DATA_SOURCE } from "../database/database.constants.js";
import type { TenantJobEnvelope } from "./tenant-job.types.js";

@Injectable()
export class TenantJobFanoutService {
  constructor(
    @InjectRepository(Tenant, PLATFORM_DATA_SOURCE)
    private readonly platformTenantRepository: Repository<Tenant>,
  ) {}

  /**
   * Platform orchestration stops at tenant discovery. Every dispatched unit is
   * an ordinary tenant job with its own tenant context and idempotency key.
   */
  async fanOut<Payload, Result>(input: {
    dispatch: (job: TenantJobEnvelope<Payload>) => Promise<Result>;
    name: string;
    payload: (tenantId: string) => Payload;
    runId: string;
  }) {
    const tenants = await this.platformTenantRepository.find({
      order: { id: "ASC" },
      select: { id: true },
      where: { deletedAt: IsNull(), status: "active" },
    });
    return Promise.all(
      tenants.map((tenant) =>
        input.dispatch({
          idempotencyKey: input.runId,
          name: input.name,
          payload: input.payload(tenant.id),
          tenantId: tenant.id,
        }),
      ),
    );
  }
}
