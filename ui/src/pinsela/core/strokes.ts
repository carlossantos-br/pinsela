import type {
  PinselaStrokeAlign,
  PinselaStrokeAdvancedMode,
  PinselaStrokeBrushPreset,
  PinselaStrokeCap,
  PinselaStrokeDashStyle,
  PinselaStrokeJoin,
  PinselaStrokeSides,
  PinselaStrokeStackItem,
  PinselaStrokeWidthProfile,
} from "./types";

export const STROKE_ALIGN_OPTIONS: PinselaStrokeAlign[] = ["inside", "center", "outside"];
export const STROKE_DASH_OPTIONS: PinselaStrokeDashStyle[] = ["solid", "dash", "long_dash", "dotted"];
export const STROKE_WIDTH_PROFILE_OPTIONS: PinselaStrokeWidthProfile[] = [
  "uniform",
  "taper_start",
  "taper_end",
  "taper_both",
];
export const STROKE_JOIN_OPTIONS: PinselaStrokeJoin[] = ["miter", "bevel", "round"];
export const STROKE_CAP_OPTIONS: PinselaStrokeCap[] = ["round", "butt", "square"];
export const STROKE_ADVANCED_MODES: PinselaStrokeAdvancedMode[] = ["basic", "dynamic", "brush"];
export const STROKE_BRUSH_PRESETS: PinselaStrokeBrushPreset[] = ["ink", "marker", "chalk", "spray"];

export function strokeItemId(prefix = "stroke"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, num));
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  return Math.round(clampNumber(value, fallback, min, max));
}

function normalizeAlign(value: unknown): PinselaStrokeAlign {
  return value === "inside" || value === "outside" ? value : "center";
}

function normalizeDashStyle(value: unknown): PinselaStrokeDashStyle {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "dash" || raw === "long_dash" || raw === "dotted") return raw;
  return "solid";
}

function normalizeWidthProfile(value: unknown): PinselaStrokeWidthProfile {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "taper_start" || raw === "taper_end" || raw === "taper_both") return raw;
  return "uniform";
}

function normalizeJoin(value: unknown): PinselaStrokeJoin {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "miter" || raw === "bevel" || raw === "round") return raw;
  return "round";
}

function normalizeCap(value: unknown): PinselaStrokeCap {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "butt" || raw === "square" || raw === "round") return raw;
  return "round";
}

function normalizeMode(value: unknown): PinselaStrokeAdvancedMode {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "dynamic" || raw === "brush") return raw;
  return "basic";
}

function normalizeBrushPreset(value: unknown): PinselaStrokeBrushPreset {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "marker" || raw === "chalk" || raw === "spray") return raw;
  return "ink";
}

function normalizeStrokeSides(raw: unknown): Required<PinselaStrokeSides> {
  if (!raw || typeof raw !== "object") {
    return { top: true, right: true, bottom: true, left: true };
  }
  const source = raw as Record<string, unknown>;
  return {
    top: source.top !== false,
    right: source.right !== false,
    bottom: source.bottom !== false,
    left: source.left !== false,
  };
}

function dashPresetFromSegments(rawDash: unknown): PinselaStrokeDashStyle {
  const dash = Array.isArray(rawDash)
    ? rawDash.map((value) => Number(value)).filter(Number.isFinite)
    : [];
  if (dash.length === 0) return "solid";
  if (dash.length >= 2 && dash[0] <= 3) return "dotted";
  if (dash.length >= 2 && dash[0] >= 16) return "long_dash";
  return "dash";
}

export function dashPresetToSegments(style: PinselaStrokeDashStyle): number[] {
  if (style === "dash") return [10, 8];
  if (style === "long_dash") return [18, 10];
  if (style === "dotted") return [2, 6];
  return [];
}

export function defaultStrokeStackItem(seed?: Partial<PinselaStrokeStackItem>): PinselaStrokeStackItem {
  return normalizeStrokeStackItem({
    id: seed?.id || strokeItemId(),
    enabled: seed?.enabled ?? true,
    visible: seed?.visible ?? true,
    color: seed?.color ?? "#0f172a",
    opacity: seed?.opacity ?? 100,
    weight: seed?.weight ?? 2,
    align: seed?.align ?? "center",
    style: seed?.style ?? "solid",
    width_profile: seed?.width_profile ?? "uniform",
    width_profile_flip: seed?.width_profile_flip ?? false,
    join: seed?.join ?? "round",
    cap: seed?.cap ?? "round",
    miter_limit: seed?.miter_limit ?? 4,
    mode: seed?.mode ?? "basic",
    dynamic_frequency: seed?.dynamic_frequency ?? 38,
    dynamic_movement: seed?.dynamic_movement ?? 22,
    dynamic_smooth: seed?.dynamic_smooth ?? 72,
    brush_preset: seed?.brush_preset ?? "ink",
    brush_flip: seed?.brush_flip ?? false,
    sides: seed?.sides,
  }, 0);
}

export function normalizeStrokeStackItem(raw: unknown, index: number): PinselaStrokeStackItem {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const sides = normalizeStrokeSides(source.sides);
  const normalized: PinselaStrokeStackItem = {
    id: String(source.id || `stroke_${index}`),
    enabled: source.enabled !== false,
    visible: source.visible !== false,
    color: source.color ?? "#0f172a",
    opacity: clampInt(source.opacity, 100, 0, 100),
    weight: clampNumber(source.weight ?? source.width, 2, 0, 4000),
    align: normalizeAlign(source.align),
    style: normalizeDashStyle(source.style ?? source.dash_preset),
    width_profile: normalizeWidthProfile(source.width_profile),
    width_profile_flip: Boolean(source.width_profile_flip),
    join: normalizeJoin(source.join),
    cap: normalizeCap(source.cap),
    miter_limit: clampNumber(source.miter_limit, 4, 0.2, 180),
    mode: normalizeMode(source.mode),
    dynamic_frequency: clampInt(source.dynamic_frequency, 38, 0, 100),
    dynamic_movement: clampInt(source.dynamic_movement, 22, 0, 100),
    dynamic_smooth: clampInt(source.dynamic_smooth, 72, 0, 100),
    brush_preset: normalizeBrushPreset(source.brush_preset),
    brush_flip: Boolean(source.brush_flip),
    sides,
  };

  return normalized;
}

function fallbackStrokeColorFromNodeLike(node: {
  kind?: unknown;
  style?: Record<string, unknown> | null | undefined;
  text_style?: Record<string, unknown> | null | undefined;
} | null | undefined): unknown {
  if (!node) return "#0f172a";
  if (String(node.kind || "") === "text") {
    return (node.text_style || {}).color ?? (node.style || {}).fill ?? "#0f172a";
  }
  if (String(node.kind || "") === "line") {
    return (node.style || {}).stroke && typeof (node.style || {}).stroke === "object"
      ? ((node.style!.stroke as Record<string, unknown>).color ?? (node.style || {}).fill ?? "#8b6d52")
      : ((node.style || {}).fill ?? "#8b6d52");
  }
  return (node.style || {}).stroke && typeof (node.style || {}).stroke === "object"
    ? ((node.style!.stroke as Record<string, unknown>).color ?? (node.style || {}).fill ?? "#0f172a")
    : ((node.style || {}).fill ?? "#0f172a");
}

function compatStrokeToItem(
  rawCompat: unknown,
  index: number,
  fallbackColor: unknown,
): PinselaStrokeStackItem | null {
  if (!rawCompat) return null;
  if (typeof rawCompat !== "object") {
    return defaultStrokeStackItem({
      id: `compat_${index}`,
      color: rawCompat,
      weight: 1,
      style: "solid",
      cap: "round",
      align: "center",
    });
  }
  const stroke = rawCompat as Record<string, unknown>;
  const weight = clampNumber(stroke.width, 1, 0, 4000);
  if (weight <= 0.0001) return null;
  return normalizeStrokeStackItem({
    id: String(stroke.id || `compat_${index}`),
    enabled: stroke.enabled !== false,
    visible: stroke.visible !== false,
    color: stroke.color ?? fallbackColor,
    opacity: clampInt(stroke.opacity, 100, 0, 100),
    weight,
    align: String(stroke.align || "center"),
    style: dashPresetFromSegments(stroke.dash),
    join: stroke.join,
    cap: stroke.cap,
    miter_limit: stroke.miter_limit,
    mode: stroke.mode,
    width_profile: stroke.width_profile,
    width_profile_flip: stroke.width_profile_flip,
    dynamic_frequency: stroke.dynamic_frequency,
    dynamic_movement: stroke.dynamic_movement,
    dynamic_smooth: stroke.dynamic_smooth,
    brush_preset: stroke.brush_preset,
    brush_flip: stroke.brush_flip,
    sides: stroke.sides,
  }, index);
}

export function normalizeStrokeStackFromNode(node: {
  kind?: unknown;
  style?: Record<string, unknown> | null | undefined;
  text_style?: Record<string, unknown> | null | undefined;
} | null | undefined): PinselaStrokeStackItem[] {
  if (!node) return [];
  const style = node.style || {};
  const rawList = Array.isArray(style.strokes) ? style.strokes : [];
  const fromStack = rawList
    .map((entry, index) => normalizeStrokeStackItem(entry, index))
    .filter((entry) => Number(entry.weight || 0) > 0 || entry.enabled === false || entry.visible === false);
  if (fromStack.length > 0) return fromStack;

  const fallbackColor = fallbackStrokeColorFromNodeLike(node);
  const compat = compatStrokeToItem(style.stroke, 0, fallbackColor);
  if (!compat) return [];
  return [compat];
}

export function compatStrokeFromStack(
  stack: PinselaStrokeStackItem[],
): Record<string, unknown> | null {
  const active = stack.find((entry) => (
    entry.enabled !== false
    && entry.visible !== false
    && Number(entry.weight || 0) > 0
  ));
  if (!active) return null;
  return {
    color: active.color,
    width: Math.max(0, Number(active.weight || 0)),
    dash: dashPresetToSegments(active.style || "solid"),
    cap: active.cap || "round",
    join: active.join || "round",
    miter_limit: Number(active.miter_limit || 4),
    align: active.align || "center",
    mode: active.mode || "basic",
    width_profile: active.width_profile || "uniform",
    width_profile_flip: Boolean(active.width_profile_flip),
    dynamic_frequency: Number(active.dynamic_frequency || 0),
    dynamic_movement: Number(active.dynamic_movement || 0),
    dynamic_smooth: Number(active.dynamic_smooth || 0),
    brush_preset: active.brush_preset || "ink",
    brush_flip: Boolean(active.brush_flip),
    sides: active.sides || { top: true, right: true, bottom: true, left: true },
  };
}

export function sanitizeStrokeStack(stack: unknown): PinselaStrokeStackItem[] {
  const rows = Array.isArray(stack) ? stack : [];
  const normalized = rows
    .map((entry, index) => normalizeStrokeStackItem(entry, index))
    .filter((entry) => String(entry.id || "").trim().length > 0);
  return normalized;
}
