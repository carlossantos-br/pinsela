import { paintSceneSnapshotToContext } from "../render/canvas2dPainter";
import type { RenderWorkerRequest, RenderWorkerResponse } from "./renderProtocol";
import {
  canvasImageCacheKeys,
  resolveCanvasImageRequestSrc,
  shouldUseCanvasImageCredentials,
} from "../../core/imageAssets";
import { loadPinselaFonts } from "../render/fontManifest";

// The worker has its own font set (separate from the document), so brand fonts
// must be loaded here too or canvas text falls back to a system font.
let fontsReady: Promise<void> | null = null;
function ensureFonts(): Promise<void> {
  if (!fontsReady) {
    const fontset = (self as unknown as { fonts?: { add: (f: FontFace) => void } }).fonts;
    fontsReady = fontset
      ? loadPinselaFonts(fontset, self.location?.origin || "")
      : Promise.resolve();
  }
  return fontsReady;
}

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<RenderWorkerRequest>) => void) | null;
  postMessage: (payload: RenderWorkerResponse) => void;
};

let offscreenCanvas: OffscreenCanvas | null = null;
let offscreenCtx: OffscreenCanvasRenderingContext2D | null = null;
const imageBitmapCache = new Map<string, ImageBitmap>();
const imageBitmapLoading = new Map<string, Promise<ImageBitmap | null>>();
const textMetricsCache = new Map<string, number>();

function safeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err || "unknown render worker error");
}

function resetCaches(): void {
  imageBitmapCache.forEach((bmp) => {
    try {
      bmp.close();
    } catch {
      // no-op
    }
  });
  imageBitmapCache.clear();
  imageBitmapLoading.clear();
  textMetricsCache.clear();
}

async function loadBitmap(src: string): Promise<ImageBitmap | null> {
  const key = String(src || "").trim();
  if (!key) return null;
  const cacheKeys = canvasImageCacheKeys(key);
  for (const cacheKey of cacheKeys) {
    if (imageBitmapCache.has(cacheKey)) return imageBitmapCache.get(cacheKey) || null;
  }
  const existing = imageBitmapLoading.get(key);
  if (existing) return existing;
  const pending = (async () => {
    try {
      const requestSrc = resolveCanvasImageRequestSrc(key);
      const response = await fetch(requestSrc, {
        cache: "force-cache",
        mode: "cors",
        credentials: shouldUseCanvasImageCredentials(key) ? "include" : "same-origin",
      });
      if (!response.ok) throw new Error(`image fetch failed (${response.status})`);
      const blob = await response.blob();
      const bitmap = await createImageBitmap(blob);
      cacheKeys.forEach((cacheKey) => imageBitmapCache.set(cacheKey, bitmap));
      return bitmap;
    } catch {
      return null;
    } finally {
      imageBitmapLoading.delete(key);
    }
  })();
  imageBitmapLoading.set(key, pending);
  return pending;
}

async function preloadSnapshotImages(sources: readonly string[]): Promise<void> {
  if (!sources.length) return;
  await Promise.all(sources.map((src) => loadBitmap(src)));
}

workerScope.onmessage = (event: MessageEvent<RenderWorkerRequest>) => {
  void (async () => {
    const req = event.data;
    try {
      if (req.type === "init") {
        offscreenCanvas = req.payload.canvas;
        offscreenCtx = offscreenCanvas.getContext("2d", { alpha: true, desynchronized: true });
        if (!offscreenCtx) throw new Error("offscreen 2d context unavailable");
        resetCaches();
        void ensureFonts();
        workerScope.postMessage({ id: req.id, ok: true, type: "init" });
        return;
      }

      if (req.type === "render") {
        if (!offscreenCanvas || !offscreenCtx) throw new Error("render worker not initialized");
        const snapshot = req.payload.snapshot;
        const pixelRatio = Math.max(1, Number(req.payload.pixelRatio || 1));
        const w = Math.max(1, Math.round(snapshot.canvas.width * pixelRatio));
        const h = Math.max(1, Math.round(snapshot.canvas.height * pixelRatio));
        if (offscreenCanvas.width !== w) offscreenCanvas.width = w;
        if (offscreenCanvas.height !== h) offscreenCanvas.height = h;
        await Promise.all([ensureFonts(), preloadSnapshotImages(snapshot.imageSources)]);

        paintSceneSnapshotToContext(offscreenCtx, snapshot, {
          width: snapshot.canvas.width,
          height: snapshot.canvas.height,
          pixelRatio,
          dirtyRegions: req.payload.dirtyRegions,
          imageCache: imageBitmapCache as unknown as Map<string, CanvasImageSource>,
          textMetricsCache,
        });
        workerScope.postMessage({ id: req.id, ok: true, type: "render" });
        return;
      }
    } catch (err) {
      workerScope.postMessage({
        id: req.id,
        ok: false,
        type: req.type,
        error: safeError(err),
      });
    }
  })();
};
