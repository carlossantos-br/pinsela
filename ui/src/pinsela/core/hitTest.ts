import type { PinselaNode, PinselaTemplateDocV1 } from "./types";
import { getPathFillRule, getPathSubpaths } from "./pathData";
import { aabbWithRotation } from "./scene";

const HIT_TEST_CELL_SIZE = 192;
const LINE_MIN_HIT_RADIUS_PX = 6;
const LINE_THIN_STROKE_MAX = 6;
const LINE_THIN_BONUS_MAX_PX = 2.5;
const RECT_STROKE_MIN_HIT_RADIUS_PX = 4;

type HitTestOptions = {
  includeLocked?: boolean;
  viewportScale?: number;
};

type SpatialIndex = {
  nodes: PinselaNode[];
  boxes: Array<{ x: number; y: number; w: number; h: number }>;
  cells: Map<string, number[]>;
};

const spatialIndexCache = new WeakMap<
  PinselaTemplateDocV1,
  {
    locked: SpatialIndex;
    unlocked: SpatialIndex;
  }
>();

function normalizeViewportScale(viewportScale?: number): number {
  const scale = Number(viewportScale);
  if (!Number.isFinite(scale) || scale <= 0.0001) return 1;
  return scale;
}

function lineStrokeWidth(node: PinselaNode): number {
  const rawStroke = (node.style?.stroke && typeof node.style.stroke === "object") ? (node.style.stroke as any) : null;
  return Math.max(1, Number(rawStroke?.width || 4));
}

function lineEndpoints(node: PinselaNode): { start: { x: number; y: number }; end: { x: number; y: number } } {
  const g = node.geometry;
  const x = Number(g.x || 0);
  const y = Number(g.y || 0);
  const p1 = { x, y };
  const p2 = { x: x + Number(g.width || 0), y: y + Number(g.height || 0) };
  const rot = Number(g.rotation || 0);
  if (!rot) return { start: p1, end: p2 };
  const rad = (rot * Math.PI) / 180;
  const cx = x + Number(g.width || 0) / 2;
  const cy = y + Number(g.height || 0) / 2;
  const rotate = (p: { x: number; y: number }) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    return {
      x: cx + dx * Math.cos(rad) - dy * Math.sin(rad),
      y: cy + dx * Math.sin(rad) + dy * Math.cos(rad),
    };
  };
  return { start: rotate(p1), end: rotate(p2) };
}

function lineHitRadius(node: PinselaNode, viewportScale = 1): number {
  const strokeW = lineStrokeWidth(node);
  const lineRadius = strokeW * 0.5;
  const minRadiusDoc = LINE_MIN_HIT_RADIUS_PX / Math.max(0.0001, viewportScale);
  const thinRatio = Math.max(0, Math.min(1, (LINE_THIN_STROKE_MAX - strokeW) / LINE_THIN_STROKE_MAX));
  const thinBonusDoc = (LINE_THIN_BONUS_MAX_PX * thinRatio) / Math.max(0.0001, viewportScale);
  return Math.max(lineRadius, minRadiusDoc) + thinBonusDoc;
}

function pathStrokeWidth(node: PinselaNode): number {
  const rawStroke = (node.style?.stroke && typeof node.style.stroke === "object") ? (node.style.stroke as any) : null;
  return Math.max(1, Number(rawStroke?.width || 2));
}

function pathHitRadius(node: PinselaNode, viewportScale = 1): number {
  const strokeW = pathStrokeWidth(node);
  const lineRadius = strokeW * 0.5;
  const minRadiusDoc = LINE_MIN_HIT_RADIUS_PX / Math.max(0.0001, viewportScale);
  const thinRatio = Math.max(0, Math.min(1, (LINE_THIN_STROKE_MAX - strokeW) / LINE_THIN_STROKE_MAX));
  const thinBonusDoc = (LINE_THIN_BONUS_MAX_PX * thinRatio) / Math.max(0.0001, viewportScale);
  return Math.max(lineRadius, minRadiusDoc) + thinBonusDoc;
}

type PathAnchorPoint = {
  x: number;
  y: number;
  in?: { x: number; y: number } | null;
  out?: { x: number; y: number } | null;
};

type ResolvedPathSubpath = {
  closed: boolean;
  anchors: PathAnchorPoint[];
};

function pathSubpaths(node: PinselaNode): ResolvedPathSubpath[] {
  if (node.kind !== "path") return [];
  const g = node.geometry;
  return getPathSubpaths(node.path_data || null).map((subpath) => ({
    closed: subpath.closed !== false,
    anchors: subpath.points.map((point) => ({
      x: Number(g.x || 0) + Number(point?.x || 0),
      y: Number(g.y || 0) + Number(point?.y || 0),
      in: point?.in
        ? {
            x: Number(g.x || 0) + Number(point.in.x || 0),
            y: Number(g.y || 0) + Number(point.in.y || 0),
          }
        : point?.in ?? null,
      out: point?.out
        ? {
            x: Number(g.x || 0) + Number(point.out.x || 0),
            y: Number(g.y || 0) + Number(point.out.y || 0),
          }
        : point?.out ?? null,
    })),
  })).filter((subpath) => subpath.anchors.length >= 2);
}

function hasPathHandle(anchor: PathAnchorPoint, handle: PathAnchorPoint["in"] | PathAnchorPoint["out"]): handle is { x: number; y: number } {
  if (!handle) return false;
  return Math.abs(Number(handle.x || 0) - Number(anchor.x || 0)) > 0.0001
    || Math.abs(Number(handle.y || 0) - Number(anchor.y || 0)) > 0.0001;
}

function cubicPoint(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  t: number,
): { x: number; y: number } {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;
  return {
    x: mt2 * mt * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t2 * t * p3.x,
    y: mt2 * mt * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t2 * t * p3.y,
  };
}

function samplePathSegmentPoints(from: PathAnchorPoint, to: PathAnchorPoint): Array<{ x: number; y: number }> {
  const cp1 = hasPathHandle(from, from.out) ? from.out : null;
  const cp2 = hasPathHandle(to, to.in) ? to.in : null;
  if (!cp1 && !cp2) return [from, to];
  const samples: Array<{ x: number; y: number }> = [];
  const steps = 16;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    samples.push(cubicPoint(from, cp1 || from, cp2 || to, to, t));
  }
  return samples;
}

function pointInPolygon(px: number, py: number, polygon: Array<{ x: number; y: number }>): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersects = ((yi > py) !== (yj > py))
      && (px < ((xj - xi) * (py - yi)) / ((yj - yi) || 0.0000001) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInPolygonWinding(px: number, py: number, polygon: Array<{ x: number; y: number }>): number {
  let winding = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const start = polygon[j];
    const end = polygon[i];
    const cross = ((end.x - start.x) * (py - start.y)) - ((px - start.x) * (end.y - start.y));
    if (start.y <= py) {
      if (end.y > py && cross > 0) winding += 1;
    } else if (end.y <= py && cross < 0) {
      winding -= 1;
    }
  }
  return winding;
}

function pathHasRenderableFill(node: PinselaNode): boolean {
  return hasVisiblePaint(node.style?.fill);
}

function pointInPathNode(node: PinselaNode, px: number, py: number, viewportScale = 1): boolean {
  const subpaths = pathSubpaths(node);
  if (!subpaths.length) return false;
  const hasFill = pathHasRenderableFill(node);
  const hasStroke = nodeHasRenderableStroke(node);
  if (!hasFill && !hasStroke) return false;
  const hitRadius = pathHitRadius(node, viewportScale);
  const hitRadiusSq = hitRadius * hitRadius;
  const fillPolygons: Array<Array<{ x: number; y: number }>> = [];

  for (const subpath of subpaths) {
    const anchors = subpath.anchors;
    const closed = subpath.closed && anchors.length >= 3;
    let polygonPoints: Array<{ x: number; y: number }> = [];
    let previousSamples = samplePathSegmentPoints(anchors[0], anchors[1]);
    for (let i = 1; i < previousSamples.length; i += 1) {
      const a = previousSamples[i - 1];
      const b = previousSamples[i];
      if (hasStroke && pointToSegmentDistanceSquared(px, py, a, b) <= hitRadiusSq) return true;
    }
    polygonPoints.push(...previousSamples);
    for (let idx = 2; idx < anchors.length; idx += 1) {
      const segmentSamples = samplePathSegmentPoints(anchors[idx - 1], anchors[idx]);
      for (let i = 1; i < segmentSamples.length; i += 1) {
        const a = segmentSamples[i - 1];
        const b = segmentSamples[i];
        if (hasStroke && pointToSegmentDistanceSquared(px, py, a, b) <= hitRadiusSq) return true;
      }
      polygonPoints.push(...segmentSamples.slice(1));
    }
    if (closed) {
      const closingSamples = samplePathSegmentPoints(anchors[anchors.length - 1], anchors[0]);
      for (let i = 1; i < closingSamples.length; i += 1) {
        const a = closingSamples[i - 1];
        const b = closingSamples[i];
        if (hasStroke && pointToSegmentDistanceSquared(px, py, a, b) <= hitRadiusSq) return true;
      }
      polygonPoints.push(...closingSamples.slice(1));
      if (polygonPoints.length >= 3) fillPolygons.push(polygonPoints);
    }
  }

  if (hasFill && fillPolygons.length) {
    const fillRule = getPathFillRule(node.path_data || null);
    if (fillRule === "evenodd") {
      let inside = false;
      for (const polygon of fillPolygons) {
        if (pointInPolygon(px, py, polygon)) inside = !inside;
      }
      if (inside) return true;
    } else {
      let winding = 0;
      for (const polygon of fillPolygons) {
        winding += pointInPolygonWinding(px, py, polygon);
      }
      if (winding !== 0) return true;
    }
  }
  return false;
}

function hasVisibleOpacity(node: PinselaNode): boolean {
  const opacity = Number(node.style?.opacity ?? 1);
  return !Number.isFinite(opacity) || opacity > 0.001;
}

function hasVisiblePaint(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value !== "string") {
    if (typeof value !== "object") return true;
    const source = value as Record<string, unknown>;
    if (source.enabled === false || source.visible === false) return false;
    const opacity = Number(source.opacity ?? 100);
    if (Number.isFinite(opacity) && opacity <= 0) return false;
    const stops = Array.isArray(source.stops) ? source.stops : [];
    if (stops.length > 0) {
      return stops.some((stop) => (
        stop && typeof stop === "object" && hasVisiblePaint((stop as Record<string, unknown>).color)
      ));
    }
    return true;
  }

  const raw = value.trim().toLowerCase();
  if (!raw || raw === "none" || raw === "transparent") return false;
  const compact = raw.replace(/\s+/g, "");
  if (compact === "rgba(0,0,0,0)" || compact === "hsla(0,0%,0%,0)") return false;

  const alphaMatch = compact.match(/^(?:rgba|hsla)\([^,]+,[^,]+,[^,]+,([^)]+)\)$/);
  if (alphaMatch) {
    const alpha = Number.parseFloat(alphaMatch[1]);
    if (Number.isFinite(alpha) && alpha <= 0.001) return false;
  }

  const hex = compact.match(/^#([0-9a-f]{4}|[0-9a-f]{8})$/i);
  if (hex) {
    const alphaHex = hex[1].length === 4 ? hex[1][3] + hex[1][3] : hex[1].slice(6, 8);
    const alpha = Number.parseInt(alphaHex, 16);
    if (Number.isFinite(alpha) && alpha <= 0) return false;
  }

  return true;
}

function firstVisibleStrokeFromStack(node: PinselaNode): { color: unknown; width: number; opacity: number } | null {
  const stack = Array.isArray(node.style?.strokes) ? node.style!.strokes! : [];
  for (const entry of stack) {
    if (!entry || entry.enabled === false || entry.visible === false) continue;
    const width = Math.max(0, Number(entry.weight ?? 0));
    if (width <= 0.001) continue;
    const opacity = Number(entry.opacity ?? 100);
    if (Number.isFinite(opacity) && opacity <= 0.001) continue;
    if (!hasVisiblePaint(entry.color)) continue;
    return { color: entry.color, width, opacity };
  }
  return null;
}

function nodeStrokeWidth(node: PinselaNode): number {
  const stackStroke = firstVisibleStrokeFromStack(node);
  if (stackStroke) return stackStroke.width;
  const rawStroke = node.style?.stroke;
  if (!rawStroke) {
    return node.kind === "line" && hasVisiblePaint(node.style?.fill) ? lineStrokeWidth(node) : 0;
  }
  if (typeof rawStroke !== "object") return hasVisiblePaint(rawStroke) ? 1 : 0;
  const stroke = rawStroke as Record<string, unknown>;
  if (stroke.enabled === false || stroke.visible === false) return 0;
  const opacity = Number(stroke.opacity ?? 100);
  if (Number.isFinite(opacity) && opacity <= 0.001) return 0;
  if (!hasVisiblePaint(stroke.color ?? rawStroke)) return 0;
  return Math.max(0, Number(stroke.width ?? stroke.weight ?? 0));
}

function nodeHasRenderableStroke(node: PinselaNode): boolean {
  return nodeStrokeWidth(node) > 0.001;
}

function pointInRectBounds(x: number, y: number, w: number, h: number, px: number, py: number): boolean {
  return px >= x && px <= x + w && py >= y && py <= y + h;
}

function pointNearRectStroke(
  node: PinselaNode,
  px: number,
  py: number,
  viewportScale: number,
): boolean {
  const g = node.geometry;
  const x = Number(g.x || 0);
  const y = Number(g.y || 0);
  const w = Math.max(0, Number(g.width || 0));
  const h = Math.max(0, Number(g.height || 0));
  if (w <= 0 || h <= 0) return false;
  const strokeWidth = nodeStrokeWidth(node);
  if (strokeWidth <= 0) return false;
  const tolerance = Math.max(strokeWidth / 2, RECT_STROKE_MIN_HIT_RADIUS_PX / Math.max(0.0001, viewportScale));
  const outer = pointInRectBounds(x - tolerance, y - tolerance, w + tolerance * 2, h + tolerance * 2, px, py);
  if (!outer) return false;
  const innerInset = Math.max(0, tolerance);
  if (w <= innerInset * 2 || h <= innerInset * 2) return true;
  return !pointInRectBounds(x + innerInset, y + innerInset, w - innerInset * 2, h - innerInset * 2, px, py);
}

function pointInEllipseFill(node: PinselaNode, px: number, py: number): boolean {
  const g = node.geometry;
  const x = Number(g.x || 0);
  const y = Number(g.y || 0);
  const w = Math.max(0, Number(g.width || 0));
  const h = Math.max(0, Number(g.height || 0));
  if (w <= 0 || h <= 0) return false;
  const rx = w / 2;
  const ry = h / 2;
  if (rx <= 0 || ry <= 0) return false;
  const nx = (px - (x + rx)) / rx;
  const ny = (py - (y + ry)) / ry;
  return nx * nx + ny * ny <= 1;
}

function pointNearEllipseStroke(node: PinselaNode, px: number, py: number, viewportScale: number): boolean {
  const g = node.geometry;
  const x = Number(g.x || 0);
  const y = Number(g.y || 0);
  const w = Math.max(0, Number(g.width || 0));
  const h = Math.max(0, Number(g.height || 0));
  if (w <= 0 || h <= 0) return false;
  const strokeWidth = nodeStrokeWidth(node);
  if (strokeWidth <= 0) return false;
  const tolerance = Math.max(strokeWidth / 2, RECT_STROKE_MIN_HIT_RADIUS_PX / Math.max(0.0001, viewportScale));
  const rx = w / 2;
  const ry = h / 2;
  const cx = x + rx;
  const cy = y + ry;
  const dx = px - cx;
  const dy = py - cy;
  const outerRx = rx + tolerance;
  const outerRy = ry + tolerance;
  const innerRx = Math.max(0, rx - tolerance);
  const innerRy = Math.max(0, ry - tolerance);
  const outer = outerRx > 0 && outerRy > 0 && ((dx / outerRx) ** 2 + (dy / outerRy) ** 2 <= 1);
  if (!outer) return false;
  if (innerRx <= 0 || innerRy <= 0) return true;
  return ((dx / innerRx) ** 2 + (dy / innerRy) ** 2) >= 1;
}

function unrotatePointForNode(node: PinselaNode, px: number, py: number): { x: number; y: number } {
  const g = node.geometry;
  const rotation = Number(g.rotation || 0);
  if (Math.abs(rotation) <= 0.0001) return { x: px, y: py };
  const x = Number(g.x || 0);
  const y = Number(g.y || 0);
  const w = Math.max(0, Number(g.width || 0));
  const h = Math.max(0, Number(g.height || 0));
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rad = (-rotation * Math.PI) / 180;
  const dx = px - cx;
  const dy = py - cy;
  return {
    x: cx + dx * Math.cos(rad) - dy * Math.sin(rad),
    y: cy + dx * Math.sin(rad) + dy * Math.cos(rad),
  };
}

function pointInRenderableBoxNode(node: PinselaNode, px: number, py: number, viewportScale: number): boolean {
  if (!hasVisibleOpacity(node)) return false;
  const g = node.geometry;
  const x = Number(g.x || 0);
  const y = Number(g.y || 0);
  const w = Math.max(0, Number(g.width || 0));
  const h = Math.max(0, Number(g.height || 0));
  if (w <= 0 || h <= 0) return false;

  const inBounds = pointInRectBounds(x, y, w, h, px, py);
  if (!inBounds && !nodeHasRenderableStroke(node)) return false;

  if (node.kind === "group") {
    if (!hasVisiblePaint(node.style?.fill) && !nodeHasRenderableStroke(node)) return inBounds;
  }

  if (node.kind === "image") {
    const hasImage = String(node.image_src || "").trim().length > 0;
    if (!hasImage && !hasVisiblePaint(node.style?.fill) && !nodeHasRenderableStroke(node)) return false;
    // An image fills its whole frame, so the entire box must be selectable.
    // Previously this fell through to stroke-only hit-testing, leaving the image
    // interior as a dead zone — clicking the logo/photo body usually missed.
    if (hasImage) return inBounds;
  }

  if (node.kind === "text") {
    if (!String(node.text || "").trim()) return false;
    return inBounds;
  }

  const shapeType = String(node.style?.shape_type || "").toLowerCase();
  if (shapeType === "ellipse") {
    if (hasVisiblePaint(node.style?.fill) && pointInEllipseFill(node, px, py)) return true;
    return pointNearEllipseStroke(node, px, py, viewportScale);
  }

  // Rect/group/frame are selectable across their whole bounds (Canva-like), even
  // with a transparent fill, so card outlines and no-fill shapes don't have a dead
  // interior. Ellipse/line/path keep their precise hit-testing above.
  if (
    hasVisiblePaint(node.style?.fill)
    || node.kind === "frame"
    || node.kind === "rect"
    || node.kind === "group"
  ) {
    return inBounds;
  }
  return pointNearRectStroke(node, px, py, viewportScale);
}

function pointToSegmentDistanceSquared(
  px: number,
  py: number,
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  if (len2 <= 0.0001) {
    const dx = px - a.x;
    const dy = py - a.y;
    return dx * dx + dy * dy;
  }
  const t = Math.max(0, Math.min(1, ((px - a.x) * vx + (py - a.y) * vy) / len2));
  const cxp = a.x + t * vx;
  const cyp = a.y + t * vy;
  const dx = px - cxp;
  const dy = py - cyp;
  return dx * dx + dy * dy;
}

function pointInRotatedNode(node: PinselaNode, px: number, py: number, viewportScale = 1): boolean {
  const g = node.geometry;
  void g;
  if (node.kind === "line") {
    if (!hasVisibleOpacity(node) || !nodeHasRenderableStroke(node)) return false;
    const radius = lineHitRadius(node, viewportScale);
    const { start, end } = lineEndpoints(node);
    return pointToSegmentDistanceSquared(px, py, start, end) <= radius * radius;
  }
  if (node.kind === "path") {
    return pointInPathNode(node, px, py, viewportScale);
  }
  const localPoint = unrotatePointForNode(node, px, py);
  return pointInRenderableBoxNode(node, localPoint.x, localPoint.y, viewportScale);
}

function expandedHitBox(node: PinselaNode, box: { x: number; y: number; w: number; h: number }) {
  if (node.kind !== "line" && node.kind !== "path") return box;
  const pad = Math.max(1, Math.ceil(node.kind === "line" ? lineHitRadius(node, 1) : pathHitRadius(node, 1)));
  return {
    x: box.x - pad,
    y: box.y - pad,
    w: Math.max(0, box.w) + pad * 2,
    h: Math.max(0, box.h) + pad * 2,
  };
}

function intersectsRect(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number }
): boolean {
  const ax2 = a.x + a.w;
  const ay2 = a.y + a.h;
  const bx2 = b.x + b.w;
  const by2 = b.y + b.h;
  return !(ax2 < b.x || bx2 < a.x || ay2 < b.y || by2 < a.y);
}

function cellKey(cx: number, cy: number): string {
  return `${cx}:${cy}`;
}

function indexCell(px: number): number {
  return Math.floor(Number(px || 0) / HIT_TEST_CELL_SIZE);
}

function insertNodeIntoCells(cells: Map<string, number[]>, nodeIndex: number, box: { x: number; y: number; w: number; h: number }): void {
  const minX = indexCell(box.x);
  const maxX = indexCell(box.x + box.w);
  const minY = indexCell(box.y);
  const maxY = indexCell(box.y + box.h);
  for (let cx = minX; cx <= maxX; cx += 1) {
    for (let cy = minY; cy <= maxY; cy += 1) {
      const key = cellKey(cx, cy);
      const arr = cells.get(key);
      if (arr) {
        arr.push(nodeIndex);
      } else {
        cells.set(key, [nodeIndex]);
      }
    }
  }
}

function compareHitNodePriority(
  a: PinselaNode,
  b: PinselaNode,
  sourceOrder: Map<string, number>,
): number {
  const aIsGroup = a.kind === "group";
  const bIsGroup = b.kind === "group";
  if (aIsGroup !== bIsGroup) {
    return aIsGroup ? 1 : -1;
  }
  const az = Number(a.geometry.z_index || 0);
  const bz = Number(b.geometry.z_index || 0);
  if (az !== bz) return bz - az;
  return Number(sourceOrder.get(b.id) || 0) - Number(sourceOrder.get(a.id) || 0);
}

function orderedHitNodes(doc: PinselaTemplateDocV1, includeLocked: boolean): PinselaNode[] {
  const sourceOrder = new Map(doc.nodes.map((node, idx) => [node.id, idx] as const));
  return [...doc.nodes]
    .filter((n) => n.id !== doc.root_id)
    .filter((n) => n.style.visible !== false)
    .filter((n) => includeLocked || !n.style.locked)
    .sort((a, b) => compareHitNodePriority(a, b, sourceOrder));
}

function buildSpatialIndex(doc: PinselaTemplateDocV1, includeLocked: boolean): SpatialIndex {
  const nodes = orderedHitNodes(doc, includeLocked);

  const cells = new Map<string, number[]>();
  const boxes: Array<{ x: number; y: number; w: number; h: number }> = [];
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    const box = expandedHitBox(node, aabbWithRotation(node));
    boxes.push(box);
    if (box.w <= 0 || box.h <= 0) continue;
    insertNodeIntoCells(cells, i, box);
  }
  return { nodes, boxes, cells };
}

function getSpatialIndex(doc: PinselaTemplateDocV1, includeLocked: boolean): SpatialIndex {
  let cached = spatialIndexCache.get(doc);
  if (!cached) {
    cached = {
      locked: buildSpatialIndex(doc, true),
      unlocked: buildSpatialIndex(doc, false),
    };
    spatialIndexCache.set(doc, cached);
  }
  return includeLocked ? cached.locked : cached.unlocked;
}

export function hitTestAll(
  doc: PinselaTemplateDocV1,
  px: number,
  py: number,
  opts?: HitTestOptions
): PinselaNode[] {
  const includeLocked = !!opts?.includeLocked;
  const viewportScale = normalizeViewportScale(opts?.viewportScale);
  const useSpatialIndex = Math.abs(viewportScale - 1) < 0.0001;
  if (!useSpatialIndex) {
    const nodes = orderedHitNodes(doc, includeLocked);
    const out: PinselaNode[] = [];
    for (const node of nodes) {
      if (pointInRotatedNode(node, px, py, viewportScale)) out.push(node);
    }
    return out;
  }

  const spatial = getSpatialIndex(doc, includeLocked);
  const key = cellKey(indexCell(px), indexCell(py));
  const idxs = spatial.cells.get(key) || [];
  if (!idxs.length) return [];
  const out: PinselaNode[] = [];
  for (const idx of idxs) {
    const node = spatial.nodes[idx];
    if (!node) continue;
    const box = spatial.boxes[idx];
    if (box && (px < box.x || px > box.x + box.w || py < box.y || py > box.y + box.h)) continue;
    if (pointInRotatedNode(node, px, py, viewportScale)) out.push(node);
  }
  return out;
}

export function queryNodesInRect(
  doc: PinselaTemplateDocV1,
  rect: { x: number; y: number; w: number; h: number },
  opts?: { includeLocked?: boolean }
): PinselaNode[] {
  const includeLocked = !!opts?.includeLocked;
  const spatial = getSpatialIndex(doc, includeLocked);
  const minX = indexCell(rect.x);
  const maxX = indexCell(rect.x + rect.w);
  const minY = indexCell(rect.y);
  const maxY = indexCell(rect.y + rect.h);
  const candidateIndexes = new Set<number>();
  for (let cx = minX; cx <= maxX; cx += 1) {
    for (let cy = minY; cy <= maxY; cy += 1) {
      const key = cellKey(cx, cy);
      const idxs = spatial.cells.get(key);
      if (!idxs) continue;
      for (const idx of idxs) candidateIndexes.add(idx);
    }
  }
  if (!candidateIndexes.size) return [];
  const orderedIndexes = [...candidateIndexes].sort((a, b) => a - b);
  const out: PinselaNode[] = [];
  for (const idx of orderedIndexes) {
    const box = spatial.boxes[idx];
    if (!box || box.w <= 0 || box.h <= 0) continue;
    if (!intersectsRect(rect, box)) continue;
    const node = spatial.nodes[idx];
    if (node) out.push(node);
  }
  return out;
}

export function hitTestTop(
  doc: PinselaTemplateDocV1,
  px: number,
  py: number,
  opts?: HitTestOptions
): PinselaNode | null {
  const all = hitTestAll(doc, px, py, opts);
  return all[0] || null;
}

export function cycleHitUnderCursor(
  doc: PinselaTemplateDocV1,
  px: number,
  py: number,
  currentId: string | null
): PinselaNode | null {
  const all = hitTestAll(doc, px, py, { includeLocked: false });
  if (!all.length) return null;
  if (!currentId) return all[0];
  const idx = all.findIndex((n) => n.id === currentId);
  if (idx < 0) return all[0];
  return all[(idx + 1) % all.length];
}
