import { SetMetadata } from "@nestjs/common";

export const REQUIRE_FEATURE_METADATA = "hermes:require-feature";

export function RequireFeature(featureKey: string) {
  return SetMetadata(REQUIRE_FEATURE_METADATA, featureKey);
}
