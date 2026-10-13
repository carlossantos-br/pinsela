import React from "react";

export type AutoRefreshIntervalMs = 5000 | 10000 | 30000;

export type AutoRefreshSettings = {
  // When off, the UI holds new data and prompts the user to apply updates.
  autoUpdate: boolean;
  intervalMs: AutoRefreshIntervalMs;
};

const STORAGE_KEY = "pinsela:auto_refresh";

const DEFAULT_SETTINGS: AutoRefreshSettings = {
  autoUpdate: true,
  intervalMs: 10000,
};

function loadSettings(): AutoRefreshSettings {
  // Keep a stable background refresh strategy (10s) without exposing controls in UI.
  return DEFAULT_SETTINGS;
}

type AutoRefreshCtx = {
  settings: AutoRefreshSettings;
  setAutoUpdate: (v: boolean) => void;
  setIntervalMs: (v: AutoRefreshIntervalMs) => void;
};

const Ctx = React.createContext<AutoRefreshCtx | null>(null);

export function AutoRefreshProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = React.useState<AutoRefreshSettings>(() => loadSettings());

  React.useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Ignore storage failures (private mode, etc.)
    }
  }, [settings]);

  const value: AutoRefreshCtx = React.useMemo(
    () => ({
      settings,
      setAutoUpdate: (_v) => setSettings(DEFAULT_SETTINGS),
      setIntervalMs: (_v) => setSettings(DEFAULT_SETTINGS),
    }),
    [settings]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAutoRefresh(): AutoRefreshCtx {
  const v = React.useContext(Ctx);
  if (!v) throw new Error("useAutoRefresh must be used within AutoRefreshProvider");
  return v;
}
