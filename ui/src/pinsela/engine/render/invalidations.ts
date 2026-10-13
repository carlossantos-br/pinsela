import type { GuideLine } from "../../core/layout";
import type { DirtyRegion, SceneSnapshot, SceneSnapshotNode } from "./types";

const MAX_INCREMENTAL_NODE_DIFFS = 48;
const DIRTY_REGION_PAD_PX = 14;

function clampRegion(region: DirtyRegion, width: number, height: number): DirtyRegion | null {
  const x = Math.max(0, Math.min(width, region.x));
  const y = Math.max(0, Math.min(height, region.y));
  const w = Math.max(0, Math.min(width - x, region.w - (x - region.x)));
  const h = Math.max(0, Math.min(height - y, region.h - (y - region.y)));
  if (w <= 0 || h <= 0) return null;
  return { x, y, w, h };
}

function boundsToRegion(bounds: { x: number; y: number; w: number; h: number }, pad = 4): DirtyRegion {
  return {
    x: bounds.x - pad,
    y: bounds.y - pad,
    w: bounds.w + pad * 2,
    h: bounds.h + pad * 2,
  };
}

function guideToRegion(guide: GuideLine, canvas: { width: number; height: number }, pad = 44): DirtyRegion {
  if (guide.axis === "x") {
    return { x: guide.value - pad, y: 0, w: pad * 2 + 1, h: canvas.height };
  }
  return { x: 0, y: guide.value - pad, w: canvas.width, h: pad * 2 + 1 };
}

function guideKey(guide: GuideLine): string {
  return `${guide.axis}:${Number(guide.value).toFixed(3)}:${guide.source}`;
}

function sameSelection(
  a: { x: number; y: number; w: number; h: number } | null,
  b: { x: number; y: number; w: number; h: number } | null
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

function pushRegion(
  out: DirtyRegion[],
  region: DirtyRegion | null | undefined,
  canvas: { width: number; height: number }
): void {
  if (!region) return;
  const next = clampRegion(region, canvas.width, canvas.height);
  if (!next) return;
  out.push(next);
}

function guideMap(guides: readonly GuideLine[]): Map<string, GuideLine> {
  const map = new Map<string, GuideLine>();
  for (const g of guides) map.set(guideKey(g), g);
  return map;
}

function guidesDiffer(a: readonly GuideLine[], b: readonly GuideLine[]): boolean {
  if (a.length !== b.length) return true;
  const aKeys = new Set(a.map((g) => guideKey(g)));
  for (const g of b) {
    if (!aKeys.has(guideKey(g))) return true;
  }
  return false;
}

function stableSerialize(value: unknown): string {
  if (value == null) return "";
  if (typeof value !== "object") return String(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableSerialize(entry)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((key) => `${key}:${stableSerialize(obj[key])}`).join(",")}}`;
}

function geometryToRegion(node: SceneSnapshotNode, pad = DIRTY_REGION_PAD_PX): DirtyRegion {
  const g = node.geometry;
  const width = Math.max(1, Math.abs(Number(g.width || 0)));
  const height = Math.max(1, Math.abs(Number(g.height || 0)));
  const x = Number(g.x || 0);
  const y = Number(g.y || 0);
  const rotation = Math.abs(Number(g.rotation || 0)) % 360;

  if (node.kind === "line") {
    const x2 = x + Number(g.width || 0);
    const y2 = y + Number(g.height || 0);
    return {
      x: Math.min(x, x2) - pad,
      y: Math.min(y, y2) - pad,
      w: Math.max(1, Math.abs(x2 - x)) + pad * 2,
      h: Math.max(1, Math.abs(y2 - y)) + pad * 2,
    };
  }

  if (rotation > 0.001) {
    const cx = x + width / 2;
    const cy = y + height / 2;
    const radius = Math.hypot(width, height) / 2 + pad;
    return {
      x: cx - radius,
      y: cy - radius,
      w: radius * 2,
      h: radius * 2,
    };
  }

  return {
    x: x - pad,
    y: y - pad,
    w: width + pad * 2,
    h: height + pad * 2,
  };
}

function nodeRequiresFullRepaint(node: SceneSnapshotNode | null | undefined): boolean {
  if (!node) return false;
  if (node.geometry?.clip) return true;
  if (node.style?.mask) return true;
  if (Array.isArray(node.style?.effects) && node.style.effects.length > 0) return true;
  return false;
}

function appendNodeDiffRegions(
  prev: SceneSnapshot,
  next: SceneSnapshot,
  regions: DirtyRegion[],
): boolean {
  const prevMap = new Map(prev.nodes.map((node) => [node.id, node] as const));
  const nextMap = new Map(next.nodes.map((node) => [node.id, node] as const));
  const ids = new Set<string>([...prevMap.keys(), ...nextMap.keys()]);
  let diffCount = 0;

  for (const id of ids) {
    const prevNode = prevMap.get(id) || null;
    const nextNode = nextMap.get(id) || null;
    if (nodeRequiresFullRepaint(prevNode) || nodeRequiresFullRepaint(nextNode)) return false;
    if (!prevNode || !nextNode) {
      diffCount += 1;
      if (prevNode) pushRegion(regions, geometryToRegion(prevNode), next.canvas);
      if (nextNode) pushRegion(regions, geometryToRegion(nextNode), next.canvas);
      continue;
    }
    if (prevNode.parent_id !== nextNode.parent_id) return false;
    if (prevNode.renderHash === nextNode.renderHash) continue;
    diffCount += 1;
    pushRegion(regions, geometryToRegion(prevNode), next.canvas);
    pushRegion(regions, geometryToRegion(nextNode), next.canvas);
  }

  return diffCount <= MAX_INCREMENTAL_NODE_DIFFS;
}

export function computeDirtyRegions(prev: SceneSnapshot | null, next: SceneSnapshot): DirtyRegion[] | null {
  if (!prev) return null;
  if (prev.canvas.width !== next.canvas.width || prev.canvas.height !== next.canvas.height) return null;
  if (stableSerialize(prev.canvas.background) !== stableSerialize(next.canvas.background)) return null;

  const regions: DirtyRegion[] = [];
  if (!appendNodeDiffRegions(prev, next, regions)) return null;

  if (!sameSelection(prev.selectionBounds, next.selectionBounds)) {
    if (prev.selectionBounds) pushRegion(regions, boundsToRegion(prev.selectionBounds), next.canvas);
    if (next.selectionBounds) pushRegion(regions, boundsToRegion(next.selectionBounds), next.canvas);
  }

  if (guidesDiffer(prev.guides, next.guides)) {
    const prevMap = guideMap(prev.guides);
    const nextMap = guideMap(next.guides);
    prevMap.forEach((guide, key) => {
      if (!nextMap.has(key)) pushRegion(regions, guideToRegion(guide, next.canvas), next.canvas);
    });
    nextMap.forEach((guide, key) => {
      if (!prevMap.has(key)) pushRegion(regions, guideToRegion(guide, next.canvas), next.canvas);
    });
  }

  return regions;
}
