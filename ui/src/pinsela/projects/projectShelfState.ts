export type ProjectShelfAccent = "bronze" | "olive" | "ink" | "rose";

export type ProjectFolderRecord = {
  id: string;
  name: string;
  accent: ProjectShelfAccent;
  createdAt: string;
  updatedAt: string;
};

export type ProjectShelfState = {
  version: 1;
  folders: ProjectFolderRecord[];
  projectFolderByKey: Record<string, string>;
};

const STORAGE_VERSION = 1;
const STORAGE_PREFIX = "pinsela:projects:shelves";
const ACCENT_ROTATION: ProjectShelfAccent[] = ["bronze", "olive", "ink", "rose"];

export const DEFAULT_PROJECT_SHELF_STATE: ProjectShelfState = {
  version: STORAGE_VERSION,
  folders: [],
  projectFolderByKey: {},
};

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeUsername(username?: string | null): string {
  const normalized = String(username || "").trim().toLowerCase();
  return normalized || "anonymous";
}

function storageKey(username?: string | null): string {
  return `${STORAGE_PREFIX}:${normalizeUsername(username)}`;
}

function normalizeFolderName(name: string): string {
  return String(name || "").trim().replace(/\s+/g, " ").slice(0, 64);
}

function normalizeState(raw: unknown, projectKeys: string[]): ProjectShelfState {
  const keys = new Set(projectKeys.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean));
  const base = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const folders = Array.isArray(base.folders) ? base.folders : [];
  const projectFolderByKey = base.projectFolderByKey && typeof base.projectFolderByKey === "object"
    ? (base.projectFolderByKey as Record<string, unknown>)
    : {};

  const normalizedFolders: ProjectFolderRecord[] = folders
    .map((folder, index) => {
      const item = folder && typeof folder === "object" ? (folder as Record<string, unknown>) : {};
      const id = String(item.id || "").trim().toLowerCase();
      const name = normalizeFolderName(String(item.name || ""));
      if (!id || !name) return null;
      const accent = ACCENT_ROTATION.includes(item.accent as ProjectShelfAccent)
        ? (item.accent as ProjectShelfAccent)
        : ACCENT_ROTATION[index % ACCENT_ROTATION.length];
      const createdAt = String(item.createdAt || "").trim() || nowIso();
      const updatedAt = String(item.updatedAt || "").trim() || createdAt;
      return { id, name, accent, createdAt, updatedAt };
    })
    .filter((item): item is ProjectFolderRecord => !!item);

  const folderIds = new Set(normalizedFolders.map((folder) => folder.id));
  const normalizedAssignments = Object.fromEntries(
    Object.entries(projectFolderByKey)
      .map(([key, folderId]) => [String(key || "").trim().toLowerCase(), String(folderId || "").trim().toLowerCase()])
      .filter(([key, folderId]) => Boolean(key) && keys.has(key) && folderIds.has(folderId)),
  );

  return {
    version: STORAGE_VERSION,
    folders: normalizedFolders,
    projectFolderByKey: normalizedAssignments,
  };
}

export function loadProjectShelfState(username: string | null | undefined, projectKeys: string[]): ProjectShelfState {
  if (typeof window === "undefined") return DEFAULT_PROJECT_SHELF_STATE;
  try {
    const raw = localStorage.getItem(storageKey(username));
    if (!raw) return normalizeState(null, projectKeys);
    return normalizeState(JSON.parse(raw), projectKeys);
  } catch {
    return normalizeState(null, projectKeys);
  }
}

export function saveProjectShelfState(username: string | null | undefined, state: ProjectShelfState): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(storageKey(username), JSON.stringify(state));
  } catch {
    // Ignore persistence failures and keep the in-memory state responsive.
  }
}

export function createProjectFolder(state: ProjectShelfState, name: string): ProjectShelfState {
  const normalizedName = normalizeFolderName(name);
  if (!normalizedName) throw new Error("Enter a name for the folder.");
  const slugBase = normalizedName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "folder";
  const existingIds = new Set(state.folders.map((folder) => folder.id));
  let suffix = 1;
  let id = `folder-${slugBase}`;
  while (existingIds.has(id)) {
    suffix += 1;
    id = `folder-${slugBase}-${suffix}`;
  }
  const timestamp = nowIso();
  return {
    ...state,
    folders: [
      ...state.folders,
      {
        id,
        name: normalizedName,
        accent: ACCENT_ROTATION[state.folders.length % ACCENT_ROTATION.length],
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
  };
}

export function renameProjectFolder(state: ProjectShelfState, folderId: string, name: string): ProjectShelfState {
  const normalizedId = String(folderId || "").trim().toLowerCase();
  const normalizedName = normalizeFolderName(name);
  if (!normalizedId || !normalizedName) throw new Error("Invalid folder name.");
  return {
    ...state,
    folders: state.folders.map((folder) => (
      folder.id === normalizedId
        ? { ...folder, name: normalizedName, updatedAt: nowIso() }
        : folder
    )),
  };
}

export function deleteProjectFolder(state: ProjectShelfState, folderId: string): ProjectShelfState {
  const normalizedId = String(folderId || "").trim().toLowerCase();
  if (!normalizedId) return state;
  return {
    ...state,
    folders: state.folders.filter((folder) => folder.id !== normalizedId),
    projectFolderByKey: Object.fromEntries(
      Object.entries(state.projectFolderByKey).filter(([, value]) => value !== normalizedId),
    ),
  };
}

export function assignProjectToFolder(
  state: ProjectShelfState,
  projectKey: string,
  folderId: string | null | undefined,
): ProjectShelfState {
  const normalizedProjectKey = String(projectKey || "").trim().toLowerCase();
  const normalizedFolderId = String(folderId || "").trim().toLowerCase();
  if (!normalizedProjectKey) return state;
  const nextAssignments = { ...state.projectFolderByKey };
  if (!normalizedFolderId) {
    delete nextAssignments[normalizedProjectKey];
  } else {
    nextAssignments[normalizedProjectKey] = normalizedFolderId;
  }
  return {
    ...state,
    projectFolderByKey: nextAssignments,
  };
}
