import assert from "node:assert/strict";

import { diffChangedNodeIds, type LiveDoc } from "../liveDiff";

function doc(nodes: Array<{ id: string; [k: string]: unknown }>): LiveDoc {
  return { nodes };
}

export function runLiveDiffTests(): void {
  // no change
  const a = doc([{ id: "t1", text: "A" }, { id: "r1", fill: "#000" }]);
  assert.deepEqual(diffChangedNodeIds(a, a), []);

  // modificado
  const b = doc([{ id: "t1", text: "B" }, { id: "r1", fill: "#000" }]);
  assert.deepEqual(diffChangedNodeIds(a, b), ["t1"]);

  // adicionado
  const c = doc([{ id: "t1", text: "A" }, { id: "r1", fill: "#000" }, { id: "n2", text: "new" }]);
  assert.deepEqual(diffChangedNodeIds(a, c), ["n2"]);

  // removido
  const d = doc([{ id: "t1", text: "A" }]);
  assert.deepEqual(diffChangedNodeIds(a, d), ["r1"]);

  // robust to nulls
  assert.deepEqual(diffChangedNodeIds(null, null), []);
  assert.deepEqual(diffChangedNodeIds(null, a), ["t1", "r1"]);
  assert.deepEqual(diffChangedNodeIds(a, null), ["t1", "r1"]);

  // multiple changes preserve `next` order
  const e = doc([{ id: "r1", fill: "#fff" }, { id: "t1", text: "Z" }]);
  assert.deepEqual(diffChangedNodeIds(a, e), ["r1", "t1"]);

  console.log("✓ liveDiff tests passed");
}
