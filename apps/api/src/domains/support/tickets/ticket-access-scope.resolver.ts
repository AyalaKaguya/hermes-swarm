import { BadRequestException, Injectable } from "@nestjs/common";
import type { AccessScopeContext, AccessScopeResolver } from "@hermes-swarm/rbac";

@Injectable()
export class TicketAccessScopeResolver implements AccessScopeResolver {
  resolve({ request }: AccessScopeContext) {
    const query = request.query as Record<string, unknown> | undefined;
    const body = request.body as Record<string, unknown> | undefined;
    const organizationId = firstText(
      request.params?.organizationId,
      query?.sourceOrganizationId,
      query?.organizationId,
      body?.sourceOrganizationId,
      body?.organizationId,
    );
    if (!organizationId) throw new BadRequestException("请求缺少组织标识");
    return { organizationId, scopeLevel: "organization" as const };
  }
}

function firstText(...values: unknown[]) {
  return values.find((value): value is string => typeof value === "string" && Boolean(value.trim()))?.trim();
}
