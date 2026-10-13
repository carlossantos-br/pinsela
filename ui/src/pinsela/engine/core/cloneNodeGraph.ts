import { uid } from "../../core/scene";
import type { PinselaNode } from "../../core/types";
import { cloneDoc } from "./documentUtils";

export interface CloneNodeGraphOptions {
  offsetX?: number;
  offsetY?: number;
  unlock?: boolean;
}

export interface CloneNodeGraphResult {
  clones: PinselaNode[];
  selectionIds: string[];
}

export interface CanvasSize {
  width: number;
  height: number;
}

/** Absolute bounding box (top-left + size) of a set of nodes. */
function unionBounds(nodes: PinselaNode[]): { minX: number; minY: number; w: number; h: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    const g = node?.geometry;
    if (!g) continue;
    const x = Number(g.x || 0);
    const y = Number(g.y || 0);
    const w = Number(g.width || 0);
    const h = Number(g.height || 0);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return { minX, minY, w: maxX - minX, h: maxY - minY };
}

/**
 * Decides the paste offset. If the nodes' bounding box (after the default nudge)
 * fits inside the destination canvas, keeps the 18px nudge (duplicate in place).
 * If it falls fully/partially outside — typical when pasting between projects of
 * different sizes — centers the content in the visible area so it does not
 * "vanish" below/beside the edge. Coordinates are absolute, so a single
 * uniform delta preserves the group's internal layout.
 */
export function pasteOffsetForCanvas(
  nodes: PinselaNode[],
  canvas: CanvasSize | null | undefined,
  nudge = 18,
): { offsetX: number; offsetY: number } {
  const bounds = unionBounds(nodes);
  const canvasW = Number(canvas?.width || 0);
  const canvasH = Number(canvas?.height || 0);
  if (!bounds || !canvasW || !canvasH) {
    return { offsetX: nudge, offsetY: nudge };
  }
  const nudgedMinX = bounds.minX + nudge;
  const nudgedMinY = bounds.minY + nudge;
  const fitsX = nudgedMinX >= 0 && nudgedMinX + bounds.w <= canvasW;
  const fitsY = nudgedMinY >= 0 && nudgedMinY + bounds.h <= canvasH;
  if (fitsX && fitsY) {
    return { offsetX: nudge, offsetY: nudge };
  }
  // Centers the bbox on the canvas (clamping so the top-left is never pushed
  // outside when the content is larger than the canvas).
  const targetX = Math.max(0, (canvasW - bounds.w) / 2);
  const targetY = Math.max(0, (canvasH - bounds.h) / 2);
  return {
    offsetX: Math.round(targetX - bounds.minX),
    offsetY: Math.round(targetY - bounds.minY),
  };
}

export function cloneNodeGraph(
  sourceNodes: PinselaNode[],
  selectedIds: string[],
  options?: CloneNodeGraphOptions,
): CloneNodeGraphResult {
  const nodes = sourceNodes.filter(Boolean);
  if (!nodes.length) {
    return { clones: [], selectionIds: [] };
  }

  const offsetX = Number(options?.offsetX || 0);
  const offsetY = Number(options?.offsetY || 0);
  const unlock = options?.unlock !== false;
  const includedIds = new Set(nodes.map((node) => node.id));
  const idMap = new Map<string, string>();

  for (const node of nodes) {
    idMap.set(node.id, uid(node.kind));
  }

  const clones = nodes.map((node) => {
    const cloned = cloneDoc(node);
    cloned.id = idMap.get(node.id) || uid(node.kind);
    cloned.parent_id = node.parent_id && includedIds.has(node.parent_id)
      ? (idMap.get(node.parent_id) || null)
      : null;
    cloned.children_ids = (node.children_ids || [])
      .map((childId) => (includedIds.has(childId) ? (idMap.get(childId) || "") : ""))
      .filter(Boolean);
    cloned.geometry = {
      ...cloned.geometry,
      x: Number(cloned.geometry?.x || 0) + offsetX,
      y: Number(cloned.geometry?.y || 0) + offsetY,
    };
    if (unlock) {
      cloned.style = { ...cloned.style, locked: false };
    }
    return cloned;
  });

  const selectionIds = selectedIds
    .map((id) => String(idMap.get(id) || "").trim())
    .filter(Boolean);

  return {
    clones,
    selectionIds: selectionIds.length ? selectionIds : clones.map((node) => node.id),
  };
}
