// Single source of truth for the fonts the renderer needs.
//
// buildCanvasFontFromTextStyle() emits e.g. `500 80px "Inter", ...`, so the
// browser — AND the OffscreenCanvas render worker, which has its own font set
// separate from the document — must have these families registered at the right
// weights, or text falls back to a system font and diverges from the server PNG.
//
// The font PICKER is derived from this same list (PINSELA_PICKER_FAMILIES), so the
// picker can never offer a font/weight/style that won't actually render.
export interface PinselaFontFace {
  family: string;
  weight: number;
  style: "normal" | "italic";
  url: string;
}

// Curated Google Fonts (latin subset, woff2) shipped under /public/fonts/google.
// Downloaded into the repo so render is offline-deterministic and matches in the
// worker. Family names match exactly what the canvas font string requests.
const GOOGLE_FONT_FACES: readonly PinselaFontFace[] = [
  { family: "Archivo", weight: 400, style: "normal", url: "/fonts/google/archivo-400.woff2" },
  { family: "Archivo", weight: 600, style: "normal", url: "/fonts/google/archivo-600.woff2" },
  { family: "Archivo", weight: 700, style: "normal", url: "/fonts/google/archivo-700.woff2" },
  { family: "DM Sans", weight: 400, style: "italic", url: "/fonts/google/dm-sans-400i.woff2" },
  { family: "DM Sans", weight: 400, style: "normal", url: "/fonts/google/dm-sans-400.woff2" },
  { family: "DM Sans", weight: 500, style: "normal", url: "/fonts/google/dm-sans-500.woff2" },
  { family: "DM Sans", weight: 700, style: "italic", url: "/fonts/google/dm-sans-700i.woff2" },
  { family: "DM Sans", weight: 700, style: "normal", url: "/fonts/google/dm-sans-700.woff2" },
  { family: "Inter", weight: 400, style: "italic", url: "/fonts/google/inter-400i.woff2" },
  { family: "Inter", weight: 400, style: "normal", url: "/fonts/google/inter-400.woff2" },
  { family: "Inter", weight: 500, style: "normal", url: "/fonts/google/inter-500.woff2" },
  { family: "Inter", weight: 600, style: "normal", url: "/fonts/google/inter-600.woff2" },
  { family: "Inter", weight: 700, style: "italic", url: "/fonts/google/inter-700i.woff2" },
  { family: "Inter", weight: 700, style: "normal", url: "/fonts/google/inter-700.woff2" },
  { family: "Montserrat", weight: 400, style: "italic", url: "/fonts/google/montserrat-400i.woff2" },
  { family: "Montserrat", weight: 400, style: "normal", url: "/fonts/google/montserrat-400.woff2" },
  { family: "Montserrat", weight: 500, style: "normal", url: "/fonts/google/montserrat-500.woff2" },
  { family: "Montserrat", weight: 600, style: "normal", url: "/fonts/google/montserrat-600.woff2" },
  { family: "Montserrat", weight: 700, style: "italic", url: "/fonts/google/montserrat-700i.woff2" },
  { family: "Montserrat", weight: 700, style: "normal", url: "/fonts/google/montserrat-700.woff2" },
  { family: "Playfair Display", weight: 400, style: "italic", url: "/fonts/google/playfair-display-400i.woff2" },
  { family: "Playfair Display", weight: 400, style: "normal", url: "/fonts/google/playfair-display-400.woff2" },
  { family: "Playfair Display", weight: 600, style: "normal", url: "/fonts/google/playfair-display-600.woff2" },
  { family: "Playfair Display", weight: 700, style: "italic", url: "/fonts/google/playfair-display-700i.woff2" },
  { family: "Playfair Display", weight: 700, style: "normal", url: "/fonts/google/playfair-display-700.woff2" },
  { family: "Plus Jakarta Sans", weight: 400, style: "italic", url: "/fonts/google/plus-jakarta-sans-400i.woff2" },
  { family: "Plus Jakarta Sans", weight: 400, style: "normal", url: "/fonts/google/plus-jakarta-sans-400.woff2" },
  { family: "Plus Jakarta Sans", weight: 500, style: "normal", url: "/fonts/google/plus-jakarta-sans-500.woff2" },
  { family: "Plus Jakarta Sans", weight: 600, style: "normal", url: "/fonts/google/plus-jakarta-sans-600.woff2" },
  { family: "Plus Jakarta Sans", weight: 700, style: "italic", url: "/fonts/google/plus-jakarta-sans-700i.woff2" },
  { family: "Plus Jakarta Sans", weight: 700, style: "normal", url: "/fonts/google/plus-jakarta-sans-700.woff2" },
  { family: "Poppins", weight: 400, style: "italic", url: "/fonts/google/poppins-400i.woff2" },
  { family: "Poppins", weight: 400, style: "normal", url: "/fonts/google/poppins-400.woff2" },
  { family: "Poppins", weight: 500, style: "normal", url: "/fonts/google/poppins-500.woff2" },
  { family: "Poppins", weight: 600, style: "normal", url: "/fonts/google/poppins-600.woff2" },
  { family: "Poppins", weight: 700, style: "italic", url: "/fonts/google/poppins-700i.woff2" },
  { family: "Poppins", weight: 700, style: "normal", url: "/fonts/google/poppins-700.woff2" },
  { family: "Space Grotesk", weight: 400, style: "normal", url: "/fonts/google/space-grotesk-400.woff2" },
  { family: "Space Grotesk", weight: 500, style: "normal", url: "/fonts/google/space-grotesk-500.woff2" },
  { family: "Space Grotesk", weight: 700, style: "normal", url: "/fonts/google/space-grotesk-700.woff2" },
];

export const PINSELA_FONT_FACES: readonly PinselaFontFace[] = [...GOOGLE_FONT_FACES];

// ---- Picker model (derived from the registered faces) ------------------------

const WEIGHT_LABELS: Record<number, string> = {
  100: "Thin",
  200: "Extra Light",
  300: "Light",
  400: "Regular",
  500: "Medium",
  600: "Semi Bold",
  700: "Bold",
  800: "Extra Bold",
  900: "Black",
};

export interface PinselaPickerVariant {
  label: string;
  weight: number;
  italic: boolean;
}

export interface PinselaPickerFamily {
  family: string; // exact CSS family name the canvas requests
  variants: PinselaPickerVariant[];
}

// Display order: Inter (the default family) first, then the rest alphabetically.
const FAMILY_DISPLAY_ORDER = ["Inter"];
// Internal alias names not shown in the picker.
const PICKER_HIDDEN_FAMILIES = new Set<string>();

export const PINSELA_PICKER_FAMILIES: PinselaPickerFamily[] = (() => {
  const byFamily = new Map<string, PinselaPickerVariant[]>();
  for (const face of PINSELA_FONT_FACES) {
    if (PICKER_HIDDEN_FAMILIES.has(face.family)) continue;
    const list = byFamily.get(face.family) || [];
    const italic = face.style === "italic";
    const base = WEIGHT_LABELS[face.weight] || String(face.weight);
    const label = italic ? (base === "Regular" ? "Italic" : `${base} Italic`) : base;
    if (!list.some((v) => v.weight === face.weight && v.italic === italic)) {
      list.push({ label, weight: face.weight, italic });
    }
    byFamily.set(face.family, list);
  }
  const families = Array.from(byFamily.keys()).sort((a, b) => {
    const ia = FAMILY_DISPLAY_ORDER.indexOf(a);
    const ib = FAMILY_DISPLAY_ORDER.indexOf(b);
    if (ia !== -1 || ib !== -1) {
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    }
    return a.localeCompare(b);
  });
  return families.map((family) => ({
    family,
    variants: (byFamily.get(family) || []).sort((a, b) => a.weight - b.weight || Number(a.italic) - Number(b.italic)),
  }));
})();

type FontFaceSetLike = { add: (face: FontFace) => void; has?: (face: FontFace) => boolean };

let loadPromise: Promise<void> | null = null;

// Loads every registered face into the given FontFaceSet (document.fonts or a
// worker's self.fonts). Idempotent and never throws — a missing file just leaves
// that weight on the fallback rather than breaking the whole render.
export function loadPinselaFonts(fontset: FontFaceSetLike, originPrefix = ""): Promise<void> {
  if (loadPromise) return loadPromise;
  if (typeof FontFace === "undefined" || !fontset || typeof fontset.add !== "function") {
    loadPromise = Promise.resolve();
    return loadPromise;
  }
  loadPromise = Promise.all(
    PINSELA_FONT_FACES.map(async (f) => {
      try {
        const face = new FontFace(f.family, `url(${originPrefix}${f.url})`, {
          weight: String(f.weight),
          style: f.style,
          display: "swap",
        });
        await face.load();
        fontset.add(face);
      } catch {
        // ignore individual face failures
      }
    }),
  ).then(() => undefined);
  return loadPromise;
}
