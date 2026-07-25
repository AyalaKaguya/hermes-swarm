import { Injectable } from "@nestjs/common";
import type { AnalyticsSourceRegistration } from "./analytics-source.adapter.js";

const SOURCE_KEY_PATTERN = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9_]*)+$/;
const REVISION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const PERMISSION_PATTERN = /^[a-z][a-z0-9._-]*:[a-z][a-z0-9._-]*$/;

@Injectable()
export class AnalyticsSourceRegistry {
  private readonly sources = new Map<string, AnalyticsSourceRegistration>();

  register(registration: AnalyticsSourceRegistration): () => void {
    const sourceKey = registration.sourceKey.trim();
    if (!SOURCE_KEY_PATTERN.test(sourceKey)) {
      throw new TypeError(`Invalid analytics source key: ${sourceKey || "<empty>"}`);
    }
    if (!REVISION_PATTERN.test(registration.policyRevision)) {
      throw new TypeError(`Invalid policy revision for analytics source: ${sourceKey}`);
    }
    if (registration.requiredPermissions.length === 0) {
      throw new TypeError(`Analytics source must declare a permission: ${sourceKey}`);
    }
    const requiredPermissions = [...new Set(registration.requiredPermissions)].sort();
    if (requiredPermissions.some((permission) => !PERMISSION_PATTERN.test(permission))) {
      throw new TypeError(`Invalid permission for analytics source: ${sourceKey}`);
    }
    if (this.sources.has(sourceKey)) {
      throw new TypeError(`Analytics source is already registered: ${sourceKey}`);
    }

    const stored = Object.freeze({
      ...registration,
      requiredPermissions: Object.freeze(requiredPermissions),
      sourceKey,
    });
    this.sources.set(sourceKey, stored);

    return () => {
      if (this.sources.get(sourceKey) === stored) this.sources.delete(sourceKey);
    };
  }

  resolve(sourceKey: string): AnalyticsSourceRegistration | null {
    return this.sources.get(sourceKey) ?? null;
  }
}
