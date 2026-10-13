import React, { useRef, useState, useCallback, useEffect, useLayoutEffect } from "react";
import { ContextToolbar, type ContextToolbarTextState } from "./ContextToolbar";
import { CanvasRulers } from "./CanvasRulers";
import { ZoomHUD } from "./HUDs";
import type { SelectionSummary } from "./selectionSummary";
import type { ToolbarActionId, ToolbarCanvasMode } from "./toolbarModel";
import { computeWheelZoomFactor } from "./interactionMath";
import { IconButton, PinselaIcon, colorToCssString } from "../index";
import type { PinselaGeometry, PinselaNodeKind, PinselaTemplateDocV1 } from "../../../core/types";
import type { GuideLine } from "../../../core/layout";
import { drawDocToCanvas } from "../../../core/export";
import { getFontVerticalMetrics } from "../../../core/textModels";
import { collectDocImageSources, preloadCanvasImage } from "../../../core/imageAssets";
import { hitTestTop } from "../../../core/hitTest";
import { imageRectFromCrop } from "../../../core/imageCrop";
import { isKeyboardEditableTarget, isKeyboardInMenuContext } from "../../../hooks/keyboardScope";
import { clampUiZoom } from "./zoomMapping";

type ResizeHandle = "tl" | "tc" | "tr" | "ml" | "mr" | "bl" | "bc" | "br";

type RectBounds = { x: number; y: number; w: number; h: number };
type Point2D = { x: number; y: number };
type SnapPick = { target: number; delta: number };
export type CanvasProjectPagesLayout = "column" | "row";
export type CanvasProjectPagePosition = { x: number; y: number };

export type CanvasProjectPageView = {
  id: string;
  name: string;
  doc: PinselaTemplateDocV1;
  position?: CanvasProjectPagePosition | null;
};

type CanvasProjectPagePlacement = {
  page: CanvasProjectPageView;
  x: number;
  y: number;
  worldX: number;
  worldY: number;
  width: number;
  height: number;
  active: boolean;
};

type CanvasProjectPagesGeometry = {
  placements: CanvasProjectPagePlacement[];
  width: number;
  height: number;
  activeCenterX: number;
  activeCenterY: number;
};

// Snap a dragged page's world position to neighbour pages' edges/centers
// (left/center/right on X, top/center/bottom on Y) within `threshold` world px.
// Returns the original position on any axis that has no candidate in range.
// Callers skip this entirely while Cmd/Meta is held (free move).
function snapProjectPagePosition(
  x: number,
  y: number,
  w: number,
  h: number,
  others: ReadonlyArray<{ worldX: number; worldY: number; width: number; height: number }>,
  threshold: number,
): { x: number; y: number } {
  const myX = [x, x + w / 2, x + w];
  const offX = [0, w / 2, w];
  const myY = [y, y + h / 2, y + h];
  const offY = [0, h / 2, h];
  let snapX = x;
  let snapY = y;
  let bestDX = threshold + 1;
  let bestDY = threshold + 1;
  for (const o of others) {
    const oxs = [o.worldX, o.worldX + o.width / 2, o.worldX + o.width];
    const oys = [o.worldY, o.worldY + o.height / 2, o.worldY + o.height];
    for (let i = 0; i < 3; i += 1) {
      for (const ox of oxs) {
        const d = Math.abs(myX[i] - ox);
        if (d < bestDX) { bestDX = d; snapX = ox - offX[i]; }
      }
      for (const oy of oys) {
        const d = Math.abs(myY[i] - oy);
        if (d < bestDY) { bestDY = d; snapY = oy - offY[i]; }
      }
    }
  }
  return {
    x: bestDX <= threshold ? Math.round(snapX) : Math.round(x),
    y: bestDY <= threshold ? Math.round(snapY) : Math.round(y),
  };
}

// Choose a screen-space anchor for the active page's control pill so it never
// overlaps another artboard. Tries below → above → right → left of the active
// page (in screen px) and returns the first slot clear of every other page rect.
function pickPageControlAnchor(
  active: { x: number; y: number; width: number; height: number },
  others: ReadonlyArray<{ x: number; y: number; width: number; height: number }>,
  scale: number,
  controlW: number,
  controlH: number,
  gap: number,
  // Workspace→screen + viewport rect, so the pill never tucks behind the
  // bottom bar or leaves the editor edges (same clamp as the action bar).
  screen?: { offsetX: number; offsetY: number; vLeft: number; vTop: number; vRight: number; vBottom: number },
): { left: number; top: number } {
  const px = active.x * scale;
  const py = active.y * scale;
  const pw = active.width * scale;
  const ph = active.height * scale;
  const centerX = px + pw / 2;
  const rects = others.map((o) => ({ x: o.x * scale, y: o.y * scale, w: o.width * scale, h: o.height * scale }));
  const clear = (l: number, t: number) =>
    !rects.some((r) => l < r.x + r.w && l + controlW > r.x && t < r.y + r.h && t + controlH > r.y);
  const PAD = 12;
  const inView = (l: number, t: number) => {
    if (!screen) return true;
    const sl = l + screen.offsetX;
    const st = t + screen.offsetY;
    return st >= screen.vTop + PAD
      && st + controlH <= screen.vBottom - PAD
      && sl >= screen.vLeft + PAD
      && sl + controlW <= screen.vRight - PAD;
  };
  const clampToView = (c: { left: number; top: number }) => {
    if (!screen) return c;
    const sl = Math.min(Math.max(c.left + screen.offsetX, screen.vLeft + PAD), screen.vRight - PAD - controlW);
    const st = Math.min(Math.max(c.top + screen.offsetY, screen.vTop + PAD), screen.vBottom - PAD - controlH);
    return { left: sl - screen.offsetX, top: st - screen.offsetY };
  };
  const candidates = [
    { left: centerX - controlW / 2, top: py + ph + gap },
    { left: centerX - controlW / 2, top: py - controlH - gap },
    { left: px + pw + gap, top: py },
    { left: px - controlW - gap, top: py },
  ];
  // 1) clear of the other pages AND inside the viewport
  for (const c of candidates) {
    if (clear(c.left, c.top) && inView(c.left, c.top)) return c;
  }
  // 2) clear of the other pages (clamped inside the viewport)
  for (const c of candidates) {
    if (clear(c.left, c.top)) return clampToView(c);
  }
  // 3) last resort: the bottom one, clamped
  return clampToView(candidates[0]);
}

// Keep the selection quick-action bar (duplicate/delete/move/rotate) fully on
// screen: it sits below the selection, but flips above when "below" would be
// clipped by the editor viewport — so it's never cut at the window edge.
function quickActionBarTop(
  bounds: { x: number; y: number; w: number; h: number },
  scale: number,
  artboardEl: HTMLElement | null,
  viewportEl: HTMLElement | null,
): number {
  const BAR_H = 52;
  const GAP = 22;
  const PAD = 10;
  const below = (bounds.y + bounds.h) * scale + GAP;
  const above = bounds.y * scale - GAP - BAR_H;
  const ab = artboardEl?.getBoundingClientRect();
  const vp = viewportEl?.getBoundingClientRect();
  if (!ab || !vp) return below;
  // Prefer below; flip above when below would be cut by the viewport bottom;
  // if neither side fits (selection ~fills the viewport) clamp the bar to the
  // viewport's bottom edge so it's NEVER cut. Values are artboard-relative
  // (screen = ab.top + value).
  const belowClips = ab.top + below + BAR_H > vp.bottom - PAD;
  if (!belowClips) return below;
  const aboveFits = ab.top + above >= vp.top + PAD;
  if (aboveFits) return above;
  return vp.bottom - PAD - BAR_H - ab.top;
}

type ZoomAnchorGeometry = {
  viewportCenterX: number;
  viewportCenterY: number;
  workspaceWidth: number;
  workspaceHeight: number;
  activePageOffsetX: number;
  activePageOffsetY: number;
  renderedScale: number;
};

const COMPASS_SNAP_STEP_DEG = 45;
const COMPASS_SNAP_THRESHOLD_DEG = 7.5;
const DOUBLE_PRESS_PAN_MAX_DELAY_MS = 340;
const DOUBLE_PRESS_PAN_MAX_DISTANCE_PX = 14;
const INLINE_TEXT_BLUR_GUARD_MS = 140;
const DOUBLE_CLICK_MENU_TOGGLE_DELAY_MS = 70;
const DOUBLE_CLICK_SUPPRESS_AFTER_PAN_MS = 420;
const WHEEL_LINE_HEIGHT_PX = 16;
const WHEEL_ZOOM_CHROME_SETTLE_MS = 140;
const WHEEL_ZOOM_SESSION_GAP_MS = 170;
const WHEEL_ZOOM_MOMENTUM_LOCK_MS = 240;
const INTERACTION_FAST_MODE_SETTLE_MS = 170;
const PINCH_MIN_DISTANCE_PX = 24;
const SELECTION_PRESS_DRAG_THRESHOLD_PX = 4;
const MOBILE_KEYBOARD_SAFE_MARGIN_PX = 18;
const PROJECT_PAGE_GAP_DOC = 220;
const PROJECT_PAGE_WORKSPACE_PADDING_DOC = 360;
const PROJECT_PAGE_WORKSPACE_BUCKET_DOC = 12000;
const CANVAS_INTERACTION_UI_SELECTOR = [
  ".dg-context-toolbar",
  ".dg-function-panel",
  ".dg-function-panel-layer",
  ".dg-function-panel-color",
  ".dg-function-panel-inline",
  ".dg-toolbar-color-popover",
  ".dg-toolbar-font-popover",
  ".dg-shape-radius-popover",
  ".dg-line-style-popover",
  ".dg-image-brush-popover",
  ".dg-image-duotone-popover",
  ".dg-color-rgb-menu",
  ".dg-color-picker-more-colors-menu",
  ".dg-color-picker-popover",
  ".dg-hud",
  ".dg-selection-quick-stack",
  ".dg-line-endpoint-handle",
  ".dg-path-point-handle",
  ".dg-canvas-page-label",
  ".dg-canvas-page-add",
  ".dg-canvas-pages-layout-switch",
  "[data-canvas-ui='true']",
  "[data-function-panel-trigger='true']",
  "button",
  "input",
  "textarea",
  "select",
  "[contenteditable='true']",
  "[role='button']",
].join(", ");
const CANVAS_WHEEL_BLOCKING_UI_SELECTOR = CANVAS_INTERACTION_UI_SELECTOR;
const CANVAS_VIEWPORT_STABILIZE_UI_SELECTOR = [
  ".dg-context-toolbar",
  ".dg-function-panel",
  ".dg-function-panel-layer",
  ".dg-bottom-toolbelt",
  ".dg-hud",
  ".dg-topbar",
  ".dg-floating-popover-layer",
  ".dg-status-popover",
  ".dg-rules-popover",
  ".dg-history-popover",
  ".dg-page-grid-modal",
  ".dg-modal-backdrop",
  ".dg-modal-panel",
  ".dg-canvas-page-add",
  "[data-canvas-ui='true']",
  "[data-function-panel-trigger='true']",
].join(", ");

function getEventElement(target: EventTarget | null): Element | null {
  if (typeof Element !== "undefined" && target instanceof Element) return target;
  if (typeof Node !== "undefined" && target instanceof Node) return target.parentElement;
  return null;
}

function isCanvasInteractionUiTarget(target: EventTarget | null): boolean {
  return !!getEventElement(target)?.closest(CANVAS_INTERACTION_UI_SELECTOR);
}

function isViewportStabilizingUiTarget(target: EventTarget | null): boolean {
  return !!getEventElement(target)?.closest(CANVAS_VIEWPORT_STABILIZE_UI_SELECTOR);
}

function normalizeUiZoomPercent(value: unknown, fallback = 100): number {
  const numeric = Number(value);
  return clampUiZoom(Number.isFinite(numeric) ? numeric : fallback);
}

function clientPointToRenderedDocPoint(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  docWidth: number,
  docHeight: number,
): Point2D {
  return {
    x: ((clientX - rect.left) / Math.max(1, rect.width)) * Math.max(1, docWidth),
    y: ((clientY - rect.top) / Math.max(1, rect.height)) * Math.max(1, docHeight),
  };
}

function panOffsetToTransform(offset: Point2D): string {
  const x = Number.isFinite(offset.x) ? Math.round(offset.x * 100) / 100 : 0;
  const y = Number.isFinite(offset.y) ? Math.round(offset.y * 100) / 100 : 0;
  return `translate3d(${x}px, ${y}px, 0)`;
}

function normalizeWheelDeltaToPixels(delta: number, deltaMode: number, pageSizePx: number): number {
  const value = Number(delta || 0);
  if (!Number.isFinite(value)) return 0;
  if (deltaMode === 1) return value * WHEEL_LINE_HEIGHT_PX;
  if (deltaMode === 2) return value * Math.max(1, pageSizePx);
  return value;
}

function isLikelyTrackpadWheel(event: WheelEvent, deltaX: number, deltaY: number): boolean {
  if (event.deltaMode !== 0) return false;
  const absX = Math.abs(deltaX);
  const absY = Math.abs(deltaY);
  if (absX > 0.01 && absY > 0.01) return true;
  if (absX > 0.01 && absX < 18) return true;
  if (absY > 0.01 && absY < 18) return true;
  return false;
}

function safePageDimension(value: unknown, fallback: number): number {
  const next = Math.round(Number(value || fallback || 1));
  return Number.isFinite(next) && next > 0 ? next : Math.max(1, Math.round(Number(fallback || 1)));
}

function normalizeCanvasProjectPagePosition(value: unknown): CanvasProjectPagePosition | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Record<string, unknown>;
  const x = Number(entry.x);
  const y = Number(entry.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return {
    x: Math.round(x),
    y: Math.round(y),
  };
}

function normalizeCanvasProjectPages(
  pages: CanvasProjectPageView[] | null | undefined,
  activePageId: string | null | undefined,
  canvasWidth: number,
  canvasHeight: number,
  artboardFill: unknown,
): { pages: CanvasProjectPageView[]; activePageId: string } {
  const normalized = (Array.isArray(pages) ? pages : [])
    .map((page, index) => ({
      id: String(page?.id || "").trim() || `page-${index + 1}`,
      name: String(page?.name || "").trim().replace(/^P[a\u00e1]gina(?= \d+$)/, "Page") || `Page ${index + 1}`,
      doc: page?.doc,
      position: normalizeCanvasProjectPagePosition(page?.position),
    }))
    .filter((page) => (
      !!page.doc
      && !!page.doc.canvas
      && Array.isArray(page.doc.nodes)
    ));

  if (normalized.length) {
    const activeId = String(activePageId || "").trim();
    return {
      pages: normalized,
      activePageId: normalized.some((page) => page.id === activeId) ? activeId : normalized[0].id,
    };
  }

  const fallbackDoc = {
    version: 1,
    canvas: {
      width: Math.max(1, Math.round(Number(canvasWidth || 1))),
      height: Math.max(1, Math.round(Number(canvasHeight || 1))),
      background: artboardFill || "#ffffff",
    },
    root_id: "__active_page_root__",
    nodes: [],
    bindings: {
      text: {},
      images_single: {},
      images_array: {},
    },
    dynamic_rules: [],
    metadata: {},
  } as PinselaTemplateDocV1;
  const fallbackId = String(activePageId || "").trim() || "__active_page__";
  return {
    pages: [{
      id: fallbackId,
      name: "Current page",
      doc: fallbackDoc,
      position: {
        x: -Math.max(1, Math.round(Number(canvasWidth || 1))) / 2,
        y: -Math.max(1, Math.round(Number(canvasHeight || 1))) / 2,
      },
    }],
    activePageId: fallbackId,
  };
}

function buildCanvasProjectPagesGeometry(
  pages: CanvasProjectPageView[],
  activePageId: string,
  layout: CanvasProjectPagesLayout,
  canvasWidth: number,
  canvasHeight: number,
): CanvasProjectPagesGeometry {
  const pageSizes: Array<{
    page: CanvasProjectPageView;
    worldX: number;
    worldY: number;
    width: number;
    height: number;
  }> = [];
  let fallbackX = 0;
  let fallbackY = 0;
  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index];
    const width = safePageDimension(page.doc?.canvas?.width, canvasWidth);
    const height = safePageDimension(page.doc?.canvas?.height, canvasHeight);
    const explicitPosition = normalizeCanvasProjectPagePosition(page.position);
    let worldX: number;
    let worldY: number;
    if (explicitPosition) {
      worldX = explicitPosition.x;
      worldY = explicitPosition.y;
    } else if (layout === "row") {
      worldX = index === 0 ? -width / 2 : fallbackX;
      worldY = -height / 2;
    } else {
      worldX = -width / 2;
      worldY = index === 0 ? -height / 2 : fallbackY;
    }
    pageSizes.push({ page, worldX, worldY, width, height });
    if (layout === "row") {
      fallbackX = worldX + width + PROJECT_PAGE_GAP_DOC;
    } else {
      fallbackY = worldY + height + PROJECT_PAGE_GAP_DOC;
    }
  }

  const minWorldX = Math.min(
    ...pageSizes.map((entry) => entry.worldX),
    -Math.max(1, canvasWidth) / 2,
  );
  const maxWorldX = Math.max(
    ...pageSizes.map((entry) => entry.worldX + entry.width),
    Math.max(1, canvasWidth) / 2,
  );
  const minWorldY = Math.min(
    ...pageSizes.map((entry) => entry.worldY),
    -Math.max(1, canvasHeight) / 2,
  );
  const maxWorldY = Math.max(
    ...pageSizes.map((entry) => entry.worldY + entry.height),
    Math.max(1, canvasHeight) / 2,
  );
  const rawHalfWidth = Math.max(
    Math.abs(minWorldX),
    Math.abs(maxWorldX),
    Math.max(1, canvasWidth) / 2,
  ) + PROJECT_PAGE_WORKSPACE_PADDING_DOC;
  const rawHalfHeight = Math.max(
    Math.abs(minWorldY),
    Math.abs(maxWorldY),
    Math.max(1, canvasHeight) / 2,
  ) + PROJECT_PAGE_WORKSPACE_PADDING_DOC;
  const halfWidth = Math.max(
    PROJECT_PAGE_WORKSPACE_BUCKET_DOC,
    Math.ceil(rawHalfWidth / PROJECT_PAGE_WORKSPACE_BUCKET_DOC) * PROJECT_PAGE_WORKSPACE_BUCKET_DOC,
  );
  const halfHeight = Math.max(
    PROJECT_PAGE_WORKSPACE_BUCKET_DOC,
    Math.ceil(rawHalfHeight / PROJECT_PAGE_WORKSPACE_BUCKET_DOC) * PROJECT_PAGE_WORKSPACE_BUCKET_DOC,
  );
  const workspaceCenterX = Math.max(1, halfWidth);
  const workspaceCenterY = Math.max(1, halfHeight);
  const placements: CanvasProjectPagePlacement[] = pageSizes.map((entry) => ({
    page: entry.page,
    x: workspaceCenterX + entry.worldX,
    y: workspaceCenterY + entry.worldY,
    worldX: entry.worldX,
    worldY: entry.worldY,
    width: entry.width,
    height: entry.height,
    active: entry.page.id === activePageId,
  }));

  const maxX = Math.max(1, workspaceCenterX * 2);
  const maxY = Math.max(1, workspaceCenterY * 2);
  const active = placements.find((entry) => entry.active) || placements[0];
  return {
    placements,
    width: maxX,
    height: maxY,
    activeCenterX: active ? active.x + active.width / 2 : maxX / 2,
    activeCenterY: active ? active.y + active.height / 2 : maxY / 2,
  };
}

function interactionGuideTone(source: GuideLine["source"]): {
  line: string;
  glow: string;
  labelBg: string;
  labelText: string;
  dash?: string;
} {
  if (source === "page") {
    return {
      line: "rgba(41, 121, 255, 0.96)",
      glow: "rgba(41, 121, 255, 0.22)",
      labelBg: "rgba(15, 23, 42, 0.86)",
      labelText: "rgba(248, 250, 252, 0.96)",
    };
  }
  if (source === "grid") {
    return {
      line: "rgba(198, 137, 50, 0.96)",
      glow: "rgba(198, 137, 50, 0.22)",
      labelBg: "rgba(120, 53, 15, 0.88)",
      labelText: "rgba(255, 247, 237, 0.96)",
      dash: "5 5",
    };
  }
  return {
    line: "rgba(37, 99, 235, 0.96)",
    glow: "rgba(37, 99, 235, 0.22)",
    labelBg: "rgba(37, 99, 235, 0.9)",
    labelText: "rgba(255, 255, 255, 0.98)",
  };
}

function areGuideListsEqual(a: GuideLine[], b: GuideLine[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index];
    const right = b[index];
    if (
      left.axis !== right.axis
      || left.source !== right.source
      || Math.abs(Number(left.value || 0) - Number(right.value || 0)) > 0.001
    ) {
      return false;
    }
  }
  return true;
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function interactionGuideLabel(
  guide: GuideLine,
  canvasWidth: number,
  canvasHeight: number,
): string {
  if (guide.source === "grid") return "GRID";
  if (guide.source === "object") return "OBJECT";
  const value = Number(guide.value || 0);
  const halfWidth = Number(canvasWidth || 0) / 2;
  const halfHeight = Number(canvasHeight || 0) / 2;
  if (
    (guide.axis === "x" && Math.abs(value - halfWidth) <= 0.5)
    || (guide.axis === "y" && Math.abs(value - halfHeight) <= 0.5)
  ) {
    return "CENTER";
  }
  if (guide.axis === "x") {
    return Math.abs(value) <= 0.5 || Math.abs(value - Number(canvasWidth || 0)) <= 0.5 ? "EDGE" : "PAGE";
  }
  return Math.abs(value) <= 0.5 || Math.abs(value - Number(canvasHeight || 0)) <= 0.5 ? "EDGE" : "PAGE";
}

function normalizeAngle180(angleDeg: number): number {
  let angle = Number(angleDeg || 0);
  while (angle > 180) angle -= 360;
  while (angle < -180) angle += 360;
  return angle;
}

function snapAngleToCompass(
  rawAngleDeg: number,
  options?: { force?: boolean; thresholdDeg?: number; stepDeg?: number },
): number {
  const stepDeg = Math.max(1, Number(options?.stepDeg || COMPASS_SNAP_STEP_DEG));
  const thresholdDeg = Math.max(0, Number(options?.thresholdDeg ?? COMPASS_SNAP_THRESHOLD_DEG));
  const force = !!options?.force;
  const target = Math.round(rawAngleDeg / stepDeg) * stepDeg;
  const distance = Math.abs(normalizeAngle180(rawAngleDeg - target));
  if (!force && distance > thresholdDeg) return rawAngleDeg;
  return target;
}

function snapRotationDeltaToCompass(
  rawDeltaDeg: number,
  startRotationDeg: number,
  options?: { enabled?: boolean; force?: boolean; thresholdDeg?: number; stepDeg?: number },
): number {
  const enabled = !!options?.enabled;
  const force = !!options?.force;
  if (!enabled && !force) return rawDeltaDeg;
  const rawAbsolute = Number(startRotationDeg || 0) + rawDeltaDeg;
  const snappedAbsolute = snapAngleToCompass(rawAbsolute, options);
  return snappedAbsolute - Number(startRotationDeg || 0);
}

function snapPointToCompass(
  anchor: Point2D,
  point: Point2D,
  options?: { enabled?: boolean; force?: boolean; thresholdDeg?: number; stepDeg?: number },
): Point2D {
  const enabled = !!options?.enabled;
  const force = !!options?.force;
  if (!enabled && !force) return point;
  const dx = point.x - anchor.x;
  const dy = point.y - anchor.y;
  const length = Math.hypot(dx, dy);
  if (length <= 0.0001) return point;
  const rawAngleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
  const snappedAngleDeg = snapAngleToCompass(rawAngleDeg, options);
  if (Math.abs(normalizeAngle180(snappedAngleDeg - rawAngleDeg)) <= 0.0001) return point;
  const rad = (snappedAngleDeg * Math.PI) / 180;
  return {
    x: anchor.x + Math.cos(rad) * length,
    y: anchor.y + Math.sin(rad) * length,
  };
}

function clampResizeBounds(
  startBounds: RectBounds,
  handle: ResizeHandle,
  nextEdges: { left: number; right: number; top: number; bottom: number },
  fromCenter: boolean,
  minSize: number,
): RectBounds {
  const left0 = Number(startBounds.x || 0);
  const top0 = Number(startBounds.y || 0);
  const right0 = left0 + Number(startBounds.w || 0);
  const bottom0 = top0 + Number(startBounds.h || 0);
  const hasHorizontalHandle = handle.includes("l") || handle.includes("r");
  const hasVerticalHandle = handle.includes("t") || handle.includes("b");
  let { left, right, top, bottom } = nextEdges;

  if (!hasHorizontalHandle) {
    left = left0;
    right = right0;
  } else if (right - left < minSize) {
    if (fromCenter) {
      const cx = (left0 + right0) / 2;
      left = cx - minSize / 2;
      right = cx + minSize / 2;
    } else if (handle.includes("l")) {
      left = right0 - minSize;
      right = right0;
    } else {
      left = left0;
      right = left0 + minSize;
    }
  }

  if (!hasVerticalHandle) {
    top = top0;
    bottom = bottom0;
  } else if (bottom - top < minSize) {
    if (fromCenter) {
      const cy = (top0 + bottom0) / 2;
      top = cy - minSize / 2;
      bottom = cy + minSize / 2;
    } else if (handle.includes("t")) {
      top = bottom0 - minSize;
      bottom = bottom0;
    } else {
      top = top0;
      bottom = top0 + minSize;
    }
  }

  const x = Math.round(left);
  const y = Math.round(top);
  const w = Math.max(minSize, Math.round(right - left));
  const h = Math.max(minSize, Math.round(bottom - top));
  return { x, y, w, h };
}

function calculateResizeBounds(
  startBounds: RectBounds,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  fromCenter: boolean,
  minSize = 4,
): RectBounds {
  const left0 = Number(startBounds.x || 0);
  const top0 = Number(startBounds.y || 0);
  const right0 = left0 + Number(startBounds.w || 0);
  const bottom0 = top0 + Number(startBounds.h || 0);
  let left = left0;
  let right = right0;
  let top = top0;
  let bottom = bottom0;

  if (handle.includes("l")) {
    left = left0 + dx;
    if (fromCenter) right = right0 - dx;
  } else if (handle.includes("r")) {
    right = right0 + dx;
    if (fromCenter) left = left0 - dx;
  }

  if (handle.includes("t")) {
    top = top0 + dy;
    if (fromCenter) bottom = bottom0 - dy;
  } else if (handle.includes("b")) {
    bottom = bottom0 + dy;
    if (fromCenter) top = top0 - dy;
  }

  return clampResizeBounds(startBounds, handle, { left, right, top, bottom }, fromCenter, minSize);
}

function isCornerResizeHandle(handle: ResizeHandle): boolean {
  return handle === "tl" || handle === "tr" || handle === "bl" || handle === "br";
}

function calculateAspectLockedResizeBounds(
  startBounds: RectBounds,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  fromCenter: boolean,
  minSize = 4,
): RectBounds {
  const startW = Math.max(minSize, Number(startBounds.w || 0));
  const startH = Math.max(minSize, Number(startBounds.h || 0));
  const left0 = Number(startBounds.x || 0);
  const top0 = Number(startBounds.y || 0);
  const right0 = left0 + startW;
  const bottom0 = top0 + startH;

  const minScale = Math.max(minSize / startW, minSize / startH);
  let scaleByX = 1;
  let scaleByY = 1;

  if (fromCenter) {
    const startCornerX = handle.includes("l") ? -startW / 2 : startW / 2;
    const startCornerY = handle.includes("t") ? -startH / 2 : startH / 2;
    const desiredW = Math.abs(startCornerX + dx) * 2;
    const desiredH = Math.abs(startCornerY + dy) * 2;
    scaleByX = desiredW / startW;
    scaleByY = desiredH / startH;
  } else {
    const desiredW = Math.abs(startW + (handle.includes("l") ? -dx : dx));
    const desiredH = Math.abs(startH + (handle.includes("t") ? -dy : dy));
    scaleByX = desiredW / startW;
    scaleByY = desiredH / startH;
  }

  const dominantScale = Math.abs(scaleByX - 1) >= Math.abs(scaleByY - 1) ? scaleByX : scaleByY;
  const scale = Math.max(minScale, Number.isFinite(dominantScale) ? dominantScale : 1);
  const nextW = Math.max(minSize, Math.round(startW * scale));
  const nextH = Math.max(minSize, Math.round(startH * scale));

  if (fromCenter) {
    const cx = (left0 + right0) / 2;
    const cy = (top0 + bottom0) / 2;
    return {
      x: Math.round(cx - nextW / 2),
      y: Math.round(cy - nextH / 2),
      w: nextW,
      h: nextH,
    };
  }

  const anchorX = handle.includes("l") ? right0 : left0;
  const anchorY = handle.includes("t") ? bottom0 : top0;
  return {
    x: Math.round(handle.includes("l") ? anchorX - nextW : anchorX),
    y: Math.round(handle.includes("t") ? anchorY - nextH : anchorY),
    w: nextW,
    h: nextH,
  };
}

function nearestSnapTarget(value: number, targets: number[], tolerance: number): SnapPick | null {
  let best: SnapPick | null = null;
  for (const target of targets) {
    const delta = Math.abs(value - target);
    if (delta > tolerance) continue;
    if (!best || delta < best.delta) {
      best = { target, delta };
    }
  }
  return best;
}

function snapResizeBoundsToArtboard(
  startBounds: RectBounds,
  handle: ResizeHandle,
  nextBounds: RectBounds,
  canvasBounds: { width: number; height: number },
  tolerance: number,
  fromCenter: boolean,
  minSize = 4,
): RectBounds {
  if (fromCenter) {
    const centerX = Number(startBounds.x || 0) + Number(startBounds.w || 0) / 2;
    const centerY = Number(startBounds.y || 0) + Number(startBounds.h || 0) / 2;
    let left = Number(nextBounds.x || 0);
    let top = Number(nextBounds.y || 0);
    let right = left + Number(nextBounds.w || 0);
    let bottom = top + Number(nextBounds.h || 0);

    if (handle.includes("l") || handle.includes("r")) {
      const candidates: Array<{ halfSize: number; delta: number }> = [];
      const leftSnap = nearestSnapTarget(left, [0], tolerance);
      if (leftSnap) {
        const halfWidth = centerX - leftSnap.target;
        if (halfWidth >= minSize / 2) candidates.push({ halfSize: halfWidth, delta: leftSnap.delta });
      }
      const rightSnap = nearestSnapTarget(right, [canvasBounds.width], tolerance);
      if (rightSnap) {
        const halfWidth = rightSnap.target - centerX;
        if (halfWidth >= minSize / 2) candidates.push({ halfSize: halfWidth, delta: rightSnap.delta });
      }
      if (candidates.length) {
        const best = candidates.sort((a, b) => a.delta - b.delta)[0];
        left = centerX - best.halfSize;
        right = centerX + best.halfSize;
      }
    }

    if (handle.includes("t") || handle.includes("b")) {
      const candidates: Array<{ halfSize: number; delta: number }> = [];
      const topSnap = nearestSnapTarget(top, [0], tolerance);
      if (topSnap) {
        const halfHeight = centerY - topSnap.target;
        if (halfHeight >= minSize / 2) candidates.push({ halfSize: halfHeight, delta: topSnap.delta });
      }
      const bottomSnap = nearestSnapTarget(bottom, [canvasBounds.height], tolerance);
      if (bottomSnap) {
        const halfHeight = bottomSnap.target - centerY;
        if (halfHeight >= minSize / 2) candidates.push({ halfSize: halfHeight, delta: bottomSnap.delta });
      }
      if (candidates.length) {
        const best = candidates.sort((a, b) => a.delta - b.delta)[0];
        top = centerY - best.halfSize;
        bottom = centerY + best.halfSize;
      }
    }

    return clampResizeBounds(startBounds, handle, { left, right, top, bottom }, fromCenter, minSize);
  }
  let left = Number(nextBounds.x || 0);
  let top = Number(nextBounds.y || 0);
  let right = left + Number(nextBounds.w || 0);
  let bottom = top + Number(nextBounds.h || 0);

  if (handle.includes("l")) {
    const snap = nearestSnapTarget(left, [0], tolerance);
    if (snap) left = snap.target;
  } else if (handle.includes("r")) {
    const snap = nearestSnapTarget(right, [canvasBounds.width], tolerance);
    if (snap) right = snap.target;
  }

  if (handle.includes("t")) {
    const snap = nearestSnapTarget(top, [0], tolerance);
    if (snap) top = snap.target;
  } else if (handle.includes("b")) {
    const snap = nearestSnapTarget(bottom, [canvasBounds.height], tolerance);
    if (snap) bottom = snap.target;
  }

  return clampResizeBounds(startBounds, handle, { left, right, top, bottom }, fromCenter, minSize);
}

function snapAspectLockedResizeBoundsToArtboard(
  startBounds: RectBounds,
  handle: ResizeHandle,
  nextBounds: RectBounds,
  canvasBounds: { width: number; height: number },
  tolerance: number,
  fromCenter: boolean,
  minSize = 4,
): RectBounds {
  if (fromCenter) {
    if (!isCornerResizeHandle(handle)) return nextBounds;
    const startW = Math.max(minSize, Number(startBounds.w || 0));
    const startH = Math.max(minSize, Number(startBounds.h || 0));
    const centerX = Number(startBounds.x || 0) + startW / 2;
    const centerY = Number(startBounds.y || 0) + startH / 2;
    const currentLeft = Number(nextBounds.x || 0);
    const currentTop = Number(nextBounds.y || 0);
    const currentRight = currentLeft + Number(nextBounds.w || 0);
    const currentBottom = currentTop + Number(nextBounds.h || 0);
    const candidates: Array<{ scale: number; delta: number }> = [];

    const leftSnap = nearestSnapTarget(currentLeft, [0], tolerance);
    if (leftSnap) {
      const desiredWidth = (centerX - leftSnap.target) * 2;
      if (desiredWidth > 0) candidates.push({ scale: desiredWidth / startW, delta: leftSnap.delta });
    }

    const rightSnap = nearestSnapTarget(currentRight, [canvasBounds.width], tolerance);
    if (rightSnap) {
      const desiredWidth = (rightSnap.target - centerX) * 2;
      if (desiredWidth > 0) candidates.push({ scale: desiredWidth / startW, delta: rightSnap.delta });
    }

    const topSnap = nearestSnapTarget(currentTop, [0], tolerance);
    if (topSnap) {
      const desiredHeight = (centerY - topSnap.target) * 2;
      if (desiredHeight > 0) candidates.push({ scale: desiredHeight / startH, delta: topSnap.delta });
    }

    const bottomSnap = nearestSnapTarget(currentBottom, [canvasBounds.height], tolerance);
    if (bottomSnap) {
      const desiredHeight = (bottomSnap.target - centerY) * 2;
      if (desiredHeight > 0) candidates.push({ scale: desiredHeight / startH, delta: bottomSnap.delta });
    }

    if (!candidates.length) return nextBounds;
    const best = candidates.sort((a, b) => a.delta - b.delta)[0];
    const minScale = Math.max(minSize / startW, minSize / startH);
    const scale = Math.max(minScale, Number.isFinite(best.scale) ? best.scale : 1);
    const nextW = Math.max(minSize, Math.round(startW * scale));
    const nextH = Math.max(minSize, Math.round(startH * scale));
    return {
      x: Math.round(centerX - nextW / 2),
      y: Math.round(centerY - nextH / 2),
      w: nextW,
      h: nextH,
    };
  }
  if (!isCornerResizeHandle(handle)) return nextBounds;

  const startW = Math.max(minSize, Number(startBounds.w || 0));
  const startH = Math.max(minSize, Number(startBounds.h || 0));
  const left0 = Number(startBounds.x || 0);
  const top0 = Number(startBounds.y || 0);
  const right0 = left0 + startW;
  const bottom0 = top0 + startH;
  const anchorX = handle.includes("l") ? right0 : left0;
  const anchorY = handle.includes("t") ? bottom0 : top0;

  const currentLeft = Number(nextBounds.x || 0);
  const currentTop = Number(nextBounds.y || 0);
  const currentRight = currentLeft + Number(nextBounds.w || 0);
  const currentBottom = currentTop + Number(nextBounds.h || 0);
  const candidates: Array<{ scale: number; delta: number }> = [];

  if (handle.includes("l")) {
    const snap = nearestSnapTarget(currentLeft, [0], tolerance);
    if (snap) {
      const desiredW = anchorX - snap.target;
      if (desiredW > 0) candidates.push({ scale: desiredW / startW, delta: snap.delta });
    }
  } else if (handle.includes("r")) {
    const snap = nearestSnapTarget(currentRight, [canvasBounds.width], tolerance);
    if (snap) {
      const desiredW = snap.target - anchorX;
      if (desiredW > 0) candidates.push({ scale: desiredW / startW, delta: snap.delta });
    }
  }

  if (handle.includes("t")) {
    const snap = nearestSnapTarget(currentTop, [0], tolerance);
    if (snap) {
      const desiredH = anchorY - snap.target;
      if (desiredH > 0) candidates.push({ scale: desiredH / startH, delta: snap.delta });
    }
  } else if (handle.includes("b")) {
    const snap = nearestSnapTarget(currentBottom, [canvasBounds.height], tolerance);
    if (snap) {
      const desiredH = snap.target - anchorY;
      if (desiredH > 0) candidates.push({ scale: desiredH / startH, delta: snap.delta });
    }
  }

  if (!candidates.length) return nextBounds;
  const best = candidates.sort((a, b) => a.delta - b.delta)[0];
  const minScale = Math.max(minSize / startW, minSize / startH);
  const scale = Math.max(minScale, Number.isFinite(best.scale) ? best.scale : 1);
  const nextW = Math.max(minSize, Math.round(startW * scale));
  const nextH = Math.max(minSize, Math.round(startH * scale));
  return {
    x: Math.round(handle.includes("l") ? anchorX - nextW : anchorX),
    y: Math.round(handle.includes("t") ? anchorY - nextH : anchorY),
    w: nextW,
    h: nextH,
  };
}

const IMAGE_URL_EXT_RE = /\.(png|jpe?g|webp|gif|bmp|svg|avif|tiff?)(?:[?#].*)?$/i;

function isLikelyImageUrl(value: string): boolean {
  const raw = String(value || "").trim();
  if (!raw) return false;
  if (raw.startsWith("data:image/")) return true;
  if (raw.startsWith("blob:")) return true;
  return IMAGE_URL_EXT_RE.test(raw);
}

function extractDroppedImageUrls(dataTransfer: DataTransfer | null): string[] {
  if (!dataTransfer) return [];
  const candidates = new Set<string>();
  const uriList = String(dataTransfer.getData("text/uri-list") || "");
  if (uriList) {
    uriList
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .forEach((line) => candidates.add(line));
  }
  const plain = String(dataTransfer.getData("text/plain") || "").trim();
  if (plain) candidates.add(plain);
  const html = String(dataTransfer.getData("text/html") || "");
  if (html) {
    const re = /<img[^>]+src=["']([^"']+)["']/gi;
    let match: RegExpExecArray | null = re.exec(html);
    while (match) {
      const src = String(match[1] || "").trim();
      if (src) candidates.add(src);
      match = re.exec(html);
    }
  }
  return Array.from(candidates).filter((url) => isLikelyImageUrl(url));
}

function hasExternalImagePayload(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  const files = dataTransfer.files;
  if (files && files.length > 0) {
    const hasImageFile = Array.from(files).some((file) => {
      const type = String(file.type || "").toLowerCase();
      if (type.startsWith("image/")) return true;
      return /\.(png|jpe?g|webp|gif|bmp|svg|avif|tiff?)$/i.test(String(file.name || ""));
    });
    if (hasImageFile) return true;
  }
  return extractDroppedImageUrls(dataTransfer).length > 0;
}

type PathHandleKind = "anchor" | "in" | "out";

function hasDistinctPathHandle(
  anchor: { x: number; y: number },
  handle?: { x: number; y: number } | null,
): handle is { x: number; y: number } {
  if (!handle) return false;
  return Math.abs(Number(handle.x || 0) - Number(anchor.x || 0)) > 0.0001
    || Math.abs(Number(handle.y || 0) - Number(anchor.y || 0)) > 0.0001;
}

function pathEditOverlayPathD(
  points: CanvasPathEditPoint[],
  closed: boolean,
): string {
  if (!Array.isArray(points) || points.length < 2) return "";
  const fmt = (value: number) => (Math.round(Number(value || 0) * 100) / 100).toString();
  const lineOrCubic = (from: CanvasPathEditPoint, to: CanvasPathEditPoint) => {
    const fromAnchor = from.anchor;
    const toAnchor = to.anchor;
    const cp1 = hasDistinctPathHandle(fromAnchor, from.out) ? from.out : null;
    const cp2 = hasDistinctPathHandle(toAnchor, to.in) ? to.in : null;
    if (!cp1 && !cp2) {
      return `L ${fmt(toAnchor.x)} ${fmt(toAnchor.y)}`;
    }
    const c1 = cp1 || fromAnchor;
    const c2 = cp2 || toAnchor;
    return `C ${fmt(c1.x)} ${fmt(c1.y)} ${fmt(c2.x)} ${fmt(c2.y)} ${fmt(toAnchor.x)} ${fmt(toAnchor.y)}`;
  };

  const head = points[0];
  const chunks: string[] = [`M ${fmt(head.anchor.x)} ${fmt(head.anchor.y)}`];
  for (let idx = 1; idx < points.length; idx += 1) {
    chunks.push(lineOrCubic(points[idx - 1], points[idx]));
  }
  if (closed && points.length >= 3) {
    chunks.push(lineOrCubic(points[points.length - 1], points[0]));
    chunks.push("Z");
  }
  return chunks.join(" ");
}

export interface ResizeSelectionGestureEvent {
  phase: "start" | "move" | "end";
  handle: ResizeHandle;
  originalBounds: { x: number; y: number; w: number; h: number };
  nextBounds?: { x: number; y: number; w: number; h: number };
}

export interface TranslateSelectionGestureEvent {
  phase: "start" | "move" | "end";
  dx?: number;
  dy?: number;
  altKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  selectionIds?: string[];
  baseDoc?: PinselaTemplateDocV1;
  pageTransfer?: {
    targetPageId: string;
    dx: number;
    dy: number;
  } | null;
}

export interface RotateSelectionGestureEvent {
  phase: "start" | "move" | "end";
  deltaDeg?: number;
}

export interface LineEndpointGestureEvent {
  phase: "start" | "move" | "end";
  endpoint: "start" | "end";
  nextGeometry?: Partial<{ x: number; y: number; width: number; height: number; rotation: number }>;
}

export interface PathPointGestureEvent {
  phase: "start" | "move" | "end";
  pointIndex: number;
  pointKind: PathHandleKind;
  point?: { x: number; y: number };
}

export interface CanvasPathEditPoint {
  index: number;
  anchor: { x: number; y: number };
  in?: { x: number; y: number } | null;
  out?: { x: number; y: number } | null;
  mode?: "corner" | "smooth";
}

export interface CanvasPathEditData {
  closed: boolean;
  selectedIndex: number | null;
  points: CanvasPathEditPoint[];
}

export interface ImageBrushGestureEvent {
  phase: "start" | "move" | "end";
  pointerId: number;
  point?: { x: number; y: number };
}

export interface SelectionChromeClickEvent {
  point: { x: number; y: number };
  shiftKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
}

export type SelectionQuickActionId = "duplicate" | "delete" | "rotate_cw_15";

const CanvasProjectPagePreview = React.memo(function CanvasProjectPagePreview({
  doc,
  widthPx,
  heightPx,
  imageCacheRef,
}: {
  doc: PinselaTemplateDocV1;
  widthPx: number;
  heightPx: number;
  imageCacheRef?: React.MutableRefObject<Map<string, HTMLImageElement>>;
}) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageLoadPromisesRef = useRef<Map<string, Promise<HTMLImageElement | null>>>(new Map());
  const previewSizeRef = useRef({ widthPx, heightPx });
  const assetRevisionFrameRef = useRef<number | null>(null);
  const [nearViewport, setNearViewport] = useState(false);
  const [assetRevision, setAssetRevision] = useState(0);

  const queueAssetRevision = useCallback(() => {
    if (assetRevisionFrameRef.current != null) return;
    assetRevisionFrameRef.current = window.requestAnimationFrame(() => {
      assetRevisionFrameRef.current = null;
      setAssetRevision((current) => current + 1);
    });
  }, []);

  const applyPreviewCanvasCssSize = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const size = previewSizeRef.current;
    canvas.style.width = `${Math.max(1, size.widthPx)}px`;
    canvas.style.height = `${Math.max(1, size.heightPx)}px`;
  }, []);

  useEffect(() => {
    const element = wrapperRef.current;
    if (!element) return;
    if (typeof IntersectionObserver === "undefined") {
      setNearViewport(true);
      return;
    }
    let observer: IntersectionObserver | null = null;
    observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNearViewport(true);
          observer?.disconnect();
          observer = null;
        }
      },
      { root: null, rootMargin: "900px" },
    );
    observer.observe(element);
    return () => observer?.disconnect();
  }, []);

  useEffect(() => () => {
    if (assetRevisionFrameRef.current != null) {
      window.cancelAnimationFrame(assetRevisionFrameRef.current);
      assetRevisionFrameRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!nearViewport || !imageCacheRef) return;
    let disposed = false;
    const cache = imageCacheRef.current;
    collectDocImageSources(doc).forEach((src) => {
      if (cache.has(src) || imageLoadPromisesRef.current.has(src)) return;
      const pending = preloadCanvasImage(src, cache)
        .then((image) => {
          if (image && !disposed) queueAssetRevision();
          return image;
        })
        .finally(() => {
          imageLoadPromisesRef.current.delete(src);
        });
      imageLoadPromisesRef.current.set(src, pending);
    });
    return () => {
      disposed = true;
    };
  }, [doc, imageCacheRef, nearViewport, queueAssetRevision]);

  useEffect(() => {
    previewSizeRef.current = { widthPx, heightPx };
    applyPreviewCanvasCssSize();
  }, [applyPreviewCanvasCssSize, heightPx, widthPx]);

  useEffect(() => {
    if (!nearViewport) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    let idleHandle: number | null = null;
    let frameHandle: number | null = null;
    const runDraw = () => {
      if (disposed) return;
      void drawDocToCanvas(doc, canvas, {
        pixelRatio: 1,
        imageCache: imageCacheRef?.current,
        backgroundMode: "as-is",
      }).then(() => {
        if (disposed) return;
        applyPreviewCanvasCssSize();
      });
    };
    const scheduler = window as Window & {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    if (typeof scheduler.requestIdleCallback === "function") {
      idleHandle = scheduler.requestIdleCallback(runDraw, { timeout: 260 });
    } else {
      frameHandle = window.requestAnimationFrame(runDraw);
    }
    return () => {
      disposed = true;
      if (idleHandle != null && typeof scheduler.cancelIdleCallback === "function") {
        scheduler.cancelIdleCallback(idleHandle);
      }
      if (frameHandle != null) {
        window.cancelAnimationFrame(frameHandle);
      }
    };
  }, [applyPreviewCanvasCssSize, assetRevision, doc, imageCacheRef, nearViewport]);

  return (
    <div
      ref={wrapperRef}
      className="dg-canvas-page-preview-shell"
      style={{
        width: Math.max(1, widthPx),
        height: Math.max(1, heightPx),
      }}
    >
      {nearViewport ? (
        <canvas
          ref={canvasRef}
          className="dg-canvas-page-preview-canvas"
          aria-hidden="true"
          style={{
            width: Math.max(1, widthPx),
            height: Math.max(1, heightPx),
          }}
        />
      ) : (
        <div className="dg-canvas-page-preview-placeholder" aria-hidden="true" />
      )}
    </div>
  );
}, (prev, next) => (
  prev.doc === next.doc
  && prev.imageCacheRef === next.imageCacheRef
  && Math.abs(prev.widthPx - next.widthPx) <= 0.1
  && Math.abs(prev.heightPx - next.heightPx) <= 0.1
));

function CanvasProjectPageChrome({
  page,
  index,
  active,
  widthPx,
  heightPx,
  onBeforePageAction,
  onSelectPage,
  onCreateAdjacentPage,
  onMovePagePointerDown,
}: {
  page: CanvasProjectPageView;
  index: number;
  active: boolean;
  widthPx: number;
  heightPx: number;
  onBeforePageAction?: () => void;
  onSelectPage?: (pageId: string) => void;
  onCreateAdjacentPage?: (pageId: string, placement: "right" | "below") => void;
  onMovePagePointerDown?: (event: React.PointerEvent<HTMLDivElement>) => void;
}) {
  const name = String(page.name || "").trim().replace(/^P[a\u00e1]gina(?= \d+$)/, "Page") || `Page ${index + 1}`;
  const stop = (event: React.SyntheticEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };
  const selectInactivePage = (event: React.SyntheticEvent) => {
    if (active) return;
    event.preventDefault();
    event.stopPropagation();
    onBeforePageAction?.();
    onSelectPage?.(page.id);
  };

  return (
    <>
      <div
        className={`dg-canvas-page-label ${active ? "is-active" : "is-page-switcher"} ${onMovePagePointerDown ? "is-page-movable" : ""}`}
        role={active ? undefined : "button"}
        tabIndex={active ? undefined : 0}
        aria-label={active ? `Move ${name}` : `Open or move ${name}`}
        title={active ? `Drag ${name}` : `Open or drag ${name}`}
        onPointerDown={(event) => {
          if (onMovePagePointerDown && event.button === 0) {
            onMovePagePointerDown(event);
            return;
          }
          if (active) return;
          event.preventDefault();
          event.stopPropagation();
          onBeforePageAction?.();
        }}
        onClick={selectInactivePage}
        onKeyDown={(event) => {
          if (active) return;
          if (event.key !== "Enter" && event.key !== " ") return;
          selectInactivePage(event);
        }}
      >
        <span>{String(index + 1).padStart(2, "0")}</span>
        <strong>{name}</strong>
        {active ? <em>active</em> : null}
      </div>
      {onCreateAdjacentPage ? (
        <>
          <button
            type="button"
            className="dg-canvas-page-add dg-canvas-page-add-right"
            style={{
              left: Math.max(1, widthPx) + 18,
              top: Math.max(24, heightPx / 2),
            }}
            title="Add page to the right"
            aria-label="Add page to the right"
            onPointerDown={(event) => {
              event.stopPropagation();
              onBeforePageAction?.();
            }}
            onDoubleClick={stop}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onBeforePageAction?.();
              onCreateAdjacentPage(page.id, "right");
            }}
          >
            <PinselaIcon name="Plus" size={13} />
            <PinselaIcon name="ArrowRight" size={13} />
          </button>
          <button
            type="button"
            className="dg-canvas-page-add dg-canvas-page-add-below"
            style={{
              left: Math.max(24, widthPx / 2),
              top: Math.max(1, heightPx) + 18,
            }}
            title="Add page below"
            aria-label="Add page below"
            onPointerDown={(event) => {
              event.stopPropagation();
              onBeforePageAction?.();
            }}
            onDoubleClick={stop}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onBeforePageAction?.();
              onCreateAdjacentPage(page.id, "below");
            }}
          >
            <PinselaIcon name="Plus" size={13} />
            <PinselaIcon name="ArrowDown" size={13} />
          </button>
        </>
      ) : null}
    </>
  );
}

function CanvasPagesLayoutSwitch({
  layout,
  pageCount,
  onChangeLayout,
}: {
  layout: CanvasProjectPagesLayout;
  pageCount: number;
  onChangeLayout?: (layout: CanvasProjectPagesLayout) => void;
}) {
  if (!onChangeLayout || pageCount <= 1) return null;
  return (
    <div className="dg-canvas-pages-layout-switch" onPointerDown={(event) => event.stopPropagation()}>
      <span>Pages</span>
      <button
        type="button"
        className={layout === "column" ? "active" : ""}
        title="Arrange pages in a column"
        aria-label="Arrange pages in a column"
        aria-pressed={layout === "column"}
        onClick={() => onChangeLayout("column")}
      >
        <PinselaIcon name="ArrowDown" size={14} />
      </button>
      <button
        type="button"
        className={layout === "row" ? "active" : ""}
        title="Arrange pages in a row"
        aria-label="Arrange pages in a row"
        aria-pressed={layout === "row"}
        onClick={() => onChangeLayout("row")}
      >
        <PinselaIcon name="ArrowRight" size={14} />
      </button>
    </div>
  );
}

export interface InlineTextEditOverlay {
  nodeId: string;
  value: string;
  geometry: { x: number; y: number; width: number; height: number; rotation?: number };
  style?: {
    fontFamily?: string;
    fontSize?: number;
    lineHeight?: number;
    fontWeight?: number | string;
    fontStyle?: "normal" | "italic";
    letterSpacing?: number;
    underline?: boolean;
    color?: string;
    textAlign?: "left" | "center" | "right" | "justify";
  };
}

export interface CanvasStageProps {
  mode: ToolbarCanvasMode;
  zoom: number;
  stageScale: number;
  compactViewport?: boolean;
  canvasWidth: number;
  canvasHeight: number;
  projectPages?: CanvasProjectPageView[];
  activeProjectPageId?: string | null;
  projectPagesLayout?: CanvasProjectPagesLayout;
  onProjectPagesLayoutChange?: (layout: CanvasProjectPagesLayout) => void;
  onSelectProjectPage?: (pageId: string) => void;
  onSelectProjectPageObject?: (event: { pageId: string; nodeId: string }) => void;
  onCreateProjectPageAdjacent?: (pageId: string, placement: "right" | "below") => void;
  onMoveProjectPage?: (event: { pageId: string; x: number; y: number; phase: "move" | "end" }) => void;
  onRenameProjectPage?: (pageId: string, name: string) => void;
  onDeleteProjectPage?: (pageId: string) => void;
  projectPagesImageCacheRef?: React.MutableRefObject<Map<string, HTMLImageElement>>;
  selectionSummary?: SelectionSummary;
  selectionLocked?: boolean;
  selectedBounds?: { x: number; y: number; w: number; h: number } | null;
  selectedNodeKind?: PinselaNodeKind | null;
  selectedNodeGeometry?: PinselaGeometry | null;
  selectedAutoLayoutState?: { active: boolean; empty: boolean };
  selectionRotationBaseDeg?: number;
  canvasRef?: React.RefObject<HTMLCanvasElement | null>;
  onPointerDown?: (ev: React.PointerEvent<HTMLCanvasElement>) => void;
  onPointerMove?: (ev: React.PointerEvent<HTMLCanvasElement>) => void;
  onPointerUp?: (ev: React.PointerEvent<HTMLCanvasElement>) => void;
  onCanvasDoubleClick?: (point: { x: number; y: number }) => void;
  onCanvasOutsideDoubleClick?: () => void;
  onZoomChange?: (zoom: number) => void;
  onToolbarAction?: (actionId: ToolbarActionId, payload?: Record<string, unknown>) => void;
  onCanvasBlankClick?: () => void;
  onSelectionChromeClick?: (event: SelectionChromeClickEvent) => void;
  onSelectionQuickAction?: (actionId: SelectionQuickActionId) => void;
  onTranslateSelectionGesture?: (event: TranslateSelectionGestureEvent) => void;
  onRotateSelectionGesture?: (event: RotateSelectionGestureEvent) => void;
  onResizeSelectedNode?: (patch: Partial<{ x: number; y: number; width: number; height: number }>) => void;
  onResizeSelectionGesture?: (event: ResizeSelectionGestureEvent) => void;
  onLineEndpointGesture?: (event: LineEndpointGestureEvent) => void;
  pathEditData?: CanvasPathEditData | null;
  onPathPointGesture?: (event: PathPointGestureEvent) => void;
  imageBrushActive?: boolean;
  imageBrushSize?: number;
  imageBrushState?: React.ComponentProps<typeof ContextToolbar>["imageBrushState"];
  onImageBrushGesture?: (event: ImageBrushGestureEvent) => void;
  onImageFileDrop?: (files: File[], point: { x: number; y: number }) => void;
  onImportFileDrop?: (files: File[], point: { x: number; y: number }) => void;
  onImageUrlDrop?: (urls: string[], point: { x: number; y: number }) => void;
  onExternalImageDragHover?: (point: { x: number; y: number } | null) => void;
  onCropWheel?: (event: { deltaY: number; point: { x: number; y: number } }) => void;
  /** Canva-style crop overlay: full source image dimmed + bright frame window. */
  cropOverlay?: {
    imageSrc: string;
    imageWidth: number;
    imageHeight: number;
  } | null;
  /** Live crop state (frame box + crop rect, canvas units) read each frame by the overlay rAF. */
  cropLiveRef?: React.MutableRefObject<{
    box: { x: number; y: number; width: number; height: number };
    crop: { x: number; y: number; width: number; height: number };
  } | null>;
  selectionMoveRasterPreview?: {
    src: string;
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
  selectionMovePreviewOffsetRef?: React.MutableRefObject<{ dx: number; dy: number } | null>;
  selectionMovePreviewOffset?: { dx: number; dy: number } | null;
  gestureGuidesRef?: React.MutableRefObject<GuideLine[]>;
  suspendSelectionChrome?: boolean;
  snapEnabled?: boolean;
  snapTolerance?: number;
  gridEnabled?: boolean;
  gridSize?: number;
  artboardFill?: unknown;
  marqueeRect?: { x: number; y: number; w: number; h: number } | null;
  frameDropPreview?: { x: number; y: number; w: number; h: number; cornerRadius?: number } | null;
  textToolbarState?: ContextToolbarTextState;
  shapeToolbarState?: {
    cornerRadius: number;
    maxCornerRadius: number;
    fill?: unknown;
    stroke?: unknown;
    strokeEnabled?: boolean;
    strokeWidth?: number;
    strokeDashPreset?: "solid" | "dash" | "long_dash" | "dotted";
  };
  lineToolbarState?: React.ComponentProps<typeof ContextToolbar>["lineState"];
  elementOpacityState?: React.ComponentProps<typeof ContextToolbar>["elementOpacityState"];
  imageDuotoneState?: React.ComponentProps<typeof ContextToolbar>["imageDuotoneState"];
  imageFadeState?: React.ComponentProps<typeof ContextToolbar>["imageFadeState"];
  imageTraceState?: React.ComponentProps<typeof ContextToolbar>["imageTraceState"];
  imageBackgroundRemovalState?: React.ComponentProps<typeof ContextToolbar>["imageBackgroundRemovalState"];
  documentColors?: React.ComponentProps<typeof ContextToolbar>["documentColors"];
  tracePreviewPaths?: string[];
  tracePreviewStroke?: string;
  inlineTextEdit?: InlineTextEditOverlay | null;
  onInlineTextChange?: (value: string) => void;
  onInlineTextCommit?: () => void;
  onInlineTextCancel?: () => void;
  cursorOverride?: string;
  allowBlankViewportMarquee?: boolean;
  rulersEnabled?: boolean;
  persistentGuides?: GuideLine[];
  onChangeGuides?: (next: GuideLine[]) => void;
  rulerDark?: boolean;
  centerSignal?: number;
}

export function CanvasStage({
  mode,
  zoom,
  stageScale,
  compactViewport = false,
  canvasWidth,
  canvasHeight,
  projectPages,
  activeProjectPageId,
  projectPagesLayout = "column",
  onProjectPagesLayoutChange,
  onSelectProjectPage,
  onSelectProjectPageObject,
  onCreateProjectPageAdjacent,
  onMoveProjectPage,
  onRenameProjectPage,
  onDeleteProjectPage,
  projectPagesImageCacheRef,
  selectionSummary,
  selectionLocked = false,
  selectedBounds,
  selectedNodeKind,
  selectedNodeGeometry,
  selectedAutoLayoutState,
  selectionRotationBaseDeg = 0,
  canvasRef,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onCanvasDoubleClick,
  onCanvasOutsideDoubleClick,
  onZoomChange,
  onToolbarAction,
  onCanvasBlankClick,
  onSelectionChromeClick,
  onSelectionQuickAction,
  onTranslateSelectionGesture,
  onRotateSelectionGesture,
  onResizeSelectedNode,
  onResizeSelectionGesture,
  onLineEndpointGesture,
  pathEditData,
  onPathPointGesture,
  imageBrushActive = false,
  imageBrushSize = 120,
  imageBrushState,
  onImageBrushGesture,
  onImageFileDrop,
  onImportFileDrop,
  onImageUrlDrop,
  onExternalImageDragHover,
  onCropWheel,
  cropOverlay,
  cropLiveRef,
  selectionMoveRasterPreview,
  selectionMovePreviewOffsetRef: selectionMovePreviewOffsetRefProp,
  selectionMovePreviewOffset: selectionMovePreviewOffsetProp,
  gestureGuidesRef,
  suspendSelectionChrome = false,
  snapEnabled,
  snapTolerance = 20,
  gridEnabled,
  gridSize = 8,
  artboardFill,
  marqueeRect,
  frameDropPreview,
  textToolbarState,
  shapeToolbarState,
  lineToolbarState,
  elementOpacityState,
  imageDuotoneState,
  imageFadeState,
  imageTraceState,
  imageBackgroundRemovalState,
  documentColors,
  tracePreviewPaths,
  tracePreviewStroke,
  inlineTextEdit,
  onInlineTextChange,
  onInlineTextCommit,
  onInlineTextCancel,
  cursorOverride,
  allowBlankViewportMarquee = true,
  rulersEnabled = false,
  persistentGuides,
  onChangeGuides,
  rulerDark = false,
  centerSignal = 0,
}: CanvasStageProps) {
  const summary = selectionSummary || { kind: "none", count: 0, isMixed: false, selectedIds: [] };
  const hasSelection = summary.kind !== "none";
  const isSelectionLocked = hasSelection && selectionLocked;
  const isInlineTextEditing = inlineTextEdit != null;
  const bounds = selectedBounds;

  const viewportRef = useRef<HTMLDivElement>(null);
  const panLayerRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const artboardRef = useRef<HTMLDivElement>(null);
  // Crop overlay DOM refs (positioned imperatively each frame, see updateCropOverlayDom).
  const cropOverlayRootRef = useRef<HTMLDivElement | null>(null);
  const cropDimImgRef = useRef<HTMLImageElement | null>(null);
  const cropBrightClipRef = useRef<HTMLDivElement | null>(null);
  const cropBrightImgRef = useRef<HTMLImageElement | null>(null);
  const cropFrameRef = useRef<HTMLDivElement | null>(null);
  const cropOverlayRafRef = useRef<number | null>(null);

  // Position the crop overlay (dimmed full image + bright window + frame/handles)
  // from the LIVE crop state in cropLiveRef, in canvas→screen units. Imperative so
  // pan/zoom/frame-resize stay smooth without re-rendering the editor.
  const updateCropOverlayDom = useCallback(() => {
    const root = cropOverlayRootRef.current;
    if (!root) return;
    const live = cropLiveRef?.current || null;
    if (mode !== "crop" || !cropOverlay || !live) {
      root.style.display = "none";
      return;
    }
    const box = live.box;
    const crop = live.crop;
    if (!(crop.width > 0 && crop.height > 0 && box.width > 0 && box.height > 0)) {
      root.style.display = "none";
      return;
    }
    const s = stageScaleRef.current || 1;
    const imageRect = imageRectFromCrop(box, crop, Math.max(1, cropOverlay.imageWidth), Math.max(1, cropOverlay.imageHeight));
    const fbLeft = box.x * s;
    const fbTop = box.y * s;
    const fbW = box.width * s;
    const fbH = box.height * s;
    const ibLeft = imageRect.x * s;
    const ibTop = imageRect.y * s;
    const ibW = imageRect.width * s;
    const ibH = imageRect.height * s;
    root.style.display = "block";
    const dim = cropDimImgRef.current;
    if (dim) {
      dim.style.left = `${ibLeft}px`;
      dim.style.top = `${ibTop}px`;
      dim.style.width = `${ibW}px`;
      dim.style.height = `${ibH}px`;
    }
    const clip = cropBrightClipRef.current;
    if (clip) {
      clip.style.left = `${fbLeft}px`;
      clip.style.top = `${fbTop}px`;
      clip.style.width = `${fbW}px`;
      clip.style.height = `${fbH}px`;
    }
    const bright = cropBrightImgRef.current;
    if (bright) {
      bright.style.left = `${ibLeft - fbLeft}px`;
      bright.style.top = `${ibTop - fbTop}px`;
      bright.style.width = `${ibW}px`;
      bright.style.height = `${ibH}px`;
    }
    const frame = cropFrameRef.current;
    if (frame) {
      frame.style.left = `${fbLeft}px`;
      frame.style.top = `${fbTop}px`;
      frame.style.width = `${fbW}px`;
      frame.style.height = `${fbH}px`;
    }
  }, [cropLiveRef, cropOverlay, mode]);

  useEffect(() => {
    if (mode !== "crop" || !cropOverlay) {
      if (cropOverlayRafRef.current != null) {
        window.cancelAnimationFrame(cropOverlayRafRef.current);
        cropOverlayRafRef.current = null;
      }
      const root = cropOverlayRootRef.current;
      if (root) root.style.display = "none";
      return;
    }
    let alive = true;
    const loop = () => {
      if (!alive) return;
      updateCropOverlayDom();
      cropOverlayRafRef.current = window.requestAnimationFrame(loop);
    };
    loop();
    return () => {
      alive = false;
      if (cropOverlayRafRef.current != null) {
        window.cancelAnimationFrame(cropOverlayRafRef.current);
        cropOverlayRafRef.current = null;
      }
    };
  }, [mode, cropOverlay, updateCropOverlayDom]);
  const contextToolbarSafeAreaRef = useRef({ left: -1, right: -1 });
  const panOffsetRef = useRef({ x: 0, y: 0 });
  const panOffsetVisualFrameRef = useRef<number | null>(null);
  const pendingPanOffsetRef = useRef<Point2D | null>(null);
  const zoomRef = useRef(zoom);
  const stageScaleRef = useRef(stageScale);
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0 });
  const panOffsetStartRef = useRef({ x: 0, y: 0 });
  const panGestureRef = useRef<{
    fromBlankCanvas: boolean;
    moved: boolean;
  }>({ fromBlankCanvas: false, moved: false });
  const panDragDetectedRef = useRef(false);
  const recentPanDragAtRef = useRef(0);
  const canvasDoubleClickTimerRef = useRef<number | null>(null);
  const viewportDoubleClickTimerRef = useRef<number | null>(null);
  const doublePressGestureEligibleRef = useRef(false);
  const canvasDoublePressArmedRef = useRef(false);
  const bridgedCanvasPointerRef = useRef<{ active: boolean; pointerId: number | null }>({
    active: false,
    pointerId: null,
  });
  const pointerGestureRef = useRef<{
    pointerId: number | null;
    startClientX: number;
    startClientY: number;
    moved: boolean;
  }>({
    pointerId: null,
    startClientX: 0,
    startClientY: 0,
    moved: false,
  });
  const lastPrimaryPressRef = useRef<{
    time: number;
    x: number;
    y: number;
    surface: "canvas" | "viewport";
  } | null>(null);
  const doublePressPanArmedRef = useRef(false);
  const suppressProjectPageClickRef = useRef<string | null>(null);
  const projectPageMoveRef = useRef<{
    active: boolean;
    pointerId: number | null;
    pageId: string;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    moved: boolean;
    selectOnRelease: boolean;
  }>({
    active: false,
    pointerId: null,
    pageId: "",
    startClientX: 0,
    startClientY: 0,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    moved: false,
    selectOnRelease: false,
  });
  const projectPageMovePreviewFrameRef = useRef<number | null>(null);
  const projectPageMovePreviewElementRef = useRef<HTMLElement | null>(null);
  const projectPageMovePreviewTransformRef = useRef("");
  const projectPageMovePreviewWillChangeRef = useRef("");
  const projectPageMovePreviewZIndexRef = useRef("");
  const projectPageMovePreviewOffsetRef = useRef({ dx: 0, dy: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const resizeRef = useRef<{
    active: boolean;
    pointerId: number | null;
    handle: ResizeHandle | null;
    startClientX: number;
    startClientY: number;
    startBounds: { x: number; y: number; w: number; h: number } | null;
    lastBounds: { x: number; y: number; w: number; h: number } | null;
  }>({
    active: false,
    pointerId: null,
    handle: null,
    startClientX: 0,
    startClientY: 0,
    startBounds: null,
    lastBounds: null,
  });
  const selectionMoveRef = useRef<{
    active: boolean;
    pointerId: number | null;
    startClientX: number;
    startClientY: number;
    lastDx: number;
    lastDy: number;
  }>({ active: false, pointerId: null, startClientX: 0, startClientY: 0, lastDx: 0, lastDy: 0 });
  const selectionPressRef = useRef<{
    active: boolean;
    pointerId: number | null;
    startClientX: number;
    startClientY: number;
    altKey: boolean;
    metaKey: boolean;
    ctrlKey: boolean;
    shiftKey: boolean;
  }>({
    active: false,
    pointerId: null,
    startClientX: 0,
    startClientY: 0,
    altKey: false,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
  });
  const resetSelectionPress = useCallback(() => {
    selectionPressRef.current = {
      active: false,
      pointerId: null,
      startClientX: 0,
      startClientY: 0,
      altKey: false,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
    };
  }, []);
  const selectionRotateRef = useRef<{
    active: boolean;
    pointerId: number | null;
    centerClientX: number;
    centerClientY: number;
    startAngleDeg: number;
    startSelectionRotationDeg: number;
    lastDeltaDeg: number;
  }>({
    active: false,
    pointerId: null,
    centerClientX: 0,
    centerClientY: 0,
    startAngleDeg: 0,
    startSelectionRotationDeg: 0,
    lastDeltaDeg: Number.NaN,
  });
  const lineEndpointRef = useRef<{
    active: boolean;
    pointerId: number | null;
    endpoint: "start" | "end" | null;
    anchor: { x: number; y: number } | null;
  }>({ active: false, pointerId: null, endpoint: null, anchor: null });
  const pathPointRef = useRef<{
    active: boolean;
    pointerId: number | null;
    pointIndex: number | null;
    pointKind: PathHandleKind;
  }>({ active: false, pointerId: null, pointIndex: null, pointKind: "anchor" });
  const imageBrushRef = useRef<{ active: boolean; pointerId: number | null }>({
    active: false,
    pointerId: null,
  });
  const imageBrushCursorElementRef = useRef<HTMLDivElement | null>(null);
  const imageBrushCursorPointRef = useRef<{ x: number; y: number } | null>(null);
  const imageBrushCursorFrameRef = useRef<number | null>(null);
  const imageBrushCursorVisibleRef = useRef(false);
  const [imageBrushCursorVisible, setImageBrushCursorVisible] = useState(false);
  const inlineTextEditorRef = useRef<HTMLTextAreaElement | null>(null);
  // During IME composition / dead-key input (accented chars on some keyboards) we do NOT propagate
  // the value: the controlled textarea would re-render and abort the composition (duplicated
  // accent / jumping cursor). We only commit on compositionend.
  const inlineTextComposingRef = useRef(false);
  const lastInlineTextEditorNodeIdRef = useRef<string | null>(null);
  const inlineTextOpenedAtRef = useRef(0);
  const inlineTextBlurCommitTimerRef = useRef<number | null>(null);
  const recentCanvasDoubleClickActionRef = useRef<{ time: number; x: number; y: number } | null>(null);
  const selectionMovePreviewFrameRef = useRef<number | null>(null);
  const selectionMovePreviewImageRef = useRef<HTMLImageElement | null>(null);
  // Selection frame + X/Y readout: during a move with raster preview we
  // move these elements directly in the DOM (same fast path as the image), otherwise the
  // frame stays frozen while the object moves (bug: "the frame didn't follow").
  const selectionMoveBoundingBoxRef = useRef<HTMLDivElement | null>(null);
  const selectionMoveReadoutRef = useRef<HTMLDivElement | null>(null);
  const selectionMovePreviewOffsetRef = useRef({ dx: 0, dy: 0 });
  const [selectionMovePreviewOffset, setSelectionMovePreviewOffset] = useState({ dx: 0, dy: 0 });
  const interactionGuidesFrameRef = useRef<number | null>(null);
  const interactionGuidesRef = useRef<GuideLine[]>([]);
  const [interactionGuides, setInteractionGuides] = useState<GuideLine[]>([]);
  const wheelZoomChromeTimerRef = useRef<number | null>(null);
  const interactionFastModeTimerRef = useRef<number | null>(null);
  const interactionFastModeRef = useRef(false);
  const [isWheelZooming, setIsWheelZooming] = useState(false);
  const [isInteractionFastMode, setIsInteractionFastMode] = useState(false);
  const wheelGestureRef = useRef<{
    frame: number | null;
    kind: "none" | "pan" | "zoom" | "crop";
    panX: number;
    panY: number;
    zoomDeltaY: number;
    cropDeltaY: number;
    clientX: number;
    clientY: number;
    trackpad: boolean;
  }>({
    frame: null,
    kind: "none",
    panX: 0,
    panY: 0,
    zoomDeltaY: 0,
    cropDeltaY: 0,
    clientX: 0,
    clientY: 0,
    trackpad: false,
  });
  const wheelZoomSessionRef = useRef<{
    active: boolean;
    anchorDocX: number;
    anchorDocY: number;
    anchorClientX: number;
    anchorClientY: number;
    lastEventAt: number;
    geometry: ZoomAnchorGeometry | null;
  }>({
    active: false,
    anchorDocX: 0,
    anchorDocY: 0,
    anchorClientX: 0,
    anchorClientY: 0,
    lastEventAt: 0,
    geometry: null,
  });
  const viewportStabilizeFrameRef = useRef<number | null>(null);
  const activeTouchPointsRef = useRef<Map<number, { clientX: number; clientY: number }>>(new Map());
  const pinchGestureRef = useRef<{
    active: boolean;
    startDistance: number;
    startZoom: number;
    anchorDocX: number;
    anchorDocY: number;
  }>({
    active: false,
    startDistance: 0,
    startZoom: 100,
    anchorDocX: 0,
    anchorDocY: 0,
  });

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    stageScaleRef.current = stageScale;
  }, [stageScale]);

  const selectedBoundsRef = useRef(selectedBounds);
  useEffect(() => {
    selectedBoundsRef.current = selectedBounds;
  }, [selectedBounds]);

  const writePanOffsetToDom = useCallback((nextPanOffset: Point2D) => {
    const panLayer = panLayerRef.current;
    if (!panLayer) return;
    panLayer.style.transform = panOffsetToTransform(nextPanOffset);
  }, []);

  const readRenderedPanOffset = useCallback((): Point2D | null => {
    const panLayer = panLayerRef.current;
    if (!panLayer) return null;
    const transform = panLayer.style.transform || window.getComputedStyle(panLayer).transform || "";
    if (!transform || transform === "none") return { x: 0, y: 0 };
    try {
      const matrix = new DOMMatrixReadOnly(transform);
      return {
        x: Number.isFinite(matrix.m41) ? matrix.m41 : 0,
        y: Number.isFinite(matrix.m42) ? matrix.m42 : 0,
      };
    } catch {
      const match = transform.match(/translate3d?\(([-0-9.]+)px,\s*([-0-9.]+)px/i);
      if (!match) return null;
      const x = Number(match[1]);
      const y = Number(match[2]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      return { x, y };
    }
  }, []);

  const syncPanOffsetRefToRendered = useCallback(() => {
    const renderedPanOffset = readRenderedPanOffset();
    if (!renderedPanOffset) return;
    panOffsetRef.current = renderedPanOffset;
    pendingPanOffsetRef.current = null;
  }, [readRenderedPanOffset]);

  const flushPanOffsetVisual = useCallback(() => {
    panOffsetVisualFrameRef.current = null;
    const nextPanOffset = pendingPanOffsetRef.current;
    pendingPanOffsetRef.current = null;
    if (!nextPanOffset) return;
    writePanOffsetToDom(nextPanOffset);
  }, [writePanOffsetToDom]);

  const applyPanOffset = useCallback((nextPanOffset: Point2D, options?: { immediate?: boolean }) => {
    panOffsetRef.current = nextPanOffset;
    if (options?.immediate) {
      pendingPanOffsetRef.current = null;
      if (panOffsetVisualFrameRef.current != null) {
        window.cancelAnimationFrame(panOffsetVisualFrameRef.current);
        panOffsetVisualFrameRef.current = null;
      }
      writePanOffsetToDom(nextPanOffset);
      return;
    }
    pendingPanOffsetRef.current = nextPanOffset;
    if (panOffsetVisualFrameRef.current != null) return;
    panOffsetVisualFrameRef.current = window.requestAnimationFrame(() => {
      flushPanOffsetVisual();
    });
  }, [flushPanOffsetVisual, writePanOffsetToDom]);

  // Center the active page inside the usable band (between the floating top
  // toolbar and the bottom toolbelt, reserving room for the page-name label).
  // Returns true once it has applied (or confirmed already-centered).
  const centerActivePageStep = useCallback((): boolean => {
    const viewport = viewportRef.current;
    if (!viewport) return false;
    const slot = viewport.querySelector<HTMLElement>(".dg-canvas-page-slot.is-active");
    if (!slot) return false;
    const vr = viewport.getBoundingClientRect();
    const sr = slot.getBoundingClientRect();
    if (!(sr.width > 1 && sr.height > 1 && vr.width > 1)) return false;
    const topToolbar = document.querySelector(".dg-context-toolbar");
    const bottomBelt = document.querySelector(".dg-bottom-toolbelt-inner");
    const topEdge = topToolbar instanceof HTMLElement
      ? Math.max(vr.top, topToolbar.getBoundingClientRect().bottom)
      : vr.top;
    const bottomEdge = bottomBelt instanceof HTMLElement
      ? Math.min(vr.bottom, bottomBelt.getBoundingClientRect().top)
      : vr.bottom;
    const labelReserve = 30;
    const dx = vr.left + vr.width / 2 - (sr.left + sr.width / 2);
    const dy = (topEdge + labelReserve + bottomEdge) / 2 - (sr.top + sr.height / 2);
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      applyPanOffset(
        { x: panOffsetRef.current.x + dx, y: panOffsetRef.current.y + dy },
        { immediate: true },
      );
    }
    return true;
  }, [applyPanOffset]);

  // Initial framing on load — a short settle loop (zoom-fit lands async after
  // data load) that stops at the first user pointer interaction.
  const initialCenterDoneRef = useRef(false);
  useEffect(() => {
    if (initialCenterDoneRef.current) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    let rafId = 0;
    let attempts = 0;
    const stop = () => {
      initialCenterDoneRef.current = true;
      if (rafId) window.cancelAnimationFrame(rafId);
    };
    const tick = () => {
      rafId = 0;
      if (initialCenterDoneRef.current) return;
      centerActivePageStep();
      attempts += 1;
      if (attempts >= 90) {
        stop();
        return;
      }
      rafId = window.requestAnimationFrame(tick);
    };
    viewport.addEventListener("pointerdown", stop, { once: true });
    rafId = window.requestAnimationFrame(tick);
    return () => {
      viewport.removeEventListener("pointerdown", stop);
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [centerActivePageStep]);

  // On-demand re-center (the "Fit to screen" / Fit button bumps `centerSignal`).
  // Fit changes zoom asynchronously, so run a short settle loop after the signal.
  useEffect(() => {
    if (!centerSignal) return;
    let rafId = 0;
    let attempts = 0;
    const tick = () => {
      rafId = 0;
      centerActivePageStep();
      attempts += 1;
      if (attempts >= 12) return;
      rafId = window.requestAnimationFrame(tick);
    };
    rafId = window.requestAnimationFrame(tick);
    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [centerSignal, centerActivePageStep]);

  const writeWorkspaceScaleToDom = useCallback((scaleRatio: number) => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    if (!Number.isFinite(scaleRatio) || Math.abs(scaleRatio - 1) <= 0.001) {
      workspace.style.transformOrigin = "top left";
      workspace.style.transform = "translate3d(-50%, -50%, 0)";
      workspace.style.willChange = "";
      return;
    }
    workspace.style.transformOrigin = "top left";
    workspace.style.transform = `translate3d(-50%, -50%, 0) scale(${scaleRatio})`;
    workspace.style.willChange = "transform";
  }, []);

  useEffect(() => () => {
    if (panOffsetVisualFrameRef.current != null) {
      window.cancelAnimationFrame(panOffsetVisualFrameRef.current);
      panOffsetVisualFrameRef.current = null;
    }
    if (viewportStabilizeFrameRef.current != null) {
      window.cancelAnimationFrame(viewportStabilizeFrameRef.current);
      viewportStabilizeFrameRef.current = null;
    }
    if (projectPageMovePreviewFrameRef.current != null) {
      window.cancelAnimationFrame(projectPageMovePreviewFrameRef.current);
      projectPageMovePreviewFrameRef.current = null;
    }
    if (imageBrushCursorFrameRef.current != null) {
      window.cancelAnimationFrame(imageBrushCursorFrameRef.current);
      imageBrushCursorFrameRef.current = null;
    }
    pendingPanOffsetRef.current = null;
  }, []);

  const writeSelectionMovePreviewOffsetToDom = useCallback((offset: { dx: number; dy: number }) => {
    const scale = Math.max(0.0001, stageScaleRef.current);
    const transform = `translate3d(${offset.dx * scale}px, ${offset.dy * scale}px, 0)`;
    const previewImage = selectionMovePreviewImageRef.current;
    if (previewImage) previewImage.style.transform = transform;
    // Move the frame/handles together with the object (same offset), without a React re-render.
    const boundingBox = selectionMoveBoundingBoxRef.current;
    if (boundingBox) boundingBox.style.transform = transform;
    // Keep the X/Y readout live during a raster move (it is fixed; only the number changes).
    const readout = selectionMoveReadoutRef.current;
    const base = selectedBoundsRef.current;
    if (readout && base) {
      const spans = readout.children;
      if (spans[0]) spans[0].textContent = `X ${Math.round(base.x + offset.dx)}`;
      if (spans[1]) spans[1].textContent = `Y ${Math.round(base.y + offset.dy)}`;
    }
  }, []);

  // During RESIZE the `bounds` prop only updates on commit (pointerup); the
  // live preview exists only in resizeRef.lastBounds. Writing straight to the DOM
  // keeps the frame attached to the object during the gesture, like the move path.
  const writeResizePreviewBoundsToDom = useCallback(() => {
    if (!resizeRef.current.active) return;
    const previewBounds = resizeRef.current.lastBounds;
    const boundingBox = selectionMoveBoundingBoxRef.current;
    if (!previewBounds || !boundingBox) return;
    const scale = Math.max(0.0001, stageScaleRef.current);
    boundingBox.style.left = `${previewBounds.x * scale}px`;
    boundingBox.style.top = `${previewBounds.y * scale}px`;
    boundingBox.style.width = `${previewBounds.w * scale}px`;
    boundingBox.style.height = `${previewBounds.h * scale}px`;
  }, []);

  const scheduleSelectionMovePreviewOffset = useCallback((dx: number, dy: number) => {
    if (
      Math.abs(selectionMovePreviewOffsetRef.current.dx - dx) <= 0.001
      && Math.abs(selectionMovePreviewOffsetRef.current.dy - dy) <= 0.001
    ) {
      return;
    }
    selectionMovePreviewOffsetRef.current = { dx, dy };
    if (selectionMovePreviewFrameRef.current != null) return;
    selectionMovePreviewFrameRef.current = window.requestAnimationFrame(() => {
      selectionMovePreviewFrameRef.current = null;
      if (selectionMoveRasterPreview) {
        writeSelectionMovePreviewOffsetToDom(selectionMovePreviewOffsetRef.current);
        return;
      }
      setSelectionMovePreviewOffset(selectionMovePreviewOffsetRef.current);
    });
  }, [selectionMoveRasterPreview, writeSelectionMovePreviewOffsetToDom]);

  const resetSelectionMovePreviewOffset = useCallback(() => {
    if (selectionMovePreviewFrameRef.current != null) {
      window.cancelAnimationFrame(selectionMovePreviewFrameRef.current);
      selectionMovePreviewFrameRef.current = null;
    }
    selectionMovePreviewOffsetRef.current = { dx: 0, dy: 0 };
    writeSelectionMovePreviewOffsetToDom(selectionMovePreviewOffsetRef.current);
    setSelectionMovePreviewOffset({ dx: 0, dy: 0 });
  }, [writeSelectionMovePreviewOffsetToDom]);

  const writeProjectPageMovePreviewToDom = useCallback(() => {
    const element = projectPageMovePreviewElementRef.current;
    if (!element) return;
    const offset = projectPageMovePreviewOffsetRef.current;
    const scale = Math.max(0.0001, stageScaleRef.current);
    element.style.transform = `translate3d(${offset.dx * scale}px, ${offset.dy * scale}px, 0)`;
  }, []);

  const scheduleProjectPageMovePreview = useCallback((dx: number, dy: number) => {
    if (
      Math.abs(projectPageMovePreviewOffsetRef.current.dx - dx) <= 0.001
      && Math.abs(projectPageMovePreviewOffsetRef.current.dy - dy) <= 0.001
    ) {
      return;
    }
    projectPageMovePreviewOffsetRef.current = { dx, dy };
    if (projectPageMovePreviewFrameRef.current != null) return;
    projectPageMovePreviewFrameRef.current = window.requestAnimationFrame(() => {
      projectPageMovePreviewFrameRef.current = null;
      writeProjectPageMovePreviewToDom();
    });
  }, [writeProjectPageMovePreviewToDom]);

  const clearProjectPageMovePreview = useCallback(() => {
    if (projectPageMovePreviewFrameRef.current != null) {
      window.cancelAnimationFrame(projectPageMovePreviewFrameRef.current);
      projectPageMovePreviewFrameRef.current = null;
    }
    const element = projectPageMovePreviewElementRef.current;
    if (element) {
      element.style.transform = projectPageMovePreviewTransformRef.current;
      element.style.willChange = projectPageMovePreviewWillChangeRef.current;
      element.style.zIndex = projectPageMovePreviewZIndexRef.current;
    }
    projectPageMovePreviewElementRef.current = null;
    projectPageMovePreviewTransformRef.current = "";
    projectPageMovePreviewWillChangeRef.current = "";
    projectPageMovePreviewZIndexRef.current = "";
    projectPageMovePreviewOffsetRef.current = { dx: 0, dy: 0 };
  }, []);

  useEffect(() => {
    imageBrushCursorVisibleRef.current = imageBrushCursorVisible;
  }, [imageBrushCursorVisible]);

  const writeImageBrushCursorToDom = useCallback(() => {
    const cursor = imageBrushCursorElementRef.current;
    const point = imageBrushCursorPointRef.current;
    if (!cursor || !point) return;
    const scale = Math.max(0.0001, stageScaleRef.current);
    cursor.style.transform = `translate3d(${point.x * scale}px, ${point.y * scale}px, 0) translate(-50%, -50%)`;
  }, []);

  const scheduleImageBrushCursor = useCallback((point: { x: number; y: number }) => {
    const current = imageBrushCursorPointRef.current;
    if (
      current
      && Math.abs(current.x - point.x) <= 0.001
      && Math.abs(current.y - point.y) <= 0.001
    ) {
      return;
    }
    imageBrushCursorPointRef.current = point;
    if (!imageBrushCursorVisibleRef.current) {
      imageBrushCursorVisibleRef.current = true;
      setImageBrushCursorVisible(true);
    }
    if (imageBrushCursorFrameRef.current != null) return;
    imageBrushCursorFrameRef.current = window.requestAnimationFrame(() => {
      imageBrushCursorFrameRef.current = null;
      writeImageBrushCursorToDom();
    });
  }, [writeImageBrushCursorToDom]);

  const hideImageBrushCursor = useCallback(() => {
    imageBrushCursorPointRef.current = null;
    if (imageBrushCursorFrameRef.current != null) {
      window.cancelAnimationFrame(imageBrushCursorFrameRef.current);
      imageBrushCursorFrameRef.current = null;
    }
    if (imageBrushCursorVisibleRef.current) {
      imageBrushCursorVisibleRef.current = false;
      setImageBrushCursorVisible(false);
    }
  }, []);

  useEffect(() => {
    if (!imageBrushCursorVisible) return;
    writeImageBrushCursorToDom();
  }, [imageBrushCursorVisible, imageBrushSize, stageScale, writeImageBrushCursorToDom]);

  const scheduleInteractionGuides = useCallback((guides: GuideLine[]) => {
    if (areGuideListsEqual(interactionGuidesRef.current, guides)) return;
    interactionGuidesRef.current = guides;
    if (interactionGuidesFrameRef.current != null) return;
    interactionGuidesFrameRef.current = window.requestAnimationFrame(() => {
      interactionGuidesFrameRef.current = null;
      setInteractionGuides(interactionGuidesRef.current);
    });
  }, []);

  const clearInteractionGuides = useCallback(() => {
    if (!interactionGuidesRef.current.length && !interactionGuides.length) return;
    if (interactionGuidesFrameRef.current != null) {
      window.cancelAnimationFrame(interactionGuidesFrameRef.current);
      interactionGuidesFrameRef.current = null;
    }
    interactionGuidesRef.current = [];
    setInteractionGuides([]);
  }, [interactionGuides.length]);

  // Intentionally no deps array: in raster mode the move offset lives outside
  // React state, so any re-render mid-drag (drop target,
  // guides, raster arrival) re-applies a stale transform in JSX on the frame and
  // the image. Rewriting the live transform in a layout effect on every render
  // puts the DOM back at the current offset BEFORE paint, so the frame never detaches.
  useLayoutEffect(() => {
    if (selectionMoveRasterPreview) {
      writeSelectionMovePreviewOffsetToDom(selectionMovePreviewOffsetRef.current);
    }
    // Same reason for resize: re-renders mid-gesture (doc preview
    // redrawing the canvas) re-apply the COMMITTED bounds in JSX on the frame.
    writeResizePreviewBoundsToDom();
  });

  const computePanOffsetForAnchor = useCallback((
    clientX: number,
    clientY: number,
    anchorDocX: number,
    anchorDocY: number,
    targetScale: number,
    geometry?: ZoomAnchorGeometry | null,
  ) => {
    if (geometry && Number.isFinite(targetScale) && targetScale > 0) {
      const scaleRatio = targetScale / Math.max(0.0001, geometry.renderedScale);
      const nextWorkspaceWidth = geometry.workspaceWidth * scaleRatio;
      const nextWorkspaceHeight = geometry.workspaceHeight * scaleRatio;
      const nextActivePageOffsetX = geometry.activePageOffsetX * scaleRatio;
      const nextActivePageOffsetY = geometry.activePageOffsetY * scaleRatio;
      const desiredArtboardLeft = clientX - anchorDocX * targetScale;
      const desiredArtboardTop = clientY - anchorDocY * targetScale;
      return {
        x: desiredArtboardLeft - (geometry.viewportCenterX - nextWorkspaceWidth / 2 + nextActivePageOffsetX),
        y: desiredArtboardTop - (geometry.viewportCenterY - nextWorkspaceHeight / 2 + nextActivePageOffsetY),
      };
    }
    const viewportRect = viewportRef.current?.getBoundingClientRect();
    const workspaceRect = workspaceRef.current?.getBoundingClientRect();
    const artboardRect = artboardRef.current?.getBoundingClientRect();
    if (
      !viewportRect
      || !workspaceRect
      || !artboardRect
      || !Number.isFinite(targetScale)
      || targetScale <= 0
    ) {
      return panOffsetRef.current;
    }
    const renderedScale = Math.max(
      0.0001,
      artboardRect.width / Math.max(1, canvasWidth),
      artboardRect.height / Math.max(1, canvasHeight),
    );
    const scaleRatio = targetScale / renderedScale;
    const viewportCenterX = viewportRect.left + viewportRect.width / 2;
    const viewportCenterY = viewportRect.top + viewportRect.height / 2;
    const nextWorkspaceWidth = workspaceRect.width * scaleRatio;
    const nextWorkspaceHeight = workspaceRect.height * scaleRatio;
    const nextActivePageOffsetX = (artboardRect.left - workspaceRect.left) * scaleRatio;
    const nextActivePageOffsetY = (artboardRect.top - workspaceRect.top) * scaleRatio;
    const desiredArtboardLeft = clientX - anchorDocX * targetScale;
    const desiredArtboardTop = clientY - anchorDocY * targetScale;
    return {
      x: desiredArtboardLeft - (viewportCenterX - nextWorkspaceWidth / 2 + nextActivePageOffsetX),
      y: desiredArtboardTop - (viewportCenterY - nextWorkspaceHeight / 2 + nextActivePageOffsetY),
    };
  }, [canvasHeight, canvasWidth]);

  const applyZoomAtClient = useCallback((
    nextZoomValue: number,
    clientX: number,
    clientY: number,
    options?: { anchorDocX?: number; anchorDocY?: number; anchorGeometry?: ZoomAnchorGeometry | null },
  ) => {
    if (!onZoomChange) return;
    const currentZoom = normalizeUiZoomPercent(zoomRef.current);
    const nextZoom = normalizeUiZoomPercent(nextZoomValue, currentZoom);
    if (!Number.isFinite(nextZoom) || Math.abs(nextZoom - currentZoom) < 0.01) return;
    const currentScale = Math.max(0.0001, Number(stageScaleRef.current || 1));
    const nextScale = currentScale * (nextZoom / currentZoom);
    const artboardRect = artboardRef.current?.getBoundingClientRect();
    const anchorPoint = artboardRect
      ? clientPointToRenderedDocPoint(clientX, clientY, artboardRect, canvasWidth, canvasHeight)
      : null;
    const anchorDocX = Number.isFinite(options?.anchorDocX)
      ? Number(options?.anchorDocX)
      : anchorPoint
        ? anchorPoint.x
        : canvasWidth / 2;
    const anchorDocY = Number.isFinite(options?.anchorDocY)
      ? Number(options?.anchorDocY)
      : anchorPoint
        ? anchorPoint.y
        : canvasHeight / 2;
    const nextPanOffset = computePanOffsetForAnchor(clientX, clientY, anchorDocX, anchorDocY, nextScale, options?.anchorGeometry);
    applyPanOffset(nextPanOffset, { immediate: true });
    zoomRef.current = nextZoom;
    stageScaleRef.current = nextScale;
    writeWorkspaceScaleToDom(1);
    onZoomChange(nextZoom);
  }, [
    applyPanOffset,
    computePanOffsetForAnchor,
    onZoomChange,
    writeWorkspaceScaleToDom,
  ]);

  // Mobile: after the auto-fit settles, measure the artboard and correct the pan
  // offset so it is centered in the canvas area ABOVE the floating bottom toolbar.
  // Runs on load / page switch / resize only (not on user zoom/pan) so it never
  // fights an intentional gesture. The project-pages workspace reserves space for
  // page controls, which otherwise leaves the artboard pushed low on small screens.
  useEffect(() => {
    if (!compactViewport) return undefined;
    let raf = 0;
    const timers: number[] = [];
    const recenter = () => {
      const viewport = viewportRef.current;
      const artboard = artboardRef.current;
      if (!viewport || !artboard) return;
      if (resizeRef.current.active || isPanningRef.current) return;
      const vr = viewport.getBoundingClientRect();
      const ar = artboard.getBoundingClientRect();
      if (ar.width < 2 || ar.height < 2 || vr.height < 2) return;
      const toolbelt = document.querySelector(".dg-bottom-toolbelt-inner");
      const toolbeltTop = toolbelt instanceof HTMLElement ? toolbelt.getBoundingClientRect().top : vr.bottom - 88;
      const bottomLimit = Math.min(vr.bottom, toolbeltTop) - 12;
      const targetCenterX = vr.left + vr.width / 2;
      const targetCenterY = vr.top + Math.max(80, bottomLimit - vr.top) / 2;
      const dx = targetCenterX - (ar.left + ar.width / 2);
      const dy = targetCenterY - (ar.top + ar.height / 2);
      if (Math.abs(dx) < 1.5 && Math.abs(dy) < 1.5) return;
      applyPanOffset({ x: panOffsetRef.current.x + dx, y: panOffsetRef.current.y + dy }, { immediate: true });
    };
    // Several passes through the load/settle window — the parent's auto-fit lands
    // asynchronously, so a single early pass would be overwritten. recenter is
    // idempotent (no-op once centered) and load-scoped, so extra passes are safe.
    timers.push(window.setTimeout(() => { raf = window.requestAnimationFrame(recenter); }, 180));
    [500, 1000, 1700].forEach((ms) => timers.push(window.setTimeout(recenter, ms)));
    const onResize = () => timers.push(window.setTimeout(recenter, 220));
    window.addEventListener("resize", onResize);
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, [compactViewport, activeProjectPageId, canvasWidth, canvasHeight, applyPanOffset]);

  const setInteractionFastModeState = useCallback((next: boolean) => {
    if (interactionFastModeRef.current === next) return;
    interactionFastModeRef.current = next;
    setIsInteractionFastMode(next);
  }, []);

  const clearInteractionFastModeTimer = useCallback(() => {
    if (interactionFastModeTimerRef.current != null) {
      window.clearTimeout(interactionFastModeTimerRef.current);
      interactionFastModeTimerRef.current = null;
    }
  }, []);

  const engageInteractionFastMode = useCallback((releaseAfterMs?: number) => {
    clearInteractionFastModeTimer();
    setInteractionFastModeState(true);
    if (releaseAfterMs == null) return;
    interactionFastModeTimerRef.current = window.setTimeout(() => {
      interactionFastModeTimerRef.current = null;
      setInteractionFastModeState(false);
    }, Math.max(40, releaseAfterMs));
  }, [clearInteractionFastModeTimer, setInteractionFastModeState]);

  const releaseInteractionFastMode = useCallback((delayMs = INTERACTION_FAST_MODE_SETTLE_MS) => {
    clearInteractionFastModeTimer();
    interactionFastModeTimerRef.current = window.setTimeout(() => {
      interactionFastModeTimerRef.current = null;
      setInteractionFastModeState(false);
    }, Math.max(40, delayMs));
  }, [clearInteractionFastModeTimer, setInteractionFastModeState]);

  const clearPinchGesture = useCallback(() => {
    pinchGestureRef.current = {
      active: false,
      startDistance: 0,
      startZoom: normalizeUiZoomPercent(zoomRef.current),
      anchorDocX: 0,
      anchorDocY: 0,
    };
  }, []);

  const clearWheelZoomSession = useCallback(() => {
    wheelZoomSessionRef.current = {
      active: false,
      anchorDocX: 0,
      anchorDocY: 0,
    anchorClientX: 0,
    anchorClientY: 0,
    lastEventAt: 0,
    geometry: null,
  };
}, []);

  const restoreArtboardViewportFromRect = useCallback((before: DOMRect | null | undefined) => {
    if (!before) return;
    if (viewportStabilizeFrameRef.current != null) {
      window.cancelAnimationFrame(viewportStabilizeFrameRef.current);
      viewportStabilizeFrameRef.current = null;
    }
    let remainingFrames = 3;
    const restore = () => {
      viewportStabilizeFrameRef.current = null;
      const current = artboardRef.current?.getBoundingClientRect();
      if (current) {
        const dx = before.left - current.left;
        const dy = before.top - current.top;
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
          applyPanOffset({
            x: panOffsetRef.current.x + dx,
            y: panOffsetRef.current.y + dy,
          }, { immediate: true });
        }
      }
      remainingFrames -= 1;
      if (remainingFrames > 0) {
        viewportStabilizeFrameRef.current = window.requestAnimationFrame(restore);
      }
    };
    viewportStabilizeFrameRef.current = window.requestAnimationFrame(restore);
  }, [applyPanOffset]);

  const stabilizeViewportAfterUiInteraction = useCallback((target: EventTarget | null) => {
    if (!isViewportStabilizingUiTarget(target)) return;
    restoreArtboardViewportFromRect(artboardRef.current?.getBoundingClientRect());
  }, [restoreArtboardViewportFromRect]);

  const updateContextToolbarSafeArea = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const viewportRect = viewport.getBoundingClientRect();
    const root = viewport.closest(".dg-app-root");
    const leftPanelShell = root?.querySelector(".dg-app-left");
    const leftOverlayPanel = root?.querySelector(".dg-left-panel.is-open");
    const rightPanelShell = root?.querySelector(".dg-app-right");
    const resolveInlineOverlap = (element: Element | null | undefined, side: "left" | "right") => {
      if (!(element instanceof HTMLElement)) return 0;
      const rect = element.getBoundingClientRect();
      const overlapsVertically = rect.bottom > viewportRect.top && rect.top < viewportRect.bottom;
      if (!overlapsVertically) return 0;
      if (side === "left") {
        if (rect.right <= viewportRect.left || rect.left >= viewportRect.right) return 0;
        return Math.max(0, rect.right - viewportRect.left);
      }
      if (rect.left >= viewportRect.right || rect.right <= viewportRect.left) return 0;
      return Math.max(0, viewportRect.right - rect.left);
    };
    const safeLeft = Math.max(
      resolveInlineOverlap(leftPanelShell, "left"),
      resolveInlineOverlap(leftOverlayPanel, "left"),
    );
    const nextLeft = Math.ceil(safeLeft);
    const nextRight = Math.ceil(resolveInlineOverlap(rightPanelShell, "right"));
    const previous = contextToolbarSafeAreaRef.current;
    if (previous.left !== nextLeft) {
      previous.left = nextLeft;
      viewport.style.setProperty("--dg-context-toolbar-safe-left", `${nextLeft}px`);
    }
    if (previous.right !== nextRight) {
      previous.right = nextRight;
      viewport.style.setProperty("--dg-context-toolbar-safe-right", `${nextRight}px`);
    }
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const root = viewport.closest(".dg-app-root");
    const leftPanelShell = root?.querySelector(".dg-app-left");
    const rightPanelShell = root?.querySelector(".dg-app-right");
    let frame: number | null = null;
    const observedElements = new Set<Element>();
    let resizeObserver: ResizeObserver | null = null;
    const observeElement = (element: Element | null | undefined) => {
      if (!(element instanceof Element) || !resizeObserver) return;
      if (observedElements.has(element)) return;
      observedElements.add(element);
      resizeObserver.observe(element);
    };
    const observeDynamicPanels = () => {
      observeElement(root?.querySelector(".dg-left-panel"));
      observeElement(root?.querySelector(".dg-right-panel"));
    };
    const scheduleUpdate = () => {
      if (frame != null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        observeDynamicPanels();
        updateContextToolbarSafeArea();
      });
    };
    resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(scheduleUpdate) : null;
    [viewport, root, leftPanelShell, rightPanelShell].forEach(observeElement);
    observeDynamicPanels();
    scheduleUpdate();
    const shellMutationObserver = typeof MutationObserver !== "undefined" ? new MutationObserver(scheduleUpdate) : null;
    if (shellMutationObserver) {
      if (leftPanelShell) {
        shellMutationObserver.observe(leftPanelShell, {
          attributes: true,
          childList: true,
          subtree: true,
          attributeFilter: ["class", "style"],
        });
      }
      if (rightPanelShell) {
        shellMutationObserver.observe(rightPanelShell, {
          attributes: true,
          childList: true,
          subtree: true,
          attributeFilter: ["class", "style"],
        });
      }
      if (root) {
        shellMutationObserver.observe(root, {
          attributes: true,
          attributeFilter: ["class", "style"],
        });
      }
    }
    window.addEventListener("resize", scheduleUpdate);
    return () => {
      if (frame != null) {
        window.cancelAnimationFrame(frame);
        frame = null;
      }
      resizeObserver?.disconnect();
      shellMutationObserver?.disconnect();
      window.removeEventListener("resize", scheduleUpdate);
      contextToolbarSafeAreaRef.current = { left: -1, right: -1 };
      viewport.style.removeProperty("--dg-context-toolbar-safe-left");
      viewport.style.removeProperty("--dg-context-toolbar-safe-right");
    };
  }, [updateContextToolbarSafeArea]);

  const maybeStartPinchGesture = useCallback(() => {
    if (pinchGestureRef.current.active) return true;
    if (
      isInlineTextEditing
      || mode === "text_edit"
      || imageBrushActive
      || resizeRef.current.active
      || selectionMoveRef.current.active
      || selectionRotateRef.current.active
      || lineEndpointRef.current.active
      || pathPointRef.current.active
    ) {
      return false;
    }
    const touches = Array.from(activeTouchPointsRef.current.values()).slice(0, 2);
    if (touches.length < 2) return false;
    const distance = Math.hypot(
      touches[0].clientX - touches[1].clientX,
      touches[0].clientY - touches[1].clientY,
    );
    if (!Number.isFinite(distance) || distance < PINCH_MIN_DISTANCE_PX) return false;
    const centerX = (touches[0].clientX + touches[1].clientX) / 2;
    const centerY = (touches[0].clientY + touches[1].clientY) / 2;
    const artboardRect = artboardRef.current?.getBoundingClientRect();
    const currentScale = Math.max(0.0001, Number(stageScaleRef.current || 1));
    const anchorDocX = artboardRect ? (centerX - artboardRect.left) / currentScale : canvasWidth / 2;
    const anchorDocY = artboardRect ? (centerY - artboardRect.top) / currentScale : canvasHeight / 2;
    pinchGestureRef.current = {
      active: true,
      startDistance: distance,
      startZoom: normalizeUiZoomPercent(zoomRef.current),
      anchorDocX,
      anchorDocY,
    };
    bridgedCanvasPointerRef.current = { active: false, pointerId: null };
    pointerGestureRef.current = {
      pointerId: null,
      startClientX: 0,
      startClientY: 0,
      moved: true,
    };
    panGestureRef.current = { fromBlankCanvas: false, moved: true };
    isPanningRef.current = false;
    setIsPanning(false);
    if (canvasDoubleClickTimerRef.current != null) {
      window.clearTimeout(canvasDoubleClickTimerRef.current);
      canvasDoubleClickTimerRef.current = null;
    }
    if (viewportDoubleClickTimerRef.current != null) {
      window.clearTimeout(viewportDoubleClickTimerRef.current);
      viewportDoubleClickTimerRef.current = null;
    }
    engageInteractionFastMode();
    return true;
  }, [
    canvasHeight,
    canvasWidth,
    engageInteractionFastMode,
    imageBrushActive,
    isInlineTextEditing,
    mode,
  ]);

  useEffect(() => () => {
    if (selectionMovePreviewFrameRef.current != null) {
      window.cancelAnimationFrame(selectionMovePreviewFrameRef.current);
      selectionMovePreviewFrameRef.current = null;
    }
    if (interactionGuidesFrameRef.current != null) {
      window.cancelAnimationFrame(interactionGuidesFrameRef.current);
      interactionGuidesFrameRef.current = null;
    }
  }, []);

  useEffect(() => () => {
    if (wheelZoomChromeTimerRef.current != null) {
      window.clearTimeout(wheelZoomChromeTimerRef.current);
      wheelZoomChromeTimerRef.current = null;
    }
    clearWheelZoomSession();
  }, [clearWheelZoomSession]);

  useEffect(() => () => {
    if (interactionFastModeTimerRef.current != null) {
      window.clearTimeout(interactionFastModeTimerRef.current);
      interactionFastModeTimerRef.current = null;
    }
  }, []);

  useEffect(() => () => {
    writeWorkspaceScaleToDom(1);
  }, [writeWorkspaceScaleToDom]);

  useEffect(() => {
    const handleUiPointerDown = (event: PointerEvent | MouseEvent) => {
      stabilizeViewportAfterUiInteraction(event.target);
    };
    document.addEventListener("pointerdown", handleUiPointerDown, true);
    document.addEventListener("mousedown", handleUiPointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", handleUiPointerDown, true);
      document.removeEventListener("mousedown", handleUiPointerDown, true);
    };
  }, [stabilizeViewportAfterUiInteraction]);

  useEffect(() => {
    const appCenter = viewportRef.current?.closest(".dg-app-center");
    if (!(appCenter instanceof HTMLElement)) return;
    appCenter.classList.toggle("dg-interaction-fast-mode", isInteractionFastMode);
    return () => {
      appCenter.classList.remove("dg-interaction-fast-mode");
    };
  }, [isInteractionFastMode]);

  const clearDoubleClickToggleTimers = useCallback(() => {
    if (canvasDoubleClickTimerRef.current != null) {
      window.clearTimeout(canvasDoubleClickTimerRef.current);
      canvasDoubleClickTimerRef.current = null;
    }
    if (viewportDoubleClickTimerRef.current != null) {
      window.clearTimeout(viewportDoubleClickTimerRef.current);
      viewportDoubleClickTimerRef.current = null;
    }
  }, []);

  const cancelCanvasInteractionsForProjectPageAction = useCallback(() => {
    const viewport = viewportRef.current;
    const releasePointer = (pointerId: number | null | undefined) => {
      if (pointerId == null) return;
      try {
        viewport?.releasePointerCapture?.(pointerId);
      } catch {
        // Pointer capture can already be gone by the time a page action runs.
      }
    };

    clearDoubleClickToggleTimers();
    doublePressPanArmedRef.current = false;
    canvasDoublePressArmedRef.current = false;
    doublePressGestureEligibleRef.current = false;
    lastPrimaryPressRef.current = null;

    releasePointer(bridgedCanvasPointerRef.current.pointerId);
    releasePointer(pointerGestureRef.current.pointerId);
    releasePointer(resizeRef.current.pointerId);
    releasePointer(selectionMoveRef.current.pointerId);
    releasePointer(selectionPressRef.current.pointerId);
    releasePointer(selectionRotateRef.current.pointerId);
    releasePointer(lineEndpointRef.current.pointerId);
    releasePointer(pathPointRef.current.pointerId);
    releasePointer(imageBrushRef.current.pointerId);
    releasePointer(projectPageMoveRef.current.pointerId);

    bridgedCanvasPointerRef.current = { active: false, pointerId: null };
    pointerGestureRef.current = {
      pointerId: null,
      startClientX: 0,
      startClientY: 0,
      moved: true,
    };
    panGestureRef.current = { fromBlankCanvas: false, moved: false };
    panDragDetectedRef.current = false;
    isPanningRef.current = false;
    setIsPanning(false);
    resizeRef.current = {
      active: false,
      pointerId: null,
      handle: null,
      startClientX: 0,
      startClientY: 0,
      startBounds: null,
      lastBounds: null,
    };
    selectionMoveRef.current = {
      active: false,
      pointerId: null,
      startClientX: 0,
      startClientY: 0,
      lastDx: 0,
      lastDy: 0,
    };
    resetSelectionPress();
    selectionRotateRef.current = {
      active: false,
      pointerId: null,
      centerClientX: 0,
      centerClientY: 0,
      startAngleDeg: 0,
      startSelectionRotationDeg: 0,
      lastDeltaDeg: Number.NaN,
    };
    lineEndpointRef.current = { active: false, pointerId: null, endpoint: null, anchor: null };
    pathPointRef.current = { active: false, pointerId: null, pointIndex: null, pointKind: "anchor" };
    imageBrushRef.current = { active: false, pointerId: null };
    projectPageMoveRef.current = {
      active: false,
      pointerId: null,
      pageId: "",
      startClientX: 0,
      startClientY: 0,
      startX: 0,
      startY: 0,
      lastX: 0,
      lastY: 0,
      moved: false,
      selectOnRelease: false,
    };
    hideImageBrushCursor();

    const wheelGesture = wheelGestureRef.current;
    if (wheelGesture.frame != null) {
      window.cancelAnimationFrame(wheelGesture.frame);
    }
    wheelGestureRef.current = {
      frame: null,
      kind: "none",
      panX: 0,
      panY: 0,
      zoomDeltaY: 0,
      cropDeltaY: 0,
      clientX: 0,
      clientY: 0,
      trackpad: false,
    };
    clearWheelZoomSession();
    if (wheelZoomChromeTimerRef.current != null) {
      window.clearTimeout(wheelZoomChromeTimerRef.current);
      wheelZoomChromeTimerRef.current = null;
    }
    setIsWheelZooming(false);

    if (panOffsetVisualFrameRef.current != null) {
      window.cancelAnimationFrame(panOffsetVisualFrameRef.current);
      panOffsetVisualFrameRef.current = null;
    }
    syncPanOffsetRefToRendered();

    activeTouchPointsRef.current.clear();
    clearPinchGesture();
    resetSelectionMovePreviewOffset();
    clearProjectPageMovePreview();
    clearInteractionGuides();
    clearInteractionFastModeTimer();
    setInteractionFastModeState(false);
  }, [
    clearDoubleClickToggleTimers,
    clearWheelZoomSession,
    syncPanOffsetRefToRendered,
    clearPinchGesture,
    resetSelectionMovePreviewOffset,
    clearProjectPageMovePreview,
    hideImageBrushCursor,
    clearInteractionGuides,
    clearInteractionFastModeTimer,
    setInteractionFastModeState,
    resetSelectionPress,
  ]);

  const markWheelZoomInteractionActive = useCallback(() => {
    if (!isWheelZooming) {
      setIsWheelZooming(true);
    }
    engageInteractionFastMode(WHEEL_ZOOM_CHROME_SETTLE_MS + 42);
    if (wheelZoomChromeTimerRef.current != null) {
      window.clearTimeout(wheelZoomChromeTimerRef.current);
    }
    wheelZoomChromeTimerRef.current = window.setTimeout(() => {
      wheelZoomChromeTimerRef.current = null;
      setIsWheelZooming(false);
      clearWheelZoomSession();
    }, WHEEL_ZOOM_MOMENTUM_LOCK_MS);
  }, [clearWheelZoomSession, engageInteractionFastMode, isWheelZooming]);

  const shouldSuppressDoubleClickActions = useCallback(() => {
    if (!doublePressGestureEligibleRef.current) return true;
    if (spaceHeld || isPanningRef.current || imageBrushActive) return true;
    if (pointerGestureRef.current.moved || panGestureRef.current.moved || panDragDetectedRef.current) return true;
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if ((now - recentPanDragAtRef.current) < DOUBLE_CLICK_SUPPRESS_AFTER_PAN_MS) return true;
    return false;
  }, [imageBrushActive, spaceHeld]);

  const shouldSuppressCanvasDoubleClickActions = useCallback(() => {
    if (spaceHeld || isPanningRef.current || imageBrushActive) return true;
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if ((now - recentPanDragAtRef.current) < DOUBLE_CLICK_SUPPRESS_AFTER_PAN_MS) return true;
    return false;
  }, [imageBrushActive, spaceHeld]);

  const scheduleViewportDoubleClickAction = useCallback(() => {
    if (!onCanvasOutsideDoubleClick) return;
    if (viewportDoubleClickTimerRef.current != null) {
      window.clearTimeout(viewportDoubleClickTimerRef.current);
    }
    viewportDoubleClickTimerRef.current = window.setTimeout(() => {
      viewportDoubleClickTimerRef.current = null;
      if (shouldSuppressDoubleClickActions()) return;
      doublePressGestureEligibleRef.current = false;
      onCanvasOutsideDoubleClick();
    }, DOUBLE_CLICK_MENU_TOGGLE_DELAY_MS);
  }, [onCanvasOutsideDoubleClick, shouldSuppressDoubleClickActions]);

  const fireCanvasDoubleClickAction = useCallback((point: { x: number; y: number }) => {
    if (!onCanvasDoubleClick) return;
    if (shouldSuppressCanvasDoubleClickActions()) return;
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const recent = recentCanvasDoubleClickActionRef.current;
    if (
      recent
      && (now - recent.time) <= 160
      && Math.hypot(point.x - recent.x, point.y - recent.y) <= 6
    ) {
      return;
    }
    recentCanvasDoubleClickActionRef.current = { time: now, x: point.x, y: point.y };
    doublePressGestureEligibleRef.current = false;
    onCanvasDoubleClick(point);
  }, [onCanvasDoubleClick, shouldSuppressCanvasDoubleClickActions]);

  const scaledW = canvasWidth * stageScale;
  const scaledH = canvasHeight * stageScale;
  const normalizedProjectPages = React.useMemo(
    () => normalizeCanvasProjectPages(projectPages, activeProjectPageId, canvasWidth, canvasHeight, artboardFill),
    [activeProjectPageId, artboardFill, canvasHeight, canvasWidth, projectPages],
  );
  const projectPagesGeometry = React.useMemo(
    () => buildCanvasProjectPagesGeometry(
      normalizedProjectPages.pages,
      normalizedProjectPages.activePageId,
      projectPagesLayout,
      canvasWidth,
      canvasHeight,
    ),
    [canvasHeight, canvasWidth, normalizedProjectPages.activePageId, normalizedProjectPages.pages, projectPagesLayout],
  );
  // Latest placements for the page-drag snap (read inside the pointer-move handler
  // without widening its dependency array). Positions are stable mid-drag (the drag
  // only moves a visual preview), so reading the committed placements is correct.
  const projectPagePlacementsRef = React.useRef(projectPagesGeometry.placements);
  projectPagePlacementsRef.current = projectPagesGeometry.placements;
  // Inline rename draft for the active-page control (null = not editing).
  const [pageNameDraft, setPageNameDraft] = useState<string | null>(null);
  const workspaceWidthPx = projectPagesGeometry.width * stageScale;
  const workspaceHeightPx = projectPagesGeometry.height * stageScale;
  const activeProjectPagePlacement = projectPagesGeometry.placements.find((placement) => placement.active)
    || projectPagesGeometry.placements[0]
    || {
      page: normalizedProjectPages.pages[0],
      x: 0,
      y: 0,
      width: canvasWidth,
      height: canvasHeight,
      active: true,
    };
  const resolveSelectionPageTransfer = useCallback((
    dx: number,
    dy: number,
  ): TranslateSelectionGestureEvent["pageTransfer"] => {
    if (!bounds) return null;
    const movedCenterX = activeProjectPagePlacement.x + bounds.x + bounds.w / 2 + dx;
    const movedCenterY = activeProjectPagePlacement.y + bounds.y + bounds.h / 2 + dy;
    const targetPlacement = projectPagesGeometry.placements.find((placement) => (
      !placement.active
      && movedCenterX >= placement.x
      && movedCenterX <= placement.x + placement.width
      && movedCenterY >= placement.y
      && movedCenterY <= placement.y + placement.height
    ));
    if (!targetPlacement) return null;
    return {
      targetPageId: targetPlacement.page.id,
      dx: Math.round(dx + activeProjectPagePlacement.x - targetPlacement.x),
      dy: Math.round(dy + activeProjectPagePlacement.y - targetPlacement.y),
    };
  }, [activeProjectPagePlacement, bounds, projectPagesGeometry.placements]);
  const gridOverlayStyle = React.useMemo<React.CSSProperties | null>(() => {
    if (!gridEnabled) return null;
    const baseStep = Math.max(2, Math.round(Number(gridSize || 8))) * Math.max(0.05, stageScale);
    const showMinorGrid = baseStep >= 8;
    const majorMultiplier = showMinorGrid
      ? 4
      : Math.max(4, Math.ceil(18 / Math.max(0.5, baseStep)));
    const majorStep = Math.max(baseStep * majorMultiplier, 18);
    const backgroundImage = [
      ...(showMinorGrid
        ? [
          "linear-gradient(to right, rgba(15, 23, 42, 0.08) 1px, transparent 1px)",
          "linear-gradient(to bottom, rgba(15, 23, 42, 0.08) 1px, transparent 1px)",
        ]
        : []),
      "linear-gradient(to right, rgba(15, 23, 42, 0.16) 1px, transparent 1px)",
      "linear-gradient(to bottom, rgba(15, 23, 42, 0.16) 1px, transparent 1px)",
    ].join(", ");
    const backgroundSize = [
      ...(showMinorGrid
        ? [`${baseStep}px ${baseStep}px`, `${baseStep}px ${baseStep}px`]
        : []),
      `${majorStep}px ${majorStep}px`,
      `${majorStep}px ${majorStep}px`,
    ].join(", ");
    const backgroundPosition = [
      ...(showMinorGrid ? ["0 0", "0 0"] : []),
      "0 0",
      "0 0",
    ].join(", ");
    return {
      position: "absolute",
      inset: 0,
      pointerEvents: "none",
      backgroundImage,
      backgroundSize,
      backgroundPosition,
      opacity: 0.95,
      zIndex: 1,
    };
  }, [gridEnabled, gridSize, stageScale]);

  const toArtboardDocPoint = useCallback((
    clientX: number,
    clientY: number,
    options?: { requireInside?: boolean },
  ) => {
    const rect = artboardRef.current?.getBoundingClientRect();
    if (!rect) return null;
    if (
      options?.requireInside
      && (
        clientX < rect.left
        || clientX > rect.right
        || clientY < rect.top
        || clientY > rect.bottom
      )
    ) {
      return null;
    }
    return clientPointToRenderedDocPoint(clientX, clientY, rect, canvasWidth, canvasHeight);
  }, [canvasHeight, canvasWidth]);

  const asCanvasPointerEvent = useCallback((e: React.PointerEvent): React.PointerEvent<HTMLCanvasElement> | null => {
    const canvas = canvasRef?.current;
    if (!canvas) return null;
    return {
      button: e.button,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      pointerId: e.pointerId,
      clientX: e.clientX,
      clientY: e.clientY,
      currentTarget: canvas,
    } as unknown as React.PointerEvent<HTMLCanvasElement>;
  }, [canvasRef]);

  const lineEndpoints = React.useMemo(() => {
    if (summary.count !== 1 || selectedNodeKind !== "line" || !selectedNodeGeometry) return null;
    const g = selectedNodeGeometry;
    const p1 = { x: Number(g.x || 0), y: Number(g.y || 0) };
    const p2 = { x: p1.x + Number(g.width || 0), y: p1.y + Number(g.height || 0) };
    const rot = Number(g.rotation || 0);
    if (!rot) return { start: p1, end: p2 };
    const rad = (rot * Math.PI) / 180;
    const cx = p1.x + Number(g.width || 0) / 2;
    const cy = p1.y + Number(g.height || 0) / 2;
    const rotate = (p: { x: number; y: number }) => {
      const dx = p.x - cx;
      const dy = p.y - cy;
      return {
        x: cx + dx * Math.cos(rad) - dy * Math.sin(rad),
        y: cy + dx * Math.sin(rad) + dy * Math.cos(rad),
      };
    };
    return { start: rotate(p1), end: rotate(p2) };
  }, [summary.count, selectedNodeKind, selectedNodeGeometry]);

  useEffect(() => {
    if (mode === "text_edit" || isInlineTextEditing) {
      setSpaceHeld(false);
    }
  }, [mode, isInlineTextEditing]);

  useEffect(() => {
    if (!inlineTextEdit) {
      lastInlineTextEditorNodeIdRef.current = null;
      return;
    }
    inlineTextOpenedAtRef.current = typeof performance !== "undefined" ? performance.now() : Date.now();
    const textarea = inlineTextEditorRef.current;
    if (!textarea) return;
    const shouldResetCaret = lastInlineTextEditorNodeIdRef.current !== inlineTextEdit.nodeId;
    lastInlineTextEditorNodeIdRef.current = inlineTextEdit.nodeId;
    const rafId = window.requestAnimationFrame(() => {
      textarea.focus({ preventScroll: true });
      if (shouldResetCaret) {
        const length = textarea.value.length;
        // Fresh placeholder text → select all so the first keystroke replaces it
        // (Canva behavior), instead of appending after "New text".
        const isPlaceholder = /^(new text|fit text|novo texto|texto ajust[a\u00e1]vel)$/i.test(textarea.value.trim());
        if (isPlaceholder) {
          textarea.select();
        } else {
          textarea.setSelectionRange(length, length);
        }
      }
    });
    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [inlineTextEdit]);

  useEffect(() => () => {
    if (inlineTextBlurCommitTimerRef.current != null) {
      window.clearTimeout(inlineTextBlurCommitTimerRef.current);
      inlineTextBlurCommitTimerRef.current = null;
    }
  }, []);

  const keepInlineTextEditorVisible = useCallback(() => {
    const textarea = inlineTextEditorRef.current;
    if (!textarea || !inlineTextEdit) return;
    const viewportBounds = window.visualViewport
      ? {
        top: window.visualViewport.offsetTop,
        bottom: window.visualViewport.offsetTop + window.visualViewport.height,
      }
      : {
        top: 0,
        bottom: window.innerHeight,
      };
    const rect = textarea.getBoundingClientRect();
    let deltaY = 0;
    if (rect.bottom > viewportBounds.bottom - MOBILE_KEYBOARD_SAFE_MARGIN_PX) {
      deltaY = rect.bottom - (viewportBounds.bottom - MOBILE_KEYBOARD_SAFE_MARGIN_PX);
    } else if (rect.top < viewportBounds.top + MOBILE_KEYBOARD_SAFE_MARGIN_PX) {
      deltaY = rect.top - (viewportBounds.top + MOBILE_KEYBOARD_SAFE_MARGIN_PX);
    }
    if (Math.abs(deltaY) < 1) return;
    applyPanOffset({
      x: panOffsetRef.current.x,
      y: Math.round(panOffsetRef.current.y - deltaY),
    }, { immediate: true });
  }, [applyPanOffset, inlineTextEdit]);

  useEffect(() => {
    if (!inlineTextEdit) return undefined;
    const scheduleAdjust = () => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          keepInlineTextEditorVisible();
        });
      });
    };
    scheduleAdjust();
    const visualViewport = window.visualViewport;
    if (!visualViewport) return undefined;
    visualViewport.addEventListener("resize", scheduleAdjust);
    visualViewport.addEventListener("scroll", scheduleAdjust);
    return () => {
      visualViewport.removeEventListener("resize", scheduleAdjust);
      visualViewport.removeEventListener("scroll", scheduleAdjust);
    };
  }, [inlineTextEdit, keepInlineTextEditorVisible]);

  useEffect(() => {
    function down(e: KeyboardEvent) {
      if (e.code !== "Space" || e.repeat) return;
      if (
        mode === "text_edit"
        || isInlineTextEditing
        || isKeyboardEditableTarget(e.target)
        || isKeyboardInMenuContext(e.target)
      ) {
        setSpaceHeld(false);
        return;
      }
      e.preventDefault();
      setSpaceHeld(true);
    }
    function up(e: KeyboardEvent) {
      if (e.code === "Space") setSpaceHeld(false);
    }
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [mode, isInlineTextEditing]);

  useEffect(() => {
    if (!imageBrushActive) {
      imageBrushRef.current = { active: false, pointerId: null };
      hideImageBrushCursor();
    }
  }, [hideImageBrushCursor, imageBrushActive]);

  useEffect(() => () => {
    clearDoubleClickToggleTimers();
  }, [clearDoubleClickToggleTimers]);

  const handleViewportPointerDownCapture = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "touch") {
      activeTouchPointsRef.current.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });
      if (activeTouchPointsRef.current.size >= 2 && maybeStartPinchGesture()) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
    }
    if (e.button !== 0) {
      doublePressPanArmedRef.current = false;
      canvasDoublePressArmedRef.current = false;
      return;
    }
    const target = getEventElement(e.target);
    if (!target) {
      doublePressPanArmedRef.current = false;
      canvasDoublePressArmedRef.current = false;
      return;
    }
    const isInteractiveOverlay = isCanvasInteractionUiTarget(target);
    if (isInteractiveOverlay || isInlineTextEditing || mode === "text_edit" || imageBrushActive) {
      doublePressPanArmedRef.current = false;
      canvasDoublePressArmedRef.current = false;
      return;
    }
    const isViewportSurface = target === e.currentTarget;
    const isCanvasSurface = !isViewportSurface && !!artboardRef.current?.contains(target);
    if (!isViewportSurface && !isCanvasSurface) {
      doublePressPanArmedRef.current = false;
      canvasDoublePressArmedRef.current = false;
      return;
    }
    const surface: "canvas" | "viewport" = isViewportSurface ? "viewport" : "canvas";
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const prev = lastPrimaryPressRef.current;
    const withinDelay = !!prev && (now - prev.time) <= DOUBLE_PRESS_PAN_MAX_DELAY_MS;
    const withinDistance = !!prev && Math.hypot(e.clientX - prev.x, e.clientY - prev.y) <= DOUBLE_PRESS_PAN_MAX_DISTANCE_PX;
    const sameSurface = !!prev && prev.surface === surface;
    const armed = Boolean(prev && sameSurface && withinDelay && withinDistance);
    doublePressPanArmedRef.current = isViewportSurface && armed;
    canvasDoublePressArmedRef.current = isCanvasSurface && armed;
    lastPrimaryPressRef.current = { time: now, x: e.clientX, y: e.clientY, surface };
    if (canvasDoublePressArmedRef.current) {
      const point = toArtboardDocPoint(e.clientX, e.clientY, { requireInside: true });
      canvasDoublePressArmedRef.current = false;
      if (!point) return;
      e.preventDefault();
      e.stopPropagation();
      fireCanvasDoubleClickAction(point);
    }
  }, [isInlineTextEditing, mode, imageBrushActive, toArtboardDocPoint, fireCanvasDoubleClickAction, maybeStartPinchGesture]);

  const handleViewportPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === "touch" && pinchGestureRef.current.active) {
      e.preventDefault();
      return;
    }
    clearDoubleClickToggleTimers();
    const target = getEventElement(e.target);
    if (!target) return;
    const isInteractiveOverlay = isCanvasInteractionUiTarget(target);
    const blankCanvasPress = e.button === 0 && target === e.currentTarget;
    const doubleClickPanArmed = doublePressPanArmedRef.current;
    doublePressPanArmedRef.current = false;
    doublePressGestureEligibleRef.current = e.button === 0 && doubleClickPanArmed;
    if (isInteractiveOverlay) {
      doublePressGestureEligibleRef.current = false;
      return;
    }
    const isDoubleClickPanGesture =
      e.button === 0
      && doubleClickPanArmed
      && blankCanvasPress
      && !isInteractiveOverlay
      && !isInlineTextEditing
      && mode !== "text_edit"
      && !imageBrushActive;
    if (e.button === 0) {
      pointerGestureRef.current = {
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        moved: false,
      };
    }
    const shouldBridgeViewportMarquee =
      blankCanvasPress
      && e.button === 0
      && e.pointerType !== "touch"
      && !spaceHeld
      && !isDoubleClickPanGesture
      && allowBlankViewportMarquee
      && mode !== "pan"
      && mode !== "text_edit"
      && !isInlineTextEditing
      && !imageBrushActive
      && !!toArtboardDocPoint(e.clientX, e.clientY, { requireInside: true })
      && !!onPointerDown;
    if (shouldBridgeViewportMarquee) {
      const proxiedEvent = asCanvasPointerEvent(e);
      if (proxiedEvent) {
        e.preventDefault();
        onPointerDown?.(proxiedEvent);
        bridgedCanvasPointerRef.current = { active: true, pointerId: e.pointerId };
        return;
      }
    }
    const shouldPan =
      e.button === 1 ||
      (spaceHeld && e.button === 0) ||
      isDoubleClickPanGesture ||
      (mode === "pan" && e.button === 0 && !isInteractiveOverlay);

    if (shouldPan) {
      e.preventDefault();
      isPanningRef.current = true;
      setIsPanning(true);
      engageInteractionFastMode();
      panGestureRef.current = { fromBlankCanvas: blankCanvasPress, moved: false };
      panDragDetectedRef.current = false;
      panStartRef.current = { x: e.clientX, y: e.clientY };
      panOffsetStartRef.current = { ...panOffsetRef.current };
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    }
  }, [
    clearDoubleClickToggleTimers,
    spaceHeld,
    mode,
    isInlineTextEditing,
    imageBrushActive,
    onPointerDown,
    asCanvasPointerEvent,
    allowBlankViewportMarquee,
    engageInteractionFastMode,
    toArtboardDocPoint,
  ]);

  const beginSelectionMoveGesture = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (!hasSelection || isSelectionLocked) return;
    const target = getEventElement(e.target);
    const explicitMoveControl = !!target?.closest(".dg-selection-quick-stack");
    const point = toArtboardDocPoint(e.clientX, e.clientY, { requireInside: true });
    if (!point && !explicitMoveControl) return;
    if (e.detail >= 2) {
      e.preventDefault();
      e.stopPropagation();
      if (!point) return;
      fireCanvasDoubleClickAction(point);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    resetSelectionPress();
    selectionMoveRef.current = {
      active: true,
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      lastDx: 0,
      lastDy: 0,
    };
    resetSelectionMovePreviewOffset();
    clearInteractionGuides();
    onTranslateSelectionGesture?.({ phase: "start", dx: 0, dy: 0, altKey: e.altKey, metaKey: e.metaKey, shiftKey: e.shiftKey });
    engageInteractionFastMode();
    viewportRef.current?.setPointerCapture?.(e.pointerId);
  }, [hasSelection, isSelectionLocked, onTranslateSelectionGesture, toArtboardDocPoint, fireCanvasDoubleClickAction, resetSelectionMovePreviewOffset, clearInteractionGuides, engageInteractionFastMode, resetSelectionPress]);

  const beginDeferredSelectionPress = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (!hasSelection || isSelectionLocked) return;
    const point = toArtboardDocPoint(e.clientX, e.clientY, { requireInside: true });
    if (!point) return;
    if (e.detail >= 2) {
      e.preventDefault();
      e.stopPropagation();
      resetSelectionPress();
      fireCanvasDoubleClickAction(point);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    selectionPressRef.current = {
      active: true,
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      altKey: e.altKey,
      metaKey: e.metaKey,
      ctrlKey: e.ctrlKey,
      shiftKey: e.shiftKey,
    };
    viewportRef.current?.setPointerCapture?.(e.pointerId);
  }, [fireCanvasDoubleClickAction, hasSelection, isSelectionLocked, resetSelectionPress, toArtboardDocPoint]);

  const beginSelectionRotateGesture = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    if (!hasSelection || !bounds || isSelectionLocked) return;
    const artboardRect = artboardRef.current?.getBoundingClientRect();
    if (!artboardRect) return;
    e.preventDefault();
    e.stopPropagation();
    const centerClientX = artboardRect.left + (bounds.x + bounds.w / 2) * stageScale;
    const centerClientY = artboardRect.top + (bounds.y + bounds.h / 2) * stageScale;
    const startAngleDeg = (Math.atan2(e.clientY - centerClientY, e.clientX - centerClientX) * 180) / Math.PI;
    selectionRotateRef.current = {
      active: true,
      pointerId: e.pointerId,
      centerClientX,
      centerClientY,
      startAngleDeg,
      startSelectionRotationDeg: Number(selectionRotationBaseDeg || 0),
      lastDeltaDeg: Number.NaN,
    };
    onRotateSelectionGesture?.({ phase: "start", deltaDeg: 0 });
    engageInteractionFastMode();
    viewportRef.current?.setPointerCapture?.(e.pointerId);
  }, [hasSelection, bounds, isSelectionLocked, stageScale, onRotateSelectionGesture, selectionRotationBaseDeg, engageInteractionFastMode]);

  const beginLineEndpointGesture = useCallback((endpoint: "start" | "end") => (e: React.PointerEvent<HTMLDivElement>) => {
    if (!lineEndpoints || isSelectionLocked) return;
    e.preventDefault();
    e.stopPropagation();
    lineEndpointRef.current = {
      active: true,
      pointerId: e.pointerId,
      endpoint,
      anchor: endpoint === "start" ? lineEndpoints.end : lineEndpoints.start,
    };
    onLineEndpointGesture?.({ phase: "start", endpoint });
    engageInteractionFastMode();
    viewportRef.current?.setPointerCapture?.(e.pointerId);
  }, [lineEndpoints, isSelectionLocked, onLineEndpointGesture, engageInteractionFastMode]);

  const beginPathPointGesture = useCallback((pointIndex: number, pointKind: PathHandleKind) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (!Array.isArray(pathEditData?.points) || !pathEditData.points.length || isSelectionLocked) return;
    e.preventDefault();
    e.stopPropagation();
    pathPointRef.current = {
      active: true,
      pointerId: e.pointerId,
      pointIndex,
      pointKind,
    };
    onPathPointGesture?.({ phase: "start", pointIndex, pointKind });
    engageInteractionFastMode();
    viewportRef.current?.setPointerCapture?.(e.pointerId);
  }, [pathEditData, isSelectionLocked, onPathPointGesture, engageInteractionFastMode]);

  const handleViewportPointerMove = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === "touch") {
      if (activeTouchPointsRef.current.has(e.pointerId)) {
        activeTouchPointsRef.current.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });
      }
      if (pinchGestureRef.current.active) {
        const touches = Array.from(activeTouchPointsRef.current.values()).slice(0, 2);
        if (touches.length >= 2) {
          const distance = Math.hypot(
            touches[0].clientX - touches[1].clientX,
            touches[0].clientY - touches[1].clientY,
          );
          if (Number.isFinite(distance) && distance >= PINCH_MIN_DISTANCE_PX) {
            const centerX = (touches[0].clientX + touches[1].clientX) / 2;
            const centerY = (touches[0].clientY + touches[1].clientY) / 2;
            const nextZoom = Number((
              pinchGestureRef.current.startZoom * (distance / Math.max(PINCH_MIN_DISTANCE_PX, pinchGestureRef.current.startDistance))
            ).toFixed(2));
            applyZoomAtClient(nextZoom, centerX, centerY, {
              anchorDocX: pinchGestureRef.current.anchorDocX,
              anchorDocY: pinchGestureRef.current.anchorDocY,
            });
            recentPanDragAtRef.current = typeof performance !== "undefined" ? performance.now() : Date.now();
          }
        }
        e.preventDefault();
        return;
      }
    }
    if (projectPageMoveRef.current.active) {
      if (projectPageMoveRef.current.pointerId != null && e.pointerId !== projectPageMoveRef.current.pointerId) return;
      const gesture = projectPageMoveRef.current;
      const movedPx = Math.hypot(e.clientX - gesture.startClientX, e.clientY - gesture.startClientY);
      if (!gesture.moved && movedPx < SELECTION_PRESS_DRAG_THRESHOLD_PX) return;
      const dx = Math.round((e.clientX - gesture.startClientX) / Math.max(0.0001, stageScale));
      const dy = Math.round((e.clientY - gesture.startClientY) / Math.max(0.0001, stageScale));
      let nextX = Math.round(gesture.startX + dx);
      let nextY = Math.round(gesture.startY + dy);
      // Snap to neighbour pages' edges/centers unless Cmd/Meta is held (free move).
      if (!e.metaKey) {
        const placements = projectPagePlacementsRef.current;
        const self = placements.find((p) => p.page.id === gesture.pageId);
        if (self && placements.length > 1) {
          const others = placements.filter((p) => p.page.id !== gesture.pageId);
          const snapped = snapProjectPagePosition(nextX, nextY, self.width, self.height, others, 10 / Math.max(0.0001, stageScale));
          nextX = snapped.x;
          nextY = snapped.y;
        }
      }
      gesture.moved = true;
      if (nextX === gesture.lastX && nextY === gesture.lastY) return;
      gesture.lastX = nextX;
      gesture.lastY = nextY;
      e.preventDefault();
      scheduleProjectPageMovePreview(nextX - gesture.startX, nextY - gesture.startY);
      return;
    }
    if (pointerGestureRef.current.pointerId != null && e.pointerId === pointerGestureRef.current.pointerId && !pointerGestureRef.current.moved) {
      const dx = Math.abs(e.clientX - pointerGestureRef.current.startClientX);
      const dy = Math.abs(e.clientY - pointerGestureRef.current.startClientY);
      if (dx > 3 || dy > 3) {
        pointerGestureRef.current.moved = true;
      }
    }

    if (
      bridgedCanvasPointerRef.current.active
      && bridgedCanvasPointerRef.current.pointerId === e.pointerId
      && e.target === e.currentTarget
    ) {
      const proxiedEvent = asCanvasPointerEvent(e);
      if (proxiedEvent) {
        onPointerMove?.(proxiedEvent);
      }
      return;
    }

    if (pathPointRef.current.active && pathPointRef.current.pointIndex != null) {
      if (pathPointRef.current.pointerId != null && e.pointerId !== pathPointRef.current.pointerId) return;
      const pointer = toArtboardDocPoint(e.clientX, e.clientY);
      if (!pointer) return;
      onPathPointGesture?.({
        phase: "move",
        pointIndex: pathPointRef.current.pointIndex,
        pointKind: pathPointRef.current.pointKind,
        point: pointer,
      });
      return;
    }

    if (lineEndpointRef.current.active && lineEndpointRef.current.anchor && lineEndpointRef.current.endpoint) {
      if (lineEndpointRef.current.pointerId != null && e.pointerId !== lineEndpointRef.current.pointerId) return;
      const pointer = toArtboardDocPoint(e.clientX, e.clientY);
      if (!pointer) return;
      const anchor = lineEndpointRef.current.anchor;
      const snappedPointer = snapPointToCompass(anchor, pointer, {
        enabled: !!snapEnabled,
        force: e.shiftKey,
        thresholdDeg: COMPASS_SNAP_THRESHOLD_DEG,
        stepDeg: COMPASS_SNAP_STEP_DEG,
      });
      const movingStart = lineEndpointRef.current.endpoint === "start";
      const p1 = movingStart ? snappedPointer : anchor;
      const p2 = movingStart ? anchor : snappedPointer;
      onLineEndpointGesture?.({
        phase: "move",
        endpoint: lineEndpointRef.current.endpoint,
        nextGeometry: {
          x: Math.round(p1.x),
          y: Math.round(p1.y),
          width: Math.round(p2.x - p1.x),
          height: Math.round(p2.y - p1.y),
          rotation: 0,
        },
      });
      return;
    }

    if (selectionPressRef.current.active) {
      if (selectionPressRef.current.pointerId != null && e.pointerId !== selectionPressRef.current.pointerId) return;
      const press = { ...selectionPressRef.current };
      const movedPx = Math.hypot(e.clientX - press.startClientX, e.clientY - press.startClientY);
      if (movedPx < SELECTION_PRESS_DRAG_THRESHOLD_PX) return;
      resetSelectionPress();
      selectionMoveRef.current = {
        active: true,
        pointerId: e.pointerId,
        startClientX: press.startClientX,
        startClientY: press.startClientY,
        lastDx: 0,
        lastDy: 0,
      };
      resetSelectionMovePreviewOffset();
      clearInteractionGuides();
      onTranslateSelectionGesture?.({
        phase: "start",
        dx: 0,
        dy: 0,
        altKey: press.altKey,
        metaKey: press.metaKey,
        shiftKey: press.shiftKey,
      });
      engageInteractionFastMode();
    }

    if (selectionMoveRef.current.active) {
      if (selectionMoveRef.current.pointerId != null && e.pointerId !== selectionMoveRef.current.pointerId) return;
      const dx = Math.round((e.clientX - selectionMoveRef.current.startClientX) / Math.max(0.0001, stageScale));
      const dy = Math.round((e.clientY - selectionMoveRef.current.startClientY) / Math.max(0.0001, stageScale));
      if (dx === selectionMoveRef.current.lastDx && dy === selectionMoveRef.current.lastDy) return;
      selectionMoveRef.current.lastDx = dx;
      selectionMoveRef.current.lastDy = dy;
      onTranslateSelectionGesture?.({ phase: "move", dx, dy, altKey: e.altKey, metaKey: e.metaKey, shiftKey: e.shiftKey });
      const delegatedOffset = selectionMovePreviewOffsetRefProp?.current;
      const nextOffset = delegatedOffset || { dx, dy };
      scheduleSelectionMovePreviewOffset(nextOffset.dx, nextOffset.dy);
      scheduleInteractionGuides(Array.isArray(gestureGuidesRef?.current) ? [...gestureGuidesRef.current] : []);
      return;
    }

    if (selectionRotateRef.current.active) {
      if (selectionRotateRef.current.pointerId != null && e.pointerId !== selectionRotateRef.current.pointerId) return;
      const currentAngleDeg = (Math.atan2(
        e.clientY - selectionRotateRef.current.centerClientY,
        e.clientX - selectionRotateRef.current.centerClientX,
      ) * 180) / Math.PI;
      let deltaDeg = currentAngleDeg - selectionRotateRef.current.startAngleDeg;
      while (deltaDeg > 180) deltaDeg -= 360;
      while (deltaDeg < -180) deltaDeg += 360;
      deltaDeg = snapRotationDeltaToCompass(deltaDeg, selectionRotateRef.current.startSelectionRotationDeg, {
        enabled: !!snapEnabled,
        force: e.shiftKey,
        thresholdDeg: COMPASS_SNAP_THRESHOLD_DEG,
        stepDeg: COMPASS_SNAP_STEP_DEG,
      });
      deltaDeg = Math.round(deltaDeg * 10) / 10;
      if (deltaDeg === selectionRotateRef.current.lastDeltaDeg) return;
      selectionRotateRef.current.lastDeltaDeg = deltaDeg;
      onRotateSelectionGesture?.({ phase: "move", deltaDeg });
      return;
    }

    if (resizeRef.current.active && resizeRef.current.startBounds && resizeRef.current.handle) {
      if (resizeRef.current.pointerId != null && e.pointerId !== resizeRef.current.pointerId) return;

      const dx = (e.clientX - resizeRef.current.startClientX) / Math.max(0.0001, stageScale);
      const dy = (e.clientY - resizeRef.current.startClientY) / Math.max(0.0001, stageScale);
      const fromCenter = e.altKey;
      const resizeSnapTolerance = Math.max(1, Number(snapTolerance || 20));
      const lockAspectRatio =
        mode !== "crop" &&
        summary.count === 1 &&
        (selectedNodeKind === "image" || selectedNodeKind === "text") &&
        // Rotated single nodes resize in local space (resizeSelectionFromBounds);
        // aspect-locking the AABB would feed a skewed delta into that path.
        Math.abs(Number(selectedNodeGeometry?.rotation || 0)) < 0.001 &&
        isCornerResizeHandle(resizeRef.current.handle);
      let nextBounds = lockAspectRatio
        ? calculateAspectLockedResizeBounds(
          resizeRef.current.startBounds,
          resizeRef.current.handle,
          dx,
          dy,
          fromCenter,
        )
        : calculateResizeBounds(
          resizeRef.current.startBounds,
          resizeRef.current.handle,
          dx,
          dy,
          fromCenter,
        );
      if (snapEnabled) {
        nextBounds = lockAspectRatio
          ? snapAspectLockedResizeBoundsToArtboard(
            resizeRef.current.startBounds,
            resizeRef.current.handle,
            nextBounds,
            { width: canvasWidth, height: canvasHeight },
            resizeSnapTolerance,
            fromCenter,
          )
          : snapResizeBoundsToArtboard(
            resizeRef.current.startBounds,
            resizeRef.current.handle,
            nextBounds,
            { width: canvasWidth, height: canvasHeight },
            resizeSnapTolerance,
            fromCenter,
          );
      }
      resizeRef.current.lastBounds = nextBounds;
      writeResizePreviewBoundsToDom();
      if (resizeRef.current.startBounds && onResizeSelectionGesture) {
        onResizeSelectionGesture?.({
          phase: "move",
          handle: resizeRef.current.handle,
          originalBounds: resizeRef.current.startBounds,
          nextBounds,
        });
      } else {
        onResizeSelectedNode?.({
          x: nextBounds.x,
          y: nextBounds.y,
          width: nextBounds.w,
          height: nextBounds.h,
        });
      }
      return;
    }

    if (!isPanningRef.current) return;
    const dx = e.clientX - panStartRef.current.x;
    const dy = e.clientY - panStartRef.current.y;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      panDragDetectedRef.current = true;
      recentPanDragAtRef.current = typeof performance !== "undefined" ? performance.now() : Date.now();
    }
    if (panGestureRef.current.fromBlankCanvas && !panGestureRef.current.moved && Math.abs(dx) <= 3 && Math.abs(dy) <= 3) {
      return;
    }
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      panGestureRef.current.moved = true;
    }
    const nextPanOffset = {
      x: panOffsetStartRef.current.x + dx,
      y: panOffsetStartRef.current.y + dy,
    };
    applyPanOffset(nextPanOffset);
  }, [
    onResizeSelectedNode,
    onResizeSelectionGesture,
    onTranslateSelectionGesture,
    onRotateSelectionGesture,
    onLineEndpointGesture,
    stageScale,
    toArtboardDocPoint,
    snapEnabled,
    snapTolerance,
    summary.count,
    selectedNodeKind,
    canvasWidth,
    canvasHeight,
    onPointerMove,
    asCanvasPointerEvent,
    applyZoomAtClient,
    applyPanOffset,
    selectionMovePreviewOffsetRefProp,
    gestureGuidesRef,
    resetSelectionPress,
    resetSelectionMovePreviewOffset,
    clearInteractionGuides,
    engageInteractionFastMode,
    scheduleSelectionMovePreviewOffset,
    scheduleInteractionGuides,
    scheduleProjectPageMovePreview,
    onMoveProjectPage,
    writeResizePreviewBoundsToDom,
  ]);

  const handleViewportPointerUp = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === "touch") {
      activeTouchPointsRef.current.delete(e.pointerId);
      if (pinchGestureRef.current.active) {
        if (activeTouchPointsRef.current.size < 2) {
          clearPinchGesture();
          recentPanDragAtRef.current = typeof performance !== "undefined" ? performance.now() : Date.now();
          releaseInteractionFastMode();
        }
        return;
      }
    }
    const wasSimpleViewportClick =
      pointerGestureRef.current.pointerId != null
      && e.pointerId === pointerGestureRef.current.pointerId
      && !pointerGestureRef.current.moved
      && e.target === e.currentTarget;
    if (pointerGestureRef.current.pointerId != null && e.pointerId === pointerGestureRef.current.pointerId) {
      pointerGestureRef.current.pointerId = null;
      pointerGestureRef.current.moved = false;
    }
    if (bridgedCanvasPointerRef.current.active && bridgedCanvasPointerRef.current.pointerId === e.pointerId) {
      const shouldProxy = e.target === e.currentTarget;
      bridgedCanvasPointerRef.current = { active: false, pointerId: null };
      if (shouldProxy) {
        const proxiedEvent = asCanvasPointerEvent(e);
        if (proxiedEvent) {
          onPointerUp?.(proxiedEvent);
        }
        return;
      }
    }

    if (projectPageMoveRef.current.active) {
      if (projectPageMoveRef.current.pointerId != null && e.pointerId !== projectPageMoveRef.current.pointerId) return;
      const gesture = { ...projectPageMoveRef.current };
      projectPageMoveRef.current = {
        active: false,
        pointerId: null,
        pageId: "",
        startClientX: 0,
        startClientY: 0,
        startX: 0,
        startY: 0,
        lastX: 0,
        lastY: 0,
        moved: false,
        selectOnRelease: false,
      };
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
      } catch {
        // Synthetic events and interrupted gestures can lose pointer capture first.
      }
      releaseInteractionFastMode();
      clearProjectPageMovePreview();
      if (gesture.moved) {
        suppressProjectPageClickRef.current = gesture.pageId;
        window.setTimeout(() => {
          if (suppressProjectPageClickRef.current === gesture.pageId) {
            suppressProjectPageClickRef.current = null;
          }
        }, 0);
        onMoveProjectPage?.({
          pageId: gesture.pageId,
          x: gesture.lastX,
          y: gesture.lastY,
          phase: "end",
        });
        return;
      }
      if (gesture.selectOnRelease) {
        suppressProjectPageClickRef.current = gesture.pageId;
        cancelCanvasInteractionsForProjectPageAction();
        onSelectProjectPage?.(gesture.pageId);
        window.setTimeout(() => {
          if (suppressProjectPageClickRef.current === gesture.pageId) {
            suppressProjectPageClickRef.current = null;
          }
        }, 0);
      }
      return;
    }

    if (selectionPressRef.current.active) {
      if (selectionPressRef.current.pointerId != null && e.pointerId !== selectionPressRef.current.pointerId) return;
      const press = { ...selectionPressRef.current };
      resetSelectionPress();
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
      if (String(e.type) === "pointercancel") return;
      const point = toArtboardDocPoint(e.clientX, e.clientY, { requireInside: true });
      if (point) {
        onSelectionChromeClick?.({
          point,
          shiftKey: press.shiftKey || e.shiftKey,
          metaKey: press.metaKey || e.metaKey,
          ctrlKey: press.ctrlKey || e.ctrlKey,
        });
      }
      return;
    }

    if (lineEndpointRef.current.active) {
      const snapshot = { ...lineEndpointRef.current };
      lineEndpointRef.current = { active: false, pointerId: null, endpoint: null, anchor: null };
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
      if (!snapshot.endpoint) return;
      releaseInteractionFastMode();
      onLineEndpointGesture?.({ phase: "end", endpoint: snapshot.endpoint });
      return;
    }

    if (pathPointRef.current.active && pathPointRef.current.pointIndex != null) {
      const pointIndex = pathPointRef.current.pointIndex;
      const pointKind = pathPointRef.current.pointKind;
      pathPointRef.current = { active: false, pointerId: null, pointIndex: null, pointKind: "anchor" };
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
      releaseInteractionFastMode();
      onPathPointGesture?.({
        phase: "end",
        pointIndex,
        pointKind,
      });
      return;
    }

    if (selectionMoveRef.current.active) {
      const snapshot = { ...selectionMoveRef.current };
      const delegatedOffset = selectionMovePreviewOffsetRefProp?.current;
      const releaseOffset = delegatedOffset || { dx: snapshot.lastDx, dy: snapshot.lastDy };
      const pageTransfer = resolveSelectionPageTransfer(releaseOffset.dx, releaseOffset.dy);
      selectionMoveRef.current = { active: false, pointerId: null, startClientX: 0, startClientY: 0, lastDx: 0, lastDy: 0 };
      resetSelectionMovePreviewOffset();
      clearInteractionGuides();
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
      releaseInteractionFastMode();
      onTranslateSelectionGesture?.({ phase: "end", shiftKey: e.shiftKey, pageTransfer });
      return;
    }

    if (selectionRotateRef.current.active) {
      selectionRotateRef.current = {
        active: false,
        pointerId: null,
        centerClientX: 0,
        centerClientY: 0,
        startAngleDeg: 0,
        startSelectionRotationDeg: 0,
        lastDeltaDeg: Number.NaN,
      };
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
      releaseInteractionFastMode();
      onRotateSelectionGesture?.({ phase: "end" });
      return;
    }

    if (resizeRef.current.active) {
      const snapshot = { ...resizeRef.current };
      resizeRef.current = {
        active: false,
        pointerId: null,
        handle: null,
        startClientX: 0,
        startClientY: 0,
        startBounds: null,
        lastBounds: null,
      };
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
      releaseInteractionFastMode();
      if (snapshot.startBounds && snapshot.handle && onResizeSelectionGesture) {
        onResizeSelectionGesture?.({
          phase: "end",
          handle: snapshot.handle,
          originalBounds: snapshot.startBounds,
          nextBounds: snapshot.lastBounds || undefined,
        });
      }
      return;
    }
    if (isPanningRef.current) {
      const shouldResetSelection = panGestureRef.current.fromBlankCanvas && !panGestureRef.current.moved;
      if (panDragDetectedRef.current) {
        recentPanDragAtRef.current = typeof performance !== "undefined" ? performance.now() : Date.now();
      }
      isPanningRef.current = false;
      setIsPanning(false);
      panGestureRef.current = { fromBlankCanvas: false, moved: false };
      panDragDetectedRef.current = false;
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
      releaseInteractionFastMode();
      if (shouldResetSelection) {
        onCanvasBlankClick?.();
      }
      return;
    }

    if (wasSimpleViewportClick) {
      onCanvasBlankClick?.();
    }
  }, [
    onCanvasBlankClick,
    onResizeSelectionGesture,
    onTranslateSelectionGesture,
    onRotateSelectionGesture,
    onLineEndpointGesture,
    onPathPointGesture,
    onPointerUp,
    onSelectionChromeClick,
    asCanvasPointerEvent,
    clearPinchGesture,
    clearInteractionGuides,
    releaseInteractionFastMode,
    resolveSelectionPageTransfer,
    resetSelectionMovePreviewOffset,
    resetSelectionPress,
    selectionMovePreviewOffsetRefProp,
    toArtboardDocPoint,
    onMoveProjectPage,
    onSelectProjectPage,
    cancelCanvasInteractionsForProjectPageAction,
    clearProjectPageMovePreview,
  ]);

  const shouldHandleCanvasWheel = useCallback((target: EventTarget | null): boolean => {
    const viewportEl = viewportRef.current;
    if (!viewportEl) return false;
    const targetNode = typeof Node !== "undefined" && target instanceof Node ? target : null;
    if (!targetNode) return false;
    if (!viewportEl.contains(targetNode)) return false;
    const targetElement = getEventElement(target);
    if (targetElement) {
      if (targetElement.closest(CANVAS_WHEEL_BLOCKING_UI_SELECTOR)) return false;
      if (targetElement.closest("input, textarea, select, button, [contenteditable='true'], [role='button']")) return false;
    }
    const artboardEl = artboardRef.current;
    const canvasEl = canvasRef?.current;
    if (canvasEl && (targetNode === canvasEl || canvasEl.contains(targetNode))) return true;
    if (artboardEl && (targetNode === artboardEl || artboardEl.contains(targetNode))) return true;
    // Also allow wheel-pan on the surrounding canvas area inside viewport.
    return true;
  }, [canvasRef]);

  const flushWheelGesture = useCallback(() => {
    const gesture = wheelGestureRef.current;
    gesture.frame = null;
    const kind = gesture.kind;
    const panX = gesture.panX;
    const panY = gesture.panY;
    const zoomDeltaY = gesture.zoomDeltaY;
    const cropDeltaY = gesture.cropDeltaY;
    const clientX = gesture.clientX;
    const clientY = gesture.clientY;
    const trackpad = gesture.trackpad;
    const zoomSession = wheelZoomSessionRef.current;
    gesture.kind = "none";
    gesture.panX = 0;
    gesture.panY = 0;
    gesture.zoomDeltaY = 0;
    gesture.cropDeltaY = 0;
    gesture.trackpad = false;

    if (kind === "pan") {
      if (Math.abs(panX) < 0.01 && Math.abs(panY) < 0.01) return;
      engageInteractionFastMode(WHEEL_ZOOM_CHROME_SETTLE_MS + 42);
      const nextPanOffset = {
        x: panOffsetRef.current.x - panX,
        y: panOffsetRef.current.y - panY,
      };
      applyPanOffset(nextPanOffset, { immediate: trackpad });
      return;
    }

    if (kind === "crop") {
      if (!onCropWheel || Math.abs(cropDeltaY) < 0.01) return;
      engageInteractionFastMode(WHEEL_ZOOM_CHROME_SETTLE_MS + 42);
      const point = toArtboardDocPoint(clientX, clientY, { requireInside: true });
      if (point) {
        onCropWheel({ deltaY: cropDeltaY, point });
      }
      return;
    }

    if (kind !== "zoom" || !onZoomChange || Math.abs(zoomDeltaY) < 0.01) return;

    const currentZoom = normalizeUiZoomPercent(zoomRef.current);
    const zoomFactor = computeWheelZoomFactor(zoomDeltaY, { trackpad });
    const next = normalizeUiZoomPercent(currentZoom * zoomFactor, currentZoom);
    applyZoomAtClient(
      next,
      zoomSession.active ? zoomSession.anchorClientX : clientX,
      zoomSession.active ? zoomSession.anchorClientY : clientY,
      {
        anchorDocX: zoomSession.active ? zoomSession.anchorDocX : undefined,
        anchorDocY: zoomSession.active ? zoomSession.anchorDocY : undefined,
        anchorGeometry: zoomSession.active ? zoomSession.geometry : null,
      },
    );
  }, [applyPanOffset, applyZoomAtClient, engageInteractionFastMode, onCropWheel, toArtboardDocPoint]);

  const scheduleWheelGestureFlush = useCallback(() => {
    const gesture = wheelGestureRef.current;
    if (gesture.frame != null) return;
    gesture.frame = window.requestAnimationFrame(() => {
      flushWheelGesture();
    });
  }, [flushWheelGesture]);

  useEffect(() => () => {
    const frame = wheelGestureRef.current.frame;
    if (frame != null) {
      window.cancelAnimationFrame(frame);
      wheelGestureRef.current.frame = null;
    }
    activeTouchPointsRef.current.clear();
    clearPinchGesture();
  }, []);

  const handleWheel = useCallback((e: WheelEvent) => {
    if (!shouldHandleCanvasWheel(e.target)) return;
    e.preventDefault();
    const viewportHeightPx = Math.max(1, viewportRef.current?.clientHeight || 800);
    const deltaX = normalizeWheelDeltaToPixels(e.deltaX, e.deltaMode, viewportHeightPx);
    const deltaY = normalizeWheelDeltaToPixels(e.deltaY, e.deltaMode, viewportHeightPx);
    const pinchLikeTrackpad = e.ctrlKey && !e.metaKey && e.deltaMode === 0;
    const trackpad = pinchLikeTrackpad || isLikelyTrackpadWheel(e, deltaX, deltaY);
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const wantsZoom = e.ctrlKey || e.metaKey;
    const wheelZoomSession = wheelZoomSessionRef.current;
    const lockedToZoomMomentum =
      !wantsZoom
      && wheelZoomSession.active
      && (now - wheelZoomSession.lastEventAt) <= WHEEL_ZOOM_MOMENTUM_LOCK_MS;
    if (lockedToZoomMomentum) {
      const gesture = wheelGestureRef.current;
      if (gesture.kind === "pan") {
        gesture.kind = "none";
        gesture.panX = 0;
        gesture.panY = 0;
      }
      return;
    }
    if (!wantsZoom && wheelZoomSession.active) {
      clearWheelZoomSession();
    }
    if (!wantsZoom && mode === "crop" && onCropWheel) {
      const gesture = wheelGestureRef.current;
      if (gesture.kind !== "crop") {
        gesture.kind = "crop";
        gesture.panX = 0;
        gesture.panY = 0;
        gesture.zoomDeltaY = 0;
        gesture.cropDeltaY = 0;
        gesture.trackpad = false;
      }
      gesture.cropDeltaY += deltaY;
      gesture.clientX = e.clientX;
      gesture.clientY = e.clientY;
      scheduleWheelGestureFlush();
      return;
    }
    if (wantsZoom) {
      markWheelZoomInteractionActive();
      const shouldRefreshAnchor =
        !wheelZoomSession.active
        || (now - wheelZoomSession.lastEventAt) > WHEEL_ZOOM_SESSION_GAP_MS
        || Math.abs(wheelZoomSession.anchorClientX - e.clientX) > 28
        || Math.abs(wheelZoomSession.anchorClientY - e.clientY) > 28;
      if (shouldRefreshAnchor) {
        const viewportRect = viewportRef.current?.getBoundingClientRect();
        const workspaceRect = workspaceRef.current?.getBoundingClientRect();
        const artboardRect = artboardRef.current?.getBoundingClientRect();
        const anchorPoint = artboardRect
          ? clientPointToRenderedDocPoint(e.clientX, e.clientY, artboardRect, canvasWidth, canvasHeight)
          : null;
        const renderedScale = artboardRect
          ? Math.max(
            0.0001,
            artboardRect.width / Math.max(1, canvasWidth),
            artboardRect.height / Math.max(1, canvasHeight),
          )
          : 1;
        wheelZoomSession.active = true;
        wheelZoomSession.anchorClientX = e.clientX;
        wheelZoomSession.anchorClientY = e.clientY;
        wheelZoomSession.anchorDocX = anchorPoint ? anchorPoint.x : canvasWidth / 2;
        wheelZoomSession.anchorDocY = anchorPoint ? anchorPoint.y : canvasHeight / 2;
        wheelZoomSession.geometry = viewportRect && workspaceRect && artboardRect
          ? {
            viewportCenterX: viewportRect.left + viewportRect.width / 2,
            viewportCenterY: viewportRect.top + viewportRect.height / 2,
            workspaceWidth: workspaceRect.width,
            workspaceHeight: workspaceRect.height,
            activePageOffsetX: artboardRect.left - workspaceRect.left,
            activePageOffsetY: artboardRect.top - workspaceRect.top,
            renderedScale,
          }
          : null;
      }
      wheelZoomSession.lastEventAt = now;
      const gesture = wheelGestureRef.current;
      if (gesture.kind !== "zoom") {
        gesture.kind = "zoom";
        gesture.panX = 0;
        gesture.panY = 0;
        gesture.zoomDeltaY = 0;
        gesture.cropDeltaY = 0;
        gesture.trackpad = false;
      }
      gesture.zoomDeltaY += deltaY;
      gesture.clientX = e.clientX;
      gesture.clientY = e.clientY;
      gesture.trackpad = gesture.trackpad || trackpad;
      scheduleWheelGestureFlush();
    } else {
      let panX = deltaX;
      let panY = deltaY;
      if (e.shiftKey) {
        // Shift+wheel is horizontal navigation. Browsers/devices may report the
        // same gesture through either axis, so use the dominant wheel delta.
        const horizontalDelta = Math.abs(deltaX) >= Math.abs(deltaY) ? deltaX : deltaY;
        panX = Math.abs(horizontalDelta) > 0.01 ? horizontalDelta : 0;
        panY = 0;
      }
      const gesture = wheelGestureRef.current;
      if (gesture.kind !== "pan") {
        gesture.kind = "pan";
        gesture.panX = 0;
        gesture.panY = 0;
        gesture.zoomDeltaY = 0;
        gesture.cropDeltaY = 0;
        gesture.trackpad = false;
      }
      gesture.panX += panX;
      gesture.panY += panY;
      gesture.clientX = e.clientX;
      gesture.clientY = e.clientY;
      gesture.trackpad = gesture.trackpad || trackpad;
      scheduleWheelGestureFlush();
    }
  }, [shouldHandleCanvasWheel, mode, onCropWheel, canvasHeight, canvasRef, canvasWidth, scheduleWheelGestureFlush, markWheelZoomInteractionActive, clearWheelZoomSession]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onWheel = (event: WheelEvent) => {
      handleWheel(event);
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      viewport.removeEventListener("wheel", onWheel);
    };
  }, [handleWheel]);

  const handleViewportDoubleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = getEventElement(e.target);
    if (!target) return;
    if (isCanvasInteractionUiTarget(target)) return;
    if (target.closest("button, input, textarea, select, [contenteditable='true'], [role='button']")) return;
    const isArtboardTarget = !!artboardRef.current?.contains(target);
    if (isArtboardTarget) {
      if (shouldSuppressCanvasDoubleClickActions()) return;
      const point = toArtboardDocPoint(e.clientX, e.clientY, { requireInside: true });
      if (!point) return;
      fireCanvasDoubleClickAction(point);
      return;
    }
    if (shouldSuppressDoubleClickActions()) return;
    scheduleViewportDoubleClickAction();
  }, [
    scheduleViewportDoubleClickAction,
    shouldSuppressDoubleClickActions,
    shouldSuppressCanvasDoubleClickActions,
    fireCanvasDoubleClickAction,
    toArtboardDocPoint,
  ]);

  const cursorStyle = isPanning || spaceHeld
    ? (isPanning ? "grabbing" : "grab")
    : (mode === "pan" ? "grab" : (cursorOverride || "default"));

  const effectiveSelectionMovePreviewOffset = selectionMovePreviewOffsetProp || selectionMovePreviewOffset;
  const selectionMoveActive = Boolean(
    selectionMoveRasterPreview
    || selectionMoveRef.current.active
    || Math.abs(Number(effectiveSelectionMovePreviewOffset.dx || 0)) > 0.001
    || Math.abs(Number(effectiveSelectionMovePreviewOffset.dy || 0)) > 0.001,
  );
  const displayedSelectionBounds = bounds && selectionMoveActive
    ? {
      x: bounds.x + Number(effectiveSelectionMovePreviewOffset.dx || 0),
      y: bounds.y + Number(effectiveSelectionMovePreviewOffset.dy || 0),
      w: bounds.w,
      h: bounds.h,
    }
    : bounds;
  // Resize also keeps the frame mounted (Canva style): re-renders
  // during resize come from the bounds preview, so reading the ref here
  // reflects the in-progress gesture.
  const selectionResizeActive = !!resizeRef.current.active;
  // Keep the selection chrome visible during pan/zoom. It lives INSIDE the
  // workspace/pan-layer, which are live-transformed (scale during wheel-zoom,
  // translate during pan) directly on the DOM, so the chrome tracks the gesture
  // instead of blinking out and back ("everything flickering"). Only an explicit
  // suspend request hides it now.
  const chromeSuspended = suspendSelectionChrome;
  const selectionChromeVisible = !chromeSuspended;
  const hideCompactResizeHandles = compactViewport
    && !!bounds
    && (
      bounds.w * stageScale < 32
      || bounds.h * stageScale < 32
    );
  const showToolbar = !chromeSuspended
    && (hasSelection || mode === "select" || mode === "crop" || mode === "path_edit" || mode === "text_edit" || mode === "view_only");
  const toolbarAnchor = "top_center" as const;
  const isSingleLine = summary.count === 1 && selectedNodeKind === "line";
  const canResizeHandles = selectionChromeVisible
    && summary.count >= 1
    && mode !== "pan"
    && mode !== "text_edit"
    && mode !== "crop"
    && !isSingleLine
    && !isSelectionLocked
    && !hideCompactResizeHandles
    && !imageBrushActive;
  const pathEditVisible = selectionChromeVisible
    && mode === "path_edit"
    && Array.isArray(pathEditData?.points)
    && pathEditData.points.length >= 2
    && !isSelectionLocked
    && !imageBrushActive;
  const pathEditOverlayD = (pathEditVisible && pathEditData)
    ? pathEditOverlayPathD(pathEditData.points, !!pathEditData.closed)
    : "";
  const interactionGuidesOverlay = interactionGuides.length ? (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        zIndex: 8,
      }}
    >
      {interactionGuides.map((guide, index) => {
        const tone = interactionGuideTone(guide.source);
        const label = interactionGuideLabel(guide, canvasWidth, canvasHeight);
        const showLabel = !selectionMoveActive;
        const linePosition = Number(guide.value || 0) * stageScale;
        if (guide.axis === "x") {
          const left = clampNumber(linePosition, 0, Math.max(0, scaledW));
          const labelLeft = clampNumber(left + 10, 8, Math.max(8, scaledW - 98));
          return (
            <React.Fragment key={`interaction-guide-x-${guide.source}-${guide.value}-${index}`}>
              <div
                style={{
                  position: "absolute",
                  left,
                  top: 0,
                  width: 0,
                  height: scaledH,
                  borderLeft: `6px solid ${tone.glow}`,
                  opacity: 0.9,
                }}
              />
              <div
                style={{
                  position: "absolute",
                  left,
                  top: 0,
                  width: 0,
                  height: scaledH,
                  borderLeft: `2px ${tone.dash ? "dashed" : "solid"} ${tone.line}`,
                }}
              />
              {showLabel ? (
                <div
                  style={{
                    position: "absolute",
                    left: labelLeft,
                    top: 10,
                    padding: "4px 8px",
                    borderRadius: 999,
                    background: tone.labelBg,
                    color: tone.labelText,
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    boxShadow: `0 8px 20px ${tone.glow}`,
                    whiteSpace: "nowrap",
                  }}
                >
                  {label}
                </div>
              ) : null}
            </React.Fragment>
          );
        }
        const top = clampNumber(linePosition, 0, Math.max(0, scaledH));
        const labelTop = clampNumber(top + 10, 8, Math.max(8, scaledH - 34));
        return (
          <React.Fragment key={`interaction-guide-y-${guide.source}-${guide.value}-${index}`}>
            <div
              style={{
                position: "absolute",
                left: 0,
                top,
                width: scaledW,
                height: 0,
                borderTop: `6px solid ${tone.glow}`,
                opacity: 0.9,
              }}
            />
            <div
              style={{
                position: "absolute",
                left: 0,
                top,
                width: scaledW,
                height: 0,
                borderTop: `2px ${tone.dash ? "dashed" : "solid"} ${tone.line}`,
              }}
            />
            {showLabel ? (
              <div
                style={{
                  position: "absolute",
                  left: 10,
                  top: labelTop,
                  padding: "4px 8px",
                  borderRadius: 999,
                  background: tone.labelBg,
                  color: tone.labelText,
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  boxShadow: `0 8px 20px ${tone.glow}`,
                  whiteSpace: "nowrap",
                }}
              >
                {label}
              </div>
            ) : null}
          </React.Fragment>
        );
      })}
    </div>
  ) : null;

  const beginResize = useCallback((handle: ResizeHandle) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (!bounds || summary.count < 1 || mode === "pan" || isSelectionLocked) return;
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = {
      active: true,
      pointerId: e.pointerId,
      handle,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startBounds: { ...bounds },
      lastBounds: { ...bounds },
    };
    onResizeSelectionGesture?.({
      phase: "start",
      handle,
      originalBounds: { ...bounds },
      nextBounds: { ...bounds },
    });
    engageInteractionFastMode();
    viewportRef.current?.setPointerCapture?.(e.pointerId);
  }, [bounds, summary.count, mode, isSelectionLocked, onResizeSelectionGesture, engageInteractionFastMode]);

  const beginProjectPageMoveGesture = useCallback((
    placement: CanvasProjectPagePlacement,
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (event.button !== 0) return;
    if (!onMoveProjectPage) return;
    event.preventDefault();
    event.stopPropagation();
    cancelCanvasInteractionsForProjectPageAction();
    // From the page-control grip (a sibling of the slot) `closest` misses the
    // slot, so fall back to the active slot for the live drag preview.
    const pageElement = (event.currentTarget as HTMLElement).closest(".dg-canvas-page-slot")
      || document.querySelector(".dg-canvas-page-slot.is-active");
    if (pageElement instanceof HTMLElement) {
      projectPageMovePreviewElementRef.current = pageElement;
      projectPageMovePreviewTransformRef.current = pageElement.style.transform || "";
      projectPageMovePreviewWillChangeRef.current = pageElement.style.willChange || "";
      projectPageMovePreviewZIndexRef.current = pageElement.style.zIndex || "";
      projectPageMovePreviewOffsetRef.current = { dx: 0, dy: 0 };
      pageElement.style.willChange = "transform";
      pageElement.style.zIndex = "999";
    }
    projectPageMoveRef.current = {
      active: true,
      pointerId: event.pointerId,
      pageId: placement.page.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: placement.worldX,
      startY: placement.worldY,
      lastX: placement.worldX,
      lastY: placement.worldY,
      moved: false,
      selectOnRelease: !placement.active,
    };
    engageInteractionFastMode();
    try {
      viewportRef.current?.setPointerCapture?.(event.pointerId);
    } catch {
      // Pointer capture is an enhancement; page movement still works through bubbling.
    }
  }, [cancelCanvasInteractionsForProjectPageAction, engageInteractionFastMode, onMoveProjectPage]);

  const handleCanvasProjectPageSelect = useCallback((pageId: string) => {
    const targetPageId = String(pageId || "").trim();
    if (suppressProjectPageClickRef.current === targetPageId) {
      suppressProjectPageClickRef.current = null;
      return;
    }
    cancelCanvasInteractionsForProjectPageAction();
    onSelectProjectPage?.(targetPageId || pageId);
  }, [
    cancelCanvasInteractionsForProjectPageAction,
    onSelectProjectPage,
  ]);

  const handleInactiveProjectPagePointerDown = useCallback((
    event: React.PointerEvent<HTMLDivElement>,
    placement: CanvasProjectPagePlacement,
  ) => {
    if (event.button !== 0) return;
    if (mode === "pan" || spaceHeld || isPanningRef.current || imageBrushActive) return;
    if (!onSelectProjectPageObject) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * Math.max(1, placement.width);
    const y = ((event.clientY - rect.top) / Math.max(1, rect.height)) * Math.max(1, placement.height);
    if (
      x < 0
      || x > placement.width
      || y < 0
      || y > placement.height
    ) {
      return;
    }
    const hit = hitTestTop(placement.page.doc, x, y, {
      includeLocked: true,
      viewportScale: stageScale,
    });
    if (!hit) return;
    event.preventDefault();
    event.stopPropagation();
    cancelCanvasInteractionsForProjectPageAction();
    onSelectProjectPageObject({ pageId: placement.page.id, nodeId: hit.id });
  }, [
    cancelCanvasInteractionsForProjectPageAction,
    imageBrushActive,
    mode,
    onSelectProjectPageObject,
    spaceHeld,
    stageScale,
  ]);

  const handleCreateCanvasProjectPageAdjacent = useCallback((pageId: string, placement: "right" | "below") => {
    const before = artboardRef.current?.getBoundingClientRect();
    cancelCanvasInteractionsForProjectPageAction();
    onCreateProjectPageAdjacent?.(pageId, placement);
    restoreArtboardViewportFromRect(before);
  }, [cancelCanvasInteractionsForProjectPageAction, onCreateProjectPageAdjacent, restoreArtboardViewportFromRect]);

  return (
    <div
      ref={viewportRef}
      className={`dg-canvas-viewport ${isWheelZooming ? "is-wheel-zooming" : ""} ${isInteractionFastMode ? "is-interaction-fast-mode" : ""}`.trim()}
      style={{
        position: "relative",
        overflow: "hidden",
        overscrollBehavior: "none",
        touchAction: "none",
        WebkitTapHighlightColor: "transparent",
        cursor: cursorStyle,
      }}
      onPointerDownCapture={handleViewportPointerDownCapture}
      onPointerDown={handleViewportPointerDown}
      onPointerMove={handleViewportPointerMove}
      onPointerUp={handleViewportPointerUp}
      onPointerCancel={handleViewportPointerUp}
      onDoubleClick={handleViewportDoubleClick}
    >
      {showToolbar ? (
        <ContextToolbar
          visible
          canvasMode={mode}
          selectionSummary={summary}
          anchor={toolbarAnchor}
          zoom={zoom}
          snapEnabled={snapEnabled}
          gridEnabled={gridEnabled}
          artboardFill={artboardFill}
          textState={textToolbarState}
          shapeState={shapeToolbarState}
          lineState={lineToolbarState}
          elementOpacityState={elementOpacityState}
          imageDuotoneState={imageDuotoneState}
          imageFadeState={imageFadeState}
          imageTraceState={imageTraceState}
          imageBrushState={imageBrushState}
          imageBackgroundRemovalState={imageBackgroundRemovalState}
          documentColors={documentColors}
          onAction={onToolbarAction}
          style={{ top: rulersEnabled ? 30 : 12, left: "50%" }}
        />
      ) : null}

      {rulersEnabled ? (
        <CanvasRulers
          viewportRef={viewportRef}
          artboardRef={artboardRef}
          docWidth={canvasWidth}
          docHeight={canvasHeight}
          scale={stageScale}
          guides={persistentGuides || []}
          onChangeGuides={onChangeGuides || (() => {})}
          dark={rulerDark}
        />
      ) : null}

      <CanvasPagesLayoutSwitch
        layout={projectPagesLayout}
        pageCount={normalizedProjectPages.pages.length}
        onChangeLayout={onProjectPagesLayoutChange}
      />

      {onCreateProjectPageAdjacent && activeProjectPagePlacement?.page ? (
        <div
          className="dg-canvas-pages-fab"
          data-canvas-ui="true"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <span className="dg-canvas-pages-fab-count" aria-hidden="true">
            {normalizedProjectPages.pages.length}
            <span>{normalizedProjectPages.pages.length === 1 ? "page" : "pages"}</span>
          </span>
          <button
            type="button"
            className="dg-canvas-pages-fab-btn"
            title="Add new page"
            aria-label="Add new page"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              cancelCanvasInteractionsForProjectPageAction?.();
              onCreateProjectPageAdjacent(
                activeProjectPagePlacement.page.id,
                projectPagesLayout === "row" ? "right" : "below",
              );
            }}
          >
            <PinselaIcon name="Plus" size={14} />
            <span>New page</span>
          </button>
        </div>
      ) : null}

      <div
        ref={panLayerRef}
        style={{
          position: "absolute",
          inset: 0,
          display: "block",
          transform: panOffsetToTransform(panOffsetRef.current),
          willChange: "transform",
          pointerEvents: "none",
        }}
      >
        <div
          ref={workspaceRef}
          className="dg-canvas-pages-workspace"
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            width: Math.max(1, workspaceWidthPx),
            height: Math.max(1, workspaceHeightPx),
            flexShrink: 0,
            overflow: "visible",
            pointerEvents: "none",
            transform: "translate3d(-50%, -50%, 0)",
            transformOrigin: "top left",
          }}
        >
          {activeProjectPagePlacement?.page ? (() => {
            const ap = activeProjectPagePlacement;
            const apName = String(ap.page.name || "").trim() || "Page";
            const ctrlW = Math.min(360, Math.max(150, Math.round(96 + apName.length * 7.5)));
            const ctrlH = 34;
            const otherRects = projectPagesGeometry.placements.filter((p) => p.page.id !== ap.page.id);
            const abRect = artboardRef.current?.getBoundingClientRect();
            const vpRect = viewportRef.current?.getBoundingClientRect();
            const screenMap = abRect && vpRect
              ? {
                  offsetX: abRect.left - ap.x * stageScale,
                  offsetY: abRect.top - ap.y * stageScale,
                  vLeft: vpRect.left,
                  vTop: vpRect.top,
                  vRight: vpRect.right,
                  vBottom: vpRect.bottom,
                }
              : undefined;
            const anchor = pickPageControlAnchor(ap, otherRects, stageScale, ctrlW, ctrlH, 14, screenMap);
            const canDelete = normalizedProjectPages.pages.length > 1;
            return (
              <React.Fragment>
                <div
                  aria-hidden="true"
                  className="dg-active-page-frame"
                  style={{
                    position: "absolute",
                    left: ap.x * stageScale - 2,
                    top: ap.y * stageScale - 2,
                    width: scaledW + 4,
                    height: scaledH + 4,
                    zIndex: 40,
                  }}
                />
                {!hasSelection ? (
                <div
                  className="dg-page-control"
                  style={{ position: "absolute", left: anchor.left, top: anchor.top, width: ctrlW, height: ctrlH, zIndex: 42 }}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    className="dg-page-control-grip"
                    title="Drag page (hold Cmd to move freely)"
                    aria-label="Drag page"
                    onPointerDown={(e) => { if (e.button === 0) beginProjectPageMoveGesture(ap, e as unknown as React.PointerEvent<HTMLDivElement>); }}
                  >
                    <PinselaIcon name="Move" size={15} />
                  </button>
                  {pageNameDraft != null ? (
                    <input
                      className="dg-page-control-input"
                      autoFocus
                      value={pageNameDraft}
                      spellCheck={false}
                      onChange={(e) => setPageNameDraft(e.target.value)}
                      onPointerDown={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); onRenameProjectPage?.(ap.page.id, pageNameDraft); setPageNameDraft(null); }
                        else if (e.key === "Escape") { e.preventDefault(); setPageNameDraft(null); }
                      }}
                      onBlur={() => { if (pageNameDraft != null) { onRenameProjectPage?.(ap.page.id, pageNameDraft); setPageNameDraft(null); } }}
                    />
                  ) : (
                    <button
                      type="button"
                      className="dg-page-control-name"
                      title="Rename page"
                      onClick={() => setPageNameDraft(apName)}
                    >
                      {apName}
                    </button>
                  )}
                  {canDelete ? (
                    <button
                      type="button"
                      className="dg-page-control-del"
                      title="Delete page"
                      aria-label="Delete page"
                      onClick={() => onDeleteProjectPage?.(ap.page.id)}
                    >
                      <PinselaIcon name="Trash2" size={15} />
                    </button>
                  ) : null}
                </div>
                ) : null}
              </React.Fragment>
            );
          })() : null}
          <div
            className="dg-canvas-page-slot is-active"
            style={{
              position: "absolute",
              left: activeProjectPagePlacement.x * stageScale,
              top: activeProjectPagePlacement.y * stageScale,
              width: scaledW,
              height: scaledH,
              pointerEvents: "none",
              zIndex: Math.max(1, normalizedProjectPages.pages.findIndex((page) => page.id === activeProjectPagePlacement.page.id) + 1),
            }}
          >
        <div
          ref={artboardRef}
          className="dg-canvas-artboard"
          style={{
            position: "relative",
            width: scaledW,
            height: scaledH,
            flexShrink: 0,
            pointerEvents: "auto",
            boxShadow: "var(--glass-shadow-popover)",
            borderRadius: 0,
          }}
        >
          <canvas
            ref={canvasRef as React.RefObject<HTMLCanvasElement>}
            style={{
              width: scaledW,
              height: scaledH,
              display: "block",
              borderRadius: 0,
              background: colorToCssString(artboardFill || "#ffffff"),
              cursor: imageBrushActive && selectedNodeKind === "image"
                ? "none"
                : (isPanning || spaceHeld) ? (isPanning ? "grabbing" : "grab") : (cursorOverride || "default"),
            }}
            onPointerDown={(e) => {
              if (e.pointerType === "touch" && pinchGestureRef.current.active) {
                e.preventDefault();
                return;
              }
              const isDoubleClickPanGesture = e.button === 0 && doublePressPanArmedRef.current;
              if (e.detail >= 2 && !spaceHeld && !isPanningRef.current && mode !== "pan" && !imageBrushActive) {
                e.preventDefault();
                e.stopPropagation();
                const rect = e.currentTarget.getBoundingClientRect();
                fireCanvasDoubleClickAction(clientPointToRenderedDocPoint(e.clientX, e.clientY, rect, canvasWidth, canvasHeight));
                return;
              }
              if (spaceHeld || isPanningRef.current || mode === "pan") return;
              if (isDoubleClickPanGesture) return;
              if (imageBrushActive && selectedNodeKind === "image" && !isSelectionLocked) {
                const rect = e.currentTarget.getBoundingClientRect();
                const { x, y } = clientPointToRenderedDocPoint(e.clientX, e.clientY, rect, canvasWidth, canvasHeight);
                imageBrushRef.current = { active: true, pointerId: e.pointerId };
                scheduleImageBrushCursor({ x, y });
                e.currentTarget.setPointerCapture?.(e.pointerId);
                onImageBrushGesture?.({ phase: "start", pointerId: e.pointerId, point: { x, y } });
                return;
              }
              onPointerDown?.(e);
            }}
            onPointerMove={(e) => {
              if (spaceHeld || isPanningRef.current || mode === "pan") return;
              if (imageBrushActive && selectedNodeKind === "image" && !isSelectionLocked) {
                const rect = e.currentTarget.getBoundingClientRect();
                const { x, y } = clientPointToRenderedDocPoint(e.clientX, e.clientY, rect, canvasWidth, canvasHeight);
                scheduleImageBrushCursor({ x, y });
                if (imageBrushRef.current.active && imageBrushRef.current.pointerId === e.pointerId) {
                  onImageBrushGesture?.({ phase: "move", pointerId: e.pointerId, point: { x, y } });
                }
                return;
              }
              onPointerMove?.(e);
            }}
            onPointerUp={(e) => {
              if (spaceHeld || isPanningRef.current || mode === "pan") return;
              if (imageBrushRef.current.active && imageBrushRef.current.pointerId === e.pointerId) {
                const rect = e.currentTarget.getBoundingClientRect();
                const { x, y } = clientPointToRenderedDocPoint(e.clientX, e.clientY, rect, canvasWidth, canvasHeight);
                imageBrushRef.current = { active: false, pointerId: null };
                e.currentTarget.releasePointerCapture?.(e.pointerId);
                onImageBrushGesture?.({ phase: "end", pointerId: e.pointerId, point: { x, y } });
                return;
              }
              if (imageBrushActive && selectedNodeKind === "image" && !isSelectionLocked) return;
              onPointerUp?.(e);
            }}
            onPointerCancel={(e) => {
              if (spaceHeld || isPanningRef.current || mode === "pan") return;
              if (imageBrushRef.current.active && imageBrushRef.current.pointerId === e.pointerId) {
                const rect = e.currentTarget.getBoundingClientRect();
                const { x, y } = clientPointToRenderedDocPoint(e.clientX, e.clientY, rect, canvasWidth, canvasHeight);
                imageBrushRef.current = { active: false, pointerId: null };
                e.currentTarget.releasePointerCapture?.(e.pointerId);
                onImageBrushGesture?.({ phase: "end", pointerId: e.pointerId, point: { x, y } });
                return;
              }
              if (imageBrushActive && selectedNodeKind === "image" && !isSelectionLocked) return;
              onPointerUp?.(e);
            }}
            onLostPointerCapture={(e) => {
              if (spaceHeld || isPanningRef.current || mode === "pan") return;
              if (imageBrushRef.current.active && imageBrushRef.current.pointerId === e.pointerId) {
                const rect = e.currentTarget.getBoundingClientRect();
                const { x, y } = clientPointToRenderedDocPoint(e.clientX, e.clientY, rect, canvasWidth, canvasHeight);
                imageBrushRef.current = { active: false, pointerId: null };
                onImageBrushGesture?.({ phase: "end", pointerId: e.pointerId, point: { x, y } });
                return;
              }
              if (imageBrushActive && selectedNodeKind === "image" && !isSelectionLocked) return;
              onPointerUp?.(e);
            }}
            onPointerLeave={() => {
              if (!imageBrushRef.current.active) {
                hideImageBrushCursor();
              }
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              if (shouldSuppressCanvasDoubleClickActions()) return;
              const rect = e.currentTarget.getBoundingClientRect();
              fireCanvasDoubleClickAction(clientPointToRenderedDocPoint(e.clientX, e.clientY, rect, canvasWidth, canvasHeight));
            }}
            onDragOver={(e) => {
              if (!hasExternalImagePayload(e.dataTransfer)) {
                onExternalImageDragHover?.(null);
                return;
              }
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
              const rect = e.currentTarget.getBoundingClientRect();
              onExternalImageDragHover?.(clientPointToRenderedDocPoint(e.clientX, e.clientY, rect, canvasWidth, canvasHeight));
            }}
            onDragLeave={() => {
              onExternalImageDragHover?.(null);
            }}
            onDrop={(e) => {
              if (!hasExternalImagePayload(e.dataTransfer)) return;
              e.preventDefault();
              e.stopPropagation();
              onExternalImageDragHover?.(null);
              const files = e.dataTransfer?.files;
              const droppedFiles = Array.from(files || []);
              const importFiles = droppedFiles.filter((file) => {
                const type = String(file.type || "").toLowerCase();
                const name = String(file.name || "");
                return type.includes("svg") || /\.(svg|fig|psd|aff|afdesign|afphoto|afpub|pptx?|pdf|ai|eps|sketch|xd|cdr|indd|idml)$/i.test(name);
              });
              const imageFiles = droppedFiles.filter((file) =>
                !importFiles.includes(file)
                && (
                  String(file.type || "").toLowerCase().startsWith("image/")
                  || /\.(png|jpe?g|webp|gif|bmp|avif|tiff?)$/i.test(String(file.name || ""))
                )
              );
              const imageUrls = extractDroppedImageUrls(e.dataTransfer);
              const rect = e.currentTarget.getBoundingClientRect();
              const point = clientPointToRenderedDocPoint(e.clientX, e.clientY, rect, canvasWidth, canvasHeight);
              if (importFiles.length) onImportFileDrop?.(importFiles, point);
              if (imageFiles.length) onImageFileDrop?.(imageFiles, point);
              if (imageUrls.length) onImageUrlDrop?.(imageUrls, point);
            }}
          />

          {gridOverlayStyle && <div aria-hidden="true" style={gridOverlayStyle} />}

          {selectionMoveRasterPreview && (
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                inset: 0,
                overflow: "hidden",
                pointerEvents: "none",
                userSelect: "none",
                zIndex: 4,
              }}
            >
              <img
                ref={selectionMovePreviewImageRef}
                src={selectionMoveRasterPreview.src}
                alt=""
                draggable={false}
                style={{
                  position: "absolute",
                  left: selectionMoveRasterPreview.x * stageScale,
                  top: selectionMoveRasterPreview.y * stageScale,
                  width: Math.max(1, selectionMoveRasterPreview.width * stageScale),
                  height: Math.max(1, selectionMoveRasterPreview.height * stageScale),
                  transform: `translate3d(${effectiveSelectionMovePreviewOffset.dx * stageScale}px, ${effectiveSelectionMovePreviewOffset.dy * stageScale}px, 0)`,
                  willChange: "transform",
                  pointerEvents: "none",
                  userSelect: "none",
                }}
              />
            </div>
          )}

          {interactionGuidesOverlay}

          {frameDropPreview && (
            <div
              className="dg-frame-drop-preview"
              style={{
                position: "absolute",
                left: frameDropPreview.x * stageScale,
                top: frameDropPreview.y * stageScale,
                width: frameDropPreview.w * stageScale,
                height: frameDropPreview.h * stageScale,
                borderRadius: Math.max(0, Number(frameDropPreview.cornerRadius || 0)) * stageScale,
                pointerEvents: "none",
              }}
            />
          )}

          {marqueeRect && marqueeRect.w > 0 && marqueeRect.h > 0 && (
            <div
              className="dg-marquee-box"
              style={{
                position: "absolute",
                left: marqueeRect.x * stageScale,
                top: marqueeRect.y * stageScale,
                width: marqueeRect.w * stageScale,
                height: marqueeRect.h * stageScale,
                pointerEvents: "none",
              }}
            />
          )}

          {tracePreviewPaths && tracePreviewPaths.length > 0 && (
            <svg
              className="dg-image-trace-preview"
              viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                width: scaledW,
                height: scaledH,
                pointerEvents: "none",
              }}
            >
              <g
                fill="none"
                stroke={tracePreviewStroke || "#22d3ee"}
                strokeWidth={1.2}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {tracePreviewPaths.map((d, idx) => (
                  <path key={`trace_${idx}`} d={d} />
                ))}
              </g>
            </svg>
          )}

          {imageBrushActive && imageBrushCursorVisible && selectedNodeKind === "image" && !isSelectionLocked && (
            <div
              ref={imageBrushCursorElementRef}
              className="dg-image-brush-cursor"
              style={{
                left: 0,
                top: 0,
                width: Math.max(4, imageBrushSize * stageScale),
                height: Math.max(4, imageBrushSize * stageScale),
                borderColor: colorToCssString(imageBrushState?.color || "#ffffff"),
                willChange: "transform",
              }}
            />
          )}

          {hasSelection && displayedSelectionBounds && selectedAutoLayoutState?.active && selectionChromeVisible && !inlineTextEdit && (
            <div
              className="dg-auto-layout-selection"
              style={{
                left: displayedSelectionBounds.x * stageScale,
                top: displayedSelectionBounds.y * stageScale,
                width: displayedSelectionBounds.w * stageScale,
                height: displayedSelectionBounds.h * stageScale,
              }}
            >
              <div className="dg-auto-layout-selection-badge">
                <PinselaIcon name="LayoutTemplate" size={12} />
                <span>AUTO LAYOUT</span>
              </div>
              {selectedAutoLayoutState.empty && (
                <div className="dg-auto-layout-selection-empty">
                  <PinselaIcon name="PackageOpen" size={16} />
                  <span>Empty container</span>
                  <small>Drag elements inside</small>
                </div>
              )}
            </div>
          )}

          {hasSelection && bounds && displayedSelectionBounds && selectionChromeVisible && !inlineTextEdit && (
            <div
              ref={selectionMoveBoundingBoxRef}
              className={`dg-bounding-box ${selectionMoveActive ? "is-moving-preview" : ""} ${selectionResizeActive ? "is-resizing-preview" : ""} ${selectionRotateRef.current.active ? "is-rotating-preview" : ""} ${mode === "crop" ? "is-crop-mode" : ""}`}
              style={{
                position: "absolute",
                // Base = COMMITTED position; the move offset goes in the transform,
                // so the frame follows the object on both the React path and the raster path (direct DOM).
                left: bounds.x * stageScale,
                top: bounds.y * stageScale,
                width: bounds.w * stageScale,
                height: bounds.h * stageScale,
                transform: `translate3d(${Number(effectiveSelectionMovePreviewOffset.dx || 0) * stageScale}px, ${Number(effectiveSelectionMovePreviewOffset.dy || 0) * stageScale}px, 0)`,
                pointerEvents: (selectionMoveActive || isSelectionLocked || inlineTextEdit || imageBrushActive) ? "none" : "auto",
              }}
              onPointerDown={beginDeferredSelectionPress}
              onDoubleClick={(e) => {
                if (shouldSuppressCanvasDoubleClickActions()) return;
                e.stopPropagation();
                const point = toArtboardDocPoint(e.clientX, e.clientY, { requireInside: true });
                if (!point) return;
                fireCanvasDoubleClickAction(point);
              }}
            >
              {canResizeHandles && (
                <>
                  <div className="dg-handle tl" onPointerDown={beginResize("tl")} />
                  <div className="dg-handle tc" onPointerDown={beginResize("tc")} />
                  <div className="dg-handle tr" onPointerDown={beginResize("tr")} />
                  <div className="dg-handle ml" onPointerDown={beginResize("ml")} />
                  <div className="dg-handle mr" onPointerDown={beginResize("mr")} />
                  <div className="dg-handle bl" onPointerDown={beginResize("bl")} />
                  <div className="dg-handle bc" onPointerDown={beginResize("bc")} />
                  <div className="dg-handle br" onPointerDown={beginResize("br")} />
                  {/* Dedicated rotate handle above top-center (reuses the working
                      rotate gesture). Box stays AABB — resize math is axis-aligned. */}
                  <button
                    type="button"
                    className="dg-handle dg-rotate-handle"
                    aria-label="Rotate"
                    title="Rotate"
                    onPointerDown={beginSelectionRotateGesture}
                  />
                </>
              )}
            </div>
          )}

          {mode === "crop" && cropOverlay && (
            // Canva-style crop overlay. Positioned imperatively by a rAF loop
            // (updateCropOverlayDom) reading the LIVE crop from cropLiveRef, so it
            // tracks pan/zoom/frame-resize without re-rendering the editor.
            <div ref={cropOverlayRootRef} className="dg-crop-overlay" aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 6, display: "none" }}>
              <img ref={cropDimImgRef} src={cropOverlay.imageSrc} draggable={false} alt="" className="dg-crop-dim-img" />
              <div ref={cropBrightClipRef} className="dg-crop-bright-clip">
                <img ref={cropBrightImgRef} src={cropOverlay.imageSrc} draggable={false} alt="" className="dg-crop-bright-img" />
              </div>
              <div ref={cropFrameRef} className="dg-crop-frame">
                {/* Corner handles only — cleaner crop UX (user request); side handles felt off. */}
                {(["tl", "tr", "bl", "br"] as ResizeHandle[]).map((h) => (
                  <div key={h} className={`dg-handle ${h}`} style={{ pointerEvents: "auto" }} onPointerDown={beginResize(h)} />
                ))}
              </div>
            </div>
          )}

          {hasSelection && displayedSelectionBounds && selectionMoveActive && !inlineTextEdit && (
            <div
              ref={selectionMoveReadoutRef}
              className="dg-selection-position-readout"
              style={{
                position: "absolute",
                top: 12,
                right: 12,
                pointerEvents: "none",
              }}
            >
              <span>{`X ${Math.round(displayedSelectionBounds.x)}`}</span>
              <span>{`Y ${Math.round(displayedSelectionBounds.y)}`}</span>
            </div>
          )}

          {hasSelection && displayedSelectionBounds && selectionChromeVisible && !inlineTextEdit && !isSelectionLocked && !imageBrushActive && !selectionMoveActive && (
            <>
              <div
                className="dg-selection-quick-stack dg-selection-quick-stack-bottom"
                style={{
                  position: "absolute",
                  left: (displayedSelectionBounds.x + displayedSelectionBounds.w / 2) * stageScale,
                  top: quickActionBarTop(displayedSelectionBounds, stageScale, artboardRef.current, viewportRef.current),
                  transform: "translateX(-50%)",
                  pointerEvents: "none",
                }}
              >
                <div className="dg-selection-quick-row dg-selection-quick-row-bottom">
                  <IconButton
                    size="sm"
                    tone="glass"
                    icon={<PinselaIcon name="Copy" size={14} />}
                    title="Duplicate"
                    tooltipDescription="Duplicates the current selection."
                    onClick={() => onSelectionQuickAction?.("duplicate")}
                  />
                  <IconButton
                    size="sm"
                    tone="glass"
                    danger
                    icon={<PinselaIcon name="Trash2" size={14} />}
                    title="Delete"
                    tooltipDescription="Deletes the current selection."
                    onClick={() => onSelectionQuickAction?.("delete")}
                  />
                  <IconButton
                    size="sm"
                    tone="glass"
                    icon={<PinselaIcon name="Move" size={14} />}
                    title="Move selection"
                    tooltipDescription="Drag this handle to move the selected element(s)."
                    onPointerDown={beginSelectionMoveGesture}
                  />
                  <IconButton
                    size="sm"
                    tone="glass"
                    icon={<PinselaIcon name="RotateCw" size={14} />}
                    title="Rotate"
                    tooltipDescription="Drag to rotate. Snaps near 0°, 45°, 90°… Hold Shift to force snapping."
                    onPointerDown={beginSelectionRotateGesture}
                  />
                </div>
              </div>
            </>
          )}

          {isSingleLine && lineEndpoints && selectionChromeVisible && !isSelectionLocked && !imageBrushActive && (
            <>
              <div
                className="dg-line-endpoint-handle"
                style={{
                  left: lineEndpoints.start.x * stageScale,
                  top: lineEndpoints.start.y * stageScale,
                }}
                onPointerDown={beginLineEndpointGesture("start")}
              />
              <div
                className="dg-line-endpoint-handle"
                style={{
                  left: lineEndpoints.end.x * stageScale,
                  top: lineEndpoints.end.y * stageScale,
                }}
                onPointerDown={beginLineEndpointGesture("end")}
              />
            </>
          )}

          {pathEditVisible && pathEditData && (
            <>
              <svg
                className="dg-path-edit-overlay"
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  width: scaledW,
                  height: scaledH,
                  pointerEvents: "none",
                }}
                viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
              >
                <path
                  d={pathEditOverlayD}
                  fill={pathEditData.closed ? "rgba(255, 214, 120, 0.08)" : "none"}
                  stroke="rgba(255, 214, 120, 0.92)"
                  strokeWidth={1.2}
                  strokeDasharray="6 4"
                />
                {pathEditData.points.map((point) => {
                  const anchor = point.anchor;
                  const handleIn = hasDistinctPathHandle(anchor, point.in) ? point.in : null;
                  const handleOut = hasDistinctPathHandle(anchor, point.out) ? point.out : null;
                  return (
                    <g key={`path-point-guides-${point.index}`}>
                      {handleIn && (
                        <line
                          x1={anchor.x}
                          y1={anchor.y}
                          x2={handleIn.x}
                          y2={handleIn.y}
                          stroke="rgba(214, 226, 255, 0.88)"
                          strokeWidth={1}
                        />
                      )}
                      {handleOut && (
                        <line
                          x1={anchor.x}
                          y1={anchor.y}
                          x2={handleOut.x}
                          y2={handleOut.y}
                          stroke="rgba(214, 226, 255, 0.88)"
                          strokeWidth={1}
                        />
                      )}
                    </g>
                  );
                })}
              </svg>
              {pathEditData.points.map((point) => {
                const anchor = point.anchor;
                const handleIn = hasDistinctPathHandle(anchor, point.in) ? point.in : null;
                const handleOut = hasDistinctPathHandle(anchor, point.out) ? point.out : null;
                const selected = pathEditData.selectedIndex === point.index;
                return (
                  <React.Fragment key={`path-point-${point.index}`}>
                    {handleIn && (
                      <div
                        style={{
                          position: "absolute",
                          left: handleIn.x * stageScale,
                          top: handleIn.y * stageScale,
                          width: 10,
                          height: 10,
                          borderRadius: "999px",
                          border: "1px solid rgba(12, 17, 26, 0.95)",
                          background: "rgba(235, 242, 255, 0.98)",
                          transform: "translate(-50%, -50%)",
                          boxShadow: "0 2px 8px rgba(0, 0, 0, 0.32)",
                          cursor: "crosshair",
                        }}
                        onPointerDown={beginPathPointGesture(point.index, "in")}
                      />
                    )}
                    {handleOut && (
                      <div
                        style={{
                          position: "absolute",
                          left: handleOut.x * stageScale,
                          top: handleOut.y * stageScale,
                          width: 10,
                          height: 10,
                          borderRadius: "999px",
                          border: "1px solid rgba(12, 17, 26, 0.95)",
                          background: "rgba(235, 242, 255, 0.98)",
                          transform: "translate(-50%, -50%)",
                          boxShadow: "0 2px 8px rgba(0, 0, 0, 0.32)",
                          cursor: "crosshair",
                        }}
                        onPointerDown={beginPathPointGesture(point.index, "out")}
                      />
                    )}
                    <div
                      className="dg-path-point-handle"
                      style={{
                        position: "absolute",
                        left: anchor.x * stageScale,
                        top: anchor.y * stageScale,
                        width: selected ? 16 : 14,
                        height: selected ? 16 : 14,
                        borderRadius: "999px",
                        border: selected
                          ? "2px solid rgba(10, 14, 22, 0.96)"
                          : "1px solid rgba(14, 18, 24, 0.9)",
                        background: selected
                          ? "rgba(255, 198, 84, 1)"
                          : "rgba(255, 214, 120, 0.96)",
                        transform: "translate(-50%, -50%)",
                        boxShadow: "0 4px 10px rgba(0, 0, 0, 0.28)",
                        cursor: "move",
                      }}
                      onPointerDown={beginPathPointGesture(point.index, "anchor")}
                    />
                  </React.Fragment>
                );
              })}
            </>
          )}

          {inlineTextEdit && (
            <textarea
              ref={inlineTextEditorRef}
              className="dg-inline-text-editor"
              value={inlineTextEdit.value}
              autoFocus
              style={{
                left: inlineTextEdit.geometry.x * stageScale,
                top: inlineTextEdit.geometry.y * stageScale,
                width: Math.max(40, inlineTextEdit.geometry.width * stageScale),
                height: Math.max(24, inlineTextEdit.geometry.height * stageScale),
                // Leading-trim: raise the textarea by half the leading so the 1st letter
                // sits flush at the top like the painter (otherwise the text "jumps" when editing with
                // tall line height). topTrim = (line height − (ascender+descender))/2.
                transform: (() => {
                  const fsTa = Math.max(1, Number(inlineTextEdit.style?.fontSize || 32));
                  const lhTa = Math.max(1, Number(inlineTextEdit.style?.lineHeight || fsTa * 1.2));
                  const vmTa = getFontVerticalMetrics({ family: inlineTextEdit.style?.fontFamily, size: fsTa, style: inlineTextEdit.style?.fontStyle });
                  const topTrim = Math.max(0, (lhTa - (vmTa.ascent + vmTa.descent)) / 2);
                  const rot = Number(inlineTextEdit.geometry.rotation || 0);
                  return `rotate(${rot}deg) translateY(${(-topTrim * stageScale).toFixed(2)}px)`;
                })(),
                transformOrigin: "top left",
                fontFamily: inlineTextEdit.style?.fontFamily || "Inter",
                fontSize: Math.max(10, Number(inlineTextEdit.style?.fontSize || 32) * stageScale),
                lineHeight: `${Math.max(1, Number(inlineTextEdit.style?.lineHeight || 1.2) * stageScale)}px`,
                fontWeight: inlineTextEdit.style?.fontWeight || 400,
                fontStyle: inlineTextEdit.style?.fontStyle || "normal",
                letterSpacing: Number(inlineTextEdit.style?.letterSpacing || 0) * stageScale,
                textDecorationLine: inlineTextEdit.style?.underline ? "underline" : "none",
                textAlign: inlineTextEdit.style?.textAlign || "left",
                // Opaque: the textarea IS the visible text while editing (the canvas
                // blanks this node), so caret + line-wrap always match what you see.
                color: inlineTextEdit.style?.color || "#111111",
                caretColor: inlineTextEdit.style?.color || "#111111",
                WebkitTextFillColor: inlineTextEdit.style?.color || "#111111",
              }}
              spellCheck={false}
              onFocus={() => {
                if (inlineTextBlurCommitTimerRef.current != null) {
                  window.clearTimeout(inlineTextBlurCommitTimerRef.current);
                  inlineTextBlurCommitTimerRef.current = null;
                }
              }}
              onChange={(e) => {
                // While composing accents/IME, let the native textarea handle it — no re-render.
                if (inlineTextComposingRef.current) return;
                onInlineTextChange?.(e.target.value);
              }}
              onCompositionStart={() => { inlineTextComposingRef.current = true; }}
              onCompositionEnd={(e) => {
                inlineTextComposingRef.current = false;
                onInlineTextChange?.((e.target as HTMLTextAreaElement).value);
              }}
              onBlur={() => {
                if (!onInlineTextCommit) return;
                const now = typeof performance !== "undefined" ? performance.now() : Date.now();
                if ((now - inlineTextOpenedAtRef.current) < INLINE_TEXT_BLUR_GUARD_MS) {
                  window.requestAnimationFrame(() => {
                    inlineTextEditorRef.current?.focus({ preventScroll: true });
                  });
                  return;
                }
                if (inlineTextBlurCommitTimerRef.current != null) {
                  window.clearTimeout(inlineTextBlurCommitTimerRef.current);
                }
                inlineTextBlurCommitTimerRef.current = window.setTimeout(() => {
                  inlineTextBlurCommitTimerRef.current = null;
                  if (document.activeElement === inlineTextEditorRef.current) return;
                  onInlineTextCommit();
                }, 0);
              }}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return;
                if (e.key === "Escape") {
                  e.preventDefault();
                  onInlineTextCancel?.();
                  return;
                }
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  onInlineTextCommit?.();
                }
              }}
              onPointerDown={(e) => e.stopPropagation()}
            />
          )}

          <div
            className="dg-canvas-dimensions"
            style={{
              position: "absolute",
              bottom: -24,
              left: 0,
              right: 0,
              textAlign: "center",
              fontSize: 11,
              fontFamily: "monospace",
              color: "var(--color-text-muted)",
              pointerEvents: "none",
              userSelect: "none",
            }}
          >
            {canvasWidth} × {canvasHeight}
          </div>
        </div>
            <CanvasProjectPageChrome
              page={activeProjectPagePlacement.page}
              index={Math.max(0, normalizedProjectPages.pages.findIndex((page) => page.id === activeProjectPagePlacement.page.id))}
              active
              widthPx={scaledW}
              heightPx={scaledH}
              onBeforePageAction={cancelCanvasInteractionsForProjectPageAction}
              onCreateAdjacentPage={handleCreateCanvasProjectPageAdjacent}
              onMovePagePointerDown={onMoveProjectPage ? (event) => beginProjectPageMoveGesture(activeProjectPagePlacement, event) : undefined}
            />
          </div>
          {projectPagesGeometry.placements.filter((placement) => !placement.active).map((placement, index) => {
            const pageIndex = normalizedProjectPages.pages.findIndex((page) => page.id === placement.page.id);
            const widthPx = Math.max(1, placement.width * stageScale);
            const heightPx = Math.max(1, placement.height * stageScale);
            return (
              <div
                key={placement.page.id}
                className="dg-canvas-page-slot"
                style={{
                  position: "absolute",
                  left: placement.x * stageScale,
                  top: placement.y * stageScale,
                  width: widthPx,
                  height: heightPx,
                  pointerEvents: "none",
                  zIndex: Math.max(1, (pageIndex >= 0 ? pageIndex : index) + 1),
                }}
              >
                <div
                  className="dg-canvas-page-preview"
                  style={{
                    width: widthPx,
                    height: heightPx,
                    background: colorToCssString(placement.page.doc.canvas?.background || "#ffffff"),
                    pointerEvents: "none",
                  }}
                >
                  <CanvasProjectPagePreview
                    doc={placement.page.doc}
                    widthPx={widthPx}
                    heightPx={heightPx}
                    imageCacheRef={projectPagesImageCacheRef}
                  />
                </div>
                <div
                  className="dg-canvas-page-content-hitarea"
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    inset: 0,
                    zIndex: 3,
                    pointerEvents: "auto",
                    cursor: mode === "pan" ? "grab" : "default",
                  }}
                  onPointerDown={(event) => handleInactiveProjectPagePointerDown(event, placement)}
                  onDoubleClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                />
                <CanvasProjectPageChrome
                  page={placement.page}
                  index={pageIndex >= 0 ? pageIndex : index}
                  active={false}
                  widthPx={widthPx}
                  heightPx={heightPx}
                  onBeforePageAction={cancelCanvasInteractionsForProjectPageAction}
                  onSelectPage={handleCanvasProjectPageSelect}
                  onCreateAdjacentPage={handleCreateCanvasProjectPageAdjacent}
                  onMovePagePointerDown={onMoveProjectPage ? (event) => beginProjectPageMoveGesture(placement, event) : undefined}
                />
              </div>
            );
          })}
        </div>
      </div>

      <ZoomHUD
        zoom={zoom}
        onZoomOut={() => onZoomChange?.(Math.max(25, zoom - 10))}
        onZoomIn={() => onZoomChange?.(Math.min(500, zoom + 10))}
      />
    </div>
  );
}
