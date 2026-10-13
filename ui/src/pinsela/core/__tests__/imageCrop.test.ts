import assert from "node:assert/strict";
import {
  coverCrop,
  imageRectFromCrop,
  cropFromImageRect,
  panImageRect,
  zoomImageRect,
  resizeCropFrame,
  cropAspectMatchesBox,
  type CropRect,
} from "../imageCrop";

function assertApprox(actual: number, expected: number, eps = 0.02, msg = "") {
  assert.ok(
    Math.abs(actual - expected) <= eps,
    `${msg} expected ~${expected}, got ${actual}`,
  );
}

function assertRect(actual: CropRect, expected: CropRect, eps = 0.02, label = "") {
  assertApprox(actual.x, expected.x, eps, `${label}.x`);
  assertApprox(actual.y, expected.y, eps, `${label}.y`);
  assertApprox(actual.width, expected.width, eps, `${label}.width`);
  assertApprox(actual.height, expected.height, eps, `${label}.height`);
}

function aspect(r: CropRect): number {
  return r.width / r.height;
}

// coverCrop: a centered crop of the BOX aspect, max size inside the image, no overflow.
function testCoverCropWideImage() {
  // image wider than box → crop full height, narrower width, centered horizontally
  const crop = coverCrop(2000, 1000, 600, 600); // box aspect 1
  assertRect(crop, { x: 500, y: 0, width: 1000, height: 1000 }, 0.5, "coverCrop wide");
  assertApprox(aspect(crop), 1, 0.001, "coverCrop wide aspect");
  // within bounds
  assert.ok(crop.x >= 0 && crop.y >= 0 && crop.x + crop.width <= 2000 && crop.y + crop.height <= 1000);
}

function testCoverCropTallImage() {
  // image taller than box → crop full width, shorter height, centered vertically
  const crop = coverCrop(1000, 2000, 600, 600); // box aspect 1
  assertRect(crop, { x: 0, y: 500, width: 1000, height: 1000 }, 0.5, "coverCrop tall");
  assertApprox(aspect(crop), 1, 0.001, "coverCrop tall aspect");
}

function testCoverCropMatchesBoxAspect() {
  const crop = coverCrop(1600, 900, 400, 600); // box aspect 0.666...
  assertApprox(aspect(crop), 400 / 600, 0.001, "coverCrop matches box aspect");
  assert.ok(crop.x >= -0.001 && crop.y >= -0.001);
  assert.ok(crop.x + crop.width <= 1600.001 && crop.y + crop.height <= 900.001);
}

// imageRectFromCrop and cropFromImageRect are inverses.
function testImageRectFromCropExplicit() {
  const box: CropRect = { x: 100, y: 200, width: 600, height: 400 };
  const crop: CropRect = { x: 500, y: 0, width: 1200, height: 800 };
  const image = imageRectFromCrop(box, crop, 2000, 1000);
  // s = 600/1200 = 0.5 → image is the full source drawn at scale 0.5, offset so crop maps to box
  assertRect(image, { x: -150, y: 200, width: 1000, height: 500 }, 0.01, "imageRectFromCrop");
}

function testCropImageRectRoundTrip() {
  const box: CropRect = { x: 100, y: 200, width: 600, height: 400 };
  const crop: CropRect = { x: 500, y: 0, width: 1200, height: 800 };
  const image = imageRectFromCrop(box, crop, 2000, 1000);
  const back = cropFromImageRect(box, image, 2000, 1000);
  assertRect(back, crop, 0.01, "roundtrip");
}

// panImageRect: drags the IMAGE under a fixed frame; cannot expose empty area.
function testPanClampsToCoverBox() {
  const box: CropRect = { x: 0, y: 0, width: 600, height: 400 };
  const image: CropRect = { x: -150, y: 0, width: 1000, height: 500 };
  // pan right far → image.x would become positive (empty on left) → clamp to 0
  const panned = panImageRect(image, box, 400, 0);
  assertApprox(panned.x, 0, 0.01, "pan right clamp");
  // pan left far → clamp so right edge meets box right: image.x = box.right - image.width = 600 - 1000 = -400
  const panned2 = panImageRect(image, box, -1000, 0);
  assertApprox(panned2.x, -400, 0.01, "pan left clamp");
  // image must always cover the box
  assert.ok(panned2.x <= 0.01 && panned2.x + panned2.width >= 600 - 0.01, "still covers box");
}

// zoomImageRect: scales image about a pivot; cannot zoom out past covering the frame.
function testZoomOutClampedToCoverBox() {
  const box: CropRect = { x: 0, y: 0, width: 600, height: 400 };
  const image: CropRect = { x: -150, y: 0, width: 1000, height: 500 };
  const zoomed = zoomImageRect(image, box, 0.4, { x: 300, y: 200 });
  // must still cover the box after clamping
  assert.ok(zoomed.width >= 600 - 0.01 && zoomed.height >= 400 - 0.01, "zoom-out still covers");
  assert.ok(zoomed.x <= 0.01 && zoomed.y <= 0.01, "zoom-out origin covers");
  assert.ok(zoomed.x + zoomed.width >= 600 - 0.01 && zoomed.y + zoomed.height >= 400 - 0.01);
}

function testZoomInKeepsPivotSourcePoint() {
  const box: CropRect = { x: 0, y: 0, width: 600, height: 400 };
  const image: CropRect = { x: -150, y: 0, width: 1000, height: 500 };
  const imageW = 2000;
  const pivot = { x: 300, y: 150 };
  // source point under the pivot before
  const sBefore = (image.width) / imageW; // 0.5
  const srcUBefore = (pivot.x - image.x) / sBefore;
  const srcVBefore = (pivot.y - image.y) / sBefore;
  const zoomed = zoomImageRect(image, box, 2, pivot, { imageW, imageH: 1000 });
  const sAfter = zoomed.width / imageW;
  const srcUAfter = (pivot.x - zoomed.x) / sAfter;
  const srcVAfter = (pivot.y - zoomed.y) / sAfter;
  assertApprox(srcUAfter, srcUBefore, 0.5, "pivot source x stable");
  assertApprox(srcVAfter, srcVBefore, 0.5, "pivot source y stable");
  assertApprox(zoomed.width, 2000, 0.5, "zoom-in width");
}

// resizeCropFrame: dragging frame handles changes which part shows, image scale fixed,
// frame stays within the image, and crop aspect always equals box aspect (no distortion).
function testResizeFrameClampsToImageBounds() {
  const image: CropRect = { x: -150, y: 0, width: 1000, height: 500 };
  const box: CropRect = { x: 0, y: 0, width: 600, height: 400 };
  // drag br outward past the image → clamp to image right/bottom
  const out = resizeCropFrame("br", { x: 0, y: 0, width: 900, height: 600 }, image, 2000, 1000);
  assertRect(out.box, { x: 0, y: 0, width: 850, height: 500 }, 0.5, "frame clamp box");
  assert.ok(cropAspectMatchesBox(out.box, out.crop), "no distortion after grow");
  // crop must stay within image source pixels
  assert.ok(out.crop.x >= -0.5 && out.crop.x + out.crop.width <= 2000.5, "crop within source x");
  assert.ok(out.crop.y >= -0.5 && out.crop.y + out.crop.height <= 1000.5, "crop within source y");
}

function testResizeFrameInwardShrinksCrop() {
  const image: CropRect = { x: -150, y: 0, width: 1000, height: 500 };
  const box: CropRect = { x: 0, y: 0, width: 600, height: 400 };
  const inward = resizeCropFrame("br", { x: 0, y: 0, width: 300, height: 200 }, image, 2000, 1000);
  assertRect(inward.box, { x: 0, y: 0, width: 300, height: 200 }, 0.5, "frame inward box");
  assert.ok(cropAspectMatchesBox(inward.box, inward.crop), "no distortion after shrink");
}

function testResizeFrameSideHandleChangesAspectWithoutDistortion() {
  const image: CropRect = { x: -150, y: 0, width: 1000, height: 500 };
  const box: CropRect = { x: 0, y: 0, width: 600, height: 400 };
  // widen via right-middle handle: width grows, height same
  const wide = resizeCropFrame("mr", { x: 0, y: 0, width: 800, height: 400 }, image, 2000, 1000);
  assert.ok(wide.box.width > box.width, "side handle widened frame");
  assertApprox(wide.box.height, 400, 0.5, "side handle kept height");
  assert.ok(cropAspectMatchesBox(wide.box, wide.crop), "side resize stays undistorted");
}

export function runImageCropTests() {
  testCoverCropWideImage();
  testCoverCropTallImage();
  testCoverCropMatchesBoxAspect();
  testImageRectFromCropExplicit();
  testCropImageRectRoundTrip();
  testPanClampsToCoverBox();
  testZoomOutClampedToCoverBox();
  testZoomInKeepsPivotSourcePoint();
  testResizeFrameClampsToImageBounds();
  testResizeFrameInwardShrinksCrop();
  testResizeFrameSideHandleChangesAspectWithoutDistortion();
  console.log("imageCrop: ok");
}
