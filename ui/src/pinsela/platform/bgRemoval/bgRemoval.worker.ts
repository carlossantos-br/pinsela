/// <reference lib="webworker" />
// Client-side background removal worker.
// Runs entirely in the browser (WebGPU, WASM fallback) so the server never does
// any image processing — it only stores the resulting PNG. Mirrors the validated
// demo stack: transformers.js `background-removal` pipeline + `ormbg`
// (ISNet, Apache-2.0, general-purpose: objects + people).
//
// transformers.js is a pinned npm dependency (@huggingface/transformers) and is
// bundled by Vite; nothing executable is fetched from a CDN at runtime.
// Only the MODEL WEIGHTS (onnx-community/ormbg-ONNX, Apache-2.0) are downloaded
// from the Hugging Face hub on first use and then kept in the browser cache.

import { pipeline, env, RawImage } from "@huggingface/transformers";

// onnxruntime-web otherwise fetches its WASM runtime (.mjs + .wasm) from jsDelivr at
// runtime. Point it at the copies bundled by Vite so no third-party code is loaded.
const isSafari = /^((?!chrome|android).)*safari/i.test((self as any).navigator?.userAgent || "");
const ortFiles = isSafari
  ? {
      mjs: new URL("../../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs", import.meta.url).href,
      wasm: new URL("../../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm", import.meta.url).href,
    }
  : {
      mjs: new URL("../../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs", import.meta.url).href,
      wasm: new URL("../../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm", import.meta.url).href,
    };
(env.backends as any).onnx.wasm.wasmPaths = ortFiles;

env.allowLocalModels = false;
env.useBrowserCache = true;

const MODEL = "onnx-community/ormbg-ONNX"; // ISNet · Apache-2.0 · general

type RemoveRequest = { id: string; type: "remove"; blob: Blob };
type RemoveOk = {
  id: string;
  ok: true;
  data: ArrayBuffer;
  width: number;
  height: number;
  channels: number;
  backend: string;
};
type RemoveErr = { id: string; ok: false; error: string };

const removers = new Map<string, unknown>();
async function getRemover(device: "webgpu" | "wasm", dtype: string): Promise<any> {
  const key = `${device}|${dtype}`;
  let p = removers.get(key);
  if (!p) {
    p = await pipeline("background-removal", MODEL, { device, dtype } as any);
    removers.set(key, p);
  }
  return p;
}

// Best backend first; WebGPU when present, else (or on failure) single-thread WASM.
function attempts(): Array<["webgpu" | "wasm", string]> {
  const nav: any = (self as any).navigator;
  const hasGpu = !!(nav && nav.gpu);
  return hasGpu ? [["webgpu", "fp16"], ["wasm", "q8"]] : [["wasm", "q8"]];
}

self.onmessage = async (ev: MessageEvent<RemoveRequest>) => {
  const msg = ev.data;
  if (!msg || msg.type !== "remove") return;
  try {
    const image = await RawImage.fromBlob(msg.blob);
    let out: any = null;
    let backend = "";
    let lastErr: unknown = null;
    for (const [device, dtype] of attempts()) {
      try {
        const remover = await getRemover(device, dtype);
        out = await remover(image);
        backend = device;
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
      }
    }
    if (!out) throw lastErr ?? new Error("Failed to remove background.");
    const raw = Array.isArray(out) ? out[0] : out;
    const rgba = new Uint8Array(raw.data); // copy into a fresh, transferable buffer
    const res: RemoveOk = {
      id: msg.id,
      ok: true,
      data: rgba.buffer,
      width: raw.width,
      height: raw.height,
      channels: raw.channels ?? 4,
      backend,
    };
    (self as any).postMessage(res, [rgba.buffer]);
  } catch (e: any) {
    const res: RemoveErr = { id: msg.id, ok: false, error: (e && e.message) || String(e) };
    (self as any).postMessage(res);
  }
};
