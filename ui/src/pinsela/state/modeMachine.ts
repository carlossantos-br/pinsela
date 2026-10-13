export type PinselaMode = "select" | "text-edit" | "crop" | "path-edit" | "transform" | "pan";

const PRIORITY: Record<PinselaMode, number> = {
  "text-edit": 5,
  crop: 4,
  "path-edit": 3,
  transform: 2,
  pan: 1,
  select: 0,
};

export function modeAtLeast(mode: PinselaMode, target: PinselaMode): boolean {
  return PRIORITY[mode] >= PRIORITY[target];
}

export function resolveMode(next: PinselaMode, fallback: PinselaMode = "select"): PinselaMode {
  return PRIORITY[next] >= 0 ? next : fallback;
}

