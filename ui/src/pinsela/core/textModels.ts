import type {
  PinselaNode,
  PinselaTemplateDocV1,
  PinselaTextModel,
  PinselaTextFitRule,
  PinselaTextPath,
  PinselaTextRun,
  PinselaTextStyle,
} from "./types";

type ResolvedTextSegment = {
  start: number;
  end: number;
  text: string;
  style: PinselaTextStyle;
};

export type RichTextLayoutSegment = {
  text: string;
  style: PinselaTextStyle;
  x: number;
  width: number;
  isWhitespace: boolean;
};

export type RichTextLayoutLine = {
  x: number;
  y: number;
  width: number;
  height: number;
  baseline: number;
  segments: RichTextLayoutSegment[];
};

const DEFAULT_TEXT_STYLE: PinselaTextStyle = Object.freeze({
  family: "Inter",
  style: "Regular",
  postscript: "Inter-Regular",
  size: 42,
  line_height: 110,
  line_height_unit: "percent",
  letter_spacing: 0,
  text_align: "left",
  vertical_align: "top",
  color: "#111111",
  underline: false,
});

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  if (numeric <= min) return min;
  if (numeric >= max) return max;
  return numeric;
}

function normalizeTextPath(path: PinselaTextPath | null | undefined): PinselaTextPath | null {
  if (!path) return null;
  if (path.type === "bezier") {
    return {
      ...path,
      type: "bezier",
      points: Array.isArray(path.points)
        ? path.points
            .filter((point) => point && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y)))
            .map((point) => ({ x: Number(point.x || 0), y: Number(point.y || 0) }))
        : [],
      start_offset: Number.isFinite(Number(path.start_offset)) ? Number(path.start_offset) : undefined,
      reverse: Boolean(path.reverse),
      anchor: path.anchor === "start" || path.anchor === "end" ? path.anchor : "center",
      baseline_shift: Number.isFinite(Number(path.baseline_shift)) ? Number(path.baseline_shift) : undefined,
    };
  }
  return {
    ...path,
    type: "arc",
    radius: clampNumber(path.radius, 0, 20000, 120),
    start_angle: Number.isFinite(Number(path.start_angle)) ? Number(path.start_angle) : 0,
    sweep_angle: Number.isFinite(Number(path.sweep_angle)) ? Number(path.sweep_angle) : 180,
    clockwise: path.clockwise !== false,
    start_offset: Number.isFinite(Number(path.start_offset)) ? Number(path.start_offset) : undefined,
    reverse: Boolean(path.reverse),
    anchor: path.anchor === "start" || path.anchor === "end" ? path.anchor : "center",
    baseline_shift: Number.isFinite(Number(path.baseline_shift)) ? Number(path.baseline_shift) : undefined,
  };
}

function normalizeTextFitRule(
  fit: PinselaTextFitRule | null | undefined,
  style: PinselaTextStyle,
): PinselaTextFitRule | null {
  if (!fit || typeof fit !== "object") return null;
  const startSize = clampNumber(fit.start_size, 1, 2000, Number(style.size || DEFAULT_TEXT_STYLE.size || 42));
  const minSize = clampNumber(fit.min_size == null ? undefined : fit.min_size, 1, startSize, Math.min(startSize, 6));
  const maxLinesRaw = Number(fit.max_lines);
  const minLinesRaw = Number(fit.min_lines);
  const truncateMode =
    fit.truncate_mode === "cut" || fit.truncate_mode === "ellipsis"
      ? fit.truncate_mode
      : "none";
  return {
    start_size: startSize,
    min_size: minSize,
    max_lines: Number.isFinite(maxLinesRaw) && maxLinesRaw > 0 ? Math.round(maxLinesRaw) : null,
    min_lines: Number.isFinite(minLinesRaw) && minLinesRaw > 0 ? Math.round(minLinesRaw) : null,
    truncate_mode: truncateMode,
  };
}

export function resolveTextModel(node: Pick<PinselaNode, "kind" | "text_model"> | null | undefined): PinselaTextModel | null {
  if (!node || node.kind !== "text") return null;
  return node.text_model === "rich" ? "rich" : "legacy";
}

/**
 * Bridge a composer-authored text color (`style.fill`) into the editor's
 * canonical `text_style.color`, in place.
 *
 * The composer puts text color in `style.fill`; the editor's color picker and
 * autosave read/write `text_style.color`. If a text node ships without an
 * explicit `text_style.color`, a later normalize/autosave injects the
 * `#111111` default into it, which then overrides `style.fill` — turning text
 * near-black in the editor while the exported PNG (which falls back to fill)
 * keeps the authored color. Copying fill -> text_style.color on load keeps both
 * renderers in agreement.
 *
 * Conservative: only acts on text nodes, only when `style.fill` is a solid
 * color string, and never overwrites an explicit `text_style.color` (a user
 * color edit only updates `text_style.color`, leaving `style.fill` stale).
 */
export function bridgeTextColorFromFill(node: any): void {
  if (!node || typeof node !== "object" || node.kind !== "text") return;
  if (!node.text_style || typeof node.text_style !== "object") node.text_style = {};
  const fill = node.style && typeof node.style === "object" ? node.style.fill : undefined;
  const solidFill = typeof fill === "string" ? fill.trim() : "";
  if (!solidFill) return; // only solid string fills are bridgeable
  const current = node.text_style.color;
  const isAbsent = current == null || current === "";
  // Self-heal the injected default: normalizeTextStyle stamps
  // DEFAULT_TEXT_STYLE.color (#111111) into text_style.color when a composer
  // node ships without one, and that injected value then overrides the authored
  // fill. Treat that exact sentinel as "not authored" so the fill wins — but
  // only when the fill is a *different* solid color, so genuinely-black text
  // (fill === #111111) is left alone and a real user color edit (any value
  // other than the sentinel) is always preserved. This makes every load
  // self-correct, independent of which doc representation or autosave state.
  const isInjectedDefault = current === DEFAULT_TEXT_STYLE.color && solidFill !== DEFAULT_TEXT_STYLE.color;
  if (isAbsent || isInjectedDefault) {
    node.text_style.color = solidFill;
  }
}

export function normalizeTextStyle(style: Partial<PinselaTextStyle> | null | undefined): PinselaTextStyle {
  const source = style || {};
  return {
    family: String(source.family || DEFAULT_TEXT_STYLE.family),
    postscript: source.postscript != null ? String(source.postscript) : String(DEFAULT_TEXT_STYLE.postscript),
    style: String(source.style || DEFAULT_TEXT_STYLE.style),
    size: clampNumber(source.size, 1, 2000, Number(DEFAULT_TEXT_STYLE.size || 42)),
    line_height: clampNumber(source.line_height, 1, 4000, Number(DEFAULT_TEXT_STYLE.line_height || 110)),
    line_height_unit: source.line_height_unit === "px" ? "px" : "percent",
    letter_spacing: Number.isFinite(Number(source.letter_spacing)) ? Number(source.letter_spacing) : Number(DEFAULT_TEXT_STYLE.letter_spacing || 0),
    text_align: source.text_align === "center" || source.text_align === "right" || source.text_align === "justify"
      ? source.text_align
      : "left",
    vertical_align: source.vertical_align === "center" || source.vertical_align === "bottom"
      ? source.vertical_align
      : "top",
    underline: Boolean(source.underline),
    color: source.color ?? DEFAULT_TEXT_STYLE.color,
  };
}

function sanitizeSingleTextRun(textLength: number, run: PinselaTextRun | null | undefined): PinselaTextRun | null {
  if (!run || typeof run !== "object") return null;
  const start = Math.max(0, Math.min(textLength, Math.round(Number(run.start || 0))));
  const end = Math.max(start, Math.min(textLength, Math.round(Number(run.end || 0))));
  if (end <= start) return null;
  return {
    start,
    end,
    style: { ...(run.style || {}) },
  };
}

export function sanitizeTextRuns(text: string, runs: PinselaTextRun[] | null | undefined): PinselaTextRun[] {
  const length = String(text || "").length;
  if (!Array.isArray(runs) || !runs.length || length <= 0) return [];
  return runs
    .map((run) => sanitizeSingleTextRun(length, run))
    .filter(Boolean)
    .sort((left, right) => (
      Number(left!.start || 0) - Number(right!.start || 0)
      || Number(left!.end || 0) - Number(right!.end || 0)
    )) as PinselaTextRun[];
}

export function normalizeTextNode(node: PinselaNode): PinselaNode {
  if (node.kind !== "text") return node;
  const text = String(node.text ?? "");
  const textStyle = normalizeTextStyle(node.text_style);
  return {
    ...node,
    text,
    text_model: resolveTextModel(node) || "legacy",
    text_style: textStyle,
    text_runs: sanitizeTextRuns(text, node.text_runs),
    text_path: normalizeTextPath(node.text_path),
    fit: normalizeTextFitRule(node.fit, textStyle),
  };
}

export function normalizeTextDoc(doc: PinselaTemplateDocV1): PinselaTemplateDocV1 {
  return {
    ...doc,
    nodes: (doc.nodes || []).map((node) => normalizeTextNode(node)),
  };
}

export function updateTextNodeContent(node: PinselaNode, nextText: string): PinselaNode {
  if (node.kind !== "text") return node;
  const normalizedText = String(nextText ?? "");
  const previousText = String(node.text ?? "");
  return {
    ...node,
    text: normalizedText,
    text_runs: normalizedText === previousText ? sanitizeTextRuns(normalizedText, node.text_runs) : [],
  };
}

export function buildResolvedTextSegments(
  text: string,
  baseStyle: Partial<PinselaTextStyle> | null | undefined,
  runs: PinselaTextRun[] | null | undefined,
): ResolvedTextSegment[] {
  const content = String(text || "");
  if (!content.length) return [];
  const normalizedBase = normalizeTextStyle(baseStyle);
  const normalizedRuns = sanitizeTextRuns(content, runs);
  if (!normalizedRuns.length) {
    return [{
      start: 0,
      end: content.length,
      text: content,
      style: normalizedBase,
    }];
  }

  const boundaries = new Set<number>([0, content.length]);
  normalizedRuns.forEach((run) => {
    boundaries.add(run.start);
    boundaries.add(run.end);
  });
  const ordered = Array.from(boundaries).sort((left, right) => left - right);
  const segments: ResolvedTextSegment[] = [];

  for (let index = 0; index < ordered.length - 1; index += 1) {
    const start = ordered[index];
    const end = ordered[index + 1];
    if (end <= start) continue;
    const sliceText = content.slice(start, end);
    if (!sliceText) continue;
    let style = normalizedBase;
    normalizedRuns.forEach((run) => {
      if (run.start <= start && run.end >= end) {
        style = normalizeTextStyle({
          ...style,
          ...(run.style || {}),
        });
      }
    });
    segments.push({
      start,
      end,
      text: sliceText,
      style,
    });
  }

  return segments;
}

export function textStyleFingerprint(style: Partial<PinselaTextStyle> | null | undefined): string {
  const normalized = normalizeTextStyle(style);
  return JSON.stringify([
    normalized.family || "",
    normalized.postscript || "",
    normalized.style || "",
    Number(normalized.size || 0),
    Number(normalized.line_height || 0),
    normalized.line_height_unit || "percent",
    Number(normalized.letter_spacing || 0),
    normalized.text_align || "left",
    normalized.vertical_align || "top",
    Boolean(normalized.underline),
    normalized.color ?? "",
  ]);
}

export function buildCanvasFontFromTextStyle(style: Partial<PinselaTextStyle> | null | undefined): string {
  const normalized = normalizeTextStyle(style);
  const size = Math.max(1, Number(normalized.size || 24));
  const rawStyle = String(normalized.style || "").toLowerCase();
  const family = String(normalized.family || "Inter").trim() || "Inter";
  const italic = rawStyle.includes("italic") ? "italic " : "";
  let weight = "400";
  if (rawStyle.includes("thin")) weight = "100";
  else if (rawStyle.includes("extralight") || rawStyle.includes("ultralight")) weight = "200";
  else if (rawStyle.includes("light")) weight = "300";
  else if (rawStyle.includes("medium")) weight = "500";
  else if (rawStyle.includes("semibold") || rawStyle.includes("demibold")) weight = "600";
  else if (rawStyle.includes("extrabold") || rawStyle.includes("ultrabold")) weight = "800";
  else if (rawStyle.includes("black") || rawStyle.includes("heavy")) weight = "900";
  else if (rawStyle.includes("bold")) weight = "700";
  return `${italic}${weight} ${size}px "${family}", "Arial", sans-serif`;
}

// --- Leading-trim: real vertical font metrics ---------------------------
// The old renderer placed the 1st line at `top + 0.82*lineHeight`, so the gap
// above the letters GREW with the line height. The right approach is to pin the
// 1st baseline at the font's ASCENDER (independent of line height) and use line
// height only as spacing BETWEEN lines. These (cached) metrics are shared by the
// painter, the auto-hug measurement and the editing textarea so all three agree.
let _fontVMetricsCanvas: HTMLCanvasElement | null = null;
let _fontVMetricsCtx: CanvasRenderingContext2D | null = null;
const _fontVMetricsCache = new Map<string, { ascent: number; descent: number }>();

export function getFontVerticalMetrics(
  style: Partial<PinselaTextStyle> | null | undefined,
): { ascent: number; descent: number } {
  const normalized = normalizeTextStyle(style);
  const size = Math.max(1, Number(normalized.size || 24));
  const font = buildCanvasFontFromTextStyle(normalized);
  const cached = _fontVMetricsCache.get(font);
  if (cached) return cached;
  // Proportional fallback (Inter ≈ 0.97/0.24) in case canvas/measurement is unavailable.
  let ascent = size * 0.97;
  let descent = size * 0.24;
  try {
    if (!_fontVMetricsCtx && typeof document !== "undefined") {
      _fontVMetricsCanvas = document.createElement("canvas");
      _fontVMetricsCtx = _fontVMetricsCanvas.getContext("2d");
    }
    if (_fontVMetricsCtx) {
      _fontVMetricsCtx.font = font;
      const m = _fontVMetricsCtx.measureText("Á�qgjpyhlf");
      if (Number.isFinite(m.fontBoundingBoxAscent) && m.fontBoundingBoxAscent > 0) ascent = m.fontBoundingBoxAscent;
      if (Number.isFinite(m.fontBoundingBoxDescent) && m.fontBoundingBoxDescent > 0) descent = m.fontBoundingBoxDescent;
    }
  } catch {
    // keep fallback
  }
  const result = { ascent, descent };
  _fontVMetricsCache.set(font, result);
  return result;
}

// Vertical layout with leading-trim, given the font size, line height (px) and
// the line count. firstBaseline = offset of the first baseline from the top of the box.
export function leadingTrimmedTextLayout(
  style: Partial<PinselaTextStyle> | null | undefined,
  lineHeightPx: number,
  lineCount: number,
): { firstBaseline: number; lineStep: number; totalHeight: number; topTrim: number } {
  const { ascent, descent } = getFontVerticalMetrics(style);
  const n = Math.max(1, lineCount);
  const lineStep = Math.max(1, Number(lineHeightPx) || 0);
  return {
    firstBaseline: ascent,
    lineStep,
    totalHeight: ascent + (n - 1) * lineStep + descent,
    // How far the 1st line "moved up" relative to the CSS half-leading model.
    topTrim: Math.max(0, (lineStep - (ascent + descent)) / 2),
  };
}

type TextMeasureContext = {
  font: string;
  measureText: (text: string) => { width: number };
};

type RichTextToken = {
  text: string;
  style: PinselaTextStyle;
  isWhitespace: boolean;
  isNewline: boolean;
  width: number;
  lineHeight: number;
};

function textStyleLineHeight(style: PinselaTextStyle): number {
  const size = Math.max(1, Number(style.size || 24));
  const raw = Number(style.line_height || 0);
  if (String(style.line_height_unit || "percent") === "px") {
    return Math.max(size * 0.6, raw || size * 1.1);
  }
  return Math.max(size * 0.6, size * Math.max(0.4, raw || 1.1) / 100);
}

function measureTextWithStyle(
  ctx: TextMeasureContext,
  text: string,
  style: PinselaTextStyle,
  cache?: Map<string, number>,
): number {
  const font = buildCanvasFontFromTextStyle(style);
  const key = `${font}::${text}`;
  if (cache?.has(key)) return Number(cache.get(key) || 0);
  ctx.font = font;
  const letterSpacing = Number(style.letter_spacing || 0);
  const width = ctx.measureText(text).width + Math.max(0, text.length - 1) * letterSpacing;
  if (cache) cache.set(key, width);
  return width;
}

function tokenizeTextSegments(
  ctx: TextMeasureContext,
  segments: ResolvedTextSegment[],
  cache?: Map<string, number>,
): RichTextToken[] {
  const out: RichTextToken[] = [];
  for (const segment of segments) {
    const parts = segment.text.match(/\n|[^\S\n]+|[^\s\n]+/g) || [];
    for (const part of parts) {
      const isNewline = part === "\n";
      const isWhitespace = !isNewline && /^[^\S\n]+$/.test(part);
      out.push({
        text: part,
        style: segment.style,
        isWhitespace,
        isNewline,
        width: isNewline ? 0 : measureTextWithStyle(ctx, part, segment.style, cache),
        lineHeight: textStyleLineHeight(segment.style),
      });
    }
  }
  return out;
}

function splitTokenIntoCharacters(
  ctx: TextMeasureContext,
  token: RichTextToken,
  cache?: Map<string, number>,
): RichTextToken[] {
  return [...token.text].map((char) => ({
    text: char,
    style: token.style,
    isWhitespace: /\s/.test(char),
    isNewline: char === "\n",
    width: char === "\n" ? 0 : measureTextWithStyle(ctx, char, token.style, cache),
    lineHeight: token.lineHeight,
  }));
}

export function layoutRichTextLines(
  ctx: TextMeasureContext,
  options: {
    text: string;
    baseStyle?: Partial<PinselaTextStyle> | null;
    textRuns?: PinselaTextRun[] | null;
    width: number;
    height: number;
  },
  cache?: Map<string, number>,
): RichTextLayoutLine[] {
  const text = String(options.text || "");
  if (!text.length) return [];
  const baseStyle = normalizeTextStyle(options.baseStyle);
  const maxWidth = Math.max(1, Number(options.width || 0));
  const segments = buildResolvedTextSegments(text, baseStyle, options.textRuns);
  const tokens = tokenizeTextSegments(ctx, segments, cache);
  const lines: Array<{ tokens: RichTextToken[]; width: number; height: number }> = [];
  let current = { tokens: [] as RichTextToken[], width: 0, height: textStyleLineHeight(baseStyle) };

  const pushLine = (force = false): void => {
    if (!current.tokens.length && !force) return;
    lines.push(current);
    current = { tokens: [], width: 0, height: textStyleLineHeight(baseStyle) };
  };

  for (const token of tokens) {
    if (token.isNewline) {
      pushLine(true);
      continue;
    }
    const parts = !token.isWhitespace && token.width > maxWidth
      ? splitTokenIntoCharacters(ctx, token, cache)
      : [token];

    for (const part of parts) {
      if (part.isNewline) {
        pushLine(true);
        continue;
      }
      if (part.isWhitespace && !current.tokens.length) continue;
      const nextWidth = current.width + part.width;
      const shouldWrap = current.tokens.length > 0 && nextWidth > maxWidth && !part.isWhitespace;
      if (shouldWrap) {
        pushLine(false);
      }
      if (part.isWhitespace && !current.tokens.length) continue;
      if (part.isWhitespace && current.tokens.length > 0 && current.width + part.width > maxWidth) {
        pushLine(false);
        continue;
      }
      current.tokens.push(part);
      current.width += part.width;
      current.height = Math.max(current.height, part.lineHeight);
    }
  }
  pushLine(false);

  const totalHeight = lines.reduce((sum, line) => sum + line.height, 0);
  let cursorY = 0;
  if (baseStyle.vertical_align === "center") {
    cursorY = Math.max(0, (Math.max(1, Number(options.height || 0)) - totalHeight) / 2);
  } else if (baseStyle.vertical_align === "bottom") {
    cursorY = Math.max(0, Math.max(1, Number(options.height || 0)) - totalHeight);
  }

  return lines.map((line, index) => {
    const breakableSpaces = line.tokens.filter((token) => token.isWhitespace);
    const allowJustify = baseStyle.text_align === "justify" && index < lines.length - 1 && breakableSpaces.length > 0;
    const extraGap = allowJustify ? Math.max(0, maxWidth - line.width) / breakableSpaces.length : 0;
    const actualWidth = allowJustify ? maxWidth : line.width;
    let startX = 0;
    if (!allowJustify && baseStyle.text_align === "center") {
      startX = Math.max(0, (maxWidth - line.width) / 2);
    } else if (!allowJustify && baseStyle.text_align === "right") {
      startX = Math.max(0, maxWidth - line.width);
    }

    let cursorX = startX;
    const laidOutSegments: RichTextLayoutSegment[] = line.tokens.map((token) => {
      const width = token.width + (allowJustify && token.isWhitespace ? extraGap : 0);
      const segment: RichTextLayoutSegment = {
        text: token.text,
        style: token.style,
        x: cursorX,
        width,
        isWhitespace: token.isWhitespace,
      };
      cursorX += width;
      return segment;
    });

    const laidOutLine: RichTextLayoutLine = {
      x: startX,
      y: cursorY,
      width: actualWidth,
      height: line.height,
      baseline: cursorY + line.height * 0.82,
      segments: laidOutSegments,
    };
    cursorY += line.height;
    return laidOutLine;
  });
}
