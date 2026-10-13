/**
 * Canva-style image crop math (pure, framework-free, fully testable).
 *
 * Model: an image placed in a "frame". Two rectangles, both in the same
 * coordinate space the caller chooses (canvas units):
 *   - box   = the frame on the canvas (the element geometry).
 *   - image = the full source image drawn on the canvas, at some scale/offset.
 *
 * The persisted document stores the frame (geometry) + `image_crop` in source
 * pixels. The painter maps the crop source-rect onto the whole box. To keep the
 * image from ever distorting, the invariant is: box aspect == crop aspect.
 *
 * The clean way to satisfy that invariant during interaction is to treat the
 * full *image-on-canvas* rect as the persistent thing:
 *   - resize the frame  → frame moves over a FIXED image (reveals/hides pixels)
 *   - drag the image    → image moves under a FIXED frame (pan)
 *   - zoom the image    → image scales about a pivot under a FIXED frame
 * After each, derive `image_crop` from (box, image). Because scale stays uniform,
 * crop aspect tracks box aspect automatically — distortion is impossible.
 */

export type CropRect = { x: number; y: number; width: number; height: number };
export type CropResizeHandle = "tl" | "tc" | "tr" | "ml" | "mr" | "bl" | "bc" | "br";

/** Minimum frame size, in canvas units, so a frame can never collapse. */
export const MIN_CROP_FRAME = 8;
/** Smallest crop window (as a fraction of the source) → caps how far you can zoom in. */
const DEFAULT_MIN_CROP_FRACTION = 0.02;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Largest centered crop of the BOX aspect that fits inside the source image.
 * This is the "cover" placement — what `image_fit: "fill"` shows — expressed as
 * an explicit source-pixel rect, so entering crop mode never changes appearance.
 */
export function coverCrop(imageW: number, imageH: number, boxW: number, boxH: number): CropRect {
  const iw = Math.max(1, imageW);
  const ih = Math.max(1, imageH);
  const boxAspect = Math.max(1e-6, boxW) / Math.max(1e-6, boxH);
  const imageAspect = iw / ih;
  let width: number;
  let height: number;
  if (imageAspect > boxAspect) {
    // source is wider than the frame → full height, crop the sides
    height = ih;
    width = ih * boxAspect;
  } else {
    // source is taller than the frame → full width, crop top/bottom
    width = iw;
    height = iw / boxAspect;
  }
  return { x: (iw - width) / 2, y: (ih - height) / 2, width, height };
}

/** The full source image's rect on the canvas, derived from (box, crop). */
export function imageRectFromCrop(box: CropRect, crop: CropRect, imageW: number, imageH: number): CropRect {
  const s = box.width / Math.max(1e-6, crop.width); // canvas units per source pixel
  return {
    x: box.x - crop.x * s,
    y: box.y - crop.y * s,
    width: imageW * s,
    height: imageH * s,
  };
}

/** The crop source-rect (image pixels) for a given frame over the image-on-canvas. */
export function cropFromImageRect(box: CropRect, image: CropRect, imageW: number, imageH: number): CropRect {
  const s = image.width / Math.max(1e-6, imageW); // canvas units per source pixel
  return {
    x: (box.x - image.x) / s,
    y: (box.y - image.y) / s,
    width: box.width / s,
    height: box.height / s,
  };
}

/** Shift the image so it always fully covers the frame (no empty/transparent gaps). */
export function clampImageRectToCoverBox(box: CropRect, image: CropRect): CropRect {
  const minX = box.x + box.width - image.width; // image right edge meets frame right
  const maxX = box.x; // image left edge meets frame left
  const minY = box.y + box.height - image.height;
  const maxY = box.y;
  const x = minX <= maxX ? clamp(image.x, minX, maxX) : box.x + box.width / 2 - image.width / 2;
  const y = minY <= maxY ? clamp(image.y, minY, maxY) : box.y + box.height / 2 - image.height / 2;
  return { x, y, width: image.width, height: image.height };
}

/** Pan the image under a fixed frame; clamped so it keeps covering the frame. */
export function panImageRect(image: CropRect, box: CropRect, dx: number, dy: number): CropRect {
  return clampImageRectToCoverBox(box, {
    x: image.x + dx,
    y: image.y + dy,
    width: image.width,
    height: image.height,
  });
}

/**
 * Zoom the image about a pivot (canvas point) under a fixed frame.
 * Uniform scale (aspect preserved); clamped so it never zooms out past covering
 * the frame, nor in past `minCropFraction` of the source.
 */
export function zoomImageRect(
  image: CropRect,
  box: CropRect,
  factor: number,
  pivot: { x: number; y: number },
  opts?: { minCropFraction?: number; imageW?: number; imageH?: number },
): CropRect {
  const minCropFraction = opts?.minCropFraction ?? DEFAULT_MIN_CROP_FRACTION;
  const coverScale = Math.max(box.width / Math.max(1e-6, image.width), box.height / Math.max(1e-6, image.height));
  const maxScale = box.width / Math.max(1e-6, minCropFraction) / Math.max(1e-6, image.width);
  const scale = clamp(factor, coverScale, Math.max(coverScale, maxScale));
  const newW = image.width * scale;
  const newH = image.height * scale;
  const x = pivot.x - (pivot.x - image.x) * scale;
  const y = pivot.y - (pivot.y - image.y) * scale;
  return clampImageRectToCoverBox(box, { x, y, width: newW, height: newH });
}

/**
 * Resize the crop FRAME (the box) over a fixed image. The frame is clamped to
 * stay within the image bounds and above the minimum size; the resulting crop is
 * derived from the clamped frame so its aspect always equals the box aspect.
 */
export function resizeCropFrame(
  _handle: CropResizeHandle,
  nextBox: CropRect,
  image: CropRect,
  imageW: number,
  imageH: number,
): { box: CropRect; crop: CropRect } {
  const imgLeft = image.x;
  const imgTop = image.y;
  const imgRight = image.x + image.width;
  const imgBottom = image.y + image.height;
  const left = clamp(nextBox.x, imgLeft, imgRight - MIN_CROP_FRAME);
  const top = clamp(nextBox.y, imgTop, imgBottom - MIN_CROP_FRAME);
  const right = clamp(nextBox.x + nextBox.width, left + MIN_CROP_FRAME, imgRight);
  const bottom = clamp(nextBox.y + nextBox.height, top + MIN_CROP_FRAME, imgBottom);
  const box = { x: left, y: top, width: right - left, height: bottom - top };
  const crop = cropFromImageRect(box, image, imageW, imageH);
  return { box, crop };
}

/** True when the frame and crop share an aspect ratio (i.e. no distortion). */
export function cropAspectMatchesBox(box: CropRect, crop: CropRect, eps = 0.02): boolean {
  if (crop.width <= 0 || crop.height <= 0 || box.width <= 0 || box.height <= 0) return false;
  return Math.abs(box.width / box.height - crop.width / crop.height) <= eps;
}
