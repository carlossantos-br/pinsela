import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { PinselaTemplateDocV1 } from "../core/types";
import type {
  NativeVersionItem,
  AssetItem,
  ProjectListItem,
} from "../platform/api/pinselaNativeApi";
import {
  deleteProjectById,
  fetchLocalEditorAssetLibrary,
  fetchNativeProjectDraftByKey,
  fetchNativeProjectByKey,
  fetchNativeProjectVersionsByKey,
  fetchPinselaAssets,
  fetchProjectList,
  publishNativeProjectByKey,
  restoreNativeProjectVersionByKey,
  runNativeRenderBundle,
  saveNativeProjectDraftByKey,
  createArtworkJobsBulk,
} from "../platform/api/pinselaNativeApi";
import { useAuth } from "../../lib/auth";
import { autosaveKey, cloneDoc, parseCsvPayloads } from "../engine/core/documentUtils";
import { normalizeTextDoc } from "../core/textModels";

// 2026-05-27: the "local sandbox" feature (editor 100% in the browser via IndexedDB)
// was removed because it caused project loss. Everything goes through the backend
// now — see docs/ARCHITECTURE.md section 2.
export type ProjectApiMode = "remote";

export interface UseProjectApiOptions {
  mode?: ProjectApiMode;
  useLocalAssetLibrary?: boolean;
  enableAssets?: boolean;
  autosaveSyncCurrent?: boolean;
  hidePublish?: boolean;
  hideVersions?: boolean;
}

export interface ProjectApiState {
  mode: ProjectApiMode;
  supportsPublish: boolean;
  supportsVersions: boolean;
  supportsBulkJobs: boolean;
  supportsAutomations: boolean;
  supportsJobs: boolean;
  supportsRemoteAssets: boolean;
  homePath: string;

  projects: ProjectListItem[];
  projectsLoading: boolean;
  assets: AssetItem[];
  assetsLoading: boolean;
  versions: NativeVersionItem[];

  projectKey: string;
  projectName: string;
  assetSearch: string;
  busy: boolean;
  info: string | null;
  error: string | null;

  setProjectKey: (k: string) => void;
  setProjectName: (n: string) => void;
  setAssetSearch: (s: string) => void;
  refreshAssets: () => Promise<void>;

  loadProject: (key: string) => Promise<PinselaTemplateDocV1 | null>;
  loadDraft: (key: string) => Promise<PinselaTemplateDocV1 | null>;
  /** `localBackupOk=false` means the browser refused the local copy (e.g. storage quota). */
  saveDraft: (key: string, doc: PinselaTemplateDocV1, previewPngB64?: string) => Promise<{ localBackupOk: boolean }>;
  loadVersions: (key: string) => Promise<void>;
  restoreVersion: (key: string, versionId: string) => Promise<boolean>;
  publishProject: (key: string, doc: PinselaTemplateDocV1, projName: string) => Promise<void>;
  renderBundle: (key: string, doc: PinselaTemplateDocV1) => Promise<string | null>;
  createBulkJobs: (key: string, csv: string) => Promise<void>;
  deleteProject: (projectId: string) => Promise<boolean>;
  localSave: (key: string, doc: PinselaTemplateDocV1) => boolean;
  localLoad: (key: string) => PinselaTemplateDocV1 | null;
  localLoadMeta: (key: string) => { doc: PinselaTemplateDocV1; savedAt: number } | null;
  loadLocalMirror: (key: string) => Promise<PinselaTemplateDocV1 | null>;
  loadLocalRecovery: (key: string) => Promise<PinselaTemplateDocV1 | null>;

  templates: ProjectListItem[];
  templatesLoading: boolean;
  templateKey: string;
  templateName: string;
  setTemplateKey: (k: string) => void;
  setTemplateName: (n: string) => void;
  loadTemplate: (key: string) => Promise<PinselaTemplateDocV1 | null>;
  publish: (key: string, doc: PinselaTemplateDocV1, projName: string) => Promise<void>;
  deleteTemplate: (projectId: string) => Promise<boolean>;

  clearInfo: () => void;
  clearError: () => void;
}

export type TemplateApiState = ProjectApiState;

export function useProjectApi(options: UseProjectApiOptions = {}): ProjectApiState {
  const qc = useQueryClient();
  const { me, loading: authLoading } = useAuth();
  const mode: ProjectApiMode = "remote";
  const autosaveSyncCurrent = options.autosaveSyncCurrent === true;
  const useLocalAssetLibrary = options.useLocalAssetLibrary === true;
  const useCombinedAssetLibrary = true;
  const assetsEnabled = options.enableAssets !== false;

  const [projectKey, setProjectKey] = React.useState("folder");
  const [projectName, setProjectName] = React.useState("Folder");
  const [assetSearch, setAssetSearch] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [info, setInfo] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [versions, setVersions] = React.useState<NativeVersionItem[]>([]);

  const projectsQ = useQuery({
    queryKey: ["projects", mode],
    queryFn: fetchProjectList,
    staleTime: 20_000,
    refetchOnWindowFocus: false,
  });

  const assetsQ = useQuery({
    queryKey: ["pinsela-assets", mode, useCombinedAssetLibrary ? "combined" : (useLocalAssetLibrary ? "local-editor" : "default"), assetSearch],
    queryFn: () => (
      useCombinedAssetLibrary || useLocalAssetLibrary
        ? fetchLocalEditorAssetLibrary(assetSearch, String(assetSearch || "").trim() ? 84 : 36)
        : fetchPinselaAssets(assetSearch, String(assetSearch || "").trim() ? 72 : 24)
    ),
    staleTime: useCombinedAssetLibrary || useLocalAssetLibrary ? 90_000 : 30_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
    enabled: assetsEnabled && (!(useCombinedAssetLibrary || useLocalAssetLibrary) || (!authLoading && !!me)),
  });

  const configuredLocalRecoveryKey = String(import.meta.env.VITE_LOCAL_ACCOUNT_RECOVERY_KEY || "").trim().toLowerCase();
  const configuredLocalRecoveryFile = String(import.meta.env.VITE_LOCAL_ACCOUNT_RECOVERY_FILE || "").trim();

  const localSave = React.useCallback((key: string, doc: PinselaTemplateDocV1): boolean => {
    const targetKey = String(key || "draft").trim().toLowerCase() || "draft";
    const normalized = cloneDoc(normalizeTextDoc(doc));
    const storageKey = autosaveKey(targetKey);
    try {
      // v2 envelope carries a savedAt timestamp so the loader can resolve
      // local-vs-server by recency (last-write-wins) instead of guessing.
      localStorage.setItem(storageKey, JSON.stringify({ v: 2, savedAt: Date.now(), doc: normalized }));
      return true;
    } catch {
      // Write failed (most likely QuotaExceededError). Do NOT remove the existing
      // entry — the previous successful save is the user's last good local backup
      // and deleting it here would turn a transient quota error into data loss.
      // Leave the prior value intact and let the remote save path be the source of truth.
      // The caller is told (return false) so the UI can warn instead of failing silently.
      return false;
    }
  }, []);

  const localLoadMeta = React.useCallback((key: string): { doc: PinselaTemplateDocV1; savedAt: number } | null => {
    try {
      const targetKey = String(key || "draft").trim().toLowerCase() || "draft";
      const raw = localStorage.getItem(autosaveKey(targetKey));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      // v2 envelope { v, savedAt, doc } or legacy bare-doc (savedAt unknown => 0).
      if (parsed && typeof parsed === "object" && parsed.v === 2 && parsed.doc) {
        return { doc: normalizeTextDoc(parsed.doc), savedAt: Number(parsed.savedAt) || 0 };
      }
      return { doc: normalizeTextDoc(parsed), savedAt: 0 };
    } catch {
      return null;
    }
  }, []);

  const localLoad = React.useCallback((key: string): PinselaTemplateDocV1 | null => {
    return localLoadMeta(key)?.doc ?? null;
  }, [localLoadMeta]);

  const loadLocalMirror = React.useCallback(async (key: string): Promise<PinselaTemplateDocV1 | null> => {
    // no IndexedDB mirror; falls back straight to the localStorage autosave
    return localLoad(key);
  }, [localLoad]);

  const loadLocalRecovery = React.useCallback(async (key: string): Promise<PinselaTemplateDocV1 | null> => {
    const targetKey = String(key || "draft").trim().toLowerCase() || "draft";
    if (!import.meta.env.DEV) return null;
    if (!configuredLocalRecoveryFile) return null;
    if (configuredLocalRecoveryKey && targetKey !== configuredLocalRecoveryKey) return null;
    const recoveryPath = configuredLocalRecoveryFile.startsWith("/@fs/")
      ? configuredLocalRecoveryFile
      : `/@fs${configuredLocalRecoveryFile.startsWith("/") ? configuredLocalRecoveryFile : `/${configuredLocalRecoveryFile}`}`;
    try {
      const res = await fetch(encodeURI(recoveryPath), { credentials: "same-origin" });
      if (!res.ok) return null;
      const payload = await res.json() as Record<string, any>;
      const rawDoc = payload?.doc_json || payload?.doc || payload;
      if (!rawDoc || typeof rawDoc !== "object") return null;
      const normalized = cloneDoc(normalizeTextDoc(rawDoc as PinselaTemplateDocV1));
      localSave(targetKey, normalized);
      return normalized;
    } catch {
      return null;
    }
  }, [configuredLocalRecoveryFile, configuredLocalRecoveryKey, localSave]);

  const loadProject = React.useCallback(async (key: string): Promise<PinselaTemplateDocV1 | null> => {
    try {
      setBusy(true);
      setError(null);
      const res = await fetchNativeProjectByKey(key);
      const normalized = normalizeTextDoc(res.doc_json);
      localSave(key, normalized);
      return normalized;
    } catch (e: any) {
      setError(String(e?.message || e));
      return await loadLocalMirror(key);
    } finally {
      setBusy(false);
    }
  }, [loadLocalMirror, localSave]);

  const loadDraft = React.useCallback(async (key: string): Promise<PinselaTemplateDocV1 | null> => {
    try {
      setBusy(true);
      setError(null);
      const res = await fetchNativeProjectDraftByKey(key);
      const normalized = normalizeTextDoc(res.doc_json);
      localSave(key, normalized);
      return normalized;
    } catch (e: any) {
      setError(String(e?.message || e));
      return await loadLocalMirror(key);
    } finally {
      setBusy(false);
    }
  }, [loadLocalMirror, localSave]);

  const saveDraft = React.useCallback(async (
    key: string,
    doc: PinselaTemplateDocV1,
    previewPngB64?: string,
  ): Promise<{ localBackupOk: boolean }> => {
    const localBackupOk = localSave(key, doc);
    try {
      await saveNativeProjectDraftByKey(key, {
        doc_json: doc,
        source: "v2-editor",
        sync_current: autosaveSyncCurrent,
        ...(previewPngB64 ? { preview_png_b64: previewPngB64 } : {}),
      });
      return { localBackupOk };
    } catch (e: any) {
      setError(String(e?.message || e));
      throw e;
    }
  }, [autosaveSyncCurrent, localSave]);

  const loadVersions = React.useCallback(async (key: string): Promise<void> => {
    try {
      setBusy(true);
      setError(null);
      const res = await fetchNativeProjectVersionsByKey(key);
      setVersions(res.versions || []);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }, []);

  const restoreVersion = React.useCallback(async (key: string, versionId: string): Promise<boolean> => {
    try {
      setBusy(true);
      setError(null);
      const res = await restoreNativeProjectVersionByKey(key, versionId);
      setInfo("Version restored.");
      return res.ok;
    } catch (e: any) {
      setError(String(e?.message || e));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const publishProject = React.useCallback(async (key: string, doc: PinselaTemplateDocV1, projName: string): Promise<void> => {
    try {
      setBusy(true);
      setError(null);
      localSave(key, doc);
      await publishNativeProjectByKey(key, {
        project_name: projName,
        template_name: projName,
        doc_json: doc,
        preview_png_b64: "",
        source: "v2-editor",
      });
      setInfo("Project published successfully.");
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }, [localSave]);

  const renderBundle = React.useCallback(async (key: string, _doc: PinselaTemplateDocV1): Promise<string | null> => {
    try {
      setBusy(true);
      setError(null);
      const res = await runNativeRenderBundle({
        template_key: key,
        payload: {},
        kind: "bundle",
        save: true,
        scale: 1,
        area: "page",
        background_mode: "as-is",
      });
      return res.jpg_url || res.png_url || null;
    } catch (e: any) {
      setError(String(e?.message || e));
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const createBulkJobs = React.useCallback(async (key: string, csv: string): Promise<void> => {
    try {
      setBusy(true);
      setError(null);
      const rows = parseCsvPayloads(csv);
      await createArtworkJobsBulk({
        template_key: key,
        rows,
        output_kind: "jpg",
        render_local: false,
      });
      setInfo(`${rows.length} job(s) created.`);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }, []);

  const deleteProject = React.useCallback(async (projectId: string): Promise<boolean> => {
    try {
      setBusy(true);
      setError(null);
      await deleteProjectById(projectId);
      setInfo("Project deleted successfully.");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["projects"] }),
        qc.invalidateQueries({ queryKey: ["templates"] }),
      ]);
      return true;
    } catch (e: any) {
      setError(String(e?.message || e));
      return false;
    } finally {
      setBusy(false);
    }
  }, [qc]);

  const clearInfo = React.useCallback(() => setInfo(null), []);
  const clearError = React.useCallback(() => setError(null), []);
  const refreshAssets = React.useCallback(async () => {
    await qc.invalidateQueries({ queryKey: ["pinsela-assets", mode] });
    await assetsQ.refetch();
  }, [assetsQ, mode, qc]);

  const projects = React.useMemo(() => projectsQ.data || [], [projectsQ.data]);
  const projectsLoading = projectsQ.isLoading;
  const assets = React.useMemo(() => (assetsQ.data || []), [assetsQ.data]);
  const assetsLoading = assetsQ.isLoading;
  const supportsPublish = options.hidePublish !== true;
  const supportsVersions = options.hideVersions !== true;
  const supportsBulkJobs = true;
  const supportsAutomations = true;
  const supportsJobs = true;
  const supportsRemoteAssets = true;
  const homePath = "/projects";

  return React.useMemo(() => ({
    mode,
    supportsPublish,
    supportsVersions,
    supportsBulkJobs,
    supportsAutomations,
    supportsJobs,
    supportsRemoteAssets,
    homePath,

    projects,
    projectsLoading,
    assets,
    assetsLoading,
    versions,

    projectKey,
    projectName,
    assetSearch,
    busy,
    info,
    error,

    setProjectKey,
    setProjectName,
    setAssetSearch,
    refreshAssets,

    loadProject,
    loadDraft,
    saveDraft,
    loadVersions,
    restoreVersion,
    publishProject,
    renderBundle,
    createBulkJobs,
    deleteProject,
    localSave,
    localLoad,
    localLoadMeta,
    loadLocalMirror,
    loadLocalRecovery,

    templates: projects,
    templatesLoading: projectsLoading,
    templateKey: projectKey,
    templateName: projectName,
    setTemplateKey: setProjectKey,
    setTemplateName: setProjectName,
    loadTemplate: loadProject,
    publish: publishProject,
    deleteTemplate: deleteProject,

    clearInfo,
    clearError,
  }), [
    mode,
    supportsPublish,
    supportsVersions,
    supportsBulkJobs,
    supportsAutomations,
    supportsJobs,
    supportsRemoteAssets,
    homePath,
    projects,
    projectsLoading,
    assets,
    assetsLoading,
    versions,
    projectKey,
    projectName,
    assetSearch,
    busy,
    info,
    error,
    setProjectKey,
    setProjectName,
    setAssetSearch,
    refreshAssets,
    loadProject,
    loadDraft,
    saveDraft,
    loadVersions,
    restoreVersion,
    publishProject,
    renderBundle,
    createBulkJobs,
    deleteProject,
    localSave,
    localLoad,
    loadLocalMirror,
    loadLocalRecovery,
    clearInfo,
    clearError,
  ]);
}

export function useTemplateApi(): TemplateApiState {
  return useProjectApi();
}
