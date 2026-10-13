import type { PinselaNode } from "./core/types";

export interface PinselaClipboardPayload {
  /** uuid generated on every copy; the OS clipboard carries only this id (in the marker). */
  id: string;
  nodes: PinselaNode[];
  selectedIds: string[];
  sourceProject?: string;
  savedAt: number;
}

const KEY = "pinsela:clipboard:v2";
const MAX_BYTES = 2_000_000; // ~2MB — guards against elements with a giant data URI
const MARKER_ATTR = "data-pinsela-clip";

function getStorage(): Storage | null {
  try {
    if (typeof globalThis === "undefined") return null;
    const s = (globalThis as { localStorage?: Storage }).localStorage;
    if (!s) return null;
    return s;
  } catch {
    return null;
  }
}

function isValidPayload(value: unknown): value is PinselaClipboardPayload {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== "string" || !v.id) return false;
  if (!Array.isArray(v.nodes) || v.nodes.length === 0) return false;
  if (!Array.isArray(v.selectedIds)) return false;
  return v.nodes.every(
    (n) =>
      !!n &&
      typeof n === "object" &&
      typeof (n as Record<string, unknown>).id === "string" &&
      typeof (n as Record<string, unknown>).kind === "string" &&
      !!(n as Record<string, unknown>).geometry,
  );
}

export function writeClipboard(payload: PinselaClipboardPayload): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    const serialized = JSON.stringify(payload);
    if (serialized.length > MAX_BYTES) return; // keep in-memory only; copy does not break
    storage.setItem(KEY, serialized);
  } catch {
    // QuotaExceededError or private mode — ignore, stay in-memory only
  }
}

export function readClipboard(): PinselaClipboardPayload | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return isValidPayload(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Returns the payload ONLY if the persisted id matches `id` (the id that came in
 * the OS clipboard marker). This guarantees recency: if the user copied something
 * else on top, the marker points to an id that is no longer in localStorage
 * (or differs) → a stale copy is not pasted.
 */
export function readClipboardMatching(id: string): PinselaClipboardPayload | null {
  if (!id) return null;
  const payload = readClipboard();
  return payload && payload.id === id ? payload : null;
}

export function clearClipboard(): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(KEY);
  } catch {
    // ignora
  }
}

/**
 * Invisible marker written to the OS clipboard on copy. An empty <div> with the
 * id: Pinsela recognizes it on the `paste` event, any other app pastes nothing visible.
 */
export function buildClipboardMarkerHtml(id: string): string {
  return `<div ${MARKER_ATTR}="${id}"></div>`;
}

/**
 * Extracts the marker id from text/html coming from the OS clipboard. Tolerates the
 * wrapper <html><body> and the single/double quotes Chrome injects in the round-trip.
 * Returns null when there is no marker (image/text pasted from outside).
 */
export function parseClipboardMarkerId(html: string): string | null {
  if (!html) return null;
  const m = html.match(new RegExp(`${MARKER_ATTR}=["']([^"']+)["']`));
  return m ? m[1] : null;
}

/**
 * Writes the marker (id only) to the OS clipboard. Thin wrapper over the async
 * Clipboard API; failures (focus/write permission) return false without throwing — the
 * payload in localStorage covers the same session. Verified e2e (Playwright).
 */
export async function writeOsClipboardMarker(id: string): Promise<boolean> {
  try {
    if (
      typeof navigator === "undefined" ||
      !navigator.clipboard ||
      typeof navigator.clipboard.write !== "function" ||
      typeof ClipboardItem === "undefined"
    ) {
      return false;
    }
    const item = new ClipboardItem({
      "text/html": new Blob([buildClipboardMarkerHtml(id)], { type: "text/html" }),
      "text/plain": new Blob([""], { type: "text/plain" }),
    });
    await navigator.clipboard.write([item]);
    return true;
  } catch {
    return false;
  }
}

/** Notifies when another tab writes to the clipboard. Returns unsubscribe. */
export function subscribeClipboard(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: StorageEvent) => {
    if (e.key === KEY || e.key === null) cb();
  };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}

export const __test__ = { KEY, MAX_BYTES };
