export type PinselaFeatureFlags = {
  engineV2: boolean;
  workerCompute: boolean;
  interactionV2: boolean;
  offscreenRender: boolean;
  webglRender: boolean;
  experimentalTools: boolean;
  designSystemV2: boolean;
  perfMetrics: boolean;
};

const FLAG_OVERRIDE_STORAGE_KEY = "pinsela:pinsela:flags";

const DEFAULT_FLAGS: PinselaFeatureFlags = {
  engineV2: true,
  workerCompute: false,
  interactionV2: true,
  offscreenRender: true,
  webglRender: false,
  experimentalTools: false,
  designSystemV2: false,
  perfMetrics: false,
};

type MutableFlagMap = Partial<Record<keyof PinselaFeatureFlags, boolean>>;

function parseBoolean(raw: unknown, fallback: boolean): boolean {
  if (typeof raw === "boolean") return raw;
  const text = String(raw ?? "").trim().toLowerCase();
  if (!text) return fallback;
  if (["1", "true", "yes", "on", "enabled"].includes(text)) return true;
  if (["0", "false", "no", "off", "disabled"].includes(text)) return false;
  return fallback;
}

function coerceOverrideMap(raw: unknown): MutableFlagMap {
  if (!raw || typeof raw !== "object") return {};
  const obj = raw as Record<string, unknown>;
  const out: MutableFlagMap = {};
  for (const key of Object.keys(DEFAULT_FLAGS) as Array<keyof PinselaFeatureFlags>) {
    if (key in obj) out[key] = parseBoolean(obj[key], DEFAULT_FLAGS[key]);
  }
  return out;
}

function readStoredOverrides(): MutableFlagMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(FLAG_OVERRIDE_STORAGE_KEY);
    if (!raw) return {};
    return coerceOverrideMap(JSON.parse(raw));
  } catch {
    return {};
  }
}

function readEnvFlags(): PinselaFeatureFlags {
  const env = import.meta.env;
  return {
    engineV2: parseBoolean(env.VITE_PINSELA_ENGINE_V2, DEFAULT_FLAGS.engineV2),
    workerCompute: parseBoolean(env.VITE_PINSELA_WORKER_COMPUTE, DEFAULT_FLAGS.workerCompute),
    interactionV2: parseBoolean(env.VITE_PINSELA_INTERACTION_V2, DEFAULT_FLAGS.interactionV2),
    offscreenRender: parseBoolean(env.VITE_PINSELA_OFFSCREEN_RENDER, DEFAULT_FLAGS.offscreenRender),
    webglRender: parseBoolean(env.VITE_PINSELA_WEBGL_RENDER, DEFAULT_FLAGS.webglRender),
    experimentalTools: parseBoolean(env.VITE_PINSELA_EXPERIMENTAL_TOOLS, DEFAULT_FLAGS.experimentalTools),
    designSystemV2: parseBoolean(env.VITE_PINSELA_DESIGN_SYSTEM_V2, DEFAULT_FLAGS.designSystemV2),
    perfMetrics: parseBoolean(env.VITE_PINSELA_PERF_METRICS, DEFAULT_FLAGS.perfMetrics),
  };
}

export function getPinselaFeatureFlags(): PinselaFeatureFlags {
  const envFlags = readEnvFlags();
  const overrides = readStoredOverrides();
  return { ...envFlags, ...overrides };
}

export function readPinselaFeatureFlagOverrides(): MutableFlagMap {
  return readStoredOverrides();
}

export function writePinselaFeatureFlagOverrides(next: MutableFlagMap | null): void {
  if (typeof window === "undefined") return;
  if (!next || !Object.keys(next).length) {
    window.localStorage.removeItem(FLAG_OVERRIDE_STORAGE_KEY);
    return;
  }
  const safe = coerceOverrideMap(next);
  window.localStorage.setItem(FLAG_OVERRIDE_STORAGE_KEY, JSON.stringify(safe));
}

export function isPinselaFlagEnabled(flag: keyof PinselaFeatureFlags): boolean {
  return getPinselaFeatureFlags()[flag];
}
