export type DepartmentTreeItem<T> = {
  depth: number;
  item: T;
};

export function flattenDepartmentTree<
  T extends { id: string; name: string; parentDepartmentId: string | null },
>(departments: readonly T[]): DepartmentTreeItem<T>[] {
  const byId = new Map(departments.map((item) => [item.id, item]));
  const children = new Map<string | null, T[]>();

  for (const item of departments) {
    const parentId =
      item.parentDepartmentId && byId.has(item.parentDepartmentId)
        ? item.parentDepartmentId
        : null;
    const siblings = children.get(parentId) ?? [];
    siblings.push(item);
    children.set(parentId, siblings);
  }
  for (const siblings of children.values()) {
    siblings.sort((left, right) =>
      left.name.localeCompare(right.name, "zh-Hans"),
    );
  }

  const result: DepartmentTreeItem<T>[] = [];
  const visited = new Set<string>();
  function visit(item: T, depth: number, path: Set<string>) {
    if (visited.has(item.id) || path.has(item.id)) return;
    visited.add(item.id);
    result.push({ depth, item });
    const nextPath = new Set(path).add(item.id);
    for (const child of children.get(item.id) ?? []) {
      visit(child, depth + 1, nextPath);
    }
  }

  for (const root of children.get(null) ?? []) visit(root, 0, new Set());
  // Corrupt legacy cycles remain visible as roots instead of disappearing.
  for (const item of departments) {
    if (!visited.has(item.id)) visit(item, 0, new Set());
  }
  return result;
}

export function availableDepartmentParents<
  T extends { id: string; parentDepartmentId: string | null },
>(departments: readonly T[], departmentId: string | null): T[] {
  if (!departmentId) return [...departments];
  const excluded = new Set([departmentId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of departments) {
      if (
        item.parentDepartmentId &&
        excluded.has(item.parentDepartmentId) &&
        !excluded.has(item.id)
      ) {
        excluded.add(item.id);
        changed = true;
      }
    }
  }
  return departments.filter((item) => !excluded.has(item.id));
}
