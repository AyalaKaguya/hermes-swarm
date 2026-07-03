import { Injectable } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import type {
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
    request: { params?: Record<string, string | undefined>; [key: string]: unknown },
  ): Promise<AccessScopeResult> {
    if (metadata?.resolver) {
      const resolver = this.moduleRef.get(metadata.resolver, { strict: false });
      return resolver.resolve({ definition, request });
    }

    const scope = metadata?.scope ?? definition.scope;
    if (scope === "platform") return {};

    const defaultParam = scope === "own" ? "userId" : "organizationId";
    const param = metadata?.param ?? defaultParam;
    const value = request.params?.[param] ?? null;

    return scope === "own"
      ? { targetUserId: value }
      : { organizationId: value };
  }
}

