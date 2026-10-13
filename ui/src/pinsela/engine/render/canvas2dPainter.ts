import type { DirtyRegion, SceneSnapshot, SceneSnapshotNode } from "./types";
import { getPathFillRule, getPathSubpaths } from "../../core/pathData";
import { dashPresetToSegments, normalizeStrokeStackFromNode } from "../../core/strokes";
import {
  buildCanvasFontFromTextStyle,
  layoutRichTextLines,
  normalizeTextStyle,
  resolveTextModel,
} from "../../core/textModels";

type Scene2DContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type ScenePaint = string | CanvasGradient | CanvasPattern;
type GradientKind = "linear" | "radial";

type NormalizedGradientStop = {
  offset: number;
  color: string;
};

type NormalizedGradientPaint = {
  gradient_type: GradientKind;
  angle: number;
  stops: NormalizedGradientStop[];
};

function rgba(fill: any, fallback = "rgba(0,0,0,1)"): string {
  if (!fill) return fallback;
  if (typeof fill === "string") return fill;
  if (typeof fill === "object") {
    if (isGradientPaint(fill)) return fallback;
    const r = Number(fill.r ?? 0);
    const g = Number(fill.g ?? 0);
    const b = Number(fill.b ?? 0);
    const a = Number(fill.a ?? 1);
    if (r <= 1 && g <= 1 && b <= 1) {
      return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a})`;
    }
    return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a})`;
  }
  return fallback;
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
}

function isGradientPaint(raw: unknown): raw is Record<string, unknown> {
  if (!raw || typeof raw !== "object") return false;
  const candidate = raw as Record<string, unknown>;
  if (!Array.isArray(candidate.stops)) return false;
  const typeName = String(candidate.type || "").toLowerCase();
  return typeName === "gradient" || typeof candidate.gradient_type === "string";
}

function normalizeGradientStops(rawStops: unknown, fallbackColor: string): NormalizedGradientStop[] {
  const list = Array.isArray(rawStops) ? rawStops : [];
  const normalized = list
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const stop = entry as Record<string, unknown>;
      return {
        offset: clamp01(Number(stop.offset ?? 0)),
        color: rgba(stop.color, fallbackColor),
      };
    })
    .filter(Boolean) as NormalizedGradientStop[];

  normalized.sort((a, b) => a.offset - b.offset);
  if (normalized.length >= 2) return normalized;
  if (normalized.length === 1) {
    const anchor = normalized[0];
    return [anchor, { offset: anchor.offset >= 0.5 ? 0 : 1, color: fallbackColor }];
  }
  return [
    { offset: 0, color: fallbackColor },
    { offset: 1, color: fallbackColor },
  ];
}

function normalizeGradientPaint(raw: unknown, fallbackColor: string): NormalizedGradientPaint | null {
  if (!isGradientPaint(raw)) return null;
  const gradientType = String(raw.gradient_type || "linear").toLowerCase() === "radial" ? "radial" : "linear";
  const rawAngle = Number(raw.angle);
  const angle = Number.isFinite(rawAngle) ? rawAngle : 90;
  return {
    gradient_type: gradientType,
    angle: ((angle % 360) + 360) % 360,
    stops: normalizeGradientStops(raw.stops, fallbackColor),
  };
}

function createGradientForBounds(
  ctx: Scene2DContext,
  bounds: { x: number; y: number; width: number; height: number },
  gradient: NormalizedGradientPaint,
): CanvasGradient {
  const width = Math.max(1, Number(bounds.width || 0));
  const height = Math.max(1, Number(bounds.height || 0));
  const x = Number(bounds.x || 0);
  const y = Number(bounds.y || 0);
  const cx = x + width / 2;
  const cy = y + height / 2;

  if (gradient.gradient_type === "radial") {
    const radius = Math.max(1, Math.max(width, height) / 2);
    const radial = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    for (const stop of gradient.stops) {
      radial.addColorStop(stop.offset, stop.color);
    }
    return radial;
  }

  const radians = (gradient.angle * Math.PI) / 180;
  const dx = Math.sin(radians);
  const dy = -Math.cos(radians);
  // Project the box onto the gradient direction so stops 0..1 land exactly on the
  // box edges along the angle (CSS linear-gradient model). The old hypot()/2 used the
  // diagonal, pushing the end stops outside the box → washed-out / "leaking" gradient.
  const halfSpan = Math.max(1, (Math.abs(width * dx) + Math.abs(height * dy)) / 2);
  const linear = ctx.createLinearGradient(
    cx - dx * halfSpan,
    cy - dy * halfSpan,
    cx + dx * halfSpan,
    cy + dy * halfSpan,
  );
  for (const stop of gradient.stops) {
    linear.addColorStop(stop.offset, stop.color);
  }
  return linear;
}

function resolvePaintStyle(
  ctx: Scene2DContext,
  rawPaint: unknown,
  bounds: { x: number; y: number; width: number; height: number },
  fallback: string,
): ScenePaint {
  const gradient = normalizeGradientPaint(rawPaint, fallback);
  if (gradient) return createGradientForBounds(ctx, bounds, gradient);
  return rgba(rawPaint, fallback);
}

function lineBounds(node: SceneSnapshotNode): { x: number; y: number; width: number; height: number } {
  const g = node.geometry;
  const x1 = Number(g.x || 0);
  const y1 = Number(g.y || 0);
  const x2 = x1 + Number(g.width || 0);
  const y2 = y1 + Number(g.height || 0);
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.max(1, Math.abs(x2 - x1)),
    height: Math.max(1, Math.abs(y2 - y1)),
  };
}

function roundedRectPath(ctx: Scene2DContext, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

function guideTone(source: "page" | "object" | "grid"): {
  line: string;
  glow: string;
  labelFill: string;
  labelText: string;
  dash: number[];
} {
  if (source === "page") {
    return {
      line: "rgba(41, 121, 255, 0.96)",
      glow: "rgba(41, 121, 255, 0.24)",
      labelFill: "rgba(15, 23, 42, 0.84)",
      labelText: "rgba(248, 250, 252, 0.96)",
      dash: [],
    };
  }
  if (source === "grid") {
    return {
      line: "rgba(198, 137, 50, 0.94)",
      glow: "rgba(198, 137, 50, 0.2)",
      labelFill: "rgba(120, 53, 15, 0.88)",
      labelText: "rgba(255, 247, 237, 0.96)",
      dash: [5, 5],
    };
  }
  return {
    line: "rgba(37, 99, 235, 0.96)",
    glow: "rgba(37, 99, 235, 0.22)",
    labelFill: "rgba(37, 99, 235, 0.9)",
    labelText: "rgba(255, 255, 255, 0.98)",
    dash: [],
  };
}

function guideLabel(
  guide: { axis: "x" | "y"; value: number; source: "page" | "object" | "grid" },
  canvasWidth: number,
  canvasHeight: number,
): string {
  if (guide.source === "grid") return "GRID";
  if (guide.source === "object") return "OBJECT";
  const center = guide.axis === "x" ? canvasWidth / 2 : canvasHeight / 2;
  if (Math.abs(Number(guide.value || 0) - center) <= 0.5) return "CENTER";
  return guide.axis === "x" ? "SIDE" : "EDGE";
}

function drawGuideBadge(
  ctx: Scene2DContext,
  guide: { axis: "x" | "y"; value: number; source: "page" | "object" | "grid" },
  canvasWidth: number,
  canvasHeight: number,
): void {
  const tone = guideTone(guide.source);
  const label = guideLabel(guide, canvasWidth, canvasHeight);
  const badgeHeight = 22;
  const paddingX = 9;
  const margin = 10;
  ctx.save();
  ctx.font = '700 11px "DM Sans", "Inter", sans-serif';
  const badgeWidth = Math.max(58, Math.ceil(ctx.measureText(label).width + paddingX * 2));
  const rawX = guide.axis === "x" ? guide.value - badgeWidth / 2 : margin;
  const rawY = guide.axis === "y" ? guide.value - badgeHeight / 2 : margin;
  const x = Math.max(margin, Math.min(canvasWidth - badgeWidth - margin, rawX));
  const y = Math.max(margin, Math.min(canvasHeight - badgeHeight - margin, rawY));
  roundedRectPath(ctx, x, y, badgeWidth, badgeHeight, badgeHeight / 2);
  ctx.fillStyle = tone.labelFill;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = tone.glow;
  ctx.stroke();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = tone.labelText;
  ctx.fillText(label, x + badgeWidth / 2, y + badgeHeight / 2 + 0.2);
  ctx.restore();
}

function ellipsePath(ctx: Scene2DContext, x: number, y: number, w: number, h: number) {
  const rx = Math.max(0, Math.abs(Number(w || 0)) / 2);
  const ry = Math.max(0, Math.abs(Number(h || 0)) / 2);
  ctx.beginPath();
  ctx.ellipse(x + Number(w || 0) / 2, y + Number(h || 0) / 2, rx, ry, 0, 0, Math.PI * 2);
  ctx.closePath();
}

function polygonPath(ctx: Scene2DContext, x: number, y: number, w: number, h: number, sides: number) {
  const count = Math.max(3, Math.round(Number(sides || 6)));
  const cx = x + Number(w || 0) / 2;
  const cy = y + Number(h || 0) / 2;
  const rx = Math.max(0.5, Math.abs(Number(w || 0)) / 2);
  const ry = Math.max(0.5, Math.abs(Number(h || 0)) / 2);
  ctx.beginPath();
  for (let i = 0; i < count; i += 1) {
    const angle = -Math.PI / 2 + (i * Math.PI * 2) / count;
    const px = cx + Math.cos(angle) * rx;
    const py = cy + Math.sin(angle) * ry;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function starPath(
  ctx: Scene2DContext,
  x: number,
  y: number,
  w: number,
  h: number,
  points: number,
  innerRatio: number,
) {
  const pointCount = Math.max(4, Math.round(Number(points || 5)));
  const ratio = clampRange(Number(innerRatio), 0.05, 0.95, 0.46);
  const cx = x + Number(w || 0) / 2;
  const cy = y + Number(h || 0) / 2;
  const outerRx = Math.max(0.5, Math.abs(Number(w || 0)) / 2);
  const outerRy = Math.max(0.5, Math.abs(Number(h || 0)) / 2);
  const innerRx = outerRx * ratio;
  const innerRy = outerRy * ratio;
  ctx.beginPath();
  for (let i = 0; i < pointCount * 2; i += 1) {
    const outer = i % 2 === 0;
    const radiusX = outer ? outerRx : innerRx;
    const radiusY = outer ? outerRy : innerRy;
    const angle = -Math.PI / 2 + (i * Math.PI) / pointCount;
    const px = cx + Math.cos(angle) * radiusX;
    const py = cy + Math.sin(angle) * radiusY;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function rectShapeType(node: SceneSnapshotNode): "rect" | "ellipse" | "polygon" | "star" {
  if (node.kind !== "rect") return "rect";
  const raw = String((node.style as any)?.shape_type || "").toLowerCase();
  if (raw === "ellipse" || raw === "polygon" || raw === "star") return raw;
  return "rect";
}

function shapePath(ctx: Scene2DContext, node: SceneSnapshotNode): void {
  const g = node.geometry;
  const shapeType = rectShapeType(node);
  if (shapeType === "ellipse") {
    ellipsePath(ctx, g.x, g.y, g.width, g.height);
    return;
  }
  if (shapeType === "polygon") {
    polygonPath(ctx, g.x, g.y, g.width, g.height, Number((node.style as any)?.shape_sides || 6));
    return;
  }
  if (shapeType === "star") {
    starPath(
      ctx,
      g.x,
      g.y,
      g.width,
      g.height,
      Number((node.style as any)?.star_points || 5),
      Number((node.style as any)?.star_inner_ratio || 0.46),
    );
    return;
  }
  roundedRectPath(ctx, g.x, g.y, g.width, g.height, Number(g.corner_radius || 0));
}

function readGeometryTransformMatrix(
  geometry: SceneSnapshotNode["geometry"] | null | undefined,
): { a: number; b: number; c: number; d: number; e: number; f: number } | null {
  const raw = geometry?.transform_matrix;
  if (!raw || typeof raw !== "object") return null;
  const a = Number((raw as Record<string, unknown>).a);
  const b = Number((raw as Record<string, unknown>).b);
  const c = Number((raw as Record<string, unknown>).c);
  const d = Number((raw as Record<string, unknown>).d);
  const e = Number((raw as Record<string, unknown>).e);
  const f = Number((raw as Record<string, unknown>).f);
  if (![a, b, c, d, e, f].every(Number.isFinite)) return null;
  if (
    Math.abs(a - 1) <= 0.0001
    && Math.abs(b) <= 0.0001
    && Math.abs(c) <= 0.0001
    && Math.abs(d - 1) <= 0.0001
    && Math.abs(e) <= 0.0001
    && Math.abs(f) <= 0.0001
  ) {
    return null;
  }
  return { a, b, c, d, e, f };
}

function applyGeometryCanvasTransform(ctx: Scene2DContext, geometry: SceneSnapshotNode["geometry"]): void {
  const matrix = readGeometryTransformMatrix(geometry);
  if (matrix) {
    ctx.transform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f);
    return;
  }
  if (Number(geometry.rotation || 0)) {
    const cx = Number(geometry.x || 0) + Number(geometry.width || 0) / 2;
    const cy = Number(geometry.y || 0) + Number(geometry.height || 0) / 2;
    ctx.translate(cx, cy);
    ctx.rotate((Number(geometry.rotation || 0) * Math.PI) / 180);
    ctx.translate(-cx, -cy);
  }
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

function readPathSubpaths(node: SceneSnapshotNode): ResolvedPathSubpath[] {
  if (node.kind !== "path") return [];
  const g = node.geometry;
  return getPathSubpaths((node as any).path_data || null).map((subpath) => ({
    closed: subpath.closed !== false,
    anchors: subpath.points.map((point) => ({
      x: Number(g.x || 0) + Number(point?.x || 0),
      y: Number(g.y || 0) + Number(point?.y || 0),
      in: point?.in
        ? {
            x: Number(g.x || 0) + Number(point.in.x || 0),
            y: Number(g.y || 0) + Number(point.in.y || 0),
          }
        : null,
      out: point?.out
        ? {
            x: Number(g.x || 0) + Number(point.out.x || 0),
            y: Number(g.y || 0) + Number(point.out.y || 0),
          }
        : null,
    })),
  })).filter((subpath) => subpath.anchors.length >= 2);
}

function hasPathHandle(anchor: PathAnchorPoint, handle: PathAnchorPoint["in"] | PathAnchorPoint["out"]): handle is { x: number; y: number } {
  if (!handle) return false;
  return Math.abs(Number(handle.x || 0) - Number(anchor.x || 0)) > 0.0001
    || Math.abs(Number(handle.y || 0) - Number(anchor.y || 0)) > 0.0001;
}

function appendPathSegment(ctx: Scene2DContext, from: PathAnchorPoint, to: PathAnchorPoint) {
  const cp1 = hasPathHandle(from, from.out) ? from.out : null;
  const cp2 = hasPathHandle(to, to.in) ? to.in : null;
  if (cp1 || cp2) {
    ctx.bezierCurveTo(
      cp1 ? cp1.x : from.x,
      cp1 ? cp1.y : from.y,
      cp2 ? cp2.x : to.x,
      cp2 ? cp2.y : to.y,
      to.x,
      to.y,
    );
    return;
  }
  ctx.lineTo(to.x, to.y);
}

function buildPathNodePath(
  ctx: Scene2DContext,
  node: SceneSnapshotNode,
): { arrowAnchors: PathAnchorPoint[]; closed: boolean; hasClosedFill: boolean; valid: boolean; fillRule: CanvasFillRule } {
  const subpaths = readPathSubpaths(node);
  if (!subpaths.length) return { arrowAnchors: [], closed: false, hasClosedFill: false, valid: false, fillRule: "nonzero" };
  ctx.beginPath();
  let hasClosedFill = false;
  for (const subpath of subpaths) {
    const anchors = subpath.anchors;
    if (anchors.length < 2) continue;
    const closed = subpath.closed && anchors.length >= 3;
    if (closed) hasClosedFill = true;
    ctx.moveTo(anchors[0].x, anchors[0].y);
    for (let idx = 1; idx < anchors.length; idx += 1) {
      appendPathSegment(ctx, anchors[idx - 1], anchors[idx]);
    }
    if (closed) {
      appendPathSegment(ctx, anchors[anchors.length - 1], anchors[0]);
      ctx.closePath();
    }
  }
  const arrowSubpath = subpaths.length === 1 ? subpaths[0] : null;
  return {
    arrowAnchors: arrowSubpath?.anchors || [],
    closed: Boolean(arrowSubpath?.closed && (arrowSubpath?.anchors.length || 0) >= 3),
    hasClosedFill,
    valid: true,
    fillRule: getPathFillRule((node as any).path_data || null),
  };
}

function appendClipNodePath(
  ctx: Scene2DContext,
  node: SceneSnapshotNode,
): CanvasFillRule | null {
  if (node.kind === "path") {
    const built = buildPathNodePath(ctx, node);
    return built.valid ? built.fillRule : null;
  }
  if (node.kind === "line") {
    const g = node.geometry;
    ctx.beginPath();
    ctx.moveTo(Number(g.x || 0), Number(g.y || 0));
    ctx.lineTo(Number(g.x || 0) + Number(g.width || 0), Number(g.y || 0) + Number(g.height || 0));
    return "nonzero";
  }
  shapePath(ctx, node);
  return "nonzero";
}

function drawArrowHead(
  ctx: Scene2DContext,
  tipX: number,
  tipY: number,
  dirX: number,
  dirY: number,
  size: number,
  wing: number,
  color: ScenePaint,
) {
  const perpX = -dirY;
  const perpY = dirX;
  const baseX = tipX - dirX * size;
  const baseY = tipY - dirY * size;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(baseX + perpX * wing, baseY + perpY * wing);
  ctx.lineTo(baseX - perpX * wing, baseY - perpY * wing);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function drawLineArrowheads(
  ctx: Scene2DContext,
  geometry: SceneSnapshotNode["geometry"],
  strokeSpec: Record<string, unknown> | null,
  strokePaint: ScenePaint,
  strokeWidth: number,
) {
  const lineKind = String(strokeSpec?.line_kind || "").toLowerCase();
  const arrowAtEnd = lineKind === "arrow" || lineKind === "arrow_end";
  const arrowAtStart = lineKind === "arrow_start" || lineKind === "arrow_both" || lineKind === "arrow_double";
  if (!arrowAtEnd && !arrowAtStart) return;
  const x1 = Number(geometry.x || 0);
  const y1 = Number(geometry.y || 0);
  const x2 = x1 + Number(geometry.width || 0);
  const y2 = y1 + Number(geometry.height || 0);
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len <= 0.0001) return;
  const ux = dx / len;
  const uy = dy / len;
  const size = Math.max(8, Number(strokeWidth || 1) * 3.25);
  const wing = Math.max(3.5, size * 0.52);

  ctx.save();
  ctx.setLineDash([]);
  if (arrowAtEnd) {
    drawArrowHead(ctx, x2, y2, ux, uy, size, wing, strokePaint);
  }
  if (arrowAtStart) {
    drawArrowHead(ctx, x1, y1, -ux, -uy, size, wing, strokePaint);
  }
  ctx.restore();
}

function normalizeDirection(dx: number, dy: number): { x: number; y: number } | null {
  const len = Math.hypot(dx, dy);
  if (len <= 0.0001) return null;
  return { x: dx / len, y: dy / len };
}

function drawPathArrowheads(
  ctx: Scene2DContext,
  anchors: PathAnchorPoint[],
  closed: boolean,
  strokeSpec: Record<string, unknown> | null,
  strokePaint: ScenePaint,
  strokeWidth: number,
) {
  if (closed || anchors.length < 2) return;
  const lineKind = String(strokeSpec?.line_kind || "").toLowerCase();
  const arrowAtEnd = lineKind === "arrow" || lineKind === "arrow_end";
  const arrowAtStart = lineKind === "arrow_start" || lineKind === "arrow_both" || lineKind === "arrow_double";
  if (!arrowAtEnd && !arrowAtStart) return;

  const first = anchors[0];
  const second = anchors[1];
  const last = anchors[anchors.length - 1];
  const prev = anchors[anchors.length - 2];

  const startDirRaw = first.out
    ? { dx: first.out.x - first.x, dy: first.out.y - first.y }
    : { dx: second.x - first.x, dy: second.y - first.y };
  const endDirRaw = last.in
    ? { dx: last.x - last.in.x, dy: last.y - last.in.y }
    : { dx: last.x - prev.x, dy: last.y - prev.y };

  const startDir = normalizeDirection(startDirRaw.dx, startDirRaw.dy);
  const endDir = normalizeDirection(endDirRaw.dx, endDirRaw.dy);
  if (!startDir && !endDir) return;

  const size = Math.max(8, Number(strokeWidth || 1) * 3.25);
  const wing = Math.max(3.5, size * 0.52);

  ctx.save();
  ctx.setLineDash([]);
  if (arrowAtEnd && endDir) {
    drawArrowHead(ctx, last.x, last.y, endDir.x, endDir.y, size, wing, strokePaint);
  }
  if (arrowAtStart && startDir) {
    drawArrowHead(ctx, first.x, first.y, -startDir.x, -startDir.y, size, wing, strokePaint);
  }
  ctx.restore();
}

function getFont(node: SceneSnapshotNode, fontSizeOverride?: number): string {
  return buildCanvasFontFromTextStyle({
    ...(node.text_style || {}),
    ...(fontSizeOverride != null ? { size: Math.max(1, Number(fontSizeOverride || 24)) } : {}),
  });
}

function measureTextWidth(
  ctx: Scene2DContext,
  text: string,
  cache?: Map<string, number>
): number {
  const key = `${ctx.font}::${text}`;
  if (cache?.has(key)) return Number(cache.get(key) || 0);
  const width = ctx.measureText(text).width;
  if (cache) cache.set(key, width);
  return width;
}

function wrapLines(ctx: Scene2DContext, text: string, maxWidth: number, textMetricsCache?: Map<string, number>): string[] {
  const parts = text.split(/\n/g);
  const out: string[] = [];
  const widthLimit = Number.isFinite(maxWidth) && maxWidth > 0 ? maxWidth : Number.POSITIVE_INFINITY;
  for (const part of parts) {
    const tokens = String(part || "").match(/\s+|\S+/g);
    if (!tokens || !tokens.length) {
      out.push("");
      continue;
    }
    let cur = "";
    for (const token of tokens) {
      if (!cur && measureTextWidth(ctx, token, textMetricsCache) <= widthLimit) {
        cur = token;
        continue;
      }

      const candidate = `${cur}${token}`;
      if (cur && measureTextWidth(ctx, candidate, textMetricsCache) <= widthLimit) {
        cur = candidate;
        continue;
      }

      if (cur) {
        out.push(cur);
        cur = "";
      }

      if (measureTextWidth(ctx, token, textMetricsCache) <= widthLimit) {
        cur = token;
        continue;
      }

      for (const ch of token) {
        const chunk = `${cur}${ch}`;
        if (!cur || measureTextWidth(ctx, chunk, textMetricsCache) <= widthLimit) {
          cur = chunk;
        } else {
          out.push(cur);
          cur = ch;
        }
      }
    }
    out.push(cur);
  }
  return out;
}

function cubicPoint(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  t: number
) {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;
  return {
    x: mt2 * mt * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t2 * t * p3.x,
    y: mt2 * mt * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t2 * t * p3.y,
  };
}

type TextStrokeStyle = {
  paint: ScenePaint;
  width: number;
  dash: number[];
};

function drawTextOnPath(
  ctx: Scene2DContext,
  node: SceneSnapshotNode,
  text: string,
  fontStr: string,
  fillStyle: ScenePaint,
  strokeStyle: TextStrokeStyle | null = null,
) {
  const path = node.text_path;
  if (!path) return;
  const g = node.geometry;
  const hasStroke = !!strokeStyle && Number(strokeStyle.width) > 0;
  ctx.save();
  ctx.font = fontStr;
  ctx.fillStyle = fillStyle;
  if (hasStroke && strokeStyle) {
    ctx.strokeStyle = strokeStyle.paint;
    ctx.lineWidth = Math.max(1, Number(strokeStyle.width || 0));
    ctx.setLineDash(Array.isArray(strokeStyle.dash) ? strokeStyle.dash : []);
    ctx.lineJoin = "round";
    ctx.miterLimit = 2;
  }

  if (path.type === "arc") {
    const radius = Math.max(1, Number(path.radius || Math.min(g.width, g.height) / 2));
    const startAngle = Number(path.start_angle ?? -90);
    const sweep = Number(path.sweep_angle ?? 180);
    const clockwise = path.clockwise !== false;
    const cx = g.x + g.width / 2;
    const cy = g.y + g.height / 2;
    const chars = [...text];
    const n = Math.max(1, chars.length - 1);
    for (let i = 0; i < chars.length; i += 1) {
      const ratio = n === 0 ? 0 : i / n;
      const angle = (startAngle + (clockwise ? 1 : -1) * sweep * ratio) * (Math.PI / 180);
      const x = cx + Math.cos(angle) * radius;
      const y = cy + Math.sin(angle) * radius;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle + Math.PI / 2);
      ctx.fillText(chars[i], 0, 0);
      if (hasStroke) ctx.strokeText(chars[i], 0, 0);
      ctx.restore();
    }
    ctx.restore();
    return;
  }

  const points = Array.isArray(path.points) ? path.points : [];
  if (points.length < 4) {
    ctx.restore();
    return;
  }
  const p0 = points[0];
  const p1 = points[1];
  const p2 = points[2];
  const p3 = points[3];
  const chars = [...text];
  const n = Math.max(1, chars.length);
  for (let i = 0; i < chars.length; i += 1) {
    const t = n <= 1 ? 0 : i / (n - 1);
    const p = cubicPoint(p0, p1, p2, p3, t);
    const pNext = cubicPoint(p0, p1, p2, p3, Math.min(1, t + 0.002));
    const angle = Math.atan2(pNext.y - p.y, pNext.x - p.x);
    ctx.save();
    ctx.translate(g.x + p.x, g.y + p.y);
    ctx.rotate(angle);
    ctx.fillText(chars[i], 0, 0);
    if (hasStroke) ctx.strokeText(chars[i], 0, 0);
    ctx.restore();
  }
  ctx.restore();
}

function drawTextFitted(
  ctx: Scene2DContext,
  node: SceneSnapshotNode,
  textMetricsCache?: Map<string, number>,
  textStrokeStyle: TextStrokeStyle | null = null,
) {
  const text = String(node.text || "");
  if (!text.trim()) return;
  const g = node.geometry;
  const textModel = resolveTextModel(node);
  if (textModel === "rich" && !node.text_path) {
    const normalizedBaseStyle = normalizeTextStyle(node.text_style);
    const lines = layoutRichTextLines(ctx, {
      text,
      baseStyle: normalizedBaseStyle,
      textRuns: node.text_runs,
      width: g.width,
      height: g.height,
    }, textMetricsCache);
    if (!lines.length) return;
    const hasTextStroke = !!textStrokeStyle && Number(textStrokeStyle.width) > 0;
    for (const line of lines) {
      for (const segment of line.segments) {
        if (segment.isWhitespace || !segment.text) continue;
        ctx.font = buildCanvasFontFromTextStyle(segment.style);
        const fillColor = resolvePaintStyle(ctx, segment.style.color ?? normalizedBaseStyle.color ?? node.style.fill, {
          x: Number(g.x || 0),
          y: Number(g.y || 0),
          width: Math.max(1, Number(g.width || 0)),
          height: Math.max(1, Number(g.height || 0)),
        }, "#111111");
        ctx.fillStyle = fillColor;
        if (hasTextStroke && textStrokeStyle) {
          ctx.strokeStyle = textStrokeStyle.paint;
          ctx.lineWidth = Math.max(1, Number(textStrokeStyle.width || 0));
          ctx.setLineDash(Array.isArray(textStrokeStyle.dash) ? textStrokeStyle.dash : []);
          ctx.lineJoin = "round";
          ctx.miterLimit = 2;
        }
        const drawX = g.x + segment.x;
        const baseline = g.y + line.baseline;
        ctx.fillText(segment.text, drawX, baseline);
        if (hasTextStroke) ctx.strokeText(segment.text, drawX, baseline);
        if (segment.style.underline) {
          const size = Math.max(1, Number(segment.style.size || normalizedBaseStyle.size || 24));
          const underlineThickness = Math.max(1, Math.round(size * 0.06));
          const underlineOffset = Math.max(1, Math.round(size * 0.08));
          ctx.save();
          ctx.strokeStyle = fillColor;
          ctx.lineWidth = underlineThickness;
          ctx.lineCap = "butt";
          ctx.beginPath();
          ctx.moveTo(drawX, baseline + underlineOffset);
          ctx.lineTo(drawX + segment.width, baseline + underlineOffset);
          ctx.stroke();
          ctx.restore();
        }
      }
    }
    return;
  }
  const ts = node.text_style || {};
  const fit: any = (node as any).fit || {};

  const startSize = Number(fit.start_size || ts.size || 24);
  const minSize = Number(fit.min_size || Math.max(8, startSize * 0.65));
  const maxLines = Number(fit.max_lines || 0) || undefined;
  const truncate = String(fit.truncate_mode || "none");
  const letterSpacing = Number(ts.letter_spacing || 0);

  let size = startSize;
  let lines: string[] = [];
  while (size >= minSize) {
    ctx.font = getFont(node, size);
    lines = wrapLines(ctx, text, g.width, textMetricsCache);
    const lh = Number(ts.line_height || size * 1.2);
    const lineHeight = String(ts.line_height_unit || "percent") === "percent" ? (size * lh) / 100 : lh;
    // Content height in the SAME leading-trim model used for drawing/auto-hug
    // (ascender + (n-1)*lineHeight + descender), otherwise the hugged box looks
    // like it "doesn't fit" and the text shrinks needlessly.
    const _fm = ctx.measureText("Á�qgjpyhlf");
    const asc = (Number.isFinite(_fm.fontBoundingBoxAscent) && _fm.fontBoundingBoxAscent > 0) ? _fm.fontBoundingBoxAscent : size * 0.82;
    const desc = (Number.isFinite(_fm.fontBoundingBoxDescent) && _fm.fontBoundingBoxDescent > 0) ? _fm.fontBoundingBoxDescent : size * 0.26;
    const fitsHeight = (asc + Math.max(0, lines.length - 1) * lineHeight + desc) <= g.height + 0.5;
    const fitsLines = maxLines ? lines.length <= maxLines : true;
    if (fitsHeight && fitsLines) break;
    size -= 1;
  }

  if (maxLines && lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    if (truncate === "ellipsis" && lines.length) {
      lines[lines.length - 1] = `${lines[lines.length - 1].replace(/[.\s]+$/g, "")}...`;
    }
  }

  ctx.font = getFont(node, size);
  const lh = Number(ts.line_height || size * 1.2);
  const lineHeight = String(ts.line_height_unit || "percent") === "percent" ? (size * lh) / 100 : lh;
  // Leading-trim: 1st baseline at the font ascender (not at 0.82*lineHeight) so the
  // text sticks to the top of the box regardless of line height. Line height =
  // spacing between lines only. Measures with the ctx itself (font already set).
  const _vm = ctx.measureText("Á�qgjpyhlf");
  const textAscent = (Number.isFinite(_vm.fontBoundingBoxAscent) && _vm.fontBoundingBoxAscent > 0)
    ? _vm.fontBoundingBoxAscent : size * 0.82;
  const textDescent = (Number.isFinite(_vm.fontBoundingBoxDescent) && _vm.fontBoundingBoxDescent > 0)
    ? _vm.fontBoundingBoxDescent : size * 0.26;
  const fillColor = resolvePaintStyle(ctx, ts.color ?? node.style.fill, {
    x: Number(g.x || 0),
    y: Number(g.y || 0),
    width: Math.max(1, Number(g.width || 0)),
    height: Math.max(1, Number(g.height || 0)),
  }, "#111111");
  ctx.fillStyle = fillColor;
  const hasTextStroke = !!textStrokeStyle && Number(textStrokeStyle.width) > 0;
  if (hasTextStroke && textStrokeStyle) {
    ctx.strokeStyle = textStrokeStyle.paint;
    ctx.lineWidth = Math.max(1, Number(textStrokeStyle.width || 0));
    ctx.setLineDash(Array.isArray(textStrokeStyle.dash) ? textStrokeStyle.dash : []);
    ctx.lineJoin = "round";
    ctx.miterLimit = 2;
  }

  const align = String(ts.text_align || "left");
  const vAlign = String(ts.vertical_align || "top");
  const underlineEnabled = Boolean((ts as any).underline);
  const underlineThickness = Math.max(1, Math.round(size * 0.06));
  const underlineOffset = Math.max(1, Math.round(size * 0.08));
  const totalH = textAscent + Math.max(0, lines.length - 1) * lineHeight + textDescent;
  let y = g.y;
  if (vAlign === "center") y = g.y + Math.max(0, (g.height - totalH) / 2);
  if (vAlign === "bottom") y = g.y + Math.max(0, g.height - totalH);

  const textPath = node.text_path;
  if (textPath && (textPath.type === "arc" || textPath.type === "bezier")) {
    const line = lines.join(" ").trim();
    if (line) drawTextOnPath(ctx, node, line, String(ctx.font), fillColor, hasTextStroke ? textStrokeStyle : null);
    return;
  }

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    let x = g.x;
    const w = measureTextWidth(ctx, line, textMetricsCache) + Math.max(0, line.length - 1) * letterSpacing;
    const shouldJustify = align === "justify" && lineIndex < lines.length - 1;
    if (!shouldJustify && align === "center") x = g.x + Math.max(0, (g.width - w) / 2);
    if (!shouldJustify && align === "right") x = g.x + Math.max(0, g.width - w);

    if (shouldJustify) {
      const words = line.trim().split(/\s+/).filter(Boolean);
      if (words.length > 1) {
        const baseline = y + textAscent;
        const wordsWidth = words.reduce((acc, word) => (
          acc + measureTextWidth(ctx, word, textMetricsCache) + Math.max(0, word.length - 1) * letterSpacing
        ), 0);
        const gaps = words.length - 1;
        const baseGap = Math.max(0, measureTextWidth(ctx, " ", textMetricsCache) + letterSpacing);
        const naturalWidth = wordsWidth + baseGap * gaps;
        const extraGap = Math.max(0, g.width - naturalWidth) / gaps;
        let cursor = g.x;

        for (let wordIndex = 0; wordIndex < words.length; wordIndex += 1) {
          const word = words[wordIndex];
          if (letterSpacing === 0) {
            ctx.fillText(word, cursor, baseline);
            if (hasTextStroke) ctx.strokeText(word, cursor, baseline);
          } else {
            let charCursor = cursor;
            for (let i = 0; i < word.length; i += 1) {
              const ch = word[i];
              ctx.fillText(ch, charCursor, baseline);
              if (hasTextStroke) ctx.strokeText(ch, charCursor, baseline);
              charCursor += measureTextWidth(ctx, ch, textMetricsCache) + (i < word.length - 1 ? letterSpacing : 0);
            }
          }

          const wordWidth = measureTextWidth(ctx, word, textMetricsCache) + Math.max(0, word.length - 1) * letterSpacing;
          cursor += wordWidth;
          if (wordIndex < words.length - 1) {
            cursor += baseGap + extraGap;
          }
        }
        if (underlineEnabled) {
          ctx.save();
          ctx.strokeStyle = fillColor;
          ctx.lineWidth = underlineThickness;
          ctx.lineCap = "butt";
          ctx.beginPath();
          ctx.moveTo(g.x, baseline + underlineOffset);
          ctx.lineTo(g.x + g.width, baseline + underlineOffset);
          ctx.stroke();
          ctx.restore();
        }
        y += lineHeight;
        continue;
      }
    }

    const baseline = y + textAscent;
    if (letterSpacing === 0) {
      ctx.fillText(line, x, baseline);
      if (hasTextStroke) ctx.strokeText(line, x, baseline);
    } else {
      let cursor = x;
      for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        ctx.fillText(ch, cursor, baseline);
        if (hasTextStroke) ctx.strokeText(ch, cursor, baseline);
        cursor += measureTextWidth(ctx, ch, textMetricsCache) + (i < line.length - 1 ? letterSpacing : 0);
      }
    }
    if (underlineEnabled) {
      ctx.save();
      ctx.strokeStyle = fillColor;
      ctx.lineWidth = underlineThickness;
      ctx.lineCap = "butt";
      ctx.beginPath();
      ctx.moveTo(x, baseline + underlineOffset);
      ctx.lineTo(x + w, baseline + underlineOffset);
      ctx.stroke();
      ctx.restore();
    }
    y += lineHeight;
  }
}

function imageDimensions(image: CanvasImageSource): { width: number; height: number } {
  const raw = image as any;
  const width = Number(raw.naturalWidth || raw.videoWidth || raw.displayWidth || raw.width || 0);
  const height = Number(raw.naturalHeight || raw.videoHeight || raw.displayHeight || raw.height || 0);
  return {
    width: Math.max(1, Math.round(width || 1)),
    height: Math.max(1, Math.round(height || 1)),
  };
}

type RGBChannels = { r: number; g: number; b: number };
type ImageDrawPlacement = {
  dx: number;
  dy: number;
  dw: number;
  dh: number;
  useSourceRect: boolean;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
};
type NormalizedImageDuotone = {
  enabled: boolean;
  amount: number;
  shadows: RGBChannels;
  highlights: RGBChannels;
};

function parseRgbColor(raw: string, fallback: RGBChannels): RGBChannels {
  const hex = parseHexColor(raw);
  if (hex) return hex;
  const rgbMatch = raw.trim().match(/^rgba?\(([^)]+)\)$/i);
  if (!rgbMatch) return fallback;
  const parts = rgbMatch[1]
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((value, index) => index < 3 || Number.isFinite(value));
  if (parts.length < 3 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1]) || !Number.isFinite(parts[2])) {
    return fallback;
  }
  return {
    r: Math.max(0, Math.min(255, Math.round(parts[0]))),
    g: Math.max(0, Math.min(255, Math.round(parts[1]))),
    b: Math.max(0, Math.min(255, Math.round(parts[2]))),
  };
}

function normalizeImageDuotone(raw: unknown): NormalizedImageDuotone {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const shadowFallback = { r: 17, g: 17, b: 20 };
  const highlightFallback = { r: 248, g: 250, b: 252 };
  const shadows = parseRgbColor(rgba(value.shadows, "#111114"), shadowFallback);
  const highlights = parseRgbColor(rgba(value.highlights, "#f8fafc"), highlightFallback);
  return {
    enabled: Boolean(value.enabled),
    amount: clampRange(Number(value.amount), 0, 100, 100),
    shadows,
    highlights,
  };
}

function createRasterContext(width: number, height: number): { canvas: CanvasImageSource; ctx: Scene2DContext } | null {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d");
    if (ctx) return { canvas, ctx };
  }
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (ctx) return { canvas, ctx };
  }
  return null;
}

function drawImagePlacement(
  ctx: Scene2DContext,
  image: CanvasImageSource,
  placement: ImageDrawPlacement,
): void {
  if (placement.useSourceRect) {
    ctx.drawImage(
      image,
      placement.sx,
      placement.sy,
      placement.sw,
      placement.sh,
      placement.dx,
      placement.dy,
      placement.dw,
      placement.dh,
    );
    return;
  }
  ctx.drawImage(image, placement.dx, placement.dy, placement.dw, placement.dh);
}

function applyDuotoneToImageData(
  data: Uint8ClampedArray,
  duotone: NormalizedImageDuotone,
): void {
  const amount = clamp01(duotone.amount / 100);
  if (amount <= 0) return;
  const sr = duotone.shadows.r;
  const sg = duotone.shadows.g;
  const sb = duotone.shadows.b;
  const hr = duotone.highlights.r;
  const hg = duotone.highlights.g;
  const hb = duotone.highlights.b;

  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    if (alpha <= 0) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    const tr = sr + (hr - sr) * luma;
    const tg = sg + (hg - sg) * luma;
    const tb = sb + (hb - sb) * luma;
    data[i] = Math.round(r + (tr - r) * amount);
    data[i + 1] = Math.round(g + (tg - g) * amount);
    data[i + 2] = Math.round(b + (tb - b) * amount);
  }
}

// --- Image fade-to-transparent (mirrors apps/api/pinsela/services/image_fade.py) ---
type NormalizedImageFade = {
  enabled: boolean;
  softness: number;
  linear: { angle: number; start: number; end: number } | null;
  radial: { cx: number; cy: number; inner: number; outer: number } | null;
  edges: { top: number; right: number; bottom: number; left: number };
};

function _fadeNum(v: unknown, d: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function normalizeImageFade(raw: unknown): NormalizedImageFade {
  const v = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const ln = v.linear && typeof v.linear === "object" ? (v.linear as Record<string, unknown>) : null;
  const rd = v.radial && typeof v.radial === "object" ? (v.radial as Record<string, unknown>) : null;
  const ed = (v.edges && typeof v.edges === "object" ? (v.edges as Record<string, unknown>) : {}) as Record<string, unknown>;
  return {
    enabled: Boolean(v.enabled),
    softness: clamp01(_fadeNum(v.softness, 0)),
    linear: ln ? { angle: _fadeNum(ln.angle, 90), start: clamp01(_fadeNum(ln.start, 0)), end: clamp01(_fadeNum(ln.end, 1)) } : null,
    radial: rd
      ? { cx: _fadeNum(rd.cx, 0.5), cy: _fadeNum(rd.cy, 0.5), inner: clamp01(_fadeNum(rd.inner, 0.6)), outer: clamp01(_fadeNum(rd.outer, 1)) }
      : null,
    edges: {
      top: clamp01(_fadeNum(ed.top, 0)),
      right: clamp01(_fadeNum(ed.right, 0)),
      bottom: clamp01(_fadeNum(ed.bottom, 0)),
      left: clamp01(_fadeNum(ed.left, 0)),
    },
  };
}

function imageFadeHasEffect(f: NormalizedImageFade): boolean {
  if (!f.enabled) return false;
  if (f.linear && f.linear.end > f.linear.start) return true;
  if (f.radial && f.radial.outer > f.radial.inner) return true;
  const e = f.edges;
  return e.top > 0 || e.right > 0 || e.bottom > 0 || e.left > 0;
}

function _fadeSmoothstep(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

function _fadeEase(factor: number, softness: number): number {
  const f = factor < 0 ? 0 : factor > 1 ? 1 : factor;
  if (softness <= 0) return f;
  return f * (1 - softness) + _fadeSmoothstep(f) * softness;
}

function applyImageFadeToImageData(
  data: Uint8ClampedArray,
  fade: NormalizedImageFade,
  width: number,
  height: number,
): void {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const ln = fade.linear && fade.linear.end > fade.linear.start ? fade.linear : null;
  const rd = fade.radial && fade.radial.outer > fade.radial.inner ? fade.radial : null;
  const e = fade.edges;
  const lnDx = ln ? Math.cos((ln.angle * Math.PI) / 180) : 0;
  const lnDy = ln ? Math.sin((ln.angle * Math.PI) / 180) : 0;
  const lnLo = ln ? Math.min(0, lnDx) + Math.min(0, lnDy) : 0;
  const lnSpan = ln ? Math.max(0, lnDx) + Math.max(0, lnDy) - lnLo : 1;
  const cx = rd ? rd.cx * w : 0;
  const cy = rd ? rd.cy * h : 0;
  const maxR = rd ? Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy)) : 1;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let factor = 1;
      if (ln) {
        const proj = (x / Math.max(1, w - 1)) * lnDx + (y / Math.max(1, h - 1)) * lnDy;
        const t = lnSpan > 1e-6 ? (proj - lnLo) / lnSpan : 0;
        if (t >= ln.end) factor = 0;
        else if (t > ln.start) factor *= 1 - (t - ln.start) / (ln.end - ln.start);
      }
      if (factor > 0 && rd && maxR > 1e-6) {
        const d = Math.hypot(x - cx, y - cy) / maxR;
        if (d >= rd.outer) factor = 0;
        else if (d > rd.inner) factor *= 1 - (d - rd.inner) / (rd.outer - rd.inner);
      }
      if (factor > 0 && e.top > 0) factor *= Math.min(1, y / (e.top * Math.max(1, h - 1)));
      if (factor > 0 && e.bottom > 0) factor *= Math.min(1, (h - 1 - y) / (e.bottom * Math.max(1, h - 1)));
      if (factor > 0 && e.left > 0) factor *= Math.min(1, x / (e.left * Math.max(1, w - 1)));
      if (factor > 0 && e.right > 0) factor *= Math.min(1, (w - 1 - x) / (e.right * Math.max(1, w - 1)));
      factor = _fadeEase(factor, fade.softness);
      const idx = (y * w + x) * 4 + 3;
      data[idx] = Math.round(data[idx] * (factor < 0 ? 0 : factor > 1 ? 1 : factor));
    }
  }
}

function drawImageWithEffects(
  ctx: Scene2DContext,
  image: CanvasImageSource,
  placement: ImageDrawPlacement,
  duotone: NormalizedImageDuotone,
  fade: NormalizedImageFade,
): void {
  const duoActive = duotone.enabled && duotone.amount > 0;
  const fadeActive = imageFadeHasEffect(fade);
  if (!duoActive && !fadeActive) {
    drawImagePlacement(ctx, image, placement);
    return;
  }
  const targetW = Math.max(1, Math.round(placement.dw));
  const targetH = Math.max(1, Math.round(placement.dh));
  const raster = createRasterContext(targetW, targetH);
  if (!raster) {
    drawImagePlacement(ctx, image, placement);
    return;
  }
  const scratchCtx = raster.ctx;
  scratchCtx.clearRect(0, 0, targetW, targetH);
  if (placement.useSourceRect) {
    scratchCtx.drawImage(image, placement.sx, placement.sy, placement.sw, placement.sh, 0, 0, targetW, targetH);
  } else {
    scratchCtx.drawImage(image, 0, 0, targetW, targetH);
  }
  const frame = scratchCtx.getImageData(0, 0, targetW, targetH);
  if (duoActive) applyDuotoneToImageData(frame.data, duotone);
  if (fadeActive) applyImageFadeToImageData(frame.data, fade, targetW, targetH);
  scratchCtx.putImageData(frame, 0, 0);
  ctx.drawImage(raster.canvas, placement.dx, placement.dy, placement.dw, placement.dh);
}

function computeImageDrawPlacement(
  node: SceneSnapshotNode,
  image: CanvasImageSource,
): ImageDrawPlacement {
  const g = node.geometry;
  const fit = String(node.style.image_fit || "fill").toLowerCase();
  const crop = node.style.image_crop || null;
  const dim = imageDimensions(image);

  if (fit === "crop" && crop && crop.width > 0 && crop.height > 0) {
    const sx = Math.max(0, Math.min(dim.width - 1, Math.round(crop.x)));
    const sy = Math.max(0, Math.min(dim.height - 1, Math.round(crop.y)));
    const sw = Math.max(1, Math.min(dim.width - sx, Math.round(crop.width)));
    const sh = Math.max(1, Math.min(dim.height - sy, Math.round(crop.height)));
    return {
      dx: g.x,
      dy: g.y,
      dw: g.width,
      dh: g.height,
      useSourceRect: true,
      sx,
      sy,
      sw,
      sh,
    };
  }

  if (fit === "fit") {
    const ratio = Math.min(g.width / dim.width, g.height / dim.height);
    const w = dim.width * ratio;
    const h = dim.height * ratio;
    return {
      dx: g.x + (g.width - w) / 2,
      dy: g.y + (g.height - h) / 2,
      dw: w,
      dh: h,
      useSourceRect: false,
      sx: 0,
      sy: 0,
      sw: dim.width,
      sh: dim.height,
    };
  }

  const ratio = Math.max(g.width / dim.width, g.height / dim.height);
  const w = dim.width * ratio;
  const h = dim.height * ratio;
  return {
    dx: g.x + (g.width - w) / 2,
    dy: g.y + (g.height - h) / 2,
    dw: w,
    dh: h,
    useSourceRect: false,
    sx: 0,
    sy: 0,
    sw: dim.width,
    sh: dim.height,
  };
}

type NormalizedBrushPoint = { u: number; v: number };
type NormalizedBrushStroke = {
  mode: "shadow" | "erase";
  color: unknown;
  size: number;
  opacity: number;
  flow: number;
  hardness: number;
  accumulation: number;
  spacing: number;
  shape: number;
  rotation: number;
  points: NormalizedBrushPoint[];
};

function clampRange(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  if (value <= min) return min;
  if (value >= max) return max;
  return value;
}

function normalizeBrushPoint(raw: unknown): NormalizedBrushPoint | null {
  if (!raw || typeof raw !== "object") return null;
  const point = raw as Record<string, unknown>;
  return {
    u: clampRange(Number(point.u), 0, 1, 0),
    v: clampRange(Number(point.v), 0, 1, 0),
  };
}

function normalizeBrushStroke(raw: unknown): NormalizedBrushStroke | null {
  if (!raw || typeof raw !== "object") return null;
  const stroke = raw as Record<string, unknown>;
  const points = (Array.isArray(stroke.points) ? stroke.points : [])
    .map((point) => normalizeBrushPoint(point))
    .filter(Boolean) as NormalizedBrushPoint[];
  if (!points.length) return null;
  const mode = String(stroke.mode || "shadow").toLowerCase() === "erase" ? "erase" : "shadow";
  return {
    mode,
    color: stroke.color,
    size: clampRange(Number(stroke.size), 1, 2200, 120),
    opacity: clampRange(Number(stroke.opacity), 0, 100, 100),
    flow: clampRange(Number(stroke.flow), 1, 100, 100),
    hardness: clampRange(Number(stroke.hardness), 0, 100, 50),
    accumulation: clampRange(Number(stroke.accumulation), 0, 100, 100),
    spacing: clampRange(Number(stroke.spacing), 1, 100, 15),
    shape: clampRange(Number(stroke.shape), 1, 100, 100),
    rotation: clampRange(Number(stroke.rotation), -180, 180, 0),
    points,
  };
}

function parseHexColor(raw: string): { r: number; g: number; b: number } | null {
  const value = raw.trim();
  if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) return null;
  if (value.length === 4) {
    return {
      r: Number.parseInt(value[1] + value[1], 16),
      g: Number.parseInt(value[2] + value[2], 16),
      b: Number.parseInt(value[3] + value[3], 16),
    };
  }
  return {
    r: Number.parseInt(value.slice(1, 3), 16),
    g: Number.parseInt(value.slice(3, 5), 16),
    b: Number.parseInt(value.slice(5, 7), 16),
  };
}

function colorWithAlpha(rawColor: string, alpha: number): string {
  const clampedAlpha = clampRange(alpha, 0, 1, 1);
  const hex = parseHexColor(rawColor);
  if (hex) return `rgba(${hex.r}, ${hex.g}, ${hex.b}, ${clampedAlpha})`;

  const rgbaMatch = rawColor.trim().match(/^rgba?\(([^)]+)\)$/i);
  if (rgbaMatch) {
    const parts = rgbaMatch[1].split(",").map((part) => part.trim());
    const r = Number(parts[0] || 0);
    const g = Number(parts[1] || 0);
    const b = Number(parts[2] || 0);
    const baseAlpha = parts[3] != null ? Number(parts[3]) : 1;
    const mixedAlpha = clampRange((Number.isFinite(baseAlpha) ? baseAlpha : 1) * clampedAlpha, 0, 1, clampedAlpha);
    return `rgba(${Math.round(r || 0)}, ${Math.round(g || 0)}, ${Math.round(b || 0)}, ${mixedAlpha})`;
  }

  return rawColor;
}

function createShadowBrushGradient(
  ctx: Scene2DContext,
  stroke: NormalizedBrushStroke,
  outerRadius: number,
  innerRadius: number,
  alpha: number,
): CanvasGradient {
  const radial = ctx.createRadialGradient(0, 0, innerRadius, 0, 0, outerRadius);
  const hardStop = Math.min(0.99, Math.max(0, innerRadius / Math.max(1, outerRadius)));
  const gradientPaint = normalizeGradientPaint(stroke.color, rgba(stroke.color, "#111111"));

  if (gradientPaint) {
    const sortedStops = [...gradientPaint.stops].sort((a, b) => a.offset - b.offset);
    for (const stop of sortedStops) {
      radial.addColorStop(clamp01(stop.offset), colorWithAlpha(stop.color, alpha));
    }
    const edgeColor = sortedStops[sortedStops.length - 1]?.color || "#111111";
    radial.addColorStop(1, colorWithAlpha(edgeColor, 0));
    return radial;
  }

  const solid = rgba(stroke.color, "#111111");
  radial.addColorStop(0, colorWithAlpha(solid, alpha));
  radial.addColorStop(hardStop, colorWithAlpha(solid, alpha));
  radial.addColorStop(1, colorWithAlpha(solid, 0));
  return radial;
}

function drawBrushStamp(
  ctx: Scene2DContext,
  centerX: number,
  centerY: number,
  stroke: NormalizedBrushStroke,
): void {
  const outerRadius = Math.max(1, stroke.size / 2);
  const hardness = clamp01(stroke.hardness / 100);
  const innerRadius = Math.max(0, outerRadius * hardness);
  const opacity = clamp01(stroke.opacity / 100);
  const flow = clamp01(stroke.flow / 100);
  const accumulation = clamp01(stroke.accumulation / 100);
  const alpha = clampRange(opacity * Math.max(0.03, flow) * (0.35 + accumulation * 0.65), 0, 1, 1);
  const roundness = Math.max(0.08, clamp01(stroke.shape / 100));

  ctx.save();
  ctx.translate(centerX, centerY);
  if (stroke.rotation) {
    ctx.rotate((stroke.rotation * Math.PI) / 180);
  }
  ctx.scale(1, roundness);
  ctx.beginPath();
  ctx.arc(0, 0, outerRadius, 0, Math.PI * 2);

  if (stroke.mode === "erase") {
    const radial = ctx.createRadialGradient(0, 0, innerRadius, 0, 0, outerRadius);
    const hardStop = Math.min(0.99, Math.max(0, innerRadius / Math.max(1, outerRadius)));
    radial.addColorStop(0, `rgba(0,0,0,${alpha})`);
    radial.addColorStop(hardStop, `rgba(0,0,0,${alpha})`);
    radial.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = radial;
    ctx.fill();
    ctx.restore();
    return;
  }

  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = createShadowBrushGradient(ctx, stroke, outerRadius, innerRadius, alpha);
  ctx.fill();
  ctx.restore();
}

function drawBrushStroke(
  ctx: Scene2DContext,
  node: SceneSnapshotNode,
  stroke: NormalizedBrushStroke,
): void {
  const g = node.geometry;
  const points = stroke.points;
  if (!points.length) return;

  const toDoc = (point: NormalizedBrushPoint) => ({
    x: g.x + clamp01(point.u) * g.width,
    y: g.y + clamp01(point.v) * g.height,
  });
  const spacingPx = Math.max(0.75, (stroke.size * clampRange(stroke.spacing, 1, 100, 15)) / 100);

  const first = toDoc(points[0]);
  drawBrushStamp(ctx, first.x, first.y, stroke);
  if (points.length === 1) return;

  let previous = first;
  for (let i = 1; i < points.length; i += 1) {
    const next = toDoc(points[i]);
    const dx = next.x - previous.x;
    const dy = next.y - previous.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= 0.0001) {
      drawBrushStamp(ctx, next.x, next.y, stroke);
      previous = next;
      continue;
    }
    const steps = Math.max(1, Math.ceil(distance / spacingPx));
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      drawBrushStamp(
        ctx,
        previous.x + dx * t,
        previous.y + dy * t,
        stroke,
      );
    }
    previous = next;
  }
}

function drawImageBrushStrokes(
  ctx: Scene2DContext,
  node: SceneSnapshotNode,
) {
  const rawStrokes = Array.isArray(node.style?.image_brush_strokes) ? node.style.image_brush_strokes : [];
  if (!rawStrokes.length) return;
  const strokes = rawStrokes.map((stroke) => normalizeBrushStroke(stroke)).filter(Boolean) as NormalizedBrushStroke[];
  if (!strokes.length) return;
  for (const stroke of strokes) {
    drawBrushStroke(ctx, node, stroke);
  }
}

function drawImageNode(
  ctx: Scene2DContext,
  node: SceneSnapshotNode,
  imageCache?: Map<string, CanvasImageSource>
) {
  const src = String(node.image_src || "").trim();
  if (!src || !imageCache) return;
  const img = imageCache.get(src);
  if (!img) return;
  const g = node.geometry;
  const placement = computeImageDrawPlacement(node, img);
  const duotone = normalizeImageDuotone(node.style?.image_duotone);
  const fade = normalizeImageFade((node.style as Record<string, unknown> | undefined)?.image_fade);

  const r = Math.max(0, Number(g.corner_radius || 0));
  ctx.save();
  roundedRectPath(ctx, g.x, g.y, g.width, g.height, r);
  ctx.clip();
  try {
    drawImageWithEffects(ctx, img, placement, duotone, fade);
    drawImageBrushStrokes(ctx, node);
  } catch {
    // Skip only the failed bitmap; the rest of the page must keep rendering.
  } finally {
    ctx.restore();
  }
}

function hasImageSource(node: Pick<SceneSnapshotNode, "image_src">): boolean {
  return String(node.image_src || "").trim().length > 0;
}

function drawFramePlaceholder(ctx: Scene2DContext, node: SceneSnapshotNode): void {
  const g = node.geometry;
  const x = Number(g.x || 0);
  const y = Number(g.y || 0);
  const width = Math.max(1, Number(g.width || 0));
  const height = Math.max(1, Number(g.height || 0));
  const radius = Math.max(0, Number(g.corner_radius || 0));
  const pad = Math.max(12, Math.min(width, height) * 0.11);
  const innerX = x + pad;
  const innerY = y + pad;
  const innerW = Math.max(12, width - pad * 2);
  const innerH = Math.max(12, height - pad * 2);
  const innerRadius = Math.max(6, Math.min(22, Math.min(innerW, innerH) * 0.08));
  const strokeWidth = Math.max(1, Math.min(2.2, Math.min(width, height) / 150));

  ctx.save();
  roundedRectPath(ctx, x, y, width, height, radius);
  ctx.fillStyle = "rgba(140, 165, 195, 0.07)";
  ctx.fill();

  roundedRectPath(ctx, innerX, innerY, innerW, innerH, innerRadius);
  ctx.setLineDash([10, 7]);
  ctx.lineWidth = strokeWidth;
  ctx.strokeStyle = "rgba(98, 128, 160, 0.52)";
  ctx.stroke();
  ctx.setLineDash([]);

  const sunRadius = Math.max(4, Math.min(innerW, innerH) * 0.08);
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.beginPath();
  ctx.arc(innerX + innerW * 0.24, innerY + innerH * 0.28, sunRadius, 0, Math.PI * 2);
  ctx.fill();

  const ridgeY = innerY + innerH * 0.72;
  ctx.fillStyle = "rgba(126, 170, 110, 0.45)";
  ctx.beginPath();
  ctx.moveTo(innerX + innerW * 0.08, ridgeY);
  ctx.lineTo(innerX + innerW * 0.36, innerY + innerH * 0.48);
  ctx.lineTo(innerX + innerW * 0.56, ridgeY);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "rgba(92, 134, 81, 0.6)";
  ctx.beginPath();
  ctx.moveTo(innerX + innerW * 0.34, ridgeY);
  ctx.lineTo(innerX + innerW * 0.62, innerY + innerH * 0.42);
  ctx.lineTo(innerX + innerW * 0.92, ridgeY);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "rgba(141, 171, 205, 0.74)";
  ctx.lineWidth = Math.max(1, strokeWidth * 1.05);
  ctx.beginPath();
  ctx.moveTo(innerX + innerW * 0.2, innerY + innerH * 0.2);
  ctx.lineTo(innerX + innerW * 0.8, innerY + innerH * 0.8);
  ctx.moveTo(innerX + innerW * 0.8, innerY + innerH * 0.2);
  ctx.lineTo(innerX + innerW * 0.2, innerY + innerH * 0.8);
  ctx.stroke();

  const badgeW = Math.min(innerW * 0.62, 120);
  const badgeH = Math.min(innerH * 0.2, 26);
  const badgeX = innerX + (innerW - badgeW) / 2;
  const badgeY = innerY + innerH - badgeH - Math.max(8, innerH * 0.06);
  roundedRectPath(ctx, badgeX, badgeY, badgeW, badgeH, badgeH / 2);
  ctx.fillStyle = "rgba(10, 16, 26, 0.55)";
  ctx.fill();
  ctx.font = `${Math.max(9, Math.round(badgeH * 0.44))}px "DM Sans", "Inter", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(226, 238, 251, 0.92)";
  ctx.fillText("FRAME", badgeX + badgeW / 2, badgeY + badgeH / 2 + 0.2);
  ctx.restore();
}

type LayerEffectKind =
  | "inner_shadow"
  | "drop_shadow"
  | "layer_blur"
  | "background_blur"
  | "noise"
  | "texture"
  | "glass";

type NormalizedLayerEffect = {
  id: string;
  type: LayerEffectKind;
  x: number;
  y: number;
  blur: number;
  spread: number;
  radius: number;
  amount: number;
  scale: number;
  opacity: number;
  saturation: number;
  noise: number;
  color: unknown;
  tint: unknown;
  showBehindTransparent: boolean;
};

type NodeDrawSpec = {
  fill: ScenePaint;
  strokes: RenderStrokeSpec[];
  strokeW: number;
  strokeSpec: Record<string, unknown> | null;
  frameHasImage: boolean;
};

type RenderStrokeSpec = {
  paint: ScenePaint;
  weight: number;
  opacity: number; // 0..1
  align: "inside" | "center" | "outside";
  style: "solid" | "dash" | "long_dash" | "dotted";
  mode: "basic" | "dynamic" | "brush";
  widthProfile: "uniform" | "taper_start" | "taper_end" | "taper_both";
  widthProfileFlip: boolean;
  join: "miter" | "bevel" | "round";
  cap: "round" | "butt" | "square";
  miterLimit: number;
  dynamicFrequency: number;
  dynamicMovement: number;
  dynamicSmooth: number;
  brushPreset: "ink" | "marker" | "chalk" | "spray";
  brushFlip: boolean;
  sides: { top: boolean; right: boolean; bottom: boolean; left: boolean };
};

type NodeDrawResources = {
  imageCache?: Map<string, CanvasImageSource>;
  textMetricsCache?: Map<string, number>;
};

function toLayerEffectType(value: unknown): LayerEffectKind {
  const type = String(value || "").trim().toLowerCase();
  if (
    type === "inner_shadow"
    || type === "drop_shadow"
    || type === "layer_blur"
    || type === "background_blur"
    || type === "noise"
    || type === "texture"
    || type === "glass"
  ) {
    return type;
  }
  return "drop_shadow";
}

function normalizeLayerEffectList(rawEffects: unknown): NormalizedLayerEffect[] {
  const list = Array.isArray(rawEffects) ? rawEffects : [];
  const out: NormalizedLayerEffect[] = [];
  for (let index = 0; index < list.length; index += 1) {
    const raw = list[index];
    const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const enabled = value.enabled !== false;
    const visible = value.visible !== false;
    if (!enabled || !visible) continue;
    const type = toLayerEffectType(value.type);
    out.push({
      id: String(value.id || `fx_${index}`),
      type,
      x: clampRange(Number(value.x), -2000, 2000, type === "drop_shadow" || type === "inner_shadow" ? 0 : 0),
      y: clampRange(Number(value.y), -2000, 2000, type === "drop_shadow" || type === "inner_shadow" ? 8 : 0),
      blur: clampRange(Number(value.blur), 0, 600, type === "glass" ? 18 : 16),
      spread: clampRange(Number(value.spread), -200, 200, 0),
      radius: clampRange(Number(value.radius), 0, 600, 12),
      amount: clampRange(Number(value.amount), 0, 100, type === "texture" ? 32 : 24),
      scale: clampRange(Number(value.scale), 0.25, 80, type === "texture" ? 6 : 2),
      opacity: clampRange(Number(value.opacity), 0, 100, type === "glass" ? 24 : type === "texture" ? 36 : type === "noise" ? 45 : 100),
      saturation: clampRange(Number(value.saturation), 0, 300, 120),
      noise: clampRange(Number(value.noise), 0, 100, 14),
      color: value.color ?? "#000000",
      tint: value.tint ?? "#dbeafe",
      showBehindTransparent: Boolean(value.show_behind_transparent),
    });
  }
  return out;
}

function nodeLogicalBounds(node: SceneSnapshotNode): { x: number; y: number; width: number; height: number } {
  if (node.kind === "line") return lineBounds(node);
  if (node.kind === "path") {
    const anchors = getPathSubpaths(node.path_data || null).flatMap((subpath) => subpath.points);
    if (anchors.length) {
      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      for (const anchor of anchors) {
        minX = Math.min(minX, anchor.x, anchor.in?.x ?? anchor.x, anchor.out?.x ?? anchor.x);
        minY = Math.min(minY, anchor.y, anchor.in?.y ?? anchor.y, anchor.out?.y ?? anchor.y);
        maxX = Math.max(maxX, anchor.x, anchor.in?.x ?? anchor.x, anchor.out?.x ?? anchor.x);
        maxY = Math.max(maxY, anchor.y, anchor.in?.y ?? anchor.y, anchor.out?.y ?? anchor.y);
      }
      if (Number.isFinite(minX) && Number.isFinite(minY) && Number.isFinite(maxX) && Number.isFinite(maxY)) {
        return {
          x: minX,
          y: minY,
          width: Math.max(1, maxX - minX),
          height: Math.max(1, maxY - minY),
        };
      }
    }
  }
  const g = node.geometry;
  const x1 = Number(g.x || 0);
  const y1 = Number(g.y || 0);
  const x2 = x1 + Number(g.width || 0);
  const y2 = y1 + Number(g.height || 0);
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.max(1, Math.abs(x2 - x1)),
    height: Math.max(1, Math.abs(y2 - y1)),
  };
}

function estimateEffectPadding(effects: NormalizedLayerEffect[], strokeW: number): number {
  let padding = Math.max(6, Number.isFinite(strokeW) ? strokeW * 2 : 0);
  for (const effect of effects) {
    if (effect.type === "drop_shadow" || effect.type === "inner_shadow") {
      padding = Math.max(
        padding,
        Math.abs(effect.x) + Math.abs(effect.y) + Math.abs(effect.spread) + effect.blur * 2 + 12,
      );
      continue;
    }
    if (effect.type === "layer_blur" || effect.type === "background_blur") {
      padding = Math.max(padding, effect.radius * 2 + 10);
      continue;
    }
    if (effect.type === "glass") {
      padding = Math.max(padding, effect.blur * 2 + 12);
    }
  }
  return Math.max(6, Math.ceil(Math.min(2048, padding)));
}

function widthProfileScale(profile: RenderStrokeSpec["widthProfile"]): number {
  if (profile === "taper_both") return 0.76;
  if (profile === "taper_start" || profile === "taper_end") return 0.88;
  return 1;
}

function computeStrokeWidth(stroke: RenderStrokeSpec): number {
  const base = Math.max(0, Number(stroke.weight || 0));
  if (base <= 0) return 0;
  let width = base * widthProfileScale(stroke.widthProfile);
  if (stroke.mode === "dynamic") {
    const movement = clampRange(Number(stroke.dynamicMovement || 0), 0, 100, 0) / 100;
    const smooth = clampRange(Number(stroke.dynamicSmooth || 0), 0, 100, 100) / 100;
    width *= 1 + movement * 0.34 * (1 - smooth * 0.6);
  } else if (stroke.mode === "brush") {
    width *= (
      stroke.brushPreset === "marker" ? 1.18
      : stroke.brushPreset === "chalk" ? 1.26
      : stroke.brushPreset === "spray" ? 1.34
      : 1.02
    );
  }
  return Math.max(0.2, width);
}

function scaleDashSegments(dash: number[], scale: number): number[] {
  if (!dash.length) return [];
  const factor = Math.max(0.2, Number(scale || 1));
  return dash.map((segment) => Math.max(0.4, Number(segment || 0) * factor));
}

function computeStrokeDash(stroke: RenderStrokeSpec, width: number): number[] {
  let dash: number[] = [];
  if (stroke.mode === "dynamic") {
    const frequency = clampRange(Number(stroke.dynamicFrequency || 0), 0, 100, 0) / 100;
    const movement = clampRange(Number(stroke.dynamicMovement || 0), 0, 100, 0) / 100;
    const smooth = clampRange(Number(stroke.dynamicSmooth || 0), 0, 100, 100) / 100;
    const base = Math.max(1.4, width);
    const segA = Math.max(0.8, base * (0.65 + (1 - frequency) * 2.3));
    const segB = Math.max(0.8, base * (0.45 + movement * 1.4 + smooth * 0.7));
    const segC = Math.max(0.8, base * (0.35 + (1 - smooth) * 1.2));
    dash = [segA, segB, segC, segB];
  } else if (stroke.mode === "brush") {
    const base = Math.max(1.4, width);
    if (stroke.brushPreset === "marker") dash = [base * 2.2, base * 0.9];
    else if (stroke.brushPreset === "chalk") dash = [base * 0.9, base * 0.55, base * 1.4, base * 0.8];
    else if (stroke.brushPreset === "spray") dash = [base * 0.25, base * 0.8];
  } else {
    dash = scaleDashSegments(dashPresetToSegments(stroke.style), Math.max(0.6, width / 3.2));
  }
  if ((stroke.mode === "brush" && stroke.brushFlip) || stroke.widthProfileFlip) {
    return [...dash].reverse();
  }
  return dash;
}

function strokeGlobalAlpha(stroke: RenderStrokeSpec): number {
  return clampRange(Number(stroke.opacity || 0), 0, 1, 1);
}

function isAllStrokeSidesEnabled(sides: RenderStrokeSpec["sides"]): boolean {
  return sides.top && sides.right && sides.bottom && sides.left;
}

function applyStrokeToContext(ctx: Scene2DContext, stroke: RenderStrokeSpec, width: number): void {
  ctx.strokeStyle = stroke.paint;
  ctx.lineWidth = Math.max(0.2, width);
  ctx.setLineDash(computeStrokeDash(stroke, width));
  ctx.lineCap = stroke.cap;
  ctx.lineJoin = stroke.join;
  ctx.miterLimit = Math.max(0.2, Number(stroke.miterLimit || 4));
}

function drawAlignedStrokePath(
  ctx: Scene2DContext,
  stroke: RenderStrokeSpec,
  buildPath: () => void,
  closed: boolean,
): void {
  if (!closed || stroke.align === "center") {
    buildPath();
    ctx.stroke();
    return;
  }

  if (stroke.align === "inside") {
    ctx.save();
    buildPath();
    ctx.clip();
    buildPath();
    ctx.stroke();
    ctx.restore();
    return;
  }

  ctx.save();
  const rawCanvas = (ctx as any)?.canvas as { width?: number; height?: number } | undefined;
  const cw = Math.max(1024, Number(rawCanvas?.width || 0));
  const ch = Math.max(1024, Number(rawCanvas?.height || 0));
  try {
    ctx.beginPath();
    ctx.rect(-cw * 2, -ch * 2, cw * 5, ch * 5);
    buildPath();
    ctx.clip("evenodd");
  } catch {
    ctx.beginPath();
    ctx.rect(-cw * 2, -ch * 2, cw * 5, ch * 5);
    ctx.clip();
  }
  buildPath();
  ctx.stroke();
  ctx.restore();
}

function drawRectStrokeSides(
  ctx: Scene2DContext,
  node: SceneSnapshotNode,
  stroke: RenderStrokeSpec,
  width: number,
): boolean {
  if (node.kind !== "rect" && node.kind !== "frame" && node.kind !== "group") return false;
  if (!stroke.sides) return false;
  if (isAllStrokeSidesEnabled(stroke.sides)) return false;
  if (rectShapeType(node) !== "rect") return false;
  const g = node.geometry;
  const half = width / 2;
  const x = Number(g.x || 0);
  const y = Number(g.y || 0);
  const w = Number(g.width || 0);
  const h = Number(g.height || 0);
  if (!Number.isFinite(w) || !Number.isFinite(h) || Math.abs(w) < 0.001 || Math.abs(h) < 0.001) return false;

  const topY = y + half;
  const bottomY = y + h - half;
  const leftX = x + half;
  const rightX = x + w - half;

  ctx.beginPath();
  if (stroke.sides.top) {
    ctx.moveTo(leftX, topY);
    ctx.lineTo(rightX, topY);
  }
  if (stroke.sides.right) {
    ctx.moveTo(rightX, topY);
    ctx.lineTo(rightX, bottomY);
  }
  if (stroke.sides.bottom) {
    ctx.moveTo(rightX, bottomY);
    ctx.lineTo(leftX, bottomY);
  }
  if (stroke.sides.left) {
    ctx.moveTo(leftX, bottomY);
    ctx.lineTo(leftX, topY);
  }
  ctx.stroke();
  return true;
}

function drawNodeContent(
  ctx: Scene2DContext,
  node: SceneSnapshotNode,
  spec: NodeDrawSpec,
  resources: NodeDrawResources,
): void {
  const g = node.geometry;
  const { fill, strokes, strokeW, strokeSpec, frameHasImage } = spec;
  const activeStrokes = strokes.length > 0
    ? strokes
    : (node.kind === "line"
      ? [
          {
            paint: fill,
            weight: Math.max(1, Number(strokeW || 1)),
            opacity: 1,
            align: "center" as const,
            style: "solid" as const,
            mode: "basic" as const,
            widthProfile: "uniform" as const,
            widthProfileFlip: false,
            join: "round" as const,
            cap: "round" as const,
            miterLimit: 4,
            dynamicFrequency: 0,
            dynamicMovement: 0,
            dynamicSmooth: 100,
            brushPreset: "ink" as const,
            brushFlip: false,
            sides: { top: true, right: true, bottom: true, left: true },
          },
        ]
      : []);

  if (node.kind === "line") {
    for (const stroke of activeStrokes) {
      const width = computeStrokeWidth(stroke);
      if (width <= 0) continue;
      ctx.save();
      ctx.globalAlpha *= strokeGlobalAlpha(stroke);
      applyStrokeToContext(ctx, stroke, width);
      ctx.beginPath();
      ctx.moveTo(g.x, g.y);
      ctx.lineTo(g.x + g.width, g.y + g.height);
      ctx.stroke();
      drawLineArrowheads(
        ctx,
        g,
        strokeSpec && typeof strokeSpec === "object" ? (strokeSpec as Record<string, unknown>) : null,
        stroke.paint,
        width,
      );
      ctx.restore();
    }
    return;
  }

  if (node.kind === "path") {
    const built = buildPathNodePath(ctx, node);
    if (!built.valid) return;
    if (fill && built.hasClosedFill) {
      ctx.fillStyle = fill;
      ctx.fill(built.fillRule);
    }
    for (const stroke of activeStrokes) {
      const width = computeStrokeWidth(stroke);
      if (width <= 0) continue;
      ctx.save();
      ctx.globalAlpha *= strokeGlobalAlpha(stroke);
      applyStrokeToContext(ctx, stroke, width);
      drawAlignedStrokePath(ctx, stroke, () => {
        buildPathNodePath(ctx, node);
      }, built.closed);
      drawPathArrowheads(
        ctx,
        built.arrowAnchors,
        built.closed,
        strokeSpec && typeof strokeSpec === "object" ? (strokeSpec as Record<string, unknown>) : null,
        stroke.paint,
        width,
      );
      ctx.restore();
    }
    return;
  }

  if (node.kind === "rect" || node.kind === "frame" || node.kind === "group") {
    shapePath(ctx, node);
    if (fill && node.kind !== "frame") {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (node.kind === "frame" && !frameHasImage) {
      drawFramePlaceholder(ctx, node);
    }
    if (!frameHasImage) {
      for (const stroke of activeStrokes) {
        const width = computeStrokeWidth(stroke);
        if (width <= 0) continue;
        ctx.save();
        ctx.globalAlpha *= strokeGlobalAlpha(stroke);
        applyStrokeToContext(ctx, stroke, width);
        const drewBySides = drawRectStrokeSides(ctx, node, stroke, width);
        if (!drewBySides) {
          drawAlignedStrokePath(ctx, stroke, () => shapePath(ctx, node), true);
        }
        ctx.restore();
      }
    }
  }

  if (node.kind === "image" || frameHasImage) {
    drawImageNode(ctx, node, resources.imageCache);
    for (const stroke of activeStrokes) {
      const width = computeStrokeWidth(stroke);
      if (width <= 0) continue;
      ctx.save();
      ctx.globalAlpha *= strokeGlobalAlpha(stroke);
      applyStrokeToContext(ctx, stroke, width);
      drawAlignedStrokePath(ctx, stroke, () => {
        roundedRectPath(ctx, g.x, g.y, g.width, g.height, Number(g.corner_radius || 0));
      }, true);
      ctx.restore();
    }
  }

  if (node.kind === "text") {
    if (!activeStrokes.length) {
      drawTextFitted(ctx, node, resources.textMetricsCache, null);
      return;
    }
    for (const stroke of activeStrokes) {
      const width = computeStrokeWidth(stroke);
      if (width <= 0) continue;
      ctx.save();
      ctx.globalAlpha *= strokeGlobalAlpha(stroke);
      drawTextFitted(
        ctx,
        node,
        resources.textMetricsCache,
        {
          paint: stroke.paint,
          width,
          dash: computeStrokeDash(stroke, width),
        },
      );
      ctx.restore();
    }
  }
}

function createAlphaMaskFromSource(source: CanvasImageSource, width: number, height: number): CanvasImageSource | null {
  const mask = createRasterContext(width, height);
  if (!mask) return null;
  mask.ctx.clearRect(0, 0, width, height);
  mask.ctx.drawImage(source, 0, 0);
  mask.ctx.globalCompositeOperation = "source-in";
  mask.ctx.fillStyle = "rgba(255,255,255,1)";
  mask.ctx.fillRect(0, 0, width, height);
  mask.ctx.globalCompositeOperation = "source-over";
  return mask.canvas;
}

function createNodeBoundsMaskCanvas(
  node: SceneSnapshotNode,
  spec: NodeDrawSpec,
  width: number,
  height: number,
  offsetX: number,
  offsetY: number,
): CanvasImageSource | null {
  const raster = createRasterContext(width, height);
  if (!raster) return null;
  const maskCtx = raster.ctx;
  maskCtx.clearRect(0, 0, width, height);
  maskCtx.save();
  maskCtx.translate(-offsetX, -offsetY);
  maskCtx.fillStyle = "rgba(255,255,255,1)";
  maskCtx.strokeStyle = "rgba(255,255,255,1)";
  if (node.kind === "line") {
    const g = node.geometry;
    maskCtx.beginPath();
    maskCtx.moveTo(g.x, g.y);
    maskCtx.lineTo(g.x + g.width, g.y + g.height);
    maskCtx.lineWidth = Math.max(1, spec.strokeW || 1);
    maskCtx.lineCap = "round";
    maskCtx.stroke();
    maskCtx.restore();
    return raster.canvas;
  }
  if (node.kind === "path") {
    const built = buildPathNodePath(maskCtx, node);
    if (built.valid) {
      if (built.closed) {
        maskCtx.fill();
      } else {
        maskCtx.lineWidth = Math.max(1, spec.strokeW || 1);
        maskCtx.lineCap = "round";
        maskCtx.lineJoin = "round";
        maskCtx.stroke();
      }
    }
    maskCtx.restore();
    return raster.canvas;
  }
  if (node.kind === "text") {
    const g = node.geometry;
    roundedRectPath(maskCtx, g.x, g.y, Math.max(1, g.width), Math.max(1, g.height), Math.max(0, Number(g.corner_radius || 0)));
    maskCtx.fill();
    maskCtx.restore();
    return raster.canvas;
  }
  shapePath(maskCtx, node);
  maskCtx.fill();
  maskCtx.restore();
  return raster.canvas;
}

function drawImageWithSpread(
  ctx: Scene2DContext,
  source: CanvasImageSource,
  width: number,
  height: number,
  spread: number,
): void {
  if (Math.abs(spread) <= 0.0001) {
    ctx.drawImage(source, 0, 0);
    return;
  }
  const scaleX = Math.max(0.05, (width + spread * 2) / Math.max(1, width));
  const scaleY = Math.max(0.05, (height + spread * 2) / Math.max(1, height));
  const cx = width / 2;
  const cy = height / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scaleX, scaleY);
  ctx.translate(-cx, -cy);
  ctx.drawImage(source, 0, 0);
  ctx.restore();
}

function tintMaskCanvas(
  sourceMask: CanvasImageSource,
  width: number,
  height: number,
  color: unknown,
  opacity: number,
): CanvasImageSource | null {
  const tinted = createRasterContext(width, height);
  if (!tinted) return null;
  tinted.ctx.clearRect(0, 0, width, height);
  tinted.ctx.drawImage(sourceMask, 0, 0);
  tinted.ctx.globalCompositeOperation = "source-in";
  tinted.ctx.fillStyle = colorWithAlpha(rgba(color, "#000000"), clampRange(opacity, 0, 100, 100) / 100);
  tinted.ctx.fillRect(0, 0, width, height);
  tinted.ctx.globalCompositeOperation = "source-over";
  return tinted.canvas;
}

function renderShadowLayer(
  sourceMask: CanvasImageSource,
  width: number,
  height: number,
  effect: Pick<NormalizedLayerEffect, "color" | "opacity" | "x" | "y" | "blur" | "spread">,
): CanvasImageSource | null {
  const tinted = tintMaskCanvas(sourceMask, width, height, effect.color, effect.opacity);
  if (!tinted) return null;
  const shadow = createRasterContext(width, height);
  if (!shadow) return null;
  const blur = Math.max(0, Number(effect.blur || 0));
  shadow.ctx.clearRect(0, 0, width, height);
  shadow.ctx.save();
  if (typeof (shadow.ctx as any).filter === "string" && blur > 0) {
    (shadow.ctx as any).filter = `blur(${blur}px)`;
  }
  shadow.ctx.translate(Number(effect.x || 0), Number(effect.y || 0));
  drawImageWithSpread(shadow.ctx, tinted, width, height, Number(effect.spread || 0));
  shadow.ctx.restore();
  return shadow.canvas;
}

function applyMaskToLayer(
  layer: CanvasImageSource,
  mask: CanvasImageSource,
  width: number,
  height: number,
): CanvasImageSource | null {
  const masked = createRasterContext(width, height);
  if (!masked) return null;
  masked.ctx.clearRect(0, 0, width, height);
  masked.ctx.drawImage(layer, 0, 0);
  masked.ctx.globalCompositeOperation = "destination-in";
  masked.ctx.drawImage(mask, 0, 0);
  masked.ctx.globalCompositeOperation = "source-over";
  return masked.canvas;
}

function renderFilteredLayer(
  source: CanvasImageSource,
  width: number,
  height: number,
  filterParts: string[],
): CanvasImageSource | null {
  const layer = createRasterContext(width, height);
  if (!layer) return null;
  layer.ctx.clearRect(0, 0, width, height);
  layer.ctx.save();
  const filterExpression = filterParts.filter(Boolean).join(" ").trim();
  if (typeof (layer.ctx as any).filter === "string" && filterExpression) {
    (layer.ctx as any).filter = filterExpression;
  }
  layer.ctx.drawImage(source, 0, 0);
  layer.ctx.restore();
  return layer.canvas;
}

function sampleBackdropLayer(
  targetContext: Scene2DContext,
  offsetX: number,
  offsetY: number,
  width: number,
  height: number,
  pixelRatio: number,
): CanvasImageSource | null {
  const sceneCanvas = (targetContext as any)?.canvas as CanvasImageSource | undefined;
  if (!sceneCanvas) return null;
  const layer = createRasterContext(width, height);
  if (!layer) return null;
  const pr = Math.max(1, Number.isFinite(pixelRatio) ? Number(pixelRatio) : 1);
  const rawSourceX = Number(offsetX || 0) * pr;
  const rawSourceY = Number(offsetY || 0) * pr;
  const rawSourceW = Math.max(1, Number(width || 0) * pr);
  const rawSourceH = Math.max(1, Number(height || 0) * pr);
  const sceneW = Math.max(1, Number((sceneCanvas as any).width || 0));
  const sceneH = Math.max(1, Number((sceneCanvas as any).height || 0));
  const sourceX = Math.max(0, Math.min(sceneW, rawSourceX));
  const sourceY = Math.max(0, Math.min(sceneH, rawSourceY));
  const sourceEndX = Math.max(sourceX, Math.min(sceneW, rawSourceX + rawSourceW));
  const sourceEndY = Math.max(sourceY, Math.min(sceneH, rawSourceY + rawSourceH));
  const sourceW = Math.max(0, sourceEndX - sourceX);
  const sourceH = Math.max(0, sourceEndY - sourceY);
  const destX = (sourceX - rawSourceX) / pr;
  const destY = (sourceY - rawSourceY) / pr;
  const destW = sourceW / pr;
  const destH = sourceH / pr;
  layer.ctx.clearRect(0, 0, width, height);
  if (sourceW > 0.0001 && sourceH > 0.0001 && destW > 0.0001 && destH > 0.0001) {
    layer.ctx.drawImage(sceneCanvas, sourceX, sourceY, sourceW, sourceH, destX, destY, destW, destH);
  }
  return layer.canvas;
}

function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function pseudoRandom(seed: number, x: number, y: number): number {
  const n = Math.sin((x + 0.5) * 12.9898 + (y + 0.5) * 78.233 + seed * 0.00021) * 43758.5453123;
  return n - Math.floor(n);
}

function clampByte(value: number): number {
  if (value <= 0) return 0;
  if (value >= 255) return 255;
  return Math.round(value);
}

function createProceduralOverlayLayer(
  width: number,
  height: number,
  effect: Pick<NormalizedLayerEffect, "id" | "type" | "amount" | "scale" | "opacity" | "color">,
): CanvasImageSource | null {
  const sampleScale = Math.max(0.25, Number(effect.scale || 1));
  const sampleW = Math.max(1, Math.round(width / sampleScale));
  const sampleH = Math.max(1, Math.round(height / sampleScale));
  const sample = createRasterContext(sampleW, sampleH);
  if (!sample) return null;
  const image = sample.ctx.createImageData(sampleW, sampleH);
  const data = image.data;
  const amount = clampRange(Number(effect.amount || 0), 0, 100, 0) / 100;
  const opacity = clampRange(Number(effect.opacity || 0), 0, 100, 0) / 100;
  const base = parseRgbColor(rgba(effect.color, effect.type === "texture" ? "#94a3b8" : "#9ca3af"), { r: 156, g: 163, b: 175 });
  const seed = hashSeed(`${effect.type}:${effect.id}`);
  const textureMode = effect.type === "texture";
  for (let y = 0; y < sampleH; y += 1) {
    for (let x = 0; x < sampleW; x += 1) {
      const idx = (y * sampleW + x) * 4;
      const rnd = pseudoRandom(seed, x, y);
      const wave = textureMode
        ? 0.5 + 0.35 * Math.sin((x + seed) * 0.22) + 0.15 * Math.cos((y + seed) * 0.31)
        : rnd;
      const mix = clamp01((rnd * 0.65 + wave * 0.35));
      const tone = (mix - 0.5) * (textureMode ? 140 : 95) * amount;
      data[idx] = clampByte(base.r + tone);
      data[idx + 1] = clampByte(base.g + tone);
      data[idx + 2] = clampByte(base.b + tone);
      const alphaFactor = textureMode ? (0.38 + mix * 0.62) : (0.16 + mix * 0.84);
      data[idx + 3] = clampByte(255 * opacity * Math.max(0.06, amount) * alphaFactor);
    }
  }
  sample.ctx.putImageData(image, 0, 0);

  const layer = createRasterContext(width, height);
  if (!layer) return null;
  layer.ctx.clearRect(0, 0, width, height);
  if ("imageSmoothingEnabled" in layer.ctx) {
    (layer.ctx as any).imageSmoothingEnabled = false;
  }
  layer.ctx.drawImage(sample.canvas, 0, 0, sampleW, sampleH, 0, 0, width, height);
  return layer.canvas;
}

function drawNodeWithEffects(
  ctx: Scene2DContext,
  node: SceneSnapshotNode,
  spec: NodeDrawSpec,
  resources: NodeDrawResources,
  effects: NormalizedLayerEffect[],
  pixelRatio: number,
): boolean {
  if (!effects.length) return false;
  const bounds = nodeLogicalBounds(node);
  const padding = estimateEffectPadding(effects, spec.strokeW);
  const width = Math.max(1, Math.ceil(bounds.width + padding * 2));
  const height = Math.max(1, Math.ceil(bounds.height + padding * 2));
  const offsetX = Math.floor(bounds.x - padding);
  const offsetY = Math.floor(bounds.y - padding);

  const content = createRasterContext(width, height);
  const composite = createRasterContext(width, height);
  if (!content || !composite) return false;

  content.ctx.clearRect(0, 0, width, height);
  content.ctx.save();
  content.ctx.translate(-offsetX, -offsetY);
  drawNodeContent(content.ctx, node, spec, resources);
  content.ctx.restore();

  composite.ctx.clearRect(0, 0, width, height);
  composite.ctx.drawImage(content.canvas, 0, 0);

  const baseMask = createAlphaMaskFromSource(content.canvas, width, height);
  if (!baseMask) {
    ctx.drawImage(content.canvas, offsetX, offsetY);
    return true;
  }
  let geometryMask: CanvasImageSource | null = null;

  for (const effect of effects) {
    if (effect.type === "drop_shadow") {
      const sourceMask = effect.showBehindTransparent
        ? (geometryMask || (geometryMask = createNodeBoundsMaskCanvas(node, spec, width, height, offsetX, offsetY)))
        : baseMask;
      if (!sourceMask) continue;
      const shadowLayer = renderShadowLayer(sourceMask, width, height, effect);
      if (!shadowLayer) continue;
      composite.ctx.save();
      composite.ctx.globalCompositeOperation = "destination-over";
      composite.ctx.drawImage(shadowLayer, 0, 0);
      composite.ctx.restore();
      continue;
    }

    if (effect.type === "inner_shadow") {
      const shadowLayer = renderShadowLayer(baseMask, width, height, effect);
      if (!shadowLayer) continue;
      const innerLayer = applyMaskToLayer(shadowLayer, baseMask, width, height);
      if (!innerLayer) continue;
      composite.ctx.drawImage(innerLayer, 0, 0);
      continue;
    }

    if (effect.type === "layer_blur") {
      const radius = Math.max(0, Number(effect.radius || 0));
      if (radius <= 0.001) continue;
      const blurred = renderFilteredLayer(composite.canvas, width, height, [`blur(${radius}px)`]);
      if (!blurred) continue;
      const alpha = clampRange(Number(effect.opacity || 0), 0, 100, 100) / 100;
      if (alpha >= 0.999) {
        composite.ctx.clearRect(0, 0, width, height);
        composite.ctx.drawImage(blurred, 0, 0);
      } else if (alpha > 0) {
        composite.ctx.save();
        composite.ctx.globalAlpha = alpha;
        composite.ctx.drawImage(blurred, 0, 0);
        composite.ctx.restore();
      }
      continue;
    }

    if (effect.type === "background_blur") {
      const backdrop = sampleBackdropLayer(ctx, offsetX, offsetY, width, height, pixelRatio);
      if (!backdrop) continue;
      const radius = Math.max(0, Number(effect.radius || 0));
      const blurred = renderFilteredLayer(backdrop, width, height, radius > 0 ? [`blur(${radius}px)`] : []);
      if (!blurred) continue;
      const masked = applyMaskToLayer(blurred, baseMask, width, height);
      if (!masked) continue;
      composite.ctx.save();
      composite.ctx.globalAlpha = clampRange(Number(effect.opacity || 0), 0, 100, 100) / 100;
      composite.ctx.drawImage(masked, 0, 0);
      composite.ctx.restore();
      continue;
    }

    if (effect.type === "noise" || effect.type === "texture") {
      const procedural = createProceduralOverlayLayer(width, height, effect);
      if (!procedural) continue;
      const masked = applyMaskToLayer(procedural, baseMask, width, height);
      if (!masked) continue;
      composite.ctx.drawImage(masked, 0, 0);
      continue;
    }

    if (effect.type === "glass") {
      const backdrop = sampleBackdropLayer(ctx, offsetX, offsetY, width, height, pixelRatio);
      if (backdrop) {
        const blur = Math.max(0, Number(effect.blur || 0));
        const saturation = clampRange(Number(effect.saturation || 100), 0, 300, 100);
        const filtered = renderFilteredLayer(
          backdrop,
          width,
          height,
          [
            blur > 0 ? `blur(${blur}px)` : "",
            `saturate(${saturation}%)`,
          ],
        );
        if (filtered) {
          const maskedBackdrop = applyMaskToLayer(filtered, baseMask, width, height);
          if (maskedBackdrop) {
            composite.ctx.save();
            composite.ctx.globalAlpha = clampRange(Number(effect.opacity || 0), 0, 100, 100) / 100;
            composite.ctx.drawImage(maskedBackdrop, 0, 0);
            composite.ctx.restore();
          }
        }
      }

      const tintLayer = createRasterContext(width, height);
      if (tintLayer) {
        tintLayer.ctx.clearRect(0, 0, width, height);
        tintLayer.ctx.fillStyle = colorWithAlpha(
          rgba(effect.tint, "#dbeafe"),
          (clampRange(Number(effect.opacity || 0), 0, 100, 100) / 100) * 0.62,
        );
        tintLayer.ctx.fillRect(0, 0, width, height);
        const maskedTint = applyMaskToLayer(tintLayer.canvas, baseMask, width, height);
        if (maskedTint) {
          composite.ctx.drawImage(maskedTint, 0, 0);
        }
      }

      if (effect.noise > 0) {
        const noiseLayer = createProceduralOverlayLayer(width, height, {
          id: effect.id,
          type: "noise",
          amount: effect.noise,
          scale: Math.max(1.2, effect.scale || 2),
          opacity: Math.max(4, effect.noise * 0.7),
          color: "#f1f5f9",
        });
        if (noiseLayer) {
          const maskedNoise = applyMaskToLayer(noiseLayer, baseMask, width, height);
          if (maskedNoise) {
            composite.ctx.drawImage(maskedNoise, 0, 0);
          }
        }
      }
    }
  }

  ctx.drawImage(composite.canvas, offsetX, offsetY);
  return true;
}

function clipDirtyRegions(ctx: Scene2DContext, dirtyRegions: DirtyRegion[] | null | undefined): boolean {
  if (!dirtyRegions || !dirtyRegions.length) return false;
  ctx.save();
  ctx.beginPath();
  for (const r of dirtyRegions) {
    ctx.rect(r.x, r.y, r.w, r.h);
  }
  ctx.clip();
  return true;
}

function nodeDirtyCullBounds(node: SceneSnapshotNode, pad = 18): DirtyRegion {
  if (node.kind === "line") {
    const bounds = lineBounds(node);
    return {
      x: bounds.x - pad,
      y: bounds.y - pad,
      w: bounds.width + pad * 2,
      h: bounds.height + pad * 2,
    };
  }
  const g = node.geometry;
  const x = Number(g.x || 0);
  const y = Number(g.y || 0);
  const w = Math.max(1, Math.abs(Number(g.width || 0)));
  const h = Math.max(1, Math.abs(Number(g.height || 0)));
  const rotation = Math.abs(Number(g.rotation || 0)) % 360;
  if (rotation > 0.001) {
    const cx = x + w / 2;
    const cy = y + h / 2;
    const radius = Math.hypot(w, h) / 2 + pad;
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
    w: w + pad * 2,
    h: h + pad * 2,
  };
}

function regionIntersects(a: DirtyRegion, b: DirtyRegion): boolean {
  return a.x < b.x + b.w
    && a.x + a.w > b.x
    && a.y < b.y + b.h
    && a.y + a.h > b.y;
}

function nodeIntersectsDirtyRegions(node: SceneSnapshotNode, dirtyRegions: DirtyRegion[] | null | undefined): boolean {
  if (!dirtyRegions || !dirtyRegions.length) return true;
  const bounds = nodeDirtyCullBounds(node);
  return dirtyRegions.some((region) => regionIntersects(bounds, region));
}

type PaintOptions = {
  width?: number;
  height?: number;
  pixelRatio: number;
  imageCache?: Map<string, CanvasImageSource>;
  textMetricsCache?: Map<string, number>;
  dirtyRegions?: DirtyRegion[] | null;
};

export function paintSceneSnapshotToContext(
  ctx: Scene2DContext,
  snapshot: SceneSnapshot,
  options: PaintOptions
): void {
  const w = Math.max(1, Math.round(Number(options.width || snapshot.canvas.width)));
  const h = Math.max(1, Math.round(Number(options.height || snapshot.canvas.height)));
  const pixelRatio = Math.max(1, Number(options.pixelRatio || 1));

  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  const clipped = clipDirtyRegions(ctx, options.dirtyRegions);

  ctx.clearRect(0, 0, w, h);
  const canvasBackground = resolvePaintStyle(ctx, snapshot.canvas.background, {
    x: 0,
    y: 0,
    width: w,
    height: h,
  }, "#f2ece4");
  ctx.fillStyle = canvasBackground;
  ctx.fillRect(0, 0, w, h);

  const nodeById = new Map(snapshot.nodes.map((node) => [node.id, node] as const));
  const clipAncestorsById = new Map<string, SceneSnapshotNode[]>();
  const effectiveOpacityById = new Map<string, number>();
  const resolveEffectiveOpacity = (node: SceneSnapshotNode): number => {
    const cached = effectiveOpacityById.get(node.id);
    if (cached != null) return cached;
    let opacity = clamp01(Number(node.style?.opacity ?? 1));
    const seen = new Set<string>();
    let cursorId: string | null = String(node.parent_id || "").trim() || null;
    while (cursorId) {
      if (seen.has(cursorId)) break;
      seen.add(cursorId);
      const parent = nodeById.get(cursorId) || null;
      if (!parent) break;
      opacity *= clamp01(Number(parent.style?.opacity ?? 1));
      cursorId = String(parent.parent_id || "").trim() || null;
    }
    const resolved = clamp01(opacity);
    effectiveOpacityById.set(node.id, resolved);
    return resolved;
  };
  const resolveClipAncestors = (node: SceneSnapshotNode): SceneSnapshotNode[] => {
    const cached = clipAncestorsById.get(node.id);
    if (cached) return cached;
    const out: SceneSnapshotNode[] = [];
    const seen = new Set<string>();
    let cursorId: string | null = node.parent_id || null;
    while (cursorId) {
      if (seen.has(cursorId)) break;
      seen.add(cursorId);
      const parent = nodeById.get(cursorId) || null;
      if (!parent) break;
      if (parent.geometry?.clip) out.push(parent);
      cursorId = parent.parent_id || null;
    }
    const ordered = out.reverse();
    clipAncestorsById.set(node.id, ordered);
    return ordered;
  };

  for (const n of snapshot.nodes) {
    if (n.style?.visible === false) continue;
    if (!nodeIntersectsDirtyRegions(n, options.dirtyRegions)) continue;
    const effectiveOpacity = resolveEffectiveOpacity(n);
    if (effectiveOpacity <= 0.0001) continue;
    const g = n.geometry;
    ctx.globalAlpha = effectiveOpacity;
    const fill = resolvePaintStyle(ctx, n.style?.fill, {
      x: Number(g.x || 0),
      y: Number(g.y || 0),
      width: Math.max(1, Number(g.width || 0)),
      height: Math.max(1, Number(g.height || 0)),
    }, "rgba(0,0,0,0)");
    const strokeBounds = n.kind === "line" ? lineBounds(n) : {
      x: Number(g.x || 0),
      y: Number(g.y || 0),
      width: Math.max(1, Number(g.width || 0)),
      height: Math.max(1, Number(g.height || 0)),
    };
    const normalizedStrokes = normalizeStrokeStackFromNode(n as unknown as {
      kind?: unknown;
      style?: Record<string, unknown>;
      text_style?: Record<string, unknown>;
    });
    const renderStrokes: RenderStrokeSpec[] = normalizedStrokes
      .filter((stroke) => (
        stroke.enabled !== false
        && stroke.visible !== false
        && Number(stroke.weight || 0) > 0.0001
        && Number(stroke.opacity ?? 100) > 0
      ))
      .map((stroke) => ({
        paint: resolvePaintStyle(ctx, stroke.color, strokeBounds, "rgba(0,0,0,0)"),
        weight: Math.max(0, Number(stroke.weight || 0)),
        opacity: clampRange(Number(stroke.opacity ?? 100), 0, 100, 100) / 100,
        align: stroke.align === "inside" || stroke.align === "outside" ? stroke.align : "center",
        style: stroke.style === "dash" || stroke.style === "long_dash" || stroke.style === "dotted" ? stroke.style : "solid",
        mode: stroke.mode === "dynamic" || stroke.mode === "brush" ? stroke.mode : "basic",
        widthProfile: stroke.width_profile === "taper_start" || stroke.width_profile === "taper_end" || stroke.width_profile === "taper_both"
          ? stroke.width_profile
          : "uniform",
        widthProfileFlip: Boolean(stroke.width_profile_flip),
        join: stroke.join === "miter" || stroke.join === "bevel" ? stroke.join : "round",
        cap: stroke.cap === "butt" || stroke.cap === "square" ? stroke.cap : "round",
        miterLimit: Math.max(0.2, Number(stroke.miter_limit || 4)),
        dynamicFrequency: clampRange(Number(stroke.dynamic_frequency || 0), 0, 100, 0),
        dynamicMovement: clampRange(Number(stroke.dynamic_movement || 0), 0, 100, 0),
        dynamicSmooth: clampRange(Number(stroke.dynamic_smooth || 100), 0, 100, 100),
        brushPreset: stroke.brush_preset === "marker" || stroke.brush_preset === "chalk" || stroke.brush_preset === "spray"
          ? stroke.brush_preset
          : "ink",
        brushFlip: Boolean(stroke.brush_flip),
        sides: {
          top: stroke.sides?.top !== false,
          right: stroke.sides?.right !== false,
          bottom: stroke.sides?.bottom !== false,
          left: stroke.sides?.left !== false,
        },
      }));
    const primaryStroke = renderStrokes[0] || null;
    const strokeW = primaryStroke ? computeStrokeWidth(primaryStroke) : 0;
    const strokeSpec = primaryStroke
      ? {
          cap: primaryStroke.cap,
          join: primaryStroke.join,
          miter_limit: primaryStroke.miterLimit,
          align: primaryStroke.align,
          style: primaryStroke.style,
          mode: primaryStroke.mode,
          width_profile: primaryStroke.widthProfile,
          width_profile_flip: primaryStroke.widthProfileFlip,
          dynamic_frequency: primaryStroke.dynamicFrequency,
          dynamic_movement: primaryStroke.dynamicMovement,
          dynamic_smooth: primaryStroke.dynamicSmooth,
          brush_preset: primaryStroke.brushPreset,
          brush_flip: primaryStroke.brushFlip,
          sides: primaryStroke.sides,
          // line_kind drives arrowhead rendering but is NOT preserved by the
          // stroke-stack normalization — read it from the node's raw stroke so
          // the Arrow tool actually draws a head (not a plain line).
          line_kind: (() => {
            const style = (n as { style?: Record<string, unknown> }).style || {};
            const single = style.stroke as Record<string, unknown> | undefined;
            if (single && typeof single === "object" && single.line_kind) return single.line_kind;
            const stack = style.strokes as Array<Record<string, unknown>> | undefined;
            if (Array.isArray(stack)) {
              const withKind = stack.find((s) => s && typeof s === "object" && (s as Record<string, unknown>).line_kind);
              if (withKind) return (withKind as Record<string, unknown>).line_kind;
            }
            return undefined;
          })(),
        }
      : null;
    const frameHasImage = n.kind === "frame" && hasImageSource(n);
    const clipAncestors = resolveClipAncestors(n);

    ctx.save();
    if (clipAncestors.length) {
      for (const clipNode of clipAncestors) {
        const clipGeom = clipNode.geometry;
        ctx.save();
        applyGeometryCanvasTransform(ctx, clipGeom);
        const fillRule = appendClipNodePath(ctx, clipNode);
        ctx.restore();
        if (fillRule) ctx.clip(fillRule);
      }
    }
    applyGeometryCanvasTransform(ctx, g);
    const drawSpec: NodeDrawSpec = {
      fill,
      strokes: renderStrokes,
      strokeW,
      strokeSpec,
      frameHasImage,
    };
    const drawResources: NodeDrawResources = {
      imageCache: options.imageCache,
      textMetricsCache: options.textMetricsCache,
    };
    const activeEffects = normalizeLayerEffectList(n.style?.effects);
    const usedEffects = activeEffects.length > 0
      && drawNodeWithEffects(ctx, n, drawSpec, drawResources, activeEffects, pixelRatio);
    if (!usedEffects) {
      drawNodeContent(ctx, n, drawSpec, drawResources);
    }

    ctx.restore();
  }

  ctx.globalAlpha = 1;

  if (snapshot.selectionBounds) {
    const b = snapshot.selectionBounds;
    ctx.save();
    ctx.strokeStyle = "rgba(126, 167, 255, 0.9)";
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    ctx.restore();
  }

  if (snapshot.guides.length) {
    ctx.save();
    for (const g of snapshot.guides) {
      const tone = guideTone(g.source);
      ctx.save();
      ctx.strokeStyle = tone.glow;
      ctx.lineWidth = g.source === "grid" ? 3 : 4;
      ctx.setLineDash([]);
      if (g.axis === "x") {
        ctx.beginPath();
        ctx.moveTo(g.value, 0);
        ctx.lineTo(g.value, h);
      } else {
        ctx.beginPath();
        ctx.moveTo(0, g.value);
        ctx.lineTo(w, g.value);
      }
      ctx.stroke();
      ctx.strokeStyle = tone.line;
      ctx.lineWidth = g.source === "grid" ? 1 : 1.5;
      ctx.setLineDash(tone.dash);
      if (g.axis === "x") {
        ctx.beginPath();
        ctx.moveTo(g.value, 0);
        ctx.lineTo(g.value, h);
      } else {
        ctx.beginPath();
        ctx.moveTo(0, g.value);
        ctx.lineTo(w, g.value);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      drawGuideBadge(ctx, g, w, h);
      ctx.restore();
    }
    ctx.restore();
  }

  if (clipped) ctx.restore();
}
