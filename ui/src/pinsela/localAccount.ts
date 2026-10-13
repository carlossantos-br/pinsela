export const LOCAL_ACCOUNT_ROUTE = "/editor";
export const LOCAL_EDITOR_PROJECT_ROUTE_PREFIX = "/project";
export const LOCAL_ACCOUNT_DISPLAY_NAME = "Local account";

export function isLocalAccountPath(pathname: string): boolean {
  return /\/(?:editor|editor-local|project)(?:\/|$)/.test(String(pathname || "").trim());
}

export function isRemoteBackedLocalEditorPath(pathname: string): boolean {
  return /\/project\/[^/]+(?:\/|$)/.test(String(pathname || "").trim())
    || /\/(?:editor|editor-local)\/project\/[^/]+(?:\/|$)/.test(String(pathname || "").trim());
}

export function isLocalDevHost(hostname?: string | null): boolean {
  const normalized = String(hostname || "").trim().toLowerCase();
  return normalized === "localhost"
    || normalized === "127.0.0.1"
    || normalized === "0.0.0.0"
    || normalized === "::1";
}

export function getLocalAccountProjectKey(rawKey?: string | null): string {
  return String(rawKey || "").trim().toLowerCase();
}

export function getRemoteBackedLocalEditorPath(rawKey?: string | null): string {
  const projectKey = getLocalAccountProjectKey(rawKey);
  if (!projectKey) return "/projects";
  return `${LOCAL_EDITOR_PROJECT_ROUTE_PREFIX}/${encodeURIComponent(projectKey)}`;
}
