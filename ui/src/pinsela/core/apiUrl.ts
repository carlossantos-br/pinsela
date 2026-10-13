// Pure helpers to turn server paths ("/api/assets/<id>", "/api/templates/...") into
// request URLs that honour the configured API base (VITE_API_BASE).
//
// Stored documents always keep the canonical origin-relative form ("/api/assets/<id>");
// the base is applied only when a URL is requested (img.src, fetch, ...).

const API_PATH_RE = /^\/(?:v2\/)?api(?:\/|$)/i;

/** "https://host:8000/api" -> "https://host:8000"; "/api" -> ""; "/v2/api" -> "/v2". */
export function apiPrefixFromBase(apiBase: string): string {
  return String(apiBase || "").trim().replace(/\/+$/, "").replace(/\/api$/i, "");
}

/** Resolve a server path against the API prefix. Non-API and data:/blob: URLs are returned untouched. */
export function resolveApiUrlWithPrefix(path: string, prefix: string): string {
  const raw = String(path || "").trim();
  if (!raw) return "";
  if (/^(data:|blob:)/i.test(raw)) return raw;
  if (/^https?:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw);
      if (API_PATH_RE.test(parsed.pathname) && !prefix.startsWith("http")) {
        // Absolute URL to our own API stored in a doc: re-point it to the configured base.
        return resolveApiUrlWithPrefix(`${parsed.pathname}${parsed.search}${parsed.hash}`, prefix);
      }
    } catch {
      return raw;
    }
    return raw;
  }
  if (!API_PATH_RE.test(raw)) return raw;
  return `${prefix}${raw.replace(/^\/v2\/api(?=\/|$)/i, "/api")}`;
}
