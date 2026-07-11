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
    const value = resolveScopedValue(request, param, headerForScope(scope));

    if (scope === "own") {
      return {
        scopeLevel: "tenant",
        targetUserId: value ?? principal.userId,
        tenantId,
      };
    }
    if (scope === "tenant") return { scopeLevel: "tenant", tenantId };

    const organizationId =
      scope === "organization"
        ? value
        : resolveScopedValue(
            request,
            "organizationId",
            "organization-id",
          );
    if (!organizationId) {
      throw new BadRequestException("请求缺少 Organization-Id");
    }
    if (scope === "organization") {
      rejectUnexpectedHeader(request, "department-id", "组织作用域不能携带 Department-Id");
      return { organizationId, scopeLevel: "organization", tenantId };
    }

    if (!value) throw new BadRequestException("请求缺少 Department-Id");
    return {
      departmentId: value,
      organizationId,
      scopeLevel: "department",
      tenantId,
    };
  }
}

function headerForScope(scope: string) {
  if (scope === "organization") return "organization-id";
  if (scope === "department") return "department-id";
  return null;
}

function resolveScopedValue(
  request: AccessRequest,
  param: string,
  headerName: string | null,
) {
  const pathValue = normalizeValue(request.params?.[param]);
  const headerValue = headerName
    ? normalizeValue(getHeader(request, headerName))
    : null;
  if (pathValue && headerValue && pathValue !== headerValue) {
    throw new BadRequestException(`${param} 与请求头作用域不一致`);
  }
  return pathValue ?? headerValue;
}

function rejectTenantOverride(request: AccessRequest, tenantId: string) {
  const supplied = normalizeValue(getHeader(request, "tenant-id"));
  if (supplied && supplied !== tenantId) {
    throw new BadRequestException("Tenant-Id 不能覆盖登录会话租户");
  }
}

function rejectUnexpectedHeader(
  request: AccessRequest,
  name: string,
  message: string,
) {
  if (normalizeValue(getHeader(request, name))) {
    throw new BadRequestException(message);
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
