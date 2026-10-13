// Live diff (spec 2026-06-22 §5/§6, Task 6): given the previous and new doc,
// returns the ids of the nodes that changed (added, removed or modified)
// so the editor can "flash" what the agent just touched.

export interface LiveNode {
  id?: string;
  [key: string]: unknown;
}

export interface LiveDoc {
  nodes?: LiveNode[];
  [key: string]: unknown;
}

function nodeMap(doc: LiveDoc | null | undefined): Map<string, LiveNode> {
  const map = new Map<string, LiveNode>();
  for (const n of doc?.nodes ?? []) {
    if (n && typeof n.id === "string") map.set(n.id, n);
  }
  return map;
}

/**
 * Ids of the nodes changed between `prev` and `next`. Compared by value
 * (JSON stable enough for the in-place edit case). Robust to null
 * docs. Order: modified/added in `next` order, then removed.
 */
export function diffChangedNodeIds(prev: LiveDoc | null | undefined, next: LiveDoc | null | undefined): string[] {
  const before = nodeMap(prev);
  const changed: string[] = [];
  const seen = new Set<string>();

  for (const node of next?.nodes ?? []) {
    if (!node || typeof node.id !== "string") continue;
    const id = node.id;
    seen.add(id);
    const prevNode = before.get(id);
    if (prevNode === undefined) {
      changed.push(id); // adicionado
      continue;
    }
    if (JSON.stringify(prevNode) !== JSON.stringify(node)) {
      changed.push(id); // modificado
    }
  }
  for (const id of before.keys()) {
    if (!seen.has(id)) changed.push(id); // removido
  }
  return changed;
}
