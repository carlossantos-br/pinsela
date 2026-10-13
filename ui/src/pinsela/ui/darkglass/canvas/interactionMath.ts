export type LockedDragAxis = "x" | "y" | null;

const MOUSE_WHEEL_ZOOM_SENSITIVITY = 0.0012;
const TRACKPAD_WHEEL_ZOOM_SENSITIVITY = 0.00105;
const MOUSE_WHEEL_ZOOM_MIN_FACTOR = 0.85;
const MOUSE_WHEEL_ZOOM_MAX_FACTOR = 1.15;
const TRACKPAD_WHEEL_ZOOM_MIN_FACTOR = 0.9;
const TRACKPAD_WHEEL_ZOOM_MAX_FACTOR = 1.1;
const MOUSE_WHEEL_ZOOM_DELTA_CAP = 140;
const TRACKPAD_WHEEL_ZOOM_DELTA_CAP = 56;

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function computeWheelZoomFactor(zoomDeltaY: number, options?: { trackpad?: boolean }): number {
  const trackpad = !!options?.trackpad;
  const cappedDelta = clampNumber(
    Number(zoomDeltaY || 0),
    trackpad ? -TRACKPAD_WHEEL_ZOOM_DELTA_CAP : -MOUSE_WHEEL_ZOOM_DELTA_CAP,
    trackpad ? TRACKPAD_WHEEL_ZOOM_DELTA_CAP : MOUSE_WHEEL_ZOOM_DELTA_CAP,
  );
  const sensitivity = trackpad ? TRACKPAD_WHEEL_ZOOM_SENSITIVITY : MOUSE_WHEEL_ZOOM_SENSITIVITY;
  const rawFactor = Math.exp(-cappedDelta * sensitivity);
  return clampNumber(
    rawFactor,
    trackpad ? TRACKPAD_WHEEL_ZOOM_MIN_FACTOR : MOUSE_WHEEL_ZOOM_MIN_FACTOR,
    trackpad ? TRACKPAD_WHEEL_ZOOM_MAX_FACTOR : MOUSE_WHEEL_ZOOM_MAX_FACTOR,
  );
}

export function resolveAxisLockedDelta(
  rawDx: number,
  rawDy: number,
  shiftKey: boolean,
  lockedAxis: LockedDragAxis,
): { dx: number; dy: number; lockedAxis: LockedDragAxis } {
  if (!shiftKey) {
    return {
      dx: rawDx,
      dy: rawDy,
      lockedAxis: null,
    };
  }

  let nextAxis = lockedAxis;
  if (!nextAxis) {
    const absDx = Math.abs(Number(rawDx || 0));
    const absDy = Math.abs(Number(rawDy || 0));
    if (absDx > absDy) nextAxis = "x";
    else if (absDy > absDx) nextAxis = "y";
    else if (absDx > 0 || absDy > 0) nextAxis = absDx >= absDy ? "x" : "y";
  }

  if (nextAxis === "x") {
    return { dx: rawDx, dy: 0, lockedAxis: "x" };
  }
  if (nextAxis === "y") {
    return { dx: 0, dy: rawDy, lockedAxis: "y" };
  }
  return {
    dx: rawDx,
    dy: rawDy,
    lockedAxis: null,
  };
}
