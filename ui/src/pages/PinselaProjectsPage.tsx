import React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  ArrowUpRight,
  Copy,
  FileImage,
  FolderOpen,
  FolderPlus,
  LayoutTemplate,
  LogOut,
  MoreHorizontal,
  PencilLine,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { apiUrl } from "../lib/api";
import { useAuth } from "../lib/auth";
import { ConfirmModal } from "../pinsela/ui/darkglass/modals/ConfirmModal";
import { BUILTIN_TEMPLATES, builtinTemplateFormat } from "../pinsela/templates/builtinTemplates";
import { createManagedProjectKey } from "../pinsela/projects/createProject";
import { PinselaLogo } from "../pinsela/ui/darkglass/PinselaLogo";
import { createEmptyDoc } from "../pinsela/core/scene";
import { useProjectApi } from "../pinsela/hooks/useTemplateApi";
import {
  getRemoteBackedLocalEditorPath,
} from "../pinsela/localAccount";
import {
  type ProjectListItem,
  fetchNativeProjectByKey,
  fetchNativeProjectDraftByKey,
  publishNativeProjectByKey,
  saveNativeProjectDraftByKey,
} from "../pinsela/platform/api/pinselaNativeApi";
import {
  DEFAULT_PROJECT_SHELF_STATE,
  assignProjectToFolder,
  createProjectFolder,
  deleteProjectFolder,
  loadProjectShelfState,
  renameProjectFolder,
  saveProjectShelfState,
  type ProjectFolderRecord,
  type ProjectShelfState,
} from "../pinsela/projects/projectShelfState";

type DialogState =
  | { kind: "create-project"; presetFolderId?: string | null }
  | { kind: "rename-project"; project: ProjectListItem }
  | { kind: "duplicate-project"; project: ProjectListItem; presetFolderId?: string | null }
  | { kind: "create-folder" }
  | { kind: "rename-folder"; folder: ProjectFolderRecord };

type ProjectCardView = ProjectListItem & {
  folderId: string | null;
  folder: ProjectFolderRecord | null;
  searchIndex: string;
};

type NoticeState = {
  tone: "info" | "error";
  message: string;
} | null;


function normalizeProjectName(raw: string, fallback: string): string {
  const normalized = String(raw || "").trim().replace(/\s+/g, " ").slice(0, 96);
  return normalized || fallback;
}

// Format presets for the "Create project" dialog (Canva's "what are you making?").
type FormatPreset = { id: string; label: string; width: number; height: number };
const FORMAT_PRESETS: FormatPreset[] = [
  { id: "post", label: "Post", width: 1080, height: 1080 },
  { id: "story", label: "Story / Reels", width: 1080, height: 1920 },
  { id: "portrait", label: "Portrait", width: 1080, height: 1350 },
  { id: "banner", label: "Banner", width: 1920, height: 1080 },
  { id: "a4", label: "A4", width: 1754, height: 2480 },
  { id: "custom", label: "Custom", width: 1080, height: 1080 },
];

// A new project starts as a clean blank white canvas (Canva-like) — no baked-in
// dev placeholder copy ("PINSELA PROJECT" / production jargon) for the user to delete.
function createStarterProjectDoc(_projectName: string, width = 1080, height = 1350) {
  const w = Math.max(100, Math.min(8192, Math.round(width) || 1080));
  const h = Math.max(100, Math.min(8192, Math.round(height) || 1350));
  const doc = createEmptyDoc(w, h);
  doc.canvas.background = "#ffffff";
  doc.canvas.width = w;
  doc.canvas.height = h;
  doc.nodes = doc.nodes.map((node) => (
    node.id === doc.root_id
      ? { ...node, style: { ...node.style, fill: "#ffffff" }, geometry: { ...node.geometry, width: w, height: h } }
      : node
  ));
  return doc;
}


function formatCount(value: number, singular: string, plural: string): string {
  return `${value} ${value === 1 ? singular : plural}`;
}

// Canvas size -> friendly format name (falls back to "W × H").
function projectFormatLabel(project: ProjectListItem): string {
  const w = Math.round(Number(project.canvas_width || 0));
  const h = Math.round(Number(project.canvas_height || 0));
  if (!w || !h) return "Freeform";
  const preset = FORMAT_PRESETS.find((f) => f.id !== "custom" && f.width === w && f.height === h);
  const dims = `${w} × ${h}`;
  return preset ? `${preset.label} · ${dims}` : dims;
}

// "edited 5 min ago" (server timestamps are naive UTC).
function editedAgoLabel(iso: string | null | undefined, now = Date.now()): string {
  const raw = String(iso || "").trim();
  if (!raw) return "";
  const t = Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw) ? raw : `${raw}Z`);
  if (!Number.isFinite(t)) return "";
  const minutes = Math.max(0, Math.floor((now - t) / 60_000));
  if (minutes < 1) return "edited just now";
  if (minutes < 60) return `edited ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `edited ${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `edited ${days} ${days === 1 ? "day" : "days"} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `edited ${months} ${months === 1 ? "month" : "months"} ago`;
  const years = Math.floor(days / 365);
  return `edited ${years} ${years === 1 ? "year" : "years"} ago`;
}

function folderAccentColor(folder: ProjectFolderRecord | null): string {
  // Harmonized with the brand palette (neutral default + muted neighbors).
  if (folder?.accent === "olive") return "#a8c97e";
  if (folder?.accent === "ink") return "#64748b";
  if (folder?.accent === "rose") return "#d9a08f";
  return "#737373";
}

function projectKindLabel(project: ProjectCardView): string {
  if (project.engine_type === "pinsela_native_v1") return "Pinsela project";
  return "Project";
}

function stopCardEvent(event: React.SyntheticEvent, action: () => void) {
  event.preventDefault();
  event.stopPropagation();
  action();
}

function ActionButton(props: {
  label: string;
  icon: React.ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  disabled?: boolean;
  onClick: () => void;
  title?: string;
}) {
  const { label, icon, variant = "secondary", disabled = false, onClick, title } = props;
  return (
    <button type="button" className={`ec-btn ec-btn--${variant}`} title={title || label} onClick={onClick} disabled={disabled}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

function ProjectDialog(props: {
  title: string;
  description: string;
  nameLabel: string;
  nameValue: string;
  onNameChange: (value: string) => void;
  folderValue?: string;
  onFolderChange?: (value: string) => void;
  folderOptions?: ProjectFolderRecord[];
  includeFolder?: boolean;
  showFormatPicker?: boolean;
  templateId?: string;
  onTemplateId?: (id: string) => void;
  formatId?: string;
  onFormatId?: (id: string) => void;
  customW?: number;
  onCustomW?: (n: number) => void;
  customH?: number;
  onCustomH?: (n: number) => void;
  submitLabel: string;
  busy: boolean;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const {
    title,
    description,
    nameLabel,
    nameValue,
    onNameChange,
    folderValue = "",
    onFolderChange,
    folderOptions = [],
    includeFolder = false,
    showFormatPicker = false,
    templateId = "",
    onTemplateId,
    formatId = "post",
    onFormatId,
    customW = 1080,
    onCustomW,
    customH = 1080,
    onCustomH,
    submitLabel,
    busy,
    onClose,
    onSubmit,
  } = props;

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div role="presentation" className="ec-dialog-backdrop" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className="ec-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="ec-dialog-head">
          <div>
            <h2>{title}</h2>
            <p>{description}</p>
          </div>
          <button type="button" className="ec-icon-btn" onClick={onClose} aria-label="Close" title="Close">
            <X size={16} />
          </button>
        </div>

        <label className="ec-field">
          <span className="ec-field-label">{nameLabel}</span>
          <input
            autoFocus
            type="text"
            className="ec-input"
            value={nameValue}
            onChange={(event) => onNameChange(event.target.value)}
            placeholder={nameLabel}
            maxLength={96}
            onKeyDown={(event) => { if (event.key === "Enter" && !busy) onSubmit(); }}
          />
        </label>

        {showFormatPicker ? (
          <label className="ec-field">
            <span className="ec-field-label">Start from a template</span>
            <select
              className="ec-input"
              value={templateId}
              onChange={(event) => onTemplateId?.(event.target.value)}
              aria-label="Start from a template"
            >
              <option value="">Blank</option>
              {BUILTIN_TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>{t.name} ({builtinTemplateFormat(t)})</option>
              ))}
            </select>
          </label>
        ) : null}

        {showFormatPicker && !templateId ? (
          <div className="ec-field">
            <span className="ec-field-label">Format</span>
            <div className="ec-seg" role="group" aria-label="Format">
              {FORMAT_PRESETS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className="ec-seg-btn"
                  aria-pressed={formatId === f.id}
                  onClick={() => onFormatId?.(f.id)}
                >
                  {f.label}
                  <small>{f.id === "custom" ? "Set a custom size" : `${f.width} × ${f.height}`}</small>
                </button>
              ))}
            </div>
            {formatId === "custom" ? (
              <div className="ec-dim-row">
                <input type="number" className="ec-input" min={100} max={8192} value={customW}
                  onChange={(e) => onCustomW?.(Number(e.target.value) || 0)}
                  placeholder="Width" aria-label="Width in pixels" />
                <span>×</span>
                <input type="number" className="ec-input" min={100} max={8192} value={customH}
                  onChange={(e) => onCustomH?.(Number(e.target.value) || 0)}
                  placeholder="Height" aria-label="Height in pixels" />
              </div>
            ) : null}
          </div>
        ) : null}

        {includeFolder ? (
          <label className="ec-field">
            <span className="ec-field-label">Folder</span>
            <select className="ec-input" value={folderValue} onChange={(event) => onFolderChange?.(event.target.value)}>
              <option value="">No folder</option>
              {folderOptions.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <div className="ec-dialog-foot">
          <ActionButton label={busy ? "Saving..." : submitLabel} icon={null} variant="primary" onClick={onSubmit} disabled={busy} />
        </div>
      </div>
    </div>
  );
}

function ProjectCard(props: {
  project: ProjectCardView;
  disabled: boolean;
  folderOptions: ProjectFolderRecord[];
  onOpen: (project: ProjectCardView) => void;
  onRename: (project: ProjectCardView) => void;
  onDuplicate: (project: ProjectCardView) => void;
  onDelete: (project: ProjectCardView) => void;
  onMove: (project: ProjectCardView, folderId: string) => void;
}) {
  const { project, disabled, folderOptions, onOpen, onRename, onDuplicate, onDelete, onMove } = props;
  const accent = folderAccentColor(project.folder);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [moveOpen, setMoveOpen] = React.useState(false);
  const [thumbFailed, setThumbFailed] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!menuOpen) return;
    const close = (event: PointerEvent) => {
      if (menuRef.current && event.target instanceof Node && menuRef.current.contains(event.target)) return;
      setMenuOpen(false);
      setMoveOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [menuOpen]);

  const runAndClose = (event: React.SyntheticEvent, action: () => void) => {
    setMenuOpen(false);
    setMoveOpen(false);
    stopCardEvent(event, action);
  };

  return (
    <article
      className="ec-project-card"
      style={menuOpen ? { zIndex: 5 } : undefined}
      role="button"
      tabIndex={0}
      onClick={() => onOpen(project)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(project);
        }
      }}
    >
      <div className="ec-project-thumb">
        {!thumbFailed ? (
          <img
            src={apiUrl(`/api/templates/${encodeURIComponent(project.key)}/native/preview`)}
            alt=""
            loading="lazy"
            draggable={false}
            onError={() => setThumbFailed(true)}
          />
        ) : (
          <div className="ec-project-thumb-fallback">
            <FileImage size={30} />
            <span className="ec-project-thumb-label">{projectFormatLabel(project)}</span>
          </div>
        )}
      </div>

      <div className="ec-project-meta">
        <div className="ec-project-text">
          <div className="ec-project-name">{project.name || project.key}</div>
          <div className="ec-project-sub">
            {[projectFormatLabel(project), editedAgoLabel(project.updated_at)].filter(Boolean).join(" · ")}
          </div>
        </div>
        <div ref={menuRef} className="ec-project-menu-wrap" onClick={(event) => event.stopPropagation()}>
          <button
            type="button"
            className="ec-kebab"
            data-open={menuOpen ? "true" : "false"}
            aria-label={`Actions for ${project.name || project.key}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            disabled={disabled}
            onClick={(event) => stopCardEvent(event, () => { setMenuOpen((v) => !v); setMoveOpen(false); })}
          >
            <MoreHorizontal size={17} />
          </button>
          {menuOpen ? (
            <div className="ec-card-menu" role="menu">
              <button type="button" role="menuitem" onClick={(event) => runAndClose(event, () => onOpen(project))}>
                <ArrowUpRight size={14} /> Open in editor
              </button>
              <button type="button" role="menuitem" onClick={(event) => runAndClose(event, () => onRename(project))}>
                <PencilLine size={14} /> Rename
              </button>
              <button type="button" role="menuitem" onClick={(event) => runAndClose(event, () => onDuplicate(project))}>
                <Copy size={14} /> Duplicate
              </button>
              <div className="sep" />
              <button
                type="button"
                role="menuitem"
                aria-expanded={moveOpen}
                onClick={(event) => stopCardEvent(event, () => setMoveOpen((v) => !v))}
              >
                <FolderOpen size={14} /> Move to folder…
              </button>
              {moveOpen ? (
                <>
                  <div className="menu-title">Folders</div>
                  <button type="button" role="menuitem" onClick={(event) => runAndClose(event, () => onMove(project, ""))}>
                    No folder {!project.folderId ? "✓" : ""}
                  </button>
                  {folderOptions.map((folder) => (
                    <button
                      key={folder.id}
                      type="button"
                      role="menuitem"
                      onClick={(event) => runAndClose(event, () => onMove(project, folder.id))}
                    >
                      {folder.name} {project.folderId === folder.id ? "✓" : ""}
                    </button>
                  ))}
                </>
              ) : null}
              <div className="sep" />
              <button type="button" role="menuitem" className="danger" onClick={(event) => runAndClose(event, () => onDelete(project))}>
                <Trash2 size={14} /> Delete
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="ec-project-footer">
        {project.folder ? (
          <span className="ec-folder-chip">
            <span className="dot" style={{ background: accent }} />
            {project.folder.name}
          </span>
        ) : null}
      </div>
    </article>
  );
}

export function PinselaProjectsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { me, logout } = useAuth();
  const {
    projects,
    projectsLoading,
    busy,
    info,
    error,
    deleteProject,
    clearInfo,
    clearError,
  } = useProjectApi({ enableAssets: false });
  const [, startTransition] = React.useTransition();
  const [search, setSearch] = React.useState("");
  const [activeFolderId, setActiveFolderId] = React.useState<string>("all");
  const [shelfState, setShelfState] = React.useState<ProjectShelfState>(DEFAULT_PROJECT_SHELF_STATE);
  const [dialog, setDialog] = React.useState<DialogState | null>(null);
  const [dialogName, setDialogName] = React.useState("");
  const [dialogFolderId, setDialogFolderId] = React.useState("");
  const [dialogFormatId, setDialogFormatId] = React.useState<string>("post");
  const [dialogTemplateId, setDialogTemplateId] = React.useState<string>("");
  const [dialogCustomW, setDialogCustomW] = React.useState<number>(1080);
  const [dialogCustomH, setDialogCustomH] = React.useState<number>(1080);
  const [dialogBusy, setDialogBusy] = React.useState(false);
  const [pageNotice, setPageNotice] = React.useState<NoticeState>(null);
  const [deletingProjectId, setDeletingProjectId] = React.useState<string | null>(null);
  const effectiveSearch = React.useDeferredValue(search);

  const username = me?.username || "local";
  const projectKeys = React.useMemo(
    () => projects.map((project) => String(project.key || "").trim().toLowerCase()).filter(Boolean),
    [projects],
  );
  const projectFingerprint = React.useMemo(
    () => [...projectKeys].sort().join("|"),
    [projectKeys],
  );
  React.useEffect(() => {
    startTransition(() => {
      setShelfState(loadProjectShelfState(username, projectKeys));
    });
  }, [projectFingerprint, projectKeys, startTransition, username]);

  React.useEffect(() => {
    if (activeFolderId === "all" || activeFolderId === "unfiled") return;
    if (shelfState.folders.some((folder) => folder.id === activeFolderId)) return;
    setActiveFolderId("all");
  }, [activeFolderId, shelfState.folders]);

  const updateShelfState = React.useCallback((updater: (current: ProjectShelfState) => ProjectShelfState) => {
    setShelfState((current) => {
      const next = updater(current);
      saveProjectShelfState(username, next);
      return next;
    });
  }, [username]);

  const refreshProjects = React.useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["projects"] });
  }, [queryClient]);

  const projectsView = React.useMemo<ProjectCardView[]>(() => {
    const folderById = new Map(shelfState.folders.map((folder) => [folder.id, folder]));
    return [...projects]
      .map((project) => {
        const normalizedKey = String(project.key || "").trim().toLowerCase();
        const folderId = shelfState.projectFolderByKey[normalizedKey] || null;
        const folder = folderId ? (folderById.get(folderId) || null) : null;
        return {
          ...project,
          folderId,
          folder,
          searchIndex: [
            project.name,
            project.key,
            folder?.name,
          ].join(" ").toLowerCase(),
        };
      })
      .sort((left, right) => {
        // Most recent (added/modified) first. Uses updated_at and falls back to
        // created_at; when a timestamp is missing or tied, falls back to alphabetical order.
        const ts = (p: ProjectCardView) =>
          Date.parse(String(p.updated_at || p.created_at || "")) || 0;
        const diff = ts(right) - ts(left);
        if (diff !== 0) return diff;
        return String(left.name || left.key).localeCompare(String(right.name || right.key), "en-US", { sensitivity: "base" });
      });
  }, [projects, shelfState.folders, shelfState.projectFolderByKey]);

  const filteredProjects = React.useMemo(() => {
    const query = String(effectiveSearch || "").trim().toLowerCase();
    return projectsView.filter((project) => {
      const matchesFolder = activeFolderId === "all"
        ? true
        : activeFolderId === "unfiled"
          ? !project.folderId
          : project.folderId === activeFolderId;
      if (!matchesFolder) return false;
      if (!query) return true;
      return project.searchIndex.includes(query);
    });
  }, [activeFolderId, effectiveSearch, projectsView]);

  const folderCounts = React.useMemo(() => {
    const counts: Record<string, number> = {};
    projectsView.forEach((project) => {
      const key = project.folderId || "unfiled";
      counts[key] = (counts[key] || 0) + 1;
    });
    return counts;
  }, [projectsView]);

  const visibleCount = filteredProjects.length;
  const isWorking = busy || dialogBusy;
  const visibleError = pageNotice?.tone === "error" ? pageNotice.message : error;
  const visibleInfo = pageNotice?.tone === "info" ? pageNotice.message : info;
  const currentFolder = activeFolderId === "all"
    ? null
    : activeFolderId === "unfiled"
      ? { name: "No folder" }
      : shelfState.folders.find((folder) => folder.id === activeFolderId) || null;

  const handleLogout = React.useCallback(async () => {
    await logout();
    navigate("/login");
  }, [logout, navigate]);

  const openDialog = React.useCallback((nextDialog: DialogState) => {
    clearInfo();
    clearError();
    setPageNotice(null);
    setDialog(nextDialog);
    if (nextDialog.kind === "create-project") {
      setDialogTemplateId("");
      setDialogName("");
      setDialogFolderId(nextDialog.presetFolderId || "");
      return;
    }
    if (nextDialog.kind === "rename-project") {
      setDialogName(nextDialog.project.name || nextDialog.project.key);
      setDialogFolderId("");
      return;
    }
    if (nextDialog.kind === "duplicate-project") {
      setDialogName(`${nextDialog.project.name || nextDialog.project.key} (copy)`);
      setDialogFolderId(nextDialog.presetFolderId || "");
      return;
    }
    if (nextDialog.kind === "create-folder") {
      setDialogName("");
      setDialogFolderId("");
      return;
    }
    if (nextDialog.kind === "rename-folder") {
      setDialogName(nextDialog.folder.name);
      setDialogFolderId("");
    }
  }, [clearError, clearInfo]);

  const closeDialog = React.useCallback(() => {
    if (dialogBusy) return;
    setDialog(null);
  }, [dialogBusy]);

  const loadProjectDocForMutation = React.useCallback(async (projectKey: string) => {
    try {
      const draft = await fetchNativeProjectDraftByKey(projectKey);
      return draft.doc_json;
    } catch {
      const published = await fetchNativeProjectByKey(projectKey);
      return published.doc_json;
    }
  }, []);

  const handleSubmitDialog = React.useCallback(async () => {
    if (!dialog) return;
    setDialogBusy(true);
    setPageNotice(null);
    clearInfo();
    clearError();
    try {
      if (dialog.kind === "create-folder") {
        updateShelfState((current) => createProjectFolder(current, dialogName));
        setPageNotice({ tone: "info", message: "Folder created." });
        closeDialog();
        return;
      }

      if (dialog.kind === "rename-folder") {
        updateShelfState((current) => renameProjectFolder(current, dialog.folder.id, dialogName));
        setPageNotice({ tone: "info", message: "Folder renamed." });
        closeDialog();
        return;
      }

      if (dialog.kind === "create-project") {
        const projectName = normalizeProjectName(dialogName, "New project");
        const projectKey = createManagedProjectKey();
        const preset = FORMAT_PRESETS.find((f) => f.id === dialogFormatId) || FORMAT_PRESETS[0];
        const dims = dialogFormatId === "custom"
          ? { width: dialogCustomW, height: dialogCustomH }
          : { width: preset.width, height: preset.height };
        const builtin = BUILTIN_TEMPLATES.find((t) => t.id === dialogTemplateId);
        const starterDoc = builtin
          ? (JSON.parse(JSON.stringify(builtin.doc_json)) as ReturnType<typeof createStarterProjectDoc>)
          : createStarterProjectDoc(projectName, dims.width, dims.height);
        await publishNativeProjectByKey(projectKey, {
          project_name: projectName,
          doc_json: starterDoc,
          preview_png_b64: "",
          source: "projects:create",
        });
        await saveNativeProjectDraftByKey(projectKey, {
          doc_json: starterDoc,
          source: "projects:create",
        });
        updateShelfState((current) => assignProjectToFolder(current, projectKey, dialogFolderId || null));
        await refreshProjects();
        closeDialog();
        navigate(getRemoteBackedLocalEditorPath(projectKey));
        return;
      }

      if (dialog.kind === "rename-project") {
        const nextName = normalizeProjectName(dialogName, dialog.project.name || dialog.project.key);
        const doc = await loadProjectDocForMutation(dialog.project.key);
        await publishNativeProjectByKey(dialog.project.key, {
          project_name: nextName,
          doc_json: doc,
          preview_png_b64: "",
          source: "projects:rename",
        });
        await saveNativeProjectDraftByKey(dialog.project.key, {
          doc_json: doc,
          source: "projects:rename",
        });
        await refreshProjects();
        setPageNotice({ tone: "info", message: "Project renamed." });
        closeDialog();
        return;
      }

      if (dialog.kind === "duplicate-project") {
        const duplicateKey = createManagedProjectKey();
        const duplicateName = normalizeProjectName(dialogName, `${dialog.project.name || dialog.project.key} (copy)`);
        const doc = await loadProjectDocForMutation(dialog.project.key);
        await publishNativeProjectByKey(duplicateKey, {
          project_name: duplicateName,
          doc_json: doc,
          preview_png_b64: "",
          source: `projects:duplicate:${dialog.project.key}`,
        });
        await saveNativeProjectDraftByKey(duplicateKey, {
          doc_json: doc,
          source: `projects:duplicate:${dialog.project.key}`,
        });
        updateShelfState((current) => assignProjectToFolder(current, duplicateKey, dialogFolderId || null));
        await refreshProjects();
        closeDialog();
        navigate(getRemoteBackedLocalEditorPath(duplicateKey));
      }
    } catch (e: any) {
      setPageNotice({ tone: "error", message: String(e?.message || e || "Failed to save.") });
    } finally {
      setDialogBusy(false);
    }
  }, [
    clearError,
    clearInfo,
    closeDialog,
    dialog,
    dialogFolderId,
    dialogName,
    dialogFormatId,
    dialogTemplateId,
    dialogCustomW,
    dialogCustomH,
    loadProjectDocForMutation,
    navigate,
    refreshProjects,
    updateShelfState,
  ]);

  const [confirmState, setConfirmState] = React.useState<
    | { kind: "delete-project"; project: ProjectCardView }
    | { kind: "delete-folder"; folder: ProjectFolderRecord }
    | null
  >(null);

  const handleDeleteProject = React.useCallback((project: ProjectCardView) => {
    setConfirmState({ kind: "delete-project", project });
  }, []);

  const runDeleteProject = React.useCallback(async (project: ProjectCardView) => {
    clearInfo();
    clearError();
    setPageNotice(null);
    setDeletingProjectId(project.id);
    try {
      await deleteProject(project.id);
      updateShelfState((current) => assignProjectToFolder(current, project.key, null));
      await refreshProjects();
    } finally {
      setDeletingProjectId(null);
    }
  }, [clearError, clearInfo, deleteProject, refreshProjects, updateShelfState]);

  const handleDeleteFolder = React.useCallback((folder: ProjectFolderRecord) => {
    setConfirmState({ kind: "delete-folder", folder });
  }, []);

  const runDeleteFolder = React.useCallback((folder: ProjectFolderRecord) => {
    updateShelfState((current) => deleteProjectFolder(current, folder.id));
    if (activeFolderId === folder.id) setActiveFolderId("all");
    setPageNotice({ tone: "info", message: "Folder deleted." });
  }, [activeFolderId, folderCounts, updateShelfState]);

  const handleMoveProject = React.useCallback((project: ProjectCardView, folderId: string) => {
    updateShelfState((current) => assignProjectToFolder(current, project.key, folderId || null));
    setPageNotice({ tone: "info", message: "Project moved." });
  }, [updateShelfState]);

  const handleOpenProject = React.useCallback((project: ProjectCardView) => {
    clearInfo();
    clearError();
    setPageNotice(null);
    navigate(getRemoteBackedLocalEditorPath(project.key));
  }, [clearError, clearInfo, navigate]);

  const toolbarDescription = currentFolder
    ? `${formatCount(visibleCount, "project", "projects")} in ${currentFolder.name}`
    : formatCount(visibleCount, "project", "projects");

  const dialogTitle = dialog?.kind === "create-project"
    ? "Create project"
    : dialog?.kind === "rename-project"
      ? "Rename project"
      : dialog?.kind === "duplicate-project"
        ? "Duplicate project"
        : dialog?.kind === "create-folder"
          ? "New folder"
          : dialog?.kind === "rename-folder"
            ? "Rename folder"
            : "";

  const dialogDescription = dialog?.kind === "create-project"
    ? "Creates a new project, saved automatically, and opens the editor."
    : dialog?.kind === "rename-project"
      ? "Updates the project display name without changing its key."
      : dialog?.kind === "duplicate-project"
        ? "Creates a full copy of the current project."
        : dialog?.kind === "create-folder"
          ? "Use folders to organize clients, campaigns, or experiments."
          : dialog?.kind === "rename-folder"
            ? "Only the name changes. Projects stay in the same folder."
            : "";

  const dialogSubmitLabel = dialog?.kind === "create-project"
    ? "Create and open"
    : dialog?.kind === "rename-project"
      ? "Save name"
      : dialog?.kind === "duplicate-project"
        ? "Duplicate and open"
        : dialog?.kind === "create-folder"
          ? "Create folder"
          : dialog?.kind === "rename-folder"
            ? "Save folder"
            : "Save";

  const dialogNeedsFolder = dialog?.kind === "create-project" || dialog?.kind === "duplicate-project";
  const dialogNameLabel = dialog?.kind === "create-folder" || dialog?.kind === "rename-folder" ? "Folder name" : "Name";

  const folderItems = [
    { id: "all", name: "All", count: projectsView.length, accent: "var(--ec-accent)", folder: null as ProjectFolderRecord | null },
    ...shelfState.folders.map((folder) => ({
      id: folder.id,
      name: folder.name,
      count: folderCounts[folder.id] || 0,
      accent: folderAccentColor(folder),
      folder: folder as ProjectFolderRecord | null,
    })),
    { id: "unfiled", name: "No folder", count: folderCounts.unfiled || 0, accent: "var(--ec-text-faint)", folder: null as ProjectFolderRecord | null },
  ];

  return (
    <div className="ec-projects-page">
      <header className="ec-projects-header">
        <a
          href="/projects"
          className="ec-projects-logo"
          aria-label="Projects"
          onClick={(event) => { event.preventDefault(); navigate("/projects"); }}
        >
          <PinselaLogo size={26} />
        </a>

        <div className="ec-projects-user">
          <div className="ec-user-chip">
            <div className="ec-user-avatar">{me?.username?.charAt(0).toUpperCase() || "U"}</div>
            <span>{me?.username || "User"}</span>
          </div>
          <button type="button" className="ec-link-btn" onClick={() => void handleLogout()}>
            <LogOut size={16} />
            <span>Sign out</span>
          </button>
        </div>
      </header>

      <main className="ec-projects-main">
        <div className="ec-projects-inner">
          <div className="ec-projects-hero">
            <div>
              <div className="ec-kicker">My projects</div>
              <h1 className="ec-projects-title">Your projects</h1>
              <p className="ec-projects-sub">Organize into folders, duplicate, and open any project straight in the editor.</p>
            </div>
            <ActionButton
              label="Create project"
              icon={<Plus size={18} />}
              variant="primary"
              onClick={() => openDialog({ kind: "create-project", presetFolderId: activeFolderId !== "all" && activeFolderId !== "unfiled" ? activeFolderId : null })}
            />
          </div>

          {visibleError ? <div className="ec-notice ec-notice--error" role="alert">{visibleError}</div> : null}
          {visibleInfo ? <div className="ec-notice ec-notice--info" role="status">{visibleInfo}</div> : null}

          <div className="ec-projects-layout">
            <aside className="ec-folders">
              <div className="ec-folders-card">
                <div className="ec-folders-head">
                  <strong>Folders</strong>
                  <button type="button" className="ec-link-btn" onClick={() => openDialog({ kind: "create-folder" })}>
                    <FolderPlus size={15} />
                    New folder
                  </button>
                </div>

                <div className="ec-folder-list">
                  {folderItems.map((item) => (
                    <div key={item.id} className={`ec-folder-row${activeFolderId === item.id ? " is-active" : ""}`}>
                      <button type="button" className="ec-folder-btn" onClick={() => setActiveFolderId(item.id)}>
                        <span className="ec-folder-name">
                          <span className="ec-folder-dot" style={{ background: item.accent }} />
                          <span>{item.name}</span>
                        </span>
                        <span className="ec-folder-count">{item.count}</span>
                      </button>
                      {item.folder ? (
                        <>
                          <button
                            type="button"
                            className="ec-icon-btn"
                            aria-label={`Rename folder ${item.folder.name}`}
                            title="Rename folder"
                            onClick={() => openDialog({ kind: "rename-folder", folder: item.folder as ProjectFolderRecord })}
                          >
                            <PencilLine size={14} />
                          </button>
                          <button
                            type="button"
                            className="ec-icon-btn ec-icon-btn--danger"
                            aria-label={`Delete folder ${item.folder.name}`}
                            title="Delete folder"
                            onClick={() => handleDeleteFolder(item.folder as ProjectFolderRecord)}
                          >
                            <Trash2 size={14} />
                          </button>
                        </>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            </aside>

            <section className="ec-projects-section">
              <div className="ec-projects-toolbar">
                <label className="ec-search">
                  <Search size={16} />
                  <input
                    type="search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search by name or folder"
                    aria-label="Search projects"
                  />
                </label>
                <div className="ec-projects-count">{toolbarDescription}</div>
              </div>

              {projectsLoading ? (
                <div className="ec-projects-loading">Loading projects...</div>
              ) : filteredProjects.length === 0 ? (
                <div className="ec-empty">
                  <div className="ec-empty-icon"><LayoutTemplate size={44} /></div>
                  <h3>{projects.length === 0 ? "Create your first design" : "No results found"}</h3>
                  <p>
                    {projects.length === 0
                      ? "Start with a blank page or pick a template. Everything is saved automatically."
                      : "Try another search term, switch folders, or clear the search."}
                  </p>
                  {projects.length === 0 ? (
                    <div className="ec-empty-actions">
                      <ActionButton
                        label="Blank project"
                        icon={<Plus size={16} />}
                        variant="primary"
                        onClick={() => openDialog({ kind: "create-project" })}
                      />
                      <ActionButton
                        label="Start from a template"
                        icon={<LayoutTemplate size={16} />}
                        onClick={() => {
                          openDialog({ kind: "create-project" });
                          const first = BUILTIN_TEMPLATES[0];
                          if (first) {
                            setDialogTemplateId(first.id);
                            setDialogName(first.name);
                          }
                        }}
                      />
                    </div>
                  ) : (
                    <ActionButton
                      label="Clear filters"
                      icon={<FolderOpen size={16} />}
                      onClick={() => {
                        setSearch("");
                        setActiveFolderId("all");
                      }}
                    />
                  )}
                </div>
              ) : (
                <div className="ec-projects-grid">
                  {filteredProjects.map((project) => (
                    <ProjectCard
                      key={project.key}
                      project={project}
                      folderOptions={shelfState.folders}
                      disabled={isWorking || deletingProjectId === project.id}
                      onOpen={handleOpenProject}
                      onRename={(item) => openDialog({ kind: "rename-project", project: item })}
                      onDuplicate={(item) => openDialog({ kind: "duplicate-project", project: item, presetFolderId: item.folderId })}
                      onDelete={handleDeleteProject}
                      onMove={handleMoveProject}
                    />
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      </main>

      {confirmState?.kind === "delete-project" ? (
        <ConfirmModal
          title="Delete project"
          message={`Delete "${confirmState.project.name || confirmState.project.key}"? This can't be undone.`}
          confirmLabel="Delete"
          danger
          onClose={() => setConfirmState(null)}
          onConfirm={() => {
            const target = confirmState.project;
            setConfirmState(null);
            void runDeleteProject(target).catch((e: any) => {
              setPageNotice({ tone: "error", message: String(e?.message || e || "Failed to delete.") });
            });
          }}
        />
      ) : null}

      {confirmState?.kind === "delete-folder" ? (
        <ConfirmModal
          title="Delete folder"
          message={
            (folderCounts[confirmState.folder.id] || 0) > 0
              ? `Delete the folder "${confirmState.folder.name}"? ${formatCount(folderCounts[confirmState.folder.id] || 0, "project", "projects")} will be moved out of the folder.`
              : `Delete the folder "${confirmState.folder.name}"?`
          }
          confirmLabel="Delete"
          danger
          onClose={() => setConfirmState(null)}
          onConfirm={() => {
            const target = confirmState.folder;
            setConfirmState(null);
            runDeleteFolder(target);
          }}
        />
      ) : null}

      {dialog ? (
        <ProjectDialog
          title={dialogTitle}
          description={dialogDescription}
          nameLabel={dialogNameLabel}
          nameValue={dialogName}
          onNameChange={setDialogName}
          folderValue={dialogFolderId}
          onFolderChange={setDialogFolderId}
          folderOptions={shelfState.folders}
          includeFolder={dialogNeedsFolder}
          showFormatPicker={dialog.kind === "create-project"}
          templateId={dialogTemplateId}
          onTemplateId={(id) => {
            setDialogTemplateId(id);
            const t = BUILTIN_TEMPLATES.find((x) => x.id === id);
            if (t && !dialogName.trim()) setDialogName(t.name);
          }}
          formatId={dialogFormatId}
          onFormatId={setDialogFormatId}
          customW={dialogCustomW}
          onCustomW={setDialogCustomW}
          customH={dialogCustomH}
          onCustomH={setDialogCustomH}
          submitLabel={dialogSubmitLabel}
          busy={dialogBusy}
          onClose={closeDialog}
          onSubmit={() => void handleSubmitDialog()}
        />
      ) : null}

    </div>
  );
}
