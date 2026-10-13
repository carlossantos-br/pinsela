import React from "react";
import { GlassPanel } from "./GlassPanel";
import { PinselaIcon } from "./PinselaIcon";

export type GradientKind = "linear" | "radial";

export interface GradientStop {
  offset: number;
  color: string;
}

export interface GradientColorValue {
  type: "gradient";
  gradient_type: GradientKind;
  angle: number;
  stops: GradientStop[];
}

export type ColorPickerValue = string | GradientColorValue;
export interface ColorPickerChangeMeta {
  commit?: boolean;
  transient?: boolean;
}

export interface ColorPickerProps {
  color?: unknown;
  onChange?: (color: ColorPickerValue, meta?: ColorPickerChangeMeta) => void;
  onClose?: () => void;
  style?: React.CSSProperties;
  className?: string;
  onMouseDown?: React.MouseEventHandler<HTMLDivElement>;
  allowGradient?: boolean;
  title?: string;
  documentColors?: unknown[];
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

interface ParsedColor {
  rgb: Rgb;
  alpha: number;
}

interface Hsv {
  h: number;
  s: number;
  v: number;
}

const MAX_GRADIENT_STOPS = 12;
const MAX_INLINE_DOCUMENT_COLORS = 14;

interface EyeDropperResult {
  sRGBHex: string;
}

interface EyeDropperInstance {
  open: () => Promise<EyeDropperResult>;
}

interface EyeDropperConstructor {
  new (): EyeDropperInstance;
}

function clampChannel(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function clampPercent(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v)));
}

function clampOffset(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

function normalizeHue(v: number): number {
  if (!Number.isFinite(v)) return 0;
  const mod = v % 360;
  return mod < 0 ? mod + 360 : mod;
}

function toHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((x) => clampChannel(x).toString(16).padStart(2, "0")).join("")}`;
}

function parseHex(raw: string): Rgb | null {
  const value = String(raw || "").trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(value)) {
    return {
      r: Number.parseInt(value[0] + value[0], 16),
      g: Number.parseInt(value[1] + value[1], 16),
      b: Number.parseInt(value[2] + value[2], 16),
    };
  }
  if (!/^[0-9a-fA-F]{6}$/.test(value)) return null;
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
}

function sanitizeHexInput(raw: string): string {
  const source = String(raw || "");
  const hadHash = /^\s*#/.test(source);
  const withoutHash = source.replace(/[^0-9a-fA-F]/g, "").slice(0, 6).toUpperCase();
  if (!withoutHash && !hadHash) return "";
  return hadHash ? `#${withoutHash}` : withoutHash;
}

function hexDigits(raw: string): string {
  return String(raw || "").replace(/[^0-9a-fA-F]/g, "");
}

function parseRgbLike(raw: string): ParsedColor | null {
  const value = String(raw || "").trim();
  const match = value.match(/^rgba?\(([^)]+)\)$/i);
  if (!match) return null;
  const parts = match[1].split(",").map((part) => part.trim());
  if (parts.length < 3) return null;

  const r = clampChannel(Number(parts[0]));
  const g = clampChannel(Number(parts[1]));
  const b = clampChannel(Number(parts[2]));
  if (![r, g, b].every(Number.isFinite)) return null;

  const alphaRaw = parts[3] != null ? Number(parts[3]) : 1;
  const alpha = Number.isFinite(alphaRaw) ? clampPercent(alphaRaw <= 1 ? alphaRaw * 100 : alphaRaw) : 100;
  return { rgb: { r, g, b }, alpha };
}

function parseRgbObject(raw: unknown): ParsedColor | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const rRaw = Number(obj.r);
  const gRaw = Number(obj.g);
  const bRaw = Number(obj.b);
  if (![rRaw, gRaw, bRaw].every(Number.isFinite)) return null;
  const r = rRaw <= 1 ? clampChannel(rRaw * 255) : clampChannel(rRaw);
  const g = gRaw <= 1 ? clampChannel(gRaw * 255) : clampChannel(gRaw);
  const b = bRaw <= 1 ? clampChannel(bRaw * 255) : clampChannel(bRaw);
  const aRaw = Number(obj.a ?? 1);
  const alpha = Number.isFinite(aRaw) ? clampPercent(aRaw <= 1 ? aRaw * 100 : aRaw) : 100;
  return { rgb: { r, g, b }, alpha };
}

function toCssColor(rgb: Rgb, alphaPercent: number): string {
  const alpha = clampPercent(alphaPercent);
  if (alpha >= 100) return toHex(rgb);
  return `rgba(${clampChannel(rgb.r)}, ${clampChannel(rgb.g)}, ${clampChannel(rgb.b)}, ${alpha / 100})`;
}

function rgbToHsv(rgb: Rgb): Hsv {
  const r = clampChannel(rgb.r) / 255;
  const g = clampChannel(rgb.g) / 255;
  const b = clampChannel(rgb.b) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;

  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    h = normalizeHue(h);
  }

  const s = max === 0 ? 0 : d / max;
  const v = max;
  return { h, s, v };
}

function hsvToRgb(hsv: Hsv): Rgb {
  const h = normalizeHue(hsv.h);
  const s = clampOffset(hsv.s);
  const v = clampOffset(hsv.v);
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;

  let rp = 0;
  let gp = 0;
  let bp = 0;

  if (h < 60) [rp, gp, bp] = [c, x, 0];
  else if (h < 120) [rp, gp, bp] = [x, c, 0];
  else if (h < 180) [rp, gp, bp] = [0, c, x];
  else if (h < 240) [rp, gp, bp] = [0, x, c];
  else if (h < 300) [rp, gp, bp] = [x, 0, c];
  else [rp, gp, bp] = [c, 0, x];

  return {
    r: clampChannel((rp + m) * 255),
    g: clampChannel((gp + m) * 255),
    b: clampChannel((bp + m) * 255),
  };
}

function normalizeStopColor(raw: unknown, fallbackColor: string): string {
  const parsed = parseAnyColor(raw);
  if (parsed) return toCssColor(parsed.rgb, parsed.alpha);
  return fallbackColor;
}

function normalizeStops(rawStops: unknown, fallbackColor: string): GradientStop[] {
  const list = Array.isArray(rawStops) ? rawStops : [];
  const normalized = list
    .map((stop) => {
      if (!stop || typeof stop !== "object") return null;
      const entry = stop as Record<string, unknown>;
      return {
        offset: clampOffset(Number(entry.offset ?? 0)),
        color: normalizeStopColor(entry.color, fallbackColor),
      };
    })
    .filter(Boolean) as GradientStop[];

  if (normalized.length >= 2) return normalized;
  if (normalized.length === 1) {
    return [normalized[0], { offset: normalized[0].offset >= 0.5 ? 0 : 1, color: fallbackColor }];
  }
  return [
    { offset: 0, color: "#ffffff" },
    { offset: 1, color: fallbackColor },
  ];
}

export function isGradientColorValue(raw: unknown): raw is GradientColorValue {
  if (!raw || typeof raw !== "object") return false;
  const value = raw as Record<string, unknown>;
  return String(value.type || "").toLowerCase() === "gradient" && Array.isArray(value.stops);
}

function normalizeGradient(raw: unknown, fallbackColor: string): GradientColorValue {
  if (isGradientColorValue(raw)) {
    const kind = String(raw.gradient_type || "linear").toLowerCase() === "radial" ? "radial" : "linear";
    const angle = Number.isFinite(Number(raw.angle)) ? Number(raw.angle) : 90;
    return {
      type: "gradient",
      gradient_type: kind,
      angle: normalizeHue(angle),
      stops: normalizeStops(raw.stops, fallbackColor),
    };
  }

  return {
    type: "gradient",
    gradient_type: "linear",
    angle: 90,
    stops: [
      { offset: 0, color: "#ffffff" },
      { offset: 1, color: fallbackColor },
    ],
  };
}

function parseAnyColor(raw: unknown): ParsedColor | null {
  if (isGradientColorValue(raw)) {
    const base = raw.stops[0]?.color || "#2563eb";
    return parseAnyColor(base);
  }

  if (typeof raw === "string") {
    const rgbLike = parseRgbLike(raw);
    if (rgbLike) return rgbLike;
    const hex = parseHex(raw);
    if (hex) return { rgb: hex, alpha: 100 };
  }

  const rgbObject = parseRgbObject(raw);
  if (rgbObject) return rgbObject;

  return null;
}

function parseAnyColorOrFallback(raw: unknown): ParsedColor {
  return parseAnyColor(raw) || { rgb: { r: 20, g: 184, b: 166 }, alpha: 100 };
}

function fallbackDocumentPalette(color: unknown): unknown[] {
  const base = parseAnyColorOrFallback(color).rgb;
  const fixed = [
    "#ef4444",
    "#f59e0b",
    "#16a34a",
    "#2563eb",
    "#0ea5e9",
    "#6366f1",
    "#a855f7",
    "#ec4899",
    "#ffffff",
    "#94a3b8",
    "#334155",
    "#0f172a",
  ];
  const derived = [
    toHex({ r: base.r, g: base.g, b: base.b }),
    toHex({ r: base.r + 20, g: base.g + 20, b: base.b + 20 }),
    toHex({ r: base.r - 20, g: base.g - 20, b: base.b - 20 }),
  ];
  return [...derived, ...fixed];
}

function serializeColorValue(raw: unknown): string {
  if (isGradientColorValue(raw)) {
    const kind = raw.gradient_type === "radial" ? "radial" : "linear";
    const angle = Math.round(normalizeHue(Number(raw.angle || 0)) * 10) / 10;
    const stops = normalizeStops(raw.stops, "#2563eb")
      .sort((a, b) => a.offset - b.offset)
      .map((stop) => `${Math.round(clampOffset(stop.offset) * 1000) / 10}:${normalizeStopColor(stop.color, "#2563eb").toLowerCase()}`)
      .join("|");
    return `gradient:${kind}:${angle}:${stops}`;
  }
  const parsed = parseAnyColor(raw);
  if (!parsed) return "";
  return toCssColor(parsed.rgb, parsed.alpha).toLowerCase();
}

function normalizeDocumentPalette(colors: unknown[] | undefined, color: unknown): unknown[] {
  const source = Array.isArray(colors) && colors.length > 0 ? colors : fallbackDocumentPalette(color);
  const seen = new Set<string>();
  const out: unknown[] = [];
  for (const entry of source) {
    const key = serializeColorValue(entry);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (isGradientColorValue(entry)) {
      out.push(normalizeGradient(entry, "#2563eb"));
      continue;
    }
    const parsed = parseAnyColor(entry);
    if (!parsed) continue;
    out.push(toCssColor(parsed.rgb, parsed.alpha));
  }
  return out;
}

function formatColorTooltip(raw: unknown): string {
  if (isGradientColorValue(raw)) {
    const kindLabel = raw.gradient_type === "radial" ? "Radial gradient" : "Linear gradient";
    const angle = `${Math.round(normalizeHue(raw.angle) * 10) / 10}deg`;
    const stops = normalizeStops(raw.stops, "#2563eb")
      .sort((a, b) => a.offset - b.offset)
      .map((stop) => `${normalizeStopColor(stop.color, "#2563eb").toUpperCase()} ${Math.round(clampOffset(stop.offset) * 100)}%`)
      .join(", ");
    return `${kindLabel}${raw.gradient_type === "linear" ? ` (${angle})` : ""}: ${stops}`;
  }
  const parsed = parseAnyColor(raw);
  if (!parsed) return "Invalid color";
  const hex = toHex(parsed.rgb).toUpperCase();
  if (parsed.alpha >= 100) return hex;
  return `${hex} at ${parsed.alpha}% opacity`;
}

export function gradientToCss(value: GradientColorValue): string {
  const stops = [...normalizeStops(value.stops, "#2563eb")]
    .sort((a, b) => a.offset - b.offset)
    .map((stop) => `${stop.color} ${Math.round(clampOffset(stop.offset) * 100)}%`)
    .join(", ");
  if (value.gradient_type === "radial") {
    return `radial-gradient(circle at center, ${stops})`;
  }
  return `linear-gradient(${Math.round(Number(value.angle || 0))}deg, ${stops})`;
}

export function colorToCssString(raw: unknown, fallback = "#2563eb"): string {
  if (isGradientColorValue(raw)) return gradientToCss(raw);
  const parsed = parseAnyColor(raw);
  if (!parsed) return fallback;
  return toCssColor(parsed.rgb, parsed.alpha);
}

function sampleGradientColor(value: GradientColorValue, offset: number): string {
  const normalizedOffset = clampOffset(offset);
  const stops = [...normalizeStops(value.stops, "#2563eb")]
    .sort((a, b) => a.offset - b.offset);
  if (!stops.length) return "#2563eb";
  if (normalizedOffset <= stops[0].offset) return stops[0].color;
  if (normalizedOffset >= stops[stops.length - 1].offset) return stops[stops.length - 1].color;

  for (let i = 0; i < stops.length - 1; i += 1) {
    const left = stops[i];
    const right = stops[i + 1];
    if (normalizedOffset < left.offset || normalizedOffset > right.offset) continue;
    const span = Math.max(0.000001, right.offset - left.offset);
    const t = (normalizedOffset - left.offset) / span;
    const leftParsed = parseAnyColorOrFallback(left.color);
    const rightParsed = parseAnyColorOrFallback(right.color);
    const mixRgb: Rgb = {
      r: clampChannel(leftParsed.rgb.r + (rightParsed.rgb.r - leftParsed.rgb.r) * t),
      g: clampChannel(leftParsed.rgb.g + (rightParsed.rgb.g - leftParsed.rgb.g) * t),
      b: clampChannel(leftParsed.rgb.b + (rightParsed.rgb.b - leftParsed.rgb.b) * t),
    };
    const mixAlpha = clampPercent(leftParsed.alpha + (rightParsed.alpha - leftParsed.alpha) * t);
    return toCssColor(mixRgb, mixAlpha);
  }

  return stops[0].color;
}

const GRADIENT_STYLE_PRESETS: Array<{ id: string; kind: GradientKind; angle?: number; label: string }> = [
  { id: "linear-0", kind: "linear", angle: 0, label: "Linear" },
  { id: "linear-90", kind: "linear", angle: 90, label: "Vertical" },
  { id: "linear-135", kind: "linear", angle: 135, label: "Diagonal" },
  { id: "radial", kind: "radial", label: "Radial" },
  { id: "linear-45", kind: "linear", angle: 45, label: "Soft" },
];

const GRADIENT_LOOK_PRESETS: Array<{
  id: string;
  label: string;
  description: string;
  value: GradientColorValue;
}> = [
  {
    id: "sunrise",
    label: "Sunrise",
    description: "Warm editorial gradient",
    value: {
      type: "gradient",
      gradient_type: "linear",
      angle: 32,
      stops: [
        { offset: 0, color: "#FFF6E8" },
        { offset: 0.45, color: "#F4C28A" },
        { offset: 1, color: "#D97706" },
      ],
    },
  },
  {
    id: "copper",
    label: "Copper",
    description: "Luxe bronze",
    value: {
      type: "gradient",
      gradient_type: "linear",
      angle: 130,
      stops: [
        { offset: 0, color: "#F7F0E8" },
        { offset: 0.5, color: "#B68B67" },
        { offset: 1, color: "#5B3A29" },
      ],
    },
  },
  {
    id: "lagoon",
    label: "Lagoon",
    description: "Cyan depth",
    value: {
      type: "gradient",
      gradient_type: "linear",
      angle: 145,
      stops: [
        { offset: 0, color: "#E6FFFB" },
        { offset: 0.55, color: "#5EEAD4" },
        { offset: 1, color: "#0F766E" },
      ],
    },
  },
  {
    id: "aurora",
    label: "Aurora",
    description: "Soft glow",
    value: {
      type: "gradient",
      gradient_type: "radial",
      angle: 0,
      stops: [
        { offset: 0, color: "#FFF7ED" },
        { offset: 0.5, color: "#FB7185" },
        { offset: 1, color: "#7C3AED" },
      ],
    },
  },
  {
    id: "moss",
    label: "Moss",
    description: "Natural green",
    value: {
      type: "gradient",
      gradient_type: "linear",
      angle: 158,
      stops: [
        { offset: 0, color: "#F7FEE7" },
        { offset: 0.48, color: "#86EFAC" },
        { offset: 1, color: "#14532D" },
      ],
    },
  },
  {
    id: "obsidian",
    label: "Obsidian",
    description: "Cinematic radial",
    value: {
      type: "gradient",
      gradient_type: "radial",
      angle: 0,
      stops: [
        { offset: 0, color: "#F8FAFC" },
        { offset: 0.38, color: "#64748B" },
        { offset: 1, color: "#0F172A" },
      ],
    },
  },
];

export function ColorPicker({
  color = "#2563eb",
  onChange,
  onClose,
  style,
  className = "",
  onMouseDown,
  allowGradient = false,
  title = "Color",
  documentColors,
}: ColorPickerProps) {
  const initialParsed = React.useMemo(() => parseAnyColorOrFallback(color), [color]);
  const [rgb, setRgb] = React.useState<Rgb>(initialParsed.rgb);
  const [alpha, setAlpha] = React.useState<number>(initialParsed.alpha);
  const [mode, setMode] = React.useState<"solid" | "gradient">(
    allowGradient && isGradientColorValue(color) ? "gradient" : "solid",
  );
  const [gradient, setGradient] = React.useState<GradientColorValue>(() => (
    normalizeGradient(color, toCssColor(initialParsed.rgb, initialParsed.alpha))
  ));
  const [activeStopIndex, setActiveStopIndex] = React.useState(0);
  const [hexDraft, setHexDraft] = React.useState(() => toHex(initialParsed.rgb).toUpperCase());
  const [isRgbMenuOpen, setIsRgbMenuOpen] = React.useState(false);
  const [isMoreColorsOpen, setIsMoreColorsOpen] = React.useState(false);
  const [isEyeDropperActive, setIsEyeDropperActive] = React.useState(false);
  const isHexInputFocusedRef = React.useRef(false);

  const activeStopIndexRef = React.useRef(0);
  const gradientTrackRef = React.useRef<HTMLDivElement | null>(null);
  const dragStateRef = React.useRef<{ pointerId: number; stopIndex: number } | null>(null);
  const svAreaRef = React.useRef<HTMLDivElement | null>(null);
  const svDragStateRef = React.useRef<{ pointerId: number } | null>(null);
  const rgbMenuRef = React.useRef<HTMLDivElement | null>(null);
  const rgbMenuButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const moreColorsRef = React.useRef<HTMLDivElement | null>(null);
  const moreColorsButtonRef = React.useRef<HTMLButtonElement | null>(null);

  const hsv = React.useMemo(() => rgbToHsv(rgb), [rgb]);
  const lastHueRef = React.useRef(hsv.h);

  React.useEffect(() => {
    if (hsv.s > 0.0001) lastHueRef.current = hsv.h;
  }, [hsv.h, hsv.s]);

  const effectiveHue = hsv.s > 0.0001 ? hsv.h : lastHueRef.current;
  const hex = React.useMemo(() => toHex(rgb), [rgb]);
  const palette = React.useMemo(
    () => normalizeDocumentPalette(documentColors, color),
    [documentColors, color],
  );

  const inlinePalette = React.useMemo(
    () => palette.slice(0, MAX_INLINE_DOCUMENT_COLORS),
    [palette],
  );
  const overflowPalette = React.useMemo(
    () => palette.slice(MAX_INLINE_DOCUMENT_COLORS),
    [palette],
  );

  const activeStop = React.useMemo(
    () => gradient.stops[Math.max(0, Math.min(activeStopIndex, gradient.stops.length - 1))] || gradient.stops[0],
    [gradient.stops, activeStopIndex],
  );

  const orderedStops = React.useMemo(
    () => gradient.stops
      .map((stop, index) => ({ stop, index }))
      .sort((a, b) => (a.stop.offset - b.stop.offset) || (a.index - b.index)),
    [gradient.stops],
  );

  const syncStopColor = React.useCallback((nextGradient: GradientColorValue, stopIndex: number) => {
    const idx = Math.max(0, Math.min(stopIndex, nextGradient.stops.length - 1));
    const stop = nextGradient.stops[idx] || nextGradient.stops[0];
    const parsed = parseAnyColorOrFallback(stop?.color || "#2563eb");
    setRgb((prev) => (
      prev.r === parsed.rgb.r && prev.g === parsed.rgb.g && prev.b === parsed.rgb.b
        ? prev
        : parsed.rgb
    ));
    setAlpha((prev) => (prev === parsed.alpha ? prev : parsed.alpha));
  }, []);

  React.useEffect(() => {
    activeStopIndexRef.current = activeStopIndex;
  }, [activeStopIndex]);

  React.useEffect(() => {
    const parsed = parseAnyColorOrFallback(color);
    const nextGradient = normalizeGradient(color, toCssColor(parsed.rgb, parsed.alpha));
    const nextStopIndex = Math.max(0, Math.min(activeStopIndexRef.current, nextGradient.stops.length - 1));
    const incomingIsGradient = allowGradient && isGradientColorValue(color);
    setRgb(parsed.rgb);
    setAlpha(parsed.alpha);
    setGradient(nextGradient);
    setActiveStopIndex(nextStopIndex);
    activeStopIndexRef.current = nextStopIndex;
    if (incomingIsGradient) {
      syncStopColor(nextGradient, nextStopIndex);
      setMode("gradient");
      return;
    }
    setMode("solid");
  }, [color, allowGradient, syncStopColor]);

  React.useEffect(() => {
    if (isHexInputFocusedRef.current) return;
    setHexDraft(hex.toUpperCase());
  }, [hex]);

  // Esc closes the picker (universal dismiss). Sub-popovers (RGB / more colors)
  // get to close first so one Esc doesn't jump straight out.
  React.useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (isRgbMenuOpen || isMoreColorsOpen) return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, isRgbMenuOpen, isMoreColorsOpen]);

  const eyeDropperCtor = React.useMemo<EyeDropperConstructor | null>(() => {
    if (typeof window === "undefined") return null;
    const maybeCtor = (window as Window & { EyeDropper?: EyeDropperConstructor }).EyeDropper;
    return typeof maybeCtor === "function" ? maybeCtor : null;
  }, []);

  React.useEffect(() => {
    if (!isRgbMenuOpen && !isMoreColorsOpen) return;
    const onPointerDownCapture = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (isRgbMenuOpen) {
        const inMenu = rgbMenuRef.current?.contains(target);
        const inButton = rgbMenuButtonRef.current?.contains(target);
        if (!inMenu && !inButton) setIsRgbMenuOpen(false);
      }
      if (isMoreColorsOpen) {
        const inMenu = moreColorsRef.current?.contains(target);
        const inButton = moreColorsButtonRef.current?.contains(target);
        if (!inMenu && !inButton) setIsMoreColorsOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDownCapture, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDownCapture, true);
    };
  }, [isRgbMenuOpen, isMoreColorsOpen]);

  const emitChange = React.useCallback((nextColor: ColorPickerValue, meta?: ColorPickerChangeMeta) => {
    onChange?.(nextColor, meta);
  }, [onChange]);

  const updateGradient = React.useCallback((mut: (
    prev: GradientColorValue,
    activeIndex: number,
  ) => { gradient: GradientColorValue; activeStopIndex?: number }, meta?: ColorPickerChangeMeta) => {
    setGradient((prev) => {
      const currentIndex = Math.max(0, Math.min(activeStopIndexRef.current, prev.stops.length - 1));
      const result = mut(prev, currentIndex);
      const nextGradient = normalizeGradient(result.gradient, toCssColor(rgb, alpha));
      const nextIndex = Math.max(
        0,
        Math.min(
          result.activeStopIndex ?? currentIndex,
          nextGradient.stops.length - 1,
        ),
      );
      activeStopIndexRef.current = nextIndex;
      setActiveStopIndex(nextIndex);
      syncStopColor(nextGradient, nextIndex);
      emitChange(nextGradient, meta);
      return nextGradient;
    });
  }, [emitChange, rgb, alpha, syncStopColor]);

  const setCurrentColor = React.useCallback((nextRgb: Rgb, nextAlpha: number, meta?: ColorPickerChangeMeta) => {
    const clampedAlpha = clampPercent(nextAlpha);
    setRgb(nextRgb);
    setAlpha(clampedAlpha);
    const cssColor = toCssColor(nextRgb, clampedAlpha);

    if (allowGradient && mode === "gradient") {
      updateGradient((prev, idx) => {
        const stops = prev.stops.map((stop, i) => (i === idx ? { ...stop, color: cssColor } : stop));
        return {
          gradient: { ...prev, stops },
          activeStopIndex: idx,
        };
      }, meta);
      return;
    }

    emitChange(cssColor, meta);
  }, [allowGradient, mode, emitChange, updateGradient]);

  const setCurrentFromHsv = React.useCallback((patch: Partial<Hsv> & { alpha?: number }, meta?: ColorPickerChangeMeta) => {
    const baseHsv = rgbToHsv(rgb);
    const hue = patch.h != null ? normalizeHue(patch.h) : (baseHsv.s > 0.0001 ? baseHsv.h : lastHueRef.current);
    const sat = patch.s != null ? clampOffset(patch.s) : baseHsv.s;
    const val = patch.v != null ? clampOffset(patch.v) : baseHsv.v;
    // Keep hue memory even for achromatic colors so Hue slider stays responsive on gray/black.
    if (patch.h != null || sat > 0.0001) lastHueRef.current = hue;
    const nextRgb = hsvToRgb({ h: hue, s: sat, v: val });
    setCurrentColor(nextRgb, patch.alpha ?? alpha, meta);
  }, [rgb, alpha, setCurrentColor]);

  const commitHexDraft = React.useCallback((draft: string) => {
    const normalized = sanitizeHexInput(draft);
    const parsed = parseHex(normalized);
    if (!parsed) {
      setHexDraft(hex.toUpperCase());
      return;
    }
    setCurrentColor(parsed, alpha, { commit: true });
  }, [alpha, hex, setCurrentColor]);

  const handleHueSliderInput = React.useCallback((value: string) => {
    const nextHue = Number(value);
    if (!Number.isFinite(nextHue)) return;
    setCurrentFromHsv({ h: nextHue }, { transient: true, commit: false });
  }, [setCurrentFromHsv]);

  const handleAlphaSliderInput = React.useCallback((value: string) => {
    const nextAlpha = Number(value);
    if (!Number.isFinite(nextAlpha)) return;
    setCurrentColor(rgb, nextAlpha, { transient: true, commit: false });
  }, [rgb, setCurrentColor]);

  const handleEyeDropper = React.useCallback(async () => {
    if (!eyeDropperCtor || isEyeDropperActive) return;
    setIsEyeDropperActive(true);
    try {
      const sample = await new eyeDropperCtor().open();
      const parsed = parseHex(sample?.sRGBHex || "");
      if (!parsed) return;
      setCurrentColor(parsed, alpha, { commit: true });
      setHexDraft(toHex(parsed).toUpperCase());
    } catch {
      // User cancelled the eyedropper interaction.
    } finally {
      setIsEyeDropperActive(false);
    }
  }, [alpha, eyeDropperCtor, isEyeDropperActive, setCurrentColor]);

  const emitCommittedCurrentColor = React.useCallback(() => {
    if (allowGradient && mode === "gradient") {
      emitChange(gradient, { commit: true });
      return;
    }
    emitChange(toCssColor(rgb, alpha), { commit: true });
  }, [allowGradient, mode, gradient, rgb, alpha, emitChange]);

  const getSvFromClient = React.useCallback((clientX: number, clientY: number): { s: number; v: number } | null => {
    const el = svAreaRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const s = clampOffset((clientX - rect.left) / rect.width);
    const v = clampOffset(1 - ((clientY - rect.top) / rect.height));
    return { s, v };
  }, []);

  const stopSvDrag = React.useCallback((pointerId?: number, currentTarget?: EventTarget | null) => {
    const activePointerId = pointerId ?? svDragStateRef.current?.pointerId;
    const target = currentTarget instanceof HTMLDivElement ? currentTarget : svAreaRef.current;
    if (target && activePointerId != null && target.hasPointerCapture?.(activePointerId)) {
      try {
        target.releasePointerCapture(activePointerId);
      } catch {
        // Pointer capture may already have been released by the browser.
      }
    }
    svDragStateRef.current = null;
  }, []);

  React.useEffect(() => {
    return () => {
      stopSvDrag();
    };
  }, [stopSvDrag]);

  function handleSvPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = svDragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const nextSv = getSvFromClient(event.clientX, event.clientY);
    if (!nextSv) return;
    setCurrentFromHsv(nextSv, { transient: true, commit: false });
  }

  function handleSvPointerEnd(event: React.PointerEvent<HTMLDivElement>) {
    const drag = svDragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const nextSv = getSvFromClient(event.clientX, event.clientY);
    if (nextSv) {
      setCurrentFromHsv(nextSv, { commit: true });
    } else {
      emitCommittedCurrentColor();
    }
    stopSvDrag(event.pointerId, event.currentTarget);
  }

  function startSvDrag(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    stopSvDrag();
    const nextSv = getSvFromClient(event.clientX, event.clientY);
    if (nextSv) setCurrentFromHsv(nextSv, { transient: true, commit: false });
    event.currentTarget.setPointerCapture?.(event.pointerId);
    svDragStateRef.current = { pointerId: event.pointerId };
  }

  function selectStop(index: number) {
    const stop = gradient.stops[index];
    if (!stop) return;
    setActiveStopIndex(index);
    activeStopIndexRef.current = index;
    syncStopColor(gradient, index);
  }

  const setStopOffset = React.useCallback((index: number, nextOffset: number, meta?: ColorPickerChangeMeta) => {
    updateGradient((prev) => {
      const idx = Math.max(0, Math.min(index, prev.stops.length - 1));
      const stops = prev.stops.map((stop, stopIndex) => (
        stopIndex === idx ? { ...stop, offset: clampOffset(nextOffset) } : stop
      ));
      return {
        gradient: { ...prev, stops },
        activeStopIndex: idx,
      };
    }, meta);
  }, [updateGradient]);

  const getTrackOffsetFromClientX = React.useCallback((clientX: number): number | null => {
    const el = gradientTrackRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return null;
    return clampOffset((clientX - rect.left) / rect.width);
  }, []);

  const stopStopDrag = React.useCallback((pointerId?: number, currentTarget?: EventTarget | null) => {
    const activePointerId = pointerId ?? dragStateRef.current?.pointerId;
    const target = currentTarget instanceof HTMLButtonElement ? currentTarget : null;
    if (target && activePointerId != null && target.hasPointerCapture?.(activePointerId)) {
      try {
        target.releasePointerCapture(activePointerId);
      } catch {
        // Pointer capture may already have been released by the browser.
      }
    }
    dragStateRef.current = null;
  }, []);

  React.useEffect(() => {
    return () => {
      stopStopDrag();
    };
  }, [stopStopDrag]);

  function handleStopPointerMove(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const nextOffset = getTrackOffsetFromClientX(event.clientX);
    if (nextOffset == null) return;
    setStopOffset(drag.stopIndex, nextOffset, { transient: true, commit: false });
  }

  function handleStopPointerEnd(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const nextOffset = getTrackOffsetFromClientX(event.clientX);
    if (nextOffset != null) {
      setStopOffset(drag.stopIndex, nextOffset, { commit: true });
    } else {
      emitCommittedCurrentColor();
    }
    stopStopDrag(event.pointerId, event.currentTarget);
  }

  function startStopDrag(event: React.PointerEvent<HTMLButtonElement>, index: number) {
    event.preventDefault();
    event.stopPropagation();
    stopStopDrag();
    selectStop(index);
    const nextOffset = getTrackOffsetFromClientX(event.clientX);
    if (nextOffset != null) {
      setStopOffset(index, nextOffset, { transient: true, commit: false });
    }
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragStateRef.current = { pointerId: event.pointerId, stopIndex: index };
  }

  function addGradientStopAt(rawOffset?: number, meta: ColorPickerChangeMeta = { commit: true }) {
    updateGradient((prev, idx) => {
      if (prev.stops.length >= MAX_GRADIENT_STOPS) {
        return { gradient: prev, activeStopIndex: idx };
      }
      const fallbackOffset = prev.stops[idx]?.offset ?? 0.5;
      const offset = clampOffset(
        rawOffset != null
          ? rawOffset
          : Number(fallbackOffset + (fallbackOffset >= 0.85 ? -0.2 : 0.15)),
      );
      const stopColor = sampleGradientColor(prev, offset);
      const stops = [...prev.stops, { offset, color: stopColor }];
      return {
        gradient: { ...prev, stops },
        activeStopIndex: stops.length - 1,
      };
    }, meta);
  }

  function addGradientStop() {
    addGradientStopAt(undefined, { commit: true });
  }

  function removeGradientStop() {
    if (gradient.stops.length <= 2) return;
    updateGradient((prev, idx) => {
      const stops = prev.stops.filter((_, i) => i !== idx);
      const nextIdx = Math.max(0, Math.min(idx - 1, stops.length - 1));
      return {
        gradient: { ...prev, stops },
        activeStopIndex: nextIdx,
      };
    }, { commit: true });
  }

  function reverseGradientStops() {
    updateGradient((prev, idx) => {
      const tagged = prev.stops.map((stop, stopIndex) => ({
        stop,
        active: stopIndex === idx,
      }));
      const reversed = tagged
        .map((entry) => ({
          ...entry,
          stop: { ...entry.stop, offset: clampOffset(1 - entry.stop.offset) },
        }))
        .reverse();
      const nextIdx = Math.max(0, reversed.findIndex((entry) => entry.active));
      return {
        gradient: {
          ...prev,
          stops: reversed.map((entry) => entry.stop),
        },
        activeStopIndex: nextIdx,
      };
    }, { commit: true });
  }

  function distributeGradientStops() {
    updateGradient((prev, idx) => {
      if (prev.stops.length <= 2) {
        return { gradient: prev, activeStopIndex: idx };
      }
      const ordered = prev.stops
        .map((stop, index) => ({ stop, index }))
        .sort((left, right) => (left.stop.offset - right.stop.offset) || (left.index - right.index));
      const lastIndex = Math.max(1, ordered.length - 1);
      const stops = [...prev.stops];
      ordered.forEach((entry, orderIndex) => {
        stops[entry.index] = {
          ...entry.stop,
          offset: clampOffset(orderIndex / lastIndex),
        };
      });
      return {
        gradient: { ...prev, stops },
        activeStopIndex: idx,
      };
    }, { commit: true });
  }

  function applyGradientPreset(value: GradientColorValue) {
    updateGradient((prev) => ({
      gradient: {
        ...prev,
        ...value,
        stops: normalizeStops(value.stops, toCssColor(rgb, alpha)),
      },
      activeStopIndex: 0,
    }), { commit: true });
  }

  function applyPaletteColor(swatch: unknown) {
    if (isGradientColorValue(swatch)) {
      if (!allowGradient) {
        const parsed = parseAnyColorOrFallback(swatch.stops[0]?.color || "#2563eb");
        setCurrentColor(parsed.rgb, parsed.alpha, { commit: true });
        return;
      }
      const nextGradient = normalizeGradient(swatch, toCssColor(rgb, alpha));
      setGradient(nextGradient);
      setMode("gradient");
      activeStopIndexRef.current = 0;
      setActiveStopIndex(0);
      syncStopColor(nextGradient, 0);
      emitChange(nextGradient, { commit: true });
      return;
    }

    const parsed = parseAnyColor(swatch);
    if (!parsed) return;
    setCurrentColor(parsed.rgb, parsed.alpha, { commit: true });
  }

  function renderDocumentColorsSection() {
    if (!palette.length) return null;

    return (
      <div className="dg-color-picker-docs">
        <div className="dg-color-picker-palette-title">Document colors</div>
        <div className="dg-color-picker-palette">
          {inlinePalette.map((swatch, index) => (
            <button
              key={`${serializeColorValue(swatch)}_${index}`}
              type="button"
              className="dg-color-picker-chip"
              style={{ background: colorToCssString(swatch, "#2563eb") }}
              title={formatColorTooltip(swatch)}
              onClick={() => applyPaletteColor(swatch)}
            />
          ))}

          {overflowPalette.length > 0 && (
            <button
              ref={moreColorsButtonRef}
              type="button"
              className={`dg-color-picker-chip dg-color-picker-chip-more ${isMoreColorsOpen ? "active" : ""}`}
              title={`${overflowPalette.length} more colors`}
              onClick={() => setIsMoreColorsOpen((prev) => !prev)}
            >
              ...
            </button>
          )}
        </div>

        {isMoreColorsOpen && overflowPalette.length > 0 && (
          <div ref={moreColorsRef} className="dg-color-picker-more-colors-menu">
            <div className="dg-color-picker-more-colors-grid">
              {overflowPalette.map((swatch, index) => (
                <button
                  key={`more_${serializeColorValue(swatch)}_${index}`}
                  type="button"
                  className="dg-color-picker-chip"
                  style={{ background: colorToCssString(swatch, "#2563eb") }}
                  title={formatColorTooltip(swatch)}
                  onClick={() => applyPaletteColor(swatch)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  function renderCoreColorControls() {
    const svThumbStyle: React.CSSProperties = {
      left: `${Math.round(clampOffset(hsv.s) * 1000) / 10}%`,
      top: `${Math.round(clampOffset(1 - hsv.v) * 1000) / 10}%`,
      background: toCssColor(rgb, 100),
    };
    const hueSliderBackground = "linear-gradient(90deg, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)";
    const alphaSliderBackground = `linear-gradient(90deg, rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0) 0%, rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 1) 100%)`;
    const alphaCheckerboardBackground = "repeating-conic-gradient(#ffffff 0% 25%, #d4d4d4 0% 50%) 0 0 / 12px 12px";
    const hueSliderStyle = {
      "--dg-color-slider-bg": hueSliderBackground,
    } as React.CSSProperties;
    const alphaSliderStyle = {
      "--dg-color-slider-bg": `${alphaSliderBackground}, ${alphaCheckerboardBackground}`,
    } as React.CSSProperties;

    return (
      <>
        <div
          ref={svAreaRef}
          className="dg-color-sv-area"
          style={{ background: `hsl(${Math.round(normalizeHue(effectiveHue))} 100% 50%)` }}
          onPointerDown={startSvDrag}
          onPointerMove={handleSvPointerMove}
          onPointerUp={handleSvPointerEnd}
          onPointerCancel={handleSvPointerEnd}
          onLostPointerCapture={(event) => {
            if (svDragStateRef.current?.pointerId !== event.pointerId) return;
            emitCommittedCurrentColor();
            stopSvDrag(event.pointerId, event.currentTarget);
          }}
        >
          <div className="dg-color-sv-white" />
          <div className="dg-color-sv-black" />
          <span className="dg-color-sv-thumb" style={svThumbStyle} />
        </div>

        <label className="dg-color-channel-row">
          <span>Hue</span>
          <input
            type="range"
            min={0}
            max={360}
            step={1}
            value={Math.round(normalizeHue(effectiveHue))}
            onInput={(event) => handleHueSliderInput((event.currentTarget as HTMLInputElement).value)}
            onChange={(event) => {
              const nextHue = Number(event.currentTarget.value);
              if (!Number.isFinite(nextHue)) return;
              setCurrentFromHsv({ h: nextHue }, { commit: true });
            }}
            onPointerDown={(event) => event.stopPropagation()}
            style={hueSliderStyle}
          />
        </label>

        <label className="dg-color-channel-row dg-color-channel-row-alpha">
          <span>Opacity</span>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={alpha}
            onInput={(event) => handleAlphaSliderInput((event.currentTarget as HTMLInputElement).value)}
            onChange={(event) => {
              const nextAlpha = Number(event.currentTarget.value);
              if (!Number.isFinite(nextAlpha)) return;
              setCurrentColor(rgb, nextAlpha, { commit: true });
            }}
            onPointerDown={(event) => event.stopPropagation()}
            style={alphaSliderStyle}
          />
          <strong>{alpha}%</strong>
        </label>

        <div className="dg-color-values-row">
          <label className="dg-color-value-field dg-color-value-field-hex">
            <span>Hex</span>
            <input
              type="text"
              className="dg-color-code"
              value={hexDraft}
              onChange={(event) => {
                const next = sanitizeHexInput(event.target.value);
                setHexDraft(next);
                const nextDigits = hexDigits(next);
                if (nextDigits.length !== 6) return;
                const parsed = parseHex(next);
                if (!parsed) return;
                setCurrentColor(parsed, alpha, { transient: true, commit: false });
              }}
              onFocus={() => {
                isHexInputFocusedRef.current = true;
              }}
              onBlur={() => {
                isHexInputFocusedRef.current = false;
                commitHexDraft(hexDraft);
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                commitHexDraft(hexDraft);
                (event.currentTarget as HTMLInputElement).blur();
              }}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              inputMode="text"
            />
          </label>

          <div className="dg-color-rgb-readout" title="Red">
            <span>R</span>
            <strong>{rgb.r}</strong>
          </div>
          <div className="dg-color-rgb-readout" title="Green">
            <span>G</span>
            <strong>{rgb.g}</strong>
          </div>
          <div className="dg-color-rgb-readout" title="Blue">
            <span>B</span>
            <strong>{rgb.b}</strong>
          </div>

          <button
            type="button"
            className="dg-color-picker-eye"
            title={
              eyeDropperCtor
                ? (isEyeDropperActive ? "Picking color…" : "Pick color from screen")
                : "The eyedropper isn't available in this browser"
            }
            onClick={() => {
              void handleEyeDropper();
            }}
            disabled={!eyeDropperCtor || isEyeDropperActive}
            aria-busy={isEyeDropperActive}
          >
            <PinselaIcon name="Pipette" size={14} />
          </button>

          <div className="dg-color-more-wrap">
            <button
              ref={rgbMenuButtonRef}
              type="button"
              className={`dg-color-picker-eye ${isRgbMenuOpen ? "active" : ""}`}
              title="RGB controls"
              onClick={() => setIsRgbMenuOpen((prev) => !prev)}
            >
              <PinselaIcon name="Ellipsis" size={14} />
            </button>

            {isRgbMenuOpen && (
              <div ref={rgbMenuRef} className="dg-color-rgb-menu">
                <label>
                  <span>R</span>
                  <input
                    type="number"
                    min={0}
                    max={255}
                    value={rgb.r}
                    onChange={(event) => {
                      const value = clampChannel(Number(event.target.value));
                      setCurrentColor({ ...rgb, r: value }, alpha, { commit: true });
                    }}
                  />
                </label>
                <label>
                  <span>G</span>
                  <input
                    type="number"
                    min={0}
                    max={255}
                    value={rgb.g}
                    onChange={(event) => {
                      const value = clampChannel(Number(event.target.value));
                      setCurrentColor({ ...rgb, g: value }, alpha, { commit: true });
                    }}
                  />
                </label>
                <label>
                  <span>B</span>
                  <input
                    type="number"
                    min={0}
                    max={255}
                    value={rgb.b}
                    onChange={(event) => {
                      const value = clampChannel(Number(event.target.value));
                      setCurrentColor({ ...rgb, b: value }, alpha, { commit: true });
                    }}
                  />
                </label>
              </div>
            )}
          </div>
        </div>
      </>
    );
  }

  return (
    <GlassPanel
      tone="popover"
      className={`dg-color-picker-popover ${className}`.trim()}
      style={{ width: 324, padding: 12, ...style }}
      onMouseDown={onMouseDown}
    >
      <div className="dg-color-picker-head">
        <span>{title}</span>
        {onClose && (
          <button type="button" className="dg-color-picker-close" onClick={onClose}>
            <PinselaIcon name="X" size={14} />
          </button>
        )}
      </div>

      {allowGradient && (
        <div className="dg-color-picker-tabs">
          <button
            type="button"
            className={`dg-color-picker-tab ${mode === "solid" ? "active" : ""}`}
            onClick={() => {
              setMode("solid");
              emitChange(toCssColor(rgb, alpha), { commit: true });
            }}
          >
            Solid color
          </button>
          <button
            type="button"
            className={`dg-color-picker-tab ${mode === "gradient" ? "active" : ""}`}
            onClick={() => {
              setMode("gradient");
              syncStopColor(gradient, activeStopIndexRef.current);
              emitChange(gradient, { commit: true });
            }}
          >
            Gradient
          </button>
        </div>
      )}

      {renderDocumentColorsSection()}

      {mode === "gradient" && allowGradient && (
        <div className="dg-gradient-editor">
          <div className="dg-gradient-preview" style={{ background: gradientToCss(gradient) }}>
            <div className="dg-gradient-preview-overlay" />
            <div className="dg-gradient-preview-copy">
              <span>{gradient.gradient_type === "radial" ? "Radial gradient" : "Linear gradient"}</span>
              <strong>
                {gradient.gradient_type === "radial"
                  ? "Center glow"
                  : `${Math.round(normalizeHue(gradient.angle))}\u00b0 direction`}
              </strong>
              <div className="dg-gradient-preview-meta">
                <span>{gradient.stops.length} paradas</span>
                <span>{Math.round(clampOffset(activeStop?.offset ?? 0.5) * 1000) / 10}% active</span>
              </div>
            </div>
          </div>

          <div className="dg-color-picker-subtitle">Gradient colors</div>
          <div className="dg-gradient-track-wrap">
            <div
              ref={gradientTrackRef}
              className="dg-gradient-track"
              style={{ background: gradientToCss(gradient) }}
              onPointerDown={(event) => {
                const target = event.target as Element | null;
                if (target?.closest('[data-gradient-stop-handle="true"]')) return;
                event.preventDefault();
                const offset = getTrackOffsetFromClientX(event.clientX);
                if (offset == null) return;
                addGradientStopAt(offset, { commit: true });
              }}
            >
              {orderedStops.map(({ stop, index }) => (
                <button
                  key={`stop-${index}`}
                  type="button"
                  data-gradient-stop-handle="true"
                  className={`dg-gradient-track-stop ${index === activeStopIndex ? "active" : ""}`}
                  style={{
                    left: `${Math.round(clampOffset(stop.offset) * 1000) / 10}%`,
                    background: stop.color,
                  }}
                  onClick={() => selectStop(index)}
                  onPointerDown={(event) => startStopDrag(event, index)}
                  onPointerMove={handleStopPointerMove}
                  onPointerUp={handleStopPointerEnd}
                  onPointerCancel={handleStopPointerEnd}
                  onLostPointerCapture={(event) => {
                    if (dragStateRef.current?.pointerId !== event.pointerId) return;
                    emitCommittedCurrentColor();
                    stopStopDrag(event.pointerId, event.currentTarget);
                  }}
                  title={`Stop ${index + 1}`}
                />
              ))}
            </div>
            <div className="dg-gradient-track-caption">
              Drag a stop to reposition. Click the bar to add another color.
            </div>
          </div>

          <div className="dg-gradient-stop-strip">
            {orderedStops.map(({ stop, index }) => (
              <button
                key={`stop-chip-${index}`}
                type="button"
                className={`dg-gradient-stop-chip ${index === activeStopIndex ? "active" : ""}`}
                onClick={() => selectStop(index)}
              >
                <span className="dg-gradient-stop-chip-swatch" style={{ background: stop.color }} />
                <strong>{Math.round(clampOffset(stop.offset) * 100)}%</strong>
                <small>{normalizeStopColor(stop.color, "#2563eb").toUpperCase()}</small>
              </button>
            ))}
          </div>

          <div className="dg-gradient-stops">
            <button
              type="button"
              className="dg-gradient-stop dg-gradient-stop-add"
              onClick={addGradientStop}
              disabled={gradient.stops.length >= MAX_GRADIENT_STOPS}
              title="Add color to gradient"
            >
              <PinselaIcon name="Plus" size={14} />
            </button>
            <button
              type="button"
              className="dg-gradient-stop-remove"
              onClick={removeGradientStop}
              disabled={gradient.stops.length <= 2}
              title="Remove selected color"
            >
              <PinselaIcon name="Minus" size={14} />
            </button>
            <button
              type="button"
              className="dg-gradient-stop-remove"
              onClick={distributeGradientStops}
              disabled={gradient.stops.length <= 2}
              title="Distribute evenly"
            >
              <PinselaIcon name="AlignHorizontalDistributeCenter" size={14} />
            </button>
            <button
              type="button"
              className="dg-gradient-stop-remove"
              onClick={reverseGradientStops}
              title="Reverse direction"
            >
              <PinselaIcon name="RefreshCw" size={14} />
            </button>
          </div>

          <div className="dg-color-picker-subtitle">Presets</div>
          <div className="dg-gradient-preset-grid">
            {GRADIENT_LOOK_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className="dg-gradient-preset"
                style={{ background: gradientToCss(preset.value) }}
                title={`${preset.label}: ${preset.description}`}
                onClick={() => applyGradientPreset(preset.value)}
              >
                <span>{preset.label}</span>
                <strong>{preset.description}</strong>
              </button>
            ))}
          </div>

          <div className="dg-color-picker-subtitle">Style</div>
          <div className="dg-gradient-style-grid">
            {GRADIENT_STYLE_PRESETS.map((preset) => {
              const preview = {
                ...gradient,
                gradient_type: preset.kind,
                angle: preset.angle != null ? preset.angle : gradient.angle,
              };
              const active = gradient.gradient_type === preset.kind
                && (preset.kind === "radial" || Math.round(gradient.angle) === Math.round(preset.angle || 0));
              return (
                <button
                  key={preset.id}
                  type="button"
                  className={`dg-gradient-style-btn ${active ? "active" : ""}`}
                  style={{ background: gradientToCss(preview) }}
                  title={preset.label}
                  onClick={() => {
                    updateGradient((prev, idx) => ({
                      gradient: {
                        ...prev,
                        gradient_type: preset.kind,
                        angle: preset.angle != null ? preset.angle : prev.angle,
                      },
                      activeStopIndex: idx,
                    }), { commit: true });
                  }}
                />
              );
            })}
          </div>

          {gradient.gradient_type === "linear" && (
            <label className="dg-gradient-angle">
              <span>Angle</span>
              <input
                type="range"
                min={0}
                max={360}
                step={1}
                value={Math.round(gradient.angle)}
                onInput={(event) => {
                  const value = Number((event.currentTarget as HTMLInputElement).value);
                  updateGradient((prev, idx) => ({
                    gradient: { ...prev, angle: value },
                    activeStopIndex: idx,
                  }), { transient: true, commit: false });
                }}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  updateGradient((prev, idx) => ({
                    gradient: { ...prev, angle: value },
                    activeStopIndex: idx,
                  }), { commit: true });
                }}
              />
              <input
                className="dg-gradient-number"
                type="number"
                min={0}
                max={360}
                step={1}
                value={Math.round(gradient.angle)}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (!Number.isFinite(value)) return;
                  updateGradient((prev, idx) => ({
                    gradient: { ...prev, angle: value },
                    activeStopIndex: idx,
                  }), { commit: true });
                }}
              />
            </label>
          )}

          <label className="dg-gradient-angle">
            <span>Stop position</span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.round(clampOffset(activeStop?.offset ?? 0.5) * 100)}
              onInput={(event) => {
                const value = clampOffset(Number((event.currentTarget as HTMLInputElement).value) / 100);
                setStopOffset(activeStopIndexRef.current, value, { transient: true, commit: false });
              }}
              onChange={(event) => {
                const value = clampOffset(Number(event.target.value) / 100);
                setStopOffset(activeStopIndexRef.current, value, { commit: true });
              }}
            />
            <input
              className="dg-gradient-number"
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={Math.round(clampOffset(activeStop?.offset ?? 0.5) * 1000) / 10}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (!Number.isFinite(value)) return;
                setStopOffset(activeStopIndexRef.current, clampOffset(value / 100), { commit: true });
              }}
            />
          </label>
        </div>
      )}

      {renderCoreColorControls()}
    </GlassPanel>
  );
}
