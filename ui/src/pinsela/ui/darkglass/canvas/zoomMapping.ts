// 1:1 mapping so the displayed "100%" == real document scale (Canva/Figma
// convention). Was 2 (100% rendered at half size), which misled users about
// real/print size. With factor 1, engineZoom 1.0 == 100% == 1:1 for documents
// that fit the viewport width (the common case).
const BASE_TO_UI_FACTOR = 1;

// Zoom-out floor. Kept low for freedom (fit-all on big/multi-page docs + room to
// zoom way out); the auto-fit recenters so pages don't get lost off-screen.
export const MIN_UI_ZOOM = 8;
export const MAX_UI_ZOOM = 500;

export function clampUiZoom(percent: number): number {
  return Math.max(MIN_UI_ZOOM, Math.min(MAX_UI_ZOOM, Math.round(percent)));
}

export function uiPercentToEngineZoom(percent: number): number {
  return clampUiZoom(percent) / 100 / BASE_TO_UI_FACTOR;
}

export function engineZoomToUiPercent(engineZoom: number): number {
  return clampUiZoom(engineZoom * 100 * BASE_TO_UI_FACTOR);
}
