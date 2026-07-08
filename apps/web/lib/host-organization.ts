import { PLATFORM_SETTING_KEYS } from "@hermes-swarm/core/settings/definitions";
import type { fetchMe } from "@/lib/admin-api";

type Principal = Awaited<ReturnType<typeof fetchMe>>;

export function resolveHostOrganizationIdFromPrincipal(
  principal: Principal,
  hostname: string,
) {
  if (
    !getPrincipalBooleanSetting(
      principal,
      PLATFORM_SETTING_KEYS.subdomainRoutingEnabled,
      false,
    )
  ) {
    return null;
  }

  const rootDomain = getPrincipalSetting(
    principal,
    PLATFORM_SETTING_KEYS.rootDomain,
  );
  const subdomain = resolveSubdomainFromHost(hostname, rootDomain);
  if (!subdomain) return null;

  const normalizedSubdomain = normalizeSubdomain(subdomain);
  return (
    principal.memberships?.find((membership) => {
      const organization = membership.organization;
      return (
        normalizeSubdomain(organization?.subdomain) === normalizedSubdomain ||
        normalizeSubdomain(organization?.slug) === normalizedSubdomain
      );
    })?.organizationId ?? null
  );
}

export function resolveSubdomainFromHost(
  hostname: string,
  rootDomain: string | null | undefined,
) {
  const normalizedHost = hostname.trim().toLowerCase().replace(/\.$/, "");
  const normalizedRoot = rootDomain
    ?.trim()
    .toLowerCase()
    .replace(/^\.+|\.+$/g, "");
  if (!normalizedHost || !normalizedRoot) return null;
  if (normalizedHost === "localhost" || isIPv4Hostname(normalizedHost)) {
    return null;
  }
  if (normalizedHost === normalizedRoot) return null;
  if (!normalizedHost.endsWith(`.${normalizedRoot}`)) return null;
  const subdomain = normalizedHost.slice(
    0,
    -1 * (normalizedRoot.length + 1),
  );
  return subdomain.split(".").filter(Boolean).at(-1) ?? null;
}

export function normalizeSubdomain(value: string | null | undefined) {
  return (
    value
      ?.trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^-+|-+$/g, "") || null
  );
}

function getPrincipalBooleanSetting(
  principal: Principal,
  name: string,
  fallback: boolean,
) {
  const value = getPrincipalSetting(principal, name);
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function getPrincipalSetting(principal: Principal, name: string) {
  return principal.systemSettings?.find((setting) => setting.name === name)?.value;
}

function isIPv4Hostname(hostname: string) {
  const parts = hostname.split(".");
  return (
    parts.length === 4 &&
    parts.every((part) => {
      if (!/^\d+$/.test(part)) return false;
      const value = Number(part);
      return value >= 0 && value <= 255;
    })
  );
}
