import { BadRequestException, Injectable, UnauthorizedException } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import type {
  AccessRequest,
  AccessScopeMetadata,
  AccessScopeResult,
  ResolvedAccessDefinition,
} from "./access.types.js";

@Injectable()
export class AccessScopeService {
  constructor(private readonly moduleRef: ModuleRef) {}

  async resolve(
    definition: ResolvedAccessDefinition,
    metadata: AccessScopeMetadata | undefined,
    request: AccessRequest,
  ): Promise<AccessScopeResult> {
    if (metadata?.resolver) {
      const resolver = this.moduleRef.get(metadata.resolver, { strict: false });
      return resolver.resolve({ definition, request });
    }

    const scope = metadata?.scope ?? definition.scope;
    if (scope === "platform") return {};

    const principal = request.accessPrincipal;
    const tenantId = principal?.tenantId;
    if (!tenantId) throw new UnauthorizedException("登录会话缺少租户上下文");

    rejectTenantOverride(request, tenantId);

    const defaultParam = scope === "own" ? "userId" : `${scope}Id`;
    const param = metadata?.param ?? defaultParam;
    const value = normalizeValue(request.params?.[param]);

    if (scope === "own") {
      return {
        scopeLevel: "tenant",
        targetUserId: value ?? principal.userId,
        tenantId,
      };
    }
    if (scope === "tenant") return { scopeLevel: "tenant", tenantId };

    const organizationId = value;
    if (!organizationId) {
      throw new BadRequestException("请求缺少 Organization-Id");
    }
    if (scope === "organization") {
      return { organizationId, scopeLevel: "organization", tenantId };
    }
    throw new BadRequestException("不支持的请求作用域");
  }
}

function rejectTenantOverride(request: AccessRequest, tenantId: string) {
  const supplied = normalizeValue(getHeader(request, "tenant-id"));
  if (supplied) {
    throw new BadRequestException("Tenant-Id 不接受客户端传入");
  }
}

function getHeader(request: AccessRequest, name: string) {
  const headers = request.headers ?? {};
  return headers[name] ?? headers[name.toLowerCase()] ?? headers[toTitleCase(name)];
}

function toTitleCase(name: string) {
  return name
    .split("-")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join("-");
}

function normalizeValue(value: string | string[] | undefined) {
  const selected = Array.isArray(value) ? value[0] : value;
  const normalized = selected?.trim();
  return normalized || null;
}
