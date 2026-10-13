import assert from "node:assert/strict";
import { engineZoomToUiPercent, uiPercentToEngineZoom } from "../zoomMapping";

export function runZoomMappingTests() {
  // 1:1 mapping (BASE_TO_UI_FACTOR=1): UI 100% == engine 1.0 == real scale.
  assert.equal(uiPercentToEngineZoom(100), 1);
  assert.equal(engineZoomToUiPercent(1), 100);

  assert.equal(engineZoomToUiPercent(uiPercentToEngineZoom(50)), 50);
  assert.equal(engineZoomToUiPercent(uiPercentToEngineZoom(175)), 175);

  // MIN_UI_ZOOM 8, MAX_UI_ZOOM 500; out-of-range inputs clamp.
  assert.equal(uiPercentToEngineZoom(1), 0.08);
  assert.equal(uiPercentToEngineZoom(999), 5);
  assert.equal(engineZoomToUiPercent(0), 8);
  assert.equal(engineZoomToUiPercent(999), 500);
}

