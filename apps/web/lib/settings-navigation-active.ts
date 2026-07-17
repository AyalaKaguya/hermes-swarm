export type SettingsNavigationCandidate = {
  href: string;
  key: string;
};

type SearchParamsReader = {
  get(name: string): string | null;
};

export function resolveActiveSettingsNavigationKey(
  items: readonly SettingsNavigationCandidate[],
  pathname: string,
  searchParams: SearchParamsReader,
) {
  const queryMatch = items.find((item) =>
    matchesSettingsHref(item.href, pathname, searchParams, true),
  );
  if (queryMatch) return queryMatch.key;

  return items
    .filter((item) =>
      matchesSettingsHref(item.href, pathname, searchParams, false),
    )
    .sort(
      (left, right) =>
        settingsHrefPath(right.href).length - settingsHrefPath(left.href).length,
    )[0]?.key;
}

function matchesSettingsHref(
  href: string,
  pathname: string,
  searchParams: SearchParamsReader,
  queryOnly: boolean,
) {
  const [hrefWithoutHash] = href.split("#");
  const [hrefPath, hrefQuery] = hrefWithoutHash.split("?");

  if (hrefQuery) {
    if (!queryOnly || pathname !== hrefPath) return false;
    const expectedParams = new URLSearchParams(hrefQuery);
    for (const [key, value] of expectedParams) {
      if (searchParams.get(key) !== value) return false;
    }
    return true;
  }

  if (queryOnly) return false;
  return pathname === hrefPath || pathname.startsWith(`${hrefPath}/`);
}

function settingsHrefPath(href: string) {
  return href.split("#")[0].split("?")[0];
}
