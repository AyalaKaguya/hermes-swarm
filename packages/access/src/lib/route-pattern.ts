export function matchRoutePattern(pattern: string, pathname: string) {
  const patternParts = trimSlashes(pattern).split("/");
  const pathParts = trimSlashes(pathname).split("/");
  if (patternParts.length !== pathParts.length) return false;
  return patternParts.every(
    (part, index) => part.startsWith(":") || part === pathParts[index],
  );
}

function trimSlashes(value: string) {
  return value.replace(/^\/+|\/+$/g, "");
}
