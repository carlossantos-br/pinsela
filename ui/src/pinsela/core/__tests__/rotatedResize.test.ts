import assert from "node:assert/strict";
import { resizeRotatedBox, type ResizeBox } from "../rotatedResize";

function approx(a: number, b: number, eps = 0.01, msg = "") {
  assert.ok(Math.abs(a - b) <= eps, `${msg} expected ~${b}, got ${a}`);
}
function corner(box: ResizeBox, rotDeg: number, lx: number, ly: number) {
  // world position of a local corner offset (lx,ly relative to center), rotated
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const r = (rotDeg * Math.PI) / 180;
  return { x: cx + lx * Math.cos(r) - ly * Math.sin(r), y: cy + lx * Math.sin(r) + ly * Math.cos(r) };
}

// At rotation 0, dragging 'br' must match plain AABB resize (left/top fixed).
function testZeroRotationBrMatchesAabb() {
  const box: ResizeBox = { x: 100, y: 100, width: 200, height: 100 };
  const out = resizeRotatedBox(box, 0, "br", 50, 30);
  approx(out.x, 100, 0.01, "x fixed");
  approx(out.y, 100, 0.01, "y fixed");
  approx(out.width, 250, 0.01, "w grows");
  approx(out.height, 130, 0.01, "h grows");
}

// At rotation 0, dragging 'tl' keeps the bottom-right corner fixed.
function testZeroRotationTlAnchorsBr() {
  const box: ResizeBox = { x: 100, y: 100, width: 200, height: 100 };
  const out = resizeRotatedBox(box, 0, "tl", 20, 10);
  approx(out.x, 120, 0.01, "left moved");
  approx(out.y, 110, 0.01, "top moved");
  approx(out.x + out.width, 300, 0.01, "right fixed");
  approx(out.y + out.height, 200, 0.01, "bottom fixed");
}

// Rotated 90°: dragging 'br' with a world delta must NOT scale both axes wrongly;
// the opposite (tl) corner must stay anchored in WORLD space.
function testRotated90AnchorsOppositeCorner() {
  const box: ResizeBox = { x: 100, y: 100, width: 200, height: 100 };
  const rot = 90;
  const tlBefore = corner(box, rot, -box.width / 2, -box.height / 2);
  const out = resizeRotatedBox(box, rot, "br", 40, 25);
  const tlAfter = corner(out, rot, -out.width / 2, -out.height / 2);
  approx(tlAfter.x, tlBefore.x, 0.02, "tl world x anchored");
  approx(tlAfter.y, tlBefore.y, 0.02, "tl world y anchored");
}

// Rotated 45°: only the dragged edge dimension changes meaningfully; opposite
// corner anchored. (The bug was: all sides moved.)
function testRotated45SideHandleAnchors() {
  const box: ResizeBox = { x: 0, y: 0, width: 100, height: 100 };
  const rot = 45;
  // ml handle: left edge moves, right edge (mr) anchored in world
  const mrBefore = corner(box, rot, box.width / 2, 0);
  const out = resizeRotatedBox(box, rot, "ml", -30, 12);
  const mrAfter = corner(out, rot, out.width / 2, 0);
  approx(mrAfter.x, mrBefore.x, 0.02, "right edge world x anchored");
  approx(mrAfter.y, mrBefore.y, 0.02, "right edge world y anchored");
  approx(out.height, 100, 0.02, "height unchanged for side handle");
}

function testMinSizeClamp() {
  const box: ResizeBox = { x: 0, y: 0, width: 50, height: 50 };
  const out = resizeRotatedBox(box, 30, "br", -100, -100, { minSize: 4 });
  assert.ok(out.width >= 4 - 0.001 && out.height >= 4 - 0.001, "min size clamp");
}

export function runRotatedResizeTests() {
  testZeroRotationBrMatchesAabb();
  testZeroRotationTlAnchorsBr();
  testRotated90AnchorsOppositeCorner();
  testRotated45SideHandleAnchors();
  testMinSizeClamp();
  console.log("rotatedResize: ok");
}
