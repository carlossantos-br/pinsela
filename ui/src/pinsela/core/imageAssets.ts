import { resolveApiUrlWithPrefix } from "./apiUrl";
import type { PinselaTemplateDocV1 } from "./types";

let assetApiPrefix = "";

/** Set once by lib/api.ts from VITE_API_BASE so asset requests honour an absolute API origin. */
export function setAssetApiPrefix(prefix: string): void {
  assetApiPrefix = String(prefix || "");
}

const API_ASSET_PATH_RE = /^\/(?:v2\/)?api\/(?:assets|dev-assets)(?:\/|$)/i;
const ASSET_PROTOCOL_RE = /^asset:\/\/([^/?#]+)(.*)?$/i;

function runtimeLocationHref(): string {
  const runtimeLocation = typeof window !== "undefined"
    ? window.location
    : typeof globalThis.location !== "undefined"
      ? globalThis.location
      : null;
  return runtimeLocation?.href || "http://localhost/";
}

function runtimeOrigin(): string {
  try {
    return new URL(runtimeLocationHref()).origin;
  } catch {
    return "";
  }
}

function normalizeApiAssetPath(pathname: string): string {
  return pathname.replace(/^\/v2\/api\//i, "/api/");
}

export function isApiAssetPath(pathname: string): boolean {
  return API_ASSET_PATH_RE.test(String(pathname || ""));
}

export function normalizeCanvasImageSource(src: string): string {
  return String(src || "").trim();
}

export function resolveCanvasImageRequestSrc(src: string): string {
  const raw = normalizeCanvasImageSource(src);
  if (!raw) return "";

  const assetProtocolMatch = raw.match(ASSET_PROTOCOL_RE);
  if (assetProtocolMatch) {
    const assetId = String(assetProtocolMatch[1] || "").trim();
    const suffix = String(assetProtocolMatch[2] || "");
    return assetId ? resolveApiUrlWithPrefix(`/api/assets/${assetId}${suffix}`, assetApiPrefix) : "";
  }

  if (/^(data:|blob:)/i.test(raw)) return raw;

  try {
    const parsed = new URL(raw, runtimeLocationHref());
    if (isApiAssetPath(parsed.pathname)) {
      return resolveApiUrlWithPrefix(
        `${normalizeApiAssetPath(parsed.pathname)}${parsed.search}${parsed.hash}`,
        assetApiPrefix,
      );
    }
    if (parsed.origin === runtimeOrigin()) {
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
    return parsed.href;
  } catch {
    return raw;
  }
}

export function shouldUseCanvasImageCredentials(src: string): boolean {
  const requestSrc = resolveCanvasImageRequestSrc(src);
  if (!requestSrc || /^(data:|blob:)/i.test(requestSrc)) return false;
  try {
    const parsed = new URL(requestSrc, runtimeLocationHref());
    return isApiAssetPath(parsed.pathname);
  } catch {
    return false;
  }
}

export function canvasImageCacheKeys(src: string): string[] {
  const raw = normalizeCanvasImageSource(src);
  const requestSrc = resolveCanvasImageRequestSrc(raw);
  const keys = [raw, requestSrc].filter(Boolean);
  return Array.from(new Set(keys));
}

export function collectDocImageSources(doc: PinselaTemplateDocV1): string[] {
  const sources = new Set<string>();
  for (const node of doc.nodes || []) {
    if (node.kind !== "image" && node.kind !== "frame") continue;
    const src = normalizeCanvasImageSource(node.image_src || "");
    if (src) sources.add(src);
  }
  return Array.from(sources);
}

function isDrawableImage(image: HTMLImageElement | null | undefined): image is HTMLImageElement {
  if (!image) return false;
  return Boolean(image.complete) && Number(image.naturalWidth || image.width || 0) > 0 && Number(image.naturalHeight || image.height || 0) > 0;
}

function corsModeForImageRequest(src: string): "" | "anonymous" | "use-credentials" {
  const requestSrc = resolveCanvasImageRequestSrc(src);
  if (!requestSrc || /^(data:|blob:)/i.test(requestSrc)) return "";
  try {
    const parsed = new URL(requestSrc, runtimeLocationHref());
    if (parsed.origin === runtimeOrigin()) return "";
    if (isApiAssetPath(parsed.pathname)) return "use-credentials";
    return "anonymous";
  } catch {
    return "";
  }
}

function loadImageOnce(
  requestSrc: string,
  corsMode: "" | "anonymous" | "use-credentials",
  timeoutMs: number,
): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (typeof Image === "undefined" || !requestSrc) {
      resolve(null);
      return;
    }

    const image = new Image();
    let settled = false;
    const finish = (result: HTMLImageElement | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(result);
    };
    const timer = window.setTimeout(() => finish(null), Math.max(1000, timeoutMs));
    if (corsMode) image.crossOrigin = corsMode;
    image.decoding = "async";
    image.onload = () => finish(isDrawableImage(image) ? image : null);
    image.onerror = () => finish(null);
    image.src = requestSrc;
  });
}

export async function loadCanvasImageElement(
  src: string,
  options?: { timeoutMs?: number },
): Promise<HTMLImageElement | null> {
  const requestSrc = resolveCanvasImageRequestSrc(src);
  if (!requestSrc) return null;
  const timeoutMs = Math.max(1000, Number(options?.timeoutMs || 8000));
  const corsMode = corsModeForImageRequest(src);
  const first = await loadImageOnce(requestSrc, corsMode, timeoutMs);
  if (first || !corsMode) return first;
  return loadImageOnce(requestSrc, "", timeoutMs);
}

export async function preloadCanvasImage(
  src: string,
  imageCache: Map<string, HTMLImageElement>,
  options?: { timeoutMs?: number },
): Promise<HTMLImageElement | null> {
  const keys = canvasImageCacheKeys(src);
  for (const key of keys) {
    const cached = imageCache.get(key);
    if (isDrawableImage(cached)) {
      keys.forEach((alias) => imageCache.set(alias, cached));
      return cached;
    }
  }

  const image = await loadCanvasImageElement(src, options);
  if (!image) return null;
  keys.forEach((key) => imageCache.set(key, image));
  return image;
}

export async function preloadCanvasImages(
  sources: Iterable<string>,
  imageCache: Map<string, HTMLImageElement>,
  options?: { timeoutMs?: number },
): Promise<void> {
  const unique = Array.from(new Set(Array.from(sources).map(normalizeCanvasImageSource).filter(Boolean)));
  if (!unique.length) return;
  await Promise.all(unique.map((src) => preloadCanvasImage(src, imageCache, options)));
}
