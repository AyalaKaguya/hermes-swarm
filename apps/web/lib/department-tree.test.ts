import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  availableDepartmentParents,
  flattenDepartmentTree,
} from "./department-tree";

const departments = [
  { id: "child", name: "Child", parentDepartmentId: "root" },
  { id: "grandchild", name: "Grandchild", parentDepartmentId: "child" },
  { id: "root", name: "Root", parentDepartmentId: null },
  { id: "orphan", name: "Orphan", parentDepartmentId: "missing" },
];

describe("department tree", () => {
  it("flattens hierarchy depth-first and keeps orphaned rows visible", () => {
    assert.deepEqual(
      flattenDepartmentTree(departments).map(({ depth, item }) => [item.id, depth]),
      [
        ["orphan", 0],
        ["root", 0],
        ["child", 1],
        ["grandchild", 2],
      ],
    );
  });

  it("excludes the edited department and all descendants as parents", () => {
    assert.deepEqual(
      availableDepartmentParents(departments, "child").map((item) => item.id),
      ["root", "orphan"],
    );
  });

  it("does not drop cyclic legacy rows", () => {
    const cycle = [
      { id: "a", name: "A", parentDepartmentId: "b" },
      { id: "b", name: "B", parentDepartmentId: "a" },
    ];
    assert.deepEqual(
      flattenDepartmentTree(cycle).map(({ item }) => item.id),
      ["a", "b"],
    );
  });
});
