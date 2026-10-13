import { apiPrefixFromBase, resolveApiUrlWithPrefix } from "../pinsela/core/apiUrl";
import { setAssetApiPrefix } from "../pinsela/core/imageAssets";

function normalizeApiBase(v: string | undefined): string {
  // Allow overriding to a full origin, e.g. "https://api.example.com/api".
  let base = (v || "").trim();
  if (!base) {
    // Default to same-origin API under the app's BASE_URL.
    const b = (import.meta.env.BASE_URL || "/").replace(/\/+$/, "");
    base = `${b}/api`;
  }
  base = base.replace(/\/+$/, "");
  return base;
}

export const API_BASE = normalizeApiBase(import.meta.env.VITE_API_BASE);
const API_PREFIX = apiPrefixFromBase(API_BASE);
setAssetApiPrefix(API_PREFIX);

/** Single resolver for server URLs ("/api/assets/<id>", "/api/templates/..."): honours VITE_API_BASE. */
export function apiUrl(path: string): string {
  return resolveApiUrlWithPrefix(path, API_PREFIX);
}
const CSRF_COOKIE_NAME = "pinsela_csrf";
const CSRF_HEADER_NAME = "X-CSRF-Token";
const DEFAULT_API_TIMEOUT_MS = 30_000;

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const prefix = `${name}=`;
  const chunks = document.cookie.split(";");
  for (const chunk of chunks) {
    const trimmed = chunk.trim();
    if (!trimmed.startsWith(prefix)) continue;
    return decodeURIComponent(trimmed.slice(prefix.length));
  }
  return null;
}

function isWriteMethod(method: string): boolean {
  const normalized = String(method || "GET").toUpperCase();
  return normalized === "POST" || normalized === "PUT" || normalized === "PATCH" || normalized === "DELETE";
}

export class ApiError extends Error {
  status: number;
  body: any;
  constructor(message: string, status: number, body: any) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

type ApiRequestOptions = RequestInit & { json?: any; timeoutMs?: number };
export type ApiStreamEvent<T = any> = {
  event: string;
  data: T;
};

function createRequestSignal(timeoutMs: number, externalSignal?: AbortSignal | null): {
  signal: AbortSignal;
  cleanup: () => void;
  didTimeout: () => boolean;
} {
  const controller = new AbortController();
  const resolvedTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? Math.round(timeoutMs)
    : DEFAULT_API_TIMEOUT_MS;

  let timeoutTriggered = false;
  const timerId = globalThis.setTimeout(() => {
    timeoutTriggered = true;
    controller.abort();
  }, resolvedTimeout);

  const onExternalAbort = () => {
    controller.abort();
  };

  if (externalSignal) {
    if (externalSignal.aborted) {
      onExternalAbort();
    } else {
      externalSignal.addEventListener("abort", onExternalAbort, { once: true });
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      globalThis.clearTimeout(timerId);
      if (externalSignal) {
        externalSignal.removeEventListener("abort", onExternalAbort);
      }
    },
    didTimeout: () => timeoutTriggered,
  };
}

export async function apiFetch<T>(
  path: string,
  opts: ApiRequestOptions = {}
): Promise<T> {
  const {
    json,
    timeoutMs,
    signal: externalSignal,
    ...requestInit
  } = opts;
  const headers = new Headers(opts.headers || {});
  const method = String(opts.method || "GET").toUpperCase();
  if (json !== undefined) headers.set("content-type", "application/json");
  if (isWriteMethod(method) && !headers.has(CSRF_HEADER_NAME)) {
    const csrfToken = readCookie(CSRF_COOKIE_NAME);
    if (csrfToken) headers.set(CSRF_HEADER_NAME, csrfToken);
  }

  const { signal, cleanup, didTimeout } = createRequestSignal(
    timeoutMs ?? DEFAULT_API_TIMEOUT_MS,
    externalSignal,
  );

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...requestInit,
      method,
      headers,
      signal,
      credentials: "include",
      body: json !== undefined ? JSON.stringify(json) : requestInit.body,
    });
    const ct = res.headers.get("content-type") || "";
    const body = ct.includes("application/json") ? await res.json() : await res.text();
    if (!res.ok) {
      throw new ApiError(body?.detail || `HTTP ${res.status}`, res.status, body);
    }
    return body as T;
  } catch (error) {
    if (didTimeout()) {
      throw new Error("Request timed out.");
    }
    throw error;
  } finally {
    cleanup();
  }
}

export async function apiUpload<T>(path: string, form: FormData, opts: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const {
    timeoutMs,
    signal: externalSignal,
    ...requestInit
  } = opts;
  const headers = new Headers(opts.headers || {});
  const method = String(opts.method || "POST").toUpperCase();
  if (isWriteMethod(method) && !headers.has(CSRF_HEADER_NAME)) {
    const csrfToken = readCookie(CSRF_COOKIE_NAME);
    if (csrfToken) headers.set(CSRF_HEADER_NAME, csrfToken);
  }

  const { signal, cleanup, didTimeout } = createRequestSignal(
    timeoutMs ?? DEFAULT_API_TIMEOUT_MS,
    externalSignal,
  );

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...requestInit,
      method,
      headers,
      signal,
      credentials: "include",
      body: form,
    });
    const ct = res.headers.get("content-type") || "";
    const body = ct.includes("application/json") ? await res.json() : await res.text();
    if (!res.ok) {
      throw new ApiError((body as any)?.detail || `HTTP ${res.status}`, res.status, body);
    }
    return body as T;
  } catch (error) {
    if (didTimeout()) {
      throw new Error("Request timed out.");
    }
    throw error;
  } finally {
    cleanup();
  }
}

function consumeSseBuffer(buffer: string): {
  events: ApiStreamEvent[];
  remaining: string;
} {
  const chunks = buffer.split(/\n\n/);
  const remaining = chunks.pop() ?? "";
  const events: ApiStreamEvent[] = [];

  for (const chunk of chunks) {
    const lines = chunk.split(/\r?\n/);
    let eventName = "message";
    const dataParts: string[] = [];
    for (const line of lines) {
      if (!line || line.startsWith(":")) continue;
      if (line.startsWith("event:")) {
        eventName = line.slice(6).trim() || "message";
        continue;
      }
      if (line.startsWith("data:")) {
        dataParts.push(line.slice(5).trimStart());
      }
    }
    if (dataParts.length === 0) continue;
    const raw = dataParts.join("\n");
    let data: any = raw;
    try {
      data = JSON.parse(raw);
    } catch {
      data = raw;
    }
    events.push({ event: eventName, data });
  }

  return { events, remaining };
}

export async function apiStream(
  path: string,
  opts: ApiRequestOptions & {
    onEvent: (event: ApiStreamEvent) => void;
  },
): Promise<void> {
  const {
    json,
    timeoutMs,
    signal: externalSignal,
    onEvent,
    ...requestInit
  } = opts;
  const headers = new Headers(opts.headers || {});
  const method = String(opts.method || "GET").toUpperCase();
  headers.set("accept", "text/event-stream");
  if (json !== undefined) headers.set("content-type", "application/json");
  if (isWriteMethod(method) && !headers.has(CSRF_HEADER_NAME)) {
    const csrfToken = readCookie(CSRF_COOKIE_NAME);
    if (csrfToken) headers.set(CSRF_HEADER_NAME, csrfToken);
  }

  const { signal, cleanup, didTimeout } = createRequestSignal(
    timeoutMs ?? DEFAULT_API_TIMEOUT_MS,
    externalSignal,
  );

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...requestInit,
      method,
      headers,
      signal,
      credentials: "include",
      body: json !== undefined ? JSON.stringify(json) : requestInit.body,
    });
    if (!res.ok) {
      const ct = res.headers.get("content-type") || "";
      const body = ct.includes("application/json") ? await res.json() : await res.text();
      throw new ApiError((body as any)?.detail || `HTTP ${res.status}`, res.status, body);
    }
    if (!res.body) {
      throw new Error("Streaming is not supported for this response.");
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parsed = consumeSseBuffer(buffer);
      buffer = parsed.remaining;
      for (const event of parsed.events) {
        onEvent(event);
      }
    }
    buffer += decoder.decode();
    const parsed = consumeSseBuffer(buffer);
    for (const event of parsed.events) {
      onEvent(event);
    }
  } catch (error) {
    if (didTimeout()) {
      throw new Error("Request timed out.");
    }
    throw error;
  } finally {
    cleanup();
  }
}
