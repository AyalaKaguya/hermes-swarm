export function resolvePrincipalRoute(
  principalType: "platform" | "tenant",
  pathname: string,
) {
  if (principalType === "tenant" && pathname.startsWith("/platform")) {
    return "/home";
  }
  if (principalType !== "platform" || pathname.startsWith("/platform")) {
    return null;
  }
  if (pathname.startsWith("/settings/platform-email-templates")) {
    return "/platform/email-templates";
  }
  if (pathname.startsWith("/settings/platform")) {
    return "/platform/settings";
  }
  return "/platform";
}

export function resolveLoginRoute(pathname: string) {
  return pathname.startsWith("/platform") ? "/platform/login" : "/login";
}
