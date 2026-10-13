import React from "react";
import { useLocation } from "react-router-dom";
import { apiFetch } from "./api";
import { isLocalAccountPath, isLocalDevHost, isRemoteBackedLocalEditorPath } from "../pinsela/localAccount";

type Me = { ok: boolean; username: string; auth_via: string };

type AuthState = {
  me: Me | null;
  loading: boolean;
  refresh: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const Ctx = React.createContext<AuthState | null>(null);

function isPublicPath(pathname: string): boolean {
  return /^\/login(?:\/|$)/.test(String(pathname || "").trim());
}

const SESSION_HINT_KEY = "pinsela_session_hint";

function readSessionHint(): boolean {
  try {
    return window.localStorage.getItem(SESSION_HINT_KEY) === "1";
  } catch {
    return false;
  }
}

function writeSessionHint(active: boolean): void {
  try {
    if (active) window.localStorage.setItem(SESSION_HINT_KEY, "1");
    else window.localStorage.removeItem(SESSION_HINT_KEY);
  } catch {
    // Storage unavailable (private mode) — hint is best-effort only.
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const localEditorPath = isLocalAccountPath(location.pathname);
  const remoteBackedLocalEditor = isRemoteBackedLocalEditorPath(location.pathname);
  const bypassAuth = localEditorPath && !remoteBackedLocalEditor;
  const localHost = typeof window !== "undefined" && isLocalDevHost(window.location.hostname);
  const localBootstrapEligible = localHost && !isPublicPath(location.pathname);
  const [me, setMe] = React.useState<Me | null>(null);
  const [loading, setLoading] = React.useState(true);
  const meRef = React.useRef<Me | null>(null);
  React.useEffect(() => {
    meRef.current = me;
  }, [me]);
  const refreshInFlightRef = React.useRef(false);

  const refresh = React.useCallback(async () => {
    if (bypassAuth && !localHost) {
      setMe({ ok: true, username: "local", auth_via: "local-bypass" });
      setLoading(false);
      return;
    }
    // On public pages, only probe the session when a previous one is known to
    // exist — avoids a guaranteed 401 in the console on every anonymous visit.
    if (isPublicPath(location.pathname) && !readSessionHint()) {
      setMe(null);
      setLoading(false);
      return;
    }
    try {
      const data = await apiFetch<Me>("/auth/me");
      writeSessionHint(true);
      setMe(data);
      setLoading(false);
      return;
    } catch {
      if (localBootstrapEligible) {
        try {
          const data = await apiFetch<Me>("/auth/local/bootstrap", { method: "POST" });
          writeSessionHint(true);
          setMe(data);
          setLoading(false);
          return;
        } catch {
          // Keep localhost usable even if the bootstrap endpoint is temporarily unavailable.
        }
      }
      writeSessionHint(false);
      setMe(null);
      setLoading(false);
    }
  }, [bypassAuth, localBootstrapEligible, localHost, location.pathname]);

  React.useEffect(() => {
    // An established session stays valid across client-side navigation; real
    // API calls surface expiry. Refetching /auth/me per route is pure noise.
    if (meRef.current?.ok) {
      setLoading(false);
      return;
    }
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    setLoading(true);
    void refresh().finally(() => {
      refreshInFlightRef.current = false;
    });
  }, [refresh, location.pathname]);

  const login = React.useCallback(async (username: string, password: string) => {
    if (bypassAuth && !localHost) {
      setMe({ ok: true, username: username || "local", auth_via: "local-bypass" });
      setLoading(false);
      return;
    }
    await apiFetch("/auth/login", { method: "POST", json: { username, password } });
    await refresh();
  }, [bypassAuth, localHost, refresh]);

  const logout = React.useCallback(async () => {
    if (bypassAuth && !localHost) {
      setMe(null);
      setLoading(false);
      return;
    }
    await apiFetch("/auth/logout", { method: "POST" });
    writeSessionHint(false);
    setMe(null);
  }, [bypassAuth, localHost]);

  const value: AuthState = { me, loading, refresh, login, logout };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = React.useContext(Ctx);
  if (!v) throw new Error("useAuth must be used within AuthProvider");
  return v;
}
