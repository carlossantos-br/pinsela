// The font picker is DERIVED from the renderer's registered faces
// (PINSELA_PICKER_FAMILIES), so it can never offer a font/weight/style that would
// silently fall back. Adding a font = add its faces in fontManifest.ts; the
// picker updates automatically.
import { PINSELA_PICKER_FAMILIES } from "../../../engine/render/fontManifest";

export type FontVariant = {
  label: string;
  postscriptSuffix: string;
  weight: number;
  italic?: boolean;
};

export type FontFamilyEntry = {
  family: string;
  variants: FontVariant[];
};

function suffixFromLabel(label: string): string {
  return label.replace(/\s+/g, "");
}

export const FONT_LIBRARY: FontFamilyEntry[] = PINSELA_PICKER_FAMILIES.map((entry) => ({
  family: entry.family,
  variants: entry.variants.map((v) => ({
    label: v.label,
    postscriptSuffix: suffixFromLabel(v.label),
    weight: v.weight,
    italic: v.italic,
  })),
}));

function normalizeToken(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function findFontFamilyEntry(family: string): FontFamilyEntry | null {
  const key = normalizeToken(family);
  if (!key) return null;
  return FONT_LIBRARY.find((entry) => normalizeToken(entry.family) === key) || null;
}

export function resolveFontStyleForFamily(family: string, requestedStyle?: string): string {
  const entry = findFontFamilyEntry(family);
  const fallbackStyle = String(requestedStyle || "Regular").trim() || "Regular";
  if (!entry) return fallbackStyle;
  const requestedKey = normalizeToken(fallbackStyle);
  if (requestedKey) {
    const exact = entry.variants.find((variant) => normalizeToken(variant.label) === requestedKey);
    if (exact) return exact.label;
  }
  const regular = entry.variants.find((variant) => normalizeToken(variant.label) === "regular");
  return regular?.label || entry.variants[0]?.label || "Regular";
}
