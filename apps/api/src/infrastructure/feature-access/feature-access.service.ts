import { BadRequestException, Injectable } from "@nestjs/common";
import {
  FEATURE_SETTING_DEFINITIONS,
  getFeatureSettingDefaultValue,
} from "@hermes-swarm/core/settings/definitions";
import { SettingsService } from "../settings/settings.service.js";

@Injectable()
export class FeatureAccessService {
  constructor(private readonly settingsService: SettingsService) {}

  async isFeatureEnabled(organizationId: string, featureKey: string) {
    const definition = requireOrganizationFeatureDefinition(featureKey);
    const value = await this.settingsService.getOrganizationValue(
      organizationId,
      definition.key,
      getFeatureSettingDefaultValue(definition),
    );
    return value === "true";
  }
}

const ORGANIZATION_FEATURE_KEYS: Set<string> = new Set(
  FEATURE_SETTING_DEFINITIONS.filter(
    (definition) => definition.scope === "organization",
  ).map((definition) => definition.key),
);

function requireOrganizationFeatureDefinition(value: string | undefined) {
  const featureKey = value?.trim();
  if (!featureKey) throw new BadRequestException("功能标识不能为空");
  const definition = FEATURE_SETTING_DEFINITIONS.find(
    (item) => item.key === featureKey && item.scope === "organization",
  );
  if (!definition || !ORGANIZATION_FEATURE_KEYS.has(featureKey)) {
    throw new BadRequestException("功能标识不属于组织功能");
  }
  return definition;
}
