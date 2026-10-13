import type { PinselaTemplateDocV1 } from "./types";
import { aabbWithRotation, expandSelectionWithDescendants, patchNodeGeometry } from "./scene";

export type AlignMode = "left" | "center" | "right" | "top" | "middle" | "bottom";
export type DistributeAxis = "horizontal" | "vertical";

export type GuideLine = {
  axis: "x" | "y";
  value: number;
  source: "page" | "object" | "grid";
};

export type SnapPriorityMode = "distance" | "object_first" | "page_first" | "grid_first";

export type SnapOptions = {
  enabled?: boolean;
  toPage?: boolean;
  toObjects?: boolean;
  toGrid?: boolean;
  gridSize?: number;
  tolerance?: number;
  priorityMode?: SnapPriorityMode;
  viewportScale?: number;
};

function _findNode(doc: PinselaTemplateDocV1, id: string) {
  return doc.nodes.find((n) => n.id === id) || null;
}

export function selectionBounds(doc: PinselaTemplateDocV1, ids: string[]): { x: number; y: number; w: number; h: number } | null {
  const effectiveIds = expandSelectionWithDescendants(doc, ids);
  const selectedSet = new Set(effectiveIds);
  const childrenByParent = new Map<string, Set<string>>();
  for (const node of doc.nodes) {
    const parentId = String(node.parent_id || "").trim();
    if (!parentId) continue;
    const bucket = childrenByParent.get(parentId) || new Set<string>();
    bucket.add(node.id);
    childrenByParent.set(parentId, bucket);
  }

  const nodesAll = effectiveIds.map((id) => _findNode(doc, id)).filter(Boolean) as NonNullable<ReturnType<typeof _findNode>>[];
  const nodes = nodesAll.filter((node) => {
    if (node.kind !== "group") return true;
    const directChildren = childrenByParent.get(node.id) || new Set<string>();
    for (const childId of directChildren) {
      if (selectedSet.has(childId)) return false;
    }
    return true;
  });
  const resolvedNodes = nodes.length ? nodes : nodesAll;
  if (!resolvedNodes.length) return null;
  const boxes = resolvedNodes.map((n) => aabbWithRotation(n));
  const minX = Math.min(...boxes.map((b) => b.x));
  const minY = Math.min(...boxes.map((b) => b.y));
  const maxX = Math.max(...boxes.map((b) => b.x + b.w));
  const maxY = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function alignSelection(doc: PinselaTemplateDocV1, ids: string[], mode: AlignMode): PinselaTemplateDocV1 {
  if (ids.length < 1) return doc;
  const bounds = ids.length === 1
    ? {
      x: 0,
      y: 0,
      w: Math.max(0, Number(doc.canvas.width || 0)),
      h: Math.max(0, Number(doc.canvas.height || 0)),
    }
    : selectionBounds(doc, ids);
  if (!bounds) return doc;
  let next = doc;
  for (const id of ids) {
    const node = _findNode(next, id);
    if (!node) continue;
    const g = node.geometry;
    if (mode === "left") next = patchNodeGeometry(next, id, { x: bounds.x });
    if (mode === "center") next = patchNodeGeometry(next, id, { x: bounds.x + (bounds.w - g.width) / 2 });
    if (mode === "right") next = patchNodeGeometry(next, id, { x: bounds.x + bounds.w - g.width });
    if (mode === "top") next = patchNodeGeometry(next, id, { y: bounds.y });
    if (mode === "middle") next = patchNodeGeometry(next, id, { y: bounds.y + (bounds.h - g.height) / 2 });
    if (mode === "bottom") next = patchNodeGeometry(next, id, { y: bounds.y + bounds.h - g.height });
  }
  return next;
}

export function distributeSelection(doc: PinselaTemplateDocV1, ids: string[], axis: DistributeAxis): PinselaTemplateDocV1 {
  if (ids.length < 3) return doc;
  const nodes = ids
    .map((id) => _findNode(doc, id))
    .filter(Boolean)
    .map((n) => n as NonNullable<ReturnType<typeof _findNode>>);
  if (nodes.length < 3) return doc;

  const sorted = [...nodes].sort((a, b) =>
    axis === "horizontal" ? a.geometry.x - b.geometry.x : a.geometry.y - b.geometry.y
  );

  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  if (axis === "horizontal") {
    const totalWidths = sorted.reduce((acc, n) => acc + n.geometry.width, 0);
    const span = (last.geometry.x + last.geometry.width) - first.geometry.x;
    const gap = (span - totalWidths) / (sorted.length - 1);
    let cursor = first.geometry.x;
    let next = doc;
    for (const n of sorted) {
      next = patchNodeGeometry(next, n.id, { x: cursor });
      cursor += n.geometry.width + gap;
    }
    return next;
  }

  const totalHeights = sorted.reduce((acc, n) => acc + n.geometry.height, 0);
  const span = (last.geometry.y + last.geometry.height) - first.geometry.y;
  const gap = (span - totalHeights) / (sorted.length - 1);
  let cursor = first.geometry.y;
  let next = doc;
  for (const n of sorted) {
    next = patchNodeGeometry(next, n.id, { y: cursor });
    cursor += n.geometry.height + gap;
  }
  return next;
}

function _snapTargetValues(
  doc: PinselaTemplateDocV1,
  skipIds: Set<string>,
  options: Required<SnapOptions>,
  customGuides: GuideLine[],
  objectFilter?: (box: { x: number; y: number; w: number; h: number }) => boolean,
): { xs: Array<{ value: number; source: GuideLine["source"] }>; ys: Array<{ value: number; source: GuideLine["source"] }> } {
  const xs: Array<{ value: number; source: GuideLine["source"] }> = [];
  const ys: Array<{ value: number; source: GuideLine["source"] }> = [];

  if (options.toPage) {
    xs.push({ value: 0, source: "page" }, { value: doc.canvas.width / 2, source: "page" }, { value: doc.canvas.width, source: "page" });
    ys.push({ value: 0, source: "page" }, { value: doc.canvas.height / 2, source: "page" }, { value: doc.canvas.height, source: "page" });
  }

  if (options.toObjects) {
    for (const n of doc.nodes) {
      if (n.id === doc.root_id) continue;
      if (skipIds.has(n.id) || n.style?.visible === false) continue;
      const box = _normalizeSnapBox(n, aabbWithRotation(n));
      if (box.w <= 0 || box.h <= 0) continue;
      if (objectFilter && !objectFilter(box)) continue;
      xs.push(
        { value: box.x, source: "object" },
        { value: box.x + box.w / 2, source: "object" },
        { value: box.x + box.w, source: "object" }
      );
      ys.push(
        { value: box.y, source: "object" },
        { value: box.y + box.h / 2, source: "object" },
        { value: box.y + box.h, source: "object" }
      );
    }
  }

  if (options.toGrid && options.gridSize > 1) {
    const step = Math.max(2, Math.round(options.gridSize));
    for (let x = 0; x <= doc.canvas.width; x += step) xs.push({ value: x, source: "grid" });
    for (let y = 0; y <= doc.canvas.height; y += step) ys.push({ value: y, source: "grid" });
  }

  if (customGuides.length) {
    for (const guide of customGuides) {
      if (guide.axis === "x") {
        xs.push({ value: Number(guide.value || 0), source: guide.source || "page" });
      } else {
        ys.push({ value: Number(guide.value || 0), source: guide.source || "page" });
      }
    }
  }
  return { xs: _dedupeTargets(xs), ys: _dedupeTargets(ys) };
}

function _dedupeTargets(values: Array<{ value: number; source: GuideLine["source"] }>): Array<{ value: number; source: GuideLine["source"] }> {
  const out: Array<{ value: number; source: GuideLine["source"] }> = [];
  const seen = new Set<string>();
  for (const item of values) {
    const v = Number(item.value || 0);
    const key = `${item.source}:${v.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ value: v, source: item.source });
  }
  return out;
}

function _priorityRank(mode: SnapPriorityMode, source: GuideLine["source"]): number {
  if (mode === "object_first") return source === "object" ? 0 : source === "page" ? 1 : 2;
  if (mode === "page_first") return source === "page" ? 0 : source === "object" ? 1 : 2;
  if (mode === "grid_first") return source === "grid" ? 0 : source === "object" ? 1 : 2;
  return source === "object" ? 0 : source === "page" ? 1 : 2;
}

type SnapCandidate = {
  delta: number;
  next: number;
  source: GuideLine["source"];
  guideValue: number;
};

function _findObjectBoxes(doc: PinselaTemplateDocV1, skipIds: Set<string>): Array<{ x: number; y: number; w: number; h: number }> {
  const out: Array<{ x: number; y: number; w: number; h: number }> = [];
  for (const n of doc.nodes) {
    if (n.id === doc.root_id) continue;
    if (skipIds.has(n.id) || n.style?.visible === false) continue;
    const box = _normalizeSnapBox(n, aabbWithRotation(n));
    if (box.w <= 0 || box.h <= 0) continue;
    out.push(box);
  }
  return out;
}

function _nodeStrokeWidth(node: PinselaTemplateDocV1["nodes"][number]): number {
  const stroke = node.style?.stroke;
  if (stroke && typeof stroke === "object" && !Array.isArray(stroke)) {
    const width = Number((stroke as Record<string, unknown>).width);
    if (Number.isFinite(width) && width > 0) return width;
  }
  const stacked = (node.style as Record<string, unknown> | undefined)?.strokes;
  if (Array.isArray(stacked)) {
    let maxWidth = 0;
    for (const rawItem of stacked) {
      if (!rawItem || typeof rawItem !== "object") continue;
      const item = rawItem as Record<string, unknown>;
      if (item.enabled === false) continue;
      const width = Number(item.weight ?? item.width);
      if (Number.isFinite(width) && width > maxWidth) maxWidth = width;
    }
    if (maxWidth > 0) return maxWidth;
  }
  return 0;
}

function _normalizeSnapBox(
  node: PinselaTemplateDocV1["nodes"][number],
  box: { x: number; y: number; w: number; h: number },
): { x: number; y: number; w: number; h: number } {
  let x = Number(box.x || 0);
  let y = Number(box.y || 0);
  let w = Math.max(0, Number(box.w || 0));
  let h = Math.max(0, Number(box.h || 0));
  const strokeWidth = Math.max(0, _nodeStrokeWidth(node));
  const isStrokeLike = node.kind === "line" || node.kind === "path";
  const minAxis = Math.max(1, strokeWidth, isStrokeLike ? 1 : 0);

  if (w < minAxis) {
    const cx = x + w / 2;
    w = minAxis;
    x = cx - w / 2;
  }
  if (h < minAxis) {
    const cy = y + h / 2;
    h = minAxis;
    y = cy - h / 2;
  }
  return { x, y, w, h };
}

function _expandRect(
  rect: { x: number; y: number; w: number; h: number },
  padding: number,
): { x: number; y: number; w: number; h: number } {
  const pad = Math.max(0, Number(padding || 0));
  return {
    x: rect.x - pad,
    y: rect.y - pad,
    w: rect.w + pad * 2,
    h: rect.h + pad * 2,
  };
}

function _rectsIntersect(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y);
}

function _overlapsY(a: { y: number; h: number }, b: { y: number; h: number }): boolean {
  const a2 = a.y + a.h;
  const b2 = b.y + b.h;
  return !(a2 < b.y || b2 < a.y);
}

function _overlapsX(a: { x: number; w: number }, b: { x: number; w: number }): boolean {
  const a2 = a.x + a.w;
  const b2 = b.x + b.w;
  return !(a2 < b.x || b2 < a.x);
}

function _smartDistributionXCandidate(
  boxes: Array<{ x: number; y: number; w: number; h: number }>,
  moved: { x: number; y: number; w: number; h: number },
  dx: number,
  tolerance: number
): SnapCandidate | null {
  let leftEdge = Number.NEGATIVE_INFINITY;
  let rightEdge = Number.POSITIVE_INFINITY;
  for (const box of boxes) {
    if (!_overlapsY(box, moved)) continue;
    const boxRight = box.x + box.w;
    if (boxRight <= moved.x && boxRight > leftEdge) leftEdge = boxRight;
    if (box.x >= moved.x + moved.w && box.x < rightEdge) rightEdge = box.x;
  }
  if (!Number.isFinite(leftEdge) || !Number.isFinite(rightEdge)) return null;
  const leftGap = moved.x - leftEdge;
  const rightGap = rightEdge - (moved.x + moved.w);
  const shift = (rightGap - leftGap) / 2;
  const delta = Math.abs(shift);
  if (delta > tolerance) return null;
  return {
    delta,
    next: dx + shift,
    source: "object",
    guideValue: moved.x + moved.w / 2 + shift,
  };
}

function _smartDistributionYCandidate(
  boxes: Array<{ x: number; y: number; w: number; h: number }>,
  moved: { x: number; y: number; w: number; h: number },
  dy: number,
  tolerance: number
): SnapCandidate | null {
  let topEdge = Number.NEGATIVE_INFINITY;
  let bottomEdge = Number.POSITIVE_INFINITY;
  for (const box of boxes) {
    if (!_overlapsX(box, moved)) continue;
    const boxBottom = box.y + box.h;
    if (boxBottom <= moved.y && boxBottom > topEdge) topEdge = boxBottom;
    if (box.y >= moved.y + moved.h && box.y < bottomEdge) bottomEdge = box.y;
  }
  if (!Number.isFinite(topEdge) || !Number.isFinite(bottomEdge)) return null;
  const topGap = moved.y - topEdge;
  const bottomGap = bottomEdge - (moved.y + moved.h);
  const shift = (bottomGap - topGap) / 2;
  const delta = Math.abs(shift);
  if (delta > tolerance) return null;
  return {
    delta,
    next: dy + shift,
    source: "object",
    guideValue: moved.y + moved.h / 2 + shift,
  };
}

function _isBetterCandidate(mode: SnapPriorityMode, next: SnapCandidate, prev: SnapCandidate | null): boolean {
  if (!prev) return true;
  const nextRank = _priorityRank(mode, next.source);
  const prevRank = _priorityRank(mode, prev.source);
  if (mode === "distance") {
    if (next.delta < prev.delta) return true;
    if (next.delta === prev.delta && nextRank < prevRank) return true;
    return false;
  }
  if (nextRank < prevRank) return true;
  if (nextRank === prevRank && next.delta < prev.delta) return true;
  return false;
}

export function snapMove(
  doc: PinselaTemplateDocV1,
  ids: string[],
  dx: number,
  dy: number,
  threshold = 20,
  options?: SnapOptions
): { dx: number; dy: number; guides: GuideLine[] } {
  const effectiveIds = expandSelectionWithDescendants(doc, ids);
  if (!effectiveIds.length) return { dx, dy, guides: [] };
  const opts: Required<SnapOptions> = {
    enabled: options?.enabled ?? true,
    toPage: options?.toPage ?? true,
    toObjects: options?.toObjects ?? true,
    toGrid: options?.toGrid ?? false,
    gridSize: options?.gridSize ?? 8,
    tolerance: options?.tolerance ?? threshold,
    priorityMode: options?.priorityMode ?? "distance",
    viewportScale: options?.viewportScale ?? 1,
  };
  if (!opts.enabled) return { dx, dy, guides: [] };

  const bounds = selectionBounds(doc, effectiveIds);
  if (!bounds) return { dx, dy, guides: [] };

  const optionsWithCustomGuides = options as (SnapOptions & { customGuides?: GuideLine[] }) | undefined;
  const customGuides = Array.isArray(optionsWithCustomGuides?.customGuides)
    ? optionsWithCustomGuides.customGuides.filter((guide) => guide && (guide.axis === "x" || guide.axis === "y"))
    : [];

  const viewportScale = Math.max(0.05, Number(options?.viewportScale || 1));
  const tolerance = Math.max(0.5, Number(opts.tolerance || threshold) / viewportScale);

  const skipIds = new Set(effectiveIds);
  const movedBounds = {
    x: bounds.x + dx,
    y: bounds.y + dy,
    w: bounds.w,
    h: bounds.h,
  };
  const objectSnapRadiusDoc = Math.max(tolerance * 6, 280 / viewportScale);
  const objectQueryBounds = _expandRect(movedBounds, objectSnapRadiusDoc);
  const objectFilter = (box: { x: number; y: number; w: number; h: number }) => _rectsIntersect(box, objectQueryBounds);

  const targets = _snapTargetValues(doc, skipIds, opts, customGuides, objectFilter);
  const objectBoxes = opts.toObjects ? _findObjectBoxes(doc, skipIds).filter(objectFilter) : [];

  const left = bounds.x + dx;
  const cx = bounds.x + bounds.w / 2 + dx;
  const right = bounds.x + bounds.w + dx;
  const top = bounds.y + dy;
  const cy = bounds.y + bounds.h / 2 + dy;
  const bottom = bounds.y + bounds.h + dy;

  let bestX: SnapCandidate | null = null;
  let bestY: SnapCandidate | null = null;
  const guides: GuideLine[] = [];

  for (const target of targets.xs) {
    const tx = target.value;
    for (const cur of [left, cx, right]) {
      const delta = Math.abs(tx - cur);
      if (delta <= tolerance) {
        const candidate: SnapCandidate = {
          delta,
          next: dx + (tx - cur),
          source: target.source,
          guideValue: tx,
        };
        if (_isBetterCandidate(opts.priorityMode, candidate, bestX)) {
          bestX = candidate;
        }
      }
    }
  }

  for (const target of targets.ys) {
    const ty = target.value;
    for (const cur of [top, cy, bottom]) {
      const delta = Math.abs(ty - cur);
      if (delta <= tolerance) {
        const candidate: SnapCandidate = {
          delta,
          next: dy + (ty - cur),
          source: target.source,
          guideValue: ty,
        };
        if (_isBetterCandidate(opts.priorityMode, candidate, bestY)) {
          bestY = candidate;
        }
      }
    }
  }

  if (objectBoxes.length) {
    const moved = {
      x: bounds.x + dx,
      y: bounds.y + dy,
      w: bounds.w,
      h: bounds.h,
    };
    const smartX = _smartDistributionXCandidate(objectBoxes, moved, dx, tolerance);
    if (smartX && _isBetterCandidate(opts.priorityMode, smartX, bestX)) bestX = smartX;
    const smartY = _smartDistributionYCandidate(objectBoxes, moved, dy, tolerance);
    if (smartY && _isBetterCandidate(opts.priorityMode, smartY, bestY)) bestY = smartY;
  }

  if (bestX) guides.push({ axis: "x", value: bestX.guideValue, source: bestX.source });
  if (bestY) guides.push({ axis: "y", value: bestY.guideValue, source: bestY.source });

  return { dx: bestX ? bestX.next : dx, dy: bestY ? bestY.next : dy, guides };
}
