import assert from "node:assert/strict";
import { computeWheelZoomFactor, resolveAxisLockedDelta } from "../interactionMath";

export function runInteractionMathTests() {
  const mouseOut = computeWheelZoomFactor(40, { trackpad: false });
  const trackpadOut = computeWheelZoomFactor(40, { trackpad: true });
  assert.ok(trackpadOut > mouseOut);
  assert.ok(trackpadOut >= 0.9);

  const mouseIn = computeWheelZoomFactor(-40, { trackpad: false });
  const trackpadIn = computeWheelZoomFactor(-40, { trackpad: true });
  assert.ok(trackpadIn < mouseIn);
  assert.ok(trackpadIn <= 1.1);

  const free = resolveAxisLockedDelta(24, 11, false, null);
  assert.deepEqual(free, { dx: 24, dy: 11, lockedAxis: null });

  const lockX = resolveAxisLockedDelta(24, 11, true, null);
  assert.deepEqual(lockX, { dx: 24, dy: 0, lockedAxis: "x" });

  const keepLockX = resolveAxisLockedDelta(24, 48, true, "x");
  assert.deepEqual(keepLockX, { dx: 24, dy: 0, lockedAxis: "x" });

  const lockY = resolveAxisLockedDelta(8, 31, true, null);
  assert.deepEqual(lockY, { dx: 0, dy: 31, lockedAxis: "y" });
}
