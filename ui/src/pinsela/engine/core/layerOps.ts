import { selectionBounds } from "../../core/layout";
import { addNode, defaultNode, nodeMap, patchNodeStyle, removeNodes, reorderNode, sortedNodes, uid } from "../../core/scene";
import type { PinselaTemplateDocV1 } from "../../core/types";

export type LayerOrderDirection = "up" | "down" | "front" | "back";

export function groupSelectionIntoNewGroup(doc: PinselaTemplateDocV1, ids: string[]): { doc: PinselaTemplateDocV1; groupId: string } | null {
  if (ids.length < 2) return null;
  const bounds = selectionBounds(doc, ids);
  if (!bounds) return null;
  const gid = uid("group");
  const group = defaultNode("group", {
    id: gid,
    name: "GRUPO",
    geometry: {
      x: bounds.x,
      y: bounds.y,
      width: bounds.w,
      height: bounds.h,
      rotation: 0,
      corner_radius: 0,
      clip: false,
      z_index: 0,
    },
    style: {
      ...defaultNode("group").style,
      fill: null,
      stroke: null,
    },
    children_ids: [...ids],
  });
  let next = addNode(doc, group);
  const sel = new Set(ids);
  next = { ...next, nodes: next.nodes.map((n) => (sel.has(n.id) ? { ...n, parent_id: gid } : n)) };
  return { doc: next, groupId: gid };
}

export function ungroupSelectedGroups(doc: PinselaTemplateDocV1, ids: string[]): { doc: PinselaTemplateDocV1; childIds: string[] } | null {
  const groups = doc.nodes.filter((n) => ids.includes(n.id) && n.kind === "group");
  if (!groups.length) return null;
  const groupIds = new Set(groups.map((g) => g.id));
  const childIds = Array.from(new Set(groups.flatMap((g) => g.children_ids || [])));
  let next = removeNodes(doc, Array.from(groupIds));
  const childrenSet = new Set(childIds);
  next = { ...next, nodes: next.nodes.map((n) => (childrenSet.has(n.id) ? { ...n, parent_id: null } : n)) };
  return { doc: next, childIds };
}

export function setSelectionVisible(doc: PinselaTemplateDocV1, ids: string[], visible: boolean): PinselaTemplateDocV1 {
  if (!ids.length) return doc;
  let next = doc;
  for (const id of ids) next = patchNodeStyle(next, id, { visible });
  return next;
}

export function setSelectionLocked(doc: PinselaTemplateDocV1, ids: string[], locked: boolean): PinselaTemplateDocV1 {
  if (!ids.length) return doc;
  let next = doc;
  for (const id of ids) next = patchNodeStyle(next, id, { locked });
  return next;
}

export function areSelectionAllLocked(doc: PinselaTemplateDocV1, ids: string[]): boolean {
  if (!ids.length) return false;
  const selected = new Set(ids);
  return doc.nodes.filter((n) => selected.has(n.id)).every((n) => !!n.style.locked);
}

export function areSelectionAllHidden(doc: PinselaTemplateDocV1, ids: string[]): boolean {
  if (!ids.length) return false;
  const selected = new Set(ids);
  return doc.nodes.filter((n) => selected.has(n.id)).every((n) => n.style.visible === false);
}

export function reorderSelection(doc: PinselaTemplateDocV1, ids: string[], direction: LayerOrderDirection): PinselaTemplateDocV1 {
  if (!ids.length) return doc;
  let next = doc;
  for (const id of ids) next = reorderNode(next, id, direction);
  return next;
}

export function dropNodeToTarget(doc: PinselaTemplateDocV1, sourceId: string, targetId: string): PinselaTemplateDocV1 {
  if (sourceId === targetId) return doc;
  // Work on z-ordered nodes and move the source into the target's slot directly.
  // We must NOT loop against a pre-captured target z_index: reorderNode renormalizes
  // every z_index to its array position, while addNode hands out sparse (max+1) values,
  // so a stale target z can exceed n-1 and a `while (z < targetZ)` loop would spin forever.
  const ordered = sortedNodes(doc);
  const fromIdx = ordered.findIndex((n) => n.id === sourceId);
  const toIdx = ordered.findIndex((n) => n.id === targetId);
  if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return doc;
  const next = [...ordered];
  const [moved] = next.splice(fromIdx, 1);
  next.splice(toIdx, 0, moved);
  return { ...doc, nodes: next.map((n, i) => ({ ...n, geometry: { ...n.geometry, z_index: i } })) };
}

export function removeNodeFromGroup(doc: PinselaTemplateDocV1, id: string): PinselaTemplateDocV1 {
  const map = nodeMap(doc);
  const node = map.get(id);
  const parentId = String(node?.parent_id || "").trim();
  if (!node || !parentId) return doc;
  return {
    ...doc,
    nodes: doc.nodes.map((n) => {
      if (n.id === id) return { ...n, parent_id: null };
      if (n.id === parentId) return { ...n, children_ids: (n.children_ids || []).filter((cid) => cid !== id) };
      return n;
    }),
  };
}

export function toggleNodeLock(doc: PinselaTemplateDocV1, id: string): PinselaTemplateDocV1 {
  const target = doc.nodes.find((n) => n.id === id);
  if (!target) return doc;
  return patchNodeStyle(doc, id, { locked: !target.style.locked });
}

export function toggleNodeVisible(doc: PinselaTemplateDocV1, id: string): PinselaTemplateDocV1 {
  const target = doc.nodes.find((n) => n.id === id);
  if (!target) return doc;
  return patchNodeStyle(doc, id, { visible: target.style.visible === false ? true : false });
}
