// Main-thread client for the client-side background-removal worker.
// Lazily spawns the worker (so transformers.js / the model only load on first
// use), couples requests/responses by id with a timeout, and turns the returned
// RGBA pixels into a PNG Blob ready to be used as an image source / uploaded.

import { apiUrl } from "../../../lib/api";

type WorkerOk = {
  id: string;
  ok: true;
  data: ArrayBuffer;
  width: number;
  height: number;
  channels: number;
  backend: string;
};
type WorkerErr = { id: string; ok: false; error: string };
type WorkerResp = WorkerOk | WorkerErr;

type Pending = { resolve: (v: WorkerOk) => void; reject: (e: unknown) => void; timer: number };

let worker: Worker | null = null;
const pending = new Map<string, Pending>();
let seq = 0;

function rejectAll(err: unknown): void {
  for (const [, entry] of pending) {
    clearTimeout(entry.timer);
    entry.reject(err);
  }
  pending.clear();
  worker = null; // force a fresh worker on the next attempt
}

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./bgRemoval.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (ev: MessageEvent<WorkerResp>) => {
    const res = ev.data;
    const entry = pending.get(res.id);
    if (!entry) return;
    pending.delete(res.id);
    clearTimeout(entry.timer);
    if (res.ok) entry.resolve(res);
    else entry.reject(new Error(res.error || "Failed to remove the background in the browser."));
  };
  worker.onerror = (e: ErrorEvent) => {
    rejectAll(new Error(e.message || "Background removal worker error."));
  };
  return worker;
}

function resolveSrc(source: string): string {
  if (/^(data:|blob:|https?:)/i.test(source)) return source;
  // "/api/assets/<id>" goes through the app's shared resolver (never API_BASE + "/api/...").
  return apiUrl(source.startsWith("/") ? source : `/${source}`);
}

async function fetchImageBlob(source: string): Promise<Blob> {
  const url = resolveSrc(source);
  const res = await fetch(url, source.startsWith("data:") ? {} : { credentials: "include" });
  if (!res.ok) throw new Error(`Could not load the image (${res.status}).`);
  return await res.blob();
}

function rgbaToPngBlob(buf: ArrayBuffer, width: number, height: number, channels: number): Promise<Blob> {
  const src = new Uint8Array(buf);
  let rgba: Uint8ClampedArray;
  if (channels === 4) {
    rgba = new Uint8ClampedArray(src);
  } else {
    rgba = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      const base = i * channels;
      const v = src[base] || 0;
      rgba[i * 4] = channels >= 3 ? src[base] : v;
      rgba[i * 4 + 1] = channels >= 3 ? src[base + 1] : v;
      rgba[i * 4 + 2] = channels >= 3 ? src[base + 2] : v;
      rgba[i * 4 + 3] = channels === 4 ? src[base + 3] : 255;
    }
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D unavailable.");
  ctx.putImageData(new ImageData(rgba, width, height), 0, 0);
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not generate the PNG."))), "image/png"),
  );
}

/**
 * Remove the background from an image source (data:/blob:/http(s)/relative API
 * path) fully in the browser and return a transparent PNG Blob.
 * Throws if the worker is unavailable or fails — callers can fall back.
 */
export async function removeBackgroundClientSide(
  source: string,
  options?: { timeoutMs?: number },
): Promise<Blob> {
  if (typeof Worker === "undefined") {
    throw new Error("Web Workers are unavailable in this environment.");
  }
  const blob = await fetchImageBlob(source);
  const w = ensureWorker();
  const id = `bg_${Date.now().toString(36)}_${(seq++).toString(36)}`;
  const timeoutMs = options?.timeoutMs ?? 120_000;
  const result = await new Promise<WorkerOk>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pending.delete(id);
      reject(new Error("Timed out removing the background in the browser."));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    w.postMessage({ id, type: "remove", blob });
  });
  return await rgbaToPngBlob(result.data, result.width, result.height, result.channels);
}
