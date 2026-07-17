import { BadRequestException, Injectable } from "@nestjs/common";
import {
  FEATURE_SETTING_DEFINITIONS,
  getFeatureSettingDefaultValue,
} from "@hermes-swarm/core/settings/definitions";
import { SettingsService } from "../settings/settings.service.js";
import { TenantContextService } from "../../common/database/tenant-context.service.js";

@Injectable()
export class FeatureAccessService {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async isFeatureEnabled(
    featureKey: string,
    scope: { tenantId?: string } = {},
  ) {
    const definition = requireFeatureDefinition(featureKey);
    const tenantId =
      scope.tenantId?.trim() ?? this.tenantContext.current(false)?.tenantId;
    const fallback = getFeatureSettingDefaultValue(definition);
    let value: string | null;

    if (definition.scope === "platform") {
      value = await this.settingsService.getPlatformValue(definition.key, fallback);
    } else {
      if (!tenantId) throw new BadRequestException("功能访问缺少租户上下文");
      value = await this.settingsService.getTenantValue(
        tenantId,
        definition.key,
        fallback,
      );
    }
    return value === "true";
  }
}

function requireFeatureDefinition(value: string | undefined) {
  const featureKey = value?.trim();
  if (!featureKey) throw new BadRequestException("功能标识不能为空");
  const definition = FEATURE_SETTING_DEFINITIONS.find(
    (item) => item.key === featureKey,
  );
  if (!definition) {
    throw new BadRequestException("功能标识不存在");
  }
  return definition;
}
