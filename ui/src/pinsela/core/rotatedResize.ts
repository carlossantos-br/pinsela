/**
 * Resize a ROTATED box by dragging a handle, in the box's local (un-rotated)
 * space, keeping the opposite edge/corner anchored in WORLD space.
 *
 * The editor's selection bounds are an axis-aligned bounding box (AABB), and the
 * generic resize maps AABB changes proportionally onto geometry — which visibly
 * "moves all sides" once a node is rotated. This computes the correct geometry
 * directly: convert the world drag delta into the node's local frame, move only
 * the dragged edges, then re-place the center so the opposite corner stays put.
 *
 * Reduces exactly to plain AABB resize when rotationDeg === 0.
 */

export type ResizeBox = { x: number; y: number; width: number; height: number };
export type RotatedResizeHandle = "tl" | "tc" | "tr" | "ml" | "mr" | "bl" | "bc" | "br";

function rotate(x: number, y: number, deg: number): { x: number; y: number } {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: x * c - y * s, y: x * s + y * c };
}

export function resizeRotatedBox(
  box: ResizeBox,
  rotationDeg: number,
  handle: RotatedResizeHandle,
  worldDx: number,
  worldDy: number,
  opts?: { minSize?: number },
): ResizeBox {
  const minSize = Math.max(1, opts?.minSize ?? 4);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // World drag delta → local frame.
  const ld = rotate(worldDx, worldDy, -rotationDeg);

  const movesLeft = handle === "tl" || handle === "ml" || handle === "bl";
  const movesRight = handle === "tr" || handle === "mr" || handle === "br";
  const movesTop = handle === "tl" || handle === "tc" || handle === "tr";
  const movesBottom = handle === "bl" || handle === "bc" || handle === "br";

  // Local edges relative to the OLD center.
  let left = -box.width / 2;
  let right = box.width / 2;
  let top = -box.height / 2;
  let bottom = box.height / 2;
  if (movesLeft) left += ld.x;
  if (movesRight) right += ld.x;
  if (movesTop) top += ld.y;
  if (movesBottom) bottom += ld.y;

  // Keep min size by clamping the moving edge (anchor edge stays put).
  if (right - left < minSize) {
    if (movesLeft) left = right - minSize;
    else if (movesRight) right = left + minSize;
  }
  if (bottom - top < minSize) {
    if (movesTop) top = bottom - minSize;
    else if (movesBottom) bottom = top + minSize;
  }

  const newW = right - left;
  const newH = bottom - top;

  // The new local center (relative to old center) is the midpoint of the new box;
  // rotate it into world to find the shifted center that keeps the anchor fixed.
  const ws = rotate((left + right) / 2, (top + bottom) / 2, rotationDeg);
  const newCx = cx + ws.x;
  const newCy = cy + ws.y;

  return { x: newCx - newW / 2, y: newCy - newH / 2, width: newW, height: newH };
}
