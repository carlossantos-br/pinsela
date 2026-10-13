import assert from "node:assert/strict";
import { findFreeAdjacentPageRect, nextPageName, selectPagesInProjectOrder } from "../projectPages";

export function runProjectPagesTests() {
  // Export order = project (Pages panel) order, regardless of selection order.
  const pages = [{ id: "p1" }, { id: "p4" }, { id: "p3" }, { id: "p2" }];
  assert.deepEqual(selectPagesInProjectOrder(pages, ["p2", "p1", "p3"]).map((p) => p.id), ["p1", "p3", "p2"]);
  assert.deepEqual(selectPagesInProjectOrder(pages, new Set(["p4"])).map((p) => p.id), ["p4"]);
  assert.deepEqual(selectPagesInProjectOrder(pages, []).map((p) => p.id), []);
  assert.deepEqual(selectPagesInProjectOrder(pages, ["ghost"]).map((p) => p.id), []);

  // New pages are numbered after the highest existing "Page N", never reusing a number.
  assert.equal(nextPageName(["Page 1"]), "Page 2");
  assert.equal(nextPageName(["Page 1", "Page 2", "Page 3"]), "Page 4");
  assert.equal(nextPageName(["Page 1", "Page 4", "Page 3", "Page 2"]), "Page 5");
  assert.equal(nextPageName(["Cover", "Page 2"]), "Page 3");
  assert.equal(nextPageName([]), "Page 1");

  // Adjacent placement slides past occupied slots instead of stacking pages.
  const anchor = { x: 0, y: 0, width: 100, height: 100 };
  const size = { width: 100, height: 100 };
  const free = findFreeAdjacentPageRect(anchor, size, "right", [anchor], 20);
  assert.deepEqual(free, { x: 120, y: 0, width: 100, height: 100 });
  const taken = findFreeAdjacentPageRect(anchor, size, "right", [anchor, free], 20);
  assert.deepEqual(taken, { x: 240, y: 0, width: 100, height: 100 });
  const below = findFreeAdjacentPageRect(anchor, size, "below", [anchor, free], 20);
  assert.deepEqual(below, { x: 0, y: 120, width: 100, height: 100 });
  console.log("projectPages: ok");
}
