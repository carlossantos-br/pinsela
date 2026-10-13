import { apiFetch, apiUpload, apiUrl } from "../../../lib/api";
import type { PinselaTemplateDocV1 } from "../../core/types";
import { bridgeTextColorFromFill } from "../../core/textModels";
import { removeBackgroundClientSide } from "../bgRemoval/bgRemovalClient";

// --- Editor-safety normalization -------------------------------------------
// Docs authored by the agent/composer use two conventions the browser editor
// does not understand natively:
//   1. Color values as design-token refs, e.g. "$tokens.colors.bg".
//   2. image_src as an absolute filesystem path (works for the server-side
//      Python render, but the browser can't fetch a local filesystem path).
// The native renderer resolves tokens; the editor never did, so token refs were
// used raw as CSS colors (invalid -> black artboard, vanished fills) and
// filesystem images rendered as black/broken boxes. We normalize on load so any
// doc — however it was authored — displays correctly and stays editable.
function resolveTokenColor(value: unknown, tokens: any): unknown {
  if (typeof value !== "string" || !value.startsWith("$tokens.")) return value;
  let cur: any = tokens;
  for (const key of value.slice("$tokens.".length).split(".")) {
    cur = cur == null ? undefined : cur[key];
  }
  return typeof cur === "string" ? cur : value;
}

// Fallback asset for image nodes whose source file was lost (no recoverable id).
const MISSING_IMAGE_PLACEHOLDER_ASSET = "f9e0211e-37ec-4916-a45d-aec518bed032";
const UUID_IN_STRING = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

function normalizeOneDoc(d: any): void {
  if (!d || typeof d !== "object" || !Array.isArray(d.nodes)) return;
  const tokens = d.tokens || {};
  const color = (v: unknown) => resolveTokenColor(v, tokens);
  if (d.canvas && typeof d.canvas === "object") {
    d.canvas.background = color(d.canvas.background);
  }
  for (const node of d.nodes) {
    if (!node || typeof node !== "object") continue;
    // Composer text nodes ship without a `style` object. Many render/interaction
    // paths read node.style.<x> without optional chaining (hit-testing, layers),
    // so a missing style throws and silently breaks selection/drag. Guarantee a
    // style object here so every node is selectable and movable.
    if (!node.style || typeof node.style !== "object") node.style = {};
    const style = node.style;
    if (style && typeof style === "object") {
      if ("fill" in style) style.fill = color(style.fill);
      if (typeof style.stroke === "string") style.stroke = color(style.stroke);
      else if (style.stroke && typeof style.stroke === "object") style.stroke.color = color(style.stroke.color);
      if (Array.isArray(style.strokes)) {
        for (const st of style.strokes) {
          if (st && typeof st === "object") st.color = color(st.color);
        }
      }
    }
    const ts = node.text_style;
    if (ts && typeof ts === "object" && "color" in ts) ts.color = color(ts.color);
    // Bridge composer text color into the editor's canonical field. The composer
    // authors text color in `style.fill`; the editor (color picker, autosave)
    // reads/writes `text_style.color`. Without this, a downstream normalize/
    // autosave injects the #111111 default into text_style.color, which then wins
    // over fill and turns every text near-black in the editor while the exported
    // PNG (which falls back to fill) stays the authored color. See
    // bridgeTextColorFromFill for the exact (conservative) rule.
    bridgeTextColorFromFill(node);
    // Bridge composer `_macros.gradient` into a native gradient fill the editor
    // both renders (canvas2dPainter) and edits (ColorPicker). Only when the fill
    // isn't already a gradient, so a gradient the user authored via the picker is
    // never overwritten on reload.
    const macroGradient = node._macros && typeof node._macros === "object" ? node._macros.gradient : null;
    const fillIsGradient = style.fill && typeof style.fill === "object" && Array.isArray(style.fill.stops);
    if (
      macroGradient && typeof macroGradient === "object"
      && Array.isArray(macroGradient.stops) && macroGradient.stops.length
      && !fillIsGradient
    ) {
      const kind = String(macroGradient.gradient_type || macroGradient.type || "linear").toLowerCase();
      style.fill = {
        type: "gradient",
        gradient_type: kind === "radial" ? "radial" : "linear",
        angle: Number.isFinite(Number(macroGradient.angle)) ? Number(macroGradient.angle) : 90,
        stops: macroGradient.stops.map((s: any) => ({
          offset: Number((s && s.offset) || 0),
          color: color(s && s.color),
        })),
      };
    }
    // Stale filesystem image path -> registered asset URL. Prefer the node's
    // asset id (or any uuid embedded in the path); if none, fall back to the
    // missing-image placeholder so it never renders as a black box.
    if (node.kind === "image") {
      const src = String(node.image_src || "");
      if (/^\/(Users|private|tmp)\//.test(src) || src === "") {
        const fromId = String(node.image_asset_id || "").match(UUID_IN_STRING)?.[0];
        const fromSrc = src.match(UUID_IN_STRING)?.[0];
        const id = fromId || fromSrc || MISSING_IMAGE_PLACEHOLDER_ASSET;
        node.image_src = `/api/assets/${id}`;
        node.image_asset_id = id;
      }
    }
  }
}

export function normalizeDocForEditor<T>(doc: T): T {
  const d = doc as any;
  if (!d || typeof d !== "object") return doc;
  normalizeOneDoc(d);
  // The editor renders embedded project pages (project_pages_v1), each carrying
  // its own doc copy — normalize those too or a cached/edited project stays broken.
  const pp = d.metadata && typeof d.metadata === "object" ? d.metadata.project_pages_v1 : null;
  if (pp && Array.isArray(pp.pages)) {
    for (const page of pp.pages) {
      if (page && typeof page === "object" && page.doc) normalizeOneDoc(page.doc);
    }
  }
  return doc;
}
// ---------------------------------------------------------------------------

export type ProjectListItem = {
  id: string;
  key: string;
  name: string;
  engine_type?: string;
  locked?: boolean;
  created_at?: string | null;
  updated_at?: string | null;
  canvas_width?: number | null;
  canvas_height?: number | null;
};

// Compatibility alias while frontend migrates from template naming.
export type TemplateListItem = ProjectListItem;

type NativeProjectWireResponse = {
  ok: boolean;
  project?: ProjectListItem;
  template?: ProjectListItem;
  doc_json: PinselaTemplateDocV1;
  updated_at?: string | null;
};

export type NativeProjectResponse = {
  ok: boolean;
  project: ProjectListItem;
  template: ProjectListItem;
  doc_json: PinselaTemplateDocV1;
  updated_at?: string | null;
};

// Compatibility alias while frontend migrates from template naming.
export type NativeTemplateResponse = NativeProjectResponse;

export type NativeVersionItem = {
  pack_version: string;
  is_current: boolean;
  uploaded_at?: string | null;
  source?: string | null;
  node_count: number;
  preview_url?: string | null;
};

export type NativeVersionsResponse = {
  ok: boolean;
  current_pack_version?: string | null;
  versions: NativeVersionItem[];
};

export type NativeSimulateResponse = {
  ok: boolean;
  doc_json: PinselaTemplateDocV1;
};

export type AutomationTemplateBinding = {
  id: string;
  layer_name: string;
  kind: "text" | "image" | "frame";
};

export type AutomationTemplateSummary = {
  id: string;
  name: string;
  project_key?: string | null;
  source_page_name?: string | null;
  binding_count: number;
  created_at?: string | null;
  updated_at?: string | null;
};

export type AutomationTemplateDetail = {
  id: string;
  name: string;
  project_key?: string | null;
  source_page_name?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  bindings: AutomationTemplateBinding[];
  doc_json: PinselaTemplateDocV1;
};

type AutomationTemplateListResponse = {
  ok: boolean;
  items: AutomationTemplateSummary[];
};

type AutomationTemplateGetResponse = {
  ok: boolean;
  template: AutomationTemplateDetail;
};

type AutomationTemplateUpsertRequest = {
  name: string;
  project_key?: string | null;
  source_page_name?: string | null;
  doc_json: PinselaTemplateDocV1;
  bindings: AutomationTemplateBinding[];
};

type AutomationTemplateWriteResponse = {
  ok: boolean;
  template: AutomationTemplateSummary;
};

export type AssetItem = {
  id: string;
  kind?: string | null;
  name: string | null;
  preview_url: string;
  thumbnail_url?: string | null;
  tags?: string[];
  role?: string | null;
  folder?: string | null;
  mime_type?: string | null;
  ext?: string | null;
  bytes?: number | null;
  width?: number | null;
  height?: number | null;
  created_at?: string | null;
  source?: "pinsela";
  source_label?: string | null;
};

type AssetsResponse = {
  ok: boolean;
  items: AssetItem[];
};

type RemoveBackgroundResponse = {
  ok: boolean;
  asset: AssetItem;
  meta?: {
    model?: string;
    source_kind?: string;
  };
};

type UploadAssetResponse = {
  ok: boolean;
  asset: AssetItem;
};

type DraftResponse = {
  ok: boolean;
  doc_json: PinselaTemplateDocV1;
  meta?: { updated_at?: string | null } | null;
};

type PublishRequest = {
  project_name?: string;
  template_name?: string;
  doc_json: PinselaTemplateDocV1;
  preview_png_b64: string;
  source: string;
  use_draft?: boolean;
};

type NativeRenderBundleResponse = {
  ok: boolean;
  run_id: string;
  png_url?: string | null;
  jpg_url?: string | null;
};

type NativeRenderRequest = {
  template_key: string;
  payload: Record<string, any>;
  kind: "bundle";
  save: true;
  scale: number;
  area: "page" | "selection";
  background_mode: "as-is" | "transparent" | "white";
};

type NativeSimulateRequest = {
  doc_json: PinselaTemplateDocV1;
  payload: Record<string, any>;
};

type SaveDraftRequest = {
  doc_json: PinselaTemplateDocV1;
  source: string;
  sync_current?: boolean;
  /** Optional PNG thumbnail (base64) stored as the project card preview. */
  preview_png_b64?: string;
};

type BulkCreateJobsResponse = {
  ok: boolean;
  created: number;
  failed: number;
};

type BulkCreateJobsRequest = {
  template_key: string;
  rows: Record<string, any>[];
  output_kind: "jpg" | "png";
  render_local: boolean;
};

function normalizeProjectKey(projectKey: string): string {
  return String(projectKey || "").trim().toLowerCase();
}

export function resolvePinselaApiPath(path: string): string {
  return apiUrl(path);
}

export async function fetchProjectList(): Promise<ProjectListItem[]> {
  return apiFetch<ProjectListItem[]>("/projects?lite=1");
}

export async function fetchTemplateList(): Promise<TemplateListItem[]> {
  return fetchProjectList();
}

export async function deleteProjectById(projectId: string): Promise<{ ok: boolean }> {
  const id = String(projectId || "").trim();
  if (!id) throw new Error("Invalid projectId.");
  return apiFetch<{ ok: boolean }>(`/projects/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function deleteTemplateById(templateId: string): Promise<{ ok: boolean }> {
  return deleteProjectById(templateId);
}

export async function fetchPinselaAssets(assetSearch: string, limit = 120): Promise<AssetItem[]> {
  const query = String(assetSearch || "").trim();
  // Media library always comes from the LOCAL backend (/assets), which is where
  // user uploads end up (uploadPinselaAsset -> /assets/upload).
  const path = `/assets?limit=${Math.max(1, limit)}${query ? `&q=${encodeURIComponent(query)}` : ""}`;
  const res = await apiFetch<AssetsResponse>(
    path,
    { timeoutMs: query ? 10_000 : 6_000 },
  );
  return (res.items || []).map((a) => ({
    ...a,
    preview_url: resolvePinselaApiPath(a.preview_url),
    thumbnail_url: a.thumbnail_url ? resolvePinselaApiPath(a.thumbnail_url) : null,
    source: "pinsela",
    source_label: "Local library",
  }));
}

function assetSortValue(asset: AssetItem): number {
  const ts = String(asset.created_at || "").trim();
  if (!ts) return 0;
  const value = Date.parse(ts);
  return Number.isFinite(value) ? value : 0;
}

export async function fetchLocalEditorAssetLibrary(assetSearch: string, limit = 160): Promise<AssetItem[]> {
  const results = await Promise.allSettled([
        fetchPinselaAssets(assetSearch, Math.max(24, limit)),
  ]);

  const merged: AssetItem[] = [];
  const seen = new Set<string>();
  let firstError: unknown = null;

  results.forEach((result) => {
    if (result.status === "rejected") {
      firstError ||= result.reason;
      return;
    }
    result.value.forEach((asset) => {
      const key = `${asset.source || "unknown"}:${asset.id}`;
      if (seen.has(key)) return;
      seen.add(key);
      merged.push(asset);
    });
  });

  if (!merged.length && firstError) {
    throw firstError;
  }

  return merged.sort((left, right) => {
    const delta = assetSortValue(right) - assetSortValue(left);
    if (delta !== 0) return delta;
    return String(left.name || "").localeCompare(String(right.name || ""), "en-US", { sensitivity: "base" });
  });
}

export async function uploadPinselaAsset(
  file: File,
  options?: {
    name?: string | null;
    tags?: string[] | null;
  },
): Promise<AssetItem> {
  const form = new FormData();
  form.append("file", file);
  if (options?.name != null) {
    form.append("name", String(options.name || "").trim());
  }
  if (options?.tags?.length) {
    form.append("tags", options.tags.join(","));
  }
  const res = await apiUpload<UploadAssetResponse>("/assets/upload", form);
  return {
    ...res.asset,
    preview_url: resolvePinselaApiPath(res.asset.preview_url),
    thumbnail_url: res.asset.thumbnail_url ? resolvePinselaApiPath(res.asset.thumbnail_url) : null,
    source: "pinsela",
    source_label: "Local library",
  };
}

export async function removeBackgroundFromImageSource(
  source: string,
  options?: {
    name?: string | null;
    timeoutMs?: number;
  },
): Promise<AssetItem> {
  // Primary path: remove the background entirely in the browser (Web Worker +
  // transformers.js + ormbg). The server never processes the image — it only
  // stores the resulting PNG via the normal asset-upload endpoint, which is
  // cheap and safe for a small multi-tenant server.
  try {
    const pngBlob = await removeBackgroundClientSide(source, { timeoutMs: options?.timeoutMs });
    const baseName = String(options?.name || "cutout").replace(/\.[^.]+$/, "").trim() || "cutout";
    const file = new File([pngBlob], `${baseName}.png`, { type: "image/png" });
    return await uploadPinselaAsset(file, { name: options?.name ?? null, tags: ["bg-removed"] });
  } catch (clientError) {
    // Fallback: server-side rembg. Kept for resilience (e.g. a browser without
    // WebGPU/WASM support, or a worker/model load failure). Remove once the
    // client-side path is fully proven and rembg is dropped from the server.
    if (typeof console !== "undefined" && console.warn) {
      console.warn("[bg-removal] browser failed, falling back to the server:", clientError);
    }
    const res = await apiFetch<RemoveBackgroundResponse>("/assets/remove-background", {
      method: "POST",
      timeoutMs: options?.timeoutMs ?? 180_000,
      json: {
        source,
        name: options?.name ?? null,
      },
    });
    return {
      ...res.asset,
      preview_url: resolvePinselaApiPath(res.asset.preview_url),
      thumbnail_url: res.asset.thumbnail_url ? resolvePinselaApiPath(res.asset.thumbnail_url) : null,
      source: "pinsela",
      source_label: "Local library",
    };
  }
}

export async function fetchNativeProjectByKey(projectKey: string): Promise<NativeProjectResponse> {
  const key = normalizeProjectKey(projectKey);
  const res = await apiFetch<NativeProjectWireResponse>(`/projects/${encodeURIComponent(key)}/native`);
  const project = res.project || res.template;
  if (!project) throw new Error("Invalid project returned by the API.");
  return {
    ok: res.ok,
    project,
    template: project,
    doc_json: normalizeDocForEditor(res.doc_json),
    updated_at: res.updated_at ?? null,
  };
}

export async function fetchNativeTemplateByKey(templateKey: string): Promise<NativeTemplateResponse> {
  return fetchNativeProjectByKey(templateKey);
}

export async function fetchNativeProjectDraftByKey(projectKey: string): Promise<DraftResponse> {
  const key = normalizeProjectKey(projectKey);
  const res = await apiFetch<DraftResponse>(`/projects/${encodeURIComponent(key)}/native/draft`);
  if (res && res.doc_json) res.doc_json = normalizeDocForEditor(res.doc_json);
  return res;
}

export async function fetchNativeDraftByKey(templateKey: string): Promise<DraftResponse> {
  return fetchNativeProjectDraftByKey(templateKey);
}

export async function saveNativeProjectDraftByKey(projectKey: string, req: SaveDraftRequest): Promise<{ ok: boolean }> {
  const key = normalizeProjectKey(projectKey);
  try {
    return await apiFetch<{ ok: boolean }>(`/projects/${encodeURIComponent(key)}/autosave-delta`, {
      method: "POST",
      json: req,
    });
  } catch (error: any) {
    const status = Number((error && (error.status ?? error?.body?.status)) || 0);
    if (status !== 404) throw error;
    // Compatibility fallback for older servers while rolling deploy.
    return apiFetch<{ ok: boolean }>(`/projects/${encodeURIComponent(key)}/native/draft`, {
      method: "POST",
      json: req,
    });
  }
}

export async function saveNativeDraftByKey(templateKey: string, req: SaveDraftRequest): Promise<{ ok: boolean }> {
  return saveNativeProjectDraftByKey(templateKey, req);
}

export async function publishNativeProjectByKey(projectKey: string, req: PublishRequest): Promise<{ ok: boolean }> {
  const key = normalizeProjectKey(projectKey);
  return apiFetch<{ ok: boolean }>(`/projects/${encodeURIComponent(key)}/native/publish`, {
    method: "POST",
    json: {
      ...req,
      template_name: req.template_name || req.project_name || "",
      project_name: req.project_name || req.template_name || "",
    },
  });
}

export async function publishNativeTemplateByKey(templateKey: string, req: PublishRequest): Promise<{ ok: boolean }> {
  return publishNativeProjectByKey(templateKey, req);
}

export async function fetchNativeProjectVersionsByKey(projectKey: string): Promise<NativeVersionsResponse> {
  const key = normalizeProjectKey(projectKey);
  const res = await apiFetch<NativeVersionsResponse>(`/projects/${encodeURIComponent(key)}/native/versions`);
  return {
    ...res,
    versions: (res.versions || []).map((v) => ({
      ...v,
      preview_url: v.preview_url ? resolvePinselaApiPath(v.preview_url) : null,
    })),
  };
}

export async function fetchNativeVersionsByKey(templateKey: string): Promise<NativeVersionsResponse> {
  return fetchNativeProjectVersionsByKey(templateKey);
}

export async function restoreNativeProjectVersionByKey(projectKey: string, packVersion: string): Promise<{ ok: boolean }> {
  const key = normalizeProjectKey(projectKey);
  return apiFetch<{ ok: boolean }>(`/projects/${encodeURIComponent(key)}/native/restore`, {
    method: "POST",
    json: { pack_version: packVersion },
  });
}

export async function restoreNativeVersionByKey(templateKey: string, packVersion: string): Promise<{ ok: boolean }> {
  return restoreNativeProjectVersionByKey(templateKey, packVersion);
}

export async function runNativeRenderBundle(req: NativeRenderRequest): Promise<NativeRenderBundleResponse> {
  return apiFetch<NativeRenderBundleResponse>("/render/native/test", {
    method: "POST",
    json: req,
  });
}

export async function simulateNativeProjectByKey(projectKey: string, req: NativeSimulateRequest): Promise<NativeSimulateResponse> {
  const key = normalizeProjectKey(projectKey);
  return apiFetch<NativeSimulateResponse>(`/projects/${encodeURIComponent(key)}/native/simulate`, {
    method: "POST",
    json: req,
  });
}

export async function simulateNativeTemplateByKey(templateKey: string, req: NativeSimulateRequest): Promise<NativeSimulateResponse> {
  return simulateNativeProjectByKey(templateKey, req);
}

export async function createArtworkJobsBulk(req: BulkCreateJobsRequest): Promise<BulkCreateJobsResponse> {
  return apiFetch<BulkCreateJobsResponse>("/jobs/create-artworks-bulk", {
    method: "POST",
    json: req,
  });
}

export async function fetchAutomationTemplateList(): Promise<AutomationTemplateSummary[]> {
  const res = await apiFetch<AutomationTemplateListResponse>("/automation-templates");
  return res.items || [];
}

export async function fetchAutomationTemplateById(templateId: string): Promise<AutomationTemplateDetail> {
  const id = String(templateId || "").trim();
  if (!id) throw new Error("Invalid templateId.");
  const res = await apiFetch<AutomationTemplateGetResponse>(`/automation-templates/${encodeURIComponent(id)}`);
  return res.template;
}

export async function createAutomationTemplate(req: AutomationTemplateUpsertRequest): Promise<AutomationTemplateSummary> {
  const res = await apiFetch<AutomationTemplateWriteResponse>("/automation-templates", {
    method: "POST",
    json: req,
  });
  return res.template;
}

export async function updateAutomationTemplateById(
  templateId: string,
  req: AutomationTemplateUpsertRequest,
): Promise<AutomationTemplateSummary> {
  const id = String(templateId || "").trim();
  if (!id) throw new Error("Invalid templateId.");
  const res = await apiFetch<AutomationTemplateWriteResponse>(`/automation-templates/${encodeURIComponent(id)}`, {
    method: "PUT",
    json: req,
  });
  return res.template;
}

export async function deleteAutomationTemplateById(templateId: string): Promise<{ ok: boolean }> {
  const id = String(templateId || "").trim();
  if (!id) throw new Error("Invalid templateId.");
  return apiFetch<{ ok: boolean }>(`/automation-templates/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}
