import { BadRequestException, Injectable } from "@nestjs/common";
import { FEATURE_SETTING_DEFINITIONS } from "@hermes-swarm/core/settings/definitions";
import { SettingsService } from "../settings/settings.service.js";

@Injectable()
export class FeatureAccessService {
  constructor(private readonly settingsService: SettingsService) {}

  async isFeatureEnabled(organizationId: string, featureKey: string) {
    const normalizedFeatureKey = requireOrganizationFeatureKey(featureKey);
    const value = await this.settingsService.getOrganizationValue(
      organizationId,
      normalizedFeatureKey,
      "false",
    );
    return value === "true";
  }
}

const ORGANIZATION_FEATURE_KEYS: Set<string> = new Set(
  FEATURE_SETTING_DEFINITIONS.filter(
    (definition) => definition.scope === "organization",
  ).map((definition) => definition.key),
);

function requireOrganizationFeatureKey(value: string | undefined) {
  const featureKey = value?.trim();
  if (!featureKey) throw new BadRequestException("功能标识不能为空");
  if (!ORGANIZATION_FEATURE_KEYS.has(featureKey)) {
    throw new BadRequestException("功能标识不属于组织功能");
  }
  return featureKey;
}
