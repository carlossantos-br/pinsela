import type {
  PinselaPathData,
  PinselaPathFillRule,
  PinselaPathPoint,
  PinselaPathSubpath,
} from "./types";

function normalizePathPoint(point: PinselaPathPoint | null | undefined): PinselaPathPoint | null {
  if (!point) return null;
  const x = Number(point.x || 0);
  const y = Number(point.y || 0);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return {
    x,
    y,
    in: point.in && Number.isFinite(Number(point.in.x)) && Number.isFinite(Number(point.in.y))
      ? { x: Number(point.in.x || 0), y: Number(point.in.y || 0) }
      : point.in ?? null,
    out: point.out && Number.isFinite(Number(point.out.x)) && Number.isFinite(Number(point.out.y))
      ? { x: Number(point.out.x || 0), y: Number(point.out.y || 0) }
      : point.out ?? null,
    mode: point.mode === "smooth" ? "smooth" : "corner",
  };
}

function normalizePathSubpath(subpath: PinselaPathSubpath | null | undefined): PinselaPathSubpath | null {
  if (!subpath || typeof subpath !== "object") return null;
  const points = Array.isArray(subpath.points)
    ? subpath.points.map((point) => normalizePathPoint(point)).filter(Boolean) as PinselaPathPoint[]
    : [];
  if (points.length < 2) return null;
  return {
    closed: subpath.closed !== false,
    points,
  };
}

export function getPathFillRule(pathData: PinselaPathData | null | undefined): PinselaPathFillRule {
  return pathData?.fill_rule === "evenodd" ? "evenodd" : "nonzero";
}

export function getPathSubpaths(pathData: PinselaPathData | null | undefined): PinselaPathSubpath[] {
  if (!pathData || typeof pathData !== "object") return [];
  const subpaths = Array.isArray(pathData.subpaths)
    ? pathData.subpaths.map((subpath) => normalizePathSubpath(subpath)).filter(Boolean) as PinselaPathSubpath[]
    : [];
  if (subpaths.length) return subpaths;
  const points = Array.isArray(pathData.points)
    ? pathData.points.map((point) => normalizePathPoint(point)).filter(Boolean) as PinselaPathPoint[]
    : [];
  if (points.length < 2) return [];
  return [{
    closed: pathData.closed !== false,
    points,
  }];
}

export function clonePathData(pathData: PinselaPathData | null | undefined): PinselaPathData | null {
  if (!pathData || typeof pathData !== "object") return null;
  const subpaths = getPathSubpaths(pathData);
  if (!subpaths.length) return null;
  return {
    closed: subpaths[0].closed !== false,
    points: subpaths[0].points.map((point) => ({
      x: Number(point.x || 0),
      y: Number(point.y || 0),
      in: point.in ? { x: Number(point.in.x || 0), y: Number(point.in.y || 0) } : point.in ?? null,
      out: point.out ? { x: Number(point.out.x || 0), y: Number(point.out.y || 0) } : point.out ?? null,
      mode: point.mode === "smooth" ? "smooth" : "corner",
    })),
    subpaths: subpaths.map((subpath) => ({
      closed: subpath.closed !== false,
      points: subpath.points.map((point) => ({
        x: Number(point.x || 0),
        y: Number(point.y || 0),
        in: point.in ? { x: Number(point.in.x || 0), y: Number(point.in.y || 0) } : point.in ?? null,
        out: point.out ? { x: Number(point.out.x || 0), y: Number(point.out.y || 0) } : point.out ?? null,
        mode: point.mode === "smooth" ? "smooth" : "corner",
      })),
    })),
    fill_rule: getPathFillRule(pathData),
  };
}
