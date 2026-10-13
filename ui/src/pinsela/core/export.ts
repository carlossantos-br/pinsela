import type { PinselaNode, PinselaTemplateDocV1 } from "./types";
import { getPathFillRule, getPathSubpaths } from "./pathData";
import {
  buildCanvasFontFromTextStyle,
  layoutRichTextLines,
  normalizeTextStyle,
  resolveTextModel,
} from "./textModels";
import { createSceneSnapshot } from "../engine/render/snapshot";
import { paintSceneSnapshotToContext } from "../engine/render/canvas2dPainter";
import { collectDocImageSources, preloadCanvasImages } from "./imageAssets";

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

type TextStrokeStyle = {
  paint: ScenePaint;
  width: number;
  dash: number[];
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
  ctx: CanvasRenderingContext2D,
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
  const halfSpan = Math.max(1, Math.hypot(width, height) / 2);
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
  ctx: CanvasRenderingContext2D,
  rawPaint: unknown,
  bounds: { x: number; y: number; width: number; height: number },
  fallback: string,
): ScenePaint {
  const gradient = normalizeGradientPaint(rawPaint, fallback);
  if (gradient) return createGradientForBounds(ctx, bounds, gradient);
  return rgba(rawPaint, fallback);
}

function lineBounds(node: PinselaNode): { x: number; y: number; width: number; height: number } {
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

function roundedRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
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

function ellipsePath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const rx = Math.max(0, Math.abs(Number(w || 0)) / 2);
  const ry = Math.max(0, Math.abs(Number(h || 0)) / 2);
  ctx.beginPath();
  ctx.ellipse(x + Number(w || 0) / 2, y + Number(h || 0) / 2, rx, ry, 0, 0, Math.PI * 2);
  ctx.closePath();
}

function polygonPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, sides: number) {
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
  ctx: CanvasRenderingContext2D,
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

function rectShapeType(node: PinselaNode): "rect" | "ellipse" | "polygon" | "star" {
  if (node.kind !== "rect") return "rect";
  const raw = String((node.style as any)?.shape_type || "").toLowerCase();
  if (raw === "ellipse" || raw === "polygon" || raw === "star") return raw;
  return "rect";
}

function shapePath(ctx: CanvasRenderingContext2D, node: PinselaNode): void {
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

function readPathSubpaths(node: PinselaNode): ResolvedPathSubpath[] {
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

function appendPathSegment(ctx: CanvasRenderingContext2D, from: PathAnchorPoint, to: PathAnchorPoint) {
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
  ctx: CanvasRenderingContext2D,
  node: PinselaNode,
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
    fillRule: getPathFillRule(node.path_data || null),
  };
}

function drawArrowHead(
  ctx: CanvasRenderingContext2D,
  tipX: number,
  tipY: number,
  dirX: number,
  dirY: number,
  size: number,
  wing: number,
  color: CanvasFillStrokeStyles["fillStyle"],
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
  ctx: CanvasRenderingContext2D,
  geometry: PinselaNode["geometry"],
  strokeSpec: Record<string, unknown> | null,
  strokePaint: CanvasFillStrokeStyles["fillStyle"],
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
  ctx: CanvasRenderingContext2D,
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

export type RenderOptions = {
  width?: number;
  height?: number;
  pixelRatio?: number;
  imageCache?: Map<string, HTMLImageElement>;
  guides?: Array<{ axis: "x" | "y"; value: number }>;
  selectionBounds?: { x: number; y: number; w: number; h: number } | null;
  backgroundMode?: "as-is" | "transparent" | "white";
  imageLoadTimeoutMs?: number;
};

export type RasterExportKind = "png" | "jpg" | "webp";
export type ExportKind = RasterExportKind | "pdf";

function encodeAscii(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }
      reject(new Error(`canvas_blob_failed:${type}`));
    }, type, quality);
  });
}

type PdfPageInput = {
  jpegBytes: Uint8Array;
  imageWidth: number;
  imageHeight: number;
  pageWidth: number;
  pageHeight: number;
};

/** Builds one PDF with one page per input (each page is a full-bleed JPEG). */
export function buildPdfBlob(inputs: PdfPageInput[]): Blob {
  if (!inputs.length) throw new Error("pdf_without_pages");
  const objects: Uint8Array[] = [];
  const offsets: number[] = [0];
  let size = PDF_HEADER.length;

  const pushObject = (id: number, parts: Uint8Array[]) => {
    const objBytes = concatBytes([encodeAscii(`${id} 0 obj\n`), ...parts, encodeAscii(`\nendobj\n`)]);
    offsets[id] = size;
    size += objBytes.length;
    objects.push(objBytes);
  };

  // Object layout: 1 catalog, 2 page tree, then per page n: page, image, content.
  const pageObjectId = (n: number) => 3 + n * 3;
  pushObject(1, [encodeAscii("<< /Type /Catalog /Pages 2 0 R >>\n")]);
  pushObject(2, [
    encodeAscii(
      `<< /Type /Pages /Kids [${inputs.map((_, n) => `${pageObjectId(n)} 0 R`).join(" ")}] /Count ${inputs.length} >>\n`,
    ),
  ]);
  inputs.forEach((params, n) => {
    const imageWidth = Math.max(1, Math.round(Number(params.imageWidth || 1)));
    const imageHeight = Math.max(1, Math.round(Number(params.imageHeight || 1)));
    const pageWidth = Math.max(1, Math.round(Number(params.pageWidth || imageWidth)));
    const pageHeight = Math.max(1, Math.round(Number(params.pageHeight || imageHeight)));
    const contentBytes = encodeAscii(`q\n${pageWidth} 0 0 ${pageHeight} 0 0 cm\n/Im0 Do\nQ\n`);
    const pageId = pageObjectId(n);
    pushObject(pageId, [
      encodeAscii(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im0 ${pageId + 1} 0 R >> >> /Contents ${pageId + 2} 0 R >>\n`,
      ),
    ]);
    pushObject(pageId + 1, [
      encodeAscii(
        `<< /Type /XObject /Subtype /Image /Width ${imageWidth} /Height ${imageHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${params.jpegBytes.length} >>\nstream\n`,
      ),
      params.jpegBytes,
      encodeAscii("\nendstream\n"),
    ]);
    pushObject(pageId + 2, [
      encodeAscii(`<< /Length ${contentBytes.length} >>\nstream\n`),
      contentBytes,
      encodeAscii("endstream\n"),
    ]);
  });

  const body = concatBytes(objects);
  const xrefStart = PDF_HEADER.length + body.length;
  const xrefRows = ["xref", `0 ${offsets.length}`, "0000000000 65535 f "];
  for (let id = 1; id < offsets.length; id += 1) {
    xrefRows.push(`${String(offsets[id]).padStart(10, "0")} 00000 n `);
  }
  const xrefBytes = encodeAscii(`${xrefRows.join("\n")}\n`);
  const trailerBytes = encodeAscii(
    `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`,
  );
  return new Blob([concatBytes([PDF_HEADER, body, xrefBytes, trailerBytes])], { type: "application/pdf" });
}

const PDF_HEADER = new Uint8Array([
  0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a,
  0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a,
]);

function getFont(node: PinselaNode): string {
  return buildCanvasFontFromTextStyle(node.text_style);
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
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
      if (!cur && ctx.measureText(token).width <= widthLimit) {
        cur = token;
        continue;
      }

      const candidate = `${cur}${token}`;
      if (cur && ctx.measureText(candidate).width <= widthLimit) {
        cur = candidate;
        continue;
      }

      if (cur) {
        out.push(cur);
        cur = "";
      }

      if (ctx.measureText(token).width <= widthLimit) {
        cur = token;
        continue;
      }

      for (const ch of token) {
        const chunk = `${cur}${ch}`;
        if (!cur || ctx.measureText(chunk).width <= widthLimit) {
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

function drawTextFitted(
  ctx: CanvasRenderingContext2D,
  node: PinselaNode,
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
    });
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
    const fontStr = getFont({ ...node, text_style: { ...ts, size } });
    ctx.font = fontStr;
    lines = wrapLines(ctx, text, g.width);
    const lh = Number(ts.line_height || size * 1.2);
    const lineHeight = String(ts.line_height_unit || "percent") === "percent" ? (size * lh) / 100 : lh;
    const fitsHeight = lineHeight * Math.max(1, lines.length) <= g.height + 0.001;
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

  const fontStr = getFont({ ...node, text_style: { ...ts, size } });
  ctx.font = fontStr;
  const lh = Number(ts.line_height || size * 1.2);
  const lineHeight = String(ts.line_height_unit || "percent") === "percent" ? (size * lh) / 100 : lh;
  ctx.fillStyle = resolvePaintStyle(ctx, ts.color ?? node.style.fill, {
    x: Number(g.x || 0),
    y: Number(g.y || 0),
    width: Math.max(1, Number(g.width || 0)),
    height: Math.max(1, Number(g.height || 0)),
  }, "#111111");
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
  const totalH = lineHeight * Math.max(1, lines.length);
  let y = g.y;
  if (vAlign === "center") y = g.y + Math.max(0, (g.height - totalH) / 2);
  if (vAlign === "bottom") y = g.y + Math.max(0, g.height - totalH);

  const textPath = node.text_path;
  if (textPath && (textPath.type === "arc" || textPath.type === "bezier")) {
    const line = lines.join(" ").trim();
    if (line) {
      drawTextOnPath(ctx, node, line, fontStr, ctx.fillStyle as ScenePaint, hasTextStroke ? textStrokeStyle : null);
    }
    return;
  }

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    let x = g.x;
    const w = ctx.measureText(line).width + Math.max(0, line.length - 1) * letterSpacing;
    const shouldJustify = align === "justify" && lineIndex < lines.length - 1;
    if (!shouldJustify && align === "center") x = g.x + Math.max(0, (g.width - w) / 2);
    if (!shouldJustify && align === "right") x = g.x + Math.max(0, g.width - w);

    if (shouldJustify) {
      const words = line.trim().split(/\s+/).filter(Boolean);
      if (words.length > 1) {
        const baseline = y + lineHeight * 0.82;
        const wordsWidth = words.reduce((acc, word) => (
          acc + ctx.measureText(word).width + Math.max(0, word.length - 1) * letterSpacing
        ), 0);
        const gaps = words.length - 1;
        const baseGap = Math.max(0, ctx.measureText(" ").width + letterSpacing);
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
              charCursor += ctx.measureText(ch).width + (i < word.length - 1 ? letterSpacing : 0);
            }
          }

          const wordWidth = ctx.measureText(word).width + Math.max(0, word.length - 1) * letterSpacing;
          cursor += wordWidth;
          if (wordIndex < words.length - 1) {
            cursor += baseGap + extraGap;
          }
        }
        if (underlineEnabled) {
          ctx.save();
          ctx.strokeStyle = ctx.fillStyle;
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

    const baseline = y + lineHeight * 0.82;
    if (letterSpacing === 0) {
      ctx.fillText(line, x, baseline);
      if (hasTextStroke) ctx.strokeText(line, x, baseline);
    } else {
      let cursor = x;
      for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        ctx.fillText(ch, cursor, baseline);
        if (hasTextStroke) ctx.strokeText(ch, cursor, baseline);
        cursor += ctx.measureText(ch).width + (i < line.length - 1 ? letterSpacing : 0);
      }
    }
    if (underlineEnabled) {
      ctx.save();
      ctx.strokeStyle = ctx.fillStyle;
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

function cubicPoint(p0: { x: number; y: number }, p1: { x: number; y: number }, p2: { x: number; y: number }, p3: { x: number; y: number }, t: number) {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;
  return {
    x: mt2 * mt * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t2 * t * p3.x,
    y: mt2 * mt * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t2 * t * p3.y,
  };
}

function drawTextOnPath(
  ctx: CanvasRenderingContext2D,
  node: PinselaNode,
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

  const points = path.points || [];
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

function createRasterCanvas(width: number, height: number): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

function drawImagePlacement(
  ctx: CanvasRenderingContext2D,
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

function drawImageWithDuotone(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  placement: ImageDrawPlacement,
  duotone: NormalizedImageDuotone,
): void {
  if (!duotone.enabled || duotone.amount <= 0) {
    drawImagePlacement(ctx, image, placement);
    return;
  }
  const targetW = Math.max(1, Math.round(placement.dw));
  const targetH = Math.max(1, Math.round(placement.dh));
  const raster = createRasterCanvas(targetW, targetH);
  if (!raster) {
    drawImagePlacement(ctx, image, placement);
    return;
  }
  const scratchCtx = raster.getContext("2d");
  if (!scratchCtx) {
    drawImagePlacement(ctx, image, placement);
    return;
  }
  scratchCtx.clearRect(0, 0, targetW, targetH);
  if (placement.useSourceRect) {
    scratchCtx.drawImage(image, placement.sx, placement.sy, placement.sw, placement.sh, 0, 0, targetW, targetH);
  } else {
    scratchCtx.drawImage(image, 0, 0, targetW, targetH);
  }
  const frame = scratchCtx.getImageData(0, 0, targetW, targetH);
  applyDuotoneToImageData(frame.data, duotone);
  scratchCtx.putImageData(frame, 0, 0);
  ctx.drawImage(raster, placement.dx, placement.dy, placement.dw, placement.dh);
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

function computeImageDrawPlacement(
  node: PinselaNode,
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
  ctx: CanvasRenderingContext2D,
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
  ctx: CanvasRenderingContext2D,
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

function drawBrushStroke(ctx: CanvasRenderingContext2D, node: PinselaNode, stroke: NormalizedBrushStroke): void {
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

function drawImageBrushStrokes(ctx: CanvasRenderingContext2D, node: PinselaNode): void {
  const rawStrokes = Array.isArray(node.style?.image_brush_strokes) ? node.style.image_brush_strokes : [];
  if (!rawStrokes.length) return;
  const strokes = rawStrokes.map((stroke) => normalizeBrushStroke(stroke)).filter(Boolean) as NormalizedBrushStroke[];
  if (!strokes.length) return;
  for (const stroke of strokes) {
    drawBrushStroke(ctx, node, stroke);
  }
}

function drawImageNode(
  ctx: CanvasRenderingContext2D,
  node: PinselaNode,
  imageCache?: Map<string, HTMLImageElement>
) {
  const src = String(node.image_src || "").trim();
  if (!src || !imageCache) return;
  const img = imageCache.get(src);
  if (!img) return;
  const g = node.geometry;
  const placement = computeImageDrawPlacement(node, img);
  const duotone = normalizeImageDuotone(node.style?.image_duotone);

  const r = Math.max(0, Number(g.corner_radius || 0));
  ctx.save();
  roundedRectPath(ctx, g.x, g.y, g.width, g.height, r);
  ctx.clip();
  try {
    drawImageWithDuotone(ctx, img, placement, duotone);
    drawImageBrushStrokes(ctx, node);
  } catch {
    // Keep export/preview painting resilient when one bitmap cannot be decoded.
  } finally {
    ctx.restore();
  }
}

function hasImageSource(node: Pick<PinselaNode, "image_src">): boolean {
  return String(node.image_src || "").trim().length > 0;
}

function drawFramePlaceholder(ctx: CanvasRenderingContext2D, node: PinselaNode): void {
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

function sortedNodes(doc: PinselaTemplateDocV1): PinselaNode[] {
  return [...doc.nodes].sort((a, b) => (a.geometry.z_index || 0) - (b.geometry.z_index || 0));
}

export async function drawDocToCanvas(
  doc: PinselaTemplateDocV1,
  canvas: HTMLCanvasElement,
  opts: RenderOptions = {}
): Promise<void> {
  const pr = Math.max(1, Number(opts.pixelRatio || 1));
  const w = Math.max(1, Math.round(Number(opts.width || doc.canvas.width)));
  const h = Math.max(1, Math.round(Number(opts.height || doc.canvas.height)));

  canvas.width = Math.round(w * pr);
  canvas.height = Math.round(h * pr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const backgroundMode = opts.backgroundMode || "as-is";
  const background = backgroundMode === "transparent"
    ? "rgba(0,0,0,0)"
    : backgroundMode === "white"
      ? "#ffffff"
      : doc.canvas.background;

  const renderDoc: PinselaTemplateDocV1 = {
    ...doc,
    canvas: {
      ...doc.canvas,
      width: w,
      height: h,
      background,
    },
  };
  const imageCache = opts.imageCache || new Map<string, HTMLImageElement>();
  await preloadCanvasImages(collectDocImageSources(renderDoc), imageCache, {
    timeoutMs: opts.imageLoadTimeoutMs ?? 8000,
  });

  const snapshot = createSceneSnapshot({
    doc: renderDoc,
    guides: (opts.guides || []).map((guide) => ({
      axis: guide.axis,
      value: Number(guide.value || 0),
      source: "object" as const,
    })),
    selectionBounds: opts.selectionBounds || null,
  });

  paintSceneSnapshotToContext(ctx, snapshot, {
    width: w,
    height: h,
    pixelRatio: pr,
    imageCache,
    textMetricsCache: new Map<string, number>(),
    dirtyRegions: null,
  });
}

export async function exportDocDataUrl(
  doc: PinselaTemplateDocV1,
  kind: RasterExportKind,
  opts: RenderOptions = {}
): Promise<string> {
  const canvas = document.createElement("canvas");
  const drawOptions: RenderOptions = {
    ...opts,
    backgroundMode: kind === "jpg" && opts.backgroundMode === "transparent" ? "white" : opts.backgroundMode,
  };
  await drawDocToCanvas(doc, canvas, drawOptions);
  if (kind === "jpg") return canvas.toDataURL("image/jpeg", 0.95);
  if (kind === "webp") return canvas.toDataURL("image/webp", 0.95);
  return canvas.toDataURL("image/png");
}

export async function exportDocBlob(
  doc: PinselaTemplateDocV1,
  kind: ExportKind,
  opts: RenderOptions = {},
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  const opaqueBackground = kind === "jpg" || kind === "pdf";
  const drawOptions: RenderOptions = {
    ...opts,
    backgroundMode: opaqueBackground && opts.backgroundMode === "transparent" ? "white" : opts.backgroundMode,
  };
  const pageWidth = Math.max(1, Math.round(Number(opts.width || doc.canvas.width)));
  const pageHeight = Math.max(1, Math.round(Number(opts.height || doc.canvas.height)));
  await drawDocToCanvas(doc, canvas, drawOptions);

  if (kind === "png") return canvasToBlob(canvas, "image/png");
  if (kind === "jpg") return canvasToBlob(canvas, "image/jpeg", 0.95);
  if (kind === "webp") return canvasToBlob(canvas, "image/webp", 0.95);

  const jpegBlob = await canvasToBlob(canvas, "image/jpeg", 0.95);
  const jpegBytes = new Uint8Array(await jpegBlob.arrayBuffer());
  return buildPdfBlob([{
    jpegBytes,
    imageWidth: canvas.width,
    imageHeight: canvas.height,
    pageWidth,
    pageHeight,
  }]);
}

/** Renders several docs (in order) into ONE multi-page PDF. */
export async function exportDocsToPdfBlob(
  docs: PinselaTemplateDocV1[],
  opts: RenderOptions = {},
): Promise<Blob> {
  const pages: PdfPageInput[] = [];
  for (const doc of docs) {
    const canvas = document.createElement("canvas");
    await drawDocToCanvas(doc, canvas, {
      ...opts,
      backgroundMode: opts.backgroundMode === "transparent" ? "white" : opts.backgroundMode,
    });
    const jpegBlob = await canvasToBlob(canvas, "image/jpeg", 0.95);
    pages.push({
      jpegBytes: new Uint8Array(await jpegBlob.arrayBuffer()),
      imageWidth: canvas.width,
      imageHeight: canvas.height,
      pageWidth: Math.max(1, Math.round(Number(opts.width || doc.canvas.width))),
      pageHeight: Math.max(1, Math.round(Number(opts.height || doc.canvas.height))),
    });
  }
  return buildPdfBlob(pages);
}

/** Packs already-encoded files into a single ZIP (stored, images are already compressed). */
export async function zipFilesBlob(files: Array<{ name: string; blob: Blob }>): Promise<Blob> {
  const { zipSync } = await import("fflate");
  const entries: Record<string, Uint8Array> = {};
  const used = new Set<string>();
  for (const file of files) {
    let name = file.name;
    for (let n = 2; used.has(name); n += 1) name = file.name.replace(/(\.[^.]+)?$/, `-${n}$1`);
    used.add(name);
    entries[name] = new Uint8Array(await file.blob.arrayBuffer());
  }
  const zipped = zipSync(entries, { level: 0 });
  return new Blob([zipped as BlobPart], { type: "application/zip" });
}

/** Small PNG (base64, no prefix) of a doc, longest side <= maxSide. Used for project card previews. */
export async function exportDocThumbnailBase64(
  doc: PinselaTemplateDocV1,
  maxSide: number,
  opts: RenderOptions = {},
): Promise<string> {
  const full = document.createElement("canvas");
  await drawDocToCanvas(doc, full, { ...opts, pixelRatio: 1 });
  const ratio = Math.min(1, Math.max(16, maxSide) / Math.max(1, full.width, full.height));
  const thumb = document.createElement("canvas");
  thumb.width = Math.max(1, Math.round(full.width * ratio));
  thumb.height = Math.max(1, Math.round(full.height * ratio));
  const ctx = thumb.getContext("2d");
  if (!ctx) throw new Error("canvas_2d_unavailable");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(full, 0, 0, thumb.width, thumb.height);
  return toBase64DataUrl(thumb.toDataURL("image/png"));
}

export function toBase64DataUrl(dataUrl: string): string {
  const idx = dataUrl.indexOf(",");
  return idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl;
}
