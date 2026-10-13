import React, { useState, useMemo, useRef, useCallback, useDeferredValue, useEffect } from "react";
import { useLiveDoc } from "../pinsela/platform/live/useLiveDoc";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { PinselaAppShell } from "../pinsela/ui/darkglass/layout/PinselaAppShell";
import { CanvasStage } from "../pinsela/ui/darkglass/canvas/CanvasStage";
import { CanvasContextMenu } from "../pinsela/ui/darkglass/canvas/CanvasContextMenu";
import { readClipboard, parseClipboardMarkerId } from "../pinsela/clipboardStore";
import {
  CanvasToolbelt,
  type CanvasToolId,
  type NavigationToolId,
  type InsertToolId,
  type DrawToolId,
} from "../pinsela/ui/darkglass/canvas/CanvasToolbelt";
import type { CanvasFormat } from "../pinsela/ui/darkglass/canvas/FormatPicker";
import type { AddGuidesValues } from "../pinsela/ui/darkglass/modals";
import type { LeftSectionKey, InspectorTabKey, CanvasMode } from "../pinsela/ui/darkglass/layout/PinselaAppShell";
import type { RightSectionKey } from "../pinsela/ui/darkglass/layout/RightPanel";
import { useEditorEngine } from "../pinsela/hooks/useEditorEngine";
import { useProjectApi } from "../pinsela/hooks/useTemplateApi";
import { useKeyboardShortcuts, type InsertShortcutKind } from "../pinsela/hooks/useKeyboardShortcuts";
import { isKeyboardEditableTarget, isKeyboardInMenuContext } from "../pinsela/hooks/keyboardScope";
import { useCanvasRenderer } from "../pinsela/hooks/useCanvasRenderer";
import { usePointerMachine } from "../pinsela/hooks/usePointerMachine";
import { useViewportMatch } from "../lib/useViewportMatch";
import { useAuth } from "../lib/auth";
import type {
  AutomationTemplateDetail as ApiAutomationTemplateDetail,
  AutomationTemplateSummary as ApiAutomationTemplateSummary,
  AssetItem,
} from "../pinsela/platform/api/pinselaNativeApi";
import {
  fetchNativeProjectByKey,
  fetchNativeProjectDraftByKey,
  saveNativeProjectDraftByKey,
  normalizeDocForEditor,
  removeBackgroundFromImageSource,
  uploadPinselaAsset,
} from "../pinsela/platform/api/pinselaNativeApi";
import { addNode, createEmptyDoc, defaultNode, expandSelectionWithDescendants, moveSelection, removeNodes, uid } from "../pinsela/core/scene";
import { findFreeAdjacentPageRect, nextPageName, selectPagesInProjectOrder } from "../pinsela/core/projectPages";
import {
  applyAutoLayoutDoc,
  canHostAutoLayout,
  findAutoLayoutContentLimitRule,
  isAutoLayoutContainerNode,
  reparentNodesToContainer,
  removeAutoLayoutContentLimitRule,
  upsertAutoLayoutContentLimitRule,
  type AutoLayoutContentLimitPatch,
} from "../pinsela/core/autoLayout";
import {
  areSelectionAllHidden,
  areSelectionAllLocked,
  groupSelectionIntoNewGroup,
  reorderSelection,
  setSelectionLocked,
  setSelectionVisible,
  toggleNodeLock,
  toggleNodeVisible,
  ungroupSelectedGroups,
} from "../pinsela/engine/core/layerOps";
import { alignSelection, distributeSelection, selectionBounds, snapMove, type GuideLine, type SnapOptions } from "../pinsela/core/layout";
import { createHistory, historyUndo } from "../pinsela/core/history";
import { computeSelectionSummary, type SelectionSummary } from "../pinsela/ui/darkglass/canvas/selectionSummary";
import type { ToolbarActionId } from "../pinsela/ui/darkglass/canvas/toolbarModel";
import { resolveAxisLockedDelta, type LockedDragAxis } from "../pinsela/ui/darkglass/canvas/interactionMath";
import { engineZoomToUiPercent, uiPercentToEngineZoom } from "../pinsela/ui/darkglass/canvas/zoomMapping";
import { findFontFamilyEntry } from "../pinsela/ui/darkglass/fonts/fontLibrary";
import type {
  LeftPanelCallbacks,
  AutoLayoutLimitPresetId,
  AutoLayoutLimitPresetView,
  AutomationBindingField,
  AutomationCreatePagePayload,
  AutomationSaveTemplatePayload,
  AutomationTemplateDetail,
  AutomationTemplateSummary,
  AssetUploadProgressItem,
  ImportLibraryItem,
  LeftPanelHistoryItem,
  LeftPanelImageTraceState,
  SvgImportMode,
  SelectionBooleanOperationId,
  SelectionPerspectiveWarpPayload,
} from "../pinsela/ui/darkglass/panels/LeftPanelSections";
import type {
  PinselaNode,
  PinselaTemplateDocV1,
  PinselaImageBrushPoint,
  PinselaImageBrushStroke,
  PinselaImageBrushSettings,
  PinselaImageDuotoneSettings,
  PinselaImageFadeSettings,
  PinselaLayerEffect,
  PinselaStrokeStackItem,
  PinselaPathFillRule,
  PinselaTextPath,
  PinselaTextRun,
  PinselaTextStyle,
  PinselaTextFitRule,
} from "../pinsela/core/types";
import type {
  CanvasPathEditData,
  ResizeSelectionGestureEvent,
  TranslateSelectionGestureEvent,
  RotateSelectionGestureEvent,
  LineEndpointGestureEvent,
  PathPointGestureEvent,
  ImageBrushGestureEvent,
  SelectionChromeClickEvent,
  SelectionQuickActionId,
  InlineTextEditOverlay,
  CanvasProjectPagesLayout,
  CanvasProjectPagePosition,
} from "../pinsela/ui/darkglass/canvas/CanvasStage";
import { hitTestAll } from "../pinsela/core/hitTest";
import type {
  ContextToolbarElementOpacityState,
  ContextToolbarImageBackgroundRemovalState,
  ContextToolbarImageBrushState,
  ContextToolbarImageDuotoneState,
  ContextToolbarImageFadeState,
  ContextToolbarImageTraceState,
  ContextToolbarLineState,
} from "../pinsela/ui/darkglass/canvas/ContextToolbar";
import type { RasterizedPiece } from "../pinsela/core/selectionRasterOps";
import { cloneDoc, defaultBezierPointsForNode } from "../pinsela/engine/core/documentUtils";
import { cloneNodeGraph } from "../pinsela/engine/core/cloneNodeGraph";
import { compatStrokeFromStack, normalizeStrokeStackItem, sanitizeStrokeStack } from "../pinsela/core/strokes";
import {
  coverCrop,
  cropAspectMatchesBox,
  cropFromImageRect,
  imageRectFromCrop,
  resizeCropFrame,
  zoomImageRect,
  type CropResizeHandle,
} from "../pinsela/core/imageCrop";
import { resizeRotatedBox, type RotatedResizeHandle } from "../pinsela/core/rotatedResize";
import { getPathSubpaths } from "../pinsela/core/pathData";
import {
  getFontVerticalMetrics,
  normalizeTextDoc,
  normalizeTextStyle,
  textStyleFingerprint,
  updateTextNodeContent,
} from "../pinsela/core/textModels";
import {
  buildSvgEllipseSubpath,
  buildSvgLineSubpath,
  buildSvgPolylineSubpath,
  buildSvgRectSubpaths,
  parseSvgPathDataSubpaths,
  parseSvgPoints,
} from "../pinsela/import/svgCompat";
// 2026-05-27: feature "local sandbox" (browser-only IndexedDB editor) removed.
// Local stub replaces the old getLocalEditorSandboxConfig without having to
// reformat hundreds of refs in the component.
type LocalEditorSandboxConfig = {
  id: string;
  key: string;
  name: string;
  homePath: string;
  fixtureUrl: string | null;
};
function getLocalEditorSandboxConfig(rawId?: string | null): LocalEditorSandboxConfig {
  const normalized = String(rawId || "").trim().toLowerCase();
  return {
    id: normalized,
    key: normalized,
    name: normalized || "Project",
    homePath: "/projects",
    fixtureUrl: null,
  };
}
import {
  LOCAL_ACCOUNT_DISPLAY_NAME,
  getLocalAccountProjectKey,
  isLocalAccountPath,
  isLocalDevHost,
  isRemoteBackedLocalEditorPath,
} from "../pinsela/localAccount";
import { ToastStack, useToasts } from "../pinsela/ui/darkglass/ToastStack";
import { canvasImageCacheKeys, loadCanvasImageElement, resolveCanvasImageRequestSrc, preloadCanvasImage } from "../pinsela/core/imageAssets";

const ProjectPagesGridLazy = React.lazy(async () => {
  const mod = await import("../pinsela/ui/darkglass/canvas/ProjectPagesGrid");
  return { default: mod.ProjectPagesGrid };
});

const LOCAL_ACCOUNT_LOGIN_BANNER_DISMISSED_KEY = "pinsela:local-account-login-banner:dismissed";

const FormatPickerLazy = React.lazy(async () => {
  const mod = await import("../pinsela/ui/darkglass/canvas/FormatPicker");
  return { default: mod.FormatPicker };
});

const VersionsModalLazy = React.lazy(async () => {
  const mod = await import("../pinsela/ui/darkglass/modals");
  return { default: mod.VersionsModal };
});

const ExportModalLazy = React.lazy(async () => {
  const mod = await import("../pinsela/ui/darkglass/modals");
  return { default: mod.ExportModal };
});

const BulkCsvModalLazy = React.lazy(async () => {
  const mod = await import("../pinsela/ui/darkglass/modals");
  return { default: mod.BulkCsvModal };
});

const FormatChangeConfirmModalLazy = React.lazy(async () => {
  const mod = await import("../pinsela/ui/darkglass/modals");
  return { default: mod.FormatChangeConfirmModal };
});

const AddGuidesModalLazy = React.lazy(async () => {
  const mod = await import("../pinsela/ui/darkglass/modals");
  return { default: mod.AddGuidesModal };
});

async function loadAutomationApi() {
  return import("../pinsela/platform/api/pinselaNativeApi");
}

let selectionRasterOpsPromise: Promise<typeof import("../pinsela/core/selectionRasterOps")> | null = null;
async function loadSelectionRasterOps() {
  if (!selectionRasterOpsPromise) {
    selectionRasterOpsPromise = import("../pinsela/core/selectionRasterOps");
  }
  return selectionRasterOpsPromise;
}

type ExportSaveAction = "download" | "save_as";
type ExportOutputKind = "png" | "jpg" | "webp" | "pdf";

type SaveFilePickerOptionsLike = {
  suggestedName?: string;
  excludeAcceptAllOption?: boolean;
  types?: Array<{
    description?: string;
    accept: Record<string, string[]>;
  }>;
};

type SaveFilePickerHandleLike = {
  createWritable: () => Promise<{
    write: (data: Blob) => Promise<void>;
    close: () => Promise<void>;
  }>;
};

const EXPORT_FILE_META: Record<ExportOutputKind, {
  mime: string;
  description: string;
  extensions: string[];
}> = {
  png: {
    mime: "image/png",
    description: "PNG image",
    extensions: [".png"],
  },
  jpg: {
    mime: "image/jpeg",
    description: "JPEG image",
    extensions: [".jpg", ".jpeg"],
  },
  webp: {
    mime: "image/webp",
    description: "WEBP image",
    extensions: [".webp"],
  },
  pdf: {
    mime: "application/pdf",
    description: "PDF document",
    extensions: [".pdf"],
  },
};

function buildArtworkExportBaseName(projectKey: string): string {
  return String(projectKey || "artboard")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "") || "artboard";
}

function buildArtworkExportFileName(
  projectKey: string,
  format: ExportOutputKind,
  scale: number,
  withoutBackground: boolean,
): string {
  const baseName = buildArtworkExportBaseName(projectKey);
  const scaleSuffix = scale === 1 ? "" : `@${scale}x`;
  const bgSuffix = withoutBackground ? "_no-background" : "";
  return `${baseName}${bgSuffix}${scaleSuffix}.${format}`;
}

function triggerBrowserDownload(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.download = filename;
  anchor.href = objectUrl;
  anchor.rel = "noopener";
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

async function saveBlobToLocalFile(
  blob: Blob,
  filename: string,
  format: ExportOutputKind,
  action: ExportSaveAction,
): Promise<boolean> {
  if (action === "save_as") {
    const saveWindow = window as Window & {
      showSaveFilePicker?: (options?: SaveFilePickerOptionsLike) => Promise<SaveFilePickerHandleLike>;
    };
    if (typeof saveWindow.showSaveFilePicker === "function") {
      try {
        const fileMeta = EXPORT_FILE_META[format];
        const handle = await saveWindow.showSaveFilePicker({
          suggestedName: filename,
          excludeAcceptAllOption: false,
          types: [{
            description: fileMeta.description,
            accept: {
              [fileMeta.mime]: fileMeta.extensions,
            },
          }],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return true;
      } catch (error: any) {
        if (error?.name === "AbortError") return false;
        throw error;
      }
    }
  }

  triggerBrowserDownload(blob, filename);
  return true;
}

function hasRenderableColor(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  return typeof value === "object";
}

function toSolidTextColor(value: unknown, fallback = "#111111"): string {
  if (typeof value === "string" && value.trim()) return value;
  if (!value || typeof value !== "object") return fallback;
  const obj = value as Record<string, unknown>;
  const stops = Array.isArray(obj.stops) ? obj.stops : [];
  for (const stop of stops) {
    if (!stop || typeof stop !== "object") continue;
    const color = (stop as Record<string, unknown>).color;
    if (typeof color === "string" && color.trim()) return color;
  }
  return fallback;
}

function isGradientColorLike(value: unknown): value is {
  type: "gradient";
  gradient_type?: unknown;
  angle?: unknown;
  stops: Array<{ offset?: unknown; color?: unknown }>;
} {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return String(entry.type || "").toLowerCase() === "gradient" && Array.isArray(entry.stops);
}

function colorValueKey(value: unknown): string {
  if (typeof value === "string") return value.trim().toLowerCase();
  if (isGradientColorLike(value)) {
    const kind = String(value.gradient_type || "linear").toLowerCase() === "radial" ? "radial" : "linear";
    const angleRaw = Number(value.angle);
    const angle = Number.isFinite(angleRaw) ? ((angleRaw % 360) + 360) % 360 : 90;
    const stops = value.stops
      .map((stop) => {
        const entry = (stop && typeof stop === "object") ? (stop as Record<string, unknown>) : {};
        const offsetRaw = Number(entry.offset);
        const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.min(1, offsetRaw)) : 0;
        const color = entry.color;
        return `${Math.round(offset * 1000) / 10}:${typeof color === "string" ? color.trim().toLowerCase() : String(color || "")}`;
      })
      .join("|");
    return `gradient:${kind}:${Math.round(angle * 10) / 10}:${stops}`;
  }
  if (value && typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return "";
}

function collectNodeDocumentColors(doc: PinselaTemplateDocV1): unknown[] {
  const out: unknown[] = [];
  const seen = new Set<string>();

  const pushColor = (value: unknown) => {
    if (!hasRenderableColor(value)) return;
    const key = colorValueKey(value);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(value);
  };

  pushColor(doc.canvas.background);
  for (const node of doc.nodes) {
    pushColor(node.style?.fill);

    const stroke = node.style?.stroke;
    if (stroke && typeof stroke === "object" && !Array.isArray(stroke)) {
      const strokeObj = stroke as Record<string, unknown>;
      pushColor(strokeObj.color ?? stroke);
    } else {
      pushColor(stroke);
    }
    const strokeStack = Array.isArray((node.style as Record<string, unknown> | undefined)?.strokes)
      ? (((node.style as Record<string, unknown>).strokes as unknown[]) || [])
      : [];
    for (const rawStroke of strokeStack) {
      if (!rawStroke || typeof rawStroke !== "object") continue;
      const strokeObj = rawStroke as Record<string, unknown>;
      pushColor(strokeObj.color);
    }

    const textStyle = node.text_style as Record<string, unknown> | undefined;
    pushColor(textStyle?.color);

    const duotone = node.style?.image_duotone as Record<string, unknown> | undefined;
    pushColor(duotone?.shadows);
    pushColor(duotone?.highlights);

    const brushStrokes = Array.isArray(node.style?.image_brush_strokes) ? node.style.image_brush_strokes : [];
    for (const rawStroke of brushStrokes) {
      if (!rawStroke || typeof rawStroke !== "object") continue;
      const strokeEntry = rawStroke as Record<string, unknown>;
      pushColor(strokeEntry.color);
    }
  }

  return out;
}

function clampRange(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  if (value <= min) return min;
  if (value >= max) return max;
  return value;
}

function bezierPointsForNode(node: PinselaNode): Array<{ x: number; y: number }> {
  const fallback = defaultBezierPointsForNode(node);
  const source = node.text_path?.type === "bezier" && Array.isArray(node.text_path.points)
    ? node.text_path.points
    : fallback;
  return [0, 1, 2, 3].map((index) => {
    const point = source[index] || fallback[index] || { x: 0, y: 0 };
    return {
      x: Number(point.x || 0),
      y: Number(point.y || 0),
    };
  });
}

type PathAnchorSpec = {
  x: number;
  y: number;
  in?: { x: number; y: number } | null;
  out?: { x: number; y: number } | null;
  mode?: "corner" | "smooth";
};

type PathAnchorLocal = {
  x: number;
  y: number;
  in?: { x: number; y: number } | null;
  out?: { x: number; y: number } | null;
  mode?: "corner" | "smooth";
};

function round2(value: number): number {
  return Math.round(Number(value || 0) * 100) / 100;
}

function nodeLocalToWorldPoint(
  point: { x: number; y: number },
  geometry: PinselaNode["geometry"],
): { x: number; y: number } {
  const base = {
    x: Number(geometry.x || 0) + Number(point.x || 0),
    y: Number(geometry.y || 0) + Number(point.y || 0),
  };
  const center = {
    x: Number(geometry.x || 0) + Number(geometry.width || 0) / 2,
    y: Number(geometry.y || 0) + Number(geometry.height || 0) / 2,
  };
  return rotatePointAround(base, center, Number(geometry.rotation || 0));
}

function worldToNodeLocalPoint(
  point: { x: number; y: number },
  geometry: PinselaNode["geometry"],
): { x: number; y: number } {
  const center = {
    x: Number(geometry.x || 0) + Number(geometry.width || 0) / 2,
    y: Number(geometry.y || 0) + Number(geometry.height || 0) / 2,
  };
  const unrotated = rotatePointAround(point, center, -Number(geometry.rotation || 0));
  return {
    x: unrotated.x - Number(geometry.x || 0),
    y: unrotated.y - Number(geometry.y || 0),
  };
}

function normalizePathNodeGeometry(node: PinselaNode): PinselaNode {
  if (node.kind !== "path") return node;
  const pathData = node.path_data;
  const subpaths = getPathSubpaths(pathData || null);
  const points = subpaths.flatMap((subpath) => subpath.points);
  if (!points.length) return node;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    const x = Number(point?.x || 0);
    const y = Number(point?.y || 0);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return node;
  }

  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const shiftPoint = (point: typeof points[number]) => ({
    x: round2(Number(point?.x || 0) - minX),
    y: round2(Number(point?.y || 0) - minY),
    in: point?.in
      ? {
          x: round2(Number(point.in.x || 0) - minX),
          y: round2(Number(point.in.y || 0) - minY),
        }
      : point?.in ?? null,
    out: point?.out
      ? {
          x: round2(Number(point.out.x || 0) - minX),
          y: round2(Number(point.out.y || 0) - minY),
        }
      : point?.out ?? null,
    mode: (point?.mode === "smooth" ? "smooth" : "corner") as "smooth" | "corner",
  });
  const shiftedSubpaths = subpaths.map((subpath) => ({
    closed: subpath.closed !== false,
    points: subpath.points.map((point) => shiftPoint(point)),
  }));
  const shiftedPoints = shiftedSubpaths[0]?.points || [];

  return {
    ...node,
    geometry: {
      ...node.geometry,
      x: round2(Number(node.geometry.x || 0) + minX),
      y: round2(Number(node.geometry.y || 0) + minY),
      width: round2(width),
      height: round2(height),
    },
    path_data: {
      closed: shiftedSubpaths[0]?.closed !== false,
      points: shiftedPoints,
      subpaths: shiftedSubpaths,
      fill_rule: pathData?.fill_rule === "evenodd" ? "evenodd" : "nonzero",
    },
  };
}

function scaleNodePathData(
  pathData: PinselaNode["path_data"],
  scaleX: number,
  scaleY: number,
): PinselaNode["path_data"] {
  const subpaths = getPathSubpaths(pathData || null);
  if (!subpaths.length) return pathData;
  const scaledSubpaths = subpaths.map((subpath) => ({
    closed: subpath.closed !== false,
    points: subpath.points.map((point) => ({
      x: round2(Number(point?.x || 0) * scaleX),
      y: round2(Number(point?.y || 0) * scaleY),
      in: point?.in
        ? {
            x: round2(Number(point.in.x || 0) * scaleX),
            y: round2(Number(point.in.y || 0) * scaleY),
          }
        : point?.in ?? null,
      out: point?.out
        ? {
            x: round2(Number(point.out.x || 0) * scaleX),
            y: round2(Number(point.out.y || 0) * scaleY),
          }
        : point?.out ?? null,
      mode: (point?.mode === "smooth" ? "smooth" : "corner") as "smooth" | "corner",
    })),
  }));
  return {
    closed: scaledSubpaths[0]?.closed !== false,
    points: scaledSubpaths[0]?.points || [],
    subpaths: scaledSubpaths,
    fill_rule: pathData?.fill_rule === "evenodd" ? "evenodd" : "nonzero",
  };
}

type BuildPathNodeOptions = {
  closed: boolean;
  name: string;
  parentId: string | null;
  subpaths?: Array<{ closed: boolean; anchors: PathAnchorSpec[] }>;
  fillRule?: PinselaPathFillRule;
  sourceStyle?: Partial<PinselaNode["style"]> | null;
  forceTransparentFill?: boolean;
  strokeColor?: unknown;
  strokeWidth?: number;
};

function buildPathNodeFromAnchors(
  anchorsInput: PathAnchorSpec[],
  options: BuildPathNodeOptions,
): PinselaNode | null {
  const rawSubpaths = Array.isArray(options.subpaths) && options.subpaths.length
    ? options.subpaths
    : [{ closed: options.closed, anchors: anchorsInput }];
  const cleanedSubpaths = rawSubpaths
    .map((subpath) => {
      const cleaned = (subpath.anchors || [])
        .map((anchor) => ({
          x: Number(anchor?.x || 0),
          y: Number(anchor?.y || 0),
          in: anchor?.in ? { x: Number(anchor.in.x || 0), y: Number(anchor.in.y || 0) } : anchor?.in ?? null,
          out: anchor?.out ? { x: Number(anchor.out.x || 0), y: Number(anchor.out.y || 0) } : anchor?.out ?? null,
          mode: anchor?.mode === "smooth" ? "smooth" : "corner",
        }))
        .filter((anchor) => Number.isFinite(anchor.x) && Number.isFinite(anchor.y));
      const closed = Boolean(subpath.closed && cleaned.length >= 3);
      if (closed && cleaned.length >= 3) {
        const first = cleaned[0];
        const last = cleaned[cleaned.length - 1];
        if (Math.hypot(last.x - first.x, last.y - first.y) <= 0.8) {
          cleaned.pop();
        }
      }
      if (cleaned.length < 2) return null;
      return { closed, anchors: cleaned };
    })
    .filter(Boolean) as Array<{ closed: boolean; anchors: PathAnchorLocal[] }>;
  if (!cleanedSubpaths.length) return null;
  const cleaned = cleanedSubpaths[0].anchors;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  for (const subpath of cleanedSubpaths) {
    for (const anchor of subpath.anchors) {
      if (anchor.x < minX) minX = anchor.x;
      if (anchor.y < minY) minY = anchor.y;
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;

  const toLocalAnchor = (anchor: PathAnchorLocal): PathAnchorLocal => ({
    x: round2(anchor.x - minX),
    y: round2(anchor.y - minY),
    in: anchor.in ? { x: round2(anchor.in.x - minX), y: round2(anchor.in.y - minY) } : anchor.in ?? null,
    out: anchor.out ? { x: round2(anchor.out.x - minX), y: round2(anchor.out.y - minY) } : anchor.out ?? null,
    mode: (anchor.mode === "smooth" ? "smooth" : "corner") as "smooth" | "corner",
  });
  const localSubpaths = cleanedSubpaths.map((subpath) => ({
    closed: subpath.closed,
    points: subpath.anchors.map((anchor) => toLocalAnchor(anchor)),
  }));
  const localAnchors: PathAnchorLocal[] = localSubpaths[0]?.points || [];
  const hasClosedFill = localSubpaths.some((subpath) => subpath.closed && subpath.points.length >= 3);

  const baseNode = defaultNode("path");
  const sourceStyle: Partial<PinselaNode["style"]> =
    options.sourceStyle && typeof options.sourceStyle === "object" ? options.sourceStyle : {};
  const sourceStroke = sourceStyle.stroke && typeof sourceStyle.stroke === "object"
    ? (sourceStyle.stroke as Record<string, unknown>)
    : null;
  const strokeWidth = options.strokeWidth != null
    ? Math.max(1, Number(options.strokeWidth))
    : sourceStroke
      ? Math.max(1, Number(sourceStroke.width || 1))
      : 1;
  const strokeColor = options.strokeColor ?? sourceStroke?.color ?? sourceStyle.fill ?? "#111111";
  const shouldForceStroke = options.strokeColor !== undefined || options.strokeWidth != null;
  const stroke = sourceStroke
    ? {
      ...sourceStroke,
      color: strokeColor,
      width: strokeWidth,
    }
    : (shouldForceStroke
      ? {
        color: strokeColor,
        width: strokeWidth,
        dash: [],
        cap: "round",
      }
      : null);

  const nextNode: PinselaNode = {
    ...baseNode,
    name: options.name,
    parent_id: options.parentId || null,
    geometry: {
      ...baseNode.geometry,
      x: round2(minX),
      y: round2(minY),
      width: 1,
      height: 1,
      rotation: 0,
      corner_radius: 0,
      clip: false,
      z_index: 0,
    },
    style: {
      ...baseNode.style,
      ...sourceStyle,
      fill: options.forceTransparentFill
        ? "rgba(0,0,0,0)"
        : (hasClosedFill ? (sourceStyle.fill ?? "#D8C0A8") : "rgba(0,0,0,0)"),
      stroke,
      opacity: clampRange(Number(sourceStyle.opacity), 0, 1, 1),
    },
    path_data: {
      closed: localSubpaths[0]?.closed !== false,
      points: localAnchors,
      subpaths: localSubpaths,
      fill_rule: options.fillRule === "evenodd" ? "evenodd" : "nonzero",
    },
  };
  return normalizePathNodeGeometry(nextNode);
}

function polygonLocalAnchors(width: number, height: number, sides: number): PathAnchorSpec[] {
  const count = Math.max(3, Math.round(Number(sides || 6)));
  const cx = width / 2;
  const cy = height / 2;
  const rx = Math.max(0.5, width / 2);
  const ry = Math.max(0.5, height / 2);
  const anchors: PathAnchorSpec[] = [];
  for (let i = 0; i < count; i += 1) {
    const angle = -Math.PI / 2 + (i * Math.PI * 2) / count;
    anchors.push({
      x: cx + Math.cos(angle) * rx,
      y: cy + Math.sin(angle) * ry,
      mode: "corner",
    });
  }
  return anchors;
}

function starLocalAnchors(width: number, height: number, points: number, innerRatio: number): PathAnchorSpec[] {
  const count = Math.max(4, Math.round(Number(points || 5)));
  const ratio = clampRange(Number(innerRatio), 0.05, 0.95, 0.46);
  const cx = width / 2;
  const cy = height / 2;
  const outerRx = Math.max(0.5, width / 2);
  const outerRy = Math.max(0.5, height / 2);
  const innerRx = outerRx * ratio;
  const innerRy = outerRy * ratio;
  const anchors: PathAnchorSpec[] = [];
  for (let i = 0; i < count * 2; i += 1) {
    const outer = i % 2 === 0;
    const radiusX = outer ? outerRx : innerRx;
    const radiusY = outer ? outerRy : innerRy;
    const angle = -Math.PI / 2 + (i * Math.PI) / count;
    anchors.push({
      x: cx + Math.cos(angle) * radiusX,
      y: cy + Math.sin(angle) * radiusY,
      mode: "corner",
    });
  }
  return anchors;
}

function ellipseLocalAnchors(width: number, height: number): PathAnchorSpec[] {
  const rx = Math.max(0.5, width / 2);
  const ry = Math.max(0.5, height / 2);
  const cx = width / 2;
  const cy = height / 2;
  const k = 0.5522847498307936;
  return [
    {
      x: cx,
      y: cy - ry,
      in: { x: cx - rx * k, y: cy - ry },
      out: { x: cx + rx * k, y: cy - ry },
      mode: "smooth",
    },
    {
      x: cx + rx,
      y: cy,
      in: { x: cx + rx, y: cy - ry * k },
      out: { x: cx + rx, y: cy + ry * k },
      mode: "smooth",
    },
    {
      x: cx,
      y: cy + ry,
      in: { x: cx + rx * k, y: cy + ry },
      out: { x: cx - rx * k, y: cy + ry },
      mode: "smooth",
    },
    {
      x: cx - rx,
      y: cy,
      in: { x: cx - rx, y: cy + ry * k },
      out: { x: cx - rx, y: cy - ry * k },
      mode: "smooth",
    },
  ];
}

function convertNodeToNativePath(node: PinselaNode): PinselaNode | null {
  if (node.kind === "path") return node;
  const g = node.geometry;
  if (node.kind === "line") {
    const localAnchors: PathAnchorSpec[] = [
      { x: 0, y: 0, mode: "corner" },
      { x: Number(g.width || 0), y: Number(g.height || 0), mode: "corner" },
    ];
    const worldAnchors = localAnchors.map((anchor) => nodeLocalToWorldPoint(anchor, g));
    const sourceStroke = node.style?.stroke && typeof node.style.stroke === "object"
      ? node.style.stroke
      : { color: node.style?.fill ?? "#111111", width: 1, dash: [], cap: "round" };
    return buildPathNodeFromAnchors(worldAnchors, {
      closed: false,
      name: `CURVES_${node.name || "LINE"}`,
      parentId: node.parent_id || null,
      sourceStyle: {
        ...node.style,
        fill: "rgba(0,0,0,0)",
        stroke: sourceStroke,
      },
      forceTransparentFill: true,
    });
  }
  if (node.kind !== "rect") return null;

  const width = Math.max(1, Number(g.width || 0));
  const height = Math.max(1, Number(g.height || 0));
  const shapeType = getRectShapeType(node);
  const localAnchors: PathAnchorSpec[] =
    shapeType === "ellipse"
      ? ellipseLocalAnchors(width, height)
      : shapeType === "polygon"
        ? polygonLocalAnchors(width, height, Number((node.style as any)?.shape_sides || 6))
        : shapeType === "star"
          ? starLocalAnchors(width, height, Number((node.style as any)?.star_points || 5), Number((node.style as any)?.star_inner_ratio || 0.46))
          : [
            { x: 0, y: 0, mode: "corner" },
            { x: width, y: 0, mode: "corner" },
            { x: width, y: height, mode: "corner" },
            { x: 0, y: height, mode: "corner" },
          ];

  const worldAnchors = localAnchors.map((anchor) => {
    const world = nodeLocalToWorldPoint(anchor, g);
    return {
      ...world,
      in: anchor.in ? nodeLocalToWorldPoint(anchor.in, g) : anchor.in ?? null,
      out: anchor.out ? nodeLocalToWorldPoint(anchor.out, g) : anchor.out ?? null,
      mode: (anchor.mode === "smooth" ? "smooth" : "corner") as "smooth" | "corner",
    };
  });

  return buildPathNodeFromAnchors(worldAnchors, {
    closed: true,
    name: `CURVES_${node.name || "SHAPE"}`,
    parentId: node.parent_id || null,
    sourceStyle: node.style,
    forceTransparentFill: false,
  });
}

type EditablePathPoint = {
  x: number;
  y: number;
  in: { x: number; y: number } | null;
  out: { x: number; y: number } | null;
  mode: "corner" | "smooth";
};

type PathMutationResult = {
  node: PinselaNode;
  selectedIndex: number;
};

function normalizeEditablePathPoints(node: PinselaNode): { closed: boolean; points: EditablePathPoint[] } {
  if (node.kind !== "path") return { closed: false, points: [] };
  const pathData = node.path_data;
  const points = Array.isArray(pathData?.points) ? pathData.points : [];
  return {
    closed: pathData?.closed !== false,
    points: points.map((point) => ({
      x: Number(point?.x || 0),
      y: Number(point?.y || 0),
      in: point?.in ? { x: Number(point.in.x || 0), y: Number(point.in.y || 0) } : null,
      out: point?.out ? { x: Number(point.out.x || 0), y: Number(point.out.y || 0) } : null,
      mode: (point?.mode === "smooth" ? "smooth" : "corner") as "corner" | "smooth",
    })),
  };
}

function toStoredEditablePathPoints(points: EditablePathPoint[]): EditablePathPoint[] {
  return points.map((point) => ({
    x: round2(point.x),
    y: round2(point.y),
    in: point.in ? { x: round2(point.in.x), y: round2(point.in.y) } : null,
    out: point.out ? { x: round2(point.out.x), y: round2(point.out.y) } : null,
    mode: (point.mode === "smooth" ? "smooth" : "corner") as "corner" | "smooth",
  }));
}

function clampPathPointIndex(value: number, length: number): number {
  if (length <= 0) return 0;
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(length - 1, Math.round(value)));
}

function hasDistinctLocalHandle(point: EditablePathPoint, handle: EditablePathPoint["in"] | EditablePathPoint["out"]): handle is { x: number; y: number } {
  if (!handle) return false;
  return Math.abs(Number(handle.x || 0) - Number(point.x || 0)) > 0.0001
    || Math.abs(Number(handle.y || 0) - Number(point.y || 0)) > 0.0001;
}

function pathEditWorldData(node: PinselaNode, selectedIndex: number | null): CanvasPathEditData | null {
  if (node.kind !== "path") return null;
  const { closed, points } = normalizeEditablePathPoints(node);
  if (points.length < 2) return null;
  const clampedSelected = selectedIndex == null ? 0 : clampPathPointIndex(selectedIndex, points.length);
  return {
    closed: closed && points.length >= 3,
    selectedIndex: clampedSelected,
    points: points.map((point, index) => ({
      index,
      anchor: nodeLocalToWorldPoint({ x: point.x, y: point.y }, node.geometry),
      in: point.in ? nodeLocalToWorldPoint(point.in, node.geometry) : null,
      out: point.out ? nodeLocalToWorldPoint(point.out, node.geometry) : null,
      mode: point.mode,
    })),
  };
}

function patchPathAnchorByWorldPosition(
  node: PinselaNode,
  pointIndex: number,
  worldPoint: { x: number; y: number },
): PinselaNode {
  if (node.kind !== "path") return node;
  const { closed, points } = normalizeEditablePathPoints(node);
  if (!points.length) return node;
  const index = clampPathPointIndex(pointIndex, points.length);
  const nextLocal = worldToNodeLocalPoint(worldPoint, node.geometry);
  const current = points[index];
  const dx = Number(nextLocal.x || 0) - Number(current.x || 0);
  const dy = Number(nextLocal.y || 0) - Number(current.y || 0);
  const nextPoints = points.map((point, pointIdx) => {
    if (pointIdx !== index) return point;
    return {
      ...point,
      x: round2(nextLocal.x),
      y: round2(nextLocal.y),
      in: point.in ? { x: round2(point.in.x + dx), y: round2(point.in.y + dy) } : null,
      out: point.out ? { x: round2(point.out.x + dx), y: round2(point.out.y + dy) } : null,
    };
  });
  return normalizePathNodeGeometry({
    ...node,
    path_data: {
      closed: closed && nextPoints.length >= 3,
      points: toStoredEditablePathPoints(nextPoints),
    },
  });
}

function patchPathHandleByWorldPosition(
  node: PinselaNode,
  pointIndex: number,
  pointKind: "in" | "out",
  worldPoint: { x: number; y: number },
): PinselaNode {
  if (node.kind !== "path") return node;
  const { closed, points } = normalizeEditablePathPoints(node);
  if (!points.length) return node;
  const index = clampPathPointIndex(pointIndex, points.length);
  const nextLocal = worldToNodeLocalPoint(worldPoint, node.geometry);
  const nextPoints = points.map((point, pointIdx) => {
    if (pointIdx !== index) return point;
    const anchor = { x: Number(point.x || 0), y: Number(point.y || 0) };
    const handle = { x: round2(nextLocal.x), y: round2(nextLocal.y) };
    const mode = (point.mode === "smooth" ? "smooth" : "corner") as "corner" | "smooth";
    if (pointKind === "in") {
      if (mode === "smooth") {
        const mirrored = { x: round2(anchor.x * 2 - handle.x), y: round2(anchor.y * 2 - handle.y) };
        return { ...point, in: handle, out: mirrored, mode };
      }
      return { ...point, in: handle, mode };
    }
    if (mode === "smooth") {
      const mirrored = { x: round2(anchor.x * 2 - handle.x), y: round2(anchor.y * 2 - handle.y) };
      return { ...point, out: handle, in: mirrored, mode };
    }
    return { ...point, out: handle, mode };
  });
  return normalizePathNodeGeometry({
    ...node,
    path_data: {
      closed: closed && nextPoints.length >= 3,
      points: toStoredEditablePathPoints(nextPoints),
    },
  });
}

function lerp2(a: { x: number; y: number }, b: { x: number; y: number }, t: number): { x: number; y: number } {
  return {
    x: Number(a.x || 0) + (Number(b.x || 0) - Number(a.x || 0)) * t,
    y: Number(a.y || 0) + (Number(b.y || 0) - Number(a.y || 0)) * t,
  };
}

function splitPathSegmentAtMiddle(
  from: EditablePathPoint,
  to: EditablePathPoint,
): {
  fromOut: { x: number; y: number } | null;
  inserted: EditablePathPoint;
  toIn: { x: number; y: number } | null;
} {
  const anchor0 = { x: Number(from.x || 0), y: Number(from.y || 0) };
  const anchor1 = { x: Number(to.x || 0), y: Number(to.y || 0) };
  const cp1 = hasDistinctLocalHandle(from, from.out) ? from.out! : anchor0;
  const cp2 = hasDistinctLocalHandle(to, to.in) ? to.in! : anchor1;
  const curved = hasDistinctLocalHandle(from, from.out) || hasDistinctLocalHandle(to, to.in);
  if (!curved) {
    const mid = lerp2(anchor0, anchor1, 0.5);
    return {
      fromOut: null,
      inserted: { x: mid.x, y: mid.y, in: null, out: null, mode: "corner" },
      toIn: null,
    };
  }
  const a = lerp2(anchor0, cp1, 0.5);
  const b = lerp2(cp1, cp2, 0.5);
  const c = lerp2(cp2, anchor1, 0.5);
  const d = lerp2(a, b, 0.5);
  const e = lerp2(b, c, 0.5);
  const f = lerp2(d, e, 0.5);
  return {
    fromOut: a,
    inserted: { x: f.x, y: f.y, in: d, out: e, mode: "smooth" },
    toIn: c,
  };
}

function pathAddPoint(node: PinselaNode, selectedIndex: number): PathMutationResult | null {
  if (node.kind !== "path") return null;
  const { closed, points } = normalizeEditablePathPoints(node);
  if (points.length < 2) return null;
  const clampedIndex = clampPathPointIndex(selectedIndex, points.length);

  if (!closed && clampedIndex >= points.length - 1) {
    const current = points[points.length - 1];
    const previous = points.length > 1 ? points[points.length - 2] : null;
    let vx = hasDistinctLocalHandle(current, current.out)
      ? Number(current.out!.x || 0) - Number(current.x || 0)
      : previous
        ? Number(current.x || 0) - Number(previous.x || 0)
        : 40;
    let vy = hasDistinctLocalHandle(current, current.out)
      ? Number(current.out!.y || 0) - Number(current.y || 0)
      : previous
        ? Number(current.y || 0) - Number(previous.y || 0)
        : 0;
    const length = Math.hypot(vx, vy);
    const targetLength = Math.max(24, Math.min(220, length > 0.001 ? length * 0.66 : 64));
    if (length <= 0.001) {
      vx = targetLength;
      vy = 0;
    } else {
      const scalar = targetLength / length;
      vx *= scalar;
      vy *= scalar;
    }
    const nextPoints = [
      ...points,
      {
        x: Number(current.x || 0) + vx,
        y: Number(current.y || 0) + vy,
        in: null,
        out: null,
        mode: "corner" as const,
      },
    ];
    return {
      node: normalizePathNodeGeometry({
        ...node,
        path_data: {
          closed: false,
          points: toStoredEditablePathPoints(nextPoints),
        },
      }),
      selectedIndex: nextPoints.length - 1,
    };
  }

  const fromIndex = clampedIndex;
  const toIndex = closed ? (fromIndex + 1) % points.length : Math.min(points.length - 1, fromIndex + 1);
  if (toIndex === fromIndex) return null;

  const from = points[fromIndex];
  const to = points[toIndex];
  const split = splitPathSegmentAtMiddle(from, to);
  const updatedFrom: EditablePathPoint = { ...from, out: split.fromOut };
  const updatedTo: EditablePathPoint = { ...to, in: split.toIn };

  if (closed && fromIndex === points.length - 1 && toIndex === 0) {
    const nextPoints = [...points];
    nextPoints[fromIndex] = updatedFrom;
    nextPoints[toIndex] = updatedTo;
    nextPoints.push(split.inserted);
    return {
      node: normalizePathNodeGeometry({
        ...node,
        path_data: {
          closed: true,
          points: toStoredEditablePathPoints(nextPoints),
        },
      }),
      selectedIndex: nextPoints.length - 1,
    };
  }

  const insertionIndex = toIndex;
  const nextPoints = [...points];
  nextPoints[fromIndex] = updatedFrom;
  nextPoints[toIndex] = updatedTo;
  nextPoints.splice(insertionIndex, 0, split.inserted);

  return {
    node: normalizePathNodeGeometry({
      ...node,
      path_data: {
        closed: closed && nextPoints.length >= 3,
        points: toStoredEditablePathPoints(nextPoints),
      },
    }),
    selectedIndex: insertionIndex,
  };
}

function pathRemovePoint(node: PinselaNode, selectedIndex: number): PathMutationResult | null {
  if (node.kind !== "path") return null;
  const { closed, points } = normalizeEditablePathPoints(node);
  if (points.length <= 2) return null;
  const index = clampPathPointIndex(selectedIndex, points.length);
  const nextPoints = points.filter((_, pointIndex) => pointIndex !== index);
  if (nextPoints.length < 2) return null;
  const nextClosed = closed && nextPoints.length >= 3;
  return {
    node: normalizePathNodeGeometry({
      ...node,
      path_data: {
        closed: nextClosed,
        points: toStoredEditablePathPoints(nextPoints),
      },
    }),
    selectedIndex: Math.max(0, Math.min(nextPoints.length - 1, index)),
  };
}

function pathPointNeighbors(
  points: EditablePathPoint[],
  index: number,
  closed: boolean,
): { prev: EditablePathPoint | null; next: EditablePathPoint | null } {
  if (!points.length) return { prev: null, next: null };
  if (closed) {
    const prev = points[(index - 1 + points.length) % points.length] || null;
    const next = points[(index + 1) % points.length] || null;
    return { prev, next };
  }
  return {
    prev: index > 0 ? points[index - 1] : null,
    next: index < points.length - 1 ? points[index + 1] : null,
  };
}

function pathSmoothPoint(node: PinselaNode, selectedIndex: number): PathMutationResult | null {
  if (node.kind !== "path") return null;
  const { closed, points } = normalizeEditablePathPoints(node);
  if (!points.length) return null;
  const index = clampPathPointIndex(selectedIndex, points.length);
  const target = points[index];
  const { prev, next } = pathPointNeighbors(points, index, closed);
  if (!prev && !next) return null;

  let vx = 0;
  let vy = 0;
  if (prev && next) {
    vx = Number(next.x || 0) - Number(prev.x || 0);
    vy = Number(next.y || 0) - Number(prev.y || 0);
  } else if (next) {
    vx = Number(next.x || 0) - Number(target.x || 0);
    vy = Number(next.y || 0) - Number(target.y || 0);
  } else if (prev) {
    vx = Number(target.x || 0) - Number(prev.x || 0);
    vy = Number(target.y || 0) - Number(prev.y || 0);
  }
  const length = Math.hypot(vx, vy);
  if (length <= 0.0001) {
    vx = 1;
    vy = 0;
  } else {
    vx /= length;
    vy /= length;
  }
  const prevDistance = prev
    ? Math.hypot(Number(target.x || 0) - Number(prev.x || 0), Number(target.y || 0) - Number(prev.y || 0))
    : 60;
  const nextDistance = next
    ? Math.hypot(Number(next.x || 0) - Number(target.x || 0), Number(next.y || 0) - Number(target.y || 0))
    : 60;
  const inLen = Math.max(12, prevDistance * 0.33);
  const outLen = Math.max(12, nextDistance * 0.33);
  const anchor = { x: Number(target.x || 0), y: Number(target.y || 0) };
  const smoothed: EditablePathPoint = {
    ...target,
    in: { x: anchor.x - vx * inLen, y: anchor.y - vy * inLen },
    out: { x: anchor.x + vx * outLen, y: anchor.y + vy * outLen },
    mode: "smooth",
  };
  const nextPoints = points.map((point, pointIndex) => (pointIndex === index ? smoothed : point));
  return {
    node: normalizePathNodeGeometry({
      ...node,
      path_data: {
        closed: closed && nextPoints.length >= 3,
        points: toStoredEditablePathPoints(nextPoints),
      },
    }),
    selectedIndex: index,
  };
}

function pathCornerPoint(node: PinselaNode, selectedIndex: number): PathMutationResult | null {
  if (node.kind !== "path") return null;
  const { closed, points } = normalizeEditablePathPoints(node);
  if (!points.length) return null;
  const index = clampPathPointIndex(selectedIndex, points.length);
  const nextPoints = points.map((point, pointIndex) => (
    pointIndex !== index
      ? point
      : {
        ...point,
        in: null,
        out: null,
        mode: "corner" as const,
      }
  ));
  return {
    node: normalizePathNodeGeometry({
      ...node,
      path_data: {
        closed: closed && nextPoints.length >= 3,
        points: toStoredEditablePathPoints(nextPoints),
      },
    }),
    selectedIndex: index,
  };
}

function pathResetHandles(node: PinselaNode): PinselaNode {
  if (node.kind !== "path") return node;
  const { closed, points } = normalizeEditablePathPoints(node);
  const nextPoints = points.map((point) => ({
    ...point,
    in: null,
    out: null,
    mode: "corner" as const,
  }));
  return normalizePathNodeGeometry({
    ...node,
    path_data: {
      closed: closed && nextPoints.length >= 3,
      points: toStoredEditablePathPoints(nextPoints),
    },
  });
}

function safeReleasePointerCapture(target: HTMLCanvasElement, pointerId: number): void {
  try {
    if (typeof target.hasPointerCapture === "function" && target.hasPointerCapture(pointerId)) {
      target.releasePointerCapture(pointerId);
    }
  } catch {
    // Ignore capture race conditions; session teardown still needs to continue.
  }
}

type TextToolPreset = {
  fontFamily: string;
  fontStyle: string;
  fontSize: number;
  lineHeight: number;
  tracking: number;
  color: unknown;
  textAlign: "left" | "center" | "right" | "justify";
  fitMode: "free" | "fit";
  bold: boolean;
  italic: boolean;
  underline: boolean;
  opacity: number;
};

type ShapeToolPreset = {
  fill: unknown;
  strokeEnabled: boolean;
  stroke: unknown;
  strokeWidth: number;
  strokeDashPreset: "solid" | "dash" | "long_dash" | "dotted";
  cornerRadius: number;
  opacity: number;
  polygonSides: number;
  starPoints: number;
  starInnerRatio: number;
};

type ImportedAssetEntry = {
  id: string;
  fingerprint: string;
  name: string;
  extension: string;
  mimeType: string;
  sizeBytes: number;
  kind: "image" | "vector" | "document";
  src: string;
  placementSrc: string;
  parseMode: "parsed" | "fallback";
  parser: string;
  intrinsicWidth?: number;
  intrinsicHeight?: number;
  pageCount?: number;
  detailLabel?: string;
  vectorPayload?: ImportedVectorPayload;
};

function mergeImportedAssetEntries(
  previous: ImportedAssetEntry[],
  incoming: ImportedAssetEntry[],
): { nextEntries: ImportedAssetEntry[]; addedEntries: ImportedAssetEntry[]; resolvedEntries: ImportedAssetEntry[] } {
  const nextEntries = [...(Array.isArray(previous) ? previous : [])];
  const existingByFingerprint = new Map(nextEntries.map((item) => [item.fingerprint, item] as const));
  const addedEntries: ImportedAssetEntry[] = [];
  const resolvedEntries: ImportedAssetEntry[] = [];
  (Array.isArray(incoming) ? incoming : []).forEach((entry) => {
    if (!entry) return;
    const existing = existingByFingerprint.get(entry.fingerprint);
    if (existing) {
      resolvedEntries.push(existing);
      return;
    }
    existingByFingerprint.set(entry.fingerprint, entry);
    nextEntries.unshift(entry);
    addedEntries.push(entry);
    resolvedEntries.push(entry);
  });
  return {
    nextEntries: nextEntries.slice(0, 240),
    addedEntries,
    resolvedEntries,
  };
}

type ImportedVectorPathElement = {
  kind: "path";
  name: string;
  groupPath?: string[];
  groupContexts?: ImportedSvgGroupContext[];
  closed: boolean;
  anchors: PathAnchorSpec[];
  subpaths?: Array<{ closed: boolean; anchors: PathAnchorSpec[] }>;
  fillRule?: PinselaPathFillRule;
  fill: unknown;
  forceTransparentFill: boolean;
  strokeColor?: unknown;
  strokeWidth?: number;
  opacity: number;
  strokeDash?: number[];
  strokeCap?: "round" | "butt" | "square";
  strokeJoin?: "round" | "bevel" | "miter";
  strokeMiterLimit?: number;
  effects?: PinselaLayerEffect[];
};

type ImportedVectorTextElement = {
  kind: "text";
  name: string;
  groupPath?: string[];
  groupContexts?: ImportedSvgGroupContext[];
  content: string;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  rotation?: number;
  color: unknown;
  strokeColor?: unknown;
  strokeWidth?: number;
  strokeDash?: number[];
  strokeCap?: "round" | "butt" | "square";
  strokeJoin?: "round" | "bevel" | "miter";
  strokeMiterLimit?: number;
  fontFamily: string;
  fontStyle: string;
  fontSize: number;
  lineHeightPercent: number;
  letterSpacing?: number;
  textAlign: "left" | "center" | "right" | "justify";
  underline?: boolean;
  textRuns?: PinselaTextRun[];
  textPath?: PinselaTextPath | null;
  effects?: PinselaLayerEffect[];
  transformMatrix?: Record<string, number> | null;
};

type ImportedVectorImageElement = {
  kind: "image";
  name: string;
  groupPath?: string[];
  groupContexts?: ImportedSvgGroupContext[];
  src: string;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  rotation?: number;
  fit?: "fill" | "fit" | "crop";
  useFrame?: boolean;
  cornerRadius?: number;
  effects?: PinselaLayerEffect[];
  transformMatrix?: Record<string, number> | null;
};

type ImportedVectorElement =
  | ImportedVectorPathElement
  | ImportedVectorTextElement
  | ImportedVectorImageElement;

type ImportedSvgGroupClipGeometry = {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  cornerRadius?: number;
  transformMatrix?: Record<string, number> | null;
};

type ImportedSvgGroupContext = {
  label: string;
  opacity?: number;
  clipGeometry?: ImportedSvgGroupClipGeometry | null;
  clipPath?: ImportedVectorPathElement | null;
};

type ImportedVectorPayload = {
  source: "svg" | "pdf_placeholder";
  width: number;
  height: number;
  elements: ImportedVectorElement[];
  stats?: {
    rasterFallbacks: number;
    richTextRuns: number;
    textPaths: number;
    frameImages: number;
    nestedGroups: number;
    compoundPaths: number;
    evenOddPaths: number;
    simpleFilters: number;
    affineTransforms: number;
  };
};

type ToolPointerSession =
  | {
    kind: "insert_shape";
    pointerId: number;
    tool: "rect" | "ellipse" | "polygon" | "star" | "frame" | "auto_layout";
    nodeId: string | null;
    startPoint: { x: number; y: number };
    baseDoc: PinselaTemplateDocV1;
    latestDoc: PinselaTemplateDocV1 | null;
    started: boolean;
  }
  | {
    kind: "insert_line";
    pointerId: number;
    tool: "line" | "arrow";
    nodeId: string | null;
    startPoint: { x: number; y: number };
    baseDoc: PinselaTemplateDocV1;
    latestDoc: PinselaTemplateDocV1 | null;
    started: boolean;
  }
  | {
    kind: "draw";
    pointerId: number;
    tool: DrawToolId;
    startPoint: { x: number; y: number };
    lastPoint: { x: number; y: number };
    baseDoc: PinselaTemplateDocV1;
    latestDoc: PinselaTemplateDocV1 | null;
    nodeId: string | null;
    anchors: PathAnchorSpec[];
    moved: boolean;
  };

type CropModeSession = {
  baseDoc: PinselaTemplateDocV1;
  nodeId: string;
  latestDoc: PinselaTemplateDocV1;
  changed: boolean;
};

type CropTranslateSession = {
  baseDoc: PinselaTemplateDocV1;
  nodeId: string;
  startCrop: { x: number; y: number; width: number; height: number };
  geometry: { width: number; height: number };
  image: { width: number; height: number };
  latestDoc: PinselaTemplateDocV1 | null;
  moved: boolean;
};

const INSERT_SHAPE_TOOLS: CanvasToolId[] = ["rect", "ellipse", "polygon", "star", "frame", "auto_layout"];
const INSERT_LINE_TOOLS: CanvasToolId[] = ["line", "arrow"];
const DRAW_TOOLS: CanvasToolId[] = ["pen", "pencil", "brush"];
const INSERT_DRAG_THRESHOLD = 3;

const DEFAULT_SHAPE_TOOL_PRESET: ShapeToolPreset = {
  fill: "#B6BBC2",
  strokeEnabled: false,
  stroke: "#0f172a",
  strokeWidth: 2,
  strokeDashPreset: "solid",
  cornerRadius: 0,
  opacity: 100,
  polygonSides: 6,
  starPoints: 5,
  starInnerRatio: 0.46,
};

const DEFAULT_LINE_TOOL_PRESET: ContextToolbarLineState = {
  color: "#3A3F47",
  width: 4,
  opacity: 100,
  dashPreset: "solid",
  roundedEndpoints: true,
};

const DEFAULT_ARROW_TOOL_PRESET: ContextToolbarLineState = {
  color: "#3A3F47",
  width: 4,
  opacity: 100,
  dashPreset: "solid",
  roundedEndpoints: true,
};

const DEFAULT_DRAW_TOOL_PRESETS: Record<DrawToolId, ContextToolbarLineState> = {
  pen: {
    color: "#0f172a",
    width: 2,
    opacity: 100,
    dashPreset: "solid",
    roundedEndpoints: true,
  },
  pencil: {
    color: "#334155",
    width: 3,
    opacity: 88,
    dashPreset: "solid",
    roundedEndpoints: true,
  },
  brush: {
    color: "#8B5CF6",
    width: 12,
    opacity: 85,
    dashPreset: "solid",
    roundedEndpoints: true,
  },
};

const DEFAULT_DRAW_TOOL_PRESET: ContextToolbarLineState = DEFAULT_DRAW_TOOL_PRESETS.pencil;

const DEFAULT_TEXT_TOOL_PRESET: TextToolPreset = {
  fontFamily: "Inter",
  fontStyle: "Regular",
  fontSize: 42,
  lineHeight: 120,
  tracking: 0,
  color: "#111111",
  textAlign: "left",
  fitMode: "free",
  bold: false,
  italic: false,
  underline: false,
  opacity: 100,
};

const DEFAULT_AUTO_LAYOUT_LAYOUT_PATCH: Partial<PinselaNode["layout"]> = {
  direction: "vertical",
  gap: 16,
  padding_top: 16,
  padding_right: 16,
  padding_bottom: 16,
  padding_left: 16,
  align_main: "start",
  align_cross: "start",
  sizing_mode: "fixed",
  wrap: false,
  wrap_mode: "flow",
  grid_columns: 0,
  grid_rows: 0,
};

const DEFAULT_AUTO_LAYOUT_CONTENT_RULE: AutoLayoutContentLimitPatch = {
  enabled: true,
  maxChars: 180,
  startFontSize: 42,
  minFontSize: 16,
  shrinkStep: 1,
  truncateMode: "ellipsis",
};

type SnapOptionsWithCustomGuides = SnapOptions & {
  customGuides?: GuideLine[];
};

const DEFAULT_ADD_GUIDES_VALUES: AddGuidesValues = {
  columns: 12,
  columnGap: 24,
  columnMargin: 48,
  rows: 0,
  rowGap: 24,
  rowMargin: 48,
};

function toSafeGuideInt(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.round(value));
}

function normalizeAddGuidesValues(values?: Partial<AddGuidesValues>): AddGuidesValues {
  return {
    columns: toSafeGuideInt(Number(values?.columns), DEFAULT_ADD_GUIDES_VALUES.columns),
    columnGap: toSafeGuideInt(Number(values?.columnGap), DEFAULT_ADD_GUIDES_VALUES.columnGap),
    columnMargin: toSafeGuideInt(Number(values?.columnMargin), DEFAULT_ADD_GUIDES_VALUES.columnMargin),
    rows: toSafeGuideInt(Number(values?.rows), DEFAULT_ADD_GUIDES_VALUES.rows),
    rowGap: toSafeGuideInt(Number(values?.rowGap), DEFAULT_ADD_GUIDES_VALUES.rowGap),
    rowMargin: toSafeGuideInt(Number(values?.rowMargin), DEFAULT_ADD_GUIDES_VALUES.rowMargin),
  };
}

function buildGuidesForAxis(
  axis: "x" | "y",
  totalSize: number,
  count: number,
  gap: number,
  margin: number,
): GuideLine[] {
  const normalizedCount = Math.max(0, Math.round(Number(count || 0)));
  if (normalizedCount <= 0) return [];
  const normalizedSize = Math.max(0, Number(totalSize || 0));
  if (normalizedSize <= 0) return [];
  const normalizedGap = Math.max(0, Number(gap || 0));
  const normalizedMargin = Math.max(0, Number(margin || 0));
  const contentSpan = normalizedSize - normalizedMargin * 2;
  if (contentSpan <= 0) return [];
  const totalGap = normalizedGap * Math.max(0, normalizedCount - 1);
  const segmentSize = (contentSpan - totalGap) / normalizedCount;
  if (!Number.isFinite(segmentSize) || segmentSize <= 0) return [];

  const values: number[] = [];
  for (let index = 0; index < normalizedCount; index += 1) {
    const start = normalizedMargin + index * (segmentSize + normalizedGap);
    const end = start + segmentSize;
    values.push(start, end);
  }

  const guides: GuideLine[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const rounded = Math.round(raw * 100) / 100;
    if (!Number.isFinite(rounded)) continue;
    if (rounded < 0 || rounded > normalizedSize) continue;
    const key = `${axis}:${rounded.toFixed(2)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    guides.push({ axis, value: rounded, source: "page" });
  }
  return guides;
}

function buildArtboardGuides(
  canvasWidth: number,
  canvasHeight: number,
  values: AddGuidesValues,
): GuideLine[] {
  const normalized = normalizeAddGuidesValues(values);
  return [
    ...buildGuidesForAxis("x", canvasWidth, normalized.columns, normalized.columnGap, normalized.columnMargin),
    ...buildGuidesForAxis("y", canvasHeight, normalized.rows, normalized.rowGap, normalized.rowMargin),
  ];
}

const AUTO_LAYOUT_LIMIT_PRESETS: AutoLayoutLimitPresetView[] = [
  {
    id: "story",
    label: "Story/Reels",
    description: "Short, readable text on vertical screens, with aggressive shrinking to avoid overflow.",
    rule: {
      enabled: true,
      maxChars: 96,
      startFontSize: 48,
      minFontSize: 20,
      shrinkStep: 1.5,
      truncateMode: "ellipsis",
    },
  },
  {
    id: "a4",
    label: "A4/Print",
    description: "Allows more text with gentle shrinking and higher content density.",
    rule: {
      enabled: true,
      maxChars: 520,
      startFontSize: 30,
      minFontSize: 11,
      shrinkStep: 0.35,
      truncateMode: "cut",
    },
  },
  {
    id: "banner",
    label: "Banner/Hero",
    description: "Quick, high-impact messages; favors short phrases and visual emphasis.",
    rule: {
      enabled: true,
      maxChars: 64,
      startFontSize: 56,
      minFontSize: 18,
      shrinkStep: 2.1,
      truncateMode: "ellipsis",
    },
  },
  {
    id: "generic",
    label: "Generic",
    description: "Balance of flexibility and safety for most layouts.",
    rule: {
      enabled: true,
      maxChars: 180,
      startFontSize: 42,
      minFontSize: 16,
      shrinkStep: 1,
      truncateMode: "ellipsis",
    },
  },
];

function inferAutoLayoutPreset(
  format: CanvasFormat | null,
  canvasWidth: number,
  canvasHeight: number,
): AutoLayoutLimitPresetId {
  const id = String(format?.id || "").toLowerCase();
  const name = String(format?.name || "").toLowerCase();
  if (
    id.includes("story")
    || id.includes("reels")
    || id.includes("tiktok")
    || name.includes("story")
    || name.includes("reels")
  ) {
    return "story";
  }
  if (id.includes("a4") || id.includes("letter") || name.includes("a4") || name.includes("letter")) {
    return "a4";
  }
  const width = Math.max(1, Number(canvasWidth || 1));
  const height = Math.max(1, Number(canvasHeight || 1));
  const ratio = width / height;
  if (ratio >= 1.65 || ratio <= 0.62 || width >= 1900 || height >= 1900) {
    return "banner";
  }
  return "generic";
}

function isInsertShapeTool(tool: CanvasToolId): tool is "rect" | "ellipse" | "polygon" | "star" | "frame" | "auto_layout" {
  return INSERT_SHAPE_TOOLS.includes(tool);
}

function isInsertLineTool(tool: CanvasToolId): tool is "line" | "arrow" {
  return INSERT_LINE_TOOLS.includes(tool);
}

function isInsertTool(tool: CanvasToolId): tool is InsertToolId {
  return isInsertShapeTool(tool) || isInsertLineTool(tool) || tool === "media";
}

function isDrawTool(tool: CanvasToolId): tool is DrawToolId {
  return DRAW_TOOLS.includes(tool);
}

function dashPresetToSegments(dashPreset: ContextToolbarLineState["dashPreset"]): number[] {
  if (dashPreset === "dash") return [10, 8];
  if (dashPreset === "long_dash") return [18, 10];
  if (dashPreset === "dotted") return [2, 6];
  return [];
}

function dashPresetFromSegments(rawDash: unknown): ShapeToolPreset["strokeDashPreset"] {
  const dash = Array.isArray(rawDash)
    ? rawDash.map((value) => Number(value)).filter(Number.isFinite)
    : [];
  if (dash.length === 0) return "solid";
  if (dash.length >= 2 && dash[0] <= 3) return "dotted";
  if (dash.length >= 2 && dash[0] >= 16) return "long_dash";
  return "dash";
}

function applyLinePresetPatch(
  base: ContextToolbarLineState,
  patch: Partial<{
    color: unknown;
    width: number;
    dashPreset: ContextToolbarLineState["dashPreset"];
    roundedEndpoints: boolean;
    opacity: number;
  }>,
): ContextToolbarLineState {
  return {
    color: patch.color ?? base.color,
    width: patch.width != null ? Math.max(1, Math.round(patch.width)) : base.width,
    dashPreset: patch.dashPreset ?? base.dashPreset,
    roundedEndpoints: patch.roundedEndpoints != null ? Boolean(patch.roundedEndpoints) : base.roundedEndpoints,
    opacity: patch.opacity != null ? Math.max(0, Math.min(100, Math.round(patch.opacity))) : base.opacity,
  };
}

function getNodeShapeGeometryType(node: PinselaNode | null | undefined): "rect" | "ellipse" | "polygon" | "star" | "path" | "line" {
  if (!node) return "rect";
  if (node.kind === "line") return "line";
  if (node.kind !== "rect" && node.kind !== "path") return "path";
  const raw = String((node.style as any)?.shape_type || "").toLowerCase();
  if (raw === "ellipse" || raw === "polygon" || raw === "star") return raw;
  if (raw === "rect") return "rect";
  return node.kind === "rect" ? "rect" : "path";
}

function getRectShapeType(node: PinselaNode | null | undefined): "rect" | "ellipse" | "polygon" | "star" {
  const shapeType = getNodeShapeGeometryType(node);
  if (shapeType === "ellipse" || shapeType === "polygon" || shapeType === "star") return shapeType;
  return "rect";
}

function isEllipseShape(node: PinselaNode | null | undefined): boolean {
  return getRectShapeType(node) === "ellipse";
}

function isRadiusLockedShape(node: PinselaNode | null | undefined): boolean {
  if (!node || (node.kind !== "rect" && node.kind !== "path")) return false;
  const shapeType = getNodeShapeGeometryType(node);
  return shapeType === "ellipse" || shapeType === "polygon" || shapeType === "star";
}

function isRectLikePathNode(node: PinselaNode | null | undefined): boolean {
  return !!node && node.kind === "path" && getNodeShapeGeometryType(node) === "rect";
}

function svgSubpathsToPathData(
  subpaths: Array<{ closed: boolean; anchors: Array<{ x: number; y: number; in?: { x: number; y: number } | null; out?: { x: number; y: number } | null; mode?: "corner" | "smooth" }> }>,
  fillRule: PinselaPathFillRule = "nonzero",
): PinselaNode["path_data"] | null {
  const normalizedSubpaths = subpaths
    .map((subpath) => ({
      closed: subpath.closed !== false,
      points: (subpath.anchors || [])
        .map((anchor) => ({
          x: round2(Number(anchor?.x || 0)),
          y: round2(Number(anchor?.y || 0)),
          in: anchor?.in ? { x: round2(Number(anchor.in.x || 0)), y: round2(Number(anchor.in.y || 0)) } : anchor?.in ?? null,
          out: anchor?.out ? { x: round2(Number(anchor.out.x || 0)), y: round2(Number(anchor.out.y || 0)) } : anchor?.out ?? null,
          mode: (anchor?.mode === "smooth" ? "smooth" : "corner") as "smooth" | "corner",
        }))
        .filter((anchor) => Number.isFinite(anchor.x) && Number.isFinite(anchor.y)),
    }))
    .filter((subpath) => subpath.points.length >= 2);
  if (!normalizedSubpaths.length) return null;
  return {
    closed: normalizedSubpaths[0].closed !== false,
    points: normalizedSubpaths[0].points.map((point) => ({
      x: point.x,
      y: point.y,
      in: point.in ? { ...point.in } : point.in ?? null,
      out: point.out ? { ...point.out } : point.out ?? null,
      mode: point.mode,
    })),
    subpaths: normalizedSubpaths.map((subpath) => ({
      closed: subpath.closed !== false,
      points: subpath.points.map((point) => ({
        x: point.x,
        y: point.y,
        in: point.in ? { ...point.in } : point.in ?? null,
        out: point.out ? { ...point.out } : point.out ?? null,
        mode: point.mode,
      })),
    })),
    fill_rule: fillRule === "evenodd" ? "evenodd" : "nonzero",
  };
}

function buildRectLikePathData(node: PinselaNode, cornerRadius: number): PinselaNode["path_data"] | null {
  if (!isRectLikePathNode(node)) return null;
  const width = Math.max(1, Math.abs(Number(node.geometry?.width || 0)));
  const height = Math.max(1, Math.abs(Number(node.geometry?.height || 0)));
  return svgSubpathsToPathData(
    buildSvgRectSubpaths(0, 0, width, height, cornerRadius, cornerRadius),
    node.path_data?.fill_rule === "evenodd" ? "evenodd" : "nonzero",
  );
}

function isLegacyCircleNode(node: PinselaNode): boolean {
  if (node.kind !== "rect") return false;
  const name = String(node.name || "").trim().toLowerCase();
  if (name !== "circle") return false;
  const width = Math.max(0, Math.abs(Number(node.geometry?.width || 0)));
  const height = Math.max(0, Math.abs(Number(node.geometry?.height || 0)));
  const expectedRadius = Math.min(width, height) / 2;
  const radius = Math.max(0, Number(node.geometry?.corner_radius || 0));
  if (expectedRadius <= 0) return false;
  return Math.abs(radius - expectedRadius) <= 1;
}

const DEFAULT_IMAGE_BRUSH_SETTINGS: ContextToolbarImageBrushState = {
  enabled: false,
  mode: "shadow",
  color: "#111111",
  size: 180,
  opacity: 100,
  flow: 100,
  hardness: 45,
  accumulation: 100,
  spacing: 15,
  shape: 100,
  rotation: 0,
};

function normalizeImageBrushSettings(
  rawSettings?: Partial<PinselaImageBrushSettings> | null,
  fallback?: ContextToolbarImageBrushState,
): ContextToolbarImageBrushState {
  const base = fallback || DEFAULT_IMAGE_BRUSH_SETTINGS;
  const mode = String(rawSettings?.mode || base.mode || "shadow").toLowerCase() === "erase" ? "erase" : "shadow";
  return {
    enabled: Boolean(base.enabled),
    mode,
    color: rawSettings?.color ?? base.color ?? "#111111",
    size: clampRange(Number(rawSettings?.size), 1, 2200, base.size),
    opacity: clampRange(Number(rawSettings?.opacity), 0, 100, base.opacity),
    flow: clampRange(Number(rawSettings?.flow), 1, 100, base.flow),
    hardness: clampRange(Number(rawSettings?.hardness), 0, 100, base.hardness),
    accumulation: clampRange(Number(rawSettings?.accumulation), 0, 100, base.accumulation),
    spacing: clampRange(Number(rawSettings?.spacing), 1, 100, base.spacing),
    shape: clampRange(Number(rawSettings?.shape), 1, 100, base.shape),
    rotation: clampRange(Number(rawSettings?.rotation), -180, 180, base.rotation),
  };
}

function toStoredBrushSettings(brush: ContextToolbarImageBrushState): PinselaImageBrushSettings {
  return {
    mode: brush.mode,
    color: brush.color,
    size: brush.size,
    opacity: brush.opacity,
    flow: brush.flow,
    hardness: brush.hardness,
    accumulation: brush.accumulation,
    spacing: brush.spacing,
    shape: brush.shape,
    rotation: brush.rotation,
  };
}

const DEFAULT_IMAGE_DUOTONE_SETTINGS: ContextToolbarImageDuotoneState = {
  enabled: false,
  shadows: "#111114",
  highlights: "#f8fafc",
  amount: 100,
};

function normalizeImageDuotoneSettings(
  rawSettings?: Partial<PinselaImageDuotoneSettings> | null,
  fallback?: ContextToolbarImageDuotoneState,
): ContextToolbarImageDuotoneState {
  const base = fallback || DEFAULT_IMAGE_DUOTONE_SETTINGS;
  return {
    enabled: rawSettings?.enabled != null ? Boolean(rawSettings.enabled) : Boolean(base.enabled),
    shadows: rawSettings?.shadows ?? base.shadows,
    highlights: rawSettings?.highlights ?? base.highlights,
    amount: clampRange(Number(rawSettings?.amount), 0, 100, base.amount),
  };
}

function toStoredImageDuotoneSettings(duotone: ContextToolbarImageDuotoneState): PinselaImageDuotoneSettings {
  return {
    enabled: duotone.enabled,
    shadows: duotone.shadows,
    highlights: duotone.highlights,
    amount: duotone.amount,
  };
}

const DEFAULT_IMAGE_TRACE_SETTINGS: ContextToolbarImageTraceState = {
  edgeThreshold: 50,
  curveTolerance: 40,
  processing: false,
};

type TracePoint = { x: number; y: number };
type TracePolyline = { points: TracePoint[]; closed: boolean };
type TraceVectorResult = {
  polylines: TracePolyline[];
  strokeColor: string;
};

type TracePreviewState = {
  nodeId: string;
  edgeThreshold: number;
  curveTolerance: number;
  polylines: TracePolyline[];
  pathData: string[];
  strokeColor: string;
};

type TraceSettings = {
  edgeThreshold: number;
  curveTolerance: number;
};

function clampPercent(value: number, fallback: number): number {
  return clampRange(Number(value), 0, 100, fallback);
}

function createRasterContext(width: number, height: number): { canvas: HTMLCanvasElement | OffscreenCanvas; ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D } | null {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d");
    if (ctx) return { canvas, ctx };
  }
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (ctx) return { canvas, ctx };
  }
  return null;
}

function imageDimensions(image: CanvasImageSource): { width: number; height: number } {
  const raw = image as any;
  const width = Number(raw.naturalWidth || raw.videoWidth || raw.displayWidth || raw.width || 0);
  const height = Number(raw.naturalHeight || raw.videoHeight || raw.displayHeight || raw.height || 0);
  return {
    width: Math.max(1, Math.round(width || 1)),
    height: Math.max(1, Math.round(height || 1)),
  };
}

type TraceImagePlacement = {
  dx: number;
  dy: number;
  dw: number;
  dh: number;
  useSourceRect: boolean;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
};

function computeTraceImagePlacement(
  node: PinselaNode,
  image: CanvasImageSource,
  frameWidth: number,
  frameHeight: number,
): TraceImagePlacement {
  const fit = String(node.style.image_fit || "fill").toLowerCase();
  const crop = node.style.image_crop || null;
  const dim = imageDimensions(image);
  if (fit === "crop" && crop && crop.width > 0 && crop.height > 0) {
    const sx = Math.max(0, Math.min(dim.width - 1, Math.round(Number(crop.x || 0))));
    const sy = Math.max(0, Math.min(dim.height - 1, Math.round(Number(crop.y || 0))));
    const sw = Math.max(1, Math.min(dim.width - sx, Math.round(Number(crop.width || 1))));
    const sh = Math.max(1, Math.min(dim.height - sy, Math.round(Number(crop.height || 1))));
    return { dx: 0, dy: 0, dw: frameWidth, dh: frameHeight, useSourceRect: true, sx, sy, sw, sh };
  }
  if (fit === "fit") {
    const ratio = Math.min(frameWidth / dim.width, frameHeight / dim.height);
    const w = dim.width * ratio;
    const h = dim.height * ratio;
    return {
      dx: (frameWidth - w) / 2,
      dy: (frameHeight - h) / 2,
      dw: w,
      dh: h,
      useSourceRect: false,
      sx: 0,
      sy: 0,
      sw: dim.width,
      sh: dim.height,
    };
  }
  const ratio = Math.max(frameWidth / dim.width, frameHeight / dim.height);
  const w = dim.width * ratio;
  const h = dim.height * ratio;
  return {
    dx: (frameWidth - w) / 2,
    dy: (frameHeight - h) / 2,
    dw: w,
    dh: h,
    useSourceRect: false,
    sx: 0,
    sy: 0,
    sw: dim.width,
    sh: dim.height,
  };
}

function drawTraceImage(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  image: CanvasImageSource,
  placement: TraceImagePlacement,
): void {
  if (placement.useSourceRect) {
    ctx.drawImage(
      image,
      placement.sx,
      placement.sy,
      placement.sw,
      placement.sh,
      placement.dx,
      placement.dy,
      placement.dw,
      placement.dh,
    );
    return;
  }
  ctx.drawImage(image, placement.dx, placement.dy, placement.dw, placement.dh);
}

function edgeMaskFromImageData(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  edgeThreshold: number,
): Uint8Array {
  const luma = new Float32Array(width * height);
  const alpha = new Float32Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    const a = data[i + 3] / 255;
    alpha[p] = a;
    luma[p] = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  }
  const out = new Uint8Array(width * height);
  const threshold = 10 + (edgeThreshold / 100) * 170;
  const alphaCut = 0.015 + (edgeThreshold / 100) * 0.18;
  for (let y = 1; y < height - 1; y += 1) {
    const row = y * width;
    for (let x = 1; x < width - 1; x += 1) {
      const i = row + x;
      const tl = i - width - 1;
      const tc = i - width;
      const tr = i - width + 1;
      const ml = i - 1;
      const mr = i + 1;
      const bl = i + width - 1;
      const bc = i + width;
      const br = i + width + 1;

      const gx = -luma[tl] - 2 * luma[ml] - luma[bl] + luma[tr] + 2 * luma[mr] + luma[br];
      const gy = -luma[tl] - 2 * luma[tc] - luma[tr] + luma[bl] + 2 * luma[bc] + luma[br];
      const gax = -alpha[tl] - 2 * alpha[ml] - alpha[bl] + alpha[tr] + 2 * alpha[mr] + alpha[br];
      const gay = -alpha[tl] - 2 * alpha[tc] - alpha[tr] + alpha[bl] + 2 * alpha[bc] + alpha[br];
      const luminanceMag = Math.hypot(gx, gy) / 4;
      const alphaMag = (Math.hypot(gax, gay) * 255) / 4;
      const centerAlpha = alpha[i];
      const alphaBoundary = centerAlpha > alphaCut && (
        Math.abs(centerAlpha - alpha[ml]) > 0.07
        || Math.abs(centerAlpha - alpha[mr]) > 0.07
        || Math.abs(centerAlpha - alpha[tc]) > 0.07
        || Math.abs(centerAlpha - alpha[bc]) > 0.07
      );
      const combined = luminanceMag * 0.78 + alphaMag * 1.2;
      if (combined >= threshold || alphaBoundary) out[i] = 1;
    }
  }
  return out;
}

function pointKey(point: TracePoint): string {
  return `${Math.round(point.x * 2)}:${Math.round(point.y * 2)}`;
}

function marchingSquaresSegments(mask: Uint8Array, width: number, height: number): Array<[TracePoint, TracePoint]> {
  const segments: Array<[TracePoint, TracePoint]> = [];
  const top = (x: number, y: number): TracePoint => ({ x: x + 0.5, y });
  const right = (x: number, y: number): TracePoint => ({ x: x + 1, y: y + 0.5 });
  const bottom = (x: number, y: number): TracePoint => ({ x: x + 0.5, y: y + 1 });
  const left = (x: number, y: number): TracePoint => ({ x, y: y + 0.5 });

  for (let y = 0; y < height - 1; y += 1) {
    const row = y * width;
    for (let x = 0; x < width - 1; x += 1) {
      const tl = mask[row + x] ? 1 : 0;
      const tr = mask[row + x + 1] ? 1 : 0;
      const br = mask[row + width + x + 1] ? 1 : 0;
      const bl = mask[row + width + x] ? 1 : 0;
      const idx = tl | (tr << 1) | (br << 2) | (bl << 3);
      if (idx === 0 || idx === 15) continue;
      if (idx === 1 || idx === 14) segments.push([left(x, y), top(x, y)]);
      else if (idx === 2 || idx === 13) segments.push([top(x, y), right(x, y)]);
      else if (idx === 3 || idx === 12) segments.push([left(x, y), right(x, y)]);
      else if (idx === 4 || idx === 11) segments.push([right(x, y), bottom(x, y)]);
      else if (idx === 5) {
        segments.push([left(x, y), top(x, y)]);
        segments.push([right(x, y), bottom(x, y)]);
      } else if (idx === 6 || idx === 9) segments.push([top(x, y), bottom(x, y)]);
      else if (idx === 7 || idx === 8) segments.push([left(x, y), bottom(x, y)]);
      else if (idx === 10) {
        segments.push([top(x, y), right(x, y)]);
        segments.push([bottom(x, y), left(x, y)]);
      }
    }
  }
  return segments;
}

function linkTraceSegments(segments: Array<[TracePoint, TracePoint]>): TracePolyline[] {
  if (!segments.length) return [];
  const adjacency = new Map<string, number[]>();
  for (let i = 0; i < segments.length; i += 1) {
    const [a, b] = segments[i];
    const ak = pointKey(a);
    const bk = pointKey(b);
    if (!adjacency.has(ak)) adjacency.set(ak, []);
    if (!adjacency.has(bk)) adjacency.set(bk, []);
    adjacency.get(ak)!.push(i);
    adjacency.get(bk)!.push(i);
  }

  const used = new Uint8Array(segments.length);
  const out: TracePolyline[] = [];

  const nextFromKey = (key: string): { segIndex: number; point: TracePoint } | null => {
    const candidates = adjacency.get(key) || [];
    for (const segIndex of candidates) {
      if (used[segIndex]) continue;
      const [a, b] = segments[segIndex];
      if (pointKey(a) === key) return { segIndex, point: b };
      if (pointKey(b) === key) return { segIndex, point: a };
    }
    return null;
  };

  for (let i = 0; i < segments.length; i += 1) {
    if (used[i]) continue;
    used[i] = 1;
    const [start, end] = segments[i];
    const points: TracePoint[] = [{ ...start }, { ...end }];

    while (true) {
      const tail = points[points.length - 1];
      const found = nextFromKey(pointKey(tail));
      if (!found) break;
      used[found.segIndex] = 1;
      points.push({ ...found.point });
    }

    while (true) {
      const head = points[0];
      const found = nextFromKey(pointKey(head));
      if (!found) break;
      used[found.segIndex] = 1;
      points.unshift({ ...found.point });
    }

    if (points.length >= 2) {
      const closed = pointKey(points[0]) === pointKey(points[points.length - 1]);
      out.push({ points, closed });
    }
  }

  return out;
}

function distancePointToSegment(point: TracePoint, start: TracePoint, end: TracePoint): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.abs(dx) < 0.0001 && Math.abs(dy) < 0.0001) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
  const px = start.x + t * dx;
  const py = start.y + t * dy;
  return Math.hypot(point.x - px, point.y - py);
}

function simplifyPolyline(points: TracePoint[], tolerance: number): TracePoint[] {
  if (points.length <= 2) return points.slice();
  let maxDistance = 0;
  let index = 0;
  const start = points[0];
  const end = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i += 1) {
    const distance = distancePointToSegment(points[i], start, end);
    if (distance > maxDistance) {
      maxDistance = distance;
      index = i;
    }
  }
  if (maxDistance <= tolerance) return [start, end];
  const left = simplifyPolyline(points.slice(0, index + 1), tolerance);
  const right = simplifyPolyline(points.slice(index), tolerance);
  return [...left.slice(0, -1), ...right];
}

function averageMaskColor(data: Uint8ClampedArray, mask: Uint8Array): string {
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  for (let p = 0, i = 0; i < data.length; i += 4, p += 1) {
    if (!mask[p]) continue;
    const alpha = data[i + 3] / 255;
    if (alpha <= 0.01) continue;
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
    count += 1;
  }
  if (!count) return "#111111";
  const rr = Math.max(0, Math.min(255, Math.round(r / count)));
  const gg = Math.max(0, Math.min(255, Math.round(g / count)));
  const bb = Math.max(0, Math.min(255, Math.round(b / count)));
  return `#${rr.toString(16).padStart(2, "0")}${gg.toString(16).padStart(2, "0")}${bb.toString(16).padStart(2, "0")}`;
}

function rotatePointAround(point: TracePoint, center: TracePoint, rotationDeg: number): TracePoint {
  if (!rotationDeg) return point;
  const rad = (rotationDeg * Math.PI) / 180;
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return {
    x: center.x + dx * Math.cos(rad) - dy * Math.sin(rad),
    y: center.y + dx * Math.sin(rad) + dy * Math.cos(rad),
  };
}

function mapTracePointToWorld(
  point: TracePoint,
  node: PinselaNode,
  traceWidth: number,
  traceHeight: number,
): TracePoint {
  const g = node.geometry;
  const nx = traceWidth <= 1 ? 0 : point.x / traceWidth;
  const ny = traceHeight <= 1 ? 0 : point.y / traceHeight;
  const base = {
    x: Number(g.x || 0) + nx * Number(g.width || 0),
    y: Number(g.y || 0) + ny * Number(g.height || 0),
  };
  const center = {
    x: Number(g.x || 0) + Number(g.width || 0) / 2,
    y: Number(g.y || 0) + Number(g.height || 0) / 2,
  };
  return rotatePointAround(base, center, Number(g.rotation || 0));
}

function polylinePathData(points: TracePoint[]): string {
  if (points.length < 2) return "";
  const [first, ...rest] = points;
  const parts = [`M ${first.x.toFixed(2)} ${first.y.toFixed(2)}`];
  for (const point of rest) {
    parts.push(`L ${point.x.toFixed(2)} ${point.y.toFixed(2)}`);
  }
  return parts.join(" ");
}

async function computeImageTrace(
  node: PinselaNode,
  image: CanvasImageSource,
  settings: TraceSettings,
): Promise<TraceVectorResult | null> {
  if (node.kind !== "image") return null;
  const g = node.geometry;
  const frameWidth = Math.max(8, Number(g.width || 0));
  const frameHeight = Math.max(8, Number(g.height || 0));
  const imageDim = imageDimensions(image);
  const sourceScale = Math.min(4, Math.max(
    imageDim.width / Math.max(1, frameWidth),
    imageDim.height / Math.max(1, frameHeight),
  ));
  let traceWidth = Math.max(192, Math.round(frameWidth * sourceScale));
  let traceHeight = Math.max(192, Math.round(frameHeight * sourceScale));
  const maxSide = 1800;
  const biggestSide = Math.max(traceWidth, traceHeight);
  if (biggestSide > maxSide) {
    const factor = maxSide / biggestSide;
    traceWidth = Math.max(96, Math.round(traceWidth * factor));
    traceHeight = Math.max(96, Math.round(traceHeight * factor));
  }

  const raster = createRasterContext(traceWidth, traceHeight);
  if (!raster) return null;
  const { ctx } = raster;
  ctx.clearRect(0, 0, traceWidth, traceHeight);
  const placement = computeTraceImagePlacement(node, image, traceWidth, traceHeight);
  drawTraceImage(ctx, image, placement);
  const imageData = ctx.getImageData(0, 0, traceWidth, traceHeight);
  const mask = edgeMaskFromImageData(
    imageData.data,
    traceWidth,
    traceHeight,
    clampPercent(settings.edgeThreshold, DEFAULT_IMAGE_TRACE_SETTINGS.edgeThreshold),
  );
  const segments = marchingSquaresSegments(mask, traceWidth, traceHeight);
  if (!segments.length) {
    return { polylines: [], strokeColor: averageMaskColor(imageData.data, mask) };
  }
  const linked = linkTraceSegments(segments);
  const tolerancePx = 0.18 + (clampPercent(settings.curveTolerance, DEFAULT_IMAGE_TRACE_SETTINGS.curveTolerance) / 100) * 6.2;
  const simplified: TracePolyline[] = [];
  for (const polyline of linked) {
    const points = polyline.points;
    if (points.length < 2) continue;
    const closed = polyline.closed;
    const source = closed && points.length > 2 ? points.slice(0, -1) : points;
    const reduced = simplifyPolyline(source, tolerancePx);
    if (reduced.length < 2) continue;
    const withClosure = closed ? [...reduced, reduced[0]] : reduced;
    const worldPoints = withClosure.map((point) => mapTracePointToWorld(point, node, traceWidth, traceHeight));
    simplified.push({ points: worldPoints, closed });
  }

  return {
    polylines: simplified,
    strokeColor: averageMaskColor(imageData.data, mask),
  };
}

function materializeTracePaths(
  doc: PinselaTemplateDocV1,
  node: PinselaNode,
  polylines: TracePolyline[],
  strokeColor: string,
): { doc: PinselaTemplateDocV1; pathIds: string[] } | null {
  const maxPoints = 5200;
  const traces: Array<{ points: TracePoint[]; closed: boolean }> = [];
  let totalPoints = 0;
  for (const polyline of polylines) {
    const source = Array.isArray(polyline.points) ? polyline.points : [];
    if (source.length < 2) continue;
    const deduped: TracePoint[] = [];
    for (const point of source) {
      const current = { x: Number(point.x || 0), y: Number(point.y || 0) };
      const prev = deduped[deduped.length - 1];
      if (!prev || Math.hypot(current.x - prev.x, current.y - prev.y) >= 0.45) {
        deduped.push(current);
      }
    }
    if (deduped.length < 2) continue;
    traces.push({ points: deduped, closed: polyline.closed && deduped.length >= 3 });
    totalPoints += deduped.length;
  }
  if (!traces.length) return null;

  const decimation = totalPoints > maxPoints ? Math.ceil(totalPoints / maxPoints) : 1;
  let nextDoc = doc;
  const pathIds: string[] = [];
  let traceIndex = 0;
  for (const trace of traces) {
    const reducedPoints = decimation > 1
      ? trace.points.filter((_, index) => index === 0 || index === trace.points.length - 1 || index % decimation === 0)
      : trace.points;
    if (reducedPoints.length < 2) continue;

    const anchors: PathAnchorSpec[] = reducedPoints.map((point) => ({
      x: point.x,
      y: point.y,
      mode: "corner",
    }));
    const nextPath = buildPathNodeFromAnchors(anchors, {
      closed: trace.closed,
      name: `TRACE_${node.name || "image"}_${traceIndex + 1}`,
      parentId: node.parent_id || null,
      sourceStyle: {
        ...defaultNode("path").style,
        fill: "rgba(0,0,0,0)",
        stroke: {
          color: strokeColor,
          width: 1,
          dash: [],
          cap: "round",
        },
        opacity: clampRange(Number(node.style?.opacity), 0, 1, 1),
      },
      forceTransparentFill: true,
    });
    traceIndex += 1;
    if (!nextPath) continue;
    nextDoc = addNode(nextDoc, nextPath);
    pathIds.push(nextPath.id);
  }
  if (!pathIds.length) return null;
  return { doc: nextDoc, pathIds };
}

function normalizeBrushStroke(raw: unknown): PinselaImageBrushStroke | null {
  if (!raw || typeof raw !== "object") return null;
  const stroke = raw as Record<string, unknown>;
  const mode = String(stroke.mode || "shadow").toLowerCase() === "erase" ? "erase" : "shadow";
  const points = (Array.isArray(stroke.points) ? stroke.points : [])
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const point = entry as Record<string, unknown>;
      return {
        u: clampRange(Number(point.u), 0, 1, 0),
        v: clampRange(Number(point.v), 0, 1, 0),
      } as PinselaImageBrushPoint;
    })
    .filter(Boolean) as PinselaImageBrushPoint[];
  if (!points.length) return null;
  return {
    id: String(stroke.id || `brush_${Math.random().toString(36).slice(2, 10)}`),
    mode,
    color: stroke.color,
    size: clampRange(Number(stroke.size), 1, 2200, DEFAULT_IMAGE_BRUSH_SETTINGS.size),
    opacity: clampRange(Number(stroke.opacity), 0, 100, DEFAULT_IMAGE_BRUSH_SETTINGS.opacity),
    flow: clampRange(Number(stroke.flow), 1, 100, DEFAULT_IMAGE_BRUSH_SETTINGS.flow),
    hardness: clampRange(Number(stroke.hardness), 0, 100, DEFAULT_IMAGE_BRUSH_SETTINGS.hardness),
    accumulation: clampRange(Number(stroke.accumulation), 0, 100, DEFAULT_IMAGE_BRUSH_SETTINGS.accumulation),
    spacing: clampRange(Number(stroke.spacing), 1, 100, DEFAULT_IMAGE_BRUSH_SETTINGS.spacing),
    shape: clampRange(Number(stroke.shape), 1, 100, DEFAULT_IMAGE_BRUSH_SETTINGS.shape),
    rotation: clampRange(Number(stroke.rotation), -180, 180, DEFAULT_IMAGE_BRUSH_SETTINGS.rotation),
    points,
  };
}

function normalizeStoredStrokes(raw: unknown): PinselaImageBrushStroke[] {
  const entries = Array.isArray(raw) ? raw : [];
  return entries
    .map((stroke) => normalizeBrushStroke(stroke))
    .filter(Boolean) as PinselaImageBrushStroke[];
}

function pointToBrushUv(point: { x: number; y: number }, node: PinselaNode): PinselaImageBrushPoint | null {
  const g = node.geometry;
  const width = Math.max(0.0001, Number(g.width || 0));
  const height = Math.max(0.0001, Number(g.height || 0));
  const cx = Number(g.x || 0) + width / 2;
  const cy = Number(g.y || 0) + height / 2;
  const rotationRad = (Number(g.rotation || 0) * Math.PI) / 180;
  const dx = point.x - cx;
  const dy = point.y - cy;
  const localX = dx * Math.cos(-rotationRad) - dy * Math.sin(-rotationRad) + width / 2;
  const localY = dx * Math.sin(-rotationRad) + dy * Math.cos(-rotationRad) + height / 2;
  const u = localX / width;
  const v = localY / height;
  const margin = 0.2; // allow soft edge to start near border
  if (u < -margin || u > 1 + margin || v < -margin || v > 1 + margin) return null;
  return {
    u: clampRange(u, 0, 1, 0),
    v: clampRange(v, 0, 1, 0),
  };
}

function uvDistancePx(a: PinselaImageBrushPoint, b: PinselaImageBrushPoint, node: PinselaNode): number {
  const width = Math.max(1, Number(node.geometry.width || 0));
  const height = Math.max(1, Number(node.geometry.height || 0));
  const dx = (b.u - a.u) * width;
  const dy = (b.v - a.v) * height;
  return Math.hypot(dx, dy);
}

function interpolateBrushPoints(
  start: PinselaImageBrushPoint,
  end: PinselaImageBrushPoint,
  spacingPx: number,
  node: PinselaNode,
): PinselaImageBrushPoint[] {
  const distance = uvDistancePx(start, end, node);
  if (distance <= 0.001) return [end];
  const steps = Math.max(1, Math.ceil(distance / Math.max(0.75, spacingPx)));
  const out: PinselaImageBrushPoint[] = [];
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    out.push({
      u: clampRange(start.u + (end.u - start.u) * t, 0, 1, 0),
      v: clampRange(start.v + (end.v - start.v) * t, 0, 1, 0),
    });
  }
  return out;
}

const IMAGE_FILE_EXT_RE = /\.(png|jpe?g|webp|gif|bmp|svg|avif|tiff?)$/i;
const IMPORT_FILE_EXT_RE = /\.(svg|fig|psd|aff|afdesign|afphoto|afpub|pptx?|pdf|ai|eps|sketch|xd|cdr|indd|idml|png|jpe?g|webp|gif|bmp|avif|tiff?)$/i;

function isImageFileLike(file: File): boolean {
  const type = String(file.type || "").trim().toLowerCase();
  if (type.startsWith("image/")) return true;
  return IMAGE_FILE_EXT_RE.test(String(file.name || ""));
}

function isImportFileLike(file: File): boolean {
  const type = String(file.type || "").trim().toLowerCase();
  if (type.startsWith("image/")) return true;
  if (type.includes("svg") || type.includes("pdf")) return true;
  return IMPORT_FILE_EXT_RE.test(String(file.name || ""));
}

function getFileExtension(fileName: string): string {
  const raw = String(fileName || "").trim().toLowerCase();
  if (!raw) return "";
  const idx = raw.lastIndexOf(".");
  if (idx < 0 || idx === raw.length - 1) return "";
  return raw.slice(idx + 1);
}

function formatFileSizeLabel(sizeBytes: number): string {
  const size = Number(sizeBytes || 0);
  if (!Number.isFinite(size) || size <= 0) return "0 B";
  if (size < 1024) return `${Math.round(size)} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 102.4) / 10} KB`;
  if (size < 1024 * 1024 * 1024) return `${Math.round(size / (1024 * 102.4)) / 10} MB`;
  return `${Math.round(size / (1024 * 1024 * 102.4)) / 10} GB`;
}

function escapeSvgText(value: string): string {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function createImportPlaceholderDataUrl(
  name: string,
  extension: string,
  options?: {
    subtitle?: string;
    detail?: string;
    accent?: string;
    width?: number;
    height?: number;
  },
): string {
  const ext = String(extension || "FILE").toUpperCase().slice(0, 6) || "FILE";
  const width = Math.max(480, Math.min(2048, Math.round(Number(options?.width || 960))));
  const height = Math.max(320, Math.min(1536, Math.round(Number(options?.height || 720))));
  const fileName = String(name || "Import")
    .replace(/\.[^.]+$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 26);
  const safeName = escapeSvgText(fileName || "Imported file");
  const safeExt = escapeSvgText(ext);
  const safeSubtitle = escapeSvgText(String(options?.subtitle || "Imported item, ready to use on the canvas").slice(0, 60));
  const safeDetail = escapeSvgText(String(options?.detail || "").slice(0, 84));
  const accent = String(options?.accent || "#38bdf8");
  const panelX = Math.round(width * 0.067);
  const panelY = Math.round(height * 0.089);
  const panelW = Math.max(120, width - panelX * 2);
  const panelH = Math.max(120, height - panelY * 2);
  const badgeW = Math.round(width * 0.1875);
  const badgeH = Math.round(height * 0.111);
  const badgeX = panelX + Math.round(width * 0.033);
  const badgeY = panelY + Math.round(height * 0.044);
  const titleX = panelX + Math.round(width * 0.042);
  const titleY = panelY + Math.round(height * 0.239);
  const subtitleY = panelY + Math.round(height * 0.328);
  const detailY = panelY + Math.round(height * 0.385);
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="importBg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0f172a" />
      <stop offset="100%" stop-color="#1e293b" />
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="${width}" height="${height}" rx="${Math.max(20, Math.round(width * 0.058))}" fill="url(#importBg)" />
  <rect x="${panelX}" y="${panelY}" width="${panelW}" height="${panelH}" rx="${Math.max(18, Math.round(width * 0.046))}" fill="rgba(255,255,255,0.06)" stroke="rgba(148,163,184,0.45)" />
  <rect x="${badgeX}" y="${badgeY}" width="${badgeW}" height="${badgeH}" rx="${Math.max(12, Math.round(width * 0.021))}" fill="${escapeSvgText(accent)}" />
  <text x="${Math.round(badgeX + badgeW / 2)}" y="${Math.round(badgeY + badgeH * 0.65)}" text-anchor="middle" fill="#0f172a" font-family="Arial, sans-serif" font-size="${Math.max(16, Math.round(width * 0.0437))}" font-weight="700">${safeExt}</text>
  <text x="${titleX}" y="${titleY}" fill="#e2e8f0" font-family="Arial, sans-serif" font-size="${Math.max(24, Math.round(width * 0.052))}" font-weight="700">${safeName}</text>
  <text x="${titleX}" y="${subtitleY}" fill="#94a3b8" font-family="Arial, sans-serif" font-size="${Math.max(14, Math.round(width * 0.029))}">${safeSubtitle}</text>
  ${safeDetail ? `<text x="${titleX}" y="${detailY}" fill="#64748b" font-family="Arial, sans-serif" font-size="${Math.max(12, Math.round(width * 0.022))}">${safeDetail}</text>` : ""}
</svg>`.trim();
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function inferImportKind(extension: string, mimeType: string): ImportedAssetEntry["kind"] {
  const ext = String(extension || "").toLowerCase();
  const mime = String(mimeType || "").toLowerCase();
  if (ext === "svg" || mime.includes("svg")) return "vector";
  if (mime.startsWith("image/") || IMAGE_FILE_EXT_RE.test(`.${ext}`)) return "image";
  return "document";
}

function mapImportKindLabel(
  kind: ImportedAssetEntry["kind"],
  extension: string,
  parseMode?: ImportedAssetEntry["parseMode"],
  pageCount?: number,
): string {
  const ext = String(extension || "").toLowerCase();
  const pageLabel = ext === "pdf" && Number.isFinite(pageCount) && Number(pageCount) > 0
    ? ` · ${Math.max(1, Math.round(Number(pageCount)))} pg.`
    : "";
  const modeLabel = parseMode === "fallback" ? " · fallback" : "";
  if (kind === "image") return `Image${modeLabel}`;
  if (kind === "vector") return `Vector${modeLabel}`;
  const extLabel = String(extension || "").toUpperCase();
  return extLabel ? `Document ${extLabel}${pageLabel}${modeLabel}` : `Document${modeLabel}`;
}

function parseSvgLengthToPx(rawLength: unknown): number | null {
  const raw = String(rawLength || "").trim();
  if (!raw) return null;
  const match = raw.match(/^(-?\d*\.?\d+)\s*(px|pt|pc|mm|cm|in|q|%)?$/i);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  const unit = String(match[2] || "px").toLowerCase();
  if (unit === "px" || unit === "") return value;
  if (unit === "pt") return value * (96 / 72);
  if (unit === "pc") return value * 16;
  if (unit === "mm") return value * (96 / 25.4);
  if (unit === "cm") return value * (96 / 2.54);
  if (unit === "in") return value * 96;
  if (unit === "q") return value * (96 / 101.6);
  return null;
}

function parseCssFloat(value: unknown, fallback = 0): number {
  const parsed = Number.parseFloat(String(value ?? "").trim());
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeSvgPaint(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const lowered = raw.toLowerCase();
  if (lowered === "none" || lowered === "transparent") return null;
  return raw;
}

function normalizeSvgDegrees(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const mod = value % 360;
  return mod < 0 ? mod + 360 : mod;
}

function parseHexColor(raw: string): { r: number; g: number; b: number; a: number } | null {
  const value = String(raw || "").trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(value)) {
    return {
      r: Number.parseInt(value[0] + value[0], 16),
      g: Number.parseInt(value[1] + value[1], 16),
      b: Number.parseInt(value[2] + value[2], 16),
      a: 1,
    };
  }
  if (/^[0-9a-fA-F]{4}$/.test(value)) {
    return {
      r: Number.parseInt(value[0] + value[0], 16),
      g: Number.parseInt(value[1] + value[1], 16),
      b: Number.parseInt(value[2] + value[2], 16),
      a: Number.parseInt(value[3] + value[3], 16) / 255,
    };
  }
  if (/^[0-9a-fA-F]{6}$/.test(value)) {
    return {
      r: Number.parseInt(value.slice(0, 2), 16),
      g: Number.parseInt(value.slice(2, 4), 16),
      b: Number.parseInt(value.slice(4, 6), 16),
      a: 1,
    };
  }
  if (/^[0-9a-fA-F]{8}$/.test(value)) {
    return {
      r: Number.parseInt(value.slice(0, 2), 16),
      g: Number.parseInt(value.slice(2, 4), 16),
      b: Number.parseInt(value.slice(4, 6), 16),
      a: Number.parseInt(value.slice(6, 8), 16) / 255,
    };
  }
  return null;
}

function parseRgbCssColor(raw: string): { r: number; g: number; b: number; a: number } | null {
  const value = String(raw || "").trim();
  if (!/^rgba?\(/i.test(value)) return null;
  const tokens = value.match(/[-+]?(?:\d+\.?\d*|\.\d+)/g) || [];
  if (tokens.length < 3) return null;
  const r = Math.max(0, Math.min(255, Number(tokens[0])));
  const g = Math.max(0, Math.min(255, Number(tokens[1])));
  const b = Math.max(0, Math.min(255, Number(tokens[2])));
  const alphaRaw = tokens[3] != null ? Number(tokens[3]) : 1;
  const a = Number.isFinite(alphaRaw)
    ? Math.max(0, Math.min(1, alphaRaw > 1 ? alphaRaw / 100 : alphaRaw))
    : 1;
  if (![r, g, b, a].every(Number.isFinite)) return null;
  return { r, g, b, a };
}

let svgColorProbeContext: CanvasRenderingContext2D | null | undefined;

function getSvgColorProbeContext(): CanvasRenderingContext2D | null {
  if (svgColorProbeContext !== undefined) return svgColorProbeContext;
  if (typeof document === "undefined") {
    svgColorProbeContext = null;
    return svgColorProbeContext;
  }
  const canvas = document.createElement("canvas");
  svgColorProbeContext = canvas.getContext("2d");
  return svgColorProbeContext;
}

function normalizeSvgSolidColor(value: string): { r: number; g: number; b: number; a: number } | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const hex = parseHexColor(raw);
  if (hex) return hex;
  const rgb = parseRgbCssColor(raw);
  if (rgb) return rgb;
  const ctx = getSvgColorProbeContext();
  if (!ctx) return null;
  try {
    ctx.fillStyle = "#000000";
    ctx.fillStyle = raw;
  } catch {
    return null;
  }
  const normalized = String(ctx.fillStyle || "").trim();
  return parseHexColor(normalized) || parseRgbCssColor(normalized);
}

function serializeSvgSolidColor(color: { r: number; g: number; b: number; a: number }): string {
  const r = Math.max(0, Math.min(255, Math.round(color.r)));
  const g = Math.max(0, Math.min(255, Math.round(color.g)));
  const b = Math.max(0, Math.min(255, Math.round(color.b)));
  const a = Math.max(0, Math.min(1, Number(color.a)));
  if (a >= 0.999) {
    return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
  }
  return `rgba(${r}, ${g}, ${b}, ${Math.round(a * 1000) / 1000})`;
}

function applySvgOpacityToSolidColor(value: string, opacity: number): string | null {
  const normalized = normalizeSvgSolidColor(value);
  if (!normalized) return null;
  return serializeSvgSolidColor({
    ...normalized,
    a: normalized.a * clampRange(opacity, 0, 1, 1),
  });
}

function parseSvgDashArray(rawValue: unknown): number[] {
  const raw = String(rawValue ?? "").trim().toLowerCase();
  if (!raw || raw === "none") return [];
  return raw
    .split(/[,\s]+/)
    .map((token) => Number(token))
    .filter((token) => Number.isFinite(token) && token > 0)
    .map((token) => round2(token));
}

function distance2(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(Number(a.x || 0) - Number(b.x || 0), Number(a.y || 0) - Number(b.y || 0));
}

function mapSvgPointThroughMatrix(x: number, y: number, matrix: DOMMatrix | null): { x: number; y: number } {
  const px = Number(x || 0);
  const py = Number(y || 0);
  if (!matrix || typeof DOMPoint === "undefined") return { x: px, y: py };
  const transformed = new DOMPoint(px, py).matrixTransform(matrix);
  return {
    x: round2(transformed.x),
    y: round2(transformed.y),
  };
}

function svgMatrixFromUnknown(raw: unknown): DOMMatrix | null {
  if (!raw || typeof DOMMatrix === "undefined") return null;
  if (raw instanceof DOMMatrix) return raw;
  const matrix = raw as Record<string, unknown>;
  const a = Number(matrix.a);
  const b = Number(matrix.b);
  const c = Number(matrix.c);
  const d = Number(matrix.d);
  const e = Number(matrix.e);
  const f = Number(matrix.f);
  if (![a, b, c, d, e, f].every(Number.isFinite)) return null;
  return new DOMMatrix([a, b, c, d, e, f]);
}

function buildSvgAffineGeometryMatrix(
  localX: number,
  localY: number,
  localWidth: number,
  localHeight: number,
  worldBox: { x: number; y: number; width: number; height: number } | null,
  matrix: DOMMatrix | null,
): Record<string, number> | null {
  if (!matrix || !worldBox) return null;
  const bboxWidth = Math.max(0, Number(worldBox.width || 0));
  const bboxHeight = Math.max(0, Number(worldBox.height || 0));
  const sourceWidth = Math.max(0, Number(localWidth || 0));
  const sourceHeight = Math.max(0, Number(localHeight || 0));
  if (bboxWidth <= 0.001 || bboxHeight <= 0.001 || sourceWidth <= 0.001 || sourceHeight <= 0.001) return null;

  const scaleX = sourceWidth / bboxWidth;
  const scaleY = sourceHeight / bboxHeight;
  const tx = Number(localX || 0) - scaleX * Number(worldBox.x || 0);
  const ty = Number(localY || 0) - scaleY * Number(worldBox.y || 0);
  const record = {
    a: round2(Number(matrix.a || 0) * scaleX),
    b: round2(Number(matrix.b || 0) * scaleX),
    c: round2(Number(matrix.c || 0) * scaleY),
    d: round2(Number(matrix.d || 0) * scaleY),
    e: round2(Number(matrix.a || 0) * tx + Number(matrix.c || 0) * ty + Number(matrix.e || 0)),
    f: round2(Number(matrix.b || 0) * tx + Number(matrix.d || 0) * ty + Number(matrix.f || 0)),
  };
  if (
    Math.abs(record.a - 1) <= 0.001
    && Math.abs(record.b) <= 0.001
    && Math.abs(record.c) <= 0.001
    && Math.abs(record.d - 1) <= 0.001
    && Math.abs(record.e) <= 0.001
    && Math.abs(record.f) <= 0.001
  ) {
    return null;
  }
  return record;
}

function svgNodeBoundsToWorld(
  x: number,
  y: number,
  width: number,
  height: number,
  matrix: DOMMatrix | null,
): { x: number; y: number; width: number; height: number } | null {
  const w = Math.max(0, Number(width || 0));
  const h = Math.max(0, Number(height || 0));
  if (w <= 0.001 || h <= 0.001) return null;
  const corners = [
    mapSvgPointThroughMatrix(x, y, matrix),
    mapSvgPointThroughMatrix(x + w, y, matrix),
    mapSvgPointThroughMatrix(x + w, y + h, matrix),
    mapSvgPointThroughMatrix(x, y + h, matrix),
  ];
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  const outW = Math.max(1, maxX - minX);
  const outH = Math.max(1, maxY - minY);
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(outW) || !Number.isFinite(outH)) {
    return null;
  }
  return {
    x: round2(minX),
    y: round2(minY),
    width: round2(outW),
    height: round2(outH),
  };
}

function svgNodeBoundsToOrientedWorld(
  x: number,
  y: number,
  width: number,
  height: number,
  matrix: DOMMatrix | null,
): { x: number; y: number; width: number; height: number; rotation: number } | null {
  const w = Math.max(0, Number(width || 0));
  const h = Math.max(0, Number(height || 0));
  if (w <= 0.001 || h <= 0.001) return null;
  const p0 = mapSvgPointThroughMatrix(x, y, matrix);
  const p1 = mapSvgPointThroughMatrix(x + w, y, matrix);
  const p3 = mapSvgPointThroughMatrix(x, y + h, matrix);
  const axisX = { x: p1.x - p0.x, y: p1.y - p0.y };
  const axisY = { x: p3.x - p0.x, y: p3.y - p0.y };
  const widthWorld = Math.hypot(axisX.x, axisX.y);
  const heightWorld = Math.hypot(axisY.x, axisY.y);
  if (!Number.isFinite(widthWorld) || !Number.isFinite(heightWorld) || widthWorld <= 0.001 || heightWorld <= 0.001) {
    return null;
  }
  const dot = Math.abs((axisX.x * axisY.x + axisX.y * axisY.y) / (widthWorld * heightWorld));
  if (dot > 0.02) return null;
  return {
    x: round2(p0.x),
    y: round2(p0.y),
    width: round2(widthWorld),
    height: round2(heightWorld),
    rotation: round2(normalizeSvgDegrees((Math.atan2(axisX.y, axisX.x) * 180) / Math.PI)),
  };
}

function parseSvgPaintReference(raw: string): string | null {
  const match = String(raw || "").match(/url\(\s*['"]?(?:[^)"']*#)?([^)"']+)['"]?\s*\)/i);
  return match?.[1]?.trim() || null;
}

function readSvgElementHref(element: Element): string {
  return String(
    element.getAttribute("href")
    || element.getAttributeNS("http://www.w3.org/1999/xlink", "href")
    || "",
  ).trim();
}

function resolveSvgReferencedElement(element: Element, rawHref: string): SVGElement | null {
  const href = String(rawHref || "").trim();
  if (!href) return null;
  const refId = href.startsWith("#") ? href.slice(1) : parseSvgPaintReference(href) || href;
  if (!refId) return null;
  const svgElement = element as SVGElement;
  const rootSvg = (svgElement.ownerSVGElement || element.closest("svg")) as SVGSVGElement | null;
  if (rootSvg) {
    const local = Array.from(rootSvg.querySelectorAll("[id]"))
      .find((candidate) => String((candidate as Element).id || "").trim() === refId);
    if (local instanceof SVGElement) return local;
  }
  const ownerDocument = element.ownerDocument;
  if (!ownerDocument || typeof ownerDocument.getElementById !== "function") return null;
  const found = ownerDocument.getElementById(refId);
  return found instanceof SVGElement ? found : null;
}

function readSvgFilterLength(rawValue: unknown, fallback = 0, allowNegative = true): number {
  const fromLength = parseSvgLengthToPx(rawValue);
  const value = Number.isFinite(fromLength) ? Number(fromLength) : parseCssFloat(rawValue, fallback);
  if (!allowNegative) return Math.max(0, round2(value));
  return round2(value);
}

function resolveSvgEffectColor(rawColor: unknown, rawOpacity: unknown, fallback = "#000000"): string {
  const normalizedColor = normalizeSvgPaint(rawColor) || fallback;
  const opacity = clampRange(parseCssFloat(rawOpacity, 1), 0, 1, 1);
  return applySvgOpacityToSolidColor(normalizedColor, opacity)
    || applySvgOpacityToSolidColor(String(fallback || "#000000"), opacity)
    || String(fallback || "#000000");
}

function splitSvgFilterFunctions(rawFilter: string): Array<{ name: string; args: string }> {
  const source = String(rawFilter || "").trim();
  if (!source) return [];
  const out: Array<{ name: string; args: string }> = [];
  let cursor = 0;
  while (cursor < source.length) {
    while (cursor < source.length && /\s/.test(source[cursor])) cursor += 1;
    if (cursor >= source.length) break;
    const openIndex = source.indexOf("(", cursor);
    if (openIndex < 0) break;
    const name = source.slice(cursor, openIndex).trim().toLowerCase();
    if (!name) break;
    let depth = 1;
    let endIndex = openIndex + 1;
    while (endIndex < source.length && depth > 0) {
      const char = source[endIndex];
      if (char === "(") depth += 1;
      if (char === ")") depth -= 1;
      endIndex += 1;
    }
    if (depth !== 0) break;
    out.push({
      name,
      args: source.slice(openIndex + 1, endIndex - 1).trim(),
    });
    cursor = endIndex;
  }
  return out;
}

function parseSvgCssDropShadowEffect(args: string, effectIndex: number): PinselaLayerEffect | null {
  const trimmed = String(args || "").trim();
  if (!trimmed) return null;
  const colorMatch = trimmed.match(/(rgba?\([^)]*\)|hsla?\([^)]*\)|#[0-9a-f]{3,8}|[a-z]+)\s*$/i);
  const color = colorMatch ? resolveSvgEffectColor(colorMatch[1], 1, "#000000") : "#000000";
  const lengthSource = colorMatch ? trimmed.slice(0, colorMatch.index).trim() : trimmed;
  const parts = lengthSource.split(/[\s,]+/).filter(Boolean);
  if (parts.length < 2) return null;
  const offsetX = readSvgFilterLength(parts[0], 0, true);
  const offsetY = readSvgFilterLength(parts[1], 0, true);
  const blur = parts.length >= 3 ? readSvgFilterLength(parts[2], 0, false) : 0;
  return {
    id: `svg_fx_drop_shadow_${effectIndex}`,
    type: "drop_shadow",
    x: round2(offsetX),
    y: round2(offsetY),
    blur: round2(blur),
    spread: 0,
    opacity: 100,
    color,
  };
}

function parseSvgCssFilterEffects(rawFilter: string): PinselaLayerEffect[] | null {
  const functions = splitSvgFilterFunctions(rawFilter);
  if (!functions.length) return [];
  const effects: PinselaLayerEffect[] = [];
  for (let index = 0; index < functions.length; index += 1) {
    const fn = functions[index];
    if (fn.name === "blur") {
      const radius = readSvgFilterLength(fn.args, 0, false);
      if (radius > 0.001) {
        effects.push({
          id: `svg_fx_blur_${index}`,
          type: "layer_blur",
          radius: round2(radius),
          opacity: 100,
        });
      }
      continue;
    }
    if (fn.name === "drop-shadow") {
      const effect = parseSvgCssDropShadowEffect(fn.args, index);
      if (!effect) return null;
      effects.push(effect);
      continue;
    }
    return null;
  }
  return effects;
}

function parseSvgFilterPrimitiveChildren(filterElement: SVGElement): SVGElement[] {
  return Array.from(filterElement.children).filter((child) => {
    const tag = String(child.tagName || "").toLowerCase();
    return tag !== "title" && tag !== "desc";
  }) as SVGElement[];
}

function resolveSvgSimpleFilterEffects(element: SVGElement): PinselaLayerEffect[] | null {
  if (typeof window === "undefined" || typeof window.getComputedStyle !== "function") return [];
  const computed = window.getComputedStyle(element);
  const rawFilter = String(element.getAttribute("filter") || readSvgComputedProperty(computed, "filter") || "").trim();
  if (!rawFilter || rawFilter.toLowerCase() === "none") return [];
  if (!rawFilter.toLowerCase().startsWith("url(")) {
    return parseSvgCssFilterEffects(rawFilter);
  }

  const filterElement = resolveSvgReferencedElement(element, rawFilter);
  if (!filterElement || String(filterElement.tagName || "").toLowerCase() !== "filter") return null;
  const primitives = parseSvgFilterPrimitiveChildren(filterElement);
  if (!primitives.length) return [];

  if (primitives.every((primitive) => String(primitive.tagName || "").toLowerCase() === "fedropshadow")) {
    return primitives.map((primitive, index) => ({
      id: `svg_fx_drop_shadow_${index}`,
      type: "drop_shadow",
      x: round2(readSvgFilterLength(primitive.getAttribute("dx"), 0, true)),
      y: round2(readSvgFilterLength(primitive.getAttribute("dy"), 0, true)),
      blur: round2(readSvgFilterLength(primitive.getAttribute("stdDeviation"), 0, false) * 2),
      spread: 0,
      opacity: 100,
      color: resolveSvgEffectColor(
        primitive.getAttribute("flood-color") || "#000000",
        primitive.getAttribute("flood-opacity") || 1,
        "#000000",
      ),
    }));
  }

  if (primitives.length === 1 && String(primitives[0].tagName || "").toLowerCase() === "fegaussianblur") {
    const radius = round2(readSvgFilterLength(primitives[0].getAttribute("stdDeviation"), 0, false) * 2);
    return radius > 0.001
      ? [{
          id: "svg_fx_blur_0",
          type: "layer_blur",
          radius,
          opacity: 100,
        }]
      : [];
  }

  const supportedShadowPipeline = new Set(["feoffset", "fegaussianblur", "feflood", "fecomposite", "femerge", "femergenode"]);
  if (!primitives.every((primitive) => supportedShadowPipeline.has(String(primitive.tagName || "").toLowerCase()))) {
    return null;
  }

  let offsetX = 0;
  let offsetY = 0;
  let blur = 0;
  let color = "#000000";
  let sawRenderableShadow = false;
  for (const primitive of primitives) {
    const tag = String(primitive.tagName || "").toLowerCase();
    if (tag === "feoffset") {
      offsetX = round2(readSvgFilterLength(primitive.getAttribute("dx"), 0, true));
      offsetY = round2(readSvgFilterLength(primitive.getAttribute("dy"), 0, true));
      sawRenderableShadow = true;
      continue;
    }
    if (tag === "fegaussianblur") {
      blur = round2(readSvgFilterLength(primitive.getAttribute("stdDeviation"), 0, false) * 2);
      sawRenderableShadow = true;
      continue;
    }
    if (tag === "feflood") {
      color = resolveSvgEffectColor(
        primitive.getAttribute("flood-color") || "#000000",
        primitive.getAttribute("flood-opacity") || 1,
        "#000000",
      );
      sawRenderableShadow = true;
    }
  }
  if (!sawRenderableShadow) return null;
  return [{
    id: "svg_fx_drop_shadow_0",
    type: "drop_shadow",
    x: offsetX,
    y: offsetY,
    blur,
    spread: 0,
    opacity: 100,
    color,
  }];
}

function expandSvgUseElements(svg: SVGSVGElement): void {
  const namespace = svg.namespaceURI || "http://www.w3.org/2000/svg";
  for (let pass = 0; pass < 32; pass += 1) {
    const use = svg.querySelector("use");
    if (!use) break;

    const target = resolveSvgReferencedElement(use, readSvgElementHref(use));
    if (!target || target === use) {
      use.remove();
      continue;
    }

    const wrapper = document.createElementNS(namespace, "g");
    const x = parseSvgLengthToPx(use.getAttribute("x")) ?? 0;
    const y = parseSvgLengthToPx(use.getAttribute("y")) ?? 0;
    const transformParts = [];
    if (Math.abs(x) > 0.0001 || Math.abs(y) > 0.0001) transformParts.push(`translate(${x} ${y})`);
    const rawTransform = String(use.getAttribute("transform") || "").trim();
    if (rawTransform) transformParts.push(rawTransform);
    if (transformParts.length) wrapper.setAttribute("transform", transformParts.join(" "));

    for (const attr of Array.from(use.attributes)) {
      const name = String(attr.name || "").toLowerCase();
      if (name === "href" || name === "xlink:href" || name === "x" || name === "y" || name === "width" || name === "height" || name === "transform") continue;
      wrapper.setAttribute(attr.name, attr.value);
    }

    if (String(target.tagName || "").toLowerCase() === "symbol") {
      for (const child of Array.from(target.children)) {
        wrapper.appendChild(child.cloneNode(true));
      }
    } else {
      wrapper.appendChild(target.cloneNode(true));
    }
    use.replaceWith(wrapper);
  }
}

function collectSvgGradientChain(
  gradient: SVGGradientElement | null,
  seen = new Set<string>(),
): SVGGradientElement[] {
  if (!gradient) return [];
  const chain: SVGGradientElement[] = [];
  const id = String(gradient.id || "");
  if (id) {
    if (seen.has(id)) return chain;
    seen.add(id);
  }
  const inherited = resolveSvgReferencedElement(gradient, readSvgElementHref(gradient));
  const inheritedTag = String(inherited?.tagName || "").toLowerCase();
  if (inheritedTag === "lineargradient" || inheritedTag === "radialgradient") {
    chain.push(...collectSvgGradientChain(inherited as SVGGradientElement, seen));
  }
  chain.push(gradient);
  return chain;
}

function readSvgGradientAttribute(chain: SVGGradientElement[], name: string): string {
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const raw = String(chain[index].getAttribute(name) || "").trim();
    if (raw) return raw;
  }
  return "";
}

function collectSvgGradientStops(chain: SVGGradientElement[]): SVGStopElement[] {
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const stops = Array.from(chain[index].children).filter((child) => String(child.tagName || "").toLowerCase() === "stop") as SVGStopElement[];
    if (stops.length) return stops;
  }
  return [];
}

function resolveSvgGradientTransform(chain: SVGGradientElement[]): DOMMatrix | null {
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const consolidated = (chain[index] as any).gradientTransform?.baseVal?.consolidate?.();
    const matrix = svgMatrixFromUnknown(consolidated?.matrix || consolidated);
    if (matrix) return matrix;
  }
  return null;
}

function parseSvgGradientCoord(raw: string, fallback: number): number {
  const value = String(raw || "").trim();
  if (!value) return fallback;
  if (value.endsWith("%")) {
    const parsed = Number.parseFloat(value.slice(0, -1));
    return Number.isFinite(parsed) ? parsed / 100 : fallback;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeSvgGradientStops(stops: Array<{ offset: number; color: string }>): Array<{ offset: number; color: string }> {
  const normalized = stops
    .map((stop) => ({
      offset: clampRange(Number(stop.offset), 0, 1, 0),
      color: String(stop.color || "").trim(),
    }))
    .filter((stop) => stop.color);
  if (normalized.length >= 2) return normalized.sort((a, b) => a.offset - b.offset);
  if (normalized.length === 1) {
    return [
      normalized[0],
      { offset: normalized[0].offset >= 0.5 ? 0 : 1, color: normalized[0].color },
    ].sort((a, b) => a.offset - b.offset);
  }
  return [];
}

function resolveSvgGradientPaint(element: SVGElement, rawPaint: string): unknown | null {
  const gradient = resolveSvgReferencedElement(element, rawPaint);
  const tag = String(gradient?.tagName || "").toLowerCase();
  if (tag !== "lineargradient" && tag !== "radialgradient") return null;

  const chain = collectSvgGradientChain(gradient as SVGGradientElement);
  const stopElements = collectSvgGradientStops(chain);
  const stops = normalizeSvgGradientStops(stopElements.map((stop) => {
    const computed = window.getComputedStyle(stop);
    const stopColor = normalizeSvgPaint(computed.stopColor || stop.getAttribute("stop-color") || computed.color || "#000000") || "#000000";
    const stopOpacity = clampRange(
      parseCssFloat((computed as any).stopOpacity ?? stop.getAttribute("stop-opacity"), 1),
      0,
      1,
      1,
    );
    return {
      offset: String(stop.getAttribute("offset") || "").trim().endsWith("%")
        ? parseCssFloat(stop.getAttribute("offset"), 0) / 100
        : parseCssFloat(stop.getAttribute("offset"), 0),
      color: applySvgOpacityToSolidColor(stopColor, stopOpacity) || stopColor,
    };
  }));
  if (!stops.length) return null;

  if (tag === "radialgradient") {
    return {
      type: "gradient",
      gradient_type: "radial",
      angle: 0,
      stops,
    };
  }

  const x1 = parseSvgGradientCoord(readSvgGradientAttribute(chain, "x1"), 0);
  const y1 = parseSvgGradientCoord(readSvgGradientAttribute(chain, "y1"), 0);
  const x2 = parseSvgGradientCoord(readSvgGradientAttribute(chain, "x2"), 1);
  const y2 = parseSvgGradientCoord(readSvgGradientAttribute(chain, "y2"), 0);
  const gradientTransform = resolveSvgGradientTransform(chain);
  const p1 = mapSvgPointThroughMatrix(x1, y1, gradientTransform);
  const p2 = mapSvgPointThroughMatrix(x2, y2, gradientTransform);
  const angle = normalizeSvgDegrees((Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180) / Math.PI);

  return {
    type: "gradient",
    gradient_type: "linear",
    angle: round2(angle),
    stops,
  };
}

function resolveSvgPaintValue(element: SVGElement, rawPaint: unknown, paintOpacity: number): unknown | null {
  const normalized = normalizeSvgPaint(rawPaint);
  if (!normalized) return null;
  if (String(normalized).toLowerCase().startsWith("url(")) {
    const gradient = resolveSvgGradientPaint(element, normalized);
    if (!gradient || !isGradientColorLike(gradient)) return null;
    return {
      ...gradient,
      stops: gradient.stops.map((stop) => ({
        ...stop,
        color: applySvgOpacityToSolidColor(String(stop.color || "#000000"), paintOpacity) || String(stop.color || "#000000"),
      })),
    };
  }
  return applySvgOpacityToSolidColor(normalized, paintOpacity) || normalized;
}

function svgPaintNeedsRasterFallback(element: SVGElement, rawPaint: unknown): boolean {
  const normalized = normalizeSvgPaint(rawPaint);
  if (!normalized || !String(normalized).toLowerCase().startsWith("url(")) return false;
  return !resolveSvgGradientPaint(element, normalized);
}

function readSvgComputedProperty(computed: CSSStyleDeclaration, propertyName: string): string {
  return String(computed.getPropertyValue(propertyName) || (computed as any)[propertyName] || "").trim();
}

function readSvgRectGeometry(element: Element): { x: number; y: number; width: number; height: number; cornerRadius: number } | null {
  if (String(element.tagName || "").toLowerCase() !== "rect") return null;
  const x = Number((element as any).x?.baseVal?.value ?? parseSvgLengthToPx(element.getAttribute("x")) ?? 0);
  const y = Number((element as any).y?.baseVal?.value ?? parseSvgLengthToPx(element.getAttribute("y")) ?? 0);
  const width = Number((element as any).width?.baseVal?.value ?? parseSvgLengthToPx(element.getAttribute("width")) ?? 0);
  const height = Number((element as any).height?.baseVal?.value ?? parseSvgLengthToPx(element.getAttribute("height")) ?? 0);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0.001 || height <= 0.001) return null;
  let rx = Number((element as any).rx?.baseVal?.value ?? parseSvgLengthToPx(element.getAttribute("rx")) ?? 0);
  let ry = Number((element as any).ry?.baseVal?.value ?? parseSvgLengthToPx(element.getAttribute("ry")) ?? 0);
  if (rx > 0 && ry <= 0) ry = rx;
  if (ry > 0 && rx <= 0) rx = ry;
  rx = clampRange(Math.max(0, rx), 0, width / 2, 0);
  ry = clampRange(Math.max(0, ry), 0, height / 2, 0);
  return {
    x,
    y,
    width,
    height,
    cornerRadius: round2(Math.max(rx, ry)),
  };
}

function resolveSimpleSvgFrameRectFromContainer(container: SVGElement | null): { x: number; y: number; width: number; height: number; cornerRadius: number } | null {
  if (!container) return null;
  const tag = String(container.tagName || "").toLowerCase();
  if (tag !== "clippath" && tag !== "mask") return null;
  if (container.hasAttribute("transform")) return null;
  if (tag === "clippath" && String(container.getAttribute("clipPathUnits") || "").trim().toLowerCase() === "objectboundingbox") {
    return null;
  }
  const children = Array.from(container.children).filter((child) => {
    const childTag = String(child.tagName || "").toLowerCase();
    return childTag !== "desc" && childTag !== "title";
  });
  if (children.length !== 1) return null;
  const child = children[0];
  if (child.hasAttribute("transform")) return null;
  return readSvgRectGeometry(child);
}

function resolveSvgClipFillRule(...targets: Array<Element | null | undefined>): PinselaPathFillRule {
  for (const target of targets) {
    if (!target) continue;
    const raw = String(target.getAttribute("clip-rule") || target.getAttribute("fill-rule") || "").trim().toLowerCase();
    if (raw === "evenodd") return "evenodd";
  }
  return "nonzero";
}

function resolveSvgGroupClipPath(element: SVGElement): ImportedVectorPathElement | null {
  if (typeof window === "undefined" || typeof window.getComputedStyle !== "function") return null;
  const computed = window.getComputedStyle(element);
  const rawClipPath = String(element.getAttribute("clip-path") || readSvgComputedProperty(computed, "clip-path") || "").trim();
  if (!rawClipPath || rawClipPath.toLowerCase() === "none") return null;
  const container = resolveSvgReferencedElement(element, rawClipPath);
  if (!container) return null;
  const tag = String(container.tagName || "").toLowerCase();
  if (tag !== "clippath") return null;
  if (container.hasAttribute("transform")) return null;
  if (String(container.getAttribute("clipPathUnits") || "").trim().toLowerCase() === "objectboundingbox") {
    return null;
  }
  const children = Array.from(container.children).filter((child) => {
    const childTag = String(child.tagName || "").toLowerCase();
    return childTag !== "desc" && childTag !== "title";
  });
  if (children.length !== 1) return null;
  const child = children[0] as SVGElement;
  if (child.hasAttribute("transform")) return null;
  const childTag = String(child.tagName || "").toLowerCase();
  if (!["path", "rect", "circle", "ellipse", "line", "polyline", "polygon"].includes(childTag)) {
    return null;
  }
  const baseSubpaths = extractSvgTextPathSubpaths(child);
  if (!baseSubpaths.length) return null;
  const matrix = svgMatrixFromUnknown((element as SVGGraphicsElement).getCTM ? (element as SVGGraphicsElement).getCTM() : null);
  const transformedSubpaths = baseSubpaths
    .map((subpath) => ({
      closed: subpath.closed,
      anchors: mapSvgAnchorsThroughMatrix(subpath.anchors, matrix),
    }))
    .filter((subpath) => subpath.anchors.length >= 2);
  if (!transformedSubpaths.length) return null;
  return {
    kind: "path",
    name: String(child.getAttribute("id") || container.getAttribute("id") || "SVG_CLIP_PATH"),
    closed: transformedSubpaths[0]?.closed !== false,
    anchors: transformedSubpaths[0]?.anchors || [],
    subpaths: transformedSubpaths,
    fillRule: resolveSvgClipFillRule(child, container),
    fill: "#ffffff",
    forceTransparentFill: false,
    opacity: 1,
  };
}

function resolveSimpleSvgImageFrame(element: SVGImageElement): { cornerRadius: number } | null {
  if (typeof window === "undefined" || typeof window.getComputedStyle !== "function") return null;
  const computed = window.getComputedStyle(element);
  const x = Number((element as any).x?.baseVal?.value ?? parseSvgLengthToPx(element.getAttribute("x")) ?? 0);
  const y = Number((element as any).y?.baseVal?.value ?? parseSvgLengthToPx(element.getAttribute("y")) ?? 0);
  const width = Number((element as any).width?.baseVal?.value ?? parseSvgLengthToPx(element.getAttribute("width")) ?? 0);
  const height = Number((element as any).height?.baseVal?.value ?? parseSvgLengthToPx(element.getAttribute("height")) ?? 0);
  if (width <= 0.001 || height <= 0.001) return null;

  const rawClipPath = String(element.getAttribute("clip-path") || readSvgComputedProperty(computed, "clip-path") || "").trim();
  const rawMask = String(element.getAttribute("mask") || readSvgComputedProperty(computed, "mask") || "").trim();
  const clipShape = resolveSimpleSvgFrameRectFromContainer(resolveSvgReferencedElement(element, rawClipPath));
  const maskShape = resolveSimpleSvgFrameRectFromContainer(resolveSvgReferencedElement(element, rawMask));
  const shape = clipShape || maskShape;
  if (!shape) return null;

  const tolerance = Math.max(0.75, Math.min(4, Math.max(width, height) * 0.01));
  if (
    Math.abs(shape.x - x) > tolerance
    || Math.abs(shape.y - y) > tolerance
    || Math.abs(shape.width - width) > tolerance
    || Math.abs(shape.height - height) > tolerance
  ) {
    return null;
  }
  return { cornerRadius: shape.cornerRadius };
}

function resolveSvgGroupLabel(group: Element): string {
  const siblingIndex = group.parentElement
    ? Array.from(group.parentElement.children)
        .filter((child) => String(child.tagName || "").toLowerCase() === "g")
        .indexOf(group)
    : 0;
  return String(
    group.getAttribute("id")
    || group.getAttribute("data-name")
    || group.getAttribute("inkscape:label")
    || `GROUP_${Math.max(1, siblingIndex + 1)}`,
  ).trim() || `GROUP_${Math.max(1, siblingIndex + 1)}`;
}

function resolveSimpleSvgGroupClipGeometry(element: SVGElement): ImportedSvgGroupClipGeometry | null {
  if (typeof window === "undefined" || typeof window.getComputedStyle !== "function") return null;
  const computed = window.getComputedStyle(element);
  const rawClipPath = String(element.getAttribute("clip-path") || readSvgComputedProperty(computed, "clip-path") || "").trim();
  const rawMask = String(element.getAttribute("mask") || readSvgComputedProperty(computed, "mask") || "").trim();
  const shape = resolveSimpleSvgFrameRectFromContainer(resolveSvgReferencedElement(element, rawClipPath))
    || resolveSimpleSvgFrameRectFromContainer(resolveSvgReferencedElement(element, rawMask));
  if (!shape) return null;
  const matrix = (element as SVGGraphicsElement).getCTM ? (element as SVGGraphicsElement).getCTM() : null;
  const worldBox = svgNodeBoundsToWorld(shape.x, shape.y, shape.width, shape.height, matrix);
  if (!worldBox) return null;
  const orientedBox = svgNodeBoundsToOrientedWorld(shape.x, shape.y, shape.width, shape.height, matrix);
  const transformMatrix = !orientedBox
    ? buildSvgAffineGeometryMatrix(shape.x, shape.y, shape.width, shape.height, worldBox, matrix)
    : null;
  return {
    x: round2(orientedBox?.x ?? worldBox.x),
    y: round2(orientedBox?.y ?? worldBox.y),
    width: round2(orientedBox?.width ?? worldBox.width),
    height: round2(orientedBox?.height ?? worldBox.height),
    rotation: round2(orientedBox?.rotation ?? 0),
    cornerRadius: round2(Math.max(0, Number(shape.cornerRadius || 0))),
    transformMatrix,
  };
}

function collectSvgGroupContexts(element: SVGElement): ImportedSvgGroupContext[] {
  if (typeof window === "undefined" || typeof window.getComputedStyle !== "function") return [];
  const contexts: ImportedSvgGroupContext[] = [];
  let current = element.parentElement;
  while (current) {
    const tag = String(current.tagName || "").toLowerCase();
    if (tag === "g") {
      const group = current as unknown as SVGElement;
      const computed = window.getComputedStyle(current);
      const opacity = clampRange(parseCssFloat(computed.opacity, 1), 0, 1, 1);
      contexts.unshift({
        label: resolveSvgGroupLabel(group),
        opacity: opacity < 0.999 ? round2(opacity) : undefined,
        clipGeometry: resolveSimpleSvgGroupClipGeometry(group),
        clipPath: resolveSvgGroupClipPath(group),
      });
    }
    current = current.parentElement;
  }
  return contexts;
}

function hasRenderableSvgDescendants(element: SVGElement): boolean {
  return Boolean(element.querySelector("path,rect,circle,ellipse,line,polyline,polygon,text,image,foreignObject,g"));
}

function svgElementNeedsRasterFallback(element: SVGElement): boolean {
  if (typeof window === "undefined" || typeof window.getComputedStyle !== "function") return false;
  const tag = String(element.tagName || "").toLowerCase();
  if (tag === "foreignobject") return true;
  const computed = window.getComputedStyle(element);
  const opacity = clampRange(parseCssFloat(computed.opacity, 1), 0, 1, 1);
  const filter = String(element.getAttribute("filter") || readSvgComputedProperty(computed, "filter") || "").trim().toLowerCase();
  const clipPath = String(element.getAttribute("clip-path") || readSvgComputedProperty(computed, "clip-path") || "").trim().toLowerCase();
  const mask = String(element.getAttribute("mask") || readSvgComputedProperty(computed, "mask") || "").trim().toLowerCase();
  const mixBlendMode = String(readSvgComputedProperty(computed, "mix-blend-mode") || "").trim().toLowerCase();

  if (filter && filter !== "none") {
    if (tag === "g") return true;
    const effects = resolveSvgSimpleFilterEffects(element);
    if (effects == null) return true;
  }
  if (mask && mask !== "none" && tag !== "image" && tag !== "g") return true;
  if (mixBlendMode && mixBlendMode !== "normal") return true;
  if (svgPaintNeedsRasterFallback(element, computed.fill) || svgPaintNeedsRasterFallback(element, computed.stroke)) {
    return true;
  }
  if (tag === "g") {
    if ((clipPath && clipPath !== "none") || (mask && mask !== "none")) {
      return !resolveSimpleSvgGroupClipGeometry(element) && !resolveSvgGroupClipPath(element);
    }
    return false;
  }
  if (tag === "text" && element.querySelector("textPath")) {
    return !resolveSvgTextPathGeometry(element as SVGTextContentElement);
  }
  if (tag === "image") {
    if ((mask && mask !== "none") || (clipPath && clipPath !== "none")) {
      return !resolveSimpleSvgImageFrame(element as SVGImageElement);
    }
    return false;
  }
  if (tag !== "g" && clipPath && clipPath !== "none") return true;
  return false;
}

function svgNodeUserBounds(
  element: SVGGraphicsElement,
  rootSvg: SVGSVGElement,
): { x: number; y: number; width: number; height: number } | null {
  if (typeof DOMPoint === "undefined") return null;
  const rect = element.getBoundingClientRect?.();
  const screenMatrix = rootSvg.getScreenCTM?.();
  if (rect && screenMatrix) {
    let inverse: DOMMatrix | null = null;
    try {
      inverse = svgMatrixFromUnknown(screenMatrix)?.inverse() || null;
    } catch {
      inverse = null;
    }
    if (inverse) {
      const corners = [
        new DOMPoint(rect.left, rect.top).matrixTransform(inverse),
        new DOMPoint(rect.right, rect.top).matrixTransform(inverse),
        new DOMPoint(rect.right, rect.bottom).matrixTransform(inverse),
        new DOMPoint(rect.left, rect.bottom).matrixTransform(inverse),
      ];
      const xs = corners.map((point) => point.x);
      const ys = corners.map((point) => point.y);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      const maxX = Math.max(...xs);
      const maxY = Math.max(...ys);
      const widthOut = Math.max(1, maxX - minX);
      const heightOut = Math.max(1, maxY - minY);
      if ([minX, minY, widthOut, heightOut].every(Number.isFinite)) {
        return {
          x: round2(minX),
          y: round2(minY),
          width: round2(widthOut),
          height: round2(heightOut),
        };
      }
    }
  }

  const bbox = (() => {
    try {
      return element.getBBox();
    } catch {
      return null;
    }
  })();
  const matrix = element.getCTM ? element.getCTM() : null;
  return bbox
    ? svgNodeBoundsToWorld(Number(bbox.x || 0), Number(bbox.y || 0), Number(bbox.width || 0), Number(bbox.height || 0), matrix)
    : null;
}

function buildSvgSubtreeDataUrl(
  mountedSvg: SVGSVGElement,
  target: SVGElement,
  bounds: { x: number; y: number; width: number; height: number },
): string | null {
  if (typeof XMLSerializer === "undefined") return null;
  const marker = `svg-fallback-${uid("target")}`;
  target.setAttribute("data-pinsela-svg-fallback", marker);
  try {
    const cloneRoot = mountedSvg.cloneNode(true) as SVGSVGElement;
    const targetClone = cloneRoot.querySelector(`[data-pinsela-svg-fallback="${marker}"]`) as SVGElement | null;
    if (!targetClone) return null;
    targetClone.removeAttribute("data-pinsela-svg-fallback");
    const chain = new Set<Element>();
    let current: Element | null = targetClone;
    while (current) {
      chain.add(current);
      if (current === cloneRoot) break;
      current = current.parentElement;
    }
    const pruneTree = (parent: Element): void => {
      if (parent === targetClone) return;
      Array.from(parent.children).forEach((child) => {
        const tag = String(child.tagName || "").toLowerCase();
        const keepAuxiliary = tag === "defs"
          || tag === "style"
          || tag === "metadata"
          || tag === "clippath"
          || tag === "mask"
          || tag === "filter"
          || tag === "lineargradient"
          || tag === "radialgradient"
          || tag === "pattern"
          || tag === "marker"
          || tag === "symbol";
        if (keepAuxiliary) return;
        if (!chain.has(child)) {
          child.remove();
          return;
        }
        pruneTree(child);
      });
    };
    pruneTree(cloneRoot);
    const width = round2(Math.max(1, Number(bounds.width || 0)));
    const height = round2(Math.max(1, Number(bounds.height || 0)));
    cloneRoot.setAttribute("width", String(width));
    cloneRoot.setAttribute("height", String(height));
    cloneRoot.setAttribute("viewBox", `${round2(bounds.x)} ${round2(bounds.y)} ${width} ${height}`);
    const serialized = new XMLSerializer().serializeToString(cloneRoot);
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`;
  } finally {
    target.removeAttribute("data-pinsela-svg-fallback");
  }
}

function buildSvgRasterFallbackElement(
  mountedSvg: SVGSVGElement,
  target: SVGElement,
): ImportedVectorImageElement | null {
  if (!(target instanceof SVGGraphicsElement)) return null;
  const bounds = svgNodeUserBounds(target, mountedSvg);
  if (!bounds) return null;
  const src = buildSvgSubtreeDataUrl(mountedSvg, target, bounds);
  if (!src) return null;
  const tag = String(target.tagName || "svg").toUpperCase();
  return {
    kind: "image",
    name: String(target.getAttribute("id") || `SVG_${tag}_FALLBACK`),
    groupPath: collectSvgGroupPath(target),
    groupContexts: collectSvgGroupContexts(target),
    src,
    x: round2(bounds.x),
    y: round2(bounds.y),
    width: round2(bounds.width),
    height: round2(bounds.height),
    opacity: 1,
    rotation: 0,
    fit: "fill",
  };
}

function svgElementShouldBeSkipped(element: SVGElement): boolean {
  const blockedAncestors = new Set([
    "defs",
    "clippath",
    "mask",
    "marker",
    "pattern",
    "symbol",
    "lineargradient",
    "radialgradient",
  ]);
  let parent = element.parentElement;
  while (parent) {
    const tag = String(parent.tagName || "").toLowerCase();
    if (blockedAncestors.has(tag)) return true;
    parent = parent.parentElement;
  }

  if (typeof window !== "undefined" && typeof window.getComputedStyle === "function") {
    const computed = window.getComputedStyle(element);
    if (String(computed.display || "").toLowerCase() === "none") return true;
    if (String(computed.visibility || "").toLowerCase() === "hidden") return true;
    const opacity = clampRange(parseCssFloat(computed.opacity, 1), 0, 1, 1);
    if (opacity <= 0.001) return true;
  }
  return false;
}

function isSvgGeometryElement(element: SVGElement): element is SVGGeometryElement {
  return typeof (element as SVGGeometryElement).getTotalLength === "function"
    && typeof (element as SVGGeometryElement).getPointAtLength === "function";
}

function svgGeometryLikelyClosed(
  element: SVGGeometryElement,
  sampledPoints: Array<{ x: number; y: number }>,
): boolean {
  const tag = String(element.tagName || "").toLowerCase();
  if (tag === "line" || tag === "polyline") return false;
  if (tag === "rect" || tag === "circle" || tag === "ellipse" || tag === "polygon") return true;
  if (tag === "path") {
    const d = String(element.getAttribute("d") || "");
    if (/[zZ]/.test(d)) return true;
  }
  if (sampledPoints.length >= 3) {
    return distance2(sampledPoints[0], sampledPoints[sampledPoints.length - 1]) <= 1.25;
  }
  return false;
}

function sampleSvgGeometryAnchors(
  element: SVGGeometryElement,
  matrix: DOMMatrix | null,
): { anchors: PathAnchorSpec[]; closed: boolean } | null {
  let length = 0;
  try {
    length = Number(element.getTotalLength());
  } catch {
    length = 0;
  }
  if (!Number.isFinite(length) || length <= 0.0001) return null;

  const tag = String(element.tagName || "").toLowerCase();
  let sampleCount = 0;
  if (tag === "line") {
    sampleCount = 1;
  } else if (tag === "polyline" || tag === "polygon") {
    sampleCount = Math.max(2, Math.min(720, Math.round(length / 10)));
  } else {
    sampleCount = Math.max(6, Math.min(960, Math.round(length / 14)));
    if (tag === "rect" || tag === "circle" || tag === "ellipse") {
      sampleCount = Math.max(sampleCount, 20);
    }
  }

  const sampled: Array<{ x: number; y: number }> = [];
  for (let index = 0; index <= sampleCount; index += 1) {
    const progress = sampleCount <= 0 ? 0 : index / sampleCount;
    const at = length * progress;
    let point: { x: number; y: number } | null = null;
    try {
      const raw = element.getPointAtLength(at);
      point = mapSvgPointThroughMatrix(Number(raw.x || 0), Number(raw.y || 0), matrix);
    } catch {
      point = null;
    }
    if (!point) continue;
    const previous = sampled[sampled.length - 1];
    if (!previous || distance2(previous, point) > 0.3) sampled.push(point);
  }

  if (sampled.length < 2) return null;
  const closed = svgGeometryLikelyClosed(element, sampled);
  if (closed && sampled.length >= 3 && distance2(sampled[0], sampled[sampled.length - 1]) <= 1.25) {
    sampled.pop();
  }

  const tolerance = Math.max(0.25, Math.min(2.1, length / 1600));
  const simplified = simplifyPolyline(sampled, tolerance)
    .map((point) => ({ x: round2(point.x), y: round2(point.y) }));
  const cleaned = simplified.length >= 2 ? simplified : sampled;
  if (cleaned.length < 2) return null;

  const anchors = cleaned.map((point) => ({
    x: point.x,
    y: point.y,
    mode: "corner" as const,
  }));
  return {
    anchors,
    closed: closed && anchors.length >= 3,
  };
}

function extractSvgPathStyle(element: SVGElement): {
  sourceStyle: Partial<PinselaNode["style"]>;
  fillPaint: unknown | null;
  strokePaint: unknown | null;
  forceTransparentFill: boolean;
  fillRule: PinselaPathFillRule;
  strokeColor?: unknown;
  strokeWidth?: number;
  effects: PinselaLayerEffect[];
} | null {
  if (typeof window === "undefined" || typeof window.getComputedStyle !== "function") return null;
  const computed = window.getComputedStyle(element);
  const opacity = clampRange(parseCssFloat(computed.opacity, 1), 0, 1, 1);
  if (opacity <= 0.001) return null;
  const effects = resolveSvgSimpleFilterEffects(element);
  if (effects == null) return null;

  const fillPaint = resolveSvgPaintValue(element, computed.fill, clampRange(parseCssFloat((computed as any).fillOpacity, 1), 0, 1, 1));
  const fillOpacity = clampRange(parseCssFloat((computed as any).fillOpacity, 1), 0, 1, 1);
  const strokePaint = resolveSvgPaintValue(element, computed.stroke, clampRange(parseCssFloat((computed as any).strokeOpacity, 1), 0, 1, 1));
  const strokeOpacity = clampRange(parseCssFloat((computed as any).strokeOpacity, 1), 0, 1, 1);
  const strokeWidth = Math.max(0, parseSvgLengthToPx(computed.strokeWidth) ?? parseCssFloat(computed.strokeWidth, 0));
  const hasFill = Boolean(fillPaint && fillOpacity > 0.001);
  const hasStroke = Boolean(strokePaint && strokeOpacity > 0.001 && strokeWidth > 0.001);
  if (!hasFill && !hasStroke) return null;

  const strokeCapRaw = String(computed.strokeLinecap || "").toLowerCase();
  const strokeJoinRaw = String(computed.strokeLinejoin || "").toLowerCase();
  const strokeCap = strokeCapRaw === "butt" || strokeCapRaw === "square" ? strokeCapRaw : "round";
  const strokeJoin = strokeJoinRaw === "bevel" || strokeJoinRaw === "miter" ? strokeJoinRaw : "round";
  const dash = parseSvgDashArray(computed.strokeDasharray);
  const strokeMiterLimit = Math.max(0.2, parseCssFloat(computed.strokeMiterlimit, 4));
  const fillRuleRaw = String(element.getAttribute("fill-rule") || (computed as any).fillRule || "").trim().toLowerCase();
  const fillRule: PinselaPathFillRule = fillRuleRaw === "evenodd" ? "evenodd" : "nonzero";

  const sourceStyle: Partial<PinselaNode["style"]> = {
    opacity,
    fill: hasFill ? fillPaint : "rgba(0,0,0,0)",
    stroke: hasStroke
      ? {
        color: strokePaint!,
        width: round2(strokeWidth),
        dash,
        cap: strokeCap,
        join: strokeJoin,
        miter_limit: round2(strokeMiterLimit),
      }
      : null,
    effects: effects.map((effect) => ({ ...effect })),
    };
  return {
    sourceStyle,
    fillPaint,
    strokePaint,
    forceTransparentFill: !hasFill,
    fillRule,
    strokeColor: hasStroke ? strokePaint! : undefined,
    strokeWidth: hasStroke ? round2(strokeWidth) : undefined,
    effects,
  };
}

function mapSvgAnchorsThroughMatrix(
  anchors: Array<{ x: number; y: number; in?: { x: number; y: number } | null; out?: { x: number; y: number } | null; mode?: "corner" | "smooth" }>,
  matrix: DOMMatrix | null,
): PathAnchorSpec[] {
  return anchors.map((anchor) => ({
    x: round2(mapSvgPointThroughMatrix(anchor.x, anchor.y, matrix).x),
    y: round2(mapSvgPointThroughMatrix(anchor.x, anchor.y, matrix).y),
    in: anchor.in ? mapSvgPointThroughMatrix(anchor.in.x, anchor.in.y, matrix) : anchor.in ?? null,
    out: anchor.out ? mapSvgPointThroughMatrix(anchor.out.x, anchor.out.y, matrix) : anchor.out ?? null,
    mode: anchor.mode === "smooth" ? "smooth" : "corner",
  }));
}

function extractExactSvgPathElements(element: SVGElement): ImportedVectorPathElement[] {
  const style = extractSvgPathStyle(element);
  if (!style) return [];
  const tag = String(element.tagName || "").toLowerCase();
  const matrix = (element as SVGGraphicsElement).getCTM ? (element as SVGGraphicsElement).getCTM() : null;
  let subpaths: Array<{ closed: boolean; anchors: Array<{ x: number; y: number; in?: { x: number; y: number } | null; out?: { x: number; y: number } | null; mode?: "corner" | "smooth" }> }> = [];

  if (tag === "path") {
    subpaths = parseSvgPathDataSubpaths(String(element.getAttribute("d") || ""));
  } else if (tag === "rect") {
    const x = Number((element as any).x?.baseVal?.value ?? parseSvgLengthToPx(element.getAttribute("x")) ?? 0);
    const y = Number((element as any).y?.baseVal?.value ?? parseSvgLengthToPx(element.getAttribute("y")) ?? 0);
    const width = Number((element as any).width?.baseVal?.value ?? parseSvgLengthToPx(element.getAttribute("width")) ?? 0);
    const height = Number((element as any).height?.baseVal?.value ?? parseSvgLengthToPx(element.getAttribute("height")) ?? 0);
    const rx = Number((element as any).rx?.baseVal?.value ?? parseSvgLengthToPx(element.getAttribute("rx")) ?? 0);
    const ry = Number((element as any).ry?.baseVal?.value ?? parseSvgLengthToPx(element.getAttribute("ry")) ?? 0);
    subpaths = buildSvgRectSubpaths(x, y, width, height, rx, ry);
  } else if (tag === "circle") {
    const cx = Number((element as any).cx?.baseVal?.value ?? parseSvgLengthToPx(element.getAttribute("cx")) ?? 0);
    const cy = Number((element as any).cy?.baseVal?.value ?? parseSvgLengthToPx(element.getAttribute("cy")) ?? 0);
    const r = Number((element as any).r?.baseVal?.value ?? parseSvgLengthToPx(element.getAttribute("r")) ?? 0);
    const ellipse = buildSvgEllipseSubpath(cx, cy, r, r);
    subpaths = ellipse ? [ellipse] : [];
  } else if (tag === "ellipse") {
    const cx = Number((element as any).cx?.baseVal?.value ?? parseSvgLengthToPx(element.getAttribute("cx")) ?? 0);
    const cy = Number((element as any).cy?.baseVal?.value ?? parseSvgLengthToPx(element.getAttribute("cy")) ?? 0);
    const rx = Number((element as any).rx?.baseVal?.value ?? parseSvgLengthToPx(element.getAttribute("rx")) ?? 0);
    const ry = Number((element as any).ry?.baseVal?.value ?? parseSvgLengthToPx(element.getAttribute("ry")) ?? 0);
    const ellipse = buildSvgEllipseSubpath(cx, cy, rx, ry);
    subpaths = ellipse ? [ellipse] : [];
  } else if (tag === "line") {
    const x1 = Number((element as any).x1?.baseVal?.value ?? parseSvgLengthToPx(element.getAttribute("x1")) ?? 0);
    const y1 = Number((element as any).y1?.baseVal?.value ?? parseSvgLengthToPx(element.getAttribute("y1")) ?? 0);
    const x2 = Number((element as any).x2?.baseVal?.value ?? parseSvgLengthToPx(element.getAttribute("x2")) ?? 0);
    const y2 = Number((element as any).y2?.baseVal?.value ?? parseSvgLengthToPx(element.getAttribute("y2")) ?? 0);
    const line = buildSvgLineSubpath(x1, y1, x2, y2);
    subpaths = line ? [line] : [];
  } else if (tag === "polyline" || tag === "polygon") {
    const poly = buildSvgPolylineSubpath(parseSvgPoints(String(element.getAttribute("points") || "")), tag === "polygon");
    subpaths = poly ? [poly] : [];
  }

  if (!subpaths.length && isSvgGeometryElement(element)) {
    const sampled = sampleSvgGeometryAnchors(element, matrix);
    if (sampled) subpaths = [sampled];
  }
  if (!subpaths.length) return [];
  const transformedSubpaths = subpaths.map((subpath) => ({
    closed: subpath.closed,
    anchors: mapSvgAnchorsThroughMatrix(subpath.anchors, matrix),
  })).filter((subpath) => subpath.anchors.length >= 2);
  if (!transformedSubpaths.length) return [];
  const representative = transformedSubpaths[0];
  return [{
    kind: "path",
    name: String(element.getAttribute("id") || `SVG_${tag.toUpperCase()}`),
    groupPath: collectSvgGroupPath(element),
    groupContexts: collectSvgGroupContexts(element),
    closed: representative.closed,
    anchors: representative.anchors,
    subpaths: transformedSubpaths,
    fillRule: style.fillRule,
    fill: style.fillPaint ?? "rgba(0,0,0,0)",
    forceTransparentFill: style.forceTransparentFill || !transformedSubpaths.some((subpath) => subpath.closed),
    strokeColor: style.strokeColor,
    strokeWidth: style.strokeWidth,
    opacity: clampRange(Number(style.sourceStyle.opacity), 0, 1, 1),
    strokeDash: Array.isArray((style.sourceStyle.stroke as any)?.dash)
      ? ((style.sourceStyle.stroke as any).dash as number[])
      : [],
    strokeCap: ((style.sourceStyle.stroke as any)?.cap === "butt" || (style.sourceStyle.stroke as any)?.cap === "square")
      ? (style.sourceStyle.stroke as any).cap
      : "round",
    strokeJoin: ((style.sourceStyle.stroke as any)?.join === "bevel" || (style.sourceStyle.stroke as any)?.join === "miter")
      ? (style.sourceStyle.stroke as any).join
      : "round",
    strokeMiterLimit: Math.max(0.2, Number((style.sourceStyle.stroke as any)?.miter_limit || 4)),
    effects: style.effects.map((effect) => ({ ...effect })),
  }];
}

function parseSvgIntrinsicSize(svg: SVGSVGElement): { width: number; height: number } {
  const widthPx = parseSvgLengthToPx(svg.getAttribute("width"));
  const heightPx = parseSvgLengthToPx(svg.getAttribute("height"));
  const viewBoxRaw = String(svg.getAttribute("viewBox") || "").trim();
  const viewBoxParts = viewBoxRaw
    .split(/[\s,]+/)
    .map((part) => Number(part))
    .filter((value) => Number.isFinite(value));
  const viewBoxWidth = viewBoxParts.length >= 4 ? Math.abs(viewBoxParts[2]) : undefined;
  const viewBoxHeight = viewBoxParts.length >= 4 ? Math.abs(viewBoxParts[3]) : undefined;
  return {
    width: Math.max(1, Math.round(widthPx || viewBoxWidth || 960)),
    height: Math.max(1, Math.round(heightPx || viewBoxHeight || 720)),
  };
}

function collectSvgGroupPath(element: SVGElement): string[] {
  return collectSvgGroupContexts(element).map((context) => context.label);
}

function buildSvgResolvedTextStyleFromComputed(computed: CSSStyleDeclaration, fallbackColor: unknown): PinselaTextStyle {
  const fontSize = Math.max(4, parseSvgLengthToPx(computed.fontSize) ?? parseCssFloat(computed.fontSize, 16));
  const lineHeightRaw = parseSvgLengthToPx(computed.lineHeight);
  const lineHeightPx = lineHeightRaw && Number.isFinite(lineHeightRaw)
    ? lineHeightRaw
    : (fontSize * 1.25);
  const fontWeight = String(computed.fontWeight || "").toLowerCase();
  const fontStyleRaw = String(computed.fontStyle || "").toLowerCase();
  const isItalic = fontStyleRaw.includes("italic") || fontStyleRaw.includes("oblique");
  const isBold = fontWeight === "bold" || Number(fontWeight) >= 600;
  const styleLabel = isBold && isItalic
    ? "BoldItalic"
    : isItalic
      ? "Italic"
      : isBold
        ? "Bold"
        : "Regular";
  const letterSpacing = String(computed.letterSpacing || "").trim().toLowerCase() === "normal"
    ? 0
    : (parseSvgLengthToPx(computed.letterSpacing) ?? parseCssFloat(computed.letterSpacing, 0));
  return normalizeTextStyle({
    family: String(computed.fontFamily || "sans-serif"),
    style: styleLabel,
    size: round2(fontSize),
    line_height: round2(clampRange((lineHeightPx / Math.max(1, fontSize)) * 100, 40, 400, 125)),
    line_height_unit: "percent",
    letter_spacing: round2(letterSpacing),
    color: fallbackColor ?? "#111111",
    underline: String((computed as any).textDecorationLine || "").toLowerCase().includes("underline"),
  });
}

function diffSvgTextStyles(
  baseStyle: Partial<PinselaTextStyle> | null | undefined,
  nextStyle: Partial<PinselaTextStyle> | null | undefined,
): Partial<PinselaTextStyle> {
  const base = normalizeTextStyle(baseStyle);
  const next = normalizeTextStyle(nextStyle);
  if (textStyleFingerprint(base) === textStyleFingerprint(next)) return {};
  const diff: Partial<PinselaTextStyle> = {};
  const keys: Array<keyof PinselaTextStyle> = [
    "family",
    "postscript",
    "style",
    "size",
    "line_height",
    "line_height_unit",
    "letter_spacing",
    "text_align",
    "vertical_align",
    "underline",
    "color",
  ];
  keys.forEach((key) => {
    if ((base as any)[key] !== (next as any)[key]) {
      (diff as any)[key] = (next as any)[key];
    }
  });
  return diff;
}

function extractSvgTextContentAndRuns(
  element: SVGTextContentElement,
  baseStyle: Partial<PinselaTextStyle> | null | undefined,
): { content: string; textRuns: PinselaTextRun[] } {
  if (typeof window === "undefined" || typeof window.getComputedStyle !== "function") {
    return {
      content: String(element.textContent || "").replace(/\s+/g, " ").trim(),
      textRuns: [],
    };
  }
  const normalizedBase = normalizeTextStyle(baseStyle);
  let content = "";
  let pendingNewline = false;
  const textRuns: PinselaTextRun[] = [];

  const appendChunk = (value: string, style: Partial<PinselaTextStyle>): void => {
    const normalized = String(value || "").replace(/\s+/g, " ").trim();
    if (!normalized) return;
    if (pendingNewline && content.length > 0) {
      content += "\n";
    } else if (content.length > 0 && !content.endsWith("\n")) {
      content += " ";
    }
    pendingNewline = false;
    const start = content.length;
    content += normalized;
    const end = content.length;
    const diff = diffSvgTextStyles(normalizedBase, style);
    if (end > start && Object.keys(diff).length) {
      textRuns.push({ start, end, style: diff });
    }
  };

  const requestLineBreak = (): void => {
    if (!content.length) return;
    pendingNewline = true;
  };

  const visitNode = (node: Node, inheritedStyle: Partial<PinselaTextStyle>): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      appendChunk(node.textContent || "", inheritedStyle);
      return;
    }
    if (!(node instanceof Element)) return;
    const tag = String(node.tagName || "").toLowerCase();
    const computed = window.getComputedStyle(node);
    const nextStyle = buildSvgResolvedTextStyleFromComputed(computed, inheritedStyle?.color ?? normalizedBase.color);
    if (tag === "tspan") {
      const startsNewLine = (
        node.hasAttribute("x")
        || node.hasAttribute("y")
        || Math.abs(parseSvgLengthToPx(node.getAttribute("dy")) ?? 0) > 0.001
      );
      if (startsNewLine) requestLineBreak();
    }
    Array.from(node.childNodes).forEach((child) => visitNode(child, nextStyle));
  };

  Array.from(element.childNodes).forEach((child) => visitNode(child, normalizedBase));
  return {
    content: content.trim(),
    textRuns: content ? textRuns.filter((run) => run.end > run.start) : [],
  };
}

function extractSvgTextPathSubpaths(element: SVGElement): Array<{ closed: boolean; anchors: PathAnchorSpec[] }> {
  const tag = String(element.tagName || "").toLowerCase();
  const matrix = (element as SVGGraphicsElement).getCTM ? (element as SVGGraphicsElement).getCTM() : null;
  let subpaths: Array<{ closed: boolean; anchors: Array<{ x: number; y: number; in?: { x: number; y: number } | null; out?: { x: number; y: number } | null; mode?: "corner" | "smooth" }> }> = [];

  if (tag === "path") {
    subpaths = parseSvgPathDataSubpaths(String(element.getAttribute("d") || ""));
  } else if (tag === "rect") {
    const geometry = readSvgRectGeometry(element);
    if (geometry) subpaths = buildSvgRectSubpaths(geometry.x, geometry.y, geometry.width, geometry.height, geometry.cornerRadius, geometry.cornerRadius);
  } else if (tag === "circle") {
    const cx = Number((element as any).cx?.baseVal?.value ?? parseSvgLengthToPx(element.getAttribute("cx")) ?? 0);
    const cy = Number((element as any).cy?.baseVal?.value ?? parseSvgLengthToPx(element.getAttribute("cy")) ?? 0);
    const r = Number((element as any).r?.baseVal?.value ?? parseSvgLengthToPx(element.getAttribute("r")) ?? 0);
    const ellipse = buildSvgEllipseSubpath(cx, cy, r, r);
    subpaths = ellipse ? [ellipse] : [];
  } else if (tag === "ellipse") {
    const cx = Number((element as any).cx?.baseVal?.value ?? parseSvgLengthToPx(element.getAttribute("cx")) ?? 0);
    const cy = Number((element as any).cy?.baseVal?.value ?? parseSvgLengthToPx(element.getAttribute("cy")) ?? 0);
    const rx = Number((element as any).rx?.baseVal?.value ?? parseSvgLengthToPx(element.getAttribute("rx")) ?? 0);
    const ry = Number((element as any).ry?.baseVal?.value ?? parseSvgLengthToPx(element.getAttribute("ry")) ?? 0);
    const ellipse = buildSvgEllipseSubpath(cx, cy, rx, ry);
    subpaths = ellipse ? [ellipse] : [];
  } else if (tag === "line") {
    const x1 = Number((element as any).x1?.baseVal?.value ?? parseSvgLengthToPx(element.getAttribute("x1")) ?? 0);
    const y1 = Number((element as any).y1?.baseVal?.value ?? parseSvgLengthToPx(element.getAttribute("y1")) ?? 0);
    const x2 = Number((element as any).x2?.baseVal?.value ?? parseSvgLengthToPx(element.getAttribute("x2")) ?? 0);
    const y2 = Number((element as any).y2?.baseVal?.value ?? parseSvgLengthToPx(element.getAttribute("y2")) ?? 0);
    const line = buildSvgLineSubpath(x1, y1, x2, y2);
    subpaths = line ? [line] : [];
  } else if (tag === "polyline" || tag === "polygon") {
    const poly = buildSvgPolylineSubpath(parseSvgPoints(String(element.getAttribute("points") || "")), tag === "polygon");
    subpaths = poly ? [poly] : [];
  }

  if (!subpaths.length && isSvgGeometryElement(element)) {
    const sampled = sampleSvgGeometryAnchors(element, matrix);
    if (sampled) subpaths = [sampled];
  }

  return subpaths.map((subpath) => ({
    closed: subpath.closed,
    anchors: mapSvgAnchorsThroughMatrix(subpath.anchors, matrix),
  }));
}

function resolveSvgTextPathGeometry(
  element: SVGTextContentElement,
): { bounds: { x: number; y: number; width: number; height: number }; textPath: PinselaTextPath } | null {
  const textPathElement = element.querySelector("textPath");
  if (!(textPathElement instanceof SVGTextPathElement)) return null;
  const target = resolveSvgReferencedElement(textPathElement, readSvgElementHref(textPathElement));
  if (!(target instanceof SVGGraphicsElement)) return null;
  const rootSvg = element.ownerSVGElement || target.ownerSVGElement;
  if (!rootSvg) return null;
  const bounds = svgNodeUserBounds(target, rootSvg);
  if (!bounds) return null;
  const subpaths = extractSvgTextPathSubpaths(target);
  const anchors = subpaths[0]?.anchors || [];
  if (anchors.length < 2) return null;
  const first = anchors[0];
  const last = anchors[anchors.length - 1];
  const oneThird = anchors[Math.max(1, Math.floor((anchors.length - 1) / 3))] || first;
  const twoThirds = anchors[Math.max(1, Math.floor(((anchors.length - 1) * 2) / 3))] || last;
  const p1 = first.out || oneThird;
  const p2 = last.in || twoThirds;
  return {
    bounds,
    textPath: {
      type: "bezier",
      points: [
        { x: round2(first.x - bounds.x), y: round2(first.y - bounds.y) },
        { x: round2(p1.x - bounds.x), y: round2(p1.y - bounds.y) },
        { x: round2(p2.x - bounds.x), y: round2(p2.y - bounds.y) },
        { x: round2(last.x - bounds.x), y: round2(last.y - bounds.y) },
      ],
      start_offset: parseSvgLengthToPx(textPathElement.getAttribute("startOffset")) ?? undefined,
      anchor: "center",
    },
  };
}

function parseSvgTextElement(element: SVGTextContentElement): ImportedVectorTextElement | null {
  if (typeof window === "undefined" || typeof window.getComputedStyle !== "function") return null;

  const computed = window.getComputedStyle(element);
  const style = extractSvgPathStyle(element as unknown as SVGElement);
  const fill = style?.fillPaint ?? "#111111";
  const opacity = clampRange(Number(style?.sourceStyle.opacity ?? parseCssFloat(computed.opacity, 1)), 0, 1, 1);
  if (opacity <= 0.001) return null;
  const baseTextStyle = buildSvgResolvedTextStyleFromComputed(computed, fill);
  const { content, textRuns } = extractSvgTextContentAndRuns(element, baseTextStyle);
  if (!content) return null;

  const textPathGeometry = resolveSvgTextPathGeometry(element);

  let box: DOMRect | null = null;
  try {
    box = element.getBBox();
  } catch {
    box = null;
  }
  if (!box && !textPathGeometry) return null;

  const matrix = element.getCTM();
  const worldBox = textPathGeometry?.bounds || (
    box
      ? svgNodeBoundsToWorld(
          Number(box.x || 0),
          Number(box.y || 0),
          Number(box.width || 0),
          Number(box.height || 0),
          matrix,
        )
      : null
  );
  if (!worldBox) return null;
  const orientedBox = textPathGeometry
    ? {
        x: worldBox.x,
        y: worldBox.y,
        width: worldBox.width,
        height: worldBox.height,
        rotation: 0,
      }
    : svgNodeBoundsToOrientedWorld(
        Number(box?.x || 0),
        Number(box?.y || 0),
        Number(box?.width || 0),
        Number(box?.height || 0),
        matrix,
      );
  const transformMatrix = (!textPathGeometry && box && !orientedBox)
    ? buildSvgAffineGeometryMatrix(
        Number(box.x || 0),
        Number(box.y || 0),
        Number(box.width || 0),
        Number(box.height || 0),
        worldBox,
        matrix,
      )
    : null;

  const textAnchor = String(element.getAttribute("text-anchor") || computed.textAnchor || "").toLowerCase();
  const textAlign: ImportedVectorTextElement["textAlign"] = textAnchor === "middle"
    ? "center"
    : textAnchor === "end"
      ? "right"
      : "left";

  return {
    kind: "text",
    name: String(element.getAttribute("id") || "SVG_TEXT"),
    groupPath: collectSvgGroupPath(element as unknown as SVGElement),
    groupContexts: collectSvgGroupContexts(element as unknown as SVGElement),
    content,
    x: round2(orientedBox?.x ?? worldBox.x),
    y: round2(orientedBox?.y ?? worldBox.y),
    width: round2(orientedBox?.width ?? worldBox.width),
    height: round2(orientedBox?.height ?? worldBox.height),
    opacity: round2(opacity),
    rotation: round2(orientedBox?.rotation ?? 0),
    color: fill,
    strokeColor: style?.strokeColor,
    strokeWidth: style?.strokeWidth,
    strokeDash: Array.isArray((style?.sourceStyle.stroke as any)?.dash)
      ? ((style!.sourceStyle.stroke as any).dash as number[])
      : [],
    strokeCap: ((style?.sourceStyle.stroke as any)?.cap === "butt" || (style?.sourceStyle.stroke as any)?.cap === "square")
      ? (style!.sourceStyle.stroke as any).cap
      : "round",
    strokeJoin: ((style?.sourceStyle.stroke as any)?.join === "bevel" || (style?.sourceStyle.stroke as any)?.join === "miter")
      ? (style!.sourceStyle.stroke as any).join
      : "round",
    strokeMiterLimit: Math.max(0.2, Number((style?.sourceStyle.stroke as any)?.miter_limit || 4)),
    fontFamily: String(baseTextStyle.family || computed.fontFamily || "sans-serif"),
    fontStyle: String(baseTextStyle.style || "Regular"),
    fontSize: round2(Number(baseTextStyle.size || 16)),
    lineHeightPercent: round2(Number(baseTextStyle.line_height || 125)),
    letterSpacing: round2(Number(baseTextStyle.letter_spacing || 0)),
    textAlign,
    underline: Boolean(baseTextStyle.underline),
    textRuns,
    textPath: textPathGeometry?.textPath || null,
    effects: style?.effects ? style.effects.map((effect) => ({ ...effect })) : [],
    transformMatrix,
  };
}

function extractSvgImageFit(element: SVGImageElement): "fill" | "fit" | "crop" {
  const preserve = String(element.getAttribute("preserveAspectRatio") || "").trim().toLowerCase();
  if (!preserve || preserve === "xmidymid meet") return "fit";
  if (preserve.includes("slice")) return "crop";
  if (preserve.includes("none")) return "fill";
  return "fit";
}

function parseSvgImageElement(element: SVGImageElement): ImportedVectorImageElement | null {
  const href = String(
    element.getAttribute("href")
    || element.getAttributeNS("http://www.w3.org/1999/xlink", "href")
    || "",
  ).trim();
  if (!href) return null;
  if (typeof window === "undefined" || typeof window.getComputedStyle !== "function") return null;

  const opacity = clampRange(parseCssFloat(window.getComputedStyle(element).opacity, 1), 0, 1, 1);
  if (opacity <= 0.001) return null;
  const matrix = element.getCTM();
  const x = Number((element as any).x?.baseVal?.value ?? parseSvgLengthToPx(element.getAttribute("x")) ?? 0);
  const y = Number((element as any).y?.baseVal?.value ?? parseSvgLengthToPx(element.getAttribute("y")) ?? 0);
  const width = Number((element as any).width?.baseVal?.value ?? parseSvgLengthToPx(element.getAttribute("width")) ?? 0);
  const height = Number((element as any).height?.baseVal?.value ?? parseSvgLengthToPx(element.getAttribute("height")) ?? 0);
  const worldBox = svgNodeBoundsToWorld(x, y, width, height, matrix);
  if (!worldBox) return null;
  const orientedBox = svgNodeBoundsToOrientedWorld(x, y, width, height, matrix);
  const simpleFrame = resolveSimpleSvgImageFrame(element);
  const transformMatrix = !orientedBox
    ? buildSvgAffineGeometryMatrix(x, y, width, height, worldBox, matrix)
    : null;
  const effects = resolveSvgSimpleFilterEffects(element);
  if (effects == null) return null;
  return {
    kind: "image",
    name: String(element.getAttribute("id") || "SVG_IMAGE"),
    groupPath: collectSvgGroupPath(element as unknown as SVGElement),
    groupContexts: collectSvgGroupContexts(element as unknown as SVGElement),
    src: href,
    x: round2(orientedBox?.x ?? worldBox.x),
    y: round2(orientedBox?.y ?? worldBox.y),
    width: round2(orientedBox?.width ?? worldBox.width),
    height: round2(orientedBox?.height ?? worldBox.height),
    opacity: round2(opacity),
    rotation: round2(orientedBox?.rotation ?? 0),
    fit: extractSvgImageFit(element),
    useFrame: Boolean(simpleFrame),
    cornerRadius: round2(Number(simpleFrame?.cornerRadius || 0)),
    effects: effects.map((effect) => ({ ...effect })),
    transformMatrix,
  };
}

function parseSvgSourceToVectorPayload(sourceText: string): {
  src: string;
  intrinsicWidth: number;
  intrinsicHeight: number;
  payload: ImportedVectorPayload | null;
} | null {
  if (typeof DOMParser === "undefined" || typeof XMLSerializer === "undefined") return null;
  const parser = new DOMParser();
  const doc = parser.parseFromString(sourceText, "image/svg+xml");
  const parserError = doc.querySelector("parsererror");
  const rootElement = doc.documentElement;
  if (parserError || !rootElement || String(rootElement.tagName || "").toLowerCase() !== "svg") return null;
  const svg = rootElement as unknown as SVGSVGElement;

  const { width: intrinsicWidth, height: intrinsicHeight } = parseSvgIntrinsicSize(svg);
  if (!svg.getAttribute("xmlns")) {
    svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  }
  if (!svg.getAttribute("viewBox")) {
    svg.setAttribute("viewBox", `0 0 ${intrinsicWidth} ${intrinsicHeight}`);
  }
  const serialized = new XMLSerializer().serializeToString(svg);
  const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`;

  if (typeof document === "undefined" || !document.body) {
    return { src, intrinsicWidth, intrinsicHeight, payload: null };
  }

  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.left = "-200vw";
  host.style.top = "-200vh";
  host.style.width = "1px";
  host.style.height = "1px";
  host.style.opacity = "0";
  host.style.pointerEvents = "none";
  host.style.overflow = "hidden";
  const mountedSvg = svg.cloneNode(true) as SVGSVGElement;
  mountedSvg.setAttribute("width", String(intrinsicWidth));
  mountedSvg.setAttribute("height", String(intrinsicHeight));
  mountedSvg.setAttribute("viewBox", mountedSvg.getAttribute("viewBox") || `0 0 ${intrinsicWidth} ${intrinsicHeight}`);
  expandSvgUseElements(mountedSvg);
  host.appendChild(mountedSvg);
  document.body.appendChild(host);

  try {
    const elements: ImportedVectorElement[] = [];
    const covered = new Set<SVGElement>();
    let rasterFallbacks = 0;
    let richTextRuns = 0;
    let textPaths = 0;
    let frameImages = 0;
    let compoundPaths = 0;
    let evenOddPaths = 0;
    let simpleFilters = 0;
    let affineTransforms = 0;
    const candidates = Array.from(
      mountedSvg.querySelectorAll("g,foreignObject,path,rect,circle,ellipse,line,polyline,polygon,text,image"),
    ) as SVGElement[];

    for (const candidate of candidates) {
      let blockedByCoveredAncestor = false;
      let ancestor: Element | null = candidate;
      while (ancestor) {
        if (ancestor !== candidate && covered.has(ancestor as SVGElement)) {
          blockedByCoveredAncestor = true;
          break;
        }
        if (ancestor === mountedSvg) break;
        ancestor = ancestor.parentElement;
      }
      if (blockedByCoveredAncestor) continue;
      if (svgElementShouldBeSkipped(candidate)) continue;
      const tag = String(candidate.tagName || "").toLowerCase();

      if (svgElementNeedsRasterFallback(candidate)) {
        const fallback = buildSvgRasterFallbackElement(mountedSvg, candidate);
        if (fallback) {
          elements.push(fallback);
          rasterFallbacks += 1;
          covered.add(candidate);
          candidate.querySelectorAll("*").forEach((descendant) => covered.add(descendant as SVGElement));
          continue;
        }
      }

      if (tag === "g") {
        if (hasRenderableSvgDescendants(candidate)) continue;
        continue;
      }

      if (tag === "foreignobject") {
        continue;
      }

      if (tag === "text") {
        const textElement = parseSvgTextElement(candidate as SVGTextContentElement);
        if (textElement) {
          if (Array.isArray(textElement.textRuns) && textElement.textRuns.length) richTextRuns += textElement.textRuns.length;
          if (textElement.textPath) textPaths += 1;
          if (Array.isArray(textElement.effects) && textElement.effects.length) simpleFilters += textElement.effects.length;
          if (textElement.transformMatrix) affineTransforms += 1;
          elements.push(textElement);
        }
        continue;
      }

      if (tag === "image") {
        const imageElement = parseSvgImageElement(candidate as SVGImageElement);
        if (imageElement) {
          if (imageElement.useFrame) frameImages += 1;
          if (Array.isArray(imageElement.effects) && imageElement.effects.length) simpleFilters += imageElement.effects.length;
          if (imageElement.transformMatrix) affineTransforms += 1;
          elements.push(imageElement);
        }
        continue;
      }

      elements.push(...extractExactSvgPathElements(candidate));
      const latestPath = elements[elements.length - 1];
      if (latestPath?.kind === "path") {
        if (Array.isArray(latestPath.subpaths) && latestPath.subpaths.length > 1) compoundPaths += 1;
        if (latestPath.fillRule === "evenodd") evenOddPaths += 1;
        if (Array.isArray(latestPath.effects) && latestPath.effects.length) simpleFilters += latestPath.effects.length;
      }
    }

    return {
      src,
      intrinsicWidth,
      intrinsicHeight,
      payload: elements.length
        ? {
          source: "svg",
          width: intrinsicWidth,
          height: intrinsicHeight,
          elements,
          stats: {
            rasterFallbacks,
            richTextRuns,
            textPaths,
            frameImages,
            nestedGroups: new Set(
              elements.flatMap((element) => {
                const groupPath = Array.isArray((element as any).groupPath) ? ((element as any).groupPath as string[]) : [];
                return groupPath.length ? [groupPath.join(" > ")] : [];
              }),
            ).size,
            compoundPaths,
            evenOddPaths,
            simpleFilters,
            affineTransforms,
          },
        }
        : null,
    };
  } finally {
    host.remove();
  }
}

function rectAnchors(x: number, y: number, width: number, height: number): PathAnchorSpec[] {
  return [
    { x: round2(x), y: round2(y), mode: "corner" },
    { x: round2(x + width), y: round2(y), mode: "corner" },
    { x: round2(x + width), y: round2(y + height), mode: "corner" },
    { x: round2(x), y: round2(y + height), mode: "corner" },
  ];
}

function buildPdfPlaceholderVectorPayload(
  name: string,
  width: number,
  height: number,
  pageCount?: number,
): ImportedVectorPayload {
  const safeWidth = Math.max(320, Math.round(width));
  const safeHeight = Math.max(320, Math.round(height));
  const pageInset = Math.max(18, Math.round(Math.min(safeWidth, safeHeight) * 0.05));
  const headerHeight = Math.max(42, Math.round(safeHeight * 0.14));
  const pageCountLabel = pageCount && Number.isFinite(pageCount) && pageCount > 0 ? `${Math.round(pageCount)} pg.` : "1 pg.";
  const elements: ImportedVectorElement[] = [
    {
      kind: "path",
      name: "PDF_CANVAS_BG",
      closed: true,
      anchors: rectAnchors(0, 0, safeWidth, safeHeight),
      fill: "#0f172a",
      forceTransparentFill: false,
      strokeColor: "#1e293b",
      strokeWidth: 1,
      opacity: 1,
      strokeDash: [],
      strokeCap: "round",
      strokeJoin: "round",
      strokeMiterLimit: 4,
    },
    {
      kind: "path",
      name: "PDF_PAGE",
      closed: true,
      anchors: rectAnchors(pageInset, pageInset, safeWidth - pageInset * 2, safeHeight - pageInset * 2),
      fill: "#ffffff",
      forceTransparentFill: false,
      strokeColor: "#cbd5e1",
      strokeWidth: 2,
      opacity: 1,
      strokeDash: [],
      strokeCap: "round",
      strokeJoin: "round",
      strokeMiterLimit: 4,
    },
    {
      kind: "path",
      name: "PDF_HEADER",
      closed: true,
      anchors: rectAnchors(
        pageInset,
        pageInset,
        safeWidth - pageInset * 2,
        Math.max(10, headerHeight - pageInset * 0.3),
      ),
      fill: "#f1f5f9",
      forceTransparentFill: false,
      strokeColor: "#e2e8f0",
      strokeWidth: 1,
      opacity: 1,
      strokeDash: [],
      strokeCap: "round",
      strokeJoin: "round",
      strokeMiterLimit: 4,
    },
    {
      kind: "text",
      name: "PDF_TITLE",
      content: String(name || "PDF"),
      x: round2(pageInset + 20),
      y: round2(pageInset + 12),
      width: round2(Math.max(120, safeWidth - pageInset * 2 - 40)),
      height: round2(Math.max(22, headerHeight - 18)),
      opacity: 1,
      color: "#0f172a",
      fontFamily: "Inter, sans-serif",
      fontStyle: "Bold",
      fontSize: Math.max(16, Math.round(safeHeight * 0.04)),
      lineHeightPercent: 120,
      textAlign: "left",
    },
    {
      kind: "text",
      name: "PDF_META",
      content: `Imported as vector group · ${pageCountLabel}`,
      x: round2(pageInset + 20),
      y: round2(pageInset + headerHeight),
      width: round2(Math.max(120, safeWidth - pageInset * 2 - 40)),
      height: 28,
      opacity: 0.86,
      color: "#475569",
      fontFamily: "Inter, sans-serif",
      fontStyle: "Regular",
      fontSize: Math.max(12, Math.round(safeHeight * 0.023)),
      lineHeightPercent: 130,
      textAlign: "left",
    },
  ];
  return {
    source: "pdf_placeholder",
    width: safeWidth,
    height: safeHeight,
    elements,
  };
}

function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === "function") return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the file."));
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.readAsArrayBuffer(file);
  });
}

function readFileAsText(file: File): Promise<string> {
  if (typeof file.text === "function") return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the text file."));
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsText(file);
  });
}

function decodeBinaryLatin1(bytes: Uint8Array, maxBytes = bytes.length): string {
  const size = Math.max(0, Math.min(bytes.length, Math.round(maxBytes)));
  const slice = bytes.subarray(0, size);
  if (typeof TextDecoder !== "undefined") {
    try {
      return new TextDecoder("latin1").decode(slice);
    } catch {
      // fallback below
    }
  }
  let out = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < slice.length; index += chunkSize) {
    const chunk = slice.subarray(index, Math.min(slice.length, index + chunkSize));
    let inner = "";
    for (let i = 0; i < chunk.length; i += 1) {
      inner += String.fromCharCode(chunk[i]);
    }
    out += inner;
  }
  return out;
}

function parsePdfMetadata(buffer: ArrayBuffer): {
  pageCount?: number;
  widthPx?: number;
  heightPx?: number;
} {
  const bytes = new Uint8Array(buffer);
  const text = decodeBinaryLatin1(bytes, Math.min(bytes.length, 4_000_000));
  const countMatches = Array.from(text.matchAll(/\/Count\s+(\d{1,6})\b/g));
  const counts = countMatches
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value) && value > 0 && value <= 20000);
  const pageCount = counts.length ? Math.max(...counts) : undefined;

  const mediaBoxMatch = text.match(
    /\/MediaBox\s*\[\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\]/,
  );
  if (!mediaBoxMatch) return { pageCount };
  const x1 = Number(mediaBoxMatch[1]);
  const y1 = Number(mediaBoxMatch[2]);
  const x2 = Number(mediaBoxMatch[3]);
  const y2 = Number(mediaBoxMatch[4]);
  const widthPt = Math.abs(x2 - x1);
  const heightPt = Math.abs(y2 - y1);
  if (!Number.isFinite(widthPt) || !Number.isFinite(heightPt) || widthPt <= 0 || heightPt <= 0) {
    return { pageCount };
  }
  return {
    pageCount,
    widthPx: Math.max(1, Math.round(widthPt * (96 / 72))),
    heightPx: Math.max(1, Math.round(heightPt * (96 / 72))),
  };
}

function parsePsdMetadata(buffer: ArrayBuffer): { width?: number; height?: number } {
  if (buffer.byteLength < 26) return {};
  const view = new DataView(buffer);
  const signature = String.fromCharCode(
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3),
  );
  const version = view.getUint16(4, false);
  if (signature !== "8BPS" || version !== 1) return {};
  const height = view.getUint32(14, false);
  const width = view.getUint32(18, false);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return {};
  return {
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  };
}

function parsePptxSlideCount(buffer: ArrayBuffer): number | undefined {
  const bytes = new Uint8Array(buffer);
  const text = decodeBinaryLatin1(bytes, Math.min(bytes.length, 12_000_000));
  const matches = text.match(/ppt\/slides\/slide\d+\.xml/gi);
  if (!matches || !matches.length) return undefined;
  return new Set(matches.map((entry) => entry.toLowerCase())).size;
}

function parseFigMetadata(text: string): {
  nodeCount?: number;
  width?: number;
  height?: number;
} {
  const raw = String(text || "").trim();
  if (!raw.startsWith("{") || !raw.endsWith("}")) return {};
  try {
    const parsed = JSON.parse(raw);
    let nodeCount = 0;
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    const queue: unknown[] = [parsed];
    const maxVisit = 8000;
    let visited = 0;
    while (queue.length && visited < maxVisit) {
      const current = queue.shift();
      visited += 1;
      if (!current || typeof current !== "object") continue;
      nodeCount += 1;
      const obj = current as Record<string, unknown>;
      const x = Number((obj as any).x ?? (obj as any).absoluteBoundingBox?.x);
      const y = Number((obj as any).y ?? (obj as any).absoluteBoundingBox?.y);
      const w = Number((obj as any).width ?? (obj as any).absoluteBoundingBox?.width);
      const h = Number((obj as any).height ?? (obj as any).absoluteBoundingBox?.height);
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + w);
        maxY = Math.max(maxY, y + h);
      }
      for (const key of Object.keys(obj)) {
        const value = obj[key];
        if (Array.isArray(value)) {
          for (const item of value) queue.push(item);
        } else if (value && typeof value === "object") {
          queue.push(value);
        }
      }
    }
    const out: { nodeCount?: number; width?: number; height?: number } = {};
    if (nodeCount > 0) out.nodeCount = nodeCount;
    if (Number.isFinite(minX) && Number.isFinite(minY) && Number.isFinite(maxX) && Number.isFinite(maxY) && maxX > minX && maxY > minY) {
      out.width = Math.max(1, Math.round(maxX - minX));
      out.height = Math.max(1, Math.round(maxY - minY));
    }
    return out;
  } catch {
    return {};
  }
}

async function parseImportAsset(file: File): Promise<{
  kind: ImportedAssetEntry["kind"];
  src: string;
  placementSrc: string;
  parseMode: ImportedAssetEntry["parseMode"];
  parser: string;
  intrinsicWidth?: number;
  intrinsicHeight?: number;
  pageCount?: number;
  detailLabel?: string;
  vectorPayload?: ImportedVectorPayload;
}> {
  const extension = getFileExtension(file.name);
  const mimeType = String(file.type || "").trim().toLowerCase();
  const name = String(file.name || "Import")
    .replace(/\.[^.]+$/, "")
    .replace(/\s+/g, " ")
    .trim() || "Import";
  const kind = inferImportKind(extension, mimeType);
  const ext = String(extension || "").toLowerCase();

  if (kind === "image" && ext !== "svg") {
    const src = await readFileAsDataUrl(file);
    const intrinsic = await loadImageIntrinsicSize(src);
    return {
      kind: "image",
      src,
      placementSrc: src,
      parseMode: "parsed",
      parser: "image_dataurl",
      intrinsicWidth: intrinsic?.width,
      intrinsicHeight: intrinsic?.height,
    };
  }

  if (ext === "svg" || mimeType.includes("svg")) {
    try {
      const sourceText = await readFileAsText(file);
      const parsedSvg = parseSvgSourceToVectorPayload(sourceText);
      if (parsedSvg) {
        const elementCount = parsedSvg.payload?.elements.length || 0;
        const stats = parsedSvg.payload?.stats;
        const detailParts = [
          `${parsedSvg.intrinsicWidth}x${parsedSvg.intrinsicHeight}px`,
          elementCount ? `${elementCount} el.` : "",
          stats?.rasterFallbacks ? `${stats.rasterFallbacks} fallback` : "",
          stats?.simpleFilters ? `${stats.simpleFilters} fx` : "",
          stats?.affineTransforms ? `${stats.affineTransforms} affine` : "",
          stats?.textPaths ? `${stats.textPaths} textPath` : "",
          stats?.frameImages ? `${stats.frameImages} frame` : "",
          stats?.compoundPaths ? `${stats.compoundPaths} compound` : "",
          stats?.evenOddPaths ? `${stats.evenOddPaths} evenodd` : "",
        ].filter(Boolean);
        return {
          kind: "vector",
          src: parsedSvg.src,
          placementSrc: parsedSvg.src,
          parseMode: "parsed",
          parser: parsedSvg.payload ? "svg_dom_vector_grouped" : "svg_dom_preview_only",
          intrinsicWidth: parsedSvg.intrinsicWidth,
          intrinsicHeight: parsedSvg.intrinsicHeight,
          detailLabel: detailParts.join(" · "),
          vectorPayload: parsedSvg.payload || undefined,
        };
      }
    } catch {
      // fallback below
    }
    const src = createImportPlaceholderDataUrl(name, ext || "svg", {
      subtitle: "SVG with smart fallback",
      detail: "Vector file preserved as placeholder",
      accent: "#22d3ee",
    });
    return {
      kind: "vector",
      src,
      placementSrc: src,
      parseMode: "fallback",
      parser: "svg_fallback",
      intrinsicWidth: 960,
      intrinsicHeight: 720,
      detailLabel: "vector placeholder",
    };
  }

  if (ext === "pdf" || mimeType.includes("pdf")) {
    let metadata: { pageCount?: number; widthPx?: number; heightPx?: number } = {};
    try {
      const buffer = await readFileAsArrayBuffer(file);
      metadata = parsePdfMetadata(buffer);
    } catch {
      metadata = {};
    }
    const pageCount = metadata.pageCount;
    const width = Math.max(320, Math.round(Number(metadata.widthPx || 960)));
    const height = Math.max(320, Math.round(Number(metadata.heightPx || 720)));
    const src = createImportPlaceholderDataUrl(name, "pdf", {
      subtitle: pageCount ? `${pageCount} page(s) detected` : "PDF loaded",
      detail: `${width}x${height}px (estimated via MediaBox)`,
      accent: "#f59e0b",
      width,
      height,
    });
    return {
      kind: "document",
      src,
      placementSrc: src,
      parseMode: "parsed",
      parser: "pdf_metadata",
      intrinsicWidth: width,
      intrinsicHeight: height,
      pageCount,
      detailLabel: pageCount ? `${pageCount} pg.` : "single/unknown page count",
      vectorPayload: buildPdfPlaceholderVectorPayload(name, width, height, pageCount),
    };
  }

  if (ext === "psd") {
    let metadata: { width?: number; height?: number } = {};
    try {
      const buffer = await readFileAsArrayBuffer(file);
      metadata = parsePsdMetadata(buffer);
    } catch {
      metadata = {};
    }
    const width = Math.max(320, Math.round(Number(metadata.width || 960)));
    const height = Math.max(320, Math.round(Number(metadata.height || 720)));
    const parsed = Boolean(metadata.width && metadata.height);
    const src = createImportPlaceholderDataUrl(name, "psd", {
      subtitle: parsed ? "PSD with real dimensions detected" : "PSD with smart fallback",
      detail: parsed ? `${width}x${height}px` : "No client-side layer parser",
      accent: "#60a5fa",
      width,
      height,
    });
    return {
      kind: "document",
      src,
      placementSrc: src,
      parseMode: parsed ? "parsed" : "fallback",
      parser: parsed ? "psd_header" : "psd_fallback",
      intrinsicWidth: width,
      intrinsicHeight: height,
      detailLabel: parsed ? `${width}x${height}px` : "header unavailable",
    };
  }

  if (ext === "ppt" || ext === "pptx") {
    let slideCount: number | undefined;
    try {
      const buffer = await readFileAsArrayBuffer(file);
      slideCount = parsePptxSlideCount(buffer);
    } catch {
      slideCount = undefined;
    }
    const src = createImportPlaceholderDataUrl(name, ext || "pptx", {
      subtitle: slideCount ? `${slideCount} slide(s) detected` : "PowerPoint with smart fallback",
      detail: "Structure preserved for canvas placement",
      accent: "#fb7185",
    });
    return {
      kind: "document",
      src,
      placementSrc: src,
      parseMode: slideCount ? "parsed" : "fallback",
      parser: slideCount ? "pptx_zip_scan" : "pptx_fallback",
      intrinsicWidth: 1366,
      intrinsicHeight: 768,
      detailLabel: slideCount ? `${slideCount} slides` : "slides not detected",
    };
  }

  if (ext === "fig") {
    let metadata: { nodeCount?: number; width?: number; height?: number } = {};
    try {
      const text = await readFileAsText(file);
      metadata = parseFigMetadata(text);
    } catch {
      metadata = {};
    }
    const width = Math.max(320, Math.round(Number(metadata.width || 1200)));
    const height = Math.max(320, Math.round(Number(metadata.height || 780)));
    const parsed = Boolean(metadata.nodeCount || (metadata.width && metadata.height));
    const src = createImportPlaceholderDataUrl(name, "fig", {
      subtitle: parsed ? "FIG with metadata read" : "FIG with smart fallback",
      detail: parsed
        ? `${metadata.nodeCount ? `${metadata.nodeCount} nodes · ` : ""}${width}x${height}px`
        : "Proprietary format without a full local parser",
      accent: "#34d399",
      width,
      height,
    });
    return {
      kind: "document",
      src,
      placementSrc: src,
      parseMode: parsed ? "parsed" : "fallback",
      parser: parsed ? "fig_json_scan" : "fig_fallback",
      intrinsicWidth: width,
      intrinsicHeight: height,
      detailLabel: metadata.nodeCount ? `${metadata.nodeCount} nodes` : "partial metadata",
    };
  }

  if (ext === "aff" || ext === "afdesign" || ext === "afphoto" || ext === "afpub") {
    const src = createImportPlaceholderDataUrl(name, ext || "aff", {
      subtitle: "Affinity with smart fallback",
      detail: "Preview with basic metadata for placement",
      accent: "#a78bfa",
      width: 1280,
      height: 800,
    });
    return {
      kind: "document",
      src,
      placementSrc: src,
      parseMode: "fallback",
      parser: "aff_fallback",
      intrinsicWidth: 1280,
      intrinsicHeight: 800,
      detailLabel: "layout parser on the roadmap",
    };
  }

  const fallbackKind = inferImportKind(extension, mimeType);
  const src = createImportPlaceholderDataUrl(name, extension || "file", {
    subtitle: "Smart fallback",
    detail: "File ready to place on the canvas",
    accent: "#94a3b8",
  });
  return {
    kind: fallbackKind,
    src,
    placementSrc: src,
    parseMode: "fallback",
    parser: `${extension || "file"}_fallback`,
    intrinsicWidth: 960,
    intrinsicHeight: 720,
    detailLabel: "metadata unavailable",
  };
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the image."));
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(file);
  });
}

function mimeTypeToImageExtension(mimeType: string, fallback = "png"): string {
  const normalized = String(mimeType || "").trim().toLowerCase();
  if (normalized === "image/jpeg" || normalized === "image/jpg") return "jpg";
  if (normalized === "image/webp") return "webp";
  if (normalized === "image/gif") return "gif";
  if (normalized === "image/svg+xml") return "svg";
  if (normalized === "image/png") return "png";
  return fallback;
}

function sanitizeImageAssetName(rawName: string | null | undefined, fallback = "Image", mimeType?: string | null): string {
  const trimmed = String(rawName || "").trim().replace(/[\\/:*?"<>|]+/g, "_");
  const fallbackBase = String(fallback || "Image").trim() || "Image";
  const resolved = trimmed || fallbackBase;
  if (/\.[a-z0-9]{2,5}$/i.test(resolved)) return resolved;
  const ext = mimeTypeToImageExtension(String(mimeType || "").trim(), "png");
  return `${resolved}.${ext}`;
}

function isLikelyImageUrl(value: string): boolean {
  const normalized = String(value || "").trim();
  if (/^data:image\//i.test(normalized)) return true;
  if (/^blob:/i.test(normalized)) return true;
  return /^https?:\/\/\S+\.(png|jpe?g|webp|gif|svg|bmp|avif|tiff?)(?:[?#]\S*)?$/i.test(normalized);
}

function extractClipboardImageUrls(html: string, text: string, uriList = ""): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string, options?: { fromImageElement?: boolean }) => {
    const value = String(raw || "").trim();
    if (!value || seen.has(value)) return;
    const usableImageSource = options?.fromImageElement
      ? (/^data:image\//i.test(value) || /^https?:\/\//i.test(value) || /^blob:/i.test(value))
      : isLikelyImageUrl(value);
    if (!usableImageSource) return;
    seen.add(value);
    out.push(value);
  };

  const rawHtml = String(html || "").trim();
  if (rawHtml) {
    const srcPattern = /<img[^>]+src=["']([^"']+)["']/gi;
    for (const match of rawHtml.matchAll(srcPattern)) {
      push(match[1] || "", { fromImageElement: true });
    }
  }

  const rawText = [text, uriList]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join("\n");
  if (rawText) {
    rawText.split(/\r?\n/g).forEach((line) => push(line));
  }

  return out;
}

function extractClipboardSvgSource(html: string, text: string): string | null {
  const candidates = [text, html]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  for (const value of candidates) {
    if (/^<svg[\s>]/i.test(value) && /<\/svg>$/i.test(value)) return value;
    const match = value.match(/<svg[\s\S]*<\/svg>/i);
    if (match?.[0]) return match[0];
  }
  return null;
}

function htmlToClipboardPlainText(html: string): string {
  const raw = String(html || "").trim();
  if (!raw || typeof DOMParser === "undefined") return "";
  try {
    const parsed = new DOMParser().parseFromString(raw, "text/html");
    return String(parsed.body?.innerText || parsed.body?.textContent || "").trim();
  } catch {
    return raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
}

function normalizeClipboardText(value: string): string {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .trim();
}

type ExternalClipboardPayload = {
  imageFiles: File[];
  importFiles: File[];
  imageUrls: string[];
  svgSource: string | null;
  text: string;
};

function hasExternalClipboardPayload(payload: ExternalClipboardPayload, includeText: boolean): boolean {
  return payload.imageFiles.length > 0
    || payload.importFiles.length > 0
    || payload.imageUrls.length > 0
    || Boolean(payload.svgSource)
    || (includeText && Boolean(payload.text));
}

function clipboardDataToPayload(clipboard: DataTransfer): ExternalClipboardPayload {
  const files = Array.from(clipboard.files || []);
  const itemFiles = Array.from(clipboard.items || [])
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter(Boolean) as File[];
  const allFiles = [...files, ...itemFiles].filter((file, index, entries) => (
    entries.findIndex((entry) => (
      entry === file
      || (
        String(entry.name || "") === String(file.name || "")
        && Number(entry.size || 0) === Number(file.size || 0)
        && String(entry.type || "") === String(file.type || "")
      )
    )) === index
  ));
  const imageFiles = allFiles.filter((file) => isImageFileLike(file));
  const importFiles = allFiles.filter((file) => !isImageFileLike(file) && isImportFileLike(file));
  const html = String(clipboard.getData("text/html") || "");
  const plainText = String(clipboard.getData("text/plain") || "");
  const uriList = String(clipboard.getData("text/uri-list") || "");
  const imageUrls = imageFiles.length
    ? []
    : extractClipboardImageUrls(html, plainText, uriList);
  const svgSource = !imageFiles.length && !imageUrls.length && !importFiles.length
    ? extractClipboardSvgSource(html, plainText)
    : null;
  const text = normalizeClipboardText(plainText || htmlToClipboardPlainText(html));
  return {
    imageFiles,
    importFiles,
    imageUrls,
    svgSource,
    text,
  };
}

async function imageUrlToFile(url: string, fallbackName: string): Promise<File | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    const mimeType = String(blob.type || "").trim().toLowerCase();
    if (!mimeType.startsWith("image/")) return null;
    const filename = sanitizeImageAssetName(
      deriveImageNameFromSource(url, fallbackName),
      fallbackName,
      mimeType,
    );
    return new File([blob], filename, { type: mimeType || undefined });
  } catch {
    return null;
  }
}

async function loadImageIntrinsicSize(
  src: string,
  imageCache?: Map<string, HTMLImageElement>,
): Promise<{ width: number; height: number } | null> {
  const img = imageCache
    ? await preloadCanvasImage(src, imageCache)
    : await loadCanvasImageElement(src);
  if (!img) return null;
  return {
    width: Math.max(1, Number(img.naturalWidth || img.width || 1)),
    height: Math.max(1, Number(img.naturalHeight || img.height || 1)),
  };
}

function deriveImageNameFromSource(src: string, fallback = "Image"): string {
  const trimmed = String(src || "").trim();
  if (!trimmed) return fallback;
  if (trimmed.startsWith("data:image/")) return fallback;
  try {
    const parsed = new URL(trimmed, window.location.href);
    const raw = parsed.pathname.split("/").pop() || "";
    const clean = raw.replace(/\.[^.]+$/, "").trim();
    return clean || fallback;
  } catch {
    const raw = trimmed.split("/").pop() || "";
    const clean = raw.replace(/\.[^.]+$/, "").trim();
    return clean || fallback;
  }
}

function scaleImportedPathAnchor(
  anchor: PathAnchorSpec,
  scale: number,
  offsetX: number,
  offsetY: number,
): PathAnchorSpec {
  return {
    x: round2(offsetX + Number(anchor.x || 0) * scale),
    y: round2(offsetY + Number(anchor.y || 0) * scale),
    in: anchor.in
      ? {
        x: round2(offsetX + Number(anchor.in.x || 0) * scale),
        y: round2(offsetY + Number(anchor.in.y || 0) * scale),
      }
      : anchor.in ?? null,
    out: anchor.out
      ? {
        x: round2(offsetX + Number(anchor.out.x || 0) * scale),
        y: round2(offsetY + Number(anchor.out.y || 0) * scale),
      }
      : anchor.out ?? null,
    mode: anchor.mode === "smooth" ? "smooth" : "corner",
  };
}

function scaleImportedTransformMatrix(
  transformMatrix: Record<string, number> | null | undefined,
  scale: number,
  offsetX: number,
  offsetY: number,
): Record<string, number> | null {
  if (!transformMatrix || typeof transformMatrix !== "object") return null;
  const a = Number(transformMatrix.a);
  const b = Number(transformMatrix.b);
  const c = Number(transformMatrix.c);
  const d = Number(transformMatrix.d);
  const e = Number(transformMatrix.e);
  const f = Number(transformMatrix.f);
  if (![a, b, c, d, e, f].every(Number.isFinite)) return null;
  return {
    a: round2(a),
    b: round2(b),
    c: round2(c),
    d: round2(d),
    e: round2(Number(offsetX || 0) + Number(scale || 1) * e - a * Number(offsetX || 0) - c * Number(offsetY || 0)),
    f: round2(Number(offsetY || 0) + Number(scale || 1) * f - b * Number(offsetX || 0) - d * Number(offsetY || 0)),
  };
}

function scaleImportedEffects(
  effects: PinselaLayerEffect[] | null | undefined,
  scale: number,
): PinselaLayerEffect[] {
  if (!Array.isArray(effects) || !effects.length) return [];
  return effects.map((effect) => ({
    ...effect,
    x: effect.x != null ? round2(Number(effect.x || 0) * scale) : effect.x,
    y: effect.y != null ? round2(Number(effect.y || 0) * scale) : effect.y,
    blur: effect.blur != null ? round2(Math.max(0, Number(effect.blur || 0) * scale)) : effect.blur,
    radius: effect.radius != null ? round2(Math.max(0, Number(effect.radius || 0) * scale)) : effect.radius,
    spread: effect.spread != null ? round2(Number(effect.spread || 0) * scale) : effect.spread,
  }));
}

function buildNodeFromImportedVectorElement(
  element: ImportedVectorElement,
  options: {
    scale: number;
    offsetX: number;
    offsetY: number;
    parentId: string;
  },
): PinselaNode | null {
  const scale = Math.max(0.0001, Number(options.scale || 1));
  const offsetX = Number(options.offsetX || 0);
  const offsetY = Number(options.offsetY || 0);
  const scaledTransformMatrix = scaleImportedTransformMatrix((element as any).transformMatrix || null, scale, offsetX, offsetY);
  const scaledEffects = scaleImportedEffects((element as any).effects || [], scale);

  if (element.kind === "path") {
    const anchors = element.anchors.map((anchor) => scaleImportedPathAnchor(anchor, scale, offsetX, offsetY));
    const scaledSubpaths = Array.isArray(element.subpaths) && element.subpaths.length
      ? element.subpaths.map((subpath) => ({
          closed: subpath.closed,
          anchors: subpath.anchors.map((anchor) => scaleImportedPathAnchor(anchor, scale, offsetX, offsetY)),
        })).filter((subpath) => subpath.anchors.length >= 2)
      : undefined;
    if ((!scaledSubpaths || !scaledSubpaths.length) && anchors.length < 2) return null;
    const strokeWidth = element.strokeWidth != null ? Math.max(0.2, Number(element.strokeWidth || 0) * scale) : undefined;
    const sourceStyle: Partial<PinselaNode["style"]> = {
      fill: element.fill,
      opacity: clampRange(Number(element.opacity), 0, 1, 1),
      effects: scaledEffects,
      stroke: element.strokeColor
        ? {
          color: element.strokeColor,
          width: round2(strokeWidth || 1),
          dash: (element.strokeDash || []).map((segment) => round2(Math.max(0.2, Number(segment || 0) * scale))),
          cap: element.strokeCap || "round",
          join: element.strokeJoin || "round",
          miter_limit: round2(Math.max(0.2, Number(element.strokeMiterLimit || 4))),
        }
        : null,
    };
    return buildPathNodeFromAnchors(anchors, {
      closed: element.closed,
      name: element.name || "SVG_PATH",
      parentId: options.parentId,
      subpaths: scaledSubpaths,
      fillRule: element.fillRule,
      sourceStyle,
      forceTransparentFill: element.forceTransparentFill || !element.closed,
      strokeColor: element.strokeColor,
      strokeWidth,
    });
  }

  if (element.kind === "text") {
    const baseText = defaultNode("text");
    const fontSize = Math.max(6, Number(element.fontSize || 16) * scale);
    const width = Math.max(6, Number(element.width || 0) * scale);
    const height = Math.max(fontSize * 1.1, Number(element.height || 0) * scale);
    const strokeWidth = element.strokeWidth != null ? Math.max(0.2, Number(element.strokeWidth || 0) * scale) : undefined;
    return {
      ...baseText,
      name: element.name || "SVG_TEXT",
      parent_id: options.parentId,
      geometry: {
        ...baseText.geometry,
        x: round2(offsetX + Number(element.x || 0) * scale),
        y: round2(offsetY + Number(element.y || 0) * scale),
        width: round2(width),
        height: round2(height),
        rotation: round2(Number(element.rotation || 0)),
        corner_radius: 0,
        clip: false,
        transform_matrix: scaledTransformMatrix,
      },
      style: {
        ...baseText.style,
        opacity: clampRange(Number(element.opacity), 0, 1, 1),
        fill: null,
        effects: scaledEffects,
        stroke: element.strokeColor
          ? {
            color: element.strokeColor,
            width: round2(strokeWidth || 1),
            dash: (element.strokeDash || []).map((segment) => round2(Math.max(0.2, Number(segment || 0) * scale))),
            cap: element.strokeCap || "round",
            join: element.strokeJoin || "round",
            miter_limit: round2(Math.max(0.2, Number(element.strokeMiterLimit || 4))),
          }
          : null,
      },
      text: String(element.content || ""),
      text_model: "rich",
      text_style: {
        ...(baseText.text_style || {}),
        family: String(element.fontFamily || "sans-serif"),
        style: String(element.fontStyle || "Regular"),
        postscript: buildTextPostscriptName(String(element.fontFamily || "sans-serif"), String(element.fontStyle || "Regular")),
        size: round2(fontSize),
        line_height: round2(clampRange(Number(element.lineHeightPercent || 120), 40, 400, 120)),
        line_height_unit: "percent",
        letter_spacing: round2(Number(element.letterSpacing || 0) * scale),
        text_align: element.textAlign || "left",
        vertical_align: "top",
        color: element.color || "#111111",
        underline: Boolean(element.underline),
      },
      text_runs: Array.isArray(element.textRuns)
        ? element.textRuns.map((run) => ({
            start: Number(run.start || 0),
            end: Number(run.end || 0),
            style: { ...(run.style || {}) },
          }))
        : [],
      text_path: element.textPath || null,
      editable: true,
    };
  }

  if (element.kind === "image") {
    const src = String(element.src || "").trim();
    if (!src) return null;
    const kind = element.useFrame ? "frame" : "image";
    const node = defaultNode(kind, {
      name: element.name || "SVG_IMAGE",
      parent_id: options.parentId,
      geometry: {
        x: round2(offsetX + Number(element.x || 0) * scale),
        y: round2(offsetY + Number(element.y || 0) * scale),
        width: round2(Math.max(2, Number(element.width || 0) * scale)),
        height: round2(Math.max(2, Number(element.height || 0) * scale)),
        rotation: round2(Number(element.rotation || 0)),
        corner_radius: round2(Math.max(0, Number(element.cornerRadius || 0) * scale)),
        clip: true,
        z_index: 0,
        transform_matrix: scaledTransformMatrix,
      },
      image_src: src,
      editable: true,
    });
    return {
      ...node,
      style: {
        ...node.style,
        opacity: clampRange(Number(element.opacity), 0, 1, 1),
        fill: kind === "frame" ? "rgba(0,0,0,0)" : node.style.fill,
        effects: scaledEffects,
        image_fit: element.fit || node.style.image_fit,
      },
    };
  }

  return null;
}

function buildImportedGroupClipPathNode(
  clipPath: ImportedVectorPathElement,
  options: {
    scale: number;
    offsetX: number;
    offsetY: number;
    parentId: string | null;
    id?: string;
    name?: string;
    childIds?: string[];
  },
): PinselaNode | null {
  const built = buildNodeFromImportedVectorElement(
    {
      ...clipPath,
      kind: "path",
      name: options.name || clipPath.name || "SVG_CLIP_PATH",
      fill: "#ffffff",
      forceTransparentFill: false,
      opacity: 1,
      strokeColor: undefined,
      strokeWidth: undefined,
      strokeDash: [],
      effects: [],
    },
    {
      scale: options.scale,
      offsetX: options.offsetX,
      offsetY: options.offsetY,
      parentId: options.parentId || "",
    },
  );
  if (!built || built.kind !== "path") return null;
  return {
    ...built,
    id: options.id || built.id,
    name: options.name || built.name,
    parent_id: options.parentId || null,
    children_ids: Array.isArray(options.childIds) ? options.childIds : built.children_ids,
    geometry: {
      ...built.geometry,
      clip: true,
      z_index: 0,
    },
    style: {
      ...built.style,
      visible: false,
      opacity: 1,
      fill: "#ffffff",
      stroke: null,
      effects: [],
    },
    editable: false,
  };
}

function normalizeImportedGroupContexts(element: ImportedVectorElement): ImportedSvgGroupContext[] {
  if (Array.isArray((element as any).groupContexts) && (element as any).groupContexts.length) {
    return ((element as any).groupContexts as ImportedSvgGroupContext[])
      .map((context) => ({
        label: String(context?.label || "").trim(),
        opacity: context?.opacity == null ? undefined : clampRange(Number(context.opacity), 0, 1, 1),
        clipGeometry: context?.clipGeometry || null,
        clipPath: context?.clipPath || null,
      }))
      .filter((context) => context.label);
  }
  const groupPath = Array.isArray((element as any).groupPath) ? ((element as any).groupPath as string[]) : [];
  return groupPath
    .map((label) => String(label || "").trim())
    .filter(Boolean)
    .map((label) => ({ label }));
}

function scaleImportedGroupClipGeometry(
  geometry: ImportedSvgGroupClipGeometry,
  scale: number,
  offsetX: number,
  offsetY: number,
): ImportedSvgGroupClipGeometry {
  return {
    x: round2(offsetX + Number(geometry.x || 0) * scale),
    y: round2(offsetY + Number(geometry.y || 0) * scale),
    width: round2(Math.max(1, Number(geometry.width || 0) * scale)),
    height: round2(Math.max(1, Number(geometry.height || 0) * scale)),
    rotation: round2(Number(geometry.rotation || 0)),
    cornerRadius: round2(Math.max(0, Number(geometry.cornerRadius || 0) * scale)),
    transformMatrix: scaleImportedTransformMatrix(geometry.transformMatrix || null, scale, offsetX, offsetY),
  };
}

function computeImportedNodeBounds(node: PinselaNode): { x: number; y: number; width: number; height: number } | null {
  const geometry = node.geometry || {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  };
  const x = Number(geometry.x || 0);
  const y = Number(geometry.y || 0);
  const width = Number(geometry.width || 0);
  const height = Number(geometry.height || 0);
  if (![x, y, width, height].every(Number.isFinite)) return null;
  return {
    x: width >= 0 ? x : x + width,
    y: height >= 0 ? y : y + height,
    width: Math.max(1, Math.abs(width)),
    height: Math.max(1, Math.abs(height)),
  };
}

function unionImportedBounds(
  current: { x: number; y: number; width: number; height: number } | null,
  next: { x: number; y: number; width: number; height: number } | null,
): { x: number; y: number; width: number; height: number } | null {
  if (!next) return current;
  if (!current) return { ...next };
  const minX = Math.min(current.x, next.x);
  const minY = Math.min(current.y, next.y);
  const maxX = Math.max(current.x + current.width, next.x + next.width);
  const maxY = Math.max(current.y + current.height, next.y + next.height);
  return {
    x: round2(minX),
    y: round2(minY),
    width: round2(Math.max(1, maxX - minX)),
    height: round2(Math.max(1, maxY - minY)),
  };
}

function importedPathMergeSignature(node: PinselaNode): string | null {
  if (node.kind !== "path") return null;
  return JSON.stringify({
    parent: node.parent_id || "",
    fillRule: node.path_data?.fill_rule || "nonzero",
    fill: node.style?.fill ?? null,
    opacity: round2(Number(node.style?.opacity ?? 1)),
    stroke: node.style?.stroke ?? null,
    strokes: node.style?.strokes ?? null,
    effects: node.style?.effects ?? [],
    transform: node.geometry?.transform_matrix ?? null,
  });
}

function mergeImportedPathNodes(nodes: PinselaNode[]): PinselaNode[] {
  const merged: PinselaNode[] = [];
  for (const node of nodes) {
    const previous = merged[merged.length - 1] || null;
    const previousSignature = previous ? importedPathMergeSignature(previous) : null;
    const nextSignature = importedPathMergeSignature(node);
    if (!previous || !previousSignature || !nextSignature || previousSignature !== nextSignature) {
      merged.push(node);
      continue;
    }
    const previousSubpaths = getPathSubpaths(previous.path_data || null);
    const nextSubpaths = getPathSubpaths(node.path_data || null);
    if (!previousSubpaths.length || !nextSubpaths.length) {
      merged.push(node);
      continue;
    }
    const combinedSubpaths = [
      ...previousSubpaths.map((subpath) => ({ closed: subpath.closed, points: subpath.points.map((point) => ({ ...point })) })),
      ...nextSubpaths.map((subpath) => ({ closed: subpath.closed, points: subpath.points.map((point) => ({ ...point })) })),
    ];
    const mergedBounds = unionImportedBounds(computeImportedNodeBounds(previous), computeImportedNodeBounds(node));
    merged[merged.length - 1] = {
      ...previous,
      geometry: mergedBounds
        ? {
            ...previous.geometry,
            x: mergedBounds.x,
            y: mergedBounds.y,
            width: mergedBounds.width,
            height: mergedBounds.height,
          }
        : previous.geometry,
      path_data: {
        closed: combinedSubpaths[0]?.closed || false,
        points: combinedSubpaths[0]?.points || [],
        subpaths: combinedSubpaths,
        fill_rule: previous.path_data?.fill_rule || node.path_data?.fill_rule || "nonzero",
      },
    };
  }
  return merged;
}

function canNodeHostImageCrop(node: PinselaNode | null | undefined): node is PinselaNode {
  if (!node) return false;
  if (node.kind !== "image" && node.kind !== "frame") return false;
  return String(node.image_src || "").trim().length > 0;
}

function resolveNodeImageDimensions(
  node: PinselaNode,
  imageCache: Map<string, HTMLImageElement>,
): { width: number; height: number } {
  const src = String(node.image_src || "").trim();
  const cached = src ? imageCache.get(src) : null;
  const width = Number(cached?.naturalWidth || cached?.width || node.geometry.width || 1);
  const height = Number(cached?.naturalHeight || cached?.height || node.geometry.height || 1);
  return {
    width: Math.max(1, Math.round(width || 1)),
    height: Math.max(1, Math.round(height || 1)),
  };
}

function resolveDefaultCropForNode(
  node: PinselaNode,
  imageCache: Map<string, HTMLImageElement>,
): { x: number; y: number; width: number; height: number; imageWidth: number; imageHeight: number } {
  const image = resolveNodeImageDimensions(node, imageCache);
  const existing = node.style?.image_crop;
  if (existing && Number(existing.width) > 0 && Number(existing.height) > 0) {
    const width = Math.max(1, Math.min(image.width, Math.round(Number(existing.width || image.width))));
    const height = Math.max(1, Math.min(image.height, Math.round(Number(existing.height || image.height))));
    const x = Math.max(0, Math.min(image.width - width, Math.round(Number(existing.x || 0))));
    const y = Math.max(0, Math.min(image.height - height, Math.round(Number(existing.y || 0))));
    return { x, y, width, height, imageWidth: image.width, imageHeight: image.height };
  }
  return {
    x: 0,
    y: 0,
    width: image.width,
    height: image.height,
    imageWidth: image.width,
    imageHeight: image.height,
  };
}

function patchNodeById(
  doc: PinselaTemplateDocV1,
  nodeId: string,
  mutator: (node: PinselaNode) => PinselaNode,
): PinselaTemplateDocV1 {
  return {
    ...doc,
    nodes: doc.nodes.map((node) => (node.id === nodeId ? mutator(node) : node)),
  };
}

function buildBackgroundRemovedImageName(name: string | null | undefined): string {
  const base = String(name || "").trim().replace(/\.[^.]+$/, "");
  if (!base) return "Image with no background";
  return base.toLowerCase().endsWith(" no background") ? base : `${base} no background`;
}

function describeAsyncActionError(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    const message = String(error.message || "").trim();
    if (message) return message;
  }
  if (typeof error === "string" && error.trim()) return error.trim();
  return fallback;
}

function isFrameDropTargetCandidate(
  doc: PinselaTemplateDocV1,
  node: PinselaNode,
): boolean {
  if (node.kind !== "frame") return false;
  if (node.id === doc.root_id) return false;
  if (node.style?.locked) return false;
  if (isAutoLayoutContainerNode(node)) return false;
  const canvasArea = Math.max(1, Number(doc.canvas?.width || 1) * Number(doc.canvas?.height || 1));
  const frameWidth = Math.max(0, Number(node.geometry.width || 0));
  const frameHeight = Math.max(0, Number(node.geometry.height || 0));
  if (frameWidth <= 0 || frameHeight <= 0) return false;
  const areaRatio = (frameWidth * frameHeight) / canvasArea;
  const coversCanvas = frameWidth >= Number(doc.canvas?.width || 1) * 0.88
    && frameHeight >= Number(doc.canvas?.height || 1) * 0.88;
  if (areaRatio >= 0.82 || coversCanvas) return false;
  return true;
}

function buildTextPostscriptName(family: string, style: string): string {
  const familyToken = String(family || "").replace(/[^a-z0-9]+/gi, "");
  const styleToken = String(style || "Regular").replace(/[^a-z0-9]+/gi, "") || "Regular";
  return `${familyToken}-${styleToken}`;
}

function buildTextFitRule(startSize: number): PinselaTextFitRule {
  const size = Math.max(6, Math.round(Number(startSize || 42)));
  return {
    start_size: size,
    min_size: 6,
    max_lines: null,
    min_lines: null,
    truncate_mode: "none",
  };
}

function buildImageNodeFromRasterPiece(piece: RasterizedPiece, name: string): PinselaNode {
  return defaultNode("image", {
    name,
    geometry: {
      x: Math.round(piece.x),
      y: Math.round(piece.y),
      width: Math.max(1, Math.round(piece.width)),
      height: Math.max(1, Math.round(piece.height)),
      rotation: 0,
      corner_radius: 0,
      clip: true,
      z_index: 0,
    },
    image_src: piece.dataUrl,
    style: {
      ...defaultNode("image").style,
      fill: "rgba(0,0,0,0)",
      stroke: null,
      image_fit: "fill",
      image_crop: null,
    },
  });
}

function fontFamilySupportsItalic(family: string): boolean {
  // Derive from the registered faces (manifest), not document.fonts.check —
  // check() returns true for browser-synthesized obliques, so it falsely
  // enabled Italic for fonts with no italic file (e.g. Poppins display weights -> faux slant).
  const entry = findFontFamilyEntry(String(family || "").trim());
  if (!entry) return false;
  return entry.variants.some((v) => v.italic);
}

function upsertSelectedTextStyle(
  patch: Partial<{
    family: string;
    size: number;
    line_height: number;
    letter_spacing: number;
    color: unknown;
    style: string;
    underline: boolean;
    text_align: "left" | "center" | "right" | "justify";
  }>,
  engine: ReturnType<typeof useEditorEngine>,
) {
  engine.patchSelectedNode((node) => {
    if (node.kind !== "text") return node;
    const nextTextStyle = {
      ...(node.text_style || {}),
      ...(patch.family ? { family: patch.family } : {}),
      ...(patch.size != null ? { size: patch.size } : {}),
      ...(patch.line_height != null ? { line_height: patch.line_height } : {}),
      ...(patch.letter_spacing != null ? { letter_spacing: patch.letter_spacing } : {}),
      ...(patch.color !== undefined ? { color: patch.color } : {}),
      ...(patch.style ? { style: patch.style } : {}),
      ...(patch.underline != null ? { underline: patch.underline as any } : {}),
      ...(patch.text_align ? { text_align: patch.text_align } : {}),
    };
    const nextFit = patch.size != null && node.fit
      ? {
          ...node.fit,
          start_size: Math.max(6, Math.round(Number(patch.size || 6))),
          min_size: Math.min(
            Math.max(1, Number(node.fit.min_size || 6)),
            Math.max(6, Math.round(Number(patch.size || 6))),
          ),
        }
      : node.fit;
    // Re-hug the box height when size or line-height changes on an auto-height
    // (non-`fit`) text node — otherwise the box keeps its old height and lower
    // lines get clipped/hidden (looked like data loss). Mirrors the typing and
    // side-handle resize paths (grow AND shrink to the content height).
    let nextGeometry = node.geometry;
    const heightAffecting = patch.size != null || patch.line_height != null;
    if (heightAffecting && !node.fit) {
      try {
        const measured = computeInlineTextMetrics({ ...node, text_style: nextTextStyle });
        if (Number.isFinite(measured.contentHeight) && measured.contentHeight > 0) {
          nextGeometry = { ...node.geometry, height: Math.round(measured.contentHeight) };
        }
      } catch {
        // measurement unavailable (no canvas ctx) — leave height untouched
      }
    }
    return { ...node, text_style: nextTextStyle, fit: nextFit, geometry: nextGeometry };
  });
}

function moveLayerByListOrder(
  doc: PinselaTemplateDocV1,
  sourceIds: string[],
  targetId: string,
  placement: "before" | "after",
): PinselaTemplateDocV1 {
  const normalizedSourceIds = Array.from(new Set(
    (Array.isArray(sourceIds) ? sourceIds : [])
      .map((id) => String(id || "").trim())
      .filter(Boolean),
  ));
  const normalizedTargetId = String(targetId || "").trim();
  if (!normalizedSourceIds.length || !normalizedTargetId) return doc;
  if (normalizedSourceIds.includes(normalizedTargetId)) return doc;
  const sourceBranchIds = new Set(expandSelectionWithDescendants(doc, normalizedSourceIds));
  if (!sourceBranchIds.size) return doc;
  if (sourceBranchIds.has(normalizedTargetId)) return doc;
  const targetNode = doc.nodes.find((node) => node.id === normalizedTargetId);
  if (!targetNode) return doc;

  if (isAutoLayoutContainerNode(targetNode)) {
    return reparentNodesToContainer(
      doc,
      normalizedSourceIds,
      targetNode.id,
      { placement: placement === "before" ? "start" : "end" },
    );
  }

  const targetParentId = String(targetNode.parent_id || "").trim();
  if (targetParentId) {
    const targetParent = doc.nodes.find((node) => node.id === targetParentId);
    if (targetParent && isAutoLayoutContainerNode(targetParent)) {
      return reparentNodesToContainer(
        doc,
        normalizedSourceIds,
        targetParent.id,
        { placement, referenceId: targetNode.id },
      );
    }
  }

  const layersFrontToBack = [...doc.nodes]
    .filter((n) => n.id !== doc.root_id)
    .sort((a, b) => Number(b.geometry.z_index || 0) - Number(a.geometry.z_index || 0));

  const movingBlock = layersFrontToBack.filter((n) => sourceBranchIds.has(n.id));
  if (!movingBlock.length) return doc;
  const nextFrontToBack = layersFrontToBack.filter((n) => !sourceBranchIds.has(n.id));
  const targetIndexAfterRemoval = nextFrontToBack.findIndex((n) => n.id === normalizedTargetId);
  if (targetIndexAfterRemoval < 0) return doc;

  const insertIndex = placement === "before" ? targetIndexAfterRemoval : targetIndexAfterRemoval + 1;
  nextFrontToBack.splice(
    Math.max(0, Math.min(nextFrontToBack.length, insertIndex)),
    0,
    ...movingBlock,
  );

  const zById = new Map<string, number>();
  const backToFront = [...nextFrontToBack].reverse();
  for (let i = 0; i < backToFront.length; i += 1) {
    zById.set(backToFront[i].id, i + 1);
  }

  return {
    ...doc,
    nodes: doc.nodes.map((n) => (
      n.id === doc.root_id || !zById.has(n.id)
        ? n
        : { ...n, geometry: { ...n.geometry, z_index: zById.get(n.id)! } }
    )),
  };
}

function resizeSelectionFromBounds(
  doc: PinselaTemplateDocV1,
  selectedIds: string[],
  originalBounds: { x: number; y: number; w: number; h: number },
  nextBounds: { x: number; y: number; w: number; h: number },
  handle?: string,
): PinselaTemplateDocV1 {
  if (!selectedIds.length) return doc;

  // Single rotated node → resize in its local frame so only the dragged edge
  // changes and the opposite corner stays anchored. The generic AABB mapping
  // below visibly "moves all sides" once a node is rotated. We recover the world
  // drag delta from how the AABB's dragged edge moved.
  if (selectedIds.length === 1 && handle) {
    const only = doc.nodes.find((n) => n.id === selectedIds[0]);
    const rotation = Number(only?.geometry?.rotation || 0);
    if (only && Math.abs(rotation) > 0.001) {
      const movesLeft = handle === "tl" || handle === "ml" || handle === "bl";
      const movesRight = handle === "tr" || handle === "mr" || handle === "br";
      const movesTop = handle === "tl" || handle === "tc" || handle === "tr";
      const movesBottom = handle === "bl" || handle === "bc" || handle === "br";
      const worldDx = movesRight
        ? (Number(nextBounds.x) + Number(nextBounds.w)) - (Number(originalBounds.x) + Number(originalBounds.w))
        : movesLeft ? Number(nextBounds.x) - Number(originalBounds.x) : 0;
      const worldDy = movesBottom
        ? (Number(nextBounds.y) + Number(nextBounds.h)) - (Number(originalBounds.y) + Number(originalBounds.h))
        : movesTop ? Number(nextBounds.y) - Number(originalBounds.y) : 0;
      const g = only.geometry;
      const oldW = Math.max(0.0001, Number(g.width || 1));
      const oldH = Math.max(0.0001, Number(g.height || 1));
      const resized = resizeRotatedBox(
        { x: Number(g.x || 0), y: Number(g.y || 0), width: oldW, height: oldH },
        rotation,
        handle as RotatedResizeHandle,
        worldDx,
        worldDy,
        { minSize: 4 },
      );
      const newW = Math.max(4, Math.round(resized.width));
      const newH = Math.max(4, Math.round(resized.height));
      // Carry the same per-node transforms the generic path applies, so rotated
      // path/vector nodes scale their geometry, corner radius scales, and rotated
      // text corner-resize scales its font — matching the unrotated behaviour.
      const sx = newW / oldW;
      const sy = newH / oldH;
      const isCorner = handle === "tl" || handle === "tr" || handle === "bl" || handle === "br";
      const fontScale = Math.sqrt(Math.abs(sx * sy)) || 1;
      const scaledRadius = Number(g.corner_radius || 0) * Math.min(Math.abs(sx), Math.abs(sy));
      const cornerRadius = Math.max(0, Math.min(Math.min(newW, newH) / 2, scaledRadius));
      const pathData = only.kind === "path" ? scaleNodePathData(only.path_data, sx, sy) : only.path_data;
      let textScalePatch: Partial<PinselaNode> = {};
      if (only.kind === "text" && isCorner && !only.fit && Math.abs(fontScale - 1) > 0.001) {
        const ts = (only.text_style || {}) as Record<string, unknown>;
        const curSize = Number(ts.size || 0);
        const scaleSize = (v: number) => Math.max(4, Math.round(v * fontScale * 10) / 10);
        if (curSize > 0) {
          textScalePatch = { text_style: { ...only.text_style, size: scaleSize(curSize) } as typeof only.text_style };
        }
        if (Array.isArray(only.text_runs) && only.text_runs.length) {
          (textScalePatch as { text_runs?: typeof only.text_runs }).text_runs = only.text_runs.map((run) => {
            const runSize = Number((run?.style as Record<string, unknown> | undefined)?.size);
            return run && run.style && runSize > 0
              ? { ...run, style: { ...run.style, size: scaleSize(runSize) } }
              : run;
          });
        }
      }
      return patchNodeById(doc, only.id, (n) => ({
        ...n,
        geometry: {
          ...n.geometry,
          x: Math.round(resized.x),
          y: Math.round(resized.y),
          width: newW,
          height: newH,
          corner_radius: Math.round(cornerRadius),
        },
        ...(only.kind === "path" ? { path_data: pathData } : {}),
        ...textScalePatch,
      }));
    }
  }

  const selected = new Set(selectedIds);
  const ow = Math.max(0.0001, Number(originalBounds.w || 0));
  const oh = Math.max(0.0001, Number(originalBounds.h || 0));
  const scaleX = Number(nextBounds.w || 0) / ow;
  const scaleY = Number(nextBounds.h || 0) / oh;
  // Corner handles (tl/tr/bl/br) scale text font size with the box (Canva-style);
  // side handles only change the box (text just rewraps at the new width).
  const isCornerHandle = handle === "tl" || handle === "tr" || handle === "bl" || handle === "br";
  const textFontScale = Math.sqrt(Math.abs(scaleX * scaleY)) || 1;

  return {
    ...doc,
    nodes: doc.nodes.map((node) => {
      if (!selected.has(node.id)) return node;

      const g = node.geometry;
      const left = (Number(g.x || 0) - originalBounds.x) / ow;
      const top = (Number(g.y || 0) - originalBounds.y) / oh;
      const right = (Number(g.x || 0) + Number(g.width || 0) - originalBounds.x) / ow;
      const bottom = (Number(g.y || 0) + Number(g.height || 0) - originalBounds.y) / oh;

      const x = nextBounds.x + left * nextBounds.w;
      const y = nextBounds.y + top * nextBounds.h;
      const width = Math.max(4, (right - left) * nextBounds.w);
      const height = Math.max(4, (bottom - top) * nextBounds.h);
      // Free text with a SIDE handle (width changed, no font scale) → auto-height
      // re-hug: recompute the box height for the new wrap width so it keeps hugging.
      let geometryHeight = Math.round(height);
      if (node.kind === "text" && !node.fit && !isCornerHandle) {
        const measured = computeInlineTextMetrics({ ...node, geometry: { ...g, width: Math.round(width), height: Math.round(height) } });
        geometryHeight = Math.max(4, Math.ceil(measured.contentHeight));
      }
      const scaledRadius = Number(g.corner_radius || 0) * Math.min(Math.abs(scaleX), Math.abs(scaleY));
      const cornerRadius = Math.max(0, Math.min(Math.min(width, height) / 2, scaledRadius));
      const baseWidth = Math.max(0.0001, Number(g.width || 0));
      const baseHeight = Math.max(0.0001, Number(g.height || 0));
      const nodeScaleX = width / baseWidth;
      const nodeScaleY = height / baseHeight;

      const pathData = node.kind === "path"
        ? scaleNodePathData(node.path_data, nodeScaleX, nodeScaleY)
        : node.path_data;

      // Corner-resize a (non-auto-fit) text node → scale its font with the box so
      // the text grows/shrinks instead of just reflowing. Side handles leave the
      // font alone (text rewraps at the new width).
      let textScalePatch: Partial<PinselaNode> = {};
      if (node.kind === "text" && isCornerHandle && !node.fit && Math.abs(textFontScale - 1) > 0.001) {
        const ts = (node.text_style || {}) as Record<string, unknown>;
        const curSize = Number(ts.size || 0);
        const scaleSize = (v: number) => Math.max(4, Math.round(v * textFontScale * 10) / 10);
        if (curSize > 0) {
          textScalePatch = { text_style: { ...node.text_style, size: scaleSize(curSize) } as typeof node.text_style };
        }
        if (Array.isArray(node.text_runs) && node.text_runs.length) {
          (textScalePatch as { text_runs?: typeof node.text_runs }).text_runs = node.text_runs.map((run) => {
            const runSize = Number((run?.style as Record<string, unknown> | undefined)?.size);
            return run && run.style && runSize > 0
              ? { ...run, style: { ...run.style, size: scaleSize(runSize) } }
              : run;
          });
        }
      }

      return {
        ...node,
        geometry: {
          ...g,
          x: Math.round(x),
          y: Math.round(y),
          width: Math.round(width),
          height: geometryHeight,
          corner_radius: Math.round(cornerRadius),
        },
        ...(node.kind === "path" ? { path_data: pathData } : {}),
        ...textScalePatch,
      };
    }),
  };
}

function translateSelectionByDelta(
  doc: PinselaTemplateDocV1,
  selectedIds: string[],
  dx: number,
  dy: number,
): PinselaTemplateDocV1 {
  return moveSelection(doc, selectedIds, Math.round(dx), Math.round(dy));
}

function isPointInsideDocCanvas(
  doc: PinselaTemplateDocV1,
  point: { x: number; y: number },
): boolean {
  const width = Math.max(1, Number(doc.canvas?.width || 1));
  const height = Math.max(1, Number(doc.canvas?.height || 1));
  const x = Number(point.x || 0);
  const y = Number(point.y || 0);
  return x >= 0 && x <= width && y >= 0 && y <= height;
}

function isBoundsFullyInsideDocCanvas(
  doc: PinselaTemplateDocV1,
  bounds: { x: number; y: number; w: number; h: number },
): boolean {
  const width = Math.max(1, Number(doc.canvas?.width || 1));
  const height = Math.max(1, Number(doc.canvas?.height || 1));
  const x1 = Number(bounds.x || 0);
  const y1 = Number(bounds.y || 0);
  const x2 = x1 + Math.max(0, Number(bounds.w || 0));
  const y2 = y1 + Math.max(0, Number(bounds.h || 0));
  const epsilon = 0.5;
  return x1 >= -epsilon && y1 >= -epsilon && x2 <= width + epsilon && y2 <= height + epsilon;
}

function uniqueNodeIdList(ids: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const rawId of ids) {
    const id = String(rawId || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function createUniqueRecordKey(baseKey: string, record: Record<string, unknown>): string {
  const base = String(baseKey || "").trim() || "field";
  if (!(base in record)) return base;
  let attempt = 2;
  while (attempt < 10_000) {
    const candidate = `${base}_${attempt}`;
    if (!(candidate in record)) return candidate;
    attempt += 1;
  }
  return `${base}_${Date.now()}`;
}

function sanitizeProjectPageDocReferences(doc: PinselaTemplateDocV1): PinselaTemplateDocV1 {
  const alive = new Set((doc.nodes || []).map((node) => node.id));
  const bindings = {
    text: Object.fromEntries(
      Object.entries(doc.bindings?.text || {})
        .filter(([, binding]) => alive.has(String(binding?.node_id || ""))),
    ),
    images_single: Object.fromEntries(
      Object.entries(doc.bindings?.images_single || {})
        .filter(([, binding]) => alive.has(String(binding?.node_id || ""))),
    ),
    images_array: Object.fromEntries(
      Object.entries(doc.bindings?.images_array || {})
        .map(([key, binding]) => [
          key,
          {
            ...(binding || {}),
            node_ids: uniqueNodeIdList((binding?.node_ids || []).filter((id) => alive.has(String(id || "")))),
          },
        ])
        .filter(([, binding]) => ((binding as { node_ids?: string[] }).node_ids || []).length > 0),
    ),
    product_frames:
      doc.bindings?.product_frames && Array.isArray(doc.bindings.product_frames.node_ids)
        ? {
          ...doc.bindings.product_frames,
          node_ids: uniqueNodeIdList(doc.bindings.product_frames.node_ids.filter((id) => alive.has(String(id || "")))),
        }
        : null,
  };
  return {
    ...doc,
    nodes: (doc.nodes || []).map((node) => ({
      ...node,
      parent_id: node.parent_id && alive.has(node.parent_id) ? node.parent_id : null,
      children_ids: uniqueNodeIdList((node.children_ids || []).filter((childId) => alive.has(String(childId || "")))),
    })),
    bindings,
    dynamic_rules: (doc.dynamic_rules || [])
      .map((rule) => ({
        ...rule,
        item_ids: Array.isArray(rule.item_ids)
          ? uniqueNodeIdList(rule.item_ids.filter((id) => alive.has(String(id || ""))))
          : rule.item_ids,
      }))
      .filter((rule) => !rule.container_id || alive.has(String(rule.container_id))),
  };
}

function moveSelectionBetweenProjectPageDocs(
  sourceDoc: PinselaTemplateDocV1,
  targetDoc: PinselaTemplateDocV1,
  selectedIds: string[],
  dx: number,
  dy: number,
): {
  sourceDoc: PinselaTemplateDocV1;
  targetDoc: PinselaTemplateDocV1;
  selectionIds: string[];
} {
  const requestedIds = uniqueNodeIdList(selectedIds).filter((id) => id !== sourceDoc.root_id);
  if (!requestedIds.length) {
    return { sourceDoc, targetDoc, selectionIds: [] };
  }
  const expandedIds = expandSelectionWithDescendants(sourceDoc, requestedIds)
    .filter((id) => id !== sourceDoc.root_id);
  const expandedSet = new Set(expandedIds);
  if (!expandedSet.size) {
    return { sourceDoc, targetDoc, selectionIds: [] };
  }

  const sourceNodes = (sourceDoc.nodes || []).filter((node) => expandedSet.has(node.id));
  if (!sourceNodes.length) {
    return { sourceDoc, targetDoc, selectionIds: [] };
  }

  const usedTargetIds = new Set((targetDoc.nodes || []).map((node) => node.id));
  const idMap = new Map<string, string>();
  for (const node of sourceNodes) {
    if (!usedTargetIds.has(node.id)) {
      idMap.set(node.id, node.id);
      usedTargetIds.add(node.id);
      continue;
    }
    let nextId = uid(node.kind);
    while (usedTargetIds.has(nextId)) {
      nextId = uid(node.kind);
    }
    idMap.set(node.id, nextId);
    usedTargetIds.add(nextId);
  }

  const offsetX = Math.round(dx);
  const offsetY = Math.round(dy);
  const maxTargetZ = Math.max(0, ...(targetDoc.nodes || []).map((node) => Number(node.geometry?.z_index || 0)));
  const movedNodes = sourceNodes.map((node, index) => {
    const cloned = cloneDoc(node);
    const parentId = node.parent_id && expandedSet.has(node.parent_id)
      ? (idMap.get(node.parent_id) || null)
      : targetDoc.root_id;
    return {
      ...cloned,
      id: idMap.get(node.id) || node.id,
      parent_id: parentId,
      children_ids: uniqueNodeIdList(
        (node.children_ids || [])
          .map((childId) => (expandedSet.has(childId) ? idMap.get(childId) : null)),
      ),
      geometry: {
        ...cloned.geometry,
        x: Math.round(Number(cloned.geometry?.x || 0) + offsetX),
        y: Math.round(Number(cloned.geometry?.y || 0) + offsetY),
        z_index: maxTargetZ + index + 1,
      },
    };
  });
  const movedRootChildIds = movedNodes
    .filter((node) => node.parent_id === targetDoc.root_id)
    .map((node) => node.id);

  const targetBindings: PinselaTemplateDocV1["bindings"] = {
    text: { ...(targetDoc.bindings?.text || {}) },
    images_single: { ...(targetDoc.bindings?.images_single || {}) },
    images_array: { ...(targetDoc.bindings?.images_array || {}) },
    product_frames: targetDoc.bindings?.product_frames
      ? cloneDoc(targetDoc.bindings.product_frames)
      : null,
  };

  for (const [key, binding] of Object.entries(sourceDoc.bindings?.text || {})) {
    const mappedId = idMap.get(String(binding.node_id || ""));
    if (!mappedId) continue;
    const nextKey = createUniqueRecordKey(key, targetBindings.text as Record<string, unknown>);
    targetBindings.text[nextKey] = { ...cloneDoc(binding), node_id: mappedId };
  }
  for (const [key, binding] of Object.entries(sourceDoc.bindings?.images_single || {})) {
    const mappedId = idMap.get(String(binding.node_id || ""));
    if (!mappedId) continue;
    const nextKey = createUniqueRecordKey(key, targetBindings.images_single as Record<string, unknown>);
    targetBindings.images_single[nextKey] = { ...cloneDoc(binding), node_id: mappedId };
  }
  for (const [key, binding] of Object.entries(sourceDoc.bindings?.images_array || {})) {
    const nodeIds = Array.isArray(binding.node_ids) ? binding.node_ids : [];
    const movedPairs = nodeIds
      .map((nodeId, index) => ({ mappedId: idMap.get(String(nodeId || "")) || "", index }))
      .filter((entry) => entry.mappedId);
    if (!movedPairs.length) continue;
    const nextKey = createUniqueRecordKey(key, targetBindings.images_array as Record<string, unknown>);
    const slotMap = Array.isArray(binding.slot_product_index_map)
      ? movedPairs
        .map((entry) => binding.slot_product_index_map?.[entry.index])
        .filter((entry): entry is number => typeof entry === "number")
      : undefined;
    targetBindings.images_array[nextKey] = {
      ...cloneDoc(binding),
      node_ids: uniqueNodeIdList(movedPairs.map((entry) => entry.mappedId)),
      slot_product_index_map: slotMap && slotMap.length ? slotMap : undefined,
    };
  }
  const movedProductFrameIds = uniqueNodeIdList(
    (sourceDoc.bindings?.product_frames?.node_ids || [])
      .map((nodeId) => idMap.get(String(nodeId || ""))),
  );
  if (movedProductFrameIds.length) {
    targetBindings.product_frames = {
      ...(targetBindings.product_frames || sourceDoc.bindings.product_frames || {}),
      node_ids: uniqueNodeIdList([
        ...((targetBindings.product_frames?.node_ids || []) as string[]),
        ...movedProductFrameIds,
      ]),
    };
  }

  const targetRuleIds = new Set((targetDoc.dynamic_rules || []).map((rule) => String(rule.id || "")));
  const copiedRules = (sourceDoc.dynamic_rules || [])
    .filter((rule) => {
      const refs = [
        String(rule.container_id || ""),
        ...((rule.item_ids || []).map((id) => String(id || ""))),
      ];
      return refs.some((id) => idMap.has(id));
    })
    .map((rule) => {
      const nextRule = cloneDoc(rule);
      const existingId = String(nextRule.id || "").trim();
      nextRule.id = existingId && !targetRuleIds.has(existingId) ? existingId : uid("rule");
      targetRuleIds.add(nextRule.id);
      if (nextRule.container_id) {
        nextRule.container_id = idMap.get(String(nextRule.container_id)) || nextRule.container_id;
      }
      if (Array.isArray(nextRule.item_ids)) {
        nextRule.item_ids = uniqueNodeIdList(nextRule.item_ids.map((id) => idMap.get(String(id || ""))));
      }
      return nextRule;
    });

  const sourceWithoutMoved = removeNodes(sourceDoc, expandedIds);
  const nextTargetDoc = sanitizeProjectPageDocReferences({
    ...targetDoc,
    nodes: [
      ...(targetDoc.nodes || []).map((node) => (
        node.id === targetDoc.root_id
          ? { ...node, children_ids: uniqueNodeIdList([...(node.children_ids || []), ...movedRootChildIds]) }
          : node
      )),
      ...movedNodes,
    ],
    bindings: targetBindings,
    dynamic_rules: [...(targetDoc.dynamic_rules || []), ...copiedRules],
  });

  const remappedSelectionIds = uniqueNodeIdList(requestedIds.map((id) => idMap.get(id)));
  return {
    sourceDoc: sanitizeProjectPageDocReferences(sourceWithoutMoved),
    targetDoc: nextTargetDoc,
    selectionIds: remappedSelectionIds.length ? remappedSelectionIds : movedNodes.map((node) => node.id),
  };
}

function buildSelectionHiddenDoc(
  doc: PinselaTemplateDocV1,
  selectedIds: string[],
): PinselaTemplateDocV1 {
  const hiddenIds = expandSelectionWithDescendants(doc, selectedIds);
  return setSelectionVisible(doc, hiddenIds, false);
}

let sharedInlineTextMeasureContext: CanvasRenderingContext2D | null = null;

function getInlineTextMeasureContext(): CanvasRenderingContext2D | null {
  if (typeof document === "undefined") return null;
  if (sharedInlineTextMeasureContext) return sharedInlineTextMeasureContext;
  const canvas = document.createElement("canvas");
  sharedInlineTextMeasureContext = canvas.getContext("2d");
  return sharedInlineTextMeasureContext;
}

function resolveTextCssStyle(style: Record<string, unknown>) {
  const rawStyle = String(style.style || "Regular").toLowerCase();
  const italic = rawStyle.includes("italic");
  let weight = 400;
  if (rawStyle.includes("thin")) weight = 100;
  else if (rawStyle.includes("extralight") || rawStyle.includes("ultralight")) weight = 200;
  else if (rawStyle.includes("light")) weight = 300;
  else if (rawStyle.includes("medium")) weight = 500;
  else if (rawStyle.includes("semibold") || rawStyle.includes("semi bold") || rawStyle.includes("demibold")) weight = 600;
  else if (rawStyle.includes("extrabold") || rawStyle.includes("extra bold") || rawStyle.includes("ultrabold")) weight = 800;
  else if (rawStyle.includes("black") || rawStyle.includes("heavy")) weight = 900;
  else if (rawStyle.includes("bold")) weight = 700;
  return {
    fontStyle: italic ? "italic" as const : "normal" as const,
    fontWeight: weight,
  };
}

function buildInlineTextFont(style: Record<string, unknown>, fontSize: number): string {
  const cssStyle = resolveTextCssStyle(style);
  const family = String(style.family || "Inter").trim() || "Inter";
  return `${cssStyle.fontStyle === "italic" ? "italic " : ""}${cssStyle.fontWeight} ${Math.max(1, fontSize)}px "${family}", "Arial", sans-serif`;
}

function measureInlineTextWidth(
  ctx: CanvasRenderingContext2D,
  text: string,
  cache?: Map<string, number>,
): number {
  const key = `${ctx.font}::${text}`;
  if (cache?.has(key)) return Number(cache.get(key) || 0);
  const width = ctx.measureText(text).width;
  if (cache) cache.set(key, width);
  return width;
}

function wrapInlineTextLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  cache?: Map<string, number>,
): string[] {
  const parts = String(text || "").split(/\n/g);
  const out: string[] = [];
  const widthLimit = Number.isFinite(maxWidth) && maxWidth > 0 ? maxWidth : Number.POSITIVE_INFINITY;
  for (const part of parts) {
    const tokens = String(part || "").match(/\s+|\S+/g);
    if (!tokens || !tokens.length) {
      out.push("");
      continue;
    }
    let cur = "";
    for (const token of tokens) {
      if (!cur && measureInlineTextWidth(ctx, token, cache) <= widthLimit) {
        cur = token;
        continue;
      }
      const candidate = `${cur}${token}`;
      if (cur && measureInlineTextWidth(ctx, candidate, cache) <= widthLimit) {
        cur = candidate;
        continue;
      }
      if (cur) {
        out.push(cur);
        cur = "";
      }
      if (measureInlineTextWidth(ctx, token, cache) <= widthLimit) {
        cur = token;
        continue;
      }
      for (const ch of token) {
        const chunk = `${cur}${ch}`;
        if (!cur || measureInlineTextWidth(ctx, chunk, cache) <= widthLimit) {
          cur = chunk;
        } else {
          out.push(cur);
          cur = ch;
        }
      }
    }
    out.push(cur);
  }
  return out;
}

function computeInlineTextMetrics(node: PinselaNode): {
  fontSize: number;
  lineHeight: number;
  contentOffsetY: number;
  contentHeight: number;
} {
  const ctx = getInlineTextMeasureContext();
  const geometry = node.geometry || { x: 0, y: 0, width: 0, height: 0 };
  const ts = (node.text_style || {}) as Record<string, unknown>;
  const rawFit = ((node as any).fit && typeof (node as any).fit === "object")
    ? ((node as any).fit as Record<string, unknown>)
    : null;
  const startSize = Number(rawFit?.start_size || ts.size || 24);
  const minSize = rawFit ? Number(rawFit.min_size || Math.max(6, startSize * 0.2)) : startSize;
  const maxLines = Number(rawFit?.max_lines || 0) || undefined;
  const truncate = String(rawFit?.truncate_mode || "none");
  const width = Math.max(1, Number(geometry.width || 1));
  const height = Math.max(1, Number(geometry.height || 1));
  const rawText = String(node.text || "");

  let fontSize = Math.max(1, startSize);
  let lineHeight = String(ts.line_height_unit || "percent") === "percent"
    ? (fontSize * Number(ts.line_height || fontSize * 1.2)) / 100
    : Number(ts.line_height || fontSize * 1.2);
  let lines = rawText.split(/\n/g);

  if (ctx) {
    const metricsCache = new Map<string, number>();
    while (fontSize >= minSize) {
      ctx.font = buildInlineTextFont(ts, fontSize);
      lines = wrapInlineTextLines(ctx, rawText, width, metricsCache);
      const rawLineHeight = Number(ts.line_height || fontSize * 1.2);
      lineHeight = String(ts.line_height_unit || "percent") === "percent"
        ? (fontSize * rawLineHeight) / 100
        : rawLineHeight;
      const fitsHeight = lineHeight * Math.max(1, lines.length) <= height + 0.001;
      const fitsLines = maxLines ? lines.length <= maxLines : true;
      if (!rawFit || (fitsHeight && fitsLines)) break;
      fontSize -= 1;
    }
    if (maxLines && lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      if (truncate === "ellipsis" && lines.length) {
        lines[lines.length - 1] = `${lines[lines.length - 1].replace(/[.\s]+$/g, "")}...`;
      }
    }
  }

  // Leading-trim: hugged box = ascender + (n-1)*lineHeight + descender (same as the
  // painter). For "rich" nodes it keeps the old model (lineHeight*n) — the painter
  // rich was not changed, so the two must match in that case.
  const isRichText = (node as { text_model?: string }).text_model === "rich";
  const contentHeight = isRichText
    ? Math.max(lineHeight, lineHeight * Math.max(1, lines.length))
    : (() => {
        const { ascent, descent } = getFontVerticalMetrics({ ...(node.text_style || {}), size: fontSize });
        return ascent + Math.max(0, lines.length - 1) * lineHeight + descent;
      })();
  const vAlign = String(ts.vertical_align || "top");
  let contentOffsetY = 0;
  if (vAlign === "center") contentOffsetY = Math.max(0, (height - contentHeight) / 2);
  if (vAlign === "bottom") contentOffsetY = Math.max(0, height - contentHeight);
  return {
    fontSize,
    lineHeight,
    contentOffsetY,
    contentHeight,
  };
}

function duplicateSelectionForDrag(
  doc: PinselaTemplateDocV1,
  selectedIds: string[],
): { doc: PinselaTemplateDocV1; duplicatedIds: string[] } {
  if (!selectedIds.length) return { doc, duplicatedIds: [] };
  const expandedSelection = expandSelectionWithDescendants(doc, selectedIds);
  const expandedSet = new Set(expandedSelection);
  const nodeById = new Map(doc.nodes.map((node) => [node.id, node] as const));
  const sourceNodes = doc.nodes
    .filter((node) => expandedSet.has(node.id))
    .map((node) => nodeById.get(node.id) || null)
    .filter((node): node is PinselaNode => !!node);
  if (!sourceNodes.length) return { doc, duplicatedIds: [] };
  const { clones, selectionIds } = cloneNodeGraph(sourceNodes, selectedIds, { unlock: true });
  if (!clones.length) return { doc, duplicatedIds: [] };

  let nextDoc = doc;
  for (const duplicated of clones) {
    nextDoc = addNode(nextDoc, duplicated);
  }

  return {
    doc: nextDoc,
    duplicatedIds: selectionIds,
  };
}

function rotateSelectionByDelta(
  doc: PinselaTemplateDocV1,
  selectedIds: string[],
  deltaDeg: number,
): PinselaTemplateDocV1 {
  if (!selectedIds.length) return doc;
  const selected = new Set(selectedIds);
  return {
    ...doc,
    nodes: doc.nodes.map((node) => (
      selected.has(node.id)
        ? {
          ...node,
          geometry: {
            ...node.geometry,
            rotation: Math.round((Number(node.geometry.rotation || 0) + deltaDeg) * 10) / 10,
          },
        }
        : node
    )),
  };
}

const PROJECT_PAGES_META_KEY = "project_pages_v1";
const PROJECT_PAGE_GAP_DOC = 220;

type ProjectPageRecord = {
  id: string;
  name: string;
  doc: PinselaTemplateDocV1;
  position?: CanvasProjectPagePosition | null;
};

function normalizeProjectPageName(name: string, index: number): string {
  // Older projects stored the Portuguese "Pagina N" / "Página N"; display it as "Page N".
  const trimmed = String(name || "").trim().replace(/^P[aá]gina(?= \d+$)/, "Page");
  return trimmed || `Page ${index + 1}`;
}

function normalizeProjectPagePosition(value: unknown): CanvasProjectPagePosition | null {
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

function getProjectPageDimensions(
  page: Pick<ProjectPageRecord, "doc"> | null | undefined,
  fallbackWidth = 1080,
  fallbackHeight = 1080,
): { width: number; height: number } {
  const width = Math.max(1, Math.round(Number(page?.doc?.canvas?.width || fallbackWidth || 1080)));
  const height = Math.max(1, Math.round(Number(page?.doc?.canvas?.height || fallbackHeight || 1080)));
  return { width, height };
}

function getInitialProjectPagePosition(doc: PinselaTemplateDocV1): CanvasProjectPagePosition {
  const { width, height } = getProjectPageDimensions({ doc });
  return {
    x: -Math.round(width / 2),
    y: -Math.round(height / 2),
  };
}

function ensureProjectPagePositions(
  pages: ProjectPageRecord[],
  layout: CanvasProjectPagesLayout = "column",
): ProjectPageRecord[] {
  let fallbackX = 0;
  let fallbackY = 0;
  let changed = false;
  const nextPages = (Array.isArray(pages) ? pages : []).map((page, index) => {
    const { width, height } = getProjectPageDimensions(page);
    let fallbackPosition: CanvasProjectPagePosition;
    if (layout === "row") {
      fallbackPosition = {
        x: Math.round(index === 0 ? -width / 2 : fallbackX),
        y: -Math.round(height / 2),
      };
      fallbackX = fallbackPosition.x + width + PROJECT_PAGE_GAP_DOC;
    } else {
      fallbackPosition = {
        x: -Math.round(width / 2),
        y: Math.round(index === 0 ? -height / 2 : fallbackY),
      };
      fallbackY = fallbackPosition.y + height + PROJECT_PAGE_GAP_DOC;
    }
    const existingPosition = normalizeProjectPagePosition(page.position);
    if (
      existingPosition
      && existingPosition.x === page.position?.x
      && existingPosition.y === page.position?.y
    ) {
      return page;
    }
    changed = true;
    return {
      ...page,
      position: existingPosition || fallbackPosition,
    };
  });
  return changed ? nextPages : pages;
}

function getProjectPagePosition(page: ProjectPageRecord): CanvasProjectPagePosition {
  return normalizeProjectPagePosition(page.position) || getInitialProjectPagePosition(page.doc);
}

function getAdjacentProjectPagePosition(
  anchorPage: ProjectPageRecord | null | undefined,
  placement: "right" | "below",
): CanvasProjectPagePosition {
  if (!anchorPage) return { x: 0, y: 0 };
  const anchorPosition = getProjectPagePosition(anchorPage);
  const { width, height } = getProjectPageDimensions(anchorPage);
  if (placement === "right") {
    return {
      x: anchorPosition.x + width + PROJECT_PAGE_GAP_DOC,
      y: anchorPosition.y,
    };
  }
  return {
    x: anchorPosition.x,
    y: anchorPosition.y + height + PROJECT_PAGE_GAP_DOC,
  };
}

function buildDuplicatedProjectPageName(baseName: string, existingNames: string[]): string {
  const sourceName = String(baseName || "").trim() || "Page";
  const base = `${sourceName} (copy)`;
  const normalizedExisting = new Set(
    (Array.isArray(existingNames) ? existingNames : [])
      .map((name) => String(name || "").trim().toLowerCase())
      .filter(Boolean),
  );
  if (!normalizedExisting.has(base.toLowerCase())) return base;
  let attempt = 2;
  while (attempt < 10_000) {
    const candidate = `${sourceName} (copy ${attempt})`;
    if (!normalizedExisting.has(candidate.toLowerCase())) return candidate;
    attempt += 1;
  }
  return `${sourceName} (copy ${Date.now()})`;
}

function buildImportedProjectPageName(baseName: string, existingNames: string[]): string {
  const sourceName = String(baseName || "").trim() || "SVG";
  const normalizedExisting = new Set(
    (Array.isArray(existingNames) ? existingNames : [])
      .map((name) => String(name || "").trim().toLowerCase())
      .filter(Boolean),
  );
  if (!normalizedExisting.has(sourceName.toLowerCase())) return sourceName;
  let attempt = 2;
  while (attempt < 10_000) {
    const candidate = `${sourceName} ${attempt}`;
    if (!normalizedExisting.has(candidate.toLowerCase())) return candidate;
    attempt += 1;
  }
  return `${sourceName} ${Date.now()}`;
}

function stripProjectPagesMetadata(doc: PinselaTemplateDocV1): PinselaTemplateDocV1 {
  const metadata = doc.metadata && typeof doc.metadata === "object"
    ? { ...doc.metadata }
    : {};
  if (PROJECT_PAGES_META_KEY in metadata) {
    delete (metadata as Record<string, unknown>)[PROJECT_PAGES_META_KEY];
  }
  return {
    ...doc,
    metadata,
  };
}

function getEmbeddedProjectPagesCount(doc: PinselaTemplateDocV1 | null | undefined): number {
  if (!doc || !doc.metadata || typeof doc.metadata !== "object") return 0;
  const rawPagesEntry = (doc.metadata as Record<string, unknown>)[PROJECT_PAGES_META_KEY];
  if (!rawPagesEntry || typeof rawPagesEntry !== "object") return 0;
  const rawPayload = rawPagesEntry as Record<string, unknown>;
  return Array.isArray(rawPayload.pages) ? rawPayload.pages.length : 0;
}

function getDocContentNodeCount(doc: PinselaTemplateDocV1 | null | undefined): number {
  if (!doc || !Array.isArray(doc.nodes)) return 0;
  const rootId = String(doc.root_id || "root");
  return doc.nodes.filter((node) => String(node?.id || "") !== rootId).length;
}

function getProjectDocContentScore(doc: PinselaTemplateDocV1 | null | undefined): number {
  if (!doc) return 0;
  const metadata = doc.metadata && typeof doc.metadata === "object"
    ? (doc.metadata as Record<string, unknown>)
    : null;
  const rawPagesEntry = metadata?.[PROJECT_PAGES_META_KEY];
  if (rawPagesEntry && typeof rawPagesEntry === "object") {
    const rawPayload = rawPagesEntry as Record<string, unknown>;
    const rawPages = Array.isArray(rawPayload.pages) ? rawPayload.pages : [];
    return rawPages.reduce((score, rawPage) => {
      if (!rawPage || typeof rawPage !== "object") return score;
      const pageDoc = (rawPage as Record<string, unknown>).doc;
      if (!isProjectPageDoc(pageDoc)) return score;
      const nodeCount = getDocContentNodeCount(pageDoc);
      return score + (nodeCount > 0 ? 1000 + nodeCount : 0);
    }, 0);
  }
  return getDocContentNodeCount(doc);
}

function readDocArtboardGuides(doc: PinselaTemplateDocV1 | null | undefined): GuideLine[] {
  const raw = (doc?.metadata as Record<string, unknown> | undefined)?.artboard_guides;
  if (!Array.isArray(raw)) return [];
  const out: GuideLine[] = [];
  for (const g of raw) {
    const axis = (g as GuideLine | null)?.axis;
    const value = Number((g as GuideLine | null)?.value);
    if ((axis === "x" || axis === "y") && Number.isFinite(value)) out.push({ axis, value, source: "grid" });
  }
  return out;
}

function isEffectivelyBlankProjectDoc(doc: PinselaTemplateDocV1 | null | undefined): boolean {
  return getProjectDocContentScore(doc) <= 0;
}

function isProjectPageDoc(value: unknown): value is PinselaTemplateDocV1 {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  if (!entry.canvas || typeof entry.canvas !== "object") return false;
  if (!Array.isArray(entry.nodes)) return false;
  return true;
}

function parseProjectPagesFromDoc(doc: PinselaTemplateDocV1): { pages: ProjectPageRecord[]; activePageId: string } {
  const fallbackDoc = normalizeTextDoc(stripProjectPagesMetadata(doc));
  const fallbackPage: ProjectPageRecord = {
    id: uid("page"),
    name: "Page 1",
    doc: fallbackDoc,
    position: getInitialProjectPagePosition(fallbackDoc),
  };
  const metadata = doc.metadata && typeof doc.metadata === "object"
    ? (doc.metadata as Record<string, unknown>)
    : null;
  const rawPagesEntry = metadata?.[PROJECT_PAGES_META_KEY];
  if (!rawPagesEntry || typeof rawPagesEntry !== "object") {
    return { pages: [fallbackPage], activePageId: fallbackPage.id };
  }

  const rawPayload = rawPagesEntry as Record<string, unknown>;
  const rawPages = Array.isArray(rawPayload.pages) ? rawPayload.pages : [];
  const seenPageIds = new Set<string>();
  const pages: ProjectPageRecord[] = [];
  for (let index = 0; index < rawPages.length; index += 1) {
    const rawPage = rawPages[index];
    if (!rawPage || typeof rawPage !== "object") continue;
    const rawPageObj = rawPage as Record<string, unknown>;
    if (!isProjectPageDoc(rawPageObj.doc)) continue;
    const idRaw = String(rawPageObj.id || "").trim();
    const id = idRaw && !seenPageIds.has(idRaw) ? idRaw : uid("page");
    seenPageIds.add(id);
    pages.push({
      id,
      name: normalizeProjectPageName(String(rawPageObj.name || ""), index),
      doc: normalizeTextDoc(stripProjectPagesMetadata(rawPageObj.doc)),
      position: normalizeProjectPagePosition(rawPageObj.position),
    });
  }

  if (!pages.length) {
    return { pages: [fallbackPage], activePageId: fallbackPage.id };
  }

  const positionedPages = ensureProjectPagePositions(pages);
  const activeRaw = String(rawPayload.active_page_id || "").trim();
  const activePageId = positionedPages.some((page) => page.id === activeRaw) ? activeRaw : positionedPages[0].id;
  return { pages: positionedPages, activePageId };
}

function mergeActiveDocIntoPages(
  pages: ProjectPageRecord[],
  activePageId: string | null,
  activeDoc: PinselaTemplateDocV1,
): ProjectPageRecord[] {
  if (!activePageId) return pages;
  let changed = false;
  const nextPages = pages.map((page) => {
    if (page.id !== activePageId) return page;
    if (page.doc === activeDoc) return page;
    changed = true;
    return {
      ...page,
      doc: activeDoc,
    };
  });
  return changed ? nextPages : pages;
}

function serializeProjectPagesDoc(
  activeDoc: PinselaTemplateDocV1,
  pages: ProjectPageRecord[],
  activePageId: string | null,
): PinselaTemplateDocV1 {
  const activeDocWithoutMeta = stripProjectPagesMetadata(activeDoc);
  const safePages = ensureProjectPagePositions(mergeActiveDocIntoPages(pages, activePageId, activeDocWithoutMeta));
  const pageEntries = (safePages.length ? safePages : [{
    id: uid("page"),
    name: "Page 1",
    doc: activeDocWithoutMeta,
    position: getInitialProjectPagePosition(activeDocWithoutMeta),
  }]).map((page, index) => ({
    id: String(page.id || "").trim() || uid("page"),
    name: normalizeProjectPageName(page.name, index),
    doc: stripProjectPagesMetadata(page.doc),
    position: normalizeProjectPagePosition(page.position) || getInitialProjectPagePosition(page.doc),
  }));
  const resolvedActivePageId = pageEntries.some((page) => page.id === activePageId)
    ? String(activePageId || "")
    : pageEntries[0].id;
  return {
    ...activeDocWithoutMeta,
    metadata: {
      ...(activeDocWithoutMeta.metadata || {}),
      [PROJECT_PAGES_META_KEY]: {
        version: 1,
        active_page_id: resolvedActivePageId,
        pages: pageEntries,
      },
    },
  };
}

function collectAutomationBindingFields(doc: PinselaTemplateDocV1): AutomationBindingField[] {
  const nodes = [...(doc.nodes || [])];
  const nodeById = new Map(nodes.map((node) => [node.id, node] as const));
  const labelByNodeId = new Map<string, string>();

  const rememberLabel = (nodeId: unknown, label: unknown) => {
    const id = String(nodeId || "").trim();
    const value = String(label || "").trim();
    if (!id || !value || labelByNodeId.has(id)) return;
    labelByNodeId.set(id, value);
  };

  for (const [key, binding] of Object.entries(doc.bindings?.text || {})) {
    rememberLabel(binding?.node_id, binding?.label || key);
  }
  for (const [key, binding] of Object.entries(doc.bindings?.images_single || {})) {
    rememberLabel(binding?.node_id, binding?.label || key);
  }
  for (const [key, binding] of Object.entries(doc.bindings?.images_array || {})) {
    const label = String(binding?.label || key || "Image").trim();
    (binding?.node_ids || []).forEach((nodeId, index) => {
      rememberLabel(nodeId, binding?.node_ids?.length > 1 ? `${label} ${index + 1}` : label);
    });
  }
  (doc.bindings?.product_frames?.node_ids || []).forEach((nodeId, index) => {
    rememberLabel(nodeId, `Product ${index + 1}`);
  });

  const childrenByParent = new Map<string | null, PinselaNode[]>();
  for (const node of nodes) {
    const parentId = String(node.parent_id || "").trim();
    const key = parentId && nodeById.has(parentId) ? parentId : null;
    const bucket = childrenByParent.get(key) || [];
    bucket.push(node);
    childrenByParent.set(key, bucket);
  }

  const collectTextDescendants = (containerId: string): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    const walk = (parentId: string) => {
      const children = childrenByParent.get(parentId) || [];
      for (const child of children) {
        if (seen.has(child.id)) continue;
        seen.add(child.id);
        if (child.kind === "text") out.push(child.id);
        walk(child.id);
      }
    };
    walk(containerId);
    return out;
  };

  for (const rule of doc.dynamic_rules || []) {
    if (rule.type !== "auto_layout_content_limit") continue;
    const label = String(rule.binding_key || rule.id || "Rule-bound text").trim();
    const containerId = String(rule.container_id || "").trim();
    if (!containerId || !nodeById.has(containerId)) continue;
    collectTextDescendants(containerId).forEach((nodeId) => rememberLabel(nodeId, label));
  }

  const candidates = nodes
    .filter((node) => {
      if (node.id === doc.root_id) return false;
      if (node.kind !== "text" && node.kind !== "image" && node.kind !== "frame") return false;
      if (labelByNodeId.has(node.id)) return true;
      const name = String(node.name || "").trim();
      if (name) return true;
      if (node.kind === "text") return String(node.text || "").trim().length > 0;
      if (node.kind === "image") return String(node.image_src || "").trim().length > 0;
      return false;
    })
    .sort((a, b) => Number(b.geometry.z_index || 0) - Number(a.geometry.z_index || 0));

  const fields: AutomationBindingField[] = [];
  candidates.forEach((node, index) => {
    const textPreview = node.kind === "text"
      ? String(node.text || "").trim().replace(/\s+/g, " ").slice(0, 42)
      : "";
    const fallbackName = node.kind === "text"
      ? `Text ${index + 1}`
      : node.kind === "frame"
        ? `Frame ${index + 1}`
        : `Image ${index + 1}`;
    const layerName = labelByNodeId.get(node.id)
      || String(node.name || "").trim()
      || textPreview
      || fallbackName;
    fields.push({
      id: node.id,
      layerName,
      kind: node.kind === "text"
        ? "text"
        : node.kind === "frame"
          ? "frame"
          : "image",
    });
  });
  return fields;
}

function mapApiAutomationTemplateSummary(entry: ApiAutomationTemplateSummary): AutomationTemplateSummary {
  return {
    id: String(entry.id || "").trim(),
    name: String(entry.name || "").trim() || "Template",
    sourcePageName: entry.source_page_name || null,
    projectKey: entry.project_key || null,
    bindingCount: Math.max(0, Number(entry.binding_count || 0)),
    createdAt: entry.created_at || null,
    updatedAt: entry.updated_at || null,
  };
}

function mapApiAutomationTemplateDetail(entry: ApiAutomationTemplateDetail): AutomationTemplateDetail {
  const bindingsRaw = Array.isArray(entry.bindings) ? entry.bindings : [];
  const bindings: AutomationBindingField[] = bindingsRaw
    .map((binding) => {
      const kind = String(binding.kind || "").trim().toLowerCase();
      if (kind !== "text" && kind !== "image" && kind !== "frame") return null;
      const id = String(binding.id || "").trim();
      const layerName = String(binding.layer_name || "").trim();
      if (!id || !layerName) return null;
      return {
        id,
        layerName,
        kind,
      } as AutomationBindingField;
    })
    .filter((binding): binding is AutomationBindingField => !!binding);

  const doc = isProjectPageDoc(entry.doc_json)
    ? stripProjectPagesMetadata(entry.doc_json)
    : createEmptyDoc(1080, 1080);

  return {
    id: String(entry.id || "").trim(),
    name: String(entry.name || "").trim() || "Template",
    sourcePageName: entry.source_page_name || null,
    projectKey: entry.project_key || null,
    bindingCount: bindings.length,
    createdAt: entry.created_at || null,
    updatedAt: entry.updated_at || null,
    doc,
    bindings,
  };
}

function readRootCssPx(varName: string, fallback: number): number {
  if (typeof window === "undefined") return fallback;
  const raw = window.getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatFitViewportPadding(options?: { localSandbox?: boolean }): {
  horizontalPadding: number;
  topPadding: number;
  bottomPadding: number;
} {
  if (typeof window !== "undefined" && window.matchMedia("(max-width: 900px)").matches) {
    // On mobile the topbar + launcher strip are in normal flow ABOVE the canvas
    // viewport (.dg-canvas-viewport already starts below them), so we must NOT
    // pad for them again — only for chrome that FLOATS over the viewport: the
    // context toolbar and the bottom toolbelt overlay its lower edge.
    if (options?.localSandbox) {
      const contextToolbar = document.querySelector(".dg-context-toolbar");
      const toolbelt = document.querySelector(".dg-bottom-toolbelt-inner");
      const toolbarHeight = contextToolbar instanceof HTMLElement
        ? contextToolbar.getBoundingClientRect().height
        : 44;
      const toolbeltHeight = toolbelt instanceof HTMLElement
        ? toolbelt.getBoundingClientRect().height
        : 62;
      return {
        horizontalPadding: 16,
        topPadding: 20,
        bottomPadding: Math.max(96, Math.round(toolbeltHeight + toolbarHeight + 24)),
      };
    }
    return {
      horizontalPadding: 24,
      topPadding: 24,
      bottomPadding: 132,
    };
  }

  if (options?.localSandbox) {
    const contextToolbar = document.querySelector(".dg-context-toolbar");
    const toolbelt = document.querySelector(".dg-bottom-toolbelt-inner");
    const toolbarHeight = contextToolbar instanceof HTMLElement
      ? contextToolbar.getBoundingClientRect().height
      : 48;
    const toolbeltHeight = toolbelt instanceof HTMLElement
      ? toolbelt.getBoundingClientRect().height
      : 60;
    return {
      horizontalPadding: 20,
      // +30px reserves room for the page-name label that floats above the page.
      topPadding: Math.max(84, Math.round(toolbarHeight + 46)),
      bottomPadding: Math.max(72, Math.round(toolbeltHeight + 20)),
    };
  }

  const leftRail = readRootCssPx("--width-leftrail", 64);
  const rightRail = readRootCssPx("--width-rightrail", 64);
  const leftPanel = readRootCssPx("--width-leftpanel", 336);
  const rightPanel = readRootCssPx("--width-rightpanel", 336);
  const topbar = readRootCssPx("--height-topbar", 60);
  const sideInset = Math.max(leftRail + leftPanel, rightRail + rightPanel);
  return {
    horizontalPadding: Math.max(84, Math.round(sideInset + 28)),
    topPadding: Math.max(124, Math.round(topbar + 64)),
    bottomPadding: 156,
  };
}

function rendererFitBaseScaleForWidth(containerWidth: number, docWidth: number): number {
  const available = Math.max(320, Number(containerWidth || 0) - 24);
  return Math.max(0.0001, Math.min(1, available / Math.max(1, Number(docWidth || 1))));
}

function rendererZoomForStageScale(containerWidth: number, docWidth: number, stageScale: number): number {
  const fitBase = rendererFitBaseScaleForWidth(containerWidth, docWidth);
  const minZoom = uiPercentToEngineZoom(10);
  const maxZoom = uiPercentToEngineZoom(500);
  const nextZoom = Number(stageScale || 0) / fitBase;
  if (!Number.isFinite(nextZoom)) return uiPercentToEngineZoom(100);
  return Math.max(minZoom, Math.min(maxZoom, nextZoom));
}

const AUTOSAVE_DEBOUNCE_MS = 900;
const CARD_PREVIEW_MIN_INTERVAL_MS = 30_000;
const LOCAL_SANDBOX_AUTOSAVE_DEBOUNCE_MS = 240;
const AUTOMATION_TEMPLATE_CACHE_LIMIT = 8;

function loadWithSoftTimeout<T>(promise: Promise<T | null>, timeoutMs: number): Promise<T | null> {
  return new Promise((resolve) => {
    let settled = false;
    const complete = (value: T | null) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timerId);
      resolve(value);
    };
    const timerId = globalThis.setTimeout(() => complete(null), Math.max(1, Math.round(timeoutMs || 1)));
    promise.then((value) => complete(value ?? null)).catch(() => complete(null));
  });
}

export function PinselaDarkGlassPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { id: routeProjectId, sandboxId, localProjectId } = useParams<{ id?: string; sandboxId?: string; localProjectId?: string }>();
  const isLocalSandbox = isLocalAccountPath(location.pathname);
  const localDevHost = typeof window !== "undefined" && isLocalDevHost(window.location.hostname);
  const remoteBackedLocalEditorPath = isRemoteBackedLocalEditorPath(location.pathname);
  const remoteBackedLocalProjectKey = useMemo(() => {
    if (remoteBackedLocalEditorPath) return getLocalAccountProjectKey(localProjectId);
    return "";
  }, [localProjectId, remoteBackedLocalEditorPath]);
  const isRemoteBackedLocalEditor = Boolean(remoteBackedLocalProjectKey);
  const sandboxConfig = useMemo(() => {
    if (!isRemoteBackedLocalEditor) return getLocalEditorSandboxConfig(sandboxId);
    const key = remoteBackedLocalProjectKey;
    return {
      id: key,
      key,
      name: `${LOCAL_ACCOUNT_DISPLAY_NAME} · ${key}`,
      homePath: "/projects",
      fixtureUrl: null,
    };
  }, [isRemoteBackedLocalEditor, remoteBackedLocalProjectKey, sandboxId]);
  const isCompactViewport = useViewportMatch("(max-width: 900px)");
  const requestedProjectKey = isRemoteBackedLocalEditor
    ? remoteBackedLocalProjectKey
    : isLocalSandbox
      ? sandboxConfig.key
      : (routeProjectId || "");
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [chosenFormat, setChosenFormat] = useState<CanvasFormat | null>(null);
  const [formatPickerMode, setFormatPickerMode] = useState<"initial" | "replace">("initial");
  const [projectPages, setProjectPages] = useState<ProjectPageRecord[]>([]);
  const [activeProjectPageId, setActiveProjectPageId] = useState<string | null>(null);
  const projectPagesRef = useRef<ProjectPageRecord[]>([]);
  const activeProjectPageIdRef = useRef<string | null>(null);
  const projectPagesSnapshotCacheRef = useRef<{
    pages: ProjectPageRecord[] | null;
    activePageId: string | null;
    activeDoc: PinselaTemplateDocV1 | null;
    result: ProjectPageRecord[] | null;
  }>({ pages: null, activePageId: null, activeDoc: null, result: null });
  const [pendingAssetUploads, setPendingAssetUploads] = useState<AssetUploadProgressItem[]>([]);
  const assetUploadProgressTimersRef = useRef<Map<string, number>>(new Map());
  const [pagesGridOpen, setPagesGridOpen] = useState(false);
  const [projectPagesCanvasLayout] = useState<CanvasProjectPagesLayout>("column");
  const [automationTemplates, setAutomationTemplates] = useState<AutomationTemplateSummary[]>([]);
  const editorReady = chosenFormat !== null;

  const { me, loading: authLoading } = useAuth();
  const engine = useEditorEngine();
  const [ctxMenu, setCtxMenu] = useState<{ open: boolean; x: number; y: number }>({ open: false, x: 0, y: 0 });
  const closeCtxMenu = useCallback(() => setCtxMenu((m) => (m.open ? { ...m, open: false } : m)), []);
  const canPasteFromClipboard = useCallback(
    () => engine.clipboardRef.current.nodes.length > 0 || !!readClipboard(),
    [engine.clipboardRef],
  );
  const api = useProjectApi(
    isRemoteBackedLocalEditor
      ? {
          autosaveSyncCurrent: true,
          hidePublish: true,
          hideVersions: true,
          useLocalAssetLibrary: true,
          enableAssets: editorReady,
        }
      : {
          enableAssets: editorReady,
        },
  );
  const localAccountNeedsLogin = isRemoteBackedLocalEditor && !authLoading && !me;
  const [localAccountBannerDismissed, setLocalAccountBannerDismissed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(LOCAL_ACCOUNT_LOGIN_BANNER_DISMISSED_KEY) === "1";
    } catch {
      return false;
    }
  });
  const handleNavigateToLogin = useCallback(() => {
    const next = `${location.pathname}${location.search || ""}`;
    navigate(`/login?next=${encodeURIComponent(next)}`);
  }, [location.pathname, location.search, navigate]);
  const handleDismissLocalAccountBanner = useCallback(() => {
    setLocalAccountBannerDismissed(true);
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(LOCAL_ACCOUNT_LOGIN_BANNER_DISMISSED_KEY, "1");
    } catch {
      // Ignore localStorage failures; the in-memory state is enough for this session.
    }
  }, []);
  const switchingProjectPageRef = useRef(false);
  const automationTemplateCacheRef = useRef<Map<string, AutomationTemplateDetail>>(new Map());
  const markPersistedAfterDocSyncRef = useRef(false);

  React.useEffect(() => {
    projectPagesRef.current = projectPages;
  }, [projectPages]);

  React.useEffect(() => {
    activeProjectPageIdRef.current = activeProjectPageId;
  }, [activeProjectPageId]);

  const clearAssetUploadProgressTimer = useCallback((uploadId: string) => {
    const timer = assetUploadProgressTimersRef.current.get(uploadId);
    if (timer != null) {
      window.clearInterval(timer);
      assetUploadProgressTimersRef.current.delete(uploadId);
    }
  }, []);

  const startAssetUploadProgress = useCallback((uploadId: string) => {
    clearAssetUploadProgressTimer(uploadId);
    const timer = window.setInterval(() => {
      setPendingAssetUploads((current) => current.map((item) => {
        if (item.id !== uploadId || item.status !== "uploading") return item;
        const nextProgress = Math.min(88, Math.max(item.progress + 1, item.progress + Math.round((92 - item.progress) * 0.12)));
        return { ...item, progress: nextProgress };
      }));
    }, 420);
    assetUploadProgressTimersRef.current.set(uploadId, timer);
  }, [clearAssetUploadProgressTimer]);

  const finishAssetUploadProgress = useCallback((uploadId: string, status: "uploaded" | "error", error?: string) => {
    clearAssetUploadProgressTimer(uploadId);
    if (status === "uploaded") {
      setPendingAssetUploads((current) => current.map((item) => (
        item.id === uploadId ? { ...item, progress: 100, status: "uploading" } : item
      )));
      window.setTimeout(() => {
        setPendingAssetUploads((current) => current.filter((item) => item.id !== uploadId));
      }, 900);
      return;
    }
    setPendingAssetUploads((current) => current.map((item) => (
      item.id === uploadId
        ? { ...item, progress: Math.max(5, item.progress), status: "error", error: error || "Upload failed" }
        : item
    )));
  }, [clearAssetUploadProgressTimer]);

  React.useEffect(() => () => {
    assetUploadProgressTimersRef.current.forEach((timer) => window.clearInterval(timer));
    assetUploadProgressTimersRef.current.clear();
  }, []);

  React.useEffect(() => {
    if (localAccountNeedsLogin) return;
    setLocalAccountBannerDismissed(false);
    if (typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(LOCAL_ACCOUNT_LOGIN_BANNER_DISMISSED_KEY);
    } catch {
      // Ignore localStorage cleanup failures.
    }
  }, [localAccountNeedsLogin]);

  const getCachedAutomationTemplate = useCallback((templateId: string): AutomationTemplateDetail | null => {
    const id = String(templateId || "").trim();
    if (!id) return null;
    const cache = automationTemplateCacheRef.current;
    const value = cache.get(id) || null;
    if (!value) return null;
    cache.delete(id);
    cache.set(id, value);
    return value;
  }, [api.supportsAutomations]);

  const setCachedAutomationTemplate = useCallback((templateId: string, template: AutomationTemplateDetail): void => {
    const id = String(templateId || "").trim();
    if (!id) return;
    const cache = automationTemplateCacheRef.current;
    if (cache.has(id)) cache.delete(id);
    cache.set(id, template);
    while (cache.size > AUTOMATION_TEMPLATE_CACHE_LIMIT) {
      const oldestKey = cache.keys().next().value;
      if (!oldestKey) break;
      cache.delete(oldestKey);
    }
  }, []);

  const deleteCachedAutomationTemplate = useCallback((templateId: string): void => {
    const id = String(templateId || "").trim();
    if (!id) return;
    automationTemplateCacheRef.current.delete(id);
  }, []);

  React.useEffect(() => {
    if (requestedProjectKey && requestedProjectKey !== api.projectKey) {
      api.setProjectKey(requestedProjectKey);
      api.setProjectName(isLocalSandbox && !isRemoteBackedLocalEditor ? sandboxConfig.name : requestedProjectKey);
    }
  }, [requestedProjectKey, isLocalSandbox, isRemoteBackedLocalEditor, sandboxConfig.name, api.projectKey, api.setProjectKey, api.setProjectName]);

  React.useEffect(() => {
    if (!requestedProjectKey || (isLocalSandbox && !isRemoteBackedLocalEditor)) return;
    const normalizedKey = String(requestedProjectKey || "").trim().toLowerCase();
    const matchedProject = api.projects.find((project) => String(project.key || "").trim().toLowerCase() === normalizedKey);
    const nextProjectName = String(matchedProject?.name || "").trim();
    if (!nextProjectName || nextProjectName === api.projectName) return;
    api.setProjectName(nextProjectName);
  }, [requestedProjectKey, isLocalSandbox, isRemoteBackedLocalEditor, api.projectName, api.projects, api.setProjectName]);

  React.useEffect(() => {
    if (!localDevHost || !isLocalSandbox || isRemoteBackedLocalEditor) return;
    if (!sandboxId) return;
    navigate("/editor", { replace: true });
  }, [isLocalSandbox, isRemoteBackedLocalEditor, localDevHost, navigate, sandboxId]);

  React.useEffect(() => {
    localSandboxMirrorSyncedRef.current = false;
  }, [isLocalSandbox, requestedProjectKey, api.projectKey]);

  React.useEffect(() => {
    initialViewportFitDoneRef.current = false;
  }, [requestedProjectKey]);

  React.useEffect(() => {
    if (initialLoadDone) return;
    async function loadProject() {
      const projectId = requestedProjectKey || api.projectKey || "draft";
      let doc: PinselaTemplateDocV1 | null = null;

      if (isRemoteBackedLocalEditor) {
        // ── Canva single-source model ──────────────────────────────────────
        // The SERVER is the one truth. We resolve server-vs-local purely by
        // recency (last-write-wins), never by page-count heuristics — so:
        //   • Claude/agent edits the server  → server is newest → user sees it.
        //   • A stale local copy             → server is newest → no shadowing.
        //   • User's genuine unsaved edits   → local is newest → never lost.
        // No separate "draft branch" wins over the canonical anymore; the draft
        // is only a fallback when the canonical doesn't exist yet.
        if (localAccountNeedsLogin) return;

        const localMeta = api.localLoadMeta(projectId);
        const localFresh = localMeta && !isEffectivelyBlankProjectDoc(localMeta.doc) ? localMeta : null;

        let serverDoc: PinselaTemplateDocV1 | null = null;
        let serverAtMs = 0;
        // A blank doc the server already has (e.g. a freshly created 1080x1080 project)
        // still carries the user's chosen format: keep it as the last resort.
        let blankServerDoc: PinselaTemplateDocV1 | null = null;
        try {
          const canonical = await fetchNativeProjectByKey(projectId); // side-effect-free
          if (canonical?.doc_json && isEffectivelyBlankProjectDoc(canonical.doc_json)) {
            blankServerDoc = canonical.doc_json as PinselaTemplateDocV1;
          }
          if (canonical?.doc_json && !isEffectivelyBlankProjectDoc(canonical.doc_json)) {
            serverDoc = canonical.doc_json as PinselaTemplateDocV1;
            const t = Date.parse(String(canonical.updated_at || ""));
            serverAtMs = Number.isFinite(t) ? t : 0;
          }
        } catch {
          serverDoc = null;
        }
        if (!serverDoc) {
          // Canonical missing/blank → fall back to the server draft.
          try {
            const draftResp = await fetchNativeProjectDraftByKey(projectId);
            const draftDoc = draftResp?.doc_json as PinselaTemplateDocV1 | undefined;
            if (draftDoc && !isEffectivelyBlankProjectDoc(draftDoc)) {
              serverDoc = draftDoc;
              const t = Date.parse(String(draftResp?.meta?.updated_at || ""));
              serverAtMs = Number.isFinite(t) ? t : 0;
            }
          } catch {
            /* no server draft either */
          }
        }

        if (serverDoc && localFresh) {
          // Both exist → newest wins. Local must be STRICTLY newer to override
          // the server (ties go to the server truth).
          doc = localFresh.savedAt > serverAtMs ? localFresh.doc : serverDoc;
        } else {
          doc = serverDoc || localFresh?.doc || null;
        }

        // Last resort: offline recovery, then a blank canvas.
        if (!doc) {
          const recovery = await loadWithSoftTimeout(api.loadLocalRecovery(projectId), 1_200);
          if (recovery && !isEffectivelyBlankProjectDoc(recovery)) doc = recovery;
        }
        if (!doc && blankServerDoc) doc = blankServerDoc;
        if (!doc) {
          doc = createEmptyDoc(1080, 1350);
          doc.canvas.background = doc.canvas.background || "#F2ECE4";
        }
      } else if (isLocalSandbox) {
        const localDoc = api.localLoad(projectId);
        doc = localDoc && !isEffectivelyBlankProjectDoc(localDoc) ? localDoc : null;
        if (!doc) doc = await api.loadLocalMirror(projectId);
      } else {
        // Admin/template editor: autosave writes the draft only, so the draft is
        // the freshest truth here; canonical is the fallback.
        doc = await api.loadDraft(projectId);
        if (!doc) doc = await api.loadProject(projectId);
      }

      if (doc) {
        // Single chokepoint for every load source (localStorage mirror, server
        // draft, published, recovery): resolve $tokens.* color refs to hex and
        // repoint stale filesystem image_src to /api/assets. Keeps the in-memory
        // doc editor-safe so the canvas renders correctly and autosave persists
        // the normalized values (self-healing on next load).
        doc = normalizeDocForEditor(doc);
        const parsedPages = parseProjectPagesFromDoc(doc);
        const activePage = parsedPages.pages.find((page) => page.id === parsedPages.activePageId) || parsedPages.pages[0];
        switchingProjectPageRef.current = true;
        projectPagesRef.current = parsedPages.pages;
        activeProjectPageIdRef.current = activePage.id;
        setProjectPages(parsedPages.pages);
        setActiveProjectPageId(activePage.id);
        setPagesGridOpen(false);
        setFormatPickerMode("initial");
        engine.dispatch({ type: "set_history", history: createHistory(activePage.doc) });
        engine.dispatch({ type: "set_selection", selection: [] });
        setArtboardGuides(readDocArtboardGuides(activePage.doc));
        window.setTimeout(() => {
          switchingProjectPageRef.current = false;
        }, 0);
        // First open of the project: fit the artboard to the viewport ("Fit").
        // Live reloads of the same project keep the user's zoom/pan.
        if (!initialViewportFitDoneRef.current) {
          initialViewportFitDoneRef.current = true;
          pendingFormatViewportFitRef.current = true;
        }
        setChosenFormat({
          id: "custom",
          width: activePage.doc.canvas.width,
          height: activePage.doc.canvas.height,
          name: "Custom",
          category: "Digital",
          icon: ""
        });
        setLastPersistedDocRevision("0:0");
        setPageStateRevision(0);
        markPersistedAfterDocSyncRef.current = true;
      }
      setInitialLoadDone(true);
    }
    void loadProject();
  }, [requestedProjectKey, api.projectKey, initialLoadDone, isRemoteBackedLocalEditor, isLocalSandbox, localAccountNeedsLogin, api.loadDraft, api.loadLocalMirror, api.loadLocalRecovery, api.loadProject, api.localLoad, engine.dispatch]);

  // ── Live editing (spec 2026-06-22 §5) ─────────────────────────────────────
  // Mirrors what the AGENT does to the open artwork, in real time. Only reloads
  // while the agent has "working" presence — the user's own edits
  // (autosave) emit doc-changed but do NOT trigger a reload (no echo/loop).
  const liveProjectKey = requestedProjectKey || api.projectKey || null;
  const lastLocalSaveAtRef = useRef(0);
  const liveReloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [liveGlow, setLiveGlow] = useState(false);
  const handleRemoteDocChange = useCallback((_updatedAt: string) => {
    // External (agent) change to the live doc → reload. We suppress the echo of
    // our OWN recent autosave (the server re-broadcasts every save as a
    // doc-changed event), so live reload no longer requires the agent to first
    // announce presence — it just works whenever the server doc changes.
    if (Date.now() - lastLocalSaveAtRef.current < 4000) return;
    setLiveGlow(true);
    window.setTimeout(() => setLiveGlow(false), 700);
    if (liveReloadTimerRef.current) clearTimeout(liveReloadTimerRef.current);
    liveReloadTimerRef.current = setTimeout(() => {
      // Re-runs the existing load (newer server doc = the agent's edit).
      setInitialLoadDone(false);
    }, 150);
  }, []);
  const { presence: agentPresence } = useLiveDoc(liveProjectKey, handleRemoteDocChange);
  useEffect(() => {
    // Mark when we save locally so the resulting doc-changed echo is ignored.
    // Anchor on BOTH "saving" and "saved": the server broadcasts the echo right
    // after the POST completes (saveStatus -> "saved"), so re-stamping on "saved"
    // keeps the suppression window covering the echo even for slow/large saves.
    const s = engine.store.saveStatus;
    if (s === "saving" || s === "saved") lastLocalSaveAtRef.current = Date.now();
  }, [engine.store.saveStatus]);

  const refreshAutomationTemplates = useCallback(async () => {
    if (!api.supportsAutomations) {
      setAutomationTemplates([]);
      return;
    }
    try {
      const { fetchAutomationTemplateList } = await loadAutomationApi();
      const items = await fetchAutomationTemplateList();
      const mapped = items.map(mapApiAutomationTemplateSummary);
      setAutomationTemplates(mapped);
      const aliveIds = new Set(mapped.map((entry) => entry.id));
      const cache = automationTemplateCacheRef.current;
      for (const key of Array.from(cache.keys())) {
        if (!aliveIds.has(key)) cache.delete(key);
      }
    } catch {
      // Silent: a network failure must not break the editor.
    }
  }, []);

  const viewportRef = useRef<HTMLDivElement>(null);
  const addImageInputRef = useRef<HTMLInputElement | null>(null);
  const addImportInputRef = useRef<HTMLInputElement | null>(null);
  const addSvgImportInputRef = useRef<HTMLInputElement | null>(null);
  const pendingSvgImportModeRef = useRef<SvgImportMode>("current_page");
  const [importLibrary, setImportLibrary] = useState<ImportedAssetEntry[]>([]);
  const [svgImportMode, setSvgImportMode] = useState<SvgImportMode>("current_page");
  const [artboardGuides, setArtboardGuides] = useState<GuideLine[]>([]);
  const artboardGuidesRef = useRef<GuideLine[]>([]);
  artboardGuidesRef.current = artboardGuides;
  // Artboard guides live in the page doc (metadata.artboard_guides) so they survive reloads.
  const persistArtboardGuides = useCallback((next: GuideLine[]) => {
    if (JSON.stringify(next) === JSON.stringify(artboardGuidesRef.current)) return;
    setArtboardGuides(next);
    const baseMeta = engine.doc.metadata && typeof engine.doc.metadata === "object" ? { ...engine.doc.metadata } : {};
    if (next.length) baseMeta.artboard_guides = next;
    else delete baseMeta.artboard_guides;
    engine.replaceDoc({ ...engine.doc, metadata: baseMeta });
    engine.dispatch({ type: "set_save_status", saveStatus: "saving" });
  }, [engine]);
  const [rulersEnabled, setRulersEnabled] = useState<boolean>(() => {
    try {
      // Off by default (Canva-like) — rulers are a power feature behind the toggle;
      // on by default they cramped the top chrome and overlapped the context bar.
      return window.localStorage.getItem("pinsela_rulers") === "1";
    } catch {
      return true;
    }
  });
  const toggleRulers = useCallback(() => {
    setRulersEnabled((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem("pinsela_rulers", next ? "1" : "0");
      } catch {
        // best-effort persistence
      }
      return next;
    });
  }, []);
  const [addGuidesValues, setAddGuidesValues] = useState<AddGuidesValues>(DEFAULT_ADD_GUIDES_VALUES);
  const [containerWidth, setContainerWidth] = useState(800);

  const openAddImagePicker = useCallback(() => {
    const input = addImageInputRef.current;
    if (!input) return;
    input.value = "";
    input.click();
  }, []);

  const openImportPicker = useCallback(() => {
    const input = addImportInputRef.current;
    if (!input) return;
    input.value = "";
    input.click();
  }, []);

  const openSvgImportPicker = useCallback((mode?: SvgImportMode) => {
    const input = addSvgImportInputRef.current;
    if (!input) return;
    pendingSvgImportModeRef.current = mode === "new_page" ? "new_page" : "current_page";
    input.value = "";
    input.click();
  }, []);

  const openImportsPanel = useCallback(() => {
    setActiveRight("imports");
    setRightOpen(true);
    if (isCompactViewport) {
      setLeftOpen(false);
    }
  }, [isCompactViewport]);

  React.useEffect(() => {
    if (!viewportRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) setContainerWidth(entry.contentRect.width);
    });
    ro.observe(viewportRef.current);
    return () => ro.disconnect();
  }, []);

  const activeGuides = useMemo<GuideLine[]>(() => (
    [...artboardGuides, ...engine.store.guides]
  ), [artboardGuides, engine.store.guides]);
  const rulesPanelState = useMemo(() => ({
    snapEnabled: engine.store.snap.enabled,
    snapToGrid: engine.store.snap.toGrid,
    snapTolerance: engine.store.snap.tolerance,
    gridSize: engine.store.snap.gridSize,
  }), [engine.store.snap.enabled, engine.store.snap.toGrid, engine.store.snap.tolerance, engine.store.snap.gridSize]);
  const handleToggleSnap = useCallback(() => {
    engine.dispatch({ type: "set_snap", snap: { enabled: !engine.store.snap.enabled } });
  }, [engine, engine.store.snap.enabled]);
  const handleToggleGrid = useCallback(() => {
    engine.dispatch({ type: "set_snap", snap: { toGrid: !engine.store.snap.toGrid } });
  }, [engine, engine.store.snap.toGrid]);
  const handleSetSnapEnabled = useCallback((enabled: boolean) => {
    engine.dispatch({ type: "set_snap", snap: { enabled } });
  }, [engine]);
  const handleSetSnapToGrid = useCallback((enabled: boolean) => {
    engine.dispatch({ type: "set_snap", snap: { toGrid: enabled } });
  }, [engine]);
  const handleSetSnapTolerance = useCallback((value: number) => {
    engine.dispatch({ type: "set_snap", snap: { tolerance: Math.max(1, Math.round(value || 1)) } });
  }, [engine]);
  const handleSetGridSize = useCallback((value: number) => {
    engine.dispatch({ type: "set_snap", snap: { gridSize: Math.max(2, Math.round(value || 2)) } });
  }, [engine]);
  const handleSelectLayer = useCallback((nodeId: string) => {
    engine.setSelection([nodeId]);
    setActiveTab("properties");
  }, [engine]);

  const pointerSnapOptions = useMemo<SnapOptionsWithCustomGuides>(() => {
    const baseSnapEnabled = Boolean(engine.store.snap.enabled);
    const gridSnapEnabled = Boolean(engine.store.snap.toGrid);
    return {
      ...engine.store.snap,
      enabled: baseSnapEnabled || gridSnapEnabled,
      toPage: baseSnapEnabled ? engine.store.snap.toPage : false,
      toObjects: baseSnapEnabled ? engine.store.snap.toObjects : false,
      toGrid: gridSnapEnabled,
      customGuides: artboardGuides,
    };
  }, [
    artboardGuides,
    engine.store.snap,
    engine.store.snap.enabled,
    engine.store.snap.toGrid,
    engine.store.snap.toObjects,
    engine.store.snap.toPage,
  ]);

  // WYSIWYG text editing: while a text node is being edited inline, blank its text
  // in the doc the canvas paints so the ONLY visible text is the (now opaque)
  // <textarea> overlay. That makes the caret/line-wrap always match what's on
  // screen (one text layer, not canvas-render vs textarea-CSS-wrap fighting).
  const editingTextNodeId = engine.mode === "text-edit" ? (engine.selection[0] ?? null) : null;
  const renderDoc = useMemo(() => {
    if (!editingTextNodeId) return engine.doc;
    let changed = false;
    const nodes = engine.doc.nodes.map((node) => {
      if (node.id === editingTextNodeId && node.kind === "text" && String(node.text || "")) {
        changed = true;
        return { ...node, text: "" };
      }
      return node;
    });
    return changed ? { ...engine.doc, nodes } : engine.doc;
  }, [engine.doc, editingTextNodeId]);
  const renderer = useCanvasRenderer(renderDoc, activeGuides, null, containerWidth);
  const latestEngineDocRef = useRef(engine.doc);
  const latestCommitDocRef = useRef(engine.commitDoc);
  useEffect(() => {
    latestEngineDocRef.current = engine.doc;
    latestCommitDocRef.current = engine.commitDoc;
  }, [engine.doc, engine.commitDoc]);
  const translateSelectionGestureDelegateRef = useRef<((event: TranslateSelectionGestureEvent) => void) | null>(null);
  const handleDirectCanvasSelectionTranslateGesture = useCallback((event: TranslateSelectionGestureEvent) => {
    translateSelectionGestureDelegateRef.current?.(event);
  }, []);

  const pointer = usePointerMachine(
    engine.doc,
    engine.selection,
    renderer.stageScale,
    engine.commitDoc,
    engine.replaceDoc,
    engine.setSelection,
    pointerSnapOptions,
    (guides) => engine.dispatch({ type: "set_guides", guides }),
    handleDirectCanvasSelectionTranslateGesture,
  );

  const replaceProjectPagesState = useCallback((nextPages: ProjectPageRecord[]) => {
    const positionedPages = ensureProjectPagePositions(nextPages);
    projectPagesRef.current = positionedPages;
    setProjectPages(positionedPages);
  }, []);

  const setActiveProjectPageState = useCallback((nextPageId: string | null) => {
    activeProjectPageIdRef.current = nextPageId;
    setActiveProjectPageId(nextPageId);
  }, []);

  const buildProjectPagesSnapshot = useCallback((activeDoc?: PinselaTemplateDocV1): ProjectPageRecord[] => {
    const pages = projectPagesRef.current;
    const activePageId = activeProjectPageIdRef.current;
    const resolvedDoc = activeDoc || engine.doc;
    const cache = projectPagesSnapshotCacheRef.current;
    if (
      cache.pages === pages
      && cache.activePageId === activePageId
      && cache.activeDoc === resolvedDoc
      && cache.result
    ) {
      return cache.result;
    }
    const result = ensureProjectPagePositions(mergeActiveDocIntoPages(
      pages,
      activePageId,
      resolvedDoc,
    ));
    projectPagesSnapshotCacheRef.current = {
      pages,
      activePageId,
      activeDoc: resolvedDoc,
      result,
    };
    return result;
  }, [engine.doc]);

  const serializeCurrentProjectDoc = useCallback((activeDoc?: PinselaTemplateDocV1): PinselaTemplateDocV1 => {
    const resolvedDoc = activeDoc || engine.doc;
    return serializeProjectPagesDoc(
      resolvedDoc,
      buildProjectPagesSnapshot(resolvedDoc),
      activeProjectPageIdRef.current,
    );
  }, [buildProjectPagesSnapshot, engine.doc]);

  const docRevisionCounterRef = useRef(0);
  const lastDocForRevisionRef = useRef<PinselaTemplateDocV1 | null>(null);
  const [pageStateRevision, setPageStateRevision] = useState(0);
  const markProjectPagesDirty = useCallback(() => {
    setPageStateRevision((current) => current + 1);
  }, []);
  const currentDocRevision = useMemo(() => {
    if (lastDocForRevisionRef.current !== engine.doc) {
      lastDocForRevisionRef.current = engine.doc;
      docRevisionCounterRef.current += 1;
    }
    return docRevisionCounterRef.current;
  }, [engine.doc]);
  const currentPersistenceRevision = useMemo(
    () => `${currentDocRevision}:${pageStateRevision}`,
    [currentDocRevision, pageStateRevision],
  );
  const [lastPersistedDocRevision, setLastPersistedDocRevision] = useState<string>(currentPersistenceRevision);
  const latestDocRevisionRef = useRef(currentPersistenceRevision);
  const saveInFlightRef = useRef(false);
  const saveQueuedRef = useRef(false);
  const saveTimerRef = useRef<number | null>(null);
  const pendingFormatViewportFitRef = useRef(false);
  const initialViewportFitDoneRef = useRef(false);
  const localSandboxMirrorSyncedRef = useRef(false);
  const hasUnpersistedChanges = editorReady && (
    engine.store.saveStatus === "saving"
    || currentPersistenceRevision !== lastPersistedDocRevision
  );

  const markCurrentDocAsPersisted = useCallback(() => {
    setLastPersistedDocRevision(latestDocRevisionRef.current);
  }, []);

  const markNextDocAsPersisted = useCallback(() => {
    markPersistedAfterDocSyncRef.current = true;
  }, []);

  React.useEffect(() => {
    latestDocRevisionRef.current = currentPersistenceRevision;
    if (markPersistedAfterDocSyncRef.current) {
      markPersistedAfterDocSyncRef.current = false;
      setLastPersistedDocRevision(currentPersistenceRevision);
    }
  }, [currentPersistenceRevision]);

  const { toasts, push: pushToast, dismiss: dismissToast } = useToasts();
  const flushDraftSaveQueueRef = useRef<() => Promise<void>>(async () => {});
  const lastCardPreviewAtRef = useRef(0);
  const cardPreviewStaleRef = useRef(false);
  const localQuotaWarnedRef = useRef(false);

  // Thumbnail for the projects page card ("No preview yet" otherwise), rendered
  // from the editor's own renderer and stored together with the autosave.
  const buildCardPreview = useCallback(async (doc: PinselaTemplateDocV1): Promise<string | undefined> => {
    try {
      const { exportDocThumbnailBase64 } = await import("../pinsela/core/export");
      const b64 = await exportDocThumbnailBase64(stripProjectPagesMetadata(doc), 640, {
        backgroundMode: "as-is",
        imageCache: renderer.imageCacheRef.current,
        imageLoadTimeoutMs: 4000,
      });
      return b64 || undefined;
    } catch {
      return undefined;
    }
  }, [renderer.imageCacheRef]);

  const flushDraftSaveQueue = useCallback(async () => {
    if (!editorReady || !initialLoadDone) return;
    if (saveInFlightRef.current) {
      saveQueuedRef.current = true;
      return;
    }
    saveInFlightRef.current = true;
    try {
      while (true) {
        saveQueuedRef.current = false;
        const saveRevision = latestDocRevisionRef.current;
        const saveDoc = serializeCurrentProjectDoc();
        const previewDue = Date.now() - lastCardPreviewAtRef.current > CARD_PREVIEW_MIN_INTERVAL_MS;
        const preview = previewDue ? await buildCardPreview(saveDoc) : undefined;
        const saved = await api.saveDraft(requestedProjectKey || api.projectKey || "draft", saveDoc, preview);
        if (preview) {
          lastCardPreviewAtRef.current = Date.now();
          cardPreviewStaleRef.current = false;
        } else {
          cardPreviewStaleRef.current = true;
        }
        if (saved && saved.localBackupOk === false && !localQuotaWarnedRef.current) {
          localQuotaWarnedRef.current = true;
          pushToast({
            id: "local-backup-failed",
            tone: "warning",
            message: "Browser storage is full: the local backup copy was not updated. The project is still being saved to the server.",
            durationMs: 15_000,
          });
        }
        dismissToast("save-error");
        if (!saveQueuedRef.current && latestDocRevisionRef.current === saveRevision) {
          setLastPersistedDocRevision(saveRevision);
          engine.dispatch({ type: "set_save_status", saveStatus: "saved" });
          break;
        }
      }
    } catch (error) {
      const status = Number((error as { status?: number } | null)?.status || 0);
      if (status === 401) {
        engine.dispatch({ type: "set_save_status", saveStatus: "expired" });
        pushToast({
          id: "save-error",
          tone: "error",
          message: "Your session expired. Changes are kept in this browser; reload and sign in again to resume saving.",
          actionLabel: "Reload and sign in",
          onAction: () => window.location.reload(),
        });
      } else {
        engine.dispatch({ type: "set_save_status", saveStatus: "offline" });
        pushToast({
          id: "save-error",
          tone: "error",
          message: "Could not save right now. Check your connection and try again.",
          actionLabel: "Try again",
          onAction: () => void flushDraftSaveQueueRef.current(),
        });
      }
    } finally {
      saveInFlightRef.current = false;
    }
  }, [editorReady, initialLoadDone, serializeCurrentProjectDoc, requestedProjectKey, api.projectKey, api.saveDraft, engine.dispatch, buildCardPreview, pushToast, dismissToast]);
  flushDraftSaveQueueRef.current = flushDraftSaveQueue;
  const buildCardPreviewRef = useRef(buildCardPreview);
  buildCardPreviewRef.current = buildCardPreview;

  const flushLocalSandboxEmergencySave = useCallback(() => {
    if (!isLocalSandbox || !editorReady || !initialLoadDone) return;
    try {
      const saveDoc = serializeCurrentProjectDoc();
      api.localSave(requestedProjectKey || api.projectKey || sandboxConfig.key, saveDoc);
    } catch {
      // Keep the editor responsive even if localStorage is temporarily unavailable.
    }
  }, [
    api.localSave,
    api.projectKey,
    editorReady,
    initialLoadDone,
    isLocalSandbox,
    requestedProjectKey,
    sandboxConfig.key,
    serializeCurrentProjectDoc,
  ]);

  const scheduleDraftSave = useCallback(() => {
    cardPreviewStaleRef.current = true;
    if (saveTimerRef.current != null) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      void flushDraftSaveQueue();
    }, isLocalSandbox ? LOCAL_SANDBOX_AUTOSAVE_DEBOUNCE_MS : AUTOSAVE_DEBOUNCE_MS);
  }, [flushDraftSaveQueue, isLocalSandbox]);

  React.useEffect(() => {
    if (editorReady && initialLoadDone && engine.store.saveStatus === "saving") {
      scheduleDraftSave();
    }
  }, [editorReady, initialLoadDone, engine.store.saveStatus, scheduleDraftSave]);

  // On leaving the editor, refresh the project card thumbnail if the last autosave
  // went out without one (autosave only renders a preview every 30s).
  const leaveContextRef = useRef({ key: "", serialize: serializeCurrentProjectDoc, ready: false });
  leaveContextRef.current = {
    key: requestedProjectKey || api.projectKey || "draft",
    serialize: serializeCurrentProjectDoc,
    ready: editorReady && initialLoadDone,
  };
  React.useEffect(() => () => {
    if (saveTimerRef.current != null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const ctx = leaveContextRef.current;
    if (!ctx.ready || !cardPreviewStaleRef.current) return;
    void (async () => {
      try {
        const doc = ctx.serialize();
        const preview = await buildCardPreviewRef.current(doc);
        if (!preview) return;
        await saveNativeProjectDraftByKey(ctx.key, { doc_json: doc, source: "v2-editor:leave", preview_png_b64: preview });
      } catch {
        /* best effort: the card just keeps its previous thumbnail */
      }
    })();
  }, []);

  React.useEffect(() => {
    if (!isLocalSandbox || !editorReady || !initialLoadDone) return undefined;
    const persistNow = () => {
      if (!hasUnpersistedChanges) return;
      flushLocalSandboxEmergencySave();
      void flushDraftSaveQueue();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        persistNow();
      }
    };
    const handlePageHide = () => {
      persistNow();
    };
    const handleBeforeUnload = () => {
      persistNow();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [
    editorReady,
    flushDraftSaveQueue,
    flushLocalSandboxEmergencySave,
    hasUnpersistedChanges,
    initialLoadDone,
    isLocalSandbox,
  ]);

  React.useEffect(() => {
    if (!isLocalSandbox || !editorReady || !initialLoadDone) return;
    if (localSandboxMirrorSyncedRef.current) return;
    localSandboxMirrorSyncedRef.current = true;
    flushLocalSandboxEmergencySave();
  }, [
    editorReady,
    flushLocalSandboxEmergencySave,
    initialLoadDone,
    isLocalSandbox,
  ]);

  function handleFormatSelect(format: CanvasFormat) {
    setFormatPickerMode("initial");
    setChosenFormat(format);
    const doc = createEmptyDoc(format.width, format.height);
    const initialPageId = uid("page");
    const initialPages: ProjectPageRecord[] = [{
      id: initialPageId,
      name: "Page 1",
      doc,
      position: getInitialProjectPagePosition(doc),
    }];
    switchingProjectPageRef.current = true;
    projectPagesRef.current = initialPages;
    activeProjectPageIdRef.current = initialPageId;
    setProjectPages(initialPages);
    setActiveProjectPageId(initialPageId);
    setPagesGridOpen(false);
    pendingFormatViewportFitRef.current = true;
    toolPointerSessionRef.current = null;
    resizeSelectionSessionRef.current = null;
    translateSelectionSessionRef.current = null;
    rotateSelectionSessionRef.current = null;
    lineEndpointSessionRef.current = null;
    pathPointSessionRef.current = null;
    imageBrushSessionRef.current = null;
    inlineTextSessionRef.current = null;
    cropModeSessionRef.current = null;
    cropTranslateSessionRef.current = null;
    if (traceJobRef.current.timer != null) {
      window.clearTimeout(traceJobRef.current.timer);
      traceJobRef.current.timer = null;
    }
    traceJobRef.current.seq += 1;
    setInlineTextValue(null);
    setExternalFrameDropTargetId(null);
    setGestureFrameDropTargetId(null);
    setImageBrushState(DEFAULT_IMAGE_BRUSH_SETTINGS);
    setImageTraceState(DEFAULT_IMAGE_TRACE_SETTINGS);
    setTracePreview(null);
    setTraceTargetImageId(null);
    setActiveTool("select");
    setLastNavigationTool("select");
    setLastInsertTool("rect");
    setLastDrawTool("pencil");
    setShapeToolPreset(DEFAULT_SHAPE_TOOL_PRESET);
    setLineToolPreset(DEFAULT_LINE_TOOL_PRESET);
    setArrowToolPreset(DEFAULT_ARROW_TOOL_PRESET);
    setDrawToolPresets(DEFAULT_DRAW_TOOL_PRESETS);
    setTextToolPreset(DEFAULT_TEXT_TOOL_PRESET);
    setActiveModal(null);
    setActiveLeft("assets");
    setActiveRight("layers");
    setActiveTab("properties");
    engine.dispatch({ type: "set_history", history: createHistory(doc) });
    engine.dispatch({ type: "set_selection", selection: [] });
    engine.dispatch({ type: "set_guides", guides: [] });
    setArtboardGuides(readDocArtboardGuides(doc));
    engine.dispatch({ type: "set_save_status", saveStatus: "saved" });
    if (engine.mode !== "select") {
      engine.setMode("select");
    }
    window.setTimeout(() => {
      switchingProjectPageRef.current = false;
    }, 0);
    markNextDocAsPersisted();
    renderer.setZoom(uiPercentToEngineZoom(100));
  }

  React.useEffect(() => {
    if (!editorReady || !pendingFormatViewportFitRef.current) return;
    const fitPadding = formatFitViewportPadding({ localSandbox: isLocalSandbox });
    let rafId = 0;
    let cancelled = false;
    const tryFit = (attempt: number) => {
      if (cancelled) return;
      const fitted = renderer.fitToViewport({
        horizontalPadding: fitPadding.horizontalPadding,
        topPadding: fitPadding.topPadding,
        bottomPadding: fitPadding.bottomPadding,
      });
      if (fitted || attempt >= 7) {
        pendingFormatViewportFitRef.current = false;
        return;
      }
      rafId = window.requestAnimationFrame(() => tryFit(attempt + 1));
    };
    rafId = window.requestAnimationFrame(() => tryFit(0));
    return () => {
      cancelled = true;
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [editorReady, chosenFormat?.id, renderer.fitToViewport, isLocalSandbox]);

  // Side panel state persists on desktop (on mobile the panels start closed).
  const readPanelPref = (key: string): string | null => {
    try { return window.localStorage.getItem(key); } catch { return null; }
  };
  const [leftOpen, setLeftOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    if (window.matchMedia("(max-width: 900px)").matches) return false;
    return readPanelPref("pinsela_left_open") !== "0";
  });
  const [activeLeft, setActiveLeft] = useState<LeftSectionKey>(() => {
    const saved = typeof window === "undefined" ? null : readPanelPref("pinsela_left_section");
    return (saved && ["assets", "elements", "templates", "stroke", "effects", "boolean_ops"].includes(saved) ? saved : "assets") as LeftSectionKey;
  });
  const [rightOpen, setRightOpen] = useState(() => (
    typeof window === "undefined" ? true : !window.matchMedia("(max-width: 900px)").matches
  ));
  const [activeRight, setActiveRight] = useState<RightSectionKey>("layers");
  React.useEffect(() => {
    if (isCompactViewport) return;
    try {
      window.localStorage.setItem("pinsela_left_open", leftOpen ? "1" : "0");
      window.localStorage.setItem("pinsela_left_section", activeLeft);
    } catch {
      // The preference is only a convenience.
    }
  }, [leftOpen, activeLeft, isCompactViewport]);
  const [activeTab, setActiveTab] = useState<InspectorTabKey>("properties");
  const [activeModal, setActiveModal] = useState<string | null>(null);
  // Light and neutral everywhere: one cohesive product, no theme switch.
  const theme = "sand" as const;
  const managedViewportModeRef = useRef<boolean | null>(null);
  const localViewportFitKeyRef = useRef<string | null>(null);
  const skipNextLocalViewportFitRef = useRef(false);

  React.useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.classList.add("pinsela-editor-active");
    document.body.classList.add("pinsela-editor-active");
    document.body.classList.toggle("pinsela-local-editor-active", isLocalSandbox);
    return () => {
      document.documentElement.classList.remove("pinsela-editor-active");
      document.body.classList.remove("pinsela-editor-active");
      document.body.classList.remove("pinsela-local-editor-active");
    };
  }, [isLocalSandbox]);

  React.useEffect(() => {
    if (managedViewportModeRef.current === isCompactViewport) return;
    const firstRun = managedViewportModeRef.current === null;
    managedViewportModeRef.current = isCompactViewport;
    if (isCompactViewport) {
      setLeftOpen(false);
      setRightOpen(false);
      return;
    }
    if (!firstRun) setLeftOpen(true);
    setRightOpen(true);
  }, [isCompactViewport]);

  React.useEffect(() => {
    if (!isLocalSandbox || !editorReady) return;
    const fitKey = [
      chosenFormat?.id || "custom",
      Math.round(Number(chosenFormat?.width || engine.doc.canvas.width || 1)),
      Math.round(Number(chosenFormat?.height || engine.doc.canvas.height || 1)),
      isCompactViewport ? "compact" : "desktop",
    ].join(":");
    if (localViewportFitKeyRef.current === fitKey) return;
    if (skipNextLocalViewportFitRef.current) {
      skipNextLocalViewportFitRef.current = false;
      localViewportFitKeyRef.current = fitKey;
      return;
    }
    let rafId = 0;
    let rafId2 = 0;
    rafId = window.requestAnimationFrame(() => {
      rafId2 = window.requestAnimationFrame(() => {
        renderer.fitToViewport(formatFitViewportPadding({ localSandbox: true }));
        localViewportFitKeyRef.current = fitKey;
      });
    });
    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
      if (rafId2) window.cancelAnimationFrame(rafId2);
    };
  }, [
    isLocalSandbox,
    editorReady,
    chosenFormat?.id,
    chosenFormat?.width,
    chosenFormat?.height,
    engine.doc.canvas.width,
    engine.doc.canvas.height,
    isCompactViewport,
    renderer.fitToViewport,
  ]);

  React.useEffect(() => {
    if (!api.supportsAutomations && activeRight === "automations") {
      setActiveRight("layers");
      return;
    }
    if (activeRight !== "automations") return;
    void refreshAutomationTemplates();
  }, [activeRight, api.supportsAutomations, refreshAutomationTemplates]);

  const applyProjectPageToEditor = useCallback((
    pageId: string,
    pageDoc: PinselaTemplateDocV1,
    markDirty: boolean,
    options?: { fitViewport?: boolean },
  ) => {
    const width = Math.max(1, Math.round(Number(pageDoc.canvas.width || 1)));
    const height = Math.max(1, Math.round(Number(pageDoc.canvas.height || 1)));
    const shouldFitViewport = options?.fitViewport ?? true;
    switchingProjectPageRef.current = true;
    setActiveProjectPageState(pageId);
    setPagesGridOpen(false);
    setFormatPickerMode("initial");
    if (!shouldFitViewport) {
      skipNextLocalViewportFitRef.current = true;
      const currentDocWidth = Math.max(1, Math.round(Number(engine.doc.canvas.width || 1)));
      if (width !== currentDocWidth) {
        renderer.setZoom(rendererZoomForStageScale(containerWidth, width, renderer.stageScale));
      }
    }
    setChosenFormat({
      id: "custom",
      width,
      height,
      name: "Custom",
      category: "Digital",
      icon: "",
    });
    pendingFormatViewportFitRef.current = shouldFitViewport;
    engine.dispatch({ type: "set_history", history: createHistory(pageDoc) });
    engine.dispatch({ type: "set_selection", selection: [] });
    engine.dispatch({ type: "set_guides", guides: [] });
    setArtboardGuides(readDocArtboardGuides(pageDoc));
    if (engine.mode !== "select") {
      engine.setMode("select");
    }
    if (markDirty) {
      engine.dispatch({ type: "set_save_status", saveStatus: "saving" });
    }
    window.setTimeout(() => {
      switchingProjectPageRef.current = false;
    }, 0);
  }, [containerWidth, engine, renderer.setZoom, renderer.stageScale, setActiveProjectPageState]);

  const switchToProjectPage = useCallback((pageId: string) => {
    const nextId = String(pageId || "").trim();
    if (!nextId || nextId === activeProjectPageId) return;
    const pagesSnapshot = buildProjectPagesSnapshot(engine.doc);
    const targetPage = pagesSnapshot.find((page) => page.id === nextId);
    if (!targetPage) return;
    replaceProjectPagesState(pagesSnapshot);
    applyProjectPageToEditor(targetPage.id, targetPage.doc, false, { fitViewport: false });
  }, [activeProjectPageId, buildProjectPagesSnapshot, engine.doc, replaceProjectPagesState, applyProjectPageToEditor]);

  const selectProjectPageObject = useCallback((event: { pageId: string; nodeId: string }) => {
    const pageId = String(event.pageId || "").trim();
    const nodeId = String(event.nodeId || "").trim();
    if (!pageId || !nodeId) return;
    const pagesSnapshot = buildProjectPagesSnapshot(engine.doc);
    const targetPage = pagesSnapshot.find((page) => page.id === pageId);
    if (!targetPage || !targetPage.doc.nodes.some((node) => node.id === nodeId)) return;
    replaceProjectPagesState(pagesSnapshot);
    if (pageId === activeProjectPageIdRef.current) {
      if (engine.mode !== "select") {
        engine.setMode("select");
      }
      engine.setSelection([nodeId]);
      return;
    }
    applyProjectPageToEditor(targetPage.id, targetPage.doc, false, { fitViewport: false });
    window.setTimeout(() => {
      engine.setSelection([nodeId]);
    }, 0);
  }, [applyProjectPageToEditor, buildProjectPagesSnapshot, engine, replaceProjectPagesState]);

  const moveProjectPageOnCanvas = useCallback((event: { pageId: string; x: number; y: number; phase: "move" | "end" }) => {
    const targetId = String(event.pageId || "").trim();
    if (!targetId) return;
    const x = Math.round(Number(event.x || 0));
    const y = Math.round(Number(event.y || 0));
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const pagesSnapshot = buildProjectPagesSnapshot(engine.doc);
    let changed = false;
    const nextPages = pagesSnapshot.map((page) => {
      if (page.id !== targetId) return page;
      const currentPosition = getProjectPagePosition(page);
      if (currentPosition.x === x && currentPosition.y === y) return page;
      changed = true;
      return {
        ...page,
        position: { x, y },
      };
    });
    if (!changed) {
      if (event.phase === "end" && pagesSnapshot.some((page) => page.id === targetId)) {
        markProjectPagesDirty();
        engine.dispatch({ type: "set_save_status", saveStatus: "saving" });
      }
      return;
    }
    replaceProjectPagesState(nextPages);
    if (event.phase === "end") {
      markProjectPagesDirty();
      engine.dispatch({ type: "set_save_status", saveStatus: "saving" });
    }
  }, [buildProjectPagesSnapshot, engine, replaceProjectPagesState, markProjectPagesDirty]);

  const renameProjectPage = useCallback((pageId: string, nextName: string) => {
    const targetId = String(pageId || "").trim();
    const normalizedName = String(nextName || "").trim();
    if (!targetId || !normalizedName) return;
    const pagesSnapshot = buildProjectPagesSnapshot(engine.doc);
    const existingPage = pagesSnapshot.find((page) => page.id === targetId);
    if (!existingPage || existingPage.name === normalizedName) return;
    replaceProjectPagesState(pagesSnapshot.map((page) => (
      page.id === targetId
        ? { ...page, name: normalizedName }
        : page
    )));
    markProjectPagesDirty();
    engine.dispatch({ type: "set_save_status", saveStatus: "saving" });
  }, [buildProjectPagesSnapshot, engine.doc, replaceProjectPagesState, markProjectPagesDirty, engine]);

  const deleteProjectPage = useCallback((pageId: string) => {
    const targetId = String(pageId || "").trim();
    const pagesSnapshot = buildProjectPagesSnapshot(engine.doc);
    if (!targetId || pagesSnapshot.length <= 1) return;
    const targetIndex = pagesSnapshot.findIndex((page) => page.id === targetId);
    if (targetIndex < 0) return;

    const nextPages = pagesSnapshot.filter((page) => page.id !== targetId);
    replaceProjectPagesState(nextPages);
    markProjectPagesDirty();

    if (targetId === activeProjectPageId) {
      const fallbackPage = nextPages[Math.min(targetIndex, nextPages.length - 1)] || nextPages[0];
      if (fallbackPage) {
        applyProjectPageToEditor(fallbackPage.id, fallbackPage.doc, true);
        return;
      }
    }

    engine.dispatch({ type: "set_save_status", saveStatus: "saving" });
  }, [buildProjectPagesSnapshot, engine.doc, replaceProjectPagesState, markProjectPagesDirty, activeProjectPageId, applyProjectPageToEditor, engine]);

  // Reorders project_pages_v1.pages[] — this is the order used by export (PDF/ZIP) and the pages list.
  const moveProjectPage = useCallback((pageId: string, delta: -1 | 1) => {
    const pagesSnapshot = buildProjectPagesSnapshot(engine.doc);
    const from = pagesSnapshot.findIndex((page) => page.id === pageId);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= pagesSnapshot.length) return;
    const nextPages = [...pagesSnapshot];
    const [moved] = nextPages.splice(from, 1);
    nextPages.splice(to, 0, moved);
    replaceProjectPagesState(nextPages);
    markProjectPagesDirty();
    engine.dispatch({ type: "set_save_status", saveStatus: "saving" });
  }, [buildProjectPagesSnapshot, engine, replaceProjectPagesState, markProjectPagesDirty]);

  const duplicateProjectPage = useCallback((pageId: string) => {
    const targetId = String(pageId || "").trim();
    if (!targetId) return;
    const pagesSnapshot = buildProjectPagesSnapshot(engine.doc);
    const sourcePage = pagesSnapshot.find((page) => page.id === targetId);
    if (!sourcePage) return;
    const nextId = uid("page");
    const nextDoc = cloneDoc(sourcePage.doc);
    const nextPage: ProjectPageRecord = {
      id: nextId,
      name: buildDuplicatedProjectPageName(
        sourcePage.name,
        pagesSnapshot.map((page) => page.name),
      ),
      doc: nextDoc,
      position: getAdjacentProjectPagePosition(sourcePage, "right"),
    };
    const sourceIndex = pagesSnapshot.findIndex((page) => page.id === targetId);
    const insertIndex = sourceIndex >= 0 ? sourceIndex + 1 : pagesSnapshot.length;
    const nextPages = [...pagesSnapshot];
    nextPages.splice(insertIndex, 0, nextPage);
    replaceProjectPagesState(nextPages);
    markProjectPagesDirty();
    applyProjectPageToEditor(nextId, nextDoc, true, { fitViewport: false });
  }, [buildProjectPagesSnapshot, engine.doc, replaceProjectPagesState, markProjectPagesDirty, applyProjectPageToEditor]);

  const createBlankProjectPage = useCallback((format?: CanvasFormat) => {
    const width = Math.max(1, Math.round(Number(format?.width || engine.doc.canvas.width || chosenFormat?.width || 1080)));
    const height = Math.max(1, Math.round(Number(format?.height || engine.doc.canvas.height || chosenFormat?.height || 1080)));
    const nextDoc = createEmptyDoc(width, height);
    const pagesSnapshot = buildProjectPagesSnapshot(engine.doc);
    const nextId = uid("page");
    const nextPage: ProjectPageRecord = {
      id: nextId,
      name: nextPageName(pagesSnapshot.map((page) => page.name)),
      doc: nextDoc,
      position: pagesSnapshot.length
        ? getAdjacentProjectPagePosition(pagesSnapshot[pagesSnapshot.length - 1], "right")
        : getInitialProjectPagePosition(nextDoc),
    };
    const nextPages = [...pagesSnapshot, nextPage];
    replaceProjectPagesState(nextPages);
    markProjectPagesDirty();
    applyProjectPageToEditor(nextId, nextDoc, true, { fitViewport: false });
  }, [
    engine.doc.canvas.width,
    engine.doc.canvas.height,
    chosenFormat?.width,
    chosenFormat?.height,
    buildProjectPagesSnapshot,
    engine.doc,
    replaceProjectPagesState,
    markProjectPagesDirty,
    applyProjectPageToEditor,
  ]);

  const createBlankProjectPageAdjacent = useCallback((pageId: string, placement: "right" | "below") => {
    const pagesSnapshot = buildProjectPagesSnapshot(engine.doc);
    const anchorId = String(pageId || "").trim();
    const anchorIndex = pagesSnapshot.findIndex((page) => page.id === anchorId);
    const anchorPage = anchorIndex >= 0 ? pagesSnapshot[anchorIndex] : (pagesSnapshot[pagesSnapshot.length - 1] || null);
    const width = Math.max(1, Math.round(Number(anchorPage?.doc?.canvas?.width || engine.doc.canvas.width || chosenFormat?.width || 1080)));
    const height = Math.max(1, Math.round(Number(anchorPage?.doc?.canvas?.height || engine.doc.canvas.height || chosenFormat?.height || 1080)));
    const nextDoc = createEmptyDoc(width, height);
    const nextId = uid("page");
    let position: CanvasProjectPagePosition;
    let slotWasFree = false;
    if (anchorPage) {
      const anchorPosition = getProjectPagePosition(anchorPage);
      const anchorSize = getProjectPageDimensions(anchorPage);
      const rect = findFreeAdjacentPageRect(
        { x: anchorPosition.x, y: anchorPosition.y, width: anchorSize.width, height: anchorSize.height },
        { width, height },
        placement,
        pagesSnapshot.map((page) => {
          const pagePosition = getProjectPagePosition(page);
          const pageSize = getProjectPageDimensions(page);
          return { x: pagePosition.x, y: pagePosition.y, width: pageSize.width, height: pageSize.height };
        }),
        PROJECT_PAGE_GAP_DOC,
      );
      position = { x: Math.round(rect.x), y: Math.round(rect.y) };
      const naive = findFreeAdjacentPageRect(
        { x: anchorPosition.x, y: anchorPosition.y, width: anchorSize.width, height: anchorSize.height },
        { width, height },
        placement,
        [],
        PROJECT_PAGE_GAP_DOC,
      );
      slotWasFree = naive.x === rect.x && naive.y === rect.y;
    } else {
      position = getInitialProjectPagePosition(nextDoc);
    }
    const nextPage: ProjectPageRecord = {
      id: nextId,
      name: nextPageName(pagesSnapshot.map((page) => page.name)),
      doc: nextDoc,
      position,
    };
    // Project order (= Pages panel = export order) follows the canvas: a page dropped into the
    // free slot next to its anchor follows the anchor; if that slot is taken, the page lands
    // past the existing ones and goes to the end, so repeated "+" clicks keep building
    // 1, 2, 3, 4... in both the Pages panel and the export. The new page becomes active.
    const nextPages = [...pagesSnapshot];
    nextPages.splice(slotWasFree && anchorIndex >= 0 ? anchorIndex + 1 : nextPages.length, 0, nextPage);
    replaceProjectPagesState(nextPages);
    markProjectPagesDirty();
    applyProjectPageToEditor(nextId, nextDoc, true, { fitViewport: false });
  }, [
    buildProjectPagesSnapshot,
    engine.doc,
    chosenFormat?.width,
    chosenFormat?.height,
    replaceProjectPagesState,
    markProjectPagesDirty,
    applyProjectPageToEditor,
  ]);

  const resizeSelectionSessionRef = useRef<{
    baseDoc: PinselaTemplateDocV1;
    selectedIds: string[];
    originalBounds: { x: number; y: number; w: number; h: number };
    latestDoc: PinselaTemplateDocV1 | null;
    moved: boolean;
  } | null>(null);
  const translateSelectionSessionRef = useRef<{
    baseDoc: PinselaTemplateDocV1;
    selectedIds: string[];
    baseBounds: { x: number; y: number; w: number; h: number } | null;
    latestDoc: PinselaTemplateDocV1 | null;
    moved: boolean;
    lastDx: number;
    lastDy: number;
    duplicated: boolean;
    duplicateBaseDoc: PinselaTemplateDocV1 | null;
    duplicateIds: string[];
    duplicateRequested: boolean;
    frameDropTargetId: string | null;
    autoLayoutDropTargetId: string | null;
    hiddenBaseDoc: PinselaTemplateDocV1 | null;
    rasterPreviewEnabled: boolean;
    rasterToken: number;
    lockedAxis: LockedDragAxis;
  } | null>(null);
  const rotateSelectionSessionRef = useRef<{
    baseDoc: PinselaTemplateDocV1;
    selectedIds: string[];
    latestDoc: PinselaTemplateDocV1 | null;
    moved: boolean;
  } | null>(null);
  const lineEndpointSessionRef = useRef<{
    baseDoc: PinselaTemplateDocV1;
    nodeId: string;
    latestDoc: PinselaTemplateDocV1 | null;
    moved: boolean;
  } | null>(null);
  const pathPointSessionRef = useRef<{
    baseDoc: PinselaTemplateDocV1;
    nodeId: string;
    pointIndex: number;
    pointKind: "anchor" | "in" | "out";
    latestDoc: PinselaTemplateDocV1 | null;
    moved: boolean;
  } | null>(null);
  const imageBrushSessionRef = useRef<{
    baseDoc: PinselaTemplateDocV1;
    nodeId: string;
    selectedNodeSnapshot: PinselaNode;
    existingStrokes: PinselaImageBrushStroke[];
    currentStroke: PinselaImageBrushStroke;
    lastPoint: PinselaImageBrushPoint;
    latestDoc: PinselaTemplateDocV1 | null;
    moved: boolean;
  } | null>(null);
  const inlineTextSessionRef = useRef<{
    nodeId: string;
    originalText: string;
  } | null>(null);
  const cropModeSessionRef = useRef<CropModeSession | null>(null);
  const cropTranslateSessionRef = useRef<CropTranslateSession | null>(null);
  // Canva-style crop frame resize: the image-on-canvas rect is captured at
  // gesture start and stays FIXED while the frame (geometry) moves over it.
  const cropFrameSessionRef = useRef<{
    baseDoc: PinselaTemplateDocV1;
    nodeId: string;
    imageRect: { x: number; y: number; width: number; height: number };
    imageWidth: number;
    imageHeight: number;
    latestDoc: PinselaTemplateDocV1;
    moved: boolean;
  } | null>(null);
  // Live crop state (frame box + crop rect) the CanvasStage overlay reads each
  // frame. Updated by every crop interaction; cleared on confirm/cancel.
  const cropLiveRef = useRef<{
    box: { x: number; y: number; width: number; height: number };
    crop: { x: number; y: number; width: number; height: number };
  } | null>(null);
  // Quick-crop: dragging a SIDE handle on an image (outside crop mode) crops it
  // instead of stretching — Canva behaviour, never distorts.
  const quickCropSessionRef = useRef<{
    baseDoc: PinselaTemplateDocV1;
    nodeId: string;
    imageRect: { x: number; y: number; width: number; height: number };
    imageWidth: number;
    imageHeight: number;
    latestDoc: PinselaTemplateDocV1 | null;
    moved: boolean;
  } | null>(null);
  const [inlineTextValue, setInlineTextValue] = useState<string | null>(null);
  const [externalFrameDropTargetId, setExternalFrameDropTargetId] = useState<string | null>(null);
  const [gestureFrameDropTargetId, setGestureFrameDropTargetId] = useState<string | null>(null);
  const gestureFrameDropTargetIdRef = useRef<string | null>(null);
  const translateRasterPreviewTokenRef = useRef(0);
  const previewFrameRef = useRef<number | null>(null);
  const previewDocRef = useRef<PinselaTemplateDocV1 | null>(null);
  const previewGuidesRef = useRef<GuideLine[] | null>(null);
  const previewSelectionBoundsRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const previewClearFrameRef = useRef<number | null>(null);
  const [selectionInteractionPreview, setSelectionInteractionPreview] = useState<null | "move" | "resize">(null);
  const [selectionMoveRasterPreview, setSelectionMoveRasterPreview] = useState<null | {
    src: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }>(null);
  const selectionMovePreviewOffsetRef = useRef<{ dx: number; dy: number } | null>(null);
  const selectionGestureGuidesRef = useRef<GuideLine[]>([]);
  const [imageBrushState, setImageBrushState] = useState<ContextToolbarImageBrushState>(DEFAULT_IMAGE_BRUSH_SETTINGS);
  const [imageTraceState, setImageTraceState] = useState<ContextToolbarImageTraceState>(DEFAULT_IMAGE_TRACE_SETTINGS);
  const [imageBackgroundRemovalState, setImageBackgroundRemovalState] = useState<ContextToolbarImageBackgroundRemovalState>({
    processing: false,
    error: null,
  });
  const [tracePreview, setTracePreview] = useState<TracePreviewState | null>(null);
  const [traceTargetImageId, setTraceTargetImageId] = useState<string | null>(null);
  const traceImageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const traceJobRef = useRef<{ seq: number; timer: number | null }>({ seq: 0, timer: null });
  const [activeTool, setActiveTool] = useState<CanvasToolId>("select");
  const [lastNavigationTool, setLastNavigationTool] = useState<NavigationToolId>("select");
  const [lastInsertTool, setLastInsertTool] = useState<InsertToolId>("rect");
  const [lastDrawTool, setLastDrawTool] = useState<DrawToolId>("pencil");
  const allowSelectionMoveRasterPreview = !isCompactViewport;
  const [selectedPathPointIndex, setSelectedPathPointIndex] = useState<number | null>(null);
  const [shapeToolPreset, setShapeToolPreset] = useState<ShapeToolPreset>(DEFAULT_SHAPE_TOOL_PRESET);
  const [lineToolPreset, setLineToolPreset] = useState<ContextToolbarLineState>(DEFAULT_LINE_TOOL_PRESET);
  const [arrowToolPreset, setArrowToolPreset] = useState<ContextToolbarLineState>(DEFAULT_ARROW_TOOL_PRESET);
  const [drawToolPresets, setDrawToolPresets] = useState<Record<DrawToolId, ContextToolbarLineState>>(DEFAULT_DRAW_TOOL_PRESETS);
  const [textToolPreset, setTextToolPreset] = useState<TextToolPreset>(DEFAULT_TEXT_TOOL_PRESET);
  const toolPointerSessionRef = useRef<ToolPointerSession | null>(null);

  React.useEffect(() => {
    translateRasterPreviewTokenRef.current += 1;
    resizeSelectionSessionRef.current = null;
    translateSelectionSessionRef.current = null;
    rotateSelectionSessionRef.current = null;
    lineEndpointSessionRef.current = null;
    pathPointSessionRef.current = null;
    imageBrushSessionRef.current = null;
    selectionMovePreviewOffsetRef.current = null;
    selectionGestureGuidesRef.current = [];
    previewDocRef.current = null;
    previewGuidesRef.current = null;
    previewSelectionBoundsRef.current = null;
    if (previewFrameRef.current != null) {
      window.cancelAnimationFrame(previewFrameRef.current);
      previewFrameRef.current = null;
    }
    if (previewClearFrameRef.current != null) {
      window.cancelAnimationFrame(previewClearFrameRef.current);
      previewClearFrameRef.current = null;
    }
    setSelectionInteractionPreview(null);
    setSelectionMoveRasterPreview(null);
    setExternalFrameDropTargetId(null);
    setGestureFrameDropTargetId(null);
    gestureFrameDropTargetIdRef.current = null;
    renderer.clearPreviewScene();
  }, [activeProjectPageId, renderer.clearPreviewScene]);

  const toolbarColorPreviewRef = useRef<null | {
    actionId: "artboard_fill" | "line_color" | "shape_fill" | "shape_stroke" | "text_color";
    undoDoc: PinselaTemplateDocV1;
    latestDoc: PinselaTemplateDocV1;
  }>(null);

  React.useEffect(() => {
    setImageBackgroundRemovalState((current) => (
      current.processing || !current.error
        ? current
        : { ...current, error: null }
    ));
  }, [engine.selectedNode?.id]);

  React.useEffect(() => {
    toolPointerSessionRef.current = null;
  }, [activeTool]);

  React.useEffect(() => {
    gestureFrameDropTargetIdRef.current = gestureFrameDropTargetId;
  }, [gestureFrameDropTargetId]);

  const commitTransientDoc = useCallback((
    undoDoc: PinselaTemplateDocV1,
    nextDoc: PinselaTemplateDocV1,
  ) => {
    const normalizedNext = cloneDoc(applyAutoLayoutDoc(nextDoc));
    engine.dispatch({
      type: "set_history",
      history: {
        past: [...engine.store.history.past, cloneDoc(undoDoc)].slice(-180),
        present: normalizedNext,
        future: [],
      },
    });
    engine.dispatch({ type: "set_save_status", saveStatus: "saving" });
  }, [engine]);

  const flushToolbarColorPreview = useCallback(() => {
    const session = toolbarColorPreviewRef.current;
    if (!session) return;
    toolbarColorPreviewRef.current = null;
    commitTransientDoc(session.undoDoc, session.latestDoc);
  }, [commitTransientDoc]);

  const applyToolbarColorPreview = useCallback((
    actionId: "artboard_fill" | "line_color" | "shape_fill" | "shape_stroke" | "text_color",
    buildNextDoc: (sourceDoc: PinselaTemplateDocV1) => PinselaTemplateDocV1,
    options?: { transient?: boolean; commit?: boolean },
  ) => {
    const existing = toolbarColorPreviewRef.current;
    const isSameAction = existing?.actionId === actionId;
    const undoDoc = isSameAction && existing ? existing.undoDoc : engine.doc;
    const sourceDoc = isSameAction && existing ? existing.latestDoc : engine.doc;
    const nextDoc = buildNextDoc(sourceDoc);

    if (options?.transient && !options?.commit) {
      toolbarColorPreviewRef.current = {
        actionId,
        undoDoc,
        latestDoc: nextDoc,
      };
      engine.replaceDoc(nextDoc);
      return;
    }

    if (isSameAction && existing) {
      toolbarColorPreviewRef.current = null;
      commitTransientDoc(existing.undoDoc, nextDoc);
      return;
    }

    engine.commitDoc(nextDoc);
  }, [commitTransientDoc, engine]);

  React.useEffect(() => {
    return () => {
      if (toolbarColorPreviewRef.current) {
        flushToolbarColorPreview();
      }
    };
  }, [flushToolbarColorPreview]);

  React.useEffect(() => {
    if (!toolbarColorPreviewRef.current) return;
    flushToolbarColorPreview();
  }, [engine.selection.join("|"), activeTool, flushToolbarColorPreview]);

  const cancelPendingPreviewClear = useCallback(() => {
    if (previewClearFrameRef.current != null) {
      window.cancelAnimationFrame(previewClearFrameRef.current);
      previewClearFrameRef.current = null;
    }
  }, []);

  const schedulePreviewClear = useCallback(() => {
    cancelPendingPreviewClear();
    previewClearFrameRef.current = window.requestAnimationFrame(() => {
      previewClearFrameRef.current = null;
      renderer.clearPreviewScene();
    });
  }, [cancelPendingPreviewClear, renderer]);

  const clearBufferedPreviewUpdates = useCallback(() => {
    if (previewFrameRef.current != null) {
      window.cancelAnimationFrame(previewFrameRef.current);
      previewFrameRef.current = null;
    }
    previewDocRef.current = null;
    previewGuidesRef.current = null;
    previewSelectionBoundsRef.current = null;
  }, []);

  const updateGestureFrameDropTarget = useCallback((nextId: string | null) => {
    if (gestureFrameDropTargetIdRef.current === nextId) return;
    gestureFrameDropTargetIdRef.current = nextId;
    setGestureFrameDropTargetId(nextId);
  }, []);

  const disableSelectionMoveRasterPreview = useCallback((clearScene = false) => {
    translateRasterPreviewTokenRef.current += 1;
    setSelectionMoveRasterPreview(null);
    selectionMovePreviewOffsetRef.current = null;
    selectionGestureGuidesRef.current = [];
    const session = translateSelectionSessionRef.current;
    if (session) {
      session.hiddenBaseDoc = null;
      session.rasterPreviewEnabled = false;
      session.rasterToken = 0;
    }
    if (clearScene) {
      renderer.clearPreviewScene();
    }
  }, [renderer]);

  const flushPreviewDocUpdate = useCallback(() => {
    if (previewFrameRef.current != null) {
      window.cancelAnimationFrame(previewFrameRef.current);
      previewFrameRef.current = null;
    }
    if (previewDocRef.current) {
      renderer.showPreviewScene({
        doc: previewDocRef.current,
        guides: previewGuidesRef.current || [],
        selectionBounds: previewSelectionBoundsRef.current,
      });
      previewDocRef.current = null;
    }
    previewGuidesRef.current = null;
    previewSelectionBoundsRef.current = null;
  }, [renderer]);

  const schedulePreviewDocUpdate = useCallback((
    nextDoc: PinselaTemplateDocV1,
    guides?: GuideLine[],
    nextSelectionBounds?: { x: number; y: number; w: number; h: number } | null,
  ) => {
    previewDocRef.current = nextDoc;
    previewGuidesRef.current = guides ? [...guides] : [];
    previewSelectionBoundsRef.current = nextSelectionBounds || null;
    if (previewFrameRef.current != null) return;
    previewFrameRef.current = window.requestAnimationFrame(() => {
      previewFrameRef.current = null;
      if (previewDocRef.current) {
        renderer.showPreviewScene({
          doc: previewDocRef.current,
          guides: previewGuidesRef.current || [],
          selectionBounds: previewSelectionBoundsRef.current,
        });
        previewDocRef.current = null;
      }
      previewGuidesRef.current = null;
      previewSelectionBoundsRef.current = null;
    });
  }, [renderer]);

  const prepareSelectionMoveRasterPreview = useCallback(async (
    baseDoc: PinselaTemplateDocV1,
    selectedIds: string[],
    token: number,
  ) => {
    const expandedIds = expandSelectionWithDescendants(baseDoc, selectedIds);
    if (!expandedIds.length) return;
    const bounds = selectionBounds(baseDoc, selectedIds);
    if (!bounds || !isBoundsFullyInsideDocCanvas(baseDoc, bounds)) return;
    const expandedSet = new Set(expandedIds);
    const selectedNodes = baseDoc.nodes.filter((node) => expandedSet.has(node.id));
    if (!selectedNodes.length) return;
    const hiddenBaseDoc = buildSelectionHiddenDoc(baseDoc, selectedIds);
    const { rasterizeNodesToPiece } = await loadSelectionRasterOps();
    const piece = await rasterizeNodesToPiece(baseDoc, selectedNodes, renderer.imageCacheRef.current);
    if (!piece || translateRasterPreviewTokenRef.current !== token) return;
    const session = translateSelectionSessionRef.current;
    if (!session || session.rasterToken !== token || session.duplicated) return;
    clearBufferedPreviewUpdates();
    session.hiddenBaseDoc = hiddenBaseDoc;
    session.rasterPreviewEnabled = true;
    setSelectionMoveRasterPreview({
      src: piece.dataUrl,
      x: piece.x,
      y: piece.y,
      width: piece.width,
      height: piece.height,
    });
    renderer.showPreviewScene({
      doc: hiddenBaseDoc,
      guides: [],
      selectionBounds: null,
    });
  }, [clearBufferedPreviewUpdates, renderer]);

  React.useEffect(() => () => {
    if (previewFrameRef.current != null) {
      window.cancelAnimationFrame(previewFrameRef.current);
      previewFrameRef.current = null;
    }
    if (previewClearFrameRef.current != null) {
      window.cancelAnimationFrame(previewClearFrameRef.current);
      previewClearFrameRef.current = null;
    }
    previewDocRef.current = null;
    previewGuidesRef.current = null;
    previewSelectionBoundsRef.current = null;
  }, []);

  const beginInlineTextEdit = useCallback((nodeId: string, text: string) => {
    const normalizedId = String(nodeId || "").trim();
    if (!normalizedId) return;
    engine.setSelection([normalizedId]);
    setLastNavigationTool("select");
    setActiveTool("select");
    inlineTextSessionRef.current = {
      nodeId: normalizedId,
      originalText: String(text || ""),
    };
    setInlineTextValue(String(text || ""));
    engine.setMode("text-edit");
  }, [engine]);

  const canvasMode = useMemo((): CanvasMode => {
    const mode = engine.mode;
    if (mode === "path-edit") return "path_edit";
    if (mode === "text-edit") return "text_edit";
    if (mode === "pan") return "pan";
    if (mode === "crop") return "crop";
    if (mode === "transform") return "transform";
    return "select";
  }, [engine.mode]);

  const setActiveLinePreset = useCallback((patch: Partial<{
    color: unknown;
    width: number;
    dashPreset: ContextToolbarLineState["dashPreset"];
    roundedEndpoints: boolean;
    opacity: number;
  }>) => {
    if (activeTool === "line") {
      setLineToolPreset((prev) => applyLinePresetPatch(prev, patch));
      return;
    }
    if (activeTool === "arrow") {
      setArrowToolPreset((prev) => applyLinePresetPatch(prev, patch));
      return;
    }
    if (isDrawTool(activeTool)) {
      setDrawToolPresets((prev) => ({
        ...prev,
        [activeTool]: applyLinePresetPatch(prev[activeTool] || DEFAULT_LINE_TOOL_PRESET, patch),
      }));
    }
  }, [activeTool]);

  const activateCanvasTool = useCallback((tool: CanvasToolId) => {
    if (tool === "media") {
      setLastInsertTool("media");
      setLastNavigationTool("select");
      setActiveTool("select");
      if (engine.mode !== "select") engine.setMode("select");
      openAddImagePicker();
      return;
    }
    setActiveTool(tool);
    if (tool === "select" || tool === "node" || tool === "hand") {
      setLastNavigationTool(tool);
    } else if (isInsertTool(tool)) {
      setLastInsertTool(tool);
    } else if (isDrawTool(tool)) {
      setLastDrawTool(tool);
    }

    if (tool === "hand") {
      if (engine.mode !== "pan") engine.setMode("pan");
      return;
    }
    if (tool === "select") {
      if (engine.mode !== "select") engine.setMode("select");
      return;
    }
    if (tool === "node") {
      if (engine.mode !== "path-edit") engine.setMode("path-edit");
      return;
    }
    if (engine.mode !== "select") {
      engine.setMode("select");
    }
  }, [engine, openAddImagePicker]);

  const selectionSummary = useMemo(() => computeSelectionSummary(engine.doc, engine.selection), [engine.doc, engine.selection]);
  const canvasSelectionSummary = useMemo<SelectionSummary>(() => {
    if (selectionSummary.count > 0) return selectionSummary;
    if (isInsertShapeTool(activeTool)) {
      return {
        kind: activeTool === "frame"
          ? "single_frame"
          : activeTool === "auto_layout"
            ? "single_group"
            : "single_shape",
        count: 1,
        isMixed: false,
        primaryType: activeTool === "frame" ? "frame" : activeTool === "auto_layout" ? "group" : "rect",
        shapeType: activeTool === "frame" || activeTool === "auto_layout" ? undefined : "rect",
        selectedIds: [],
      };
    }
    if (isInsertLineTool(activeTool) || isDrawTool(activeTool)) {
      return {
        kind: "single_shape",
        count: 1,
        isMixed: false,
        primaryType: "line",
        shapeType: "line",
        selectedIds: [],
      };
    }
    if (activeTool === "text") {
      return {
        kind: "single_text",
        count: 1,
        isMixed: false,
        primaryType: "text",
        selectedIds: [],
      };
    }
    return selectionSummary;
  }, [selectionSummary, activeTool]);
  const deferredPanelDoc = useDeferredValue(engine.doc);
  const documentColors = useMemo(() => collectNodeDocumentColors(deferredPanelDoc), [deferredPanelDoc]);
  const automationBindingFields = useMemo<AutomationBindingField[]>(
    () => collectAutomationBindingFields(deferredPanelDoc),
    [deferredPanelDoc],
  );
  const traceImageOptions = useMemo(() => {
    return deferredPanelDoc.nodes
      .filter((node) => node.kind === "image")
      .map((node, index) => ({
        id: node.id,
        name: String(node.name || "").trim() || `Image ${index + 1}`,
        src: node.image_src || null,
      }));
  }, [deferredPanelDoc.nodes]);
  const selectionRotationBaseDeg = useMemo(() => {
    if (!engine.selection.length) return 0;
    const firstSelected = engine.selectedNode?.id === engine.selection[0]
      ? engine.selectedNode
      : engine.doc.nodes.find((node) => node.id === engine.selection[0]);
    return Number(firstSelected?.geometry.rotation || 0);
  }, [engine.doc.nodes, engine.selectedNode, engine.selection]);
  const pathEditData = useMemo(() => {
    if (activeTool !== "node") return null;
    if (engine.selection.length !== 1) return null;
    const node = engine.selectedNode;
    if (!node || node.kind !== "path") return null;
    return pathEditWorldData(node, selectedPathPointIndex);
  }, [activeTool, engine.selection.length, engine.selectedNode, selectedPathPointIndex]);

  React.useEffect(() => {
    if (activeTool !== "node") {
      if (selectedPathPointIndex != null) setSelectedPathPointIndex(null);
      return;
    }
    if (engine.selection.length !== 1 || engine.selectedNode?.kind !== "path") {
      if (selectedPathPointIndex != null) setSelectedPathPointIndex(null);
      return;
    }
    const pointCount = Array.isArray(engine.selectedNode.path_data?.points) ? engine.selectedNode.path_data!.points.length : 0;
    if (!pointCount) {
      if (selectedPathPointIndex != null) setSelectedPathPointIndex(null);
      return;
    }
    setSelectedPathPointIndex((current) => {
      if (current == null) return 0;
      return clampPathPointIndex(current, pointCount);
    });
  }, [activeTool, engine.selection.length, engine.selectedNode, selectedPathPointIndex]);

  React.useEffect(() => {
    if (engine.selectedNode?.kind !== "image") return;
    const selectedImageId = String(engine.selectedNode.id || "").trim();
    if (!selectedImageId) return;
    setTraceTargetImageId((current) => (current === selectedImageId ? current : selectedImageId));
  }, [engine.selectedNode?.id, engine.selectedNode?.kind]);

  React.useEffect(() => {
    if (!traceImageOptions.length) {
      if (traceTargetImageId != null) setTraceTargetImageId(null);
      return;
    }
    const currentId = String(traceTargetImageId || "").trim();
    if (currentId && traceImageOptions.some((entry) => entry.id === currentId)) return;
    const selectedId = engine.selectedNode?.kind === "image" ? String(engine.selectedNode.id || "").trim() : "";
    const fallbackId =
      (selectedId && traceImageOptions.some((entry) => entry.id === selectedId))
        ? selectedId
        : traceImageOptions[0].id;
    if (fallbackId !== traceTargetImageId) {
      setTraceTargetImageId(fallbackId);
    }
  }, [traceImageOptions, traceTargetImageId, engine.selectedNode?.id, engine.selectedNode?.kind]);
  React.useEffect(() => {
    const doc = engine.doc;
    let cancelled = false;
    let idleHandle: number | null = null;
    let frameHandle: number | null = null;
    const normalizeLegacyCircles = () => {
      if (cancelled || !doc.nodes.some(isLegacyCircleNode)) return;
      let changed = false;
      const nextNodes: PinselaNode[] = doc.nodes.map((node) => {
        if (!isLegacyCircleNode(node)) return node;
        if (isEllipseShape(node) && Number(node.geometry?.corner_radius || 0) === 0) return node;
        changed = true;
        return {
          ...node,
          geometry: {
            ...node.geometry,
            corner_radius: 0,
          },
          style: {
            ...node.style,
            shape_type: "ellipse" as const,
          },
        };
      });
      if (!changed || cancelled) return;
      engine.replaceDoc({
        ...doc,
        nodes: nextNodes,
      });
    };
    const scheduler = window as Window & {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    if (typeof scheduler.requestIdleCallback === "function") {
      idleHandle = scheduler.requestIdleCallback(normalizeLegacyCircles, { timeout: 900 });
    } else {
      frameHandle = window.requestAnimationFrame(normalizeLegacyCircles);
    }
    return () => {
      cancelled = true;
      if (idleHandle != null && typeof scheduler.cancelIdleCallback === "function") {
        scheduler.cancelIdleCallback(idleHandle);
      }
      if (frameHandle != null) {
        window.cancelAnimationFrame(frameHandle);
      }
    };
  }, [engine.doc, engine.replaceDoc]);
  const isSelectionLocked = useMemo(
    () => areSelectionAllLocked(engine.doc, engine.selection),
    [engine.doc, engine.selection],
  );

  const historyEntries = useMemo<LeftPanelHistoryItem[]>(() => {
    const entries: LeftPanelHistoryItem[] = [{ id: "present", label: "Current state", active: true }];
    const past = engine.store.history.past;
    for (let idx = past.length - 1; idx >= 0; idx -= 1) {
      const stepsBack = past.length - idx;
      entries.push({
        id: `past-${idx}`,
        label: stepsBack === 1 ? "Previous change" : `${stepsBack} changes back`,
      });
    }
    return entries;
  }, [engine.store.history]);
  const deferredLayers = useDeferredValue(engine.layerNodes);
  const deferredSelectedNode = useDeferredValue(engine.selectedNode);
  const deferredSelectionSummary = useDeferredValue(selectionSummary);
  const deferredHistoryEntries = useDeferredValue(historyEntries);

  const zoomPercent = engineZoomToUiPercent(renderer.zoom);
  const deferredZoomPercent = useDeferredValue(zoomPercent);
  const activeProjectPage = useMemo(() => (
    projectPages.find((page) => page.id === activeProjectPageId)
    || projectPages[0]
    || null
  ), [projectPages, activeProjectPageId]);
  const canvasProjectPages = useMemo(() => (
    editorReady ? buildProjectPagesSnapshot(engine.doc) : projectPages
  ), [buildProjectPagesSnapshot, editorReady, engine.doc, projectPages]);
  const displayProjectName = (api.projectName || sandboxConfig.name || "Untitled").trim() || "Untitled";
  const canvasLabel = editorReady
    ? `${Math.max(1, Math.round(Number(engine.doc.canvas.width || chosenFormat?.width || 1)))} × ${Math.max(1, Math.round(Number(engine.doc.canvas.height || chosenFormat?.height || 1)))} px`
    : "";
  const formatLabel = chosenFormat
    ? `${chosenFormat.width} × ${chosenFormat.height} px`
    : "No format";

  const textToolbarState = useMemo(() => {
    const node = engine.selectedNode;
    if (!node || node.kind !== "text") {
      if (activeTool === "text") {
        return {
          fontFamily: textToolPreset.fontFamily,
          fontStyle: textToolPreset.fontStyle,
          fontSize: textToolPreset.fontSize,
          lineHeight: textToolPreset.lineHeight,
          tracking: textToolPreset.tracking,
          color: textToolPreset.color,
          textAlign: textToolPreset.textAlign,
          fitMode: textToolPreset.fitMode,
          canItalic: fontFamilySupportsItalic(textToolPreset.fontFamily),
          canUnderline: true,
          bold: textToolPreset.bold,
          italic: textToolPreset.italic,
          underline: textToolPreset.underline,
          radius: 120,
          startAngle: 0,
          sweepAngle: 180,
          hasPath: false,
        };
      }
      return {
        fontFamily: "Inter",
        fontStyle: "Regular",
        fontSize: 42,
        lineHeight: 120,
        tracking: 0,
        color: "#2563eb",
        textAlign: "left" as const,
        fitMode: "free" as const,
        canItalic: true,
        canUnderline: true,
        bold: false,
        italic: false,
        underline: false,
        radius: 120,
        startAngle: 0,
        sweepAngle: 180,
        hasPath: false,
      };
    }

    const style = node.text_style || {};
    const styleLabel = String(style.style || "Regular").trim() || "Regular";
    const styleName = styleLabel.toLowerCase();
    return {
      fontFamily: String(style.family || "Inter"),
      fontStyle: styleLabel,
      fontSize: Number(style.size || 42),
      lineHeight: Number(style.line_height || 120),
      tracking: Number(style.letter_spacing || 0),
      color: (style as any).color ?? "#2563eb",
      textAlign: String(style.text_align || "left") as "left" | "center" | "right" | "justify",
      fitMode: node.fit ? "fit" as const : "free" as const,
      canItalic: fontFamilySupportsItalic(String(style.family || "Inter")),
      canUnderline: true,
      bold: styleName.includes("bold"),
      italic: styleName.includes("italic"),
      underline: Boolean((style as any).underline),
      radius: Number(node.text_path?.radius || 120),
      startAngle: Number(node.text_path?.start_angle || 0),
      sweepAngle: Number(node.text_path?.sweep_angle || 180),
      hasPath: Boolean(node.text_path),
    };
  }, [engine.selectedNode, activeTool, textToolPreset]);

  const shapeToolbarState = useMemo(() => {
    const node = engine.selectedNode;
    if (!node) {
      if (isInsertShapeTool(activeTool)) {
        const disableRadius = activeTool === "ellipse" || activeTool === "polygon" || activeTool === "star";
        const isFrameTool = activeTool === "frame";
        const presetStrokeWidth = Math.max(0, Math.round(Number(shapeToolPreset.strokeWidth || 0)));
        const strokeWidth = isFrameTool
          ? presetStrokeWidth
          : (shapeToolPreset.strokeEnabled ? presetStrokeWidth : 0);
        return {
          cornerRadius: disableRadius ? 0 : Math.max(0, Math.round(shapeToolPreset.cornerRadius)),
          maxCornerRadius: disableRadius ? 0 : 240,
          fill: isFrameTool ? "rgba(0,0,0,0)" : shapeToolPreset.fill,
          stroke: shapeToolPreset.stroke,
          strokeWidth,
          strokeDashPreset: shapeToolPreset.strokeDashPreset,
          strokeEnabled: strokeWidth > 0,
        };
      }
      return {
        cornerRadius: 0,
        maxCornerRadius: 240,
        fill: "#2563eb",
        stroke: "#0f172a",
        strokeWidth: 0,
        strokeDashPreset: "solid" as const,
        strokeEnabled: false,
      };
    }
    const radiusLocked = isRadiusLockedShape(node);
    const maxCornerRadius = Math.max(8, Math.round(Math.min(
      Number(node.geometry?.width || 0),
      Number(node.geometry?.height || 0),
    ) / 2));
    const rawStroke = (node.style?.stroke && typeof node.style.stroke === "object")
      ? (node.style.stroke as Record<string, unknown>)
      : null;
    const strokeStack = sanitizeStrokeStack(node.style?.strokes);
    const primaryStackStroke = strokeStack.find((entry) => (
      entry.enabled !== false
      && entry.visible !== false
      && Number(entry.weight || 0) > 0
    )) || null;
    const rawStrokeWidth = primaryStackStroke ? Number(primaryStackStroke.weight) : rawStroke ? Number(rawStroke.width) : 0;
    const strokeWidth = Number.isFinite(rawStrokeWidth) ? Math.max(0, Math.round(rawStrokeWidth)) : 0;
    const dash = rawStroke && Array.isArray(rawStroke.dash)
      ? (rawStroke.dash as unknown[]).map((value) => Number(value)).filter(Number.isFinite)
      : [];
    const strokeDashPreset =
      primaryStackStroke?.style
        ? primaryStackStroke.style
        : strokeWidth <= 0 ? "solid"
        : dash.length === 0 ? "solid"
          : dash.length >= 2 && dash[0] <= 3 ? "dotted"
            : dash.length >= 2 && dash[0] >= 16 ? "long_dash"
              : "dash";
    const baseStrokeColor = node.kind === "text"
      ? ((node.text_style as Record<string, unknown> | undefined)?.color ?? node.style?.fill ?? "#0f172a")
      : (node.style?.fill ?? "#0f172a");
    const strokeColor = primaryStackStroke
      ? primaryStackStroke.color
      : rawStroke
      ? (rawStroke.color ?? baseStrokeColor)
      : baseStrokeColor;
    const rawShapeType = String((node.style as Record<string, unknown> | undefined)?.shape_type || "").toLowerCase();
    return {
      cornerRadius: radiusLocked ? 0 : Math.max(0, Math.round(Number(node.geometry?.corner_radius || 0))),
      maxCornerRadius: radiusLocked ? 0 : maxCornerRadius,
      fill: node.kind === "frame" ? "rgba(0,0,0,0)" : (node.style?.fill || "#2563eb"),
      stroke: strokeColor,
      strokeWidth,
      strokeDashPreset: strokeDashPreset as "solid" | "dash" | "long_dash" | "dotted",
      strokeEnabled: strokeWidth > 0,
      shapeType: rawShapeType,
      shapeSides: Math.max(3, Math.round(Number((node.style as Record<string, unknown> | undefined)?.shape_sides ?? 6))),
      starPoints: Math.max(4, Math.round(Number((node.style as Record<string, unknown> | undefined)?.star_points ?? 5))),
    };
  }, [engine.selectedNode, activeTool, shapeToolPreset]);

  const inlineTextEditOverlay = useMemo<InlineTextEditOverlay | null>(() => {
    const session = inlineTextSessionRef.current;
    if (!session || inlineTextValue == null) return null;
    const node = engine.doc.nodes.find((candidate) => candidate.id === session.nodeId) || null;
    if (!node || node.kind !== "text") return null;
    const ts = node.text_style || {};
    const cssTextStyle = resolveTextCssStyle(ts as Record<string, unknown>);
    const metrics = computeInlineTextMetrics(node);
    return {
      nodeId: node.id,
      value: inlineTextValue,
      geometry: {
        x: Number(node.geometry.x || 0),
        y: Number(node.geometry.y || 0) + metrics.contentOffsetY,
        width: Number(node.geometry.width || 0),
        height: metrics.contentHeight,
        rotation: Number(node.geometry.rotation || 0),
      },
      style: {
        fontFamily: String(ts.family || "Inter"),
        fontSize: metrics.fontSize,
        lineHeight: metrics.lineHeight,
        fontWeight: cssTextStyle.fontWeight,
        fontStyle: cssTextStyle.fontStyle,
        letterSpacing: Number(ts.letter_spacing || 0),
        underline: Boolean((ts as Record<string, unknown>).underline),
        color: toSolidTextColor((ts as any).color ?? node.style.fill, "#111111"),
        textAlign: (ts.text_align as any) || "left",
      },
    };
  }, [engine.doc.nodes, inlineTextValue]);

  const lineToolbarState = useMemo(() => {
    const node = engine.selectedNode;
    if (!node || node.kind !== "line") {
      if (activeTool === "line") return lineToolPreset;
      if (activeTool === "arrow") return arrowToolPreset;
      if (isDrawTool(activeTool)) return drawToolPresets[activeTool] || DEFAULT_DRAW_TOOL_PRESET;
      return {
        color: "#3A3F47",
        width: 4,
        opacity: 100,
        dashPreset: "solid" as const,
        roundedEndpoints: true,
      };
    }
    const rawStroke = (node.style?.stroke && typeof node.style.stroke === "object")
      ? (node.style.stroke as Record<string, unknown>)
      : null;
    const color = rawStroke?.color ?? node.style?.fill ?? "#8B6D52";
    const width = Math.max(1, Math.round(Number(rawStroke?.width || 4)));
    const dash = Array.isArray(rawStroke?.dash) ? (rawStroke!.dash as unknown[]).map((v) => Number(v)).filter(Number.isFinite) : [];
    const dashPreset =
      dash.length === 0 ? "solid"
        : dash.length >= 2 && dash[0] <= 3 ? "dotted"
          : dash.length >= 2 && dash[0] >= 16 ? "long_dash"
            : "dash";
    return {
      color,
      width,
      opacity: Math.max(0, Math.min(100, Math.round(Number(node.style?.opacity ?? 1) * 100))),
      dashPreset: dashPreset as "solid" | "dash" | "long_dash" | "dotted",
      roundedEndpoints: String(rawStroke?.cap || "round") === "round",
    };
  }, [engine.selectedNode, activeTool, lineToolPreset, arrowToolPreset, drawToolPresets]);

  const elementOpacityState = useMemo<ContextToolbarElementOpacityState>(() => {
    if (!engine.selection.length) {
      if (isInsertShapeTool(activeTool)) return { opacity: shapeToolPreset.opacity };
      if (activeTool === "line") return { opacity: lineToolPreset.opacity };
      if (activeTool === "arrow") return { opacity: arrowToolPreset.opacity };
      if (isDrawTool(activeTool)) return { opacity: (drawToolPresets[activeTool] || DEFAULT_DRAW_TOOL_PRESET).opacity };
      if (activeTool === "text") return { opacity: textToolPreset.opacity };
      return { opacity: 100 };
    }
    const firstSelected = engine.selectedNode?.id === engine.selection[0]
      ? engine.selectedNode
      : engine.doc.nodes.find((node) => node.id === engine.selection[0]);
    return {
      opacity: Math.max(0, Math.min(100, Math.round(Number(firstSelected?.style?.opacity ?? 1) * 100))),
    };
  }, [engine.doc.nodes, engine.selectedNode, engine.selection, activeTool, shapeToolPreset.opacity, lineToolPreset.opacity, arrowToolPreset.opacity, drawToolPresets, textToolPreset.opacity]);

  const imageDuotoneState = useMemo<ContextToolbarImageDuotoneState>(() => {
    const node = engine.selectedNode;
    if (!node || node.kind !== "image") return DEFAULT_IMAGE_DUOTONE_SETTINGS;
    return normalizeImageDuotoneSettings(
      node.style?.image_duotone as Partial<PinselaImageDuotoneSettings> | null | undefined,
      DEFAULT_IMAGE_DUOTONE_SETTINGS,
    );
  }, [engine.selectedNode]);

  const imageFadeState = useMemo<ContextToolbarImageFadeState>(() => {
    const node = engine.selectedNode;
    const fade = node?.kind === "image"
      ? (node.style?.image_fade as PinselaImageFadeSettings | null | undefined)
      : null;
    const e = fade?.edges || {};
    return {
      enabled: Boolean(fade?.enabled),
      softness: Number(fade?.softness ?? 0),
      linear: fade?.linear
        ? { angle: Number(fade.linear.angle ?? 90), start: Number(fade.linear.start ?? 0), end: Number(fade.linear.end ?? 1) }
        : null,
      radial: fade?.radial
        ? {
            cx: Number(fade.radial.cx ?? 0.5),
            cy: Number(fade.radial.cy ?? 0.5),
            inner: Number(fade.radial.inner ?? 0.5),
            outer: Number(fade.radial.outer ?? 1),
          }
        : null,
      edges: {
        top: Number(e.top ?? 0),
        right: Number(e.right ?? 0),
        bottom: Number(e.bottom ?? 0),
        left: Number(e.left ?? 0),
      },
    };
  }, [engine.selectedNode]);

  const previousBrushNodeIdRef = useRef<string | null>(null);

  React.useEffect(() => {
    const node = engine.selectedNode;
    if (!node || node.kind !== "image") {
      setImageBrushState((prev) => ({ ...prev, enabled: false }));
      previousBrushNodeIdRef.current = null;
      return;
    }
    const normalized = normalizeImageBrushSettings(
      node.style?.image_brush_settings as Partial<PinselaImageBrushSettings> | null | undefined,
      imageBrushState,
    );
    setImageBrushState((prev) => ({
      ...normalized,
      enabled: previousBrushNodeIdRef.current === node.id ? prev.enabled : false,
    }));
    previousBrushNodeIdRef.current = node.id;
  }, [engine.selectedNode?.id, engine.selectedNode?.kind]);

  const patchSelectedNode = useCallback((patch: Partial<{
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    opacity: number;
    fill: unknown;
    layout: Partial<PinselaNode["layout"]>;
    clip: boolean;
    effects: PinselaNode["style"]["effects"];
  }>) => {
    engine.patchSelectedNode((node) => {
      const geometryPatch: Record<string, number> = {};
      if (patch.x != null) geometryPatch.x = patch.x;
      if (patch.y != null) geometryPatch.y = patch.y;
      if (patch.width != null) geometryPatch.width = patch.width;
      if (patch.height != null) geometryPatch.height = patch.height;
      if (patch.rotation != null) geometryPatch.rotation = patch.rotation;
      const currentStroke = (node.style?.stroke && typeof node.style.stroke === "object")
        ? (node.style.stroke as Record<string, unknown>)
        : {};
      const nextLineStroke = patch.fill != null && node.kind === "line"
        ? {
          ...currentStroke,
          color: patch.fill,
          width: Math.max(1, Number(currentStroke.width || 4)),
          dash: Array.isArray(currentStroke.dash) ? currentStroke.dash : [],
          cap: String(currentStroke.cap || "round") === "round" ? "round" : "butt",
        }
        : null;
      return {
        ...node,
        geometry: {
          ...node.geometry,
          ...geometryPatch,
          ...(patch.clip != null ? { clip: Boolean(patch.clip) } : {}),
        },
        ...(patch.layout ? { layout: { ...node.layout, ...patch.layout } } : {}),
        style: {
          ...node.style,
          ...(patch.opacity != null ? { opacity: patch.opacity } : {}),
          ...(patch.fill != null ? { fill: patch.fill } : {}),
          ...(patch.effects != null ? { effects: patch.effects } : {}),
          ...(nextLineStroke ? { stroke: nextLineStroke } : {}),
        },
      };
    });
  }, [engine]);

  const patchSelectedLineStyle = useCallback((
    patch: Partial<{
      color: unknown;
      width: number;
      dashPreset: "solid" | "dash" | "long_dash" | "dotted";
      roundedEndpoints: boolean;
      opacity: number; // 0..100
    }>,
  ) => {
    engine.patchSelectedNode((node) => {
      if (node.kind !== "line") return node;
      const currentStroke = (node.style?.stroke && typeof node.style.stroke === "object")
        ? (node.style.stroke as Record<string, unknown>)
        : {};
      const nextDash = patch.dashPreset
        ? (
          patch.dashPreset === "solid" ? []
            : patch.dashPreset === "dash" ? [10, 8]
              : patch.dashPreset === "long_dash" ? [18, 10]
                : [2, 6]
        )
        : (Array.isArray(currentStroke.dash) ? currentStroke.dash : []);
      const nextStroke = {
        ...currentStroke,
        color: patch.color ?? currentStroke.color ?? node.style?.fill ?? "#8B6D52",
        width: patch.width != null ? Math.max(1, Math.round(patch.width)) : Math.max(1, Number(currentStroke.width || 4)),
        dash: nextDash,
        cap: patch.roundedEndpoints != null ? (patch.roundedEndpoints ? "round" : "butt") : (String(currentStroke.cap || "round") === "round" ? "round" : "butt"),
      };
      return {
        ...node,
        style: {
          ...node.style,
          ...(patch.color !== undefined ? { fill: patch.color } : {}),
          stroke: nextStroke,
          ...(patch.opacity != null ? { opacity: Math.max(0, Math.min(100, patch.opacity)) / 100 } : {}),
        },
      };
    });
  }, [engine]);

  const buildShapeStrokePatchDoc = useCallback((
    sourceDoc: PinselaTemplateDocV1,
    ids: string[],
    patch: Partial<{
      enabled: boolean;
      color: unknown;
      width: number;
      dashPreset: ShapeToolPreset["strokeDashPreset"];
    }>,
  ): PinselaTemplateDocV1 => {
    const selectedSet = new Set(ids);
    return {
      ...sourceDoc,
      nodes: sourceDoc.nodes.map((node) => {
        if (!selectedSet.has(node.id)) return node;
        if (node.kind !== "rect" && node.kind !== "path") return node;

        const currentStroke = (node.style?.stroke && typeof node.style.stroke === "object")
          ? (node.style.stroke as Record<string, unknown>)
          : {};
        const currentStack = sanitizeStrokeStack(node.style?.strokes);
        const primaryStackStroke = currentStack.find((entry) => (
          entry.enabled !== false
          && entry.visible !== false
          && Number(entry.weight || 0) > 0
        )) || currentStack[0] || null;
        const fallbackWidth = primaryStackStroke
          ? Number(primaryStackStroke.weight || 2)
          : Number(currentStroke.width || 2);
        const nextWidth = patch.width != null
          ? Math.max(0, Math.round(Number(patch.width)))
          : Math.max(1, Math.round(Number(fallbackWidth || 2)));
        const nextEnabled = patch.enabled ?? (patch.color !== undefined || patch.width !== undefined || nextWidth > 0);

        if (!nextEnabled || nextWidth <= 0) {
          return {
            ...node,
            style: {
              ...node.style,
              stroke: null,
              strokes: currentStack.length
                ? currentStack.map((entry, index) => normalizeStrokeStackItem({
                  ...entry,
                  enabled: false,
                  visible: false,
                  weight: 0,
                }, index))
                : null,
            },
          };
        }

        const nextDashPreset = patch.dashPreset
          || (primaryStackStroke?.style as ShapeToolPreset["strokeDashPreset"] | undefined)
          || dashPresetFromSegments(currentStroke.dash);
        const nextColor = patch.color ?? primaryStackStroke?.color ?? currentStroke.color ?? "#0f172a";
        const nextStroke = {
          ...currentStroke,
          color: nextColor,
          width: nextWidth,
          dash: dashPresetToSegments(nextDashPreset),
          cap: String(currentStroke.cap || primaryStackStroke?.cap || "round") === "butt" ? "butt" : "round",
          join: currentStroke.join || primaryStackStroke?.join || "round",
          align: currentStroke.align || primaryStackStroke?.align || "center",
        };
        const nextStyle: PinselaNode["style"] = {
          ...node.style,
          stroke: nextStroke,
        };
        if (currentStack.length > 0) {
          nextStyle.strokes = currentStack.map((entry, index) => (
            index === 0
              ? normalizeStrokeStackItem({
                ...entry,
                enabled: true,
                visible: true,
                color: nextColor,
                weight: nextWidth,
                style: nextDashPreset,
                cap: entry.cap || "round",
                join: entry.join || "round",
              }, index)
              : entry
          ));
        }
        return {
          ...node,
          style: nextStyle,
        };
      }),
    };
  }, []);

  const patchSelectedShapeStroke = useCallback((
    patch: Parameters<typeof buildShapeStrokePatchDoc>[2],
  ) => {
    if (!engine.selection.length) return;
    engine.commitDoc(buildShapeStrokePatchDoc(engine.doc, engine.selection, patch));
  }, [buildShapeStrokePatchDoc, engine]);

  const setSelectedStrokeStack = useCallback((strokes: PinselaStrokeStackItem[]) => {
    engine.patchSelectedNode((node) => {
      const normalized = sanitizeStrokeStack(strokes).map((entry, index) => normalizeStrokeStackItem(entry, index));
      const compatStroke = compatStrokeFromStack(normalized);
      return {
        ...node,
        style: {
          ...node.style,
          ...(node.kind === "line" && compatStroke?.color != null ? { fill: compatStroke.color } : {}),
          strokes: normalized,
          stroke: compatStroke,
        },
      };
    });
  }, [engine]);

  const patchSelectionOpacity = useCallback((opacityPercent: number) => {
    const nextOpacity = Math.max(0, Math.min(100, Number(opacityPercent))) / 100;
    if (!engine.selection.length) return;
    if (engine.selection.length === 1) {
      patchSelectedNode({ opacity: nextOpacity });
      return;
    }
    const selectedSet = new Set(engine.selection);
    const nextDoc: PinselaTemplateDocV1 = {
      ...engine.doc,
      nodes: engine.doc.nodes.map((node) => (
        selectedSet.has(node.id)
          ? {
            ...node,
            style: {
              ...node.style,
              opacity: nextOpacity,
            },
          }
          : node
      )),
    };
    engine.commitDoc(nextDoc);
  }, [engine, patchSelectedNode]);

  const applyImageBrushPatch = useCallback((payload?: Record<string, unknown>) => {
    if (engine.selectedNode?.kind !== "image") return;
    const nextMode = String(payload?.mode || imageBrushState.mode).toLowerCase() === "erase" ? "erase" : "shadow";
    const rawPatch = payload?.settings && typeof payload.settings === "object"
      ? (payload.settings as Partial<PinselaImageBrushSettings>)
      : {};
    const nextSettings = normalizeImageBrushSettings(
      {
        ...toStoredBrushSettings(imageBrushState),
        ...rawPatch,
        mode: nextMode,
        ...(payload?.color !== undefined ? { color: payload.color } : {}),
      },
      imageBrushState,
    );
    const enabled = payload?.enabled != null ? Boolean(payload.enabled) : imageBrushState.enabled;
    const nextState: ContextToolbarImageBrushState = { ...nextSettings, enabled };
    setImageBrushState(nextState);
    engine.patchSelectedNode((node) => {
      if (node.kind !== "image") return node;
      return {
        ...node,
        style: {
          ...node.style,
          image_brush_settings: toStoredBrushSettings(nextState),
        },
      };
    });
  }, [engine, imageBrushState]);

  const loadTraceImage = useCallback((src: string): Promise<HTMLImageElement> => {
    const key = String(src || "").trim();
    if (!key) return Promise.reject(new Error("The image source is empty."));
    const cached = traceImageCacheRef.current.get(key);
    if (cached && cached.complete && cached.naturalWidth > 0) {
      return Promise.resolve(cached);
    }
    return new Promise((resolve, reject) => {
      const img = new Image();
      if (/^https?:\/\//i.test(key)) {
        img.crossOrigin = "anonymous";
      }
      img.decoding = "async";
      img.onload = () => {
        traceImageCacheRef.current.set(key, img);
        resolve(img);
      };
      img.onerror = () => reject(new Error("Could not load the image for tracing."));
      img.src = key;
    });
  }, []);

  const cancelTracePreview = useCallback((keepSettings?: Partial<TraceSettings>) => {
    traceJobRef.current.seq += 1;
    if (traceJobRef.current.timer != null) {
      window.clearTimeout(traceJobRef.current.timer);
      traceJobRef.current.timer = null;
    }
    setTracePreview(null);
    setImageTraceState((prev) => ({
      edgeThreshold: keepSettings?.edgeThreshold != null ? clampPercent(keepSettings.edgeThreshold, prev.edgeThreshold) : prev.edgeThreshold,
      curveTolerance: keepSettings?.curveTolerance != null ? clampPercent(keepSettings.curveTolerance, prev.curveTolerance) : prev.curveTolerance,
      processing: false,
    }));
  }, []);

  const computeTracePreview = useCallback(async (
    node: PinselaNode,
    settings: TraceSettings,
  ): Promise<TracePreviewState | null> => {
    if (node.kind !== "image") return null;
    const src = String(node.image_src || "").trim();
    if (!src) return null;
    const image = await loadTraceImage(src);
    const result = await computeImageTrace(node, image, settings);
    if (!result || !result.polylines.length) {
      return {
        nodeId: node.id,
        edgeThreshold: settings.edgeThreshold,
        curveTolerance: settings.curveTolerance,
        polylines: [],
        pathData: [],
        strokeColor: result?.strokeColor || "#111111",
      };
    }
    return {
      nodeId: node.id,
      edgeThreshold: settings.edgeThreshold,
      curveTolerance: settings.curveTolerance,
      polylines: result.polylines,
      pathData: result.polylines.map((polyline) => polylinePathData(polyline.points)).filter(Boolean),
      strokeColor: result.strokeColor,
    };
  }, [loadTraceImage]);

  const scheduleTracePreview = useCallback((node: PinselaNode, settings: TraceSettings) => {
    const clampedSettings = {
      edgeThreshold: clampPercent(settings.edgeThreshold, imageTraceState.edgeThreshold),
      curveTolerance: clampPercent(settings.curveTolerance, imageTraceState.curveTolerance),
    };
    const seq = traceJobRef.current.seq + 1;
    traceJobRef.current.seq = seq;
    if (traceJobRef.current.timer != null) {
      window.clearTimeout(traceJobRef.current.timer);
      traceJobRef.current.timer = null;
    }
    setImageTraceState((prev) => ({
      edgeThreshold: clampedSettings.edgeThreshold,
      curveTolerance: clampedSettings.curveTolerance,
      processing: true,
    }));
    traceJobRef.current.timer = window.setTimeout(() => {
      void (async () => {
        try {
          const nextPreview = await computeTracePreview(node, clampedSettings);
          if (traceJobRef.current.seq !== seq) return;
          setTracePreview(nextPreview);
        } catch {
          if (traceJobRef.current.seq !== seq) return;
          setTracePreview(null);
        } finally {
          if (traceJobRef.current.seq === seq) {
            setImageTraceState((prev) => ({
              edgeThreshold: clampedSettings.edgeThreshold,
              curveTolerance: clampedSettings.curveTolerance,
              processing: false,
            }));
          }
        }
      })();
    }, 96);
  }, [computeTracePreview, imageTraceState.edgeThreshold, imageTraceState.curveTolerance]);

  React.useEffect(() => () => {
    if (traceJobRef.current.timer != null) {
      window.clearTimeout(traceJobRef.current.timer);
      traceJobRef.current.timer = null;
    }
  }, []);

  React.useEffect(() => {
    const selected = engine.selectedNode;
    if (!selected || selected.kind !== "image") {
      if (tracePreview) cancelTracePreview();
      return;
    }
    if (!tracePreview) return;
    if (tracePreview.nodeId !== selected.id) {
      cancelTracePreview();
    }
  }, [engine.selectedNode?.id, engine.selectedNode?.kind, tracePreview, cancelTracePreview]);

  const resolveTraceTargetNode = useCallback((requestedNodeId?: string | null): PinselaNode | null => {
    const requestedId = String(requestedNodeId || "").trim();
    if (requestedId) {
      const node = engine.doc.nodes.find((entry) => entry.id === requestedId);
      if (node && node.kind === "image") return node;
    }
    const selectedNode = engine.selectedNode;
    if (selectedNode && selectedNode.kind === "image") return selectedNode;
    const fallbackId = String(traceTargetImageId || "").trim();
    if (!fallbackId) return null;
    const fallbackNode = engine.doc.nodes.find((entry) => entry.id === fallbackId);
    if (!fallbackNode || fallbackNode.kind !== "image") return null;
    return fallbackNode;
  }, [engine.doc.nodes, engine.selectedNode, traceTargetImageId]);

  const runImageTraceAction = useCallback((payload?: Record<string, unknown>) => {
    const edgeThreshold = clampPercent(
      Number(payload?.edgeThreshold),
      imageTraceState.edgeThreshold,
    );
    const curveTolerance = clampPercent(
      Number(payload?.curveTolerance),
      imageTraceState.curveTolerance,
    );
    const phase = String(payload?.phase || "preview").toLowerCase();
    const requestedNodeId = typeof payload?.nodeId === "string" ? payload.nodeId : null;
    const targetNode = resolveTraceTargetNode(requestedNodeId);

    if (!targetNode || targetNode.kind !== "image") {
      cancelTracePreview({ edgeThreshold, curveTolerance });
      return;
    }

    if (targetNode.id !== traceTargetImageId) {
      setTraceTargetImageId(targetNode.id);
    }
    if (!engine.selectedNode || engine.selectedNode.id !== targetNode.id || engine.selectedNode.kind !== "image") {
      engine.setSelection([targetNode.id]);
    }

    if (phase === "cancel") {
      cancelTracePreview({ edgeThreshold, curveTolerance });
      return;
    }

    if (phase === "preview") {
      scheduleTracePreview(targetNode, { edgeThreshold, curveTolerance });
      return;
    }

    if (phase !== "apply") return;

    void (async () => {
      setImageTraceState({
        edgeThreshold,
        curveTolerance,
        processing: true,
      });
      let nextPreview = tracePreview;
      const isPreviewReusable = Boolean(
        nextPreview
        && nextPreview.nodeId === targetNode.id
        && Math.round(nextPreview.edgeThreshold) === Math.round(edgeThreshold)
        && Math.round(nextPreview.curveTolerance) === Math.round(curveTolerance),
      );
      if (!isPreviewReusable) {
        nextPreview = await computeTracePreview(targetNode, { edgeThreshold, curveTolerance });
      }
      const validPreview = nextPreview && nextPreview.polylines.length ? nextPreview : null;
      if (!validPreview) {
        cancelTracePreview({ edgeThreshold, curveTolerance });
        return;
      }
      const materialized = materializeTracePaths(
        engine.doc,
        targetNode,
        validPreview.polylines,
        validPreview.strokeColor,
      );
      if (!materialized) {
        cancelTracePreview({ edgeThreshold, curveTolerance });
        return;
      }
      engine.commitDoc(materialized.doc);
      engine.setSelection(materialized.pathIds);
      setActiveTab("properties");
      cancelTracePreview({ edgeThreshold, curveTolerance });
    })();
  }, [
    imageTraceState.edgeThreshold,
    imageTraceState.curveTolerance,
    resolveTraceTargetNode,
    traceTargetImageId,
    engine.selectedNode,
    engine,
    scheduleTracePreview,
    cancelTracePreview,
    tracePreview,
    computeTracePreview,
    setActiveTab,
  ]);

  const vectorizeNodesAsPaths = useCallback(async (
    sourceDoc: PinselaTemplateDocV1,
    nodeIds: string[],
    options?: Partial<{ edgeThreshold: number; curveTolerance: number; removeSources: boolean }>,
  ): Promise<{ doc: PinselaTemplateDocV1; pathIds: string[]; convertedNodeIds: string[] }> => {
    const edgeThreshold = clampPercent(Number(options?.edgeThreshold), imageTraceState.edgeThreshold);
    const curveTolerance = clampPercent(Number(options?.curveTolerance), imageTraceState.curveTolerance);
    const removeSources = options?.removeSources !== false;
    let workingDoc = sourceDoc;
    const pathIds: string[] = [];
    const convertedNodeIds: string[] = [];
    const { rasterizeNodesToPiece } = await loadSelectionRasterOps();

    for (const nodeId of nodeIds) {
      const sourceNode = workingDoc.nodes.find((entry) => entry.id === nodeId);
      if (!sourceNode) continue;
      if (sourceNode.kind === "frame") continue;
      if (sourceNode.kind === "path") {
        pathIds.push(sourceNode.id);
        continue;
      }

      if (sourceNode.kind === "line" || sourceNode.kind === "rect") {
        const directPath = convertNodeToNativePath(sourceNode);
        if (directPath) {
          workingDoc = removeNodes(workingDoc, [sourceNode.id]);
          workingDoc = addNode(workingDoc, directPath);
          pathIds.push(directPath.id);
          convertedNodeIds.push(sourceNode.id);
          continue;
        }
      }

      let traceNode: PinselaNode | null = null;
      let traceImage: HTMLImageElement | null = null;

      if (sourceNode.kind === "image") {
        const src = String(sourceNode.image_src || "").trim();
        if (!src) continue;
        traceNode = sourceNode;
        try {
          traceImage = await loadTraceImage(src);
        } catch {
          continue;
        }
      } else {
        let piece: RasterizedPiece | null = null;
        try {
          piece = await rasterizeNodesToPiece(workingDoc, [sourceNode]);
        } catch {
          continue;
        }
        if (!piece) continue;
        const baseImage = defaultNode("image");
        traceNode = {
          ...baseImage,
          id: `trace_source_${sourceNode.id}`,
          name: `TRACE_${sourceNode.name || sourceNode.kind}`,
          parent_id: sourceNode.parent_id || null,
          children_ids: [],
          geometry: {
            ...baseImage.geometry,
            x: piece.x,
            y: piece.y,
            width: piece.width,
            height: piece.height,
            rotation: 0,
            corner_radius: 0,
            clip: false,
            z_index: Number(sourceNode.geometry?.z_index || 0),
          },
          style: {
            ...baseImage.style,
            opacity: clampRange(Number(sourceNode.style?.opacity), 0, 1, 1),
            image_fit: "fill",
            image_crop: null,
          },
          image_src: piece.dataUrl,
        };
        try {
          traceImage = await loadTraceImage(piece.dataUrl);
        } catch {
          continue;
        }
      }

      if (!traceNode || !traceImage) continue;
      let traced: TraceVectorResult | null = null;
      try {
        traced = await computeImageTrace(traceNode, traceImage, { edgeThreshold, curveTolerance });
      } catch {
        continue;
      }
      if (!traced || !traced.polylines.length) continue;
      const materialized = materializeTracePaths(workingDoc, traceNode, traced.polylines, traced.strokeColor);
      if (!materialized || !materialized.pathIds.length) continue;
      workingDoc = materialized.doc;
      pathIds.push(...materialized.pathIds);
      convertedNodeIds.push(sourceNode.id);
    }

    if (removeSources && convertedNodeIds.length) {
      workingDoc = removeNodes(workingDoc, convertedNodeIds);
    }

    return {
      doc: workingDoc,
      pathIds,
      convertedNodeIds,
    };
  }, [imageTraceState.edgeThreshold, imageTraceState.curveTolerance, loadTraceImage]);

  const jumpToHistory = useCallback((index: number) => {
    if (index <= 0) return;
    let history = engine.store.history;
    for (let i = 0; i < index; i += 1) {
      if (!history.past.length) break;
      history = historyUndo(history);
    }
    engine.dispatch({ type: "set_history", history });
  }, [engine]);

  const insertNodeFromPanel = useCallback((kind: PinselaNode["kind"], overrides?: Partial<PinselaNode>) => {
    const base = defaultNode(kind);
    const frameSeed = kind === "frame"
      ? {
        name: "Frame",
        geometry: {
          width: 420,
          height: 420,
          corner_radius: 18,
          clip: true,
        },
        style: {
          fill: "rgba(0,0,0,0)",
          stroke: null,
          image_fit: "fill" as const,
        },
      }
      : null;
    const seededBase = frameSeed
      ? {
        ...base,
        ...frameSeed,
        geometry: { ...base.geometry, ...frameSeed.geometry },
        style: { ...base.style, ...frameSeed.style },
      }
      : base;
    const nextNode = {
      ...seededBase,
      ...(overrides || {}),
      geometry: { ...seededBase.geometry, ...(overrides?.geometry || {}) },
      style: { ...seededBase.style, ...(overrides?.style || {}) },
      text_style: { ...(seededBase.text_style || {}), ...((overrides as any)?.text_style || {}) },
    };
    // Guard against invisible text: a freshly inserted text whose colour matches the
    // canvas background (e.g. the white "Title" preset on a white canvas) is flipped to a
    // contrasting tone so the user never types into thin air.
    if (nextNode.kind === "text") {
      const lumOf = (raw?: unknown): number | null => {
        const s = String(raw ?? "").trim().toLowerCase();
        if (!s) return null;
        const hex = s.replace(/^#/, "");
        let r: number, g: number, b: number;
        if (/^[0-9a-f]{3}$/.test(hex)) {
          r = parseInt(hex[0] + hex[0], 16); g = parseInt(hex[1] + hex[1], 16); b = parseInt(hex[2] + hex[2], 16);
        } else if (/^[0-9a-f]{6}$/.test(hex)) {
          r = parseInt(hex.slice(0, 2), 16); g = parseInt(hex.slice(2, 4), 16); b = parseInt(hex.slice(4, 6), 16);
        } else {
          const m = s.match(/rgba?\(([^)]+)\)/);
          if (!m) return null;
          const parts = m[1].split(",").map((x) => parseFloat(x));
          if (parts.length < 3 || parts.slice(0, 3).some((n) => Number.isNaN(n))) return null;
          [r, g, b] = parts;
        }
        return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      };
      const bgL = lumOf((engine.doc.canvas as Record<string, unknown> | undefined)?.background);
      const tsAny = (nextNode as Record<string, unknown>).text_style as Record<string, unknown> | undefined;
      const txtL = lumOf(tsAny?.color);
      if (bgL != null && txtL != null && Math.abs(bgL - txtL) < 0.22) {
        (nextNode as Record<string, unknown>).text_style = { ...(tsAny || {}), color: bgL > 0.5 ? "#1A1815" : "#F2ECE4" };
      }
    }
    const next = addNode(engine.doc, nextNode as any);
    engine.commitDoc(next);
    engine.setSelection([nextNode.id]);
    setActiveTab("properties");
  }, [engine]);

  const wrapSelectionInAutoLayout = useCallback(() => {
    const selectedIds = [...engine.selection];
    if (!selectedIds.length) {
      activateCanvasTool("auto_layout");
      return;
    }

    const selectedNodes = selectedIds
      .map((id) => engine.doc.nodes.find((node) => node.id === id))
      .filter(Boolean) as PinselaNode[];
    if (!selectedNodes.length) return;

    if (selectedNodes.length === 1) {
      const selected = selectedNodes[0];
      if (canHostAutoLayout(selected)) {
        const nextDoc: PinselaTemplateDocV1 = {
          ...engine.doc,
          nodes: engine.doc.nodes.map((node) => (
            node.id !== selected.id
              ? node
              : {
                ...node,
                layout: {
                  ...node.layout,
                  ...DEFAULT_AUTO_LAYOUT_LAYOUT_PATCH,
                },
                style: {
                  ...node.style,
                  ...(node.kind === "group" ? {
                    fill: node.style.fill ?? "rgba(102, 187, 255, 0.12)",
                    stroke: node.style.stroke ?? {
                      color: "rgba(77, 208, 255, 0.94)",
                      width: 2,
                      dash: [8, 6],
                      cap: "round",
                    },
                  } : {}),
                },
              }
          )),
        };
        engine.commitDoc(nextDoc);
        engine.setSelection([selected.id]);
        setActiveTab("properties");
        return;
      }

      const bounds = selectionBounds(engine.doc, [selected.id]);
      if (!bounds) return;
      const padding = 16;
      const container = defaultNode("group", {
        name: "AUTO LAYOUT",
        geometry: {
          x: Math.round(bounds.x - padding),
          y: Math.round(bounds.y - padding),
          width: Math.max(2, Math.round(bounds.w + padding * 2)),
          height: Math.max(2, Math.round(bounds.h + padding * 2)),
          rotation: 0,
          corner_radius: 0,
          clip: false,
          z_index: 0,
        },
        layout: {
          ...defaultNode("group").layout,
          ...DEFAULT_AUTO_LAYOUT_LAYOUT_PATCH,
        },
        style: {
          ...defaultNode("group").style,
          fill: "rgba(102, 187, 255, 0.12)",
          stroke: {
            color: "rgba(77, 208, 255, 0.94)",
            width: 2,
            dash: [8, 6],
            cap: "round",
          },
        },
      });
      let nextDoc = addNode(engine.doc, container);
      nextDoc = reparentNodesToContainer(nextDoc, [selected.id], container.id, { placement: "end" });
      engine.commitDoc(nextDoc);
      engine.setSelection([container.id]);
      setActiveTab("properties");
      return;
    }

    const grouped = groupSelectionIntoNewGroup(engine.doc, selectedIds);
    if (!grouped) return;
    const nextDoc: PinselaTemplateDocV1 = {
      ...grouped.doc,
      nodes: grouped.doc.nodes.map((node) => (
        node.id !== grouped.groupId
          ? node
          : {
            ...node,
            name: "AUTO LAYOUT",
            layout: {
              ...node.layout,
              ...DEFAULT_AUTO_LAYOUT_LAYOUT_PATCH,
            },
            style: {
              ...node.style,
              fill: "rgba(102, 187, 255, 0.12)",
              stroke: {
                color: "rgba(77, 208, 255, 0.94)",
                width: 2,
                dash: [8, 6],
                cap: "round",
              },
            },
          }
      )),
    };
    engine.commitDoc(nextDoc);
    engine.setSelection([grouped.groupId]);
    setActiveTab("properties");
  }, [engine, activateCanvasTool]);

  const onInsertShortcut = useCallback((kind: InsertShortcutKind) => {
    if (kind === "rect") {
      activateCanvasTool("rect");
      return;
    }
    if (kind === "circle") {
      activateCanvasTool("ellipse");
      return;
    }
    if (kind === "frame") {
      activateCanvasTool("frame");
      return;
    }
    if (kind === "line") {
      activateCanvasTool("line");
      return;
    }
    if (kind === "text") {
      activateCanvasTool("text");
      return;
    }
    if (kind === "image") {
      activateCanvasTool("media");
    }
  }, [activateCanvasTool]);

  const zoomByPreset = useCallback((dir: "in" | "out") => {
    // Snap to a sensible ladder instead of raw +/-10 so keyboard zoom lands on
    // working resolutions (50/66/75/100/150/200…) the way Canva/Figma do.
    const presets = [25, 33, 50, 66, 75, 100, 125, 150, 200, 300, 400, 500];
    const current = engineZoomToUiPercent(renderer.zoom);
    const next = dir === "in"
      ? (presets.find((p) => p > current + 0.5) ?? 500)
      : ([...presets].reverse().find((p) => p < current - 0.5) ?? 25);
    renderer.setZoom(uiPercentToEngineZoom(next));
  }, [renderer]);
  const handleZoomIn = useCallback(() => zoomByPreset("in"), [zoomByPreset]);
  const handleZoomOut = useCallback(() => zoomByPreset("out"), [zoomByPreset]);
  const [fitCenterSignal, setFitCenterSignal] = useState(0);
  // Fit = set the fit zoom AND recenter the active page (the bump tells
  // CanvasStage to re-center after the async zoom lands).
  const requestFitToScreen = useCallback(() => {
    renderer.fitToViewport(formatFitViewportPadding({ localSandbox: isLocalSandbox }));
    setFitCenterSignal((n) => n + 1);
  }, [renderer, isLocalSandbox]);
  // Cmd+0 mirrors the Fit button it is advertised on (was reset-to-100%).
  const handleZoomReset = useCallback(() => requestFitToScreen(), [requestFitToScreen]);
  const handleToolShortcut = useCallback((tool: "select" | "hand" | "pen" | "brush") => {
    activateCanvasTool(tool);
  }, [activateCanvasTool]);

  useKeyboardShortcuts(engine, {
    onInsertShortcut,
    onToolShortcut: handleToolShortcut,
    onZoomIn: handleZoomIn,
    onZoomOut: handleZoomOut,
    onZoomReset: handleZoomReset,
    onEscape: () => activateCanvasTool("select"),
  });

  const canvasCursorOverride = useMemo(() => {
    if (activeTool === "hand") return "grab";
    if (activeTool === "text") return "text";
    if (activeTool === "node") return "crosshair";
    if (activeTool === "select") return undefined;
    return "crosshair";
  }, [activeTool]);

  const toCanvasDocPointFromPointer = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const rawX = ((event.clientX - rect.left) / Math.max(1, rect.width)) * Math.max(1, Number(engine.doc.canvas.width || 1));
    const rawY = ((event.clientY - rect.top) / Math.max(1, rect.height)) * Math.max(1, Number(engine.doc.canvas.height || 1));
    return {
      x: clampRange(rawX, 0, Number(engine.doc.canvas.width || 1), 0),
      y: clampRange(rawY, 0, Number(engine.doc.canvas.height || 1), 0),
    };
  }, [engine.doc.canvas.width, engine.doc.canvas.height]);

  const buildTextStyleNameFromPreset = useCallback((preset: TextToolPreset): string => {
    const explicitStyle = String(preset.fontStyle || "").trim();
    if (explicitStyle) return explicitStyle;
    if (preset.bold && preset.italic) return "Bold Italic";
    if (preset.bold) return "Bold";
    if (preset.italic) return "Italic";
    return "Regular";
  }, []);

  const buildLineStrokeFromPreset = useCallback((preset: ContextToolbarLineState) => ({
    color: preset.color,
    width: Math.max(1, Math.round(Number(preset.width || 1))),
    dash: dashPresetToSegments(preset.dashPreset),
    cap: preset.roundedEndpoints ? "round" : "butt",
  }), []);

  const createTextNodeAtPoint = useCallback((point: { x: number; y: number }) => {
    const styleName = buildTextStyleNameFromPreset(textToolPreset);
    const fontSize = Math.max(6, Math.round(Number(textToolPreset.fontSize || 42)));
    const isFitText = textToolPreset.fitMode === "fit";
    const baseText = isFitText ? "Fit text" : "New text";
    const textWidth = isFitText
      ? Math.max(320, Math.round(fontSize * 8.2))
      : Math.max(220, Math.round(fontSize * 6.4));
    const textHeight = isFitText
      ? Math.max(128, Math.round(fontSize * 3))
      : Math.max(64, Math.round(fontSize * 1.8));
    const node = defaultNode("text", {
      name: "TEXT",
      text: baseText,
      text_model: isFitText ? "legacy" : "rich",
      fit: isFitText ? buildTextFitRule(fontSize) : null,
      geometry: {
        x: Math.max(0, Math.round(point.x)),
        y: Math.max(0, Math.round(point.y)),
        width: textWidth,
        height: textHeight,
        rotation: 0,
        corner_radius: 0,
        clip: false,
        z_index: 0,
      },
      style: {
        ...defaultNode("text").style,
        opacity: Math.max(0, Math.min(100, Number(textToolPreset.opacity || 100))) / 100,
      },
      text_style: {
        family: textToolPreset.fontFamily,
        style: styleName,
        postscript: buildTextPostscriptName(textToolPreset.fontFamily, styleName),
        size: fontSize,
        line_height: Math.max(60, Math.min(300, Math.round(Number(textToolPreset.lineHeight || 120)))),
        line_height_unit: "percent",
        letter_spacing: Math.round(Number(textToolPreset.tracking || 0)),
        text_align: textToolPreset.textAlign,
        vertical_align: "top",
        color: textToolPreset.color,
        underline: Boolean(textToolPreset.underline),
      } as any,
    });
    const nextDoc = addNode(engine.doc, node);
    engine.commitDoc(nextDoc);
    setActiveTab("properties");
    beginInlineTextEdit(node.id, baseText);
  }, [beginInlineTextEdit, buildTextStyleNameFromPreset, engine, textToolPreset]);

  const createInsertNodeForTool = useCallback((
    tool: "rect" | "ellipse" | "polygon" | "star" | "frame" | "auto_layout" | "line" | "arrow",
    start: { x: number; y: number },
  ): PinselaNode => {
    if (tool === "line" || tool === "arrow") {
      const preset = tool === "arrow" ? arrowToolPreset : lineToolPreset;
      return defaultNode("line", {
        name: tool === "arrow" ? "ARROW" : "LINE",
        geometry: {
          x: Math.round(start.x),
          y: Math.round(start.y),
          width: 1,
          height: 1,
          rotation: 0,
          corner_radius: 0,
          clip: false,
          z_index: 0,
        },
        style: {
          ...defaultNode("line").style,
          fill: preset.color,
          opacity: Math.max(0, Math.min(100, Number(preset.opacity || 100))) / 100,
          stroke: {
            ...buildLineStrokeFromPreset(preset),
            line_kind: tool === "arrow" ? "arrow_end" : "line",
          } as any,
        },
      });
    }

    if (tool === "frame") {
      return defaultNode("frame", {
        name: "FRAME",
        geometry: {
          x: Math.round(start.x),
          y: Math.round(start.y),
          width: 2,
          height: 2,
          rotation: 0,
          corner_radius: Math.max(0, Math.round(shapeToolPreset.cornerRadius)),
          clip: true,
          z_index: 0,
        },
        style: {
          ...defaultNode("frame").style,
          fill: "rgba(0,0,0,0)",
          opacity: Math.max(0, Math.min(100, Number(shapeToolPreset.opacity || 100))) / 100,
          stroke: null,
          image_fit: "fill",
        },
      });
    }

    if (tool === "auto_layout") {
      return defaultNode("group", {
        name: "AUTO LAYOUT",
        geometry: {
          x: Math.round(start.x),
          y: Math.round(start.y),
          width: 2,
          height: 2,
          rotation: 0,
          corner_radius: Math.max(0, Math.round(shapeToolPreset.cornerRadius ?? 0)),
          clip: false,
          z_index: 0,
        },
        layout: {
          ...defaultNode("group").layout,
          direction: "vertical",
          gap: 16,
          padding_top: 16,
          padding_right: 16,
          padding_bottom: 16,
          padding_left: 16,
          align_main: "start",
          align_cross: "start",
          sizing_mode: "fixed",
          wrap: false,
          wrap_mode: "flow",
          grid_columns: 0,
          grid_rows: 0,
        },
        style: {
          ...defaultNode("group").style,
          fill: "rgba(102, 187, 255, 0.12)",
          stroke: {
            color: "rgba(77, 208, 255, 0.94)",
            width: 2,
            dash: [8, 6],
            cap: "round",
          },
          opacity: 1,
        },
      });
    }

    const isEllipse = tool === "ellipse";
    const isPolygon = tool === "polygon";
    const isStar = tool === "star";
    const shapeStrokeWidth = shapeToolPreset.strokeEnabled
      ? Math.max(0, Math.round(shapeToolPreset.strokeWidth || 0))
      : 0;
    return defaultNode("rect", {
      name: tool.toUpperCase(),
      geometry: {
        x: Math.round(start.x),
        y: Math.round(start.y),
        width: 2,
        height: 2,
        rotation: 0,
        corner_radius: isEllipse || isPolygon || isStar ? 0 : Math.max(0, Math.round(shapeToolPreset.cornerRadius)),
        clip: false,
        z_index: 0,
      },
      style: {
        ...defaultNode("rect").style,
        fill: shapeToolPreset.fill,
        opacity: Math.max(0, Math.min(100, Number(shapeToolPreset.opacity || 100))) / 100,
        stroke: shapeStrokeWidth > 0
          ? {
            color: shapeToolPreset.stroke,
            width: shapeStrokeWidth,
            dash: dashPresetToSegments(shapeToolPreset.strokeDashPreset),
            cap: "round",
          }
          : null,
        shape_type: isEllipse ? "ellipse" : (isPolygon ? "polygon" : (isStar ? "star" : "rect")),
        // Only attach the discriminator a shape actually uses (no star metadata
        // polluting every rect/ellipse).
        ...(isPolygon ? { shape_sides: Math.max(3, Math.round(shapeToolPreset.polygonSides || 6)) } : {}),
        ...(isStar ? {
          star_points: Math.max(4, Math.round(shapeToolPreset.starPoints || 5)),
          star_inner_ratio: clampRange(Number(shapeToolPreset.starInnerRatio), 0.05, 0.95, 0.46),
        } : {}),
      } as any,
    });
  }, [lineToolPreset, arrowToolPreset, shapeToolPreset, buildLineStrokeFromPreset]);

  const buildDrawPathNode = useCallback((
    tool: DrawToolId,
    anchorsInput: PathAnchorSpec[],
    sourceStyle?: PinselaNode["style"] | null,
  ): PinselaNode | null => {
    const preset = drawToolPresets[tool] || DEFAULT_DRAW_TOOL_PRESET;
    const strokeWidth = Math.max(1, Math.round(Number(preset.width || 1)));
    const stroke = {
      ...buildLineStrokeFromPreset(preset),
      line_kind: tool,
      width: strokeWidth,
      color: preset.color,
    } as Record<string, unknown>;
    return buildPathNodeFromAnchors(anchorsInput, {
      closed: false,
      name: tool.toUpperCase(),
      parentId: null,
      sourceStyle: {
        ...defaultNode("path").style,
        ...(sourceStyle && typeof sourceStyle === "object" ? sourceStyle : {}),
        fill: "rgba(0,0,0,0)",
        opacity: Math.max(0, Math.min(100, Number(preset.opacity || 100))) / 100,
        stroke,
      },
      forceTransparentFill: true,
      strokeColor: preset.color,
      strokeWidth,
    });
  }, [drawToolPresets, buildLineStrokeFromPreset]);

  const buildCommittedDrawNode = useCallback((session: Extract<ToolPointerSession, { kind: "draw" }>) => {
    const anchors = session.anchors.length >= 2
      ? session.anchors
      : [
        session.anchors[0] || {
          x: round2(session.startPoint.x),
          y: round2(session.startPoint.y),
          mode: "corner" as const,
        },
        {
          x: round2(session.startPoint.x + 0.6),
          y: round2(session.startPoint.y + 0.6),
          mode: "corner" as const,
        },
      ];
    return buildDrawPathNode(session.tool, anchors, null);
  }, [buildDrawPathNode]);

  const onToolPointerDown = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (engine.mode !== "select" && activeTool !== "select") {
      pointer.onPointerDown(event);
      return;
    }
    if (activeTool === "select" || activeTool === "node") {
      pointer.onPointerDown(event);
      return;
    }
    if (activeTool === "hand" || activeTool === "media") return;
    const point = toCanvasDocPointFromPointer(event);

    if (activeTool === "text") {
      createTextNodeAtPoint(point);
      return;
    }

    if (isInsertShapeTool(activeTool)) {
      toolPointerSessionRef.current = {
        kind: "insert_shape",
        pointerId: event.pointerId,
        tool: activeTool,
        nodeId: null,
        startPoint: point,
        baseDoc: engine.doc,
        latestDoc: null,
        started: false,
      };
      event.currentTarget.setPointerCapture?.(event.pointerId);
      event.preventDefault();
      return;
    }

    if (isInsertLineTool(activeTool)) {
      toolPointerSessionRef.current = {
        kind: "insert_line",
        pointerId: event.pointerId,
        tool: activeTool,
        nodeId: null,
        startPoint: point,
        baseDoc: engine.doc,
        latestDoc: null,
        started: false,
      };
      event.currentTarget.setPointerCapture?.(event.pointerId);
      event.preventDefault();
      return;
    }

    if (isDrawTool(activeTool)) {
      toolPointerSessionRef.current = {
        kind: "draw",
        pointerId: event.pointerId,
        tool: activeTool,
        startPoint: point,
        lastPoint: point,
        baseDoc: engine.doc,
        latestDoc: null,
        nodeId: null,
        anchors: [{
          x: round2(point.x),
          y: round2(point.y),
          mode: "corner",
        }],
        moved: false,
      };
      event.currentTarget.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    }
  }, [activeTool, pointer, toCanvasDocPointFromPointer, createTextNodeAtPoint, engine]);

  const finalizeToolPointerSession = useCallback((session: ToolPointerSession) => {
    if (session.kind === "insert_shape" || session.kind === "insert_line") {
      if (session.started && session.latestDoc && session.nodeId) {
        commitTransientDoc(session.baseDoc, session.latestDoc);
        engine.setSelection([session.nodeId]);
        setActiveTab("properties");
        toolPointerSessionRef.current = null;
        // Sticky tool: stay in basic shape/line tools so you can draw several in
        // a row (Figma-style). Press V/Esc to return to Select. One-shot tools
        // (frame, auto-layout, image) still revert.
        const repeatable = activeTool === "rect" || activeTool === "ellipse"
          || activeTool === "polygon" || activeTool === "star"
          || activeTool === "line" || activeTool === "arrow";
        if (!repeatable) activateCanvasTool("select");
        return;
      }
      toolPointerSessionRef.current = null;
      return;
    }

    const committedNode = buildCommittedDrawNode(session);
    if (!committedNode) {
      toolPointerSessionRef.current = null;
      return;
    }
    if (!session.nodeId) {
      const nextDoc = addNode(session.baseDoc, committedNode);
      engine.commitDoc(nextDoc);
      engine.setSelection([committedNode.id]);
      setActiveTab("properties");
      toolPointerSessionRef.current = null;
      return;
    }

    const baseDoc = session.latestDoc || session.baseDoc;
    const nextDoc: PinselaTemplateDocV1 = {
      ...baseDoc,
      nodes: baseDoc.nodes.map((node) => (
        node.id !== session.nodeId
          ? node
          : {
            ...node,
            geometry: committedNode.geometry,
            style: {
              ...node.style,
              ...committedNode.style,
              fill: "rgba(0,0,0,0)",
            },
            path_data: committedNode.path_data,
          }
      )),
    };
    commitTransientDoc(session.baseDoc, nextDoc);
    engine.setSelection([session.nodeId]);
    setActiveTab("properties");
    toolPointerSessionRef.current = null;
  }, [commitTransientDoc, engine, buildCommittedDrawNode, activateCanvasTool]);

  const onToolPointerMove = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const session = toolPointerSessionRef.current;
    if (session && session.pointerId === event.pointerId) {
      if (event.buttons === 0) {
        safeReleasePointerCapture(event.currentTarget, event.pointerId);
        finalizeToolPointerSession(session);
        return;
      }
      const point = toCanvasDocPointFromPointer(event);

      if (session.kind === "insert_shape" || session.kind === "insert_line") {
        const dx = point.x - session.startPoint.x;
        const dy = point.y - session.startPoint.y;
        if (!session.started && Math.hypot(dx, dy) < INSERT_DRAG_THRESHOLD) return;

        if (!session.started) {
          const node = createInsertNodeForTool(session.tool, session.startPoint);
          const startDoc = addNode(session.baseDoc, node);
          session.nodeId = node.id;
          session.latestDoc = startDoc;
          session.started = true;
          engine.setSelection([node.id]);
          setActiveTab("properties");
        }

        if (!session.nodeId || !session.latestDoc) return;

        if (session.kind === "insert_shape") {
          const rect = {
            x: Math.round(Math.min(session.startPoint.x, point.x)),
            y: Math.round(Math.min(session.startPoint.y, point.y)),
            w: Math.max(2, Math.round(Math.abs(point.x - session.startPoint.x))),
            h: Math.max(2, Math.round(Math.abs(point.y - session.startPoint.y))),
          };
          const nextDoc = {
            ...session.latestDoc,
            nodes: session.latestDoc.nodes.map((node) => (
              node.id !== session.nodeId
                ? node
                : {
                  ...node,
                  geometry: {
                    ...node.geometry,
                    x: rect.x,
                    y: rect.y,
                    width: rect.w,
                    height: rect.h,
                  },
                }
            )),
          };
          session.latestDoc = nextDoc;
          engine.replaceDoc(nextDoc);
          return;
        }

        const nextDoc = {
          ...session.latestDoc,
          nodes: session.latestDoc.nodes.map((node) => (
            node.id !== session.nodeId
              ? node
              : {
                ...node,
                geometry: {
                  ...node.geometry,
                  x: Math.round(session.startPoint.x),
                  y: Math.round(session.startPoint.y),
                  width: Math.round(dx),
                  height: Math.round(dy),
                },
              }
          )),
        };
        session.latestDoc = nextDoc;
        engine.replaceDoc(nextDoc);
        return;
      }

      const distance = Math.hypot(point.x - session.lastPoint.x, point.y - session.lastPoint.y);
      const minStep = session.tool === "pen" ? 2.2 : session.tool === "pencil" ? 1.8 : 1.5;
      if (distance < minStep) return;
      const nextAnchor: PathAnchorSpec = {
        x: round2(point.x),
        y: round2(point.y),
        mode: "corner",
      };
      const lastAnchor = session.anchors[session.anchors.length - 1];
      if (
        lastAnchor
        && Math.abs(Number(lastAnchor.x || 0) - nextAnchor.x) <= 0.001
        && Math.abs(Number(lastAnchor.y || 0) - nextAnchor.y) <= 0.001
      ) {
        return;
      }
      session.anchors.push(nextAnchor);
      session.lastPoint = point;
      session.moved = true;
      if (!session.nodeId) {
        const created = buildCommittedDrawNode(session);
        if (!created) return;
        const startDoc = addNode(session.baseDoc, created);
        session.nodeId = created.id;
        session.latestDoc = startDoc;
        engine.setSelection([created.id]);
        setActiveTab("properties");
        engine.replaceDoc(startDoc);
        return;
      }
      if (!session.latestDoc) return;
      const updated = buildCommittedDrawNode(session);
      if (!updated) return;
      const nextDoc: PinselaTemplateDocV1 = {
        ...session.latestDoc,
        nodes: session.latestDoc.nodes.map((node) => (
          node.id !== session.nodeId
            ? node
            : {
              ...node,
              geometry: updated.geometry,
              style: {
                ...node.style,
                ...updated.style,
                fill: "rgba(0,0,0,0)",
              },
              path_data: updated.path_data,
            }
        )),
      };
      session.latestDoc = nextDoc;
      engine.replaceDoc(nextDoc);
      return;
    }

    if (engine.mode !== "select" && activeTool !== "select") {
      pointer.onPointerMove(event);
      return;
    }
    if (activeTool === "select" || activeTool === "node") {
      pointer.onPointerMove(event);
    }
  }, [activeTool, pointer, toCanvasDocPointFromPointer, engine, createInsertNodeForTool, buildCommittedDrawNode, finalizeToolPointerSession]);

  const onToolPointerUp = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const session = toolPointerSessionRef.current;
    if (session && session.pointerId === event.pointerId) {
      safeReleasePointerCapture(event.currentTarget, event.pointerId);
      finalizeToolPointerSession(session);
      return;
    }

    if (engine.mode !== "select" && activeTool !== "select") {
      pointer.onPointerUp(event);
      return;
    }
    if (activeTool === "select" || activeTool === "node") {
      pointer.onPointerUp(event);
    }
  }, [activeTool, pointer, finalizeToolPointerSession]);

  const applySelectionBooleanOperation = useCallback(async (operation: SelectionBooleanOperationId) => {
    const selectedIds = [...engine.selection];
    if (selectedIds.length !== 2) return;
    const baseDoc = engine.doc;
    const firstNode = baseDoc.nodes.find((node) => node.id === selectedIds[0]);
    const secondNode = baseDoc.nodes.find((node) => node.id === selectedIds[1]);
    if (!firstNode || !secondNode) return;

    const { rasterizeSelectionBooleanOperation } = await loadSelectionRasterOps();
    const pieces = await rasterizeSelectionBooleanOperation(
      baseDoc,
      firstNode,
      secondNode,
      operation,
    );
    if (!pieces.length) return;
    if (engine.doc !== baseDoc) return;

    let nextDoc = removeNodes(baseDoc, [firstNode.id, secondNode.id]);
    const newIds: string[] = [];
    pieces.forEach((piece, index) => {
      const nextNode = buildImageNodeFromRasterPiece(
        piece,
        pieces.length > 1 ? `BOOLEAN_${operation.toUpperCase()}_${index + 1}` : `BOOLEAN_${operation.toUpperCase()}`,
      );
      nextDoc = addNode(nextDoc, nextNode);
      newIds.push(nextNode.id);
    });

    engine.commitDoc(nextDoc);
    engine.setSelection(newIds);
    setActiveTab("properties");
  }, [engine]);

  const applySelectionPerspectiveWarp = useCallback(async (payload: SelectionPerspectiveWarpPayload) => {
    const selectedIds = [...engine.selection];
    if (!selectedIds.length) return;
    const baseDoc = engine.doc;
    const selectedNodes = selectedIds
      .map((id) => baseDoc.nodes.find((node) => node.id === id))
      .filter(Boolean) as PinselaNode[];
    if (!selectedNodes.length) return;

    const { rasterizePerspectiveWarp } = await loadSelectionRasterOps();
    const piece = await rasterizePerspectiveWarp(baseDoc, selectedNodes, payload);
    if (!piece) return;
    if (engine.doc !== baseDoc) return;

    let nextDoc = removeNodes(baseDoc, selectedIds);
    const warpedNode = buildImageNodeFromRasterPiece(piece, "PERSPECTIVE_WARP");
    nextDoc = addNode(nextDoc, warpedNode);
    engine.commitDoc(nextDoc);
    engine.setSelection([warpedNode.id]);
    setActiveTab("properties");
  }, [engine]);

  const parseImportFiles = useCallback(async (files: File[]): Promise<ImportedAssetEntry[]> => {
    const validFiles = Array.from(files || []).filter((file) => isImportFileLike(file));
    if (!validFiles.length) return [];

    return Promise.all(validFiles.map(async (file) => {
      const extension = getFileExtension(file.name);
      const mimeType = String(file.type || "").trim().toLowerCase();
      const name = String(file.name || "Import")
        .replace(/\.[^.]+$/, "")
        .replace(/\s+/g, " ")
        .trim() || "Import";
      const fingerprint = `${String(file.name || "").trim().toLowerCase()}::${Math.max(0, Number(file.size || 0))}::${Math.max(0, Number(file.lastModified || 0))}`;
      let parsed: Awaited<ReturnType<typeof parseImportAsset>> | null = null;
      try {
        parsed = await parseImportAsset(file);
      } catch {
        const fallbackSrc = createImportPlaceholderDataUrl(name, extension || "file", {
          subtitle: "Parser failed, fallback enabled",
          detail: "Import preserved for use on the canvas",
          accent: "#94a3b8",
        });
        parsed = {
          kind: inferImportKind(extension, mimeType),
          src: fallbackSrc,
          placementSrc: fallbackSrc,
          parseMode: "fallback",
          parser: `${extension || "file"}_exception_fallback`,
          intrinsicWidth: 960,
          intrinsicHeight: 720,
          detailLabel: "fallback after error",
          vectorPayload: undefined,
        };
      }

      return {
        id: uid("import"),
        fingerprint,
        name,
        extension,
        mimeType,
        sizeBytes: Math.max(0, Number(file.size || 0)),
        kind: parsed.kind,
        src: parsed.src,
        placementSrc: parsed.placementSrc,
        parseMode: parsed.parseMode,
        parser: parsed.parser,
        intrinsicWidth: parsed.intrinsicWidth,
        intrinsicHeight: parsed.intrinsicHeight,
        pageCount: parsed.pageCount,
        detailLabel: parsed.detailLabel,
        vectorPayload: parsed.vectorPayload,
      } satisfies ImportedAssetEntry;
    }));
  }, []);

  const resolveImportEntrySourceMetrics = useCallback(async (entry: ImportedAssetEntry) => {
    const src = String(entry.placementSrc || entry.src || "").trim();
    const vectorPayload = entry.vectorPayload && Array.isArray(entry.vectorPayload.elements) && entry.vectorPayload.elements.length
      ? entry.vectorPayload
      : null;
    let intrinsicSize: { width: number; height: number } | null = null;
    if (!vectorPayload && (!entry.intrinsicWidth || !entry.intrinsicHeight) && src) {
      intrinsicSize = await loadImageIntrinsicSize(src);
    }
    const sourceWidth = Math.max(1, Math.round(Number(
      vectorPayload?.width
      || entry.intrinsicWidth
      || intrinsicSize?.width
      || 960,
    )));
    const sourceHeight = Math.max(1, Math.round(Number(
      vectorPayload?.height
      || entry.intrinsicHeight
      || intrinsicSize?.height
      || 720,
    )));
    return {
      src,
      vectorPayload,
      sourceWidth,
      sourceHeight,
    };
  }, []);

  const materializeImportEntryOnDoc = useCallback(async (
    entry: ImportedAssetEntry,
    baseDoc: PinselaTemplateDocV1,
    options?: {
      point?: { x: number; y: number };
      nativeSize?: boolean;
    },
  ): Promise<{ nextDoc: PinselaTemplateDocV1; primarySelectionId: string | null } | null> => {
    const { src, vectorPayload, sourceWidth, sourceHeight } = await resolveImportEntrySourceMetrics(entry);
    if (!src && !vectorPayload) return null;

    const canvasWidth = Math.max(1, Number(baseDoc.canvas.width || 1));
    const canvasHeight = Math.max(1, Number(baseDoc.canvas.height || 1));
    const nativeSize = options?.nativeSize === true;
    const anchorPoint = options?.point || {
      x: Math.round(canvasWidth / 2),
      y: Math.round(canvasHeight / 2),
    };

    const width = nativeSize
      ? sourceWidth
      : Math.max(120, Math.round(sourceWidth * Math.min(1, Math.max(220, Math.round(canvasWidth * 0.82)) / sourceWidth, Math.max(220, Math.round(canvasHeight * 0.82)) / sourceHeight)));
    const height = nativeSize
      ? sourceHeight
      : Math.max(84, Math.round(sourceHeight * Math.min(1, Math.max(220, Math.round(canvasWidth * 0.82)) / sourceWidth, Math.max(220, Math.round(canvasHeight * 0.82)) / sourceHeight)));
    const x = nativeSize
      ? 0
      : Math.max(0, Math.min(canvasWidth - width, Math.round(Number(anchorPoint.x || 0) - width / 2)));
    const y = nativeSize
      ? 0
      : Math.max(0, Math.min(canvasHeight - height, Math.round(Number(anchorPoint.y || 0) - height / 2)));

    if (vectorPayload) {
      const groupId = uid("group");
      const scale = nativeSize ? 1 : width / Math.max(1, Number(vectorPayload.width || 1));
      const defaultGroupStyle = {
        ...defaultNode("group").style,
        fill: null,
        stroke: null,
        opacity: 1,
      };
      const defaultGroupGeometry = {
        x,
        y,
        width,
        height,
        rotation: 0,
        corner_radius: 0,
        clip: false,
        z_index: 0,
        transform_matrix: null,
      };
      type ImportedGroupState = {
        key: string;
        label: string;
        parentKey: string | null;
        depth: number;
        opacity: number;
        clipGeometry: ImportedSvgGroupClipGeometry | null;
        clipPath: ImportedVectorPathElement | null;
        directElementCount: number;
        descendantElementCount: number;
        childGroupKeys: Set<string>;
        childLeafIds: string[];
        materialize: boolean;
        entryNodeId: string | null;
        contentNodeId: string | null;
      };
      const groupStates = new Map<string, ImportedGroupState>();
      const ensureGroupState = (contexts: ImportedSvgGroupContext[], depth: number): ImportedGroupState | null => {
        if (!contexts.length || depth < 0 || depth >= contexts.length) return null;
        const key = contexts
          .slice(0, depth + 1)
          .map((context) => context.label)
          .join("\u241f");
        const existing = groupStates.get(key);
        if (existing) {
          if (existing.clipGeometry == null && contexts[depth]?.clipGeometry) {
            existing.clipGeometry = contexts[depth].clipGeometry || null;
          }
          if (existing.clipPath == null && contexts[depth]?.clipPath) {
            existing.clipPath = contexts[depth].clipPath || null;
          }
          if (existing.opacity >= 0.999 && contexts[depth]?.opacity != null) {
            existing.opacity = clampRange(Number(contexts[depth].opacity), 0, 1, 1);
          }
          return existing;
        }
        const parent = depth > 0 ? ensureGroupState(contexts, depth - 1) : null;
        const created: ImportedGroupState = {
          key,
          label: String(contexts[depth]?.label || "").trim() || `GROUP_${depth + 1}`,
          parentKey: parent?.key || null,
          depth,
          opacity: clampRange(Number(contexts[depth]?.opacity ?? 1), 0, 1, 1),
          clipGeometry: contexts[depth]?.clipGeometry || null,
          clipPath: contexts[depth]?.clipPath || null,
          directElementCount: 0,
          descendantElementCount: 0,
          childGroupKeys: new Set<string>(),
          childLeafIds: [],
          materialize: false,
          entryNodeId: null,
          contentNodeId: null,
        };
        if (parent) parent.childGroupKeys.add(created.key);
        groupStates.set(key, created);
        return created;
      };
      vectorPayload.elements.forEach((item) => {
        const contexts = normalizeImportedGroupContexts(item);
        contexts.forEach((_, depth) => {
          const state = ensureGroupState(contexts, depth);
          if (state) state.descendantElementCount += 1;
        });
        if (contexts.length) {
          const leafOwner = ensureGroupState(contexts, contexts.length - 1);
          if (leafOwner) leafOwner.directElementCount += 1;
        }
      });
      const isGenericImportedGroupLabel = (label: string): boolean => /^GROUP_\d+$/i.test(String(label || "").trim());
      Array.from(groupStates.values()).forEach((state) => {
        const structureNeedsContainer = (
          state.childGroupKeys.size + state.directElementCount > 1
          || (!state.parentKey && (!isGenericImportedGroupLabel(state.label) || state.descendantElementCount > 1))
        );
        const hasContext = state.opacity < 0.999 || !!state.clipGeometry || !!state.clipPath;
        const branchingCount = state.childGroupKeys.size + state.directElementCount;
        state.materialize = hasContext
          || branchingCount > 1
          || (!state.parentKey && (!isGenericImportedGroupLabel(state.label) || state.descendantElementCount > 1));
        if (state.materialize) {
          state.entryNodeId = uid(state.clipPath ? "clip" : "group");
          state.contentNodeId = state.clipPath && (state.opacity < 0.999 || structureNeedsContainer)
            ? uid("group")
            : state.entryNodeId;
        }
      });
      const resolveMaterializedParentId = (contexts: ImportedSvgGroupContext[]): string => {
        for (let depth = contexts.length - 1; depth >= 0; depth -= 1) {
          const key = contexts
            .slice(0, depth + 1)
            .map((context) => context.label)
            .join("\u241f");
          const state = groupStates.get(key);
          if (state?.materialize && state.contentNodeId) return state.contentNodeId;
        }
        return groupId;
      };
      const rawChildNodes = vectorPayload.elements
        .map((item) => {
          const contexts = normalizeImportedGroupContexts(item);
          const parentId = resolveMaterializedParentId(contexts);
          const node = buildNodeFromImportedVectorElement(item, {
            scale,
            offsetX: x,
            offsetY: y,
            parentId,
          });
          return node || null;
        })
        .filter(Boolean) as PinselaNode[];
      groupStates.forEach((state) => {
        state.childLeafIds = [];
      });
      const rootChildLeafIds: string[] = [];
      const childNodes = mergeImportedPathNodes(rawChildNodes);
      childNodes.forEach((node) => {
        const parentState = Array.from(groupStates.values()).find((state) => state.contentNodeId === node.parent_id) || null;
        if (parentState) {
          parentState.childLeafIds.push(node.id);
        } else {
          rootChildLeafIds.push(node.id);
        }
      });

      if (childNodes.length) {
        const childNodeById = new Map(childNodes.map((node) => [node.id, node] as const));
        const boundsCache = new Map<string, { x: number; y: number; width: number; height: number } | null>();
        const clipPathBoundsCache = new Map<string, { x: number; y: number; width: number; height: number } | null>();
        const resolveGroupClipPathBounds = (state: ImportedGroupState): { x: number; y: number; width: number; height: number } | null => {
          if (clipPathBoundsCache.has(state.key)) {
            return clipPathBoundsCache.get(state.key) || null;
          }
          const preview = state.clipPath
            ? buildImportedGroupClipPathNode(state.clipPath, {
                scale,
                offsetX: x,
                offsetY: y,
                parentId: null,
                name: state.label || "GROUP_CLIP",
              })
            : null;
          const bounds = preview ? computeImportedNodeBounds(preview) : null;
          clipPathBoundsCache.set(state.key, bounds);
          return bounds;
        };
        const resolveGroupBounds = (groupKey: string): { x: number; y: number; width: number; height: number } | null => {
          if (boundsCache.has(groupKey)) {
            return boundsCache.get(groupKey) || null;
          }
          const state = groupStates.get(groupKey) || null;
          if (!state) {
            boundsCache.set(groupKey, null);
            return null;
          }
          let bounds = state.clipGeometry
            ? {
                x: Number(scaleImportedGroupClipGeometry(state.clipGeometry, scale, x, y).x || 0),
                y: Number(scaleImportedGroupClipGeometry(state.clipGeometry, scale, x, y).y || 0),
                width: Math.max(1, Number(scaleImportedGroupClipGeometry(state.clipGeometry, scale, x, y).width || 0)),
                height: Math.max(1, Number(scaleImportedGroupClipGeometry(state.clipGeometry, scale, x, y).height || 0)),
              }
            : null;
          if (!bounds && state.clipPath) {
            bounds = resolveGroupClipPathBounds(state);
          }
          state.childLeafIds.forEach((leafId) => {
            bounds = unionImportedBounds(bounds, computeImportedNodeBounds(childNodeById.get(leafId)!));
          });
          state.childGroupKeys.forEach((childKey) => {
            const childState = groupStates.get(childKey) || null;
            if (!childState?.materialize) return;
            bounds = unionImportedBounds(bounds, resolveGroupBounds(childKey));
          });
          boundsCache.set(groupKey, bounds);
          return bounds;
        };
        let rootBounds = rootChildLeafIds.reduce<{ x: number; y: number; width: number; height: number } | null>(
          (acc, leafId) => unionImportedBounds(acc, computeImportedNodeBounds(childNodeById.get(leafId)!)),
          null,
        );
        Array.from(groupStates.values()).forEach((state) => {
          if (!state.materialize || state.parentKey) return;
          rootBounds = unionImportedBounds(rootBounds, resolveGroupBounds(state.key));
        });
        const rootGeometry = rootBounds
          ? {
              ...defaultGroupGeometry,
              x: rootBounds.x,
              y: rootBounds.y,
              width: rootBounds.width,
              height: rootBounds.height,
            }
          : { ...defaultGroupGeometry };
        const materializedGroups = Array.from(groupStates.values())
          .filter((state) => state.materialize && state.entryNodeId && state.contentNodeId)
          .sort((left, right) => left.depth - right.depth);
        const clipNodes: PinselaNode[] = [];
        const groupNodes: PinselaNode[] = [];
        materializedGroups.forEach((state) => {
          const parentState = state.parentKey ? groupStates.get(state.parentKey) || null : null;
          const parentId = parentState?.materialize && parentState.contentNodeId
            ? parentState.contentNodeId
            : groupId;
          const childGroupIds = Array.from(state.childGroupKeys)
            .map((childKey) => groupStates.get(childKey) || null)
            .filter((childState): childState is ImportedGroupState => !!childState?.materialize && !!childState.entryNodeId)
            .map((childState) => childState.entryNodeId!);
          const groupChildrenIds = [
            ...childGroupIds,
            ...state.childLeafIds,
          ];
          const clipGeometry = state.clipGeometry
            ? scaleImportedGroupClipGeometry(state.clipGeometry, scale, x, y)
            : null;
          const bounds = resolveGroupBounds(state.key);
          if (state.clipPath) {
            const clipChildIds = state.contentNodeId !== state.entryNodeId
              ? [state.contentNodeId!]
              : groupChildrenIds;
            const clipNode = buildImportedGroupClipPathNode(state.clipPath, {
              scale,
              offsetX: x,
              offsetY: y,
              parentId,
              id: state.entryNodeId!,
              name: state.contentNodeId !== state.entryNodeId ? `${state.label || "GROUP"}_CLIP` : (state.label || "GROUP"),
              childIds: clipChildIds,
            });
            if (clipNode) {
              clipNodes.push(clipNode);
            }
            if (state.contentNodeId !== state.entryNodeId) {
              groupNodes.push(defaultNode("group", {
                id: state.contentNodeId!,
                name: state.label || "GROUP",
                parent_id: state.entryNodeId!,
                children_ids: groupChildrenIds,
                geometry: {
                  ...defaultGroupGeometry,
                  x: bounds?.x ?? x,
                  y: bounds?.y ?? y,
                  width: bounds?.width ?? 1,
                  height: bounds?.height ?? 1,
                },
                style: {
                  ...defaultGroupStyle,
                  opacity: clampRange(Number(state.opacity || 1), 0, 1, 1),
                },
                editable: true,
              }));
            }
            return;
          }
          const geometry = clipGeometry
            ? {
                x: clipGeometry.x,
                y: clipGeometry.y,
                width: clipGeometry.width,
                height: clipGeometry.height,
                rotation: round2(Number(clipGeometry.rotation || 0)),
                corner_radius: round2(Math.max(0, Number(clipGeometry.cornerRadius || 0))),
                clip: true,
                z_index: 0,
                transform_matrix: clipGeometry.transformMatrix || null,
              }
            : {
                ...defaultGroupGeometry,
                x: bounds?.x ?? x,
                y: bounds?.y ?? y,
                width: bounds?.width ?? 1,
                height: bounds?.height ?? 1,
              };
          groupNodes.push(defaultNode("group", {
            id: state.entryNodeId!,
            name: state.label || "GROUP",
            parent_id: parentId,
            children_ids: groupChildrenIds,
            geometry,
            style: {
              ...defaultGroupStyle,
              opacity: clampRange(Number(state.opacity || 1), 0, 1, 1),
            },
            editable: true,
          }));
        });
        const groupNode = defaultNode("group", {
          id: groupId,
          name: entry.name || "IMPORT_GROUP",
          parent_id: null,
          children_ids: [
            ...materializedGroups
              .filter((state) => !state.parentKey && !!state.entryNodeId)
              .map((state) => state.entryNodeId!),
            ...rootChildLeafIds,
          ],
          geometry: rootGeometry,
          style: { ...defaultGroupStyle },
          editable: true,
        });
        let nextDoc = addNode(baseDoc, groupNode);
        clipNodes.forEach((node) => {
          nextDoc = addNode(nextDoc, node);
        });
        groupNodes.forEach((node) => {
          nextDoc = addNode(nextDoc, node);
        });
        childNodes.forEach((node) => {
          nextDoc = addNode(nextDoc, node);
        });
        return {
          nextDoc,
          primarySelectionId: groupNode.id,
        };
      }
    }

    if (!src) return null;

    const node = defaultNode("image", {
      name: entry.name,
      geometry: {
        x,
        y,
        width,
        height,
        rotation: 0,
        corner_radius: 0,
        clip: true,
        z_index: 0,
      },
      image_src: src,
      editable: true,
    });
    return {
      nextDoc: addNode(baseDoc, node),
      primarySelectionId: node.id,
    };
  }, [resolveImportEntrySourceMetrics]);

  const importFilesToLibrary = useCallback(async (
    files: File[],
    options?: {
      autoPlaceMode?: SvgImportMode | null;
      dropPoint?: { x: number; y: number } | null;
    },
  ) => {
    const imported = await parseImportFiles(files);
    if (!imported.length) return;

    const merged = mergeImportedAssetEntries(importLibrary, imported);
    if (merged.addedEntries.length) {
      setImportLibrary(merged.nextEntries);
    }
    openImportsPanel();

    const autoPlaceMode = options?.autoPlaceMode || null;
    if (!autoPlaceMode || !merged.resolvedEntries.length) return;

    if (autoPlaceMode === "new_page") {
      const pagesSnapshot = buildProjectPagesSnapshot(engine.doc);
      const existingNames = pagesSnapshot.map((page) => page.name);
      const nextPages = [...pagesSnapshot];
      let lastImportedPage: ProjectPageRecord | null = null;
      let lastImportedSelectionId: string | null = null;

      for (const entry of merged.resolvedEntries) {
        const { sourceWidth, sourceHeight } = await resolveImportEntrySourceMetrics(entry);
        const importDoc = createEmptyDoc(sourceWidth, sourceHeight);
        const placed = await materializeImportEntryOnDoc(entry, importDoc, { nativeSize: true });
        if (!placed) continue;
        const pageId = uid("page");
        const pageName = buildImportedProjectPageName(entry.name, existingNames);
        existingNames.push(pageName);
        const nextPage: ProjectPageRecord = {
          id: pageId,
          name: pageName,
          doc: placed.nextDoc,
          position: nextPages.length
            ? getAdjacentProjectPagePosition(nextPages[nextPages.length - 1], "right")
            : getInitialProjectPagePosition(placed.nextDoc),
        };
        nextPages.push(nextPage);
        lastImportedPage = nextPage;
        lastImportedSelectionId = placed.primarySelectionId;
      }

      if (lastImportedPage) {
        replaceProjectPagesState(nextPages);
        markProjectPagesDirty();
        applyProjectPageToEditor(lastImportedPage.id, lastImportedPage.doc, true);
        if (lastImportedSelectionId) {
          window.setTimeout(() => {
            engine.setSelection([lastImportedSelectionId!]);
            setActiveTab("properties");
          }, 0);
        }
      }
      return;
    }

    let workingDoc = engine.doc;
    const selectionIds: string[] = [];
    for (let index = 0; index < merged.resolvedEntries.length; index += 1) {
      const entry = merged.resolvedEntries[index];
      const dropPoint = options?.dropPoint
        ? {
            x: Number(options.dropPoint.x || 0) + index * 24,
            y: Number(options.dropPoint.y || 0) + index * 24,
          }
        : null;
      const placed = await materializeImportEntryOnDoc(entry, workingDoc, {
        point: dropPoint || undefined,
      });
      if (!placed) continue;
      workingDoc = placed.nextDoc;
      if (placed.primarySelectionId) selectionIds.push(placed.primarySelectionId);
    }

    if (workingDoc !== engine.doc) {
      engine.commitDoc(workingDoc);
      if (selectionIds.length) {
        engine.setSelection(selectionIds);
        setActiveTab("properties");
      }
    }
  }, [
    importLibrary,
    parseImportFiles,
    openImportsPanel,
    buildProjectPagesSnapshot,
    engine.doc,
    engine,
    resolveImportEntrySourceMetrics,
    materializeImportEntryOnDoc,
    replaceProjectPagesState,
    markProjectPagesDirty,
    applyProjectPageToEditor,
  ]);

  const placeImportOnCanvas = useCallback(async (importId: string) => {
    const entry = importLibrary.find((item) => item.id === importId);
    if (!entry) return;
    const placed = await materializeImportEntryOnDoc(entry, engine.doc);
    if (!placed) return;
    engine.commitDoc(placed.nextDoc);
    if (placed.primarySelectionId) {
      engine.setSelection([placed.primarySelectionId]);
      setActiveTab("properties");
    }
  }, [engine, importLibrary, materializeImportEntryOnDoc]);

  const rightImportItems = useMemo<ImportLibraryItem[]>(() => (
    importLibrary.map((entry) => ({
      id: entry.id,
      name: entry.name,
      extension: entry.extension,
      kindLabel: mapImportKindLabel(entry.kind, entry.extension, entry.parseMode, entry.pageCount),
      sizeLabel: [formatFileSizeLabel(entry.sizeBytes), entry.detailLabel]
        .map((part) => String(part || "").trim())
        .filter(Boolean)
        .join(" · "),
      previewSrc: entry.src,
    }))
  ), [importLibrary]);

  const applyAddGuides = useCallback((values: AddGuidesValues) => {
    const normalized = normalizeAddGuidesValues(values);
    const nextGuides = buildArtboardGuides(
      Number(engine.doc.canvas.width || 0),
      Number(engine.doc.canvas.height || 0),
      normalized,
    );
    setAddGuidesValues(normalized);
    persistArtboardGuides(nextGuides);
    engine.dispatch({ type: "set_guides", guides: [] });
    setActiveModal(null);
  }, [engine, setActiveModal, persistArtboardGuides]);

  const insertImagesFromSourcesRef = useRef<(
    sources: Array<{ src: string; name?: string }>,
    point: { x: number; y: number },
    options?: { allowFrameReplace?: boolean },
  ) => Promise<Array<{ nodeId: string; sourceIndex: number; src: string }>>>(async () => []);

  // When the user clicks "Replace" on a selected image, we remember which node to
  // replace so the next asset pick swaps that image in place instead of inserting a new one.
  const imageReplaceTargetRef = useRef<string | null>(null);

  const leftPanelCallbacks = useMemo<LeftPanelCallbacks>(() => ({
    onAddNode: insertNodeFromPanel,
    onActivateCanvasTool: (tool) => {
      if (!tool) return;
      activateCanvasTool(tool as CanvasToolId);
    },
    onWrapSelectionInAutoLayout: () => {
      wrapSelectionInAutoLayout();
    },
    onAddImageFromDevice: () => {
      openAddImagePicker();
    },
    onPlaceAsset: (assetId, providedAsset?: AssetItem) => {
      const asset = providedAsset || api.assets.find((entry) => entry.id === assetId);
      const src = String(asset?.preview_url || "").trim();
      if (!src) return;
      // "Replace" flow: swap the image into the existing node in place (reset crop), instead of
      // inserting a second photo on top.
      const replaceId = imageReplaceTargetRef.current;
      imageReplaceTargetRef.current = null;
      if (replaceId) {
        const target = engine.doc.nodes.find((node) => node.id === replaceId && node.kind === "image");
        if (target) {
          engine.commitDoc({
            ...engine.doc,
            nodes: engine.doc.nodes.map((node) =>
              node.id === replaceId
                ? { ...node, image_src: src, style: { ...node.style, image_crop: null } }
                : node,
            ),
          });
          engine.setSelection([replaceId]);
          return;
        }
      }
      void insertImagesFromSourcesRef.current(
        [{
          src,
          name: String(asset?.name || "Image").trim() || "Image",
        }],
        {
          x: Math.round(Number(engine.doc.canvas.width || 1) / 2),
          y: Math.round(Number(engine.doc.canvas.height || 1) / 2),
        },
      );
    },
    onUploadTraceImage: () => {
      openAddImagePicker();
    },
    onOpenImportPicker: () => {
      openImportPicker();
    },
    svgImportMode,
    onSetSvgImportMode: (mode) => {
      setSvgImportMode(mode === "new_page" ? "new_page" : "current_page");
    },
    onOpenSvgImportPicker: (mode) => {
      const nextMode = mode === "new_page" ? "new_page" : svgImportMode;
      setSvgImportMode(nextMode);
      openSvgImportPicker(nextMode);
    },
    onPlaceImport: (importId) => {
      void placeImportOnCanvas(importId);
    },
    onRemoveImport: (importId) => {
      setImportLibrary((prev) => prev.filter((entry) => entry.id !== importId));
    },
    onOpenAddGuides: () => {
      setActiveModal("add_guides");
    },
    onUpsertAutoLayoutLimitRule: (patch) => {
      const selected = engine.selectedNode;
      if (!selected || !canHostAutoLayout(selected)) return;
      const existing = findAutoLayoutContentLimitRule(engine.doc, selected.id);
      const existingPatch: AutoLayoutContentLimitPatch | null = existing
        ? {
          enabled: existing.enabled,
          maxChars: existing.max_chars,
          startFontSize: existing.start_font_size,
          minFontSize: existing.min_font_size,
          shrinkStep: existing.shrink_step,
          truncateMode: existing.truncate_mode,
        }
        : null;
      const nextDoc = upsertAutoLayoutContentLimitRule(
        engine.doc,
        selected.id,
        {
          ...(existingPatch || DEFAULT_AUTO_LAYOUT_CONTENT_RULE),
          ...patch,
        },
      );
      engine.commitDoc(nextDoc);
    },
    onRemoveAutoLayoutLimitRule: (containerId) => {
      const targetId = String(containerId || engine.selectedNode?.id || "").trim();
      if (!targetId) return;
      const nextDoc = removeAutoLayoutContentLimitRule(engine.doc, targetId);
      if (nextDoc === engine.doc) return;
      engine.commitDoc(nextDoc);
    },
    onApplyAutoLayoutLimitPreset: (presetId) => {
      const selected = engine.selectedNode;
      if (!selected || !canHostAutoLayout(selected)) return;
      const preset = AUTO_LAYOUT_LIMIT_PRESETS.find((entry) => entry.id === presetId)
        || AUTO_LAYOUT_LIMIT_PRESETS.find((entry) => entry.id === "generic");
      if (!preset) return;
      const nextDoc = upsertAutoLayoutContentLimitRule(
        engine.doc,
        selected.id,
        {
          enabled: true,
          maxChars: preset.rule.maxChars,
          startFontSize: preset.rule.startFontSize,
          minFontSize: preset.rule.minFontSize,
          shrinkStep: preset.rule.shrinkStep,
          truncateMode: preset.rule.truncateMode,
        },
      );
      engine.commitDoc(nextDoc);
    },
    onCreateAutomationPage: (payload: AutomationCreatePagePayload) => {
      const bindings = Array.isArray(payload?.bindings) ? payload.bindings : [];
      if (!bindings.length) return false;
      const valuesByBindingId = payload && typeof payload.valuesByBindingId === "object" && payload.valuesByBindingId
        ? payload.valuesByBindingId
        : {};
      const sourceDocRaw = payload?.baseDoc && isProjectPageDoc(payload.baseDoc)
        ? payload.baseDoc
        : engine.doc;
      const sourceDoc = stripProjectPagesMetadata(sourceDocRaw);
      const bindingById = new Map(bindings.map((binding) => [binding.id, binding] as const));
      const nextDoc: PinselaTemplateDocV1 = {
        ...sourceDoc,
        nodes: sourceDoc.nodes.map((node) => {
          const binding = bindingById.get(node.id);
          if (!binding) return node;
          const rawValue = String(valuesByBindingId[binding.id] || "");
          if (binding.kind === "image" || binding.kind === "frame") {
            return {
              ...node,
              image_src: rawValue.trim() || null,
            };
          }
          return {
            ...(node.kind === "text" ? updateTextNodeContent(node, rawValue) : node),
          };
        }),
      };
      const nextPageId = uid("page");
      const pagesSnapshot = buildProjectPagesSnapshot(engine.doc);
      const nextPageName = normalizeProjectPageName(String(payload.pageName || ""), pagesSnapshot.length);
      const nextPages = [...pagesSnapshot, {
        id: nextPageId,
        name: nextPageName,
        doc: nextDoc,
        position: pagesSnapshot.length
          ? getAdjacentProjectPagePosition(pagesSnapshot[pagesSnapshot.length - 1], "right")
          : getInitialProjectPagePosition(nextDoc),
      }];
      replaceProjectPagesState(nextPages);
      markProjectPagesDirty();
      applyProjectPageToEditor(nextPageId, nextDoc, true);
      return true;
    },
    onSaveAutomationTemplate: async (payload: AutomationSaveTemplatePayload) => {
      const name = String(payload?.name || "").trim();
      const templateId = String(payload?.templateId || "").trim();
      const bindings = Array.isArray(payload?.bindings) ? payload.bindings : [];
      if (!name || !bindings.length) return false;
      const sourceDocRaw = payload?.doc && isProjectPageDoc(payload.doc)
        ? payload.doc
        : engine.doc;
      const sourceDoc = stripProjectPagesMetadata(sourceDocRaw);
      const serializedBindings = bindings.map((binding) => ({
        id: String(binding.id || "").trim(),
        layer_name: String(binding.layerName || "").trim(),
        kind: binding.kind,
      }));
      try {
        const {
          createAutomationTemplate,
          updateAutomationTemplateById,
        } = await loadAutomationApi();
        const writePayload = {
          name,
          project_key: api.projectKey || null,
          source_page_name: String(payload?.pageName || activeProjectPage?.name || "Page").trim() || "Page",
          doc_json: sourceDoc,
          bindings: serializedBindings,
        };
        if (templateId) {
          const updated = await updateAutomationTemplateById(templateId, writePayload);
          const mapped = mapApiAutomationTemplateSummary(updated);
          const cached = getCachedAutomationTemplate(templateId);
          const currentSummary = automationTemplates.find((entry) => entry.id === templateId) || null;
          setCachedAutomationTemplate(templateId, {
            id: templateId,
            name: mapped.name,
            sourcePageName: mapped.sourcePageName ?? writePayload.source_page_name ?? currentSummary?.sourcePageName ?? null,
            projectKey: mapped.projectKey ?? writePayload.project_key ?? currentSummary?.projectKey ?? null,
            bindingCount: serializedBindings.length,
            createdAt: cached?.createdAt ?? currentSummary?.createdAt ?? null,
            updatedAt: mapped.updatedAt ?? cached?.updatedAt ?? currentSummary?.updatedAt ?? null,
            doc: sourceDoc,
            bindings: bindings.map((binding) => ({ ...binding })),
          });
        } else {
          await createAutomationTemplate(writePayload);
        }
        await refreshAutomationTemplates();
        return true;
      } catch {
        return false;
      }
    },
    onLoadAutomationTemplate: async (templateId: string) => {
      const id = String(templateId || "").trim();
      if (!id) return null;
      const cached = getCachedAutomationTemplate(id);
      if (cached) return cached;
      try {
        const { fetchAutomationTemplateById } = await loadAutomationApi();
        const raw = await fetchAutomationTemplateById(id);
        const mapped = mapApiAutomationTemplateDetail(raw);
        setCachedAutomationTemplate(id, mapped);
        return mapped;
      } catch {
        return null;
      }
    },
    onDeleteAutomationTemplate: async (templateId: string) => {
      const id = String(templateId || "").trim();
      if (!id) return false;
      try {
        const { deleteAutomationTemplateById } = await loadAutomationApi();
        await deleteAutomationTemplateById(id);
        deleteCachedAutomationTemplate(id);
        setAutomationTemplates((current) => current.filter((entry) => entry.id !== id));
        return true;
      } catch {
        return false;
      }
    },
    onSelectImageTraceTarget: (nodeId) => {
      const nextId = String(nodeId || "").trim();
      if (!nextId) {
        setTraceTargetImageId(null);
        runImageTraceAction({
          phase: "cancel",
          nodeId: null,
          edgeThreshold: imageTraceState.edgeThreshold,
          curveTolerance: imageTraceState.curveTolerance,
        });
        return;
      }
      const targetNode = engine.doc.nodes.find((node) => node.id === nextId);
      if (!targetNode || targetNode.kind !== "image") return;
      setTraceTargetImageId(targetNode.id);
      engine.setSelection([targetNode.id]);
      setActiveTab("properties");
    },
    onImageTraceAction: (payload) => {
      const nextId = typeof payload?.nodeId === "string" ? payload.nodeId.trim() : "";
      if (nextId) {
        setTraceTargetImageId(nextId);
      }
      runImageTraceAction(payload as Record<string, unknown>);
    },
    onSelectionBooleanOperation: (operation) => {
      void applySelectionBooleanOperation(operation);
    },
    onSelectionPerspectiveWarp: (payload) => {
      void applySelectionPerspectiveWarp(payload);
    },
    onDeleteSelection: () => {
      engine.deleteSelection();
    },
    onDuplicateSelection: () => {
      engine.duplicateSelection();
    },
    onGroupSelection: () => {
      const grouped = groupSelectionIntoNewGroup(engine.doc, engine.selection);
      if (!grouped) return;
      engine.commitDoc(grouped.doc);
      engine.setSelection([grouped.groupId]);
    },
    onUngroupSelection: () => {
      const ungrouped = ungroupSelectedGroups(engine.doc, engine.selection);
      if (!ungrouped) return;
      engine.commitDoc(ungrouped.doc);
      engine.setSelection(ungrouped.childIds);
    },
    onToggleVisibility: (nodeId) => {
      const next = toggleNodeVisible(engine.doc, nodeId);
      engine.commitDoc(next);
    },
    onToggleLock: (nodeId) => {
      const next = toggleNodeLock(engine.doc, nodeId);
      engine.commitDoc(next);
    },
    onDeleteNode: (nodeId) => {
      const targetId = String(nodeId || "").trim();
      if (!targetId) return;
      const nextDoc = removeNodes(engine.doc, [targetId]);
      if (nextDoc === engine.doc) return;
      engine.commitDoc(nextDoc);
      const remainingNodeIds = new Set(nextDoc.nodes.map((node) => node.id));
      const nextSelection = engine.selection.filter((id) => remainingNodeIds.has(id));
      if (nextSelection.length !== engine.selection.length) {
        engine.setSelection(nextSelection);
      }
    },
    onSelectNode: (nodeId) => {
      engine.setSelection([nodeId]);
    },
    onSetSelection: (ids) => engine.setSelection(ids),
    onJumpToHistory: jumpToHistory,
    onOpenVersions: () => setActiveModal("versions"),
    onSetSnapEnabled: (enabled) => engine.dispatch({ type: "set_snap", snap: { enabled } }),
    onSetSnapToGrid: (enabled) => engine.dispatch({ type: "set_snap", snap: { toGrid: enabled } }),
    onSetSnapTolerance: (value) => engine.dispatch({ type: "set_snap", snap: { tolerance: Math.max(1, Math.round(value || 1)) } }),
    onSetGridSize: (value) => engine.dispatch({ type: "set_snap", snap: { gridSize: Math.max(2, Math.round(value || 2)) } }),
    onSelectFont: (fontFamily, variantLabel) => {
      const family = String(fontFamily || "").trim();
      if (!family) return false;
      const selectedSet = new Set(engine.selection);
      const hasSelectedText = engine.doc.nodes.some((node) => selectedSet.has(node.id) && node.kind === "text");
      if (!hasSelectedText) return false;

      const style = String(variantLabel || "Regular").trim() || "Regular";
      const postscript = buildTextPostscriptName(family, style);
      const nextDoc: PinselaTemplateDocV1 = {
        ...engine.doc,
        nodes: engine.doc.nodes.map((node) => (
          selectedSet.has(node.id) && node.kind === "text"
            ? {
              ...node,
              text_style: {
                ...(node.text_style || {}),
                family,
                style,
                postscript,
              },
            }
            : node
        )),
      };
      engine.commitDoc(nextDoc);
      return true;
    },
    onSetTextColor: (color) => {
      if (engine.selectedNode?.kind === "text") {
        upsertSelectedTextStyle({ color }, engine);
      }
    },
    onSetSelectedTextContent: (text) => {
      if (engine.selectedNode?.kind !== "text") return;
      const nextText = String(text ?? "");
      if (nextText === String(engine.selectedNode.text || "")) return;
      engine.patchSelectedNode((node) => (
        node.kind === "text"
          ? { ...node, text: nextText }
          : node
      ));
    },
    onPatchSelectedTextStyle: (patch) => {
      if (engine.selectedNode?.kind !== "text") return;
      upsertSelectedTextStyle({
        ...(patch.size != null ? { size: Math.max(6, Math.min(640, Math.round(Number(patch.size)))) } : {}),
        ...(patch.line_height != null ? { line_height: Math.max(40, Math.min(400, Math.round(Number(patch.line_height)))) } : {}),
        ...(patch.letter_spacing != null ? { letter_spacing: Math.max(-200, Math.min(400, Math.round(Number(patch.letter_spacing)))) } : {}),
        ...(patch.color !== undefined ? { color: patch.color } : {}),
        ...(patch.text_align ? { text_align: patch.text_align } : {}),
      }, engine);
    },
    onPatchSelectedNode: patchSelectedNode,
    onSetSelectedStrokes: (strokes) => {
      setSelectedStrokeStack(strokes);
    },
    onSetSelectedEffects: (effects) => {
      patchSelectedNode({ effects: Array.isArray(effects) ? effects : [] });
    },
    onReorderSelection: (direction) => {
      engine.commitDoc(reorderSelection(engine.doc, engine.selection, direction));
    },
    onAlignSelection: (mode) => {
      engine.commitDoc(alignSelection(engine.doc, engine.selection, mode));
    },
    onDistributeSelection: (axis) => {
      engine.commitDoc(distributeSelection(engine.doc, engine.selection, axis));
    },
    onToggleSelectionLock: () => {
      if (!engine.selection.length) return;
      const nextLocked = !areSelectionAllLocked(engine.doc, engine.selection);
      engine.commitDoc(setSelectionLocked(engine.doc, engine.selection, nextLocked));
    },
    onToggleSelectionVisibility: () => {
      if (!engine.selection.length) return;
      const nextVisible = areSelectionAllHidden(engine.doc, engine.selection);
      engine.commitDoc(setSelectionVisible(engine.doc, engine.selection, nextVisible));
    },
    onMoveLayerByList: (sourceIds, targetId, placement) => {
      const next = moveLayerByListOrder(engine.doc, sourceIds, targetId, placement);
      engine.commitDoc(next);
    },
    onRenameNode: (nodeId, name) => {
      const nextName = String(name || "").trim();
      if (!nextName) return;
      const nextDoc: PinselaTemplateDocV1 = {
        ...engine.doc,
        nodes: engine.doc.nodes.map((node) => (
          node.id === nodeId ? { ...node, name: nextName } : node
        )),
      };
      engine.commitDoc(nextDoc);
    },
  }), [
    engine,
    jumpToHistory,
    activateCanvasTool,
    openAddImagePicker,
    openImportPicker,
    openSvgImportPicker,
    svgImportMode,
    insertNodeFromPanel,
    wrapSelectionInAutoLayout,
    imageTraceState.edgeThreshold,
    imageTraceState.curveTolerance,
    runImageTraceAction,
    applySelectionBooleanOperation,
    applySelectionPerspectiveWarp,
    placeImportOnCanvas,
    api.assets,
    buildProjectPagesSnapshot,
    replaceProjectPagesState,
    markProjectPagesDirty,
    applyProjectPageToEditor,
    api.projectKey,
    activeProjectPage?.name,
    refreshAutomationTemplates,
    automationTemplates,
    getCachedAutomationTemplate,
    setCachedAutomationTemplate,
    deleteCachedAutomationTemplate,
    setSelectedStrokeStack,
    setActiveModal,
  ]);

  const leftImageTraceState = useMemo<LeftPanelImageTraceState>(() => ({
    targetImageId: traceTargetImageId,
    images: traceImageOptions,
    edgeThreshold: clampPercent(Number(imageTraceState.edgeThreshold), DEFAULT_IMAGE_TRACE_SETTINGS.edgeThreshold),
    curveTolerance: clampPercent(Number(imageTraceState.curveTolerance), DEFAULT_IMAGE_TRACE_SETTINGS.curveTolerance),
    processing: Boolean(imageTraceState.processing),
    hasPreview: Boolean(tracePreview && tracePreview.pathData.length > 0),
  }), [
    traceTargetImageId,
    traceImageOptions,
    imageTraceState.edgeThreshold,
    imageTraceState.curveTolerance,
    imageTraceState.processing,
    tracePreview,
  ]);

  const selectedAutoLayoutState = useMemo(() => {
    const selected = engine.selectedNode;
    if (!selected || !isAutoLayoutContainerNode(selected)) {
      return { active: false, empty: false };
    }
    const childCount = engine.doc.nodes.filter((node) => node.parent_id === selected.id).length;
    return {
      active: true,
      empty: childCount === 0,
    };
  }, [engine.doc.nodes, engine.selectedNode]);

  const enterCropModeForNode = useCallback((nodeId: string) => {
    const baseDoc = engine.doc;
    const targetNode = baseDoc.nodes.find((node) => node.id === nodeId) || null;
    if (!canNodeHostImageCrop(targetNode) || targetNode.style?.locked) return false;
    // Seed the crop so it never distorts on entry: reuse an existing crop only
    // when its aspect already matches the frame, otherwise seed the centered
    // "cover" crop (identical to what image_fit:"fill" was already showing).
    const dims = resolveNodeImageDimensions(targetNode, renderer.imageCacheRef.current);
    const boxRect = {
      x: Number(targetNode.geometry.x || 0),
      y: Number(targetNode.geometry.y || 0),
      width: Math.max(1, Number(targetNode.geometry.width || 1)),
      height: Math.max(1, Number(targetNode.geometry.height || 1)),
    };
    const existingCrop = targetNode.style?.image_crop || null;
    const reuseExisting = !!existingCrop
      && Number(existingCrop.width) > 0
      && Number(existingCrop.height) > 0
      && cropAspectMatchesBox(boxRect, {
        x: Number(existingCrop.x || 0),
        y: Number(existingCrop.y || 0),
        width: Number(existingCrop.width || 1),
        height: Number(existingCrop.height || 1),
      });
    const seedRect = reuseExisting && existingCrop
      ? {
        width: Math.max(1, Math.min(dims.width, Math.round(Number(existingCrop.width)))),
        height: Math.max(1, Math.min(dims.height, Math.round(Number(existingCrop.height)))),
        x: Math.max(0, Math.min(dims.width - 1, Math.round(Number(existingCrop.x || 0)))),
        y: Math.max(0, Math.min(dims.height - 1, Math.round(Number(existingCrop.y || 0)))),
      }
      : coverCrop(dims.width, dims.height, boxRect.width, boxRect.height);
    const baseCrop = {
      x: Math.round(seedRect.x),
      y: Math.round(seedRect.y),
      width: Math.round(seedRect.width),
      height: Math.round(seedRect.height),
    };
    const nextDoc = patchNodeById(baseDoc, targetNode.id, (node) => ({
      ...node,
      style: {
        ...node.style,
        image_fit: "crop",
        image_crop: {
          x: baseCrop.x,
          y: baseCrop.y,
          width: baseCrop.width,
          height: baseCrop.height,
        },
      },
    }));
    cropModeSessionRef.current = {
      baseDoc,
      nodeId: targetNode.id,
      latestDoc: nextDoc,
      changed: false,
    };
    cropLiveRef.current = { box: { ...boxRect }, crop: { ...baseCrop } };
    cropTranslateSessionRef.current = null;
    engine.setSelection([targetNode.id]);
    engine.replaceDoc(nextDoc);
    engine.setMode("crop");
    return true;
  }, [engine, renderer.imageCacheRef]);

  const confirmCropMode = useCallback(() => {
    const session = cropModeSessionRef.current;
    cropTranslateSessionRef.current = null;
    if (!session) {
      renderer.clearPreviewScene();
      engine.setMode("select");
      return;
    }
    flushPreviewDocUpdate();
    if (session.changed) {
      commitTransientDoc(session.baseDoc, session.latestDoc);
      schedulePreviewClear();
    } else {
      engine.replaceDoc(session.baseDoc);
      renderer.clearPreviewScene();
    }
    engine.setSelection([session.nodeId]);
    cropModeSessionRef.current = null;
    cropLiveRef.current = null;
    cropFrameSessionRef.current = null;
    engine.setMode("select");
  }, [commitTransientDoc, engine, flushPreviewDocUpdate, renderer, schedulePreviewClear]);

  const cancelCropMode = useCallback(() => {
    const session = cropModeSessionRef.current;
    cropTranslateSessionRef.current = null;
    if (!session) {
      renderer.clearPreviewScene();
      engine.setMode("select");
      return;
    }
    engine.replaceDoc(session.baseDoc);
    renderer.clearPreviewScene();
    if (session.baseDoc.nodes.some((node) => node.id === session.nodeId)) {
      engine.setSelection([session.nodeId]);
    }
    cropModeSessionRef.current = null;
    cropLiveRef.current = null;
    cropFrameSessionRef.current = null;
    engine.setMode("select");
  }, [engine, renderer]);

  // Static overlay payload (image src + natural dims). The live crop/box come
  // from cropLiveRef so this only recomputes when the cropped node changes.
  const cropOverlay = useMemo(() => {
    if (engine.mode !== "crop") return null;
    const node = engine.selectedNode;
    if (!canNodeHostImageCrop(node)) return null;
    const src = String(node.image_src || "").trim();
    if (!src) return null;
    const dims = resolveNodeImageDimensions(node, renderer.imageCacheRef.current);
    return { imageSrc: resolveCanvasImageRequestSrc(src), imageWidth: dims.width, imageHeight: dims.height };
  }, [engine.mode, engine.selectedNode, renderer.imageCacheRef]);

  // Dev-only handle for CDP self-testing (gated to dev builds; never ships).
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as Record<string, unknown>).__pinselaDev = {
      getMode: () => engine.mode,
      firstImageId: () => engine.doc.nodes.find((n) => n.kind === "image" && String(n.image_src || "").trim())?.id || null,
      selectNode: (id: string) => engine.setSelection([id]),
      enterCrop: (id?: string) => enterCropModeForNode(id || engine.selectedNode?.id || engine.doc.nodes.find((n) => n.kind === "image" && String(n.image_src || "").trim())?.id || ""),
      confirmCrop: () => confirmCropMode(),
      cancelCrop: () => cancelCropMode(),
      cropLive: () => cropLiveRef.current,
      nodeStyle: (id: string) => engine.doc.nodes.find((n) => n.id === id)?.style || null,
      nodeGeometry: (id: string) => engine.doc.nodes.find((n) => n.id === id)?.geometry || null,
      allNodes: () => engine.doc.nodes.map((n) => ({ id: n.id, kind: n.kind, rotation: Number(n.geometry?.rotation || 0) })),
      firstByKind: (kind: string) => engine.doc.nodes.find((n) => n.kind === kind)?.id || null,
      rotate: (id: string, deg: number) => engine.commitDoc(patchNodeById(engine.doc, id, (n) => ({ ...n, geometry: { ...n.geometry, rotation: deg } }))),
      addRect: () => {
        const base = defaultNode("rect");
        const n = { ...base, id: `devrect_${engine.doc.nodes.length}`, geometry: { ...base.geometry, x: 300, y: 300, width: 400, height: 240 } };
        engine.commitDoc(addNode(engine.doc, n));
        return n.id;
      },
      addColoredRect: (fill: string, x: number, y: number) => {
        const base = defaultNode("rect");
        const n = { ...base, id: `devc_${engine.doc.nodes.length}_${Math.round(x)}`, geometry: { ...base.geometry, x, y, width: 360, height: 360 }, style: { ...base.style, fill } };
        engine.commitDoc(addNode(engine.doc, n));
        return n.id;
      },
      reorder: (dir: "up" | "down" | "front" | "back") => engine.commitDoc(reorderSelection(engine.doc, engine.selection, dir)),
      moveLayer: (sourceId: string, targetId: string, placement: "before" | "after") => engine.commitDoc(moveLayerByListOrder(engine.doc, [sourceId], targetId, placement)),
      layerOrder: () => engine.doc.nodes.map((n) => ({ id: n.id, z: Number(n.geometry?.z_index || 0) })),
    };
    return () => {
      try { delete (window as unknown as Record<string, unknown>).__pinselaDev; } catch { /* noop */ }
    };
  }, [engine, enterCropModeForNode, confirmCropMode, cancelCropMode]);

  const runImageBackgroundRemoval = useCallback(() => {
    if (imageBackgroundRemovalState.processing) return;
    if (engine.selectedNode?.kind !== "image") return;

    const source = String(engine.selectedNode.image_src || "").trim();
    if (!source) {
      setImageBackgroundRemovalState({
        processing: false,
        error: "The selected image has no valid source to crop.",
      });
      return;
    }

    const baseDoc = engine.doc;
    const nodeId = engine.selectedNode.id;
    const assetName = buildBackgroundRemovedImageName(engine.selectedNode.name);

    setImageBackgroundRemovalState({ processing: true, error: null });

    void (async () => {
      try {
        const nextAsset = await removeBackgroundFromImageSource(source, {
          name: assetName,
          timeoutMs: 300_000,
        });
        if (engine.doc !== baseDoc || engine.selectedNode?.id !== nodeId) {
          setImageBackgroundRemovalState({ processing: false, error: null });
          return;
        }
        engine.patchSelectedNode((node) => (
          node.kind !== "image"
            ? node
            : {
              ...node,
              image_src: nextAsset.preview_url,
            }
        ));
        setImageBackgroundRemovalState({ processing: false, error: null });
      } catch (error) {
        setImageBackgroundRemovalState({
          processing: false,
          error: describeAsyncActionError(error, "Could not remove the image background."),
        });
      }
    })();
  }, [engine, imageBackgroundRemovalState.processing]);

  const onToolbarAction = useCallback((actionId: ToolbarActionId, payload?: Record<string, unknown>) => {
    const selectedIds = engine.selection;
    const selectedNodes = selectedIds
      .map((id) => engine.doc.nodes.find((node) => node.id === id))
      .filter(Boolean) as PinselaNode[];
    const isTextOnlySelection = selectedNodes.length > 0 && selectedNodes.every((node) => node.kind === "text");
    // A single text box → align_left/center/right means TEXT alignment (text_align_menu).
    // Multiple text boxes → those same actions align the BOXES positionally (Canva parity).
    const singleTextSelected = isTextOnlySelection && selectedNodes.length === 1;
    const isFrameOnlySelection = selectedNodes.length > 0 && selectedNodes.every((node) => node.kind === "frame");
    const isTransientColorPreview = payload?.transient === true;
    const isColorPreviewCommit = payload?.commit === true;
    const pendingToolbarColorPreview = toolbarColorPreviewRef.current;

    if (
      pendingToolbarColorPreview
      && (
        pendingToolbarColorPreview.actionId !== actionId
        || (!isTransientColorPreview && !isColorPreviewCommit)
      )
    ) {
      flushToolbarColorPreview();
    }

    switch (actionId) {
      case "tool_select":
        activateCanvasTool("select");
        return;
      case "tool_pan":
        activateCanvasTool(activeTool === "hand" ? "select" : "hand");
        return;
      case "toggle_snap":
        engine.dispatch({ type: "set_snap", snap: { enabled: !engine.store.snap.enabled } });
        return;
      case "toggle_grid":
        engine.dispatch({ type: "set_snap", snap: { toGrid: !engine.store.snap.toGrid } });
        return;
      case "artboard_fill": {
        const color = payload?.color;
        if (!hasRenderableColor(color)) return;
        if (isTransientColorPreview || isColorPreviewCommit) {
          applyToolbarColorPreview("artboard_fill", (sourceDoc) => ({
            ...sourceDoc,
            canvas: {
              ...sourceDoc.canvas,
              background: color,
            },
            nodes: sourceDoc.nodes.map((node) => (
              node.id !== sourceDoc.root_id
                ? node
                : {
                  ...node,
                  style: {
                    ...node.style,
                    fill: color,
                  },
                }
            )),
          }), { transient: isTransientColorPreview, commit: isColorPreviewCommit });
          return;
        }
        const nextDoc: PinselaTemplateDocV1 = {
          ...engine.doc,
          canvas: {
            ...engine.doc.canvas,
            background: color,
          },
          nodes: engine.doc.nodes.map((node) => (
            node.id !== engine.doc.root_id
              ? node
              : {
                ...node,
                style: {
                  ...node.style,
                  fill: color,
                },
              }
          )),
        };
        engine.commitDoc(nextDoc);
        return;
      }
      case "fit_view":
      case "reset_zoom":
        renderer.setZoom(uiPercentToEngineZoom(100));
        return;
      case "group": {
        const grouped = groupSelectionIntoNewGroup(engine.doc, selectedIds);
        if (!grouped) return;
        engine.commitDoc(grouped.doc);
        engine.setSelection([grouped.groupId]);
        return;
      }
      case "ungroup": {
        const ungrouped = ungroupSelectedGroups(engine.doc, selectedIds);
        if (!ungrouped) return;
        engine.commitDoc(ungrouped.doc);
        engine.setSelection(ungrouped.childIds);
        return;
      }
      case "toggle_lock": {
        if (!selectedIds.length) return;
        const nextLocked = !areSelectionAllLocked(engine.doc, selectedIds);
        engine.commitDoc(setSelectionLocked(engine.doc, selectedIds, nextLocked));
        return;
      }
      case "toggle_visibility": {
        if (!selectedIds.length) return;
        const nextVisible = areSelectionAllHidden(engine.doc, selectedIds);
        engine.commitDoc(setSelectionVisible(engine.doc, selectedIds, nextVisible));
        return;
      }
      case "arrange_backward":
        engine.commitDoc(reorderSelection(engine.doc, selectedIds, "down"));
        return;
      case "arrange_forward":
        engine.commitDoc(reorderSelection(engine.doc, selectedIds, "up"));
        return;
      case "arrange_back":
        engine.commitDoc(reorderSelection(engine.doc, selectedIds, "back"));
        return;
      case "arrange_front":
        engine.commitDoc(reorderSelection(engine.doc, selectedIds, "front"));
        return;
      case "align_left":
        if (!selectedIds.length && activeTool === "text") {
          setTextToolPreset((prev) => ({ ...prev, textAlign: "left" }));
          return;
        }
        if (singleTextSelected) {
          upsertSelectedTextStyle({ text_align: "left" }, engine);
          return;
        }
        engine.commitDoc(alignSelection(engine.doc, selectedIds, "left"));
        return;
      case "align_center":
        if (!selectedIds.length && activeTool === "text") {
          setTextToolPreset((prev) => ({ ...prev, textAlign: "center" }));
          return;
        }
        if (singleTextSelected) {
          upsertSelectedTextStyle({ text_align: "center" }, engine);
          return;
        }
        engine.commitDoc(alignSelection(engine.doc, selectedIds, "center"));
        return;
      case "align_right":
        if (!selectedIds.length && activeTool === "text") {
          setTextToolPreset((prev) => ({ ...prev, textAlign: "right" }));
          return;
        }
        if (singleTextSelected) {
          upsertSelectedTextStyle({ text_align: "right" }, engine);
          return;
        }
        engine.commitDoc(alignSelection(engine.doc, selectedIds, "right"));
        return;
      case "align_justify":
        if (!selectedIds.length && activeTool === "text") {
          setTextToolPreset((prev) => ({ ...prev, textAlign: "justify" }));
          return;
        }
        if (!isTextOnlySelection) return;
        upsertSelectedTextStyle({ text_align: "justify" }, engine);
        return;
      case "align_top":
        engine.commitDoc(alignSelection(engine.doc, selectedIds, "top"));
        return;
      case "align_middle":
        engine.commitDoc(alignSelection(engine.doc, selectedIds, "middle"));
        return;
      case "align_bottom":
        engine.commitDoc(alignSelection(engine.doc, selectedIds, "bottom"));
        return;
      case "distribute_h":
        engine.commitDoc(distributeSelection(engine.doc, selectedIds, "horizontal"));
        return;
      case "distribute_v":
        engine.commitDoc(distributeSelection(engine.doc, selectedIds, "vertical"));
        return;
      case "line_color": {
        const color = payload?.color;
        if (!hasRenderableColor(color)) return;
        if (!selectedIds.length) {
          setActiveLinePreset({ color });
          return;
        }
        if (isTransientColorPreview || isColorPreviewCommit) {
          applyToolbarColorPreview("line_color", (sourceDoc) => ({
            ...sourceDoc,
            nodes: sourceDoc.nodes.map((node) => {
              if (!selectedIds.includes(node.id) || node.kind !== "line") return node;
              const currentStroke = (node.style?.stroke && typeof node.style.stroke === "object")
                ? (node.style.stroke as Record<string, unknown>)
                : {};
              return {
                ...node,
                style: {
                  ...node.style,
                  fill: color,
                  stroke: {
                    ...currentStroke,
                    color,
                    width: Math.max(1, Number(currentStroke.width || 4)),
                    dash: Array.isArray(currentStroke.dash) ? currentStroke.dash : [],
                    cap: String(currentStroke.cap || "round") === "round" ? "round" : "butt",
                  },
                },
              };
            }),
          }), { transient: isTransientColorPreview, commit: isColorPreviewCommit });
          return;
        }
        patchSelectedLineStyle({ color });
        return;
      }
      case "line_weight": {
        const value = Number(payload?.value ?? 4);
        if (!Number.isFinite(value)) return;
        if (!selectedIds.length) {
          setActiveLinePreset({ width: value });
          return;
        }
        patchSelectedLineStyle({ width: value });
        return;
      }
      case "line_opacity": {
        const value = Number(payload?.value ?? 100);
        if (!Number.isFinite(value)) return;
        if (!selectedIds.length) {
          setActiveLinePreset({ opacity: value });
          return;
        }
        patchSelectedLineStyle({ opacity: value });
        return;
      }
      case "element_opacity": {
        const value = Number(payload?.value ?? 100);
        if (!Number.isFinite(value)) return;
        if (!selectedIds.length) {
          const nextOpacity = Math.max(0, Math.min(100, Math.round(value)));
          if (isInsertShapeTool(activeTool)) {
            setShapeToolPreset((prev) => ({ ...prev, opacity: nextOpacity }));
            return;
          }
          if (activeTool === "line") {
            setLineToolPreset((prev) => ({ ...prev, opacity: nextOpacity }));
            return;
          }
          if (activeTool === "arrow") {
            setArrowToolPreset((prev) => ({ ...prev, opacity: nextOpacity }));
            return;
          }
          if (isDrawTool(activeTool)) {
            setDrawToolPresets((prev) => ({
              ...prev,
              [activeTool]: {
                ...(prev[activeTool] || DEFAULT_DRAW_TOOL_PRESET),
                opacity: nextOpacity,
              },
            }));
            return;
          }
          if (activeTool === "text") {
            setTextToolPreset((prev) => ({ ...prev, opacity: nextOpacity }));
            return;
          }
        }
        patchSelectionOpacity(value);
        return;
      }
      case "line_style": {
        if (!selectedIds.length) {
          setActiveLinePreset({
            ...(typeof payload?.dashPreset === "string" ? { dashPreset: payload.dashPreset as any } : {}),
            ...(payload?.roundedEndpoints != null ? { roundedEndpoints: Boolean(payload.roundedEndpoints) } : {}),
            ...(payload?.width != null ? { width: Number(payload.width) } : {}),
            ...(payload?.opacity != null ? { opacity: Number(payload.opacity) } : {}),
          });
          return;
        }
        patchSelectedLineStyle({
          ...(typeof payload?.dashPreset === "string" ? { dashPreset: payload.dashPreset as any } : {}),
          ...(payload?.roundedEndpoints != null ? { roundedEndpoints: Boolean(payload.roundedEndpoints) } : {}),
          ...(payload?.width != null ? { width: Number(payload.width) } : {}),
          ...(payload?.opacity != null ? { opacity: Number(payload.opacity) } : {}),
        });
        return;
      }
      case "shape_fill": {
        const color = payload?.color;
        if (!hasRenderableColor(color)) return;
        if (!selectedIds.length && activeTool === "frame") return;
        if (isFrameOnlySelection) return;
        if (!selectedIds.length && isInsertShapeTool(activeTool)) {
          setShapeToolPreset((prev) => ({ ...prev, fill: color }));
          return;
        }
        if (isTransientColorPreview || isColorPreviewCommit) {
          applyToolbarColorPreview("shape_fill", (sourceDoc) => ({
            ...sourceDoc,
            nodes: sourceDoc.nodes.map((node) => (
              selectedIds.includes(node.id)
                ? {
                  ...node,
                  style: {
                    ...node.style,
                    fill: color,
                  },
                }
                : node
            )),
          }), { transient: isTransientColorPreview, commit: isColorPreviewCommit });
          return;
        }
        engine.patchSelectedNode((node) => ({
          ...node,
          style: {
            ...node.style,
            fill: color,
          },
        }));
        return;
      }
      case "shape_stroke": {
        const color = payload?.color;
        if (color !== undefined && !hasRenderableColor(color)) return;
        const rawWidth = payload?.width != null ? Number(payload.width) : undefined;
        if (rawWidth !== undefined && !Number.isFinite(rawWidth)) return;
        const dashPreset = typeof payload?.dashPreset === "string"
          ? payload.dashPreset as ShapeToolPreset["strokeDashPreset"]
          : undefined;
        const patch = {
          ...(payload?.enabled != null ? { enabled: Boolean(payload.enabled) } : {}),
          ...(color !== undefined ? { color } : {}),
          ...(rawWidth !== undefined ? { width: rawWidth } : {}),
          ...(dashPreset ? { dashPreset } : {}),
        };
        if (!selectedIds.length && isInsertShapeTool(activeTool)) {
          if (activeTool === "frame" || activeTool === "auto_layout") return;
          setShapeToolPreset((prev) => {
            const nextWidth = rawWidth !== undefined
              ? Math.max(0, Math.round(rawWidth))
              : Math.max(1, Math.round(Number(prev.strokeWidth || 2)));
            const nextEnabled = patch.enabled ?? true;
            return {
              ...prev,
              strokeEnabled: nextEnabled && nextWidth > 0,
              stroke: color !== undefined ? color : prev.stroke,
              strokeWidth: nextWidth,
              strokeDashPreset: dashPreset || prev.strokeDashPreset,
            };
          });
          return;
        }
        if (!selectedIds.length || isFrameOnlySelection) return;
        if (isTransientColorPreview || isColorPreviewCommit) {
          applyToolbarColorPreview("shape_stroke", (sourceDoc) => (
            buildShapeStrokePatchDoc(sourceDoc, selectedIds, patch)
          ), { transient: isTransientColorPreview, commit: isColorPreviewCommit });
          return;
        }
        patchSelectedShapeStroke(patch);
        return;
      }
      case "shape_radius": {
        const value = Number(payload?.value ?? 0);
        if (!selectedIds.length && isInsertShapeTool(activeTool)) {
          const lockRadius = activeTool === "ellipse" || activeTool === "polygon" || activeTool === "star";
          if (lockRadius) return;
          const next = Math.max(0, Math.round(value));
          setShapeToolPreset((prev) => ({ ...prev, cornerRadius: next }));
          return;
        }
        if (!selectedIds.length) return;
        const selectedSet = new Set(selectedIds);
        let changed = false;
        const nextDoc: PinselaTemplateDocV1 = {
          ...engine.doc,
          nodes: engine.doc.nodes.map((node) => {
            if (!selectedSet.has(node.id)) return node;
            if (isRadiusLockedShape(node)) return node;
            if (node.kind === "line" || node.kind === "text") return node;
            const maxRadius = Math.max(0, Math.min(Number(node.geometry.width || 0), Number(node.geometry.height || 0)) / 2);
            const nextRadius = Math.max(0, Math.min(maxRadius, value));
            if (node.kind === "path") {
              if (!isRectLikePathNode(node)) return node;
              if (Math.abs(Number(node.geometry.corner_radius || 0) - nextRadius) < 0.001) return node;
              const nextPathData = buildRectLikePathData(node, nextRadius);
              if (!nextPathData) return node;
              changed = true;
              return {
                ...node,
                geometry: { ...node.geometry, corner_radius: nextRadius },
                path_data: nextPathData,
              };
            }
            if (Math.abs(Number(node.geometry.corner_radius || 0) - nextRadius) < 0.001) return node;
            changed = true;
            return {
              ...node,
              geometry: { ...node.geometry, corner_radius: nextRadius },
            };
          }),
        };
        if (changed) {
          engine.commitDoc(nextDoc);
        }
        return;
      }
      case "shape_sides":
      case "shape_points": {
        if (!selectedIds.length) return;
        const styleKey = actionId === "shape_sides" ? "shape_sides" : "star_points";
        const min = actionId === "shape_sides" ? 3 : 4;
        const max = actionId === "shape_sides" ? 24 : 24;
        const fallback = actionId === "shape_sides" ? 6 : 5;
        const selectedSet = new Set(selectedIds);
        const delta = Number(payload?.delta ?? 0);
        const directValue = payload?.value != null ? Number(payload.value) : null;
        let changed = false;
        const nextDoc: PinselaTemplateDocV1 = {
          ...engine.doc,
          nodes: engine.doc.nodes.map((node) => {
            if (!selectedSet.has(node.id) || node.kind !== "rect") return node;
            const style = (node.style || {}) as Record<string, unknown>;
            const shapeType = String(style.shape_type || "").toLowerCase();
            if (actionId === "shape_sides" && shapeType !== "polygon") return node;
            if (actionId === "shape_points" && shapeType !== "star") return node;
            const current = Math.round(Number(style[styleKey] ?? fallback));
            const target = directValue != null ? Math.round(directValue) : current + delta;
            const clamped = Math.max(min, Math.min(max, target));
            if (clamped === current) return node;
            changed = true;
            return { ...node, style: { ...node.style, [styleKey]: clamped } as PinselaNode["style"] };
          }),
        };
        if (changed) engine.commitDoc(nextDoc);
        return;
      }
      case "text_fit_mode": {
        const mode = payload?.mode === "fit" ? "fit" : "free";
        setTextToolPreset((prev) => ({ ...prev, fitMode: mode }));
        if (!selectedIds.length) return;
        const selectedSet = new Set(selectedIds);
        let changed = false;
        const nextDoc: PinselaTemplateDocV1 = {
          ...engine.doc,
          nodes: engine.doc.nodes.map((node) => {
            if (!selectedSet.has(node.id) || node.kind !== "text") return node;
            const currentSize = Math.max(6, Math.round(Number(node.text_style?.size || textToolPreset.fontSize || 42)));
            const nextFit = mode === "fit" ? buildTextFitRule(currentSize) : null;
            const nextModel = mode === "fit" ? "legacy" as const : "rich" as const;
            const currentFitMode = node.fit ? "fit" : "free";
            if (currentFitMode === mode && node.text_model === nextModel) return node;
            changed = true;
            return {
              ...node,
              text_model: nextModel,
              fit: nextFit,
            };
          }),
        };
        if (changed) engine.commitDoc(nextDoc);
        return;
      }
      case "text_font": {
        const family = String(payload?.fontFamily || "").trim();
        const style = String(payload?.fontStyle || "Regular").trim() || "Regular";
        if (!family) return;
        const styleLower = style.toLowerCase();
        const nextBold = styleLower.includes("bold");
        const nextItalic = styleLower.includes("italic");
        if (!selectedIds.length && activeTool === "text") {
          setTextToolPreset((prev) => ({
            ...prev,
            fontFamily: family,
            fontStyle: style,
            bold: nextBold,
            italic: nextItalic,
          }));
          return;
        }
        const selectedSet = new Set(selectedIds);
        const hasSelectedText = engine.doc.nodes.some((node) => selectedSet.has(node.id) && node.kind === "text");
        if (!hasSelectedText) return;
        const nextDoc: PinselaTemplateDocV1 = {
          ...engine.doc,
          nodes: engine.doc.nodes.map((node) => (
            selectedSet.has(node.id) && node.kind === "text"
              ? {
                ...node,
                text_style: {
                  ...(node.text_style || {}),
                  family,
                  style,
                  postscript: buildTextPostscriptName(family, style),
                },
              }
              : node
          )),
        };
        engine.commitDoc(nextDoc);
        return;
      }
      case "text_size": {
        const delta = Number(payload?.delta ?? 0);
        const value = payload?.value != null ? Number(payload.value) : NaN;
        const current = Number(engine.selectedNode?.text_style?.size || 42);
        const rawNext = Number.isFinite(value) ? value : current + delta;
        // Clamp to a sane range so a fat-fingered "99999" can't blow up the layout.
        const next = Math.min(800, Math.max(6, Math.round(rawNext)));
        if (!selectedIds.length && activeTool === "text") {
          setTextToolPreset((prev) => ({ ...prev, fontSize: next }));
          return;
        }
        upsertSelectedTextStyle({ size: next }, engine);
        return;
      }
      case "text_color": {
        const color = payload?.color;
        if (hasRenderableColor(color)) {
          if (!selectedIds.length && activeTool === "text") {
            setTextToolPreset((prev) => ({ ...prev, color }));
            return;
          }
          if (isTransientColorPreview || isColorPreviewCommit) {
            applyToolbarColorPreview("text_color", (sourceDoc) => ({
              ...sourceDoc,
              nodes: sourceDoc.nodes.map((node) => (
                selectedIds.includes(node.id) && node.kind === "text"
                  ? {
                    ...node,
                    text_style: {
                      ...(node.text_style || {}),
                      color,
                    },
                  }
                  : node
              )),
            }), { transient: isTransientColorPreview, commit: isColorPreviewCommit });
            return;
          }
          upsertSelectedTextStyle({ color }, engine);
        }
        return;
      }
      case "text_bold":
        if (!selectedIds.length && activeTool === "text") {
          setTextToolPreset((prev) => {
            const nextBold = !prev.bold;
            const nextStyle = nextBold
              ? (prev.italic ? "Bold Italic" : "Bold")
              : (prev.italic ? "Italic" : "Regular");
            return {
              ...prev,
              bold: nextBold,
              fontStyle: nextStyle,
            };
          });
          return;
        }
        upsertSelectedTextStyle({ style: textToolbarState.bold ? "Regular" : "Bold" }, engine);
        return;
      case "text_italic":
        if (!selectedIds.length && activeTool === "text") {
          if (!fontFamilySupportsItalic(textToolPreset.fontFamily)) return;
          setTextToolPreset((prev) => {
            const nextItalic = !prev.italic;
            const nextStyle = nextItalic
              ? (prev.bold ? "Bold Italic" : "Italic")
              : (prev.bold ? "Bold" : "Regular");
            return {
              ...prev,
              italic: nextItalic,
              fontStyle: nextStyle,
            };
          });
          return;
        }
        if (textToolbarState.canItalic === false) return;
        engine.patchSelectedNode((node) => {
          if (node.kind !== "text") return node;
          const current = node.text_style || {};
          const family = String(current.family || "Inter").trim() || "Inter";
          const rawStyle = String(current.style || "Regular").trim();
          const hadItalic = /\bitalic\b/i.test(rawStyle);
          const baseStyle = rawStyle.replace(/\bitalic\b/ig, "").replace(/\s+/g, " ").trim() || "Regular";
          const nextStyle = hadItalic ? baseStyle : `${baseStyle} Italic`;
          return {
            ...node,
            text_style: {
              ...current,
              style: nextStyle,
              postscript: buildTextPostscriptName(family, nextStyle),
            },
          };
        });
        return;
      case "text_underline":
        if (!selectedIds.length && activeTool === "text") {
          setTextToolPreset((prev) => ({ ...prev, underline: !prev.underline }));
          return;
        }
        if (textToolbarState.canUnderline === false) return;
        upsertSelectedTextStyle({ underline: !textToolbarState.underline }, engine);
        return;
      case "text_line_height": {
        const value = Number(payload?.value ?? 120);
        if (!selectedIds.length && activeTool === "text") {
          setTextToolPreset((prev) => ({ ...prev, lineHeight: Math.max(60, Math.min(300, Math.round(value))) }));
          return;
        }
        upsertSelectedTextStyle({ line_height: Math.max(60, Math.min(300, value)) }, engine);
        return;
      }
      case "text_tracking": {
        const value = Number(payload?.value ?? 0);
        if (!selectedIds.length && activeTool === "text") {
          setTextToolPreset((prev) => ({ ...prev, tracking: Math.max(-20, Math.min(50, Math.round(value))) }));
          return;
        }
        upsertSelectedTextStyle({ letter_spacing: Math.max(-20, Math.min(50, value)) }, engine);
        return;
      }
      case "text_path_toggle": {
        if (payload?.mode === "remove") {
          engine.patchSelectedNode((node) => {
            if (node.kind !== "text") return node;
            return { ...node, text_path: undefined };
          });
          engine.setMode("select");
          return;
        }
        if (engine.mode === "path-edit") {
          engine.setMode("select");
        } else {
          engine.patchSelectedNode((node) => {
            if (node.kind !== "text") return node;
            const nextPath = node.text_path || { type: "arc", radius: 120, start_angle: 0, sweep_angle: 180, clockwise: true };
            return { ...node, text_path: nextPath };
          });
          engine.setMode("path-edit");
        }
        return;
      }
      case "convert_to_curves": {
        if (!selectedIds.length) return;
        const baseDoc = engine.doc;
        const selectedSet = new Set(selectedIds);
        const textNodeIds = selectedNodes.filter((node) => node.kind === "text").map((node) => node.id);
        const vectorizableNodeIds = selectedNodes
          .filter((node) => node.kind !== "text" && node.kind !== "image" && node.kind !== "frame")
          .map((node) => node.id);

        let nextDoc = baseDoc;
        if (textNodeIds.length) {
          nextDoc = {
            ...nextDoc,
            nodes: nextDoc.nodes.map((node) => {
              if (!selectedSet.has(node.id) || node.kind !== "text") return node;
              return {
                ...node,
                text_path: {
                  ...(node.text_path || { type: "bezier" as const }),
                  type: "bezier",
                  points: bezierPointsForNode(node),
                },
              };
            }),
          };
        }

        if (!vectorizableNodeIds.length) {
          if (nextDoc !== baseDoc) {
            engine.commitDoc(nextDoc);
          }
          engine.setSelection(textNodeIds.length ? textNodeIds : selectedIds);
          activateCanvasTool("node");
          setActiveTab("properties");
          return;
        }

        void (async () => {
          const vectorized = await vectorizeNodesAsPaths(nextDoc, vectorizableNodeIds, {
            edgeThreshold: imageTraceState.edgeThreshold,
            curveTolerance: imageTraceState.curveTolerance,
            removeSources: true,
          });
          if (engine.doc !== baseDoc) return;
          const nextSelection = [...textNodeIds, ...vectorized.pathIds];
          if (!nextSelection.length) return;
          engine.commitDoc(vectorized.doc);
          engine.setSelection(nextSelection);
          activateCanvasTool("node");
          setActiveTab("properties");
        })();
        return;
      }
      case "image_fit":
        engine.patchSelectedNode((node) => ({ ...node, style: { ...node.style, image_fit: "fit" } }));
        return;
      case "image_fill":
        engine.patchSelectedNode((node) => ({ ...node, style: { ...node.style, image_fit: "fill" } }));
        return;
      case "image_crop":
        if (engine.selectedNode) {
          enterCropModeForNode(engine.selectedNode.id);
        }
        return;
      case "image_remove_background":
        runImageBackgroundRemoval();
        return;
      case "image_duotone": {
        if (engine.selectedNode?.kind !== "image") return;
        const nextState = normalizeImageDuotoneSettings(
          {
            ...toStoredImageDuotoneSettings(imageDuotoneState),
            ...(payload?.enabled != null ? { enabled: Boolean(payload.enabled) } : {}),
            ...(payload?.shadows !== undefined ? { shadows: payload.shadows } : {}),
            ...(payload?.highlights !== undefined ? { highlights: payload.highlights } : {}),
            ...(payload?.amount !== undefined ? { amount: Number(payload.amount) } : {}),
          },
          imageDuotoneState,
        );
        engine.patchSelectedNode((node) => (
          node.kind !== "image"
            ? node
            : {
              ...node,
              style: {
                ...node.style,
                image_duotone: toStoredImageDuotoneSettings(nextState),
              },
            }
        ));
        return;
      }
      case "image_fade": {
        if (engine.selectedNode?.kind !== "image") return;
        const fade = (payload?.fade ?? null) as PinselaImageFadeSettings | null;
        engine.patchSelectedNode((node) => (
          node.kind !== "image"
            ? node
            : { ...node, style: { ...node.style, image_fade: fade } }
        ));
        return;
      }
      case "image_brush": {
        applyImageBrushPatch(payload);
        return;
      }
      case "image_trace": {
        runImageTraceAction(payload);
        return;
      }
      case "vectorize_image": {
        if (!selectedIds.length) return;
        const imageNodeIds = selectedNodes
          .filter((node) => node.kind === "image" && String(node.image_src || "").trim().length > 0)
          .map((node) => node.id);
        if (!imageNodeIds.length) return;
        const baseDoc = engine.doc;
        void (async () => {
          const vectorized = await vectorizeNodesAsPaths(baseDoc, imageNodeIds, {
            edgeThreshold: imageTraceState.edgeThreshold,
            curveTolerance: imageTraceState.curveTolerance,
            removeSources: true,
          });
          if (!vectorized.pathIds.length) return;
          if (engine.doc !== baseDoc) return;
          engine.commitDoc(vectorized.doc);
          engine.setSelection(vectorized.pathIds);
          activateCanvasTool("node");
          setActiveTab("properties");
        })();
        return;
      }
      case "image_replace":
        imageReplaceTargetRef.current = selectedIds.length === 1 ? selectedIds[0] : null;
        setActiveLeft("assets");
        setLeftOpen(true);
        return;
      case "perspective_warp":
        setActiveLeft("perspective_warp");
        setLeftOpen(true);
        return;
      case "effects_menu":
        setActiveLeft("effects");
        setLeftOpen(true);
        return;
      case "style_menu":
      case "text_style_menu":
        setActiveLeft("stroke");
        setLeftOpen(true);
        return;
      case "images_menu":
        setActiveLeft("assets");
        setLeftOpen(true);
        return;
      case "component_go_source":
      case "component_sync":
      case "component_merge":
      case "component_reset":
      case "component_highlight":
        setActiveRight("automations");
        setRightOpen(true);
        return;
      case "mode_confirm":
        confirmCropMode();
        return;
      case "mode_cancel":
        cancelCropMode();
        return;
      case "mode_reset_crop":
        engine.patchSelectedNode((node) => ({ ...node, style: { ...node.style, image_fit: "fill", image_crop: null } }));
        cropModeSessionRef.current = null;
        cropTranslateSessionRef.current = null;
        engine.setMode("select");
        return;
      case "path_exit":
        activateCanvasTool("select");
        return;
      case "path_reset":
        if (engine.selectedNode?.kind === "path") {
          const pointCount = Array.isArray(engine.selectedNode.path_data?.points)
            ? engine.selectedNode.path_data!.points.length
            : 0;
          engine.patchSelectedNode((node) => (
            node.kind !== "path"
              ? node
              : pathResetHandles(node)
          ));
          if (pointCount > 0) {
            setSelectedPathPointIndex((current) => clampPathPointIndex(current == null ? 0 : current, pointCount));
          }
          return;
        }
        engine.patchSelectedNode((node) => {
          if (node.kind !== "text") return node;
          return { ...node, text_path: { type: "arc", radius: 120, start_angle: 0, sweep_angle: 180, clockwise: true } };
        });
        return;
      case "path_add":
        if (engine.selectedNode?.kind !== "path") return;
        {
          const result = pathAddPoint(
            engine.selectedNode,
            selectedPathPointIndex == null ? 0 : selectedPathPointIndex,
          );
          if (!result) return;
          engine.patchSelectedNode((node) => (node.kind === "path" ? result.node : node));
          setSelectedPathPointIndex(result.selectedIndex);
        }
        return;
      case "path_remove":
        if (engine.selectedNode?.kind !== "path") return;
        {
          const result = pathRemovePoint(
            engine.selectedNode,
            selectedPathPointIndex == null ? 0 : selectedPathPointIndex,
          );
          if (!result) return;
          engine.patchSelectedNode((node) => (node.kind === "path" ? result.node : node));
          setSelectedPathPointIndex(result.selectedIndex);
        }
        return;
      case "path_smooth":
        if (engine.selectedNode?.kind !== "path") return;
        {
          const result = pathSmoothPoint(
            engine.selectedNode,
            selectedPathPointIndex == null ? 0 : selectedPathPointIndex,
          );
          if (!result) return;
          engine.patchSelectedNode((node) => (node.kind === "path" ? result.node : node));
          setSelectedPathPointIndex(result.selectedIndex);
        }
        return;
      case "path_corner":
        if (engine.selectedNode?.kind !== "path") return;
        {
          const result = pathCornerPoint(
            engine.selectedNode,
            selectedPathPointIndex == null ? 0 : selectedPathPointIndex,
          );
          if (!result) return;
          engine.patchSelectedNode((node) => (node.kind === "path" ? result.node : node));
          setSelectedPathPointIndex(result.selectedIndex);
        }
        return;
      case "path_radius":
      case "path_start_angle":
      case "path_sweep_angle": {
        const value = Number(payload?.value ?? 0);
        engine.patchSelectedNode((node) => {
          if (node.kind !== "text") return node;
          const path = node.text_path || { type: "arc", radius: 120, start_angle: 0, sweep_angle: 180, clockwise: true };
          if (actionId === "path_radius") return { ...node, text_path: { ...path, radius: Math.max(0, value) } };
          if (actionId === "path_start_angle") return { ...node, text_path: { ...path, start_angle: value } };
          return { ...node, text_path: { ...path, sweep_angle: value } };
        });
        return;
      }
      case "text_exit":
        engine.setMode("select");
        return;
      default:
        return;
    }
  }, [
    engine,
    renderer,
    activateCanvasTool,
    activeTool,
    selectedPathPointIndex,
    setActiveLinePreset,
    textToolPreset.fontFamily,
    textToolPreset.fontSize,
    textToolbarState,
    patchSelectedLineStyle,
    patchSelectedShapeStroke,
    buildShapeStrokePatchDoc,
    patchSelectionOpacity,
    flushToolbarColorPreview,
    applyToolbarColorPreview,
    applyImageBrushPatch,
    imageDuotoneState,
    imageTraceState.edgeThreshold,
    imageTraceState.curveTolerance,
    runImageTraceAction,
    vectorizeNodesAsPaths,
    enterCropModeForNode,
    runImageBackgroundRemoval,
    confirmCropMode,
    cancelCropMode,
  ]);

  React.useEffect(() => {
    const brushShortcutActive = imageBrushState.enabled && engine.selectedNode?.kind === "image";
    if (!brushShortcutActive) return;

    function onBrushShortcut(ev: KeyboardEvent) {
      if (isKeyboardEditableTarget(ev.target)) return;
      if (isKeyboardInMenuContext(ev.target)) return;
      if (ev.ctrlKey || ev.metaKey) return;
      if (ev.code !== "BracketLeft" && ev.code !== "BracketRight") return;

      ev.preventDefault();
      const direction = ev.code === "BracketRight" ? 1 : -1;

      if (ev.shiftKey) {
        const baseOpacity = Number(imageBrushState.opacity || 100);
        const nextOpacity = clampRange(baseOpacity + direction * 5, 0, 100, baseOpacity);
        applyImageBrushPatch({
          enabled: true,
          settings: { opacity: Math.round(nextOpacity) },
        });
        return;
      }

      const baseSize = Number(imageBrushState.size || 120);
      const step =
        baseSize >= 600 ? 40
          : baseSize >= 240 ? 20
            : baseSize >= 80 ? 10
              : 5;
      const nextSize = clampRange(baseSize + direction * step, 1, 2200, baseSize);
      applyImageBrushPatch({
        enabled: true,
        settings: { size: Math.round(nextSize) },
      });
    }

    window.addEventListener("keydown", onBrushShortcut);
    return () => {
      window.removeEventListener("keydown", onBrushShortcut);
    };
  }, [engine.selectedNode?.kind, imageBrushState.enabled, imageBrushState.opacity, imageBrushState.size, applyImageBrushPatch]);

  const onResizeSelectionGesture = useCallback((event: ResizeSelectionGestureEvent) => {
    // Crop mode: the 8 handles resize the crop FRAME over a fixed image (Canva
    // style). The image stays put; the frame reveals/hides pixels. Crop is
    // derived from the clamped frame so it can never distort.
    if (engine.mode === "crop") {
      const cropModeSession = cropModeSessionRef.current;
      const activeDoc = cropModeSession?.latestDoc || engine.doc;
      const nodeId = engine.selectedNode?.id || cropModeSession?.nodeId || null;
      const node = nodeId ? activeDoc.nodes.find((entry) => entry.id === nodeId) || null : null;
      if (!canNodeHostImageCrop(node) || node.style?.locked) {
        if (event.phase === "end") cropFrameSessionRef.current = null;
        return;
      }

      if (event.phase === "start") {
        cancelPendingPreviewClear();
        const baseCrop = resolveDefaultCropForNode(node, renderer.imageCacheRef.current);
        const box = {
          x: Number(node.geometry.x || 0),
          y: Number(node.geometry.y || 0),
          width: Math.max(1, Number(node.geometry.width || 1)),
          height: Math.max(1, Number(node.geometry.height || 1)),
        };
        const imageRect = imageRectFromCrop(
          box,
          { x: baseCrop.x, y: baseCrop.y, width: baseCrop.width, height: baseCrop.height },
          baseCrop.imageWidth,
          baseCrop.imageHeight,
        );
        cropFrameSessionRef.current = {
          baseDoc: activeDoc,
          nodeId: node.id,
          imageRect,
          imageWidth: baseCrop.imageWidth,
          imageHeight: baseCrop.imageHeight,
          latestDoc: activeDoc,
          moved: false,
        };
        return;
      }

      const frameSession = cropFrameSessionRef.current;
      if (!frameSession || frameSession.nodeId !== node.id) return;

      if (event.phase === "move") {
        if (!event.nextBounds) return;
        const result = resizeCropFrame(
          (event.handle || "br") as CropResizeHandle,
          { x: event.nextBounds.x, y: event.nextBounds.y, width: event.nextBounds.w, height: event.nextBounds.h },
          frameSession.imageRect,
          frameSession.imageWidth,
          frameSession.imageHeight,
        );
        const nextCrop = {
          x: Math.round(result.crop.x),
          y: Math.round(result.crop.y),
          width: Math.max(1, Math.round(result.crop.width)),
          height: Math.max(1, Math.round(result.crop.height)),
        };
        const nextDoc = patchNodeById(frameSession.baseDoc, frameSession.nodeId, (entry) => ({
          ...entry,
          geometry: {
            ...entry.geometry,
            x: Math.round(result.box.x),
            y: Math.round(result.box.y),
            width: Math.max(1, Math.round(result.box.width)),
            height: Math.max(1, Math.round(result.box.height)),
          },
          style: { ...entry.style, image_fit: "crop", image_crop: nextCrop },
        }));
        frameSession.latestDoc = nextDoc;
        frameSession.moved = true;
        cropLiveRef.current = {
          box: { x: Math.round(result.box.x), y: Math.round(result.box.y), width: Math.max(1, Math.round(result.box.width)), height: Math.max(1, Math.round(result.box.height)) },
          crop: nextCrop,
        };
        if (cropModeSessionRef.current) {
          cropModeSessionRef.current.latestDoc = nextDoc;
          cropModeSessionRef.current.changed = true;
        }
        schedulePreviewDocUpdate(nextDoc, [], selectionBounds(nextDoc, [frameSession.nodeId]));
        return;
      }

      if (event.phase === "end") {
        if (frameSession.latestDoc && cropModeSessionRef.current) {
          cropModeSessionRef.current.latestDoc = frameSession.latestDoc;
          cropModeSessionRef.current.changed = cropModeSessionRef.current.changed || frameSession.moved;
        }
        cropFrameSessionRef.current = null;
        return;
      }
      return;
    }

    // Quick-crop: a SIDE handle on a single cover-style image crops (reveals or
    // hides) at a fixed image scale instead of stretching the picture.
    const isSideHandle = event.handle === "tc" || event.handle === "bc" || event.handle === "ml" || event.handle === "mr";
    if (isSideHandle && engine.selection.length === 1) {
      const nodeId = engine.selection[0];
      const node = engine.doc.nodes.find((entry) => entry.id === nodeId) || null;
      const fit = String(node?.style?.image_fit || "fill").toLowerCase();
      // Don't quick-crop an auto-layout container frame (it should resize/reflow,
      // not crop its background image).
      const quickCroppable = canNodeHostImageCrop(node) && !node.style?.locked && (fit === "crop" || fit === "fill") && !isAutoLayoutContainerNode(node);
      if (quickCroppable && node) {
        if (event.phase === "start") {
          cancelPendingPreviewClear();
          setSelectionInteractionPreview("resize");
          const baseCrop = resolveDefaultCropForNode(node, renderer.imageCacheRef.current);
          const box = {
            x: Number(node.geometry.x || 0),
            y: Number(node.geometry.y || 0),
            width: Math.max(1, Number(node.geometry.width || 1)),
            height: Math.max(1, Number(node.geometry.height || 1)),
          };
          const hasCrop = fit === "crop" && node.style?.image_crop && Number(node.style.image_crop.width) > 0;
          const cropRect = hasCrop
            ? { x: baseCrop.x, y: baseCrop.y, width: baseCrop.width, height: baseCrop.height }
            : coverCrop(baseCrop.imageWidth, baseCrop.imageHeight, box.width, box.height);
          quickCropSessionRef.current = {
            baseDoc: engine.doc,
            nodeId,
            imageRect: imageRectFromCrop(box, cropRect, baseCrop.imageWidth, baseCrop.imageHeight),
            imageWidth: baseCrop.imageWidth,
            imageHeight: baseCrop.imageHeight,
            latestDoc: null,
            moved: false,
          };
          return;
        }
        const qs = quickCropSessionRef.current;
        if (qs && qs.nodeId === nodeId) {
          if (event.phase === "move") {
            if (!event.nextBounds) return;
            const result = resizeCropFrame(
              event.handle as CropResizeHandle,
              { x: event.nextBounds.x, y: event.nextBounds.y, width: event.nextBounds.w, height: event.nextBounds.h },
              qs.imageRect,
              qs.imageWidth,
              qs.imageHeight,
            );
            const nextDoc = patchNodeById(qs.baseDoc, qs.nodeId, (entry) => ({
              ...entry,
              geometry: {
                ...entry.geometry,
                x: Math.round(result.box.x),
                y: Math.round(result.box.y),
                width: Math.max(1, Math.round(result.box.width)),
                height: Math.max(1, Math.round(result.box.height)),
              },
              style: {
                ...entry.style,
                image_fit: "crop",
                image_crop: {
                  x: Math.round(result.crop.x),
                  y: Math.round(result.crop.y),
                  width: Math.max(1, Math.round(result.crop.width)),
                  height: Math.max(1, Math.round(result.crop.height)),
                },
              },
            }));
            qs.latestDoc = nextDoc;
            qs.moved = true;
            schedulePreviewDocUpdate(nextDoc, [], selectionBounds(nextDoc, [qs.nodeId]));
            return;
          }
          if (event.phase === "end") {
            flushPreviewDocUpdate();
            setSelectionInteractionPreview(null);
            if (qs.moved && qs.latestDoc) {
              commitTransientDoc(qs.baseDoc, qs.latestDoc);
              schedulePreviewClear();
            } else {
              renderer.clearPreviewScene();
            }
            quickCropSessionRef.current = null;
            return;
          }
        }
      }
    }

    if (event.phase === "start") {
      cancelPendingPreviewClear();
      setSelectionInteractionPreview("resize");
      resizeSelectionSessionRef.current = {
        baseDoc: engine.doc,
        selectedIds: [...engine.selection],
        originalBounds: event.originalBounds,
        latestDoc: null,
        moved: false,
      };
      return;
    }

    const session = resizeSelectionSessionRef.current;
    if (!session) return;

    if (event.phase === "move") {
      if (!event.nextBounds) return;
      const nextDoc = resizeSelectionFromBounds(
        session.baseDoc,
        session.selectedIds,
        session.originalBounds,
        event.nextBounds,
        event.handle,
      );
      session.latestDoc = nextDoc;
      session.moved = true;
      schedulePreviewDocUpdate(nextDoc, [], event.nextBounds);
      return;
    }

    if (event.phase === "end") {
      flushPreviewDocUpdate();
      setSelectionInteractionPreview(null);
      if (session.moved && session.latestDoc) {
        commitTransientDoc(session.baseDoc, session.latestDoc);
        schedulePreviewClear();
      } else {
        renderer.clearPreviewScene();
      }
      resizeSelectionSessionRef.current = null;
    }
  }, [cancelPendingPreviewClear, commitTransientDoc, engine.doc, engine.mode, engine.selectedNode, engine.selection, flushPreviewDocUpdate, renderer, schedulePreviewClear, schedulePreviewDocUpdate]);

  const onSelectionQuickAction = useCallback((actionId: SelectionQuickActionId) => {
    if (actionId === "duplicate") {
      engine.duplicateSelection();
      return;
    }
    if (actionId === "delete") {
      engine.deleteSelection();
      return;
    }
    if (actionId === "rotate_cw_15") {
      if (!engine.selection.length) return;
      engine.commitDoc(rotateSelectionByDelta(engine.doc, engine.selection, 15));
    }
  }, [engine]);

  const onTranslateSelectionGesture = useCallback((event: TranslateSelectionGestureEvent) => {
    if (engine.mode === "crop") {
      const cropModeSession = cropModeSessionRef.current;
      const activeDoc = cropModeSession?.latestDoc || engine.doc;
      const activeNodeId = engine.selectedNode?.id || cropModeSession?.nodeId || null;
      const activeNode = activeNodeId
        ? activeDoc.nodes.find((node) => node.id === activeNodeId) || null
        : null;
      if (!canNodeHostImageCrop(activeNode) || activeNode.style?.locked) {
        if (event.phase === "end") {
          cropTranslateSessionRef.current = null;
        }
        return;
      }

      if (event.phase === "start") {
        cancelPendingPreviewClear();
        const baseCrop = resolveDefaultCropForNode(activeNode, renderer.imageCacheRef.current);
        cropTranslateSessionRef.current = {
          baseDoc: activeDoc,
          nodeId: activeNode.id,
          startCrop: {
            x: baseCrop.x,
            y: baseCrop.y,
            width: baseCrop.width,
            height: baseCrop.height,
          },
          geometry: {
            width: Math.max(1, Number(activeNode.geometry.width || 1)),
            height: Math.max(1, Number(activeNode.geometry.height || 1)),
          },
          image: {
            width: Math.max(1, baseCrop.imageWidth),
            height: Math.max(1, baseCrop.imageHeight),
          },
          latestDoc: activeDoc,
          moved: false,
        };
        return;
      }

      const cropSession = cropTranslateSessionRef.current;
      if (!cropSession || cropSession.nodeId !== activeNode.id) return;

      if (event.phase === "move") {
        const dx = Number(event.dx || 0);
        const dy = Number(event.dy || 0);
        const scaleX = cropSession.startCrop.width / Math.max(1, cropSession.geometry.width);
        const scaleY = cropSession.startCrop.height / Math.max(1, cropSession.geometry.height);
        const deltaX = dx * scaleX;
        const deltaY = dy * scaleY;
        const cropWidth = Math.min(cropSession.image.width, Math.max(1, cropSession.startCrop.width));
        const cropHeight = Math.min(cropSession.image.height, Math.max(1, cropSession.startCrop.height));
        const nextCrop = {
          x: Math.max(0, Math.min(cropSession.image.width - cropWidth, cropSession.startCrop.x + deltaX)),
          y: Math.max(0, Math.min(cropSession.image.height - cropHeight, cropSession.startCrop.y + deltaY)),
          width: cropWidth,
          height: cropHeight,
        };
        const nextDoc = patchNodeById(cropSession.baseDoc, cropSession.nodeId, (node) => ({
          ...node,
          style: {
            ...node.style,
            image_fit: "crop",
            image_crop: nextCrop,
          },
        }));
        cropSession.latestDoc = nextDoc;
        cropLiveRef.current = {
          box: {
            x: Number(activeNode.geometry.x || 0),
            y: Number(activeNode.geometry.y || 0),
            width: cropSession.geometry.width,
            height: cropSession.geometry.height,
          },
          crop: nextCrop,
        };
        cropSession.moved = cropSession.moved
          || Math.abs(nextCrop.x - cropSession.startCrop.x) > 0.001
          || Math.abs(nextCrop.y - cropSession.startCrop.y) > 0.001;
        if (cropModeSessionRef.current) {
          cropModeSessionRef.current.latestDoc = nextDoc;
          cropModeSessionRef.current.changed = true;
        }
        schedulePreviewDocUpdate(nextDoc, [], selectionBounds(nextDoc, [cropSession.nodeId]));
        return;
      }

      if (event.phase === "end") {
        if (cropSession.latestDoc && cropModeSessionRef.current) {
          cropModeSessionRef.current.latestDoc = cropSession.latestDoc;
          cropModeSessionRef.current.changed = cropModeSessionRef.current.changed || cropSession.moved;
        }
        cropTranslateSessionRef.current = null;
      }
      return;
    }

    if (event.phase === "start") {
      const gestureSelectionIds = Array.isArray(event.selectionIds) && event.selectionIds.length
        ? [...event.selectionIds]
        : [...engine.selection];
      const gestureBaseDoc = event.baseDoc || engine.doc;
      cancelPendingPreviewClear();
      setSelectionInteractionPreview("move");
      disableSelectionMoveRasterPreview(false);
      const rasterToken = translateRasterPreviewTokenRef.current + 1;
      translateRasterPreviewTokenRef.current = rasterToken;
      translateSelectionSessionRef.current = {
        baseDoc: gestureBaseDoc,
        selectedIds: gestureSelectionIds,
        baseBounds: selectionBounds(gestureBaseDoc, gestureSelectionIds),
        latestDoc: null,
        moved: false,
        lastDx: 0,
        lastDy: 0,
        duplicated: false,
        duplicateBaseDoc: null,
        duplicateIds: [],
        duplicateRequested: !!event.altKey,
        frameDropTargetId: null,
        autoLayoutDropTargetId: null,
        hiddenBaseDoc: null,
        rasterPreviewEnabled: false,
        rasterToken,
        lockedAxis: null,
      };
      selectionMovePreviewOffsetRef.current = { dx: 0, dy: 0 };
      selectionGestureGuidesRef.current = [];
      engine.dispatch({ type: "set_guides", guides: [] });
      updateGestureFrameDropTarget(null);
      if (allowSelectionMoveRasterPreview && !event.altKey && gestureSelectionIds.length > 0) {
        void prepareSelectionMoveRasterPreview(gestureBaseDoc, gestureSelectionIds, rasterToken);
      }
      return;
    }

    const session = translateSelectionSessionRef.current;
    if (!session) return;

    if (event.phase === "move") {
      const rawDx = Math.round(Number(event.dx || 0));
      const rawDy = Math.round(Number(event.dy || 0));
      const constrained = resolveAxisLockedDelta(rawDx, rawDy, !!event.shiftKey, session.lockedAxis);
      session.lockedAxis = constrained.lockedAxis;
      const dx = constrained.dx;
      const dy = constrained.dy;
      const wantsDuplicate = session.duplicateRequested || !!event.altKey;
      if (!session.duplicated && wantsDuplicate && (dx !== 0 || dy !== 0)) {
        const duplicated = duplicateSelectionForDrag(session.baseDoc, session.selectedIds);
        if (duplicated.duplicatedIds.length) {
          disableSelectionMoveRasterPreview(true);
          session.duplicated = true;
          session.duplicateBaseDoc = duplicated.doc;
          session.duplicateIds = duplicated.duplicatedIds;
          engine.setSelection(duplicated.duplicatedIds);
        }
      }
      const moveBaseDoc = session.duplicated && session.duplicateBaseDoc
        ? session.duplicateBaseDoc
        : session.baseDoc;
      const moveIds = session.duplicated ? session.duplicateIds : session.selectedIds;
      const freeMove = !!event.metaKey;
      const effectiveSnapOptions: SnapOptions = freeMove
        ? { ...pointerSnapOptions, enabled: false, viewportScale: renderer.stageScale }
        : { ...pointerSnapOptions, viewportScale: renderer.stageScale };
      const snapped = snapMove(
        moveBaseDoc,
        moveIds,
        dx,
        dy,
        Number(pointerSnapOptions?.tolerance ?? 20),
        effectiveSnapOptions,
      );
      session.lastDx = snapped.dx;
      session.lastDy = snapped.dy;
      let frameDropTargetId: string | null = null;
      let autoLayoutDropTargetId: string | null = null;
      const movedBounds = session.baseBounds
        ? {
          x: session.baseBounds.x + snapped.dx,
          y: session.baseBounds.y + snapped.dy,
          w: session.baseBounds.w,
          h: session.baseBounds.h,
        }
        : selectionBounds(moveBaseDoc, moveIds);
      if (movedBounds) {
        const centerPoint = {
          x: Number(movedBounds.x || 0) + Math.max(0, Number(movedBounds.w || 0)) / 2,
          y: Number(movedBounds.y || 0) + Math.max(0, Number(movedBounds.h || 0)) / 2,
        };
        const autoLayoutTarget = resolveAutoLayoutDropTargetAtPoint(moveBaseDoc, centerPoint, { skipNodeIds: moveIds });
        autoLayoutDropTargetId = autoLayoutTarget?.id || null;
      }
      if (!autoLayoutDropTargetId && moveIds.length === 1) {
        const movedNode = moveBaseDoc.nodes.find((node) => node.id === moveIds[0]) || null;
        const movedNodeHasSrc = movedNode && movedNode.kind === "image" && String(movedNode.image_src || "").trim().length > 0;
        if (movedNode && movedNodeHasSrc) {
          const centerPoint = {
            x: Number((movedBounds?.x ?? movedNode.geometry.x) || 0) + Math.max(0, Number((movedBounds?.w ?? movedNode.geometry.width) || 0)) / 2,
            y: Number((movedBounds?.y ?? movedNode.geometry.y) || 0) + Math.max(0, Number((movedBounds?.h ?? movedNode.geometry.height) || 0)) / 2,
          };
          const frameTarget = resolveFrameDropTargetAtPoint(moveBaseDoc, centerPoint, { skipNodeIds: moveIds });
          frameDropTargetId = frameTarget?.id || null;
        }
      }
      const previewDropTargetId = autoLayoutDropTargetId || frameDropTargetId;
      session.frameDropTargetId = frameDropTargetId;
      session.autoLayoutDropTargetId = autoLayoutDropTargetId;
      session.moved = session.moved || snapped.dx !== 0 || snapped.dy !== 0;
      selectionMovePreviewOffsetRef.current = { dx: snapped.dx, dy: snapped.dy };
      selectionGestureGuidesRef.current = freeMove ? [] : (snapped.guides || []);
      updateGestureFrameDropTarget(previewDropTargetId);
      if (session.rasterPreviewEnabled && !session.duplicated) {
        session.latestDoc = null;
        return;
      }
      const nextDoc = translateSelectionByDelta(moveBaseDoc, moveIds, snapped.dx, snapped.dy);
      session.latestDoc = nextDoc;
      schedulePreviewDocUpdate(nextDoc, [], movedBounds);
      return;
    }

    if (event.phase === "end") {
      flushPreviewDocUpdate();
      engine.dispatch({ type: "set_guides", guides: [] });
      setSelectionInteractionPreview(null);
      selectionMovePreviewOffsetRef.current = null;
      selectionGestureGuidesRef.current = [];
      updateGestureFrameDropTarget(null);
      if (session.moved) {
        const moveIds = session.duplicated ? session.duplicateIds : session.selectedIds;
        const sessionDoc = session.duplicated && session.latestDoc ? session.latestDoc : session.baseDoc;
        const pageTransfer = event.pageTransfer;
        const targetPageId = String(pageTransfer?.targetPageId || "").trim();
        const sourcePageId = String(activeProjectPageIdRef.current || "").trim();
        if (targetPageId && sourcePageId && targetPageId !== sourcePageId) {
          const transferSourceDoc = session.duplicated && session.duplicateBaseDoc
            ? session.duplicateBaseDoc
            : session.baseDoc;
          const pagesSnapshot = buildProjectPagesSnapshot(transferSourceDoc);
          const targetPage = pagesSnapshot.find((page) => page.id === targetPageId) || null;
          if (targetPage && moveIds.length) {
            const transfer = moveSelectionBetweenProjectPageDocs(
              transferSourceDoc,
              targetPage.doc,
              moveIds,
              Number(pageTransfer?.dx || 0),
              Number(pageTransfer?.dy || 0),
            );
            if (transfer.selectionIds.length) {
              const nextPages = pagesSnapshot.map((page) => {
                if (page.id === sourcePageId) return { ...page, doc: transfer.sourceDoc };
                if (page.id === targetPageId) return { ...page, doc: transfer.targetDoc };
                return page;
              });
              replaceProjectPagesState(nextPages);
              markProjectPagesDirty();
              applyProjectPageToEditor(targetPageId, transfer.targetDoc, true, { fitViewport: false });
              window.setTimeout(() => {
                engine.setSelection(transfer.selectionIds);
              }, 0);
              schedulePreviewClear();
              disableSelectionMoveRasterPreview(false);
              session.lockedAxis = null;
              translateSelectionSessionRef.current = null;
              return;
            }
          }
        }
        const autoLayoutTargetId = String(session.autoLayoutDropTargetId || "").trim();
        if (autoLayoutTargetId) {
          const withAutoLayout = reparentNodesToContainer(
            sessionDoc,
            moveIds,
            autoLayoutTargetId,
            { placement: "end" },
          );
          if (withAutoLayout !== sessionDoc) {
            commitTransientDoc(session.baseDoc, withAutoLayout);
            engine.setSelection(moveIds);
            schedulePreviewClear();
            session.lockedAxis = null;
            translateSelectionSessionRef.current = null;
            disableSelectionMoveRasterPreview(false);
            return;
          }
        }
        const draggedId = moveIds.length === 1 ? moveIds[0] : null;
        const frameTargetId = String(session.frameDropTargetId || "").trim();
        const draggedNode = draggedId
          ? sessionDoc.nodes.find((node) => node.id === draggedId) || null
          : null;
        const canApplyToFrame = !!draggedNode
          && draggedNode.kind === "image"
          && String(draggedNode.image_src || "").trim().length > 0
          && !!frameTargetId;
        if (canApplyToFrame) {
          const src = String(draggedNode?.image_src || "").trim();
          const frameNode = sessionDoc.nodes.find((node) => node.id === frameTargetId) || null;
          if (frameNode && isFrameDropTargetCandidate(sessionDoc, frameNode)) {
            const withAppliedFrame: PinselaTemplateDocV1 = {
              ...sessionDoc,
              nodes: sessionDoc.nodes.map((node) => (
                node.id !== frameTargetId
                  ? node
                  : {
                    ...node,
                    image_src: src,
                    editable: true,
                    style: {
                      ...node.style,
                      image_fit: "fill",
                      image_crop: null,
                    },
                  }
              )),
            };
            const cleanedDoc = removeNodes(withAppliedFrame, [draggedId!]);
            commitTransientDoc(session.baseDoc, cleanedDoc);
            engine.setSelection([frameTargetId]);
            schedulePreviewClear();
          } else {
            commitTransientDoc(
              session.baseDoc,
              session.duplicated && session.latestDoc
                ? session.latestDoc
                : translateSelectionByDelta(session.baseDoc, moveIds, session.lastDx, session.lastDy),
            );
            schedulePreviewClear();
          }
        } else {
          commitTransientDoc(
            session.baseDoc,
            session.duplicated && session.latestDoc
              ? session.latestDoc
              : translateSelectionByDelta(session.baseDoc, moveIds, session.lastDx, session.lastDy),
          );
          schedulePreviewClear();
        }
      } else {
        renderer.clearPreviewScene();
      }
      disableSelectionMoveRasterPreview(false);
      session.lockedAxis = null;
      translateSelectionSessionRef.current = null;
    }
  }, [allowSelectionMoveRasterPreview, applyProjectPageToEditor, buildProjectPagesSnapshot, cancelPendingPreviewClear, commitTransientDoc, disableSelectionMoveRasterPreview, engine, flushPreviewDocUpdate, markProjectPagesDirty, pointerSnapOptions, prepareSelectionMoveRasterPreview, renderer, replaceProjectPagesState, schedulePreviewClear, schedulePreviewDocUpdate, updateGestureFrameDropTarget]);
  translateSelectionGestureDelegateRef.current = onTranslateSelectionGesture;

  const onCropWheel = useCallback((event: { deltaY: number; point: { x: number; y: number } }) => {
    if (engine.mode !== "crop") return;
    const cropModeSession = cropModeSessionRef.current;
    const baseDoc = cropModeSession?.latestDoc || engine.doc;
    const nodeId = engine.selectedNode?.id || cropModeSession?.nodeId || null;
    if (!nodeId) return;
    const node = baseDoc.nodes.find((entry) => entry.id === nodeId) || null;
    if (!canNodeHostImageCrop(node) || node.style?.locked) return;

    const baseCrop = resolveDefaultCropForNode(node, renderer.imageCacheRef.current);
    const box = {
      x: Number(node.geometry.x || 0),
      y: Number(node.geometry.y || 0),
      width: Math.max(1, Number(node.geometry.width || 1)),
      height: Math.max(1, Number(node.geometry.height || 1)),
    };
    const cropRect = { x: baseCrop.x, y: baseCrop.y, width: baseCrop.width, height: baseCrop.height };
    const imageRect = imageRectFromCrop(box, cropRect, baseCrop.imageWidth, baseCrop.imageHeight);
    // deltaY>0 = zoom out → image shrinks (reveals more); deltaY<0 = zoom in.
    // The I-model keeps the image covering the frame and preserves aspect, so the
    // crop can never distort the way the old per-axis clamp could.
    const factor = Number(event.deltaY || 0) > 0 ? 0.92 : 1.08;
    const pivot = { x: Number(event.point.x || 0), y: Number(event.point.y || 0) };
    const nextImageRect = zoomImageRect(imageRect, box, factor, pivot, {
      imageW: baseCrop.imageWidth,
      imageH: baseCrop.imageHeight,
      minCropFraction: 0.03,
    });
    const derived = cropFromImageRect(box, nextImageRect, baseCrop.imageWidth, baseCrop.imageHeight);
    const nextCrop = {
      x: Math.max(0, Math.min(baseCrop.imageWidth - 1, Math.round(derived.x))),
      y: Math.max(0, Math.min(baseCrop.imageHeight - 1, Math.round(derived.y))),
      width: Math.max(1, Math.round(derived.width)),
      height: Math.max(1, Math.round(derived.height)),
    };

    const nextDoc = patchNodeById(baseDoc, node.id, (entry) => ({
      ...entry,
      style: {
        ...entry.style,
        image_fit: "crop",
        image_crop: nextCrop,
      },
    }));
    cropLiveRef.current = { box: { ...box }, crop: nextCrop };
    if (cropModeSessionRef.current) {
      cropModeSessionRef.current.latestDoc = nextDoc;
      cropModeSessionRef.current.changed = true;
    } else {
      cropModeSessionRef.current = {
        baseDoc: engine.doc,
        nodeId: node.id,
        latestDoc: nextDoc,
        changed: true,
      };
    }
    cancelPendingPreviewClear();
    schedulePreviewDocUpdate(nextDoc, [], selectionBounds(nextDoc, [node.id]));
  }, [cancelPendingPreviewClear, engine, renderer.imageCacheRef, schedulePreviewDocUpdate]);

  const onRotateSelectionGesture = useCallback((event: RotateSelectionGestureEvent) => {
    if (event.phase === "start") {
      cancelPendingPreviewClear();
      rotateSelectionSessionRef.current = {
        baseDoc: engine.doc,
        selectedIds: [...engine.selection],
        latestDoc: null,
        moved: false,
      };
      return;
    }

    const session = rotateSelectionSessionRef.current;
    if (!session) return;

    if (event.phase === "move") {
      const deltaDeg = Number(event.deltaDeg || 0);
      if (!Number.isFinite(deltaDeg)) return;
      const nextDoc = rotateSelectionByDelta(session.baseDoc, session.selectedIds, deltaDeg);
      session.latestDoc = nextDoc;
      session.moved = session.moved || Math.abs(deltaDeg) > 0.001;
      schedulePreviewDocUpdate(nextDoc, [], selectionBounds(nextDoc, session.selectedIds));
      return;
    }

    if (event.phase === "end") {
      flushPreviewDocUpdate();
      if (session.moved && session.latestDoc) {
        commitTransientDoc(session.baseDoc, session.latestDoc);
        schedulePreviewClear();
      } else {
        renderer.clearPreviewScene();
      }
      rotateSelectionSessionRef.current = null;
    }
  }, [cancelPendingPreviewClear, commitTransientDoc, engine, flushPreviewDocUpdate, renderer, schedulePreviewClear, schedulePreviewDocUpdate]);

  const onLineEndpointGesture = useCallback((event: LineEndpointGestureEvent) => {
    if (engine.selectedNode?.kind !== "line") return;
    if (event.phase === "start") {
      cancelPendingPreviewClear();
      lineEndpointSessionRef.current = {
        baseDoc: engine.doc,
        nodeId: engine.selectedNode.id,
        latestDoc: null,
        moved: false,
      };
      return;
    }

    const session = lineEndpointSessionRef.current;
    if (!session) return;

    if (event.phase === "move") {
      const nextGeometry = event.nextGeometry;
      if (!nextGeometry) return;
      const nextDoc = {
        ...session.baseDoc,
        nodes: session.baseDoc.nodes.map((node) => (
          node.id !== session.nodeId
            ? node
            : {
              ...node,
              geometry: {
                ...node.geometry,
                ...(nextGeometry.x != null ? { x: Math.round(Number(nextGeometry.x)) } : {}),
                ...(nextGeometry.y != null ? { y: Math.round(Number(nextGeometry.y)) } : {}),
                ...(nextGeometry.width != null ? { width: Number(nextGeometry.width) } : {}),
                ...(nextGeometry.height != null ? { height: Number(nextGeometry.height) } : {}),
                ...(nextGeometry.rotation != null ? { rotation: Number(nextGeometry.rotation) } : {}),
              },
            }
        )),
      };
      session.latestDoc = nextDoc;
      session.moved = true;
      schedulePreviewDocUpdate(nextDoc, [], selectionBounds(nextDoc, [session.nodeId]));
      return;
    }

    if (event.phase === "end") {
      flushPreviewDocUpdate();
      if (session.moved && session.latestDoc) {
        commitTransientDoc(session.baseDoc, session.latestDoc);
        schedulePreviewClear();
      } else {
        renderer.clearPreviewScene();
      }
      lineEndpointSessionRef.current = null;
    }
  }, [cancelPendingPreviewClear, commitTransientDoc, engine, flushPreviewDocUpdate, renderer, schedulePreviewClear, schedulePreviewDocUpdate]);

  const onPathPointGesture = useCallback((event: PathPointGestureEvent) => {
    if (engine.selectedNode?.kind !== "path") return;
    if (event.phase === "start") {
      cancelPendingPreviewClear();
      const pointCount = Array.isArray(engine.selectedNode.path_data?.points)
        ? engine.selectedNode.path_data!.points.length
        : 0;
      const clampedPointIndex = clampPathPointIndex(Number(event.pointIndex || 0), Math.max(1, pointCount));
      setSelectedPathPointIndex(pointCount > 0 ? clampedPointIndex : null);
      pathPointSessionRef.current = {
        baseDoc: engine.doc,
        nodeId: engine.selectedNode.id,
        pointIndex: clampedPointIndex,
        pointKind: event.pointKind === "in" || event.pointKind === "out" ? event.pointKind : "anchor",
        latestDoc: null,
        moved: false,
      };
      return;
    }

    const session = pathPointSessionRef.current;
    if (!session) return;
    if (event.pointIndex !== session.pointIndex) return;
    if (event.pointKind !== session.pointKind) return;

    if (event.phase === "move") {
      const nextPoint = event.point;
      if (!nextPoint) return;
      const nextDoc: PinselaTemplateDocV1 = {
        ...session.baseDoc,
        nodes: session.baseDoc.nodes.map((node) => {
          if (node.id !== session.nodeId || node.kind !== "path") return node;
          if (session.pointKind === "anchor") {
            return patchPathAnchorByWorldPosition(node, session.pointIndex, nextPoint);
          }
          return patchPathHandleByWorldPosition(node, session.pointIndex, session.pointKind, nextPoint);
        }),
      };
      session.latestDoc = nextDoc;
      session.moved = true;
      schedulePreviewDocUpdate(nextDoc, [], selectionBounds(nextDoc, [session.nodeId]));
      return;
    }

    if (event.phase === "end") {
      flushPreviewDocUpdate();
      if (session.moved && session.latestDoc) {
        commitTransientDoc(session.baseDoc, session.latestDoc);
        schedulePreviewClear();
      } else {
        renderer.clearPreviewScene();
      }
      pathPointSessionRef.current = null;
    }
  }, [cancelPendingPreviewClear, commitTransientDoc, engine, flushPreviewDocUpdate, renderer, schedulePreviewClear, schedulePreviewDocUpdate]);

  const onImageBrushGesture = useCallback((event: ImageBrushGestureEvent) => {
    if (!imageBrushState.enabled) return;
    if (engine.selectedNode?.kind !== "image") return;

    if (event.phase === "start") {
      if (!event.point) return;
      const selectedNode = engine.selectedNode;
      const firstPoint = pointToBrushUv(event.point, selectedNode);
      if (!firstPoint) return;
      const normalizedSettings = normalizeImageBrushSettings(
        selectedNode.style?.image_brush_settings as Partial<PinselaImageBrushSettings> | null | undefined,
        imageBrushState,
      );
      const brushSettings: ContextToolbarImageBrushState = {
        ...normalizedSettings,
        enabled: true,
        mode: imageBrushState.mode,
        color: imageBrushState.color,
      };
      const existingStrokes = normalizeStoredStrokes(selectedNode.style?.image_brush_strokes);
      const newStroke: PinselaImageBrushStroke = {
        id: `brush_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
        mode: brushSettings.mode,
        color: brushSettings.color,
        size: brushSettings.size,
        opacity: brushSettings.opacity,
        flow: brushSettings.flow,
        hardness: brushSettings.hardness,
        accumulation: brushSettings.accumulation,
        spacing: brushSettings.spacing,
        shape: brushSettings.shape,
        rotation: brushSettings.rotation,
        points: [firstPoint],
      };
      const nextStrokes = [...existingStrokes, newStroke];
      const nextDoc: PinselaTemplateDocV1 = {
        ...engine.doc,
        nodes: engine.doc.nodes.map((node) => (
          node.id !== selectedNode.id
            ? node
            : {
              ...node,
              style: {
                ...node.style,
                image_brush_settings: toStoredBrushSettings(brushSettings),
                image_brush_strokes: nextStrokes,
              },
            }
        )),
      };
      imageBrushSessionRef.current = {
        baseDoc: engine.doc,
        nodeId: selectedNode.id,
        selectedNodeSnapshot: selectedNode,
        existingStrokes,
        currentStroke: newStroke,
        lastPoint: firstPoint,
        latestDoc: nextDoc,
        moved: true,
      };
      cancelPendingPreviewClear();
      schedulePreviewDocUpdate(nextDoc, [], selectionBounds(nextDoc, [selectedNode.id]));
      return;
    }

    const session = imageBrushSessionRef.current;
    if (!session) return;

    if (event.phase === "move") {
      if (!event.point) return;
      const nextPoint = pointToBrushUv(event.point, session.selectedNodeSnapshot);
      if (!nextPoint) return;
      const spacingPx = Math.max(0.75, (session.currentStroke.size * session.currentStroke.spacing) / 100);
      const addedPoints = interpolateBrushPoints(
        session.lastPoint,
        nextPoint,
        spacingPx,
        session.selectedNodeSnapshot,
      );
      if (!addedPoints.length) return;
      session.lastPoint = nextPoint;
      session.currentStroke = {
        ...session.currentStroke,
        points: [...session.currentStroke.points, ...addedPoints],
      };
      const nextStrokes = [...session.existingStrokes, session.currentStroke];
      const nextDoc: PinselaTemplateDocV1 = {
        ...session.baseDoc,
        nodes: session.baseDoc.nodes.map((node) => (
          node.id !== session.nodeId
            ? node
            : {
              ...node,
              style: {
                ...node.style,
                image_brush_settings: toStoredBrushSettings(imageBrushState),
                image_brush_strokes: nextStrokes,
              },
            }
        )),
      };
      session.latestDoc = nextDoc;
      session.moved = true;
      schedulePreviewDocUpdate(nextDoc, [], selectionBounds(nextDoc, [session.nodeId]));
      return;
    }

    if (event.phase === "end") {
      flushPreviewDocUpdate();
      if (session.moved && session.latestDoc) {
        commitTransientDoc(session.baseDoc, session.latestDoc);
        schedulePreviewClear();
      } else {
        renderer.clearPreviewScene();
      }
      imageBrushSessionRef.current = null;
    }
  }, [cancelPendingPreviewClear, commitTransientDoc, engine, flushPreviewDocUpdate, imageBrushState, renderer, schedulePreviewClear, schedulePreviewDocUpdate]);

  const resolveFrameDropTargetAtPoint = useCallback((
    inputDoc: PinselaTemplateDocV1,
    point: { x: number; y: number },
    options?: { skipNodeIds?: string[] },
  ): PinselaNode | null => {
    if (!isPointInsideDocCanvas(inputDoc, point)) return null;
    const skipIds = new Set((options?.skipNodeIds || []).map((id) => String(id || "").trim()).filter(Boolean));
    const hits = hitTestAll(inputDoc, Number(point.x || 0), Number(point.y || 0), {
      includeLocked: false,
      viewportScale: renderer.stageScale,
    });
    return hits.find((node) => (
      !skipIds.has(node.id)
      && isFrameDropTargetCandidate(inputDoc, node)
    )) || null;
  }, [renderer.stageScale]);

  const isInsideDraggedBranch = useCallback((
    inputDoc: PinselaTemplateDocV1,
    nodeId: string,
    draggedSet: Set<string>,
  ): boolean => {
    const parentById = new Map(inputDoc.nodes.map((node) => [node.id, node.parent_id || null] as const));
    let cursor: string | null = nodeId;
    const seen = new Set<string>();
    while (cursor) {
      if (draggedSet.has(cursor)) return true;
      if (seen.has(cursor)) break;
      seen.add(cursor);
      cursor = parentById.get(cursor) || null;
    }
    return false;
  }, []);

  const resolveAutoLayoutDropTargetAtPoint = useCallback((
    inputDoc: PinselaTemplateDocV1,
    point: { x: number; y: number },
    options?: { skipNodeIds?: string[] },
  ): PinselaNode | null => {
    if (!isPointInsideDocCanvas(inputDoc, point)) return null;
    const skipIds = new Set((options?.skipNodeIds || []).map((id) => String(id || "").trim()).filter(Boolean));
    const hits = hitTestAll(inputDoc, Number(point.x || 0), Number(point.y || 0), {
      includeLocked: false,
      viewportScale: renderer.stageScale,
    });
    return hits.find((node) => (
      !skipIds.has(node.id)
      && node.id !== inputDoc.root_id
      && !node.style?.locked
      && isAutoLayoutContainerNode(node)
      && !isInsideDraggedBranch(inputDoc, node.id, skipIds)
    )) || null;
  }, [renderer.stageScale, isInsideDraggedBranch]);

  const onExternalImageDragHover = useCallback((_point: { x: number; y: number } | null) => {
    setExternalFrameDropTargetId(null);
  }, []);

  const insertImagesFromSources = useCallback(async (
    sources: Array<{ src: string; name?: string }>,
    point: { x: number; y: number },
    options?: { allowFrameReplace?: boolean },
  ) => {
    if (!sources.length) return [] as Array<{ nodeId: string; sourceIndex: number; src: string }>;
    const baseDoc = engine.doc;
    const canvasWidth = Math.max(1, Number(baseDoc.canvas.width || 1));
    const canvasHeight = Math.max(1, Number(baseDoc.canvas.height || 1));

    const loaded = await Promise.all(sources.map(async (source) => {
      try {
        const src = String(source.src || "").trim();
        if (!src) return null;
        const intrinsicSize = await loadImageIntrinsicSize(src, renderer.imageCacheRef.current);
        return {
          src,
          name: String(source.name || "").trim() || deriveImageNameFromSource(src, "Image"),
          intrinsicSize,
        };
      } catch {
        return null;
      }
    }));

    const ready = loaded.filter(Boolean) as Array<{
      src: string;
      name: string;
      intrinsicSize: { width: number; height: number } | null;
    }>;
    if (!ready.length) return [] as Array<{ nodeId: string; sourceIndex: number; src: string }>;

    const frameDropTarget = options?.allowFrameReplace
      ? resolveFrameDropTargetAtPoint(baseDoc, point)
      : null;

    let nextDoc = baseDoc;
    let replacedFrameId: string | null = null;
    let sourceStartIndex = 0;
    const placements: Array<{ nodeId: string; sourceIndex: number; src: string }> = [];
    if (frameDropTarget && ready.length > 0) {
      const first = ready[0];
      nextDoc = {
        ...nextDoc,
        nodes: nextDoc.nodes.map((node) => (
          node.id !== frameDropTarget.id
            ? node
            : {
              ...node,
              image_src: first.src,
              editable: true,
              style: {
                ...node.style,
                image_fit: "fill",
                image_crop: null,
              },
            }
        )),
      };
      replacedFrameId = frameDropTarget.id;
      sourceStartIndex = 1;
      placements.push({ nodeId: frameDropTarget.id, sourceIndex: 0, src: first.src });
    }

    const createdIds: string[] = [];
    ready.slice(sourceStartIndex).forEach((entry, index) => {
      const offsetIndex = index + sourceStartIndex;
      const sourceWidth = Math.max(1, Math.round(Number(entry.intrinsicSize?.width || 320)));
      const sourceHeight = Math.max(1, Math.round(Number(entry.intrinsicSize?.height || 320)));
      const maxWidth = Math.max(64, Math.round(canvasWidth * 0.82));
      const maxHeight = Math.max(64, Math.round(canvasHeight * 0.82));
      const scale = Math.min(1, maxWidth / sourceWidth, maxHeight / sourceHeight);
      const width = Math.max(8, Math.round(sourceWidth * scale));
      const height = Math.max(8, Math.round(sourceHeight * scale));
      const centerX = Number(point.x || 0) + offsetIndex * 24;
      const centerY = Number(point.y || 0) + offsetIndex * 24;
      const x = Math.max(0, Math.min(canvasWidth - width, Math.round(centerX - width / 2)));
      const y = Math.max(0, Math.min(canvasHeight - height, Math.round(centerY - height / 2)));
      const node = defaultNode("image", {
        name: entry.name || "Image",
        geometry: {
          x,
          y,
          width,
          height,
          rotation: 0,
          corner_radius: 0,
          clip: true,
          z_index: 0,
        },
        image_src: entry.src,
        editable: true,
      });
      nextDoc = addNode(nextDoc, node);
      createdIds.push(node.id);
      placements.push({ nodeId: node.id, sourceIndex: offsetIndex, src: entry.src });
    });

    setExternalFrameDropTargetId(null);
    latestEngineDocRef.current = nextDoc;
    engine.commitDoc(nextDoc);
    const nextSelection = [
      ...(replacedFrameId ? [replacedFrameId] : []),
      ...createdIds,
    ];
    if (nextSelection.length) {
      engine.setSelection(nextSelection);
      setActiveTab("properties");
    }
    return placements;
  }, [engine, renderer.imageCacheRef, setActiveTab, resolveFrameDropTargetAtPoint]);

  useEffect(() => {
    insertImagesFromSourcesRef.current = insertImagesFromSources;
  }, [insertImagesFromSources]);

  const buildCanvasCenterPoint = useCallback(() => ({
    x: Math.round(Number(engine.doc.canvas.width || 1) / 2),
    y: Math.round(Number(engine.doc.canvas.height || 1) / 2),
  }), [engine.doc.canvas.height, engine.doc.canvas.width]);

  const insertTextFromClipboard = useCallback((
    rawText: string,
    point: { x: number; y: number },
  ) => {
    const text = normalizeClipboardText(rawText);
    if (!text) return;

    const baseDoc = engine.doc;
    const canvasWidth = Math.max(1, Number(baseDoc.canvas.width || 1));
    const canvasHeight = Math.max(1, Number(baseDoc.canvas.height || 1));
    const lines = text.split("\n");
    const longestLineLength = Math.max(1, ...lines.map((line) => line.length));
    const fontSize = text.length > 180 ? 30 : text.length > 90 ? 34 : 42;
    const width = Math.max(
      180,
      Math.min(
        Math.round(canvasWidth * 0.82),
        Math.round(Math.min(longestLineLength, 42) * fontSize * 0.58 + 36),
      ),
    );
    const height = Math.max(
      64,
      Math.min(
        Math.round(canvasHeight * 0.82),
        Math.round(lines.length * fontSize * 1.24 + 28),
      ),
    );
    const x = Math.max(0, Math.min(canvasWidth - width, Math.round(Number(point.x || 0) - width / 2)));
    const y = Math.max(0, Math.min(canvasHeight - height, Math.round(Number(point.y || 0) - height / 2)));
    const node = defaultNode("text", {
      name: "Pasted text",
      geometry: {
        x,
        y,
        width,
        height,
        rotation: 0,
        corner_radius: 0,
        clip: false,
        z_index: 0,
      },
      text,
      editable: true,
      text_style: {
        ...defaultNode("text").text_style,
        size: fontSize,
        line_height: 116,
        line_height_unit: "percent",
        color: "#111111",
      },
    });
    engine.commitDoc(addNode(baseDoc, node));
    engine.setSelection([node.id]);
    setActiveTab("properties");
  }, [engine, setActiveTab]);

  const replacePlacedImageSource = useCallback((
    nodeId: string,
    expectedSrc: string,
    nextSrc: string,
  ) => {
    const id = String(nodeId || "").trim();
    const expected = String(expectedSrc || "").trim();
    const next = String(nextSrc || "").trim();
    if (!id || !expected || !next || expected === next) return;

    const cache = renderer.imageCacheRef.current;
    const cachedImage = cache.get(expected) || null;
    if (cachedImage) {
      canvasImageCacheKeys(next).forEach((key) => cache.set(key, cachedImage));
    }

    const currentDoc = latestEngineDocRef.current;
    let changed = false;
    const nextDoc = {
      ...currentDoc,
      nodes: currentDoc.nodes.map((node) => {
        if (node.id !== id) return node;
        if (String(node.image_src || "").trim() !== expected) return node;
        changed = true;
        return {
          ...node,
          image_src: next,
        };
      }),
    };
    if (!changed) return;
    latestEngineDocRef.current = nextDoc;
    latestCommitDocRef.current(nextDoc);
    renderer.repaint();
  }, [renderer]);

  const uploadAndPlaceImageFiles = useCallback(async (
    files: File[],
    point: { x: number; y: number },
  ) => {
    const imageFiles = files.filter((file) => isImageFileLike(file));
    if (!imageFiles.length) return;

    const localSources = (
      await Promise.all(imageFiles.map(async (file, index) => {
        try {
          const src = await readFileAsDataUrl(file);
          if (!src) return null;
          const fallbackName = `clipboard-image-${index + 1}`;
          const uploadName = sanitizeImageAssetName(file.name, fallbackName, file.type);
          const placedName = String(file.name || uploadName).replace(/\.[^.]+$/, "").trim() || fallbackName;
          return {
            uploadId: uid("asset_upload"),
            file,
            uploadName,
            src,
            name: placedName,
          };
        } catch {
          return null;
        }
      }))
    ).filter(Boolean) as Array<{ uploadId: string; file: File; uploadName: string; src: string; name: string }>;

    if (!localSources.length) return;
    setPendingAssetUploads((current) => [
      ...localSources.map((entry) => ({
        id: entry.uploadId,
        name: entry.name,
        previewUrl: entry.src,
        progress: 8,
        status: "uploading" as const,
      })),
      ...current,
    ].slice(0, 18));
    localSources.forEach((entry) => startAssetUploadProgress(entry.uploadId));
    const placements = await insertImagesFromSources(
      localSources.map((entry) => ({ src: entry.src, name: entry.name })),
      point,
    );
    if (!placements.length) {
      localSources.forEach((entry) => finishAssetUploadProgress(entry.uploadId, "error", "Could not insert onto the canvas"));
      return;
    }

    void (async () => {
      const uploaded = await Promise.allSettled(localSources.map(async (entry) => {
        try {
          setPendingAssetUploads((current) => current.map((item) => (
            item.id === entry.uploadId ? { ...item, progress: Math.max(item.progress, 28) } : item
          )));
          const asset = await uploadPinselaAsset(entry.file, { name: entry.uploadName });
          const placedName = String(asset.name || entry.uploadName).replace(/\.[^.]+$/, "").trim() || entry.name;
          finishAssetUploadProgress(entry.uploadId, "uploaded");
          return {
            src: String(asset.preview_url || "").trim(),
            name: placedName,
          };
        } catch (error) {
          finishAssetUploadProgress(entry.uploadId, "error", describeAsyncActionError(error, "Upload failed"));
          throw error;
        }
      }));

      let replacedAny = false;
      uploaded.forEach((result, sourceIndex) => {
        if (result.status !== "fulfilled" || !result.value.src) return;
        placements
          .filter((placement) => placement.sourceIndex === sourceIndex)
          .forEach((placement) => {
            replacePlacedImageSource(placement.nodeId, localSources[sourceIndex]?.src || placement.src, result.value.src);
            replacedAny = true;
          });
      });

      if (!replacedAny) return;
      try {
        await api.refreshAssets();
      } catch {
        // The placed image is already visible; library refresh can recover later.
      }
    })();
  }, [api, finishAssetUploadProgress, insertImagesFromSources, replacePlacedImageSource, startAssetUploadProgress]);

  const markExternalPasteHandled = useCallback(() => {
    // Recency coupling removed: the marker on the OS clipboard decides the paste.
    // Kept as a no-op so the many placeExternal call sites stay untouched…
  }, []);

  const placeExternalClipboardPayload = useCallback(async (
    payload: ExternalClipboardPayload,
    point: { x: number; y: number },
  ): Promise<boolean> => {
    const imageFiles = payload.imageFiles.filter((file) => isImageFileLike(file));
    const importFiles = payload.importFiles.filter((file) => isImportFileLike(file));
    const imageUrls = Array.from(new Set(
      payload.imageUrls.map((url) => String(url || "").trim()).filter(Boolean),
    ));

    if (imageFiles.length || imageUrls.length) {
      markExternalPasteHandled();
      if (imageFiles.length) {
        if (isRemoteBackedLocalEditor) {
          try {
            await uploadAndPlaceImageFiles(imageFiles, point);
            return true;
          } catch {
            // Local data URLs below keep paste responsive even if upload fails.
          }
        }
        const sources = await Promise.all(imageFiles.map(async (file, index) => {
          try {
            const src = await readFileAsDataUrl(file);
            if (!src) return null;
            const name = String(file.name || `clipboard-image-${index + 1}`).replace(/\.[^.]+$/, "").trim() || "Image";
            return { src, name };
          } catch {
            return null;
          }
        }));
        const readySources = sources.filter(Boolean) as Array<{ src: string; name?: string }>;
        if (readySources.length) {
          await insertImagesFromSources(readySources, point);
        }
        return readySources.length > 0;
      }

      if (isRemoteBackedLocalEditor) {
        const resolvedFiles = (
          await Promise.all(imageUrls.map((url, index) => imageUrlToFile(url, `clipboard-image-${index + 1}`)))
        ).filter(Boolean) as File[];
        if (resolvedFiles.length) {
          try {
            await uploadAndPlaceImageFiles(resolvedFiles, point);
            return true;
          } catch {
            // Direct source placement below is faster and more tolerant of CORS.
          }
        }
      }

      const sources = imageUrls.map((src) => ({
        src,
        name: deriveImageNameFromSource(src, "Image"),
      }));
      if (sources.length) {
        await insertImagesFromSources(sources, point);
      }
      return sources.length > 0;
    }

    if (importFiles.length || payload.svgSource) {
      markExternalPasteHandled();
      const filesToImport = payload.svgSource
        ? [
          new File(
            [new Blob([payload.svgSource], { type: "image/svg+xml" })],
            "clipboard.svg",
            { type: "image/svg+xml" },
          ),
        ]
        : importFiles;
      void importFilesToLibrary(filesToImport, {
        autoPlaceMode: "current_page",
        dropPoint: point,
      });
      return true;
    }

    if (payload.text && !engine.clipboardRef.current.nodes.length) {
      markExternalPasteHandled();
      insertTextFromClipboard(payload.text, point);
      return true;
    }

    return false;
  }, [
    engine.clipboardRef,
    importFilesToLibrary,
    insertImagesFromSources,
    insertTextFromClipboard,
    isRemoteBackedLocalEditor,
    markExternalPasteHandled,
    uploadAndPlaceImageFiles,
  ]);

  const onImageFileDrop = useCallback(async (files: File[], point: { x: number; y: number }) => {
    const imageFiles = files.filter((file) => isImageFileLike(file));
    if (!imageFiles.length) return;
    if (isRemoteBackedLocalEditor) {
      await uploadAndPlaceImageFiles(imageFiles, point);
      return;
    }
    const sources = await Promise.all(imageFiles.map(async (file) => {
      try {
        const src = await readFileAsDataUrl(file);
        if (!src) return null;
        const name = String(file.name || "Image").replace(/\.[^.]+$/, "").trim() || "Image";
        return { src, name };
      } catch {
        return null;
      }
    }));
    const readySources = sources.filter(Boolean) as Array<{ src: string; name?: string }>;
    if (!readySources.length) return;
    await insertImagesFromSources(readySources, point);
  }, [insertImagesFromSources, isRemoteBackedLocalEditor, uploadAndPlaceImageFiles]);

  const onImageUrlDrop = useCallback(async (urls: string[], point: { x: number; y: number }) => {
    const normalized = Array.from(new Set(
      urls
        .map((url) => String(url || "").trim())
        .filter(Boolean),
    ));
    if (!normalized.length) return;
    const sources = normalized.map((src) => ({
      src,
      name: deriveImageNameFromSource(src, "Image"),
    }));
    await insertImagesFromSources(sources, point);
  }, [insertImagesFromSources]);

  const resolveDropPointFromClient = useCallback((clientX: number, clientY: number) => {
    const canvas = renderer.canvasRef.current;
    const rect = canvas?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return buildCanvasCenterPoint();
    const canvasWidth = Math.max(1, Number(engine.doc.canvas.width || 1));
    const canvasHeight = Math.max(1, Number(engine.doc.canvas.height || 1));
    const x = ((clientX - rect.left) / Math.max(1, rect.width)) * canvasWidth;
    const y = ((clientY - rect.top) / Math.max(1, rect.height)) * canvasHeight;
    return {
      x: Math.max(0, Math.min(canvasWidth, x)),
      y: Math.max(0, Math.min(canvasHeight, y)),
    };
  }, [buildCanvasCenterPoint, engine.doc.canvas.height, engine.doc.canvas.width, renderer.canvasRef]);

  const onAddImageInputChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const files = Array.from(input.files || []).filter((file) => isImageFileLike(file));
    if (!files.length) {
      input.value = "";
      return;
    }
    try {
      if (isRemoteBackedLocalEditor) {
        await uploadAndPlaceImageFiles(files, buildCanvasCenterPoint());
        return;
      }
      const sources = await Promise.all(files.map(async (file) => {
        try {
          const src = await readFileAsDataUrl(file);
          if (!src) return null;
          const name = String(file.name || "Image").replace(/\.[^.]+$/, "").trim() || "Image";
          return { src, name };
        } catch {
          return null;
        }
      }));
      const readySources = sources.filter(Boolean) as Array<{ src: string; name?: string }>;
      if (readySources.length) {
        await insertImagesFromSources(readySources, buildCanvasCenterPoint());
      }
    } finally {
      input.value = "";
    }
  }, [buildCanvasCenterPoint, insertImagesFromSources, isRemoteBackedLocalEditor, uploadAndPlaceImageFiles]);

  useEffect(() => {
    function onPaste(event: ClipboardEvent) {
      if (event.defaultPrevented) return;
      if (isKeyboardEditableTarget(event.target)) return;
      if (isKeyboardInMenuContext(event.target)) return;
      const clipboard = event.clipboardData;
      if (!clipboard) return;
      // Pinsela marker present → it is an ELEMENT, handled by useKeyboardShortcuts.
      // Here we only handle EXTERNAL content (image/text/svg from the OS). Mutually
      // exclusive: marker xor external, no race with the other handler.
      if (parseClipboardMarkerId(String(clipboard.getData("text/html") || ""))) return;

      const payload = clipboardDataToPayload(clipboard);
      if (!hasExternalClipboardPayload(payload, true)) return;
      event.preventDefault();
      void placeExternalClipboardPayload(payload, buildCanvasCenterPoint());
    }

    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("paste", onPaste);
    };
  }, [
    buildCanvasCenterPoint,
    placeExternalClipboardPayload,
  ]);

  const onImportInputChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const files = Array.from(input.files || []);
    if (!files.some((file) => isImportFileLike(file))) {
      input.value = "";
      return;
    }
    try {
      await importFilesToLibrary(files);
    } finally {
      input.value = "";
    }
  }, [importFilesToLibrary]);

  const onSvgImportInputChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const files = Array.from(input.files || []).filter((file) => getFileExtension(file.name) === "svg" || String(file.type || "").toLowerCase().includes("svg"));
    if (!files.length) {
      input.value = "";
      return;
    }
    try {
      await importFilesToLibrary(files, {
        autoPlaceMode: pendingSvgImportModeRef.current,
      });
    } finally {
      input.value = "";
    }
  }, [importFilesToLibrary]);

  const onImportFileDrop = useCallback(async (files: File[], point: { x: number; y: number }) => {
    const importFiles = files.filter((file) => isImportFileLike(file));
    if (!importFiles.length) return;
    await importFilesToLibrary(importFiles, {
      autoPlaceMode: "current_page",
      dropPoint: point,
    });
  }, [importFilesToLibrary]);

  const requestFormatChange = useCallback(() => {
    if (!editorReady) {
      setFormatPickerMode("initial");
      setChosenFormat(null);
      return;
    }
    if (hasUnpersistedChanges) {
      setActiveModal("format_change_confirm");
      return;
    }
    setFormatPickerMode("replace");
    setChosenFormat(null);
  }, [editorReady, hasUnpersistedChanges]);

  const returnToCurrentEditor = useCallback(() => {
    const width = Math.max(1, Math.round(Number(engine.doc.canvas.width || chosenFormat?.width || 1080)));
    const height = Math.max(1, Math.round(Number(engine.doc.canvas.height || chosenFormat?.height || 1080)));
    setFormatPickerMode("initial");
    setChosenFormat({
      id: "custom",
      width,
      height,
      name: activeProjectPage?.name || "Current page",
      category: "Current",
      icon: "Settings",
    });
  }, [
    activeProjectPage?.name,
    chosenFormat?.height,
    chosenFormat?.width,
    engine.doc.canvas.height,
    engine.doc.canvas.width,
  ]);

  const toggleCanvasMenus = useCallback(() => {
    if (!editorReady) return;
    const shouldReopenMenus = !leftOpen && !rightOpen;
    if (shouldReopenMenus) {
      setLeftOpen(true);
      setRightOpen(true);
      return;
    }
    setLeftOpen(false);
    setRightOpen(false);
  }, [editorReady, leftOpen, rightOpen]);

  const onCanvasDoubleClick = useCallback((point: { x: number; y: number }) => {
    if (!isPointInsideDocCanvas(engine.doc, point)) return;
    const selectedTextNode = (() => {
      if (engine.selection.length !== 1) return null;
      const selectedId = String(engine.selection[0] || "").trim();
      if (!selectedId) return null;
      const fromDoc = engine.doc.nodes.find((node) => node.id === selectedId && node.kind === "text") || null;
      if (fromDoc) return fromDoc;
      return engine.selectedNode && engine.selectedNode.kind === "text" ? engine.selectedNode : null;
    })();
    if (selectedTextNode && !selectedTextNode.style?.locked && engine.selection.length === 1) {
      const pad = Math.max(2, 4 / Math.max(0.0001, renderer.stageScale));
      const bx = Number(selectedTextNode.geometry.x || 0);
      const by = Number(selectedTextNode.geometry.y || 0);
      const bw = Math.max(0, Number(selectedTextNode.geometry.width || 0));
      const bh = Math.max(0, Number(selectedTextNode.geometry.height || 0));
      const withinSelectedTextBounds = (
        Number(point.x || 0) >= bx - pad
        && Number(point.x || 0) <= bx + bw + pad
        && Number(point.y || 0) >= by - pad
        && Number(point.y || 0) <= by + bh + pad
      );
      if (withinSelectedTextBounds) {
        beginInlineTextEdit(selectedTextNode.id, String(selectedTextNode.text || ""));
        return;
      }
    }

    const hits = hitTestAll(engine.doc, point.x, point.y, {
      includeLocked: true,
      viewportScale: renderer.stageScale,
    });
    const editableTextHit = hits.find((node) => node.kind === "text" && !node.style?.locked) || null;
    if (editableTextHit) {
      beginInlineTextEdit(editableTextHit.id, String(editableTextHit.text || ""));
      return;
    }
    const hit = hits[0] || null;
    if (hit && !hit.style?.locked && canNodeHostImageCrop(hit)) {
      enterCropModeForNode(hit.id);
      return;
    }
    toggleCanvasMenus();
  }, [beginInlineTextEdit, engine, toggleCanvasMenus, renderer.stageScale, enterCropModeForNode]);

  const onSelectionChromeClick = useCallback((event: SelectionChromeClickEvent) => {
    const point = event.point;
    if (!isPointInsideDocCanvas(engine.doc, point)) return;

    const hits = hitTestAll(engine.doc, point.x, point.y, {
      includeLocked: true,
      viewportScale: renderer.stageScale,
    });
    const hit = hits[0] || null;
    const additive = !!event.shiftKey;
    const toggle = !!event.metaKey || !!event.ctrlKey;
    let nextSelection: string[] = [];

    if (hit) {
      if (toggle || additive) {
        const selected = new Set(engine.selection);
        if (toggle) {
          if (selected.has(hit.id)) {
            selected.delete(hit.id);
          } else {
            selected.add(hit.id);
          }
        } else {
          selected.add(hit.id);
        }
        nextSelection = [...selected];
      } else {
        // Plain click (no modifier) always narrows to the clicked element, even
        // when it's part of a multi-selection. This handler only fires on a true
        // click — a group drag is converted to a move gesture upstream and never
        // reaches here — so narrowing can't collapse a selection mid-drag.
        nextSelection = [hit.id];
      }
    } else if (additive || toggle) {
      nextSelection = [...engine.selection];
    }

    activateCanvasTool("select");
    engine.setSelection(uniqueNodeIdList(nextSelection));
    engine.dispatch({ type: "set_guides", guides: [] });
    persistArtboardGuides([]);
  }, [activateCanvasTool, engine, renderer.stageScale, persistArtboardGuides]);

  const onInlineTextChange = useCallback((value: string) => {
    setInlineTextValue(value);
    const session = inlineTextSessionRef.current;
    if (!session) return;
    const nextDoc = patchNodeById(engine.doc, session.nodeId, (node) => {
      if (node.kind !== "text") return node;
      const withText = updateTextNodeContent(node, value);
      // Auto-height (Canva-style free text): the box HUGS the content exactly —
      // grows down when text wraps to more lines AND shrinks back when it loses
      // lines, so the selection box always wraps the text with no dead space on
      // top/bottom. Width is user-controlled (drag side handles); height is auto.
      // Skips nodes with an explicit auto-fit config (designed fixed boxes).
      const rawFit = (withText as { fit?: unknown }).fit;
      const hasFit = rawFit != null && typeof rawFit === "object";
      if (!hasFit) {
        const metrics = computeInlineTextMetrics(withText);
        const needed = Math.ceil(metrics.contentHeight);
        const curH = Math.round(Number(withText.geometry?.height || 0));
        if (needed > 0 && needed !== curH) {
          return { ...withText, geometry: { ...withText.geometry, height: needed } };
        }
      }
      return withText;
    });
    engine.replaceDoc(nextDoc);
  }, [engine]);

  const onInlineTextCommit = useCallback(() => {
    const session = inlineTextSessionRef.current;
    if (!session) return;
    const changed = inlineTextValue != null && inlineTextValue !== session.originalText;
    const finalValue = inlineTextValue ?? session.originalText;
    if (changed) {
      const undoDoc = patchNodeById(engine.doc, session.nodeId, (node) => (
        node.kind === "text" ? updateTextNodeContent(node, session.originalText) : node
      ));
      const finalDoc = patchNodeById(engine.doc, session.nodeId, (node) => (
        node.kind === "text" ? updateTextNodeContent(node, finalValue) : node
      ));
      commitTransientDoc(undoDoc, finalDoc);
    }
    engine.setSelection([session.nodeId]);
    inlineTextSessionRef.current = null;
    setInlineTextValue(null);
    if (engine.mode === "text-edit") {
      engine.setMode("select");
    }
  }, [commitTransientDoc, engine, inlineTextValue]);

  const onInlineTextCancel = useCallback(() => {
    const session = inlineTextSessionRef.current;
    if (!session) return;
    const revertedDoc = patchNodeById(engine.doc, session.nodeId, (node) => (
      node.kind === "text" ? updateTextNodeContent(node, session.originalText) : node
    ));
    engine.replaceDoc(revertedDoc);
    engine.setSelection([session.nodeId]);
    inlineTextSessionRef.current = null;
    setInlineTextValue(null);
    if (engine.mode === "text-edit") {
      engine.setMode("select");
    }
  }, [engine]);

  React.useEffect(() => {
    const session = inlineTextSessionRef.current;
    if (!session) return;
    const sessionNode = engine.doc.nodes.find((node) => node.id === session.nodeId) || null;
    if (!sessionNode || sessionNode.kind !== "text") {
      inlineTextSessionRef.current = null;
      setInlineTextValue(null);
      if (engine.mode === "text-edit") engine.setMode("select");
      return;
    }
    const selectedId = String(engine.selection[0] || "").trim();
    const selectionOutOfSync = engine.selection.length !== 1 || selectedId !== session.nodeId;
    if (engine.mode === "text-edit" && selectionOutOfSync) {
      engine.setSelection([session.nodeId]);
    }
  }, [engine.selection, engine.mode, engine.doc.nodes, engine]);

  React.useEffect(() => {
    if (engine.mode === "crop") return;
    cropTranslateSessionRef.current = null;
    if (!cropModeSessionRef.current) return;
    const session = cropModeSessionRef.current;
    cropModeSessionRef.current = null;
    flushPreviewDocUpdate();
    if (session.changed) {
      commitTransientDoc(session.baseDoc, session.latestDoc);
      schedulePreviewClear();
      return;
    }
    engine.replaceDoc(session.baseDoc);
    renderer.clearPreviewScene();
  }, [commitTransientDoc, engine.mode, engine, flushPreviewDocUpdate, renderer, schedulePreviewClear]);

  React.useEffect(() => {
    if (engine.mode !== "crop") return;
    const session = cropModeSessionRef.current;
    if (!session) return;
    if (!engine.doc.nodes.some((node) => node.id === session.nodeId)) {
      cropModeSessionRef.current = null;
      cropTranslateSessionRef.current = null;
      engine.setMode("select");
    }
  }, [engine.mode, engine.doc.nodes, engine]);

  React.useEffect(() => {
    const session = imageBrushSessionRef.current;
    if (!session) return;
    const stillSelected = engine.selectedNode?.id === session.nodeId && engine.selectedNode?.kind === "image";
    if (stillSelected && imageBrushState.enabled) return;
    if (session.moved && session.latestDoc) {
      flushPreviewDocUpdate();
      commitTransientDoc(session.baseDoc, session.latestDoc);
      schedulePreviewClear();
    } else {
      renderer.clearPreviewScene();
    }
    imageBrushSessionRef.current = null;
  }, [commitTransientDoc, engine.selectedNode?.id, engine.selectedNode?.kind, flushPreviewDocUpdate, imageBrushState.enabled, renderer, schedulePreviewClear]);

  React.useEffect(() => {
    const session = pathPointSessionRef.current;
    if (!session) return;
    const stillSelected = engine.selectedNode?.id === session.nodeId && engine.selectedNode?.kind === "path";
    if (stillSelected) return;
    if (session.moved && session.latestDoc) {
      flushPreviewDocUpdate();
      commitTransientDoc(session.baseDoc, session.latestDoc);
      schedulePreviewClear();
    } else {
      renderer.clearPreviewScene();
    }
    pathPointSessionRef.current = null;
  }, [commitTransientDoc, engine.selectedNode?.id, engine.selectedNode?.kind, flushPreviewDocUpdate, renderer, schedulePreviewClear]);

  React.useEffect(() => {
    if (!editorReady || !rightOpen) return;
    const rightPopoutSelector = [
      ".dg-function-panel",
      ".dg-rules-popover",
      ".dg-history-popover",
      ".dg-modal-overlay",
      ".dg-modal-panel",
    ].join(", ");
    const collapseIfRightPopoutVisible = () => {
      if (!document.querySelector(rightPopoutSelector)) return;
      setRightOpen(false);
    };
    collapseIfRightPopoutVisible();
    const observer = new MutationObserver((records) => {
      const relevantPortalAdded = records.some((record) => Array.from(record.addedNodes).some((node) => (
        node instanceof Element
        && (node.matches(rightPopoutSelector) || Boolean(node.querySelector(rightPopoutSelector)))
      )));
      if (relevantPortalAdded) collapseIfRightPopoutVisible();
    });
    observer.observe(document.body, { childList: true });
    return () => observer.disconnect();
  }, [editorReady, rightOpen]);

  React.useEffect(() => {
    if (!activeModal) return;
    setRightOpen(false);
  }, [activeModal]);

  const activeFrameDropTargetId = pointer.frameDropTargetId || gestureFrameDropTargetId || externalFrameDropTargetId;
  const frameDropPreview = useMemo(() => {
    if (!activeFrameDropTargetId) return null;
    const node = engine.doc.nodes.find((entry) => entry.id === activeFrameDropTargetId);
    if (!node) return null;
    if (!(node.kind === "frame" || node.kind === "group" || node.kind === "rect")) return null;
    return {
      x: Number(node.geometry.x || 0),
      y: Number(node.geometry.y || 0),
      w: Math.max(0, Number(node.geometry.width || 0)),
      h: Math.max(0, Number(node.geometry.height || 0)),
      cornerRadius: Math.max(0, Number(node.geometry.corner_radius || 0)),
    };
  }, [activeFrameDropTargetId, engine.doc.nodes]);

  return (
    <div
      ref={viewportRef}
      className={isLocalSandbox ? "dg-local-editor" : undefined}
      style={{
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
        background: "var(--color-bg-app)",
        position: "relative",
      }}
      onDragOver={(e) => {
        const types = Array.from(e.dataTransfer?.types || []);
        const hasExternalPayload = types.includes("Files") || types.includes("text/uri-list");
        if (!hasExternalPayload) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDrop={(e) => {
        const types = Array.from(e.dataTransfer?.types || []);
        const hasExternalPayload = types.includes("Files") || types.includes("text/uri-list");
        if (!hasExternalPayload) return;
        e.preventDefault();
        setExternalFrameDropTargetId(null);
        const imageFiles = Array.from(e.dataTransfer?.files || []).filter((file) => isImageFileLike(file));
        if (imageFiles.length) {
          const point = resolveDropPointFromClient(e.clientX, e.clientY);
          void onImageFileDrop(imageFiles, point);
        }
      }}
    >
      {/* Live editing: "agent working" badge + brief glow on each change */}
      <style>{"@keyframes dgAgentPulse{0%,100%{opacity:1}50%{opacity:.35}}"}</style>
      {agentPresence?.state === "working" ? (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: "fixed",
            top: 12,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 99999,
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 14px",
            borderRadius: 999,
            background: "rgba(16,18,22,0.92)",
            color: "#e8fff4",
            border: "1px solid rgba(52,211,153,0.55)",
            fontSize: 13,
            fontWeight: 600,
            boxShadow: "0 6px 22px rgba(0,0,0,0.4)",
            pointerEvents: "none",
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              background: "#34d399",
              boxShadow: "0 0 8px #34d399",
              animation: "dgAgentPulse 1s ease-in-out infinite",
            }}
          />
          {`Agent working${agentPresence.label ? `: ${agentPresence.label}` : "…"}`}
        </div>
      ) : null}
      {liveGlow ? (
        <div
          aria-hidden
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 99998,
            pointerEvents: "none",
            boxShadow: "inset 0 0 0 3px rgba(52,211,153,0.55)",
            transition: "opacity 0.4s ease",
          }}
        />
      ) : null}
      {localAccountNeedsLogin && !localAccountBannerDismissed ? (
        <div className="dg-local-account-banner" role="status" aria-live="polite">
          <div className="dg-local-account-banner-copy">
            <strong>Signed out.</strong>
            <span>Your work is still saved in this browser. Projects, library, and sync are paused until you sign in.</span>
          </div>
          <div className="dg-local-account-banner-actions">
            <button type="button" className="dg-local-account-banner-dismiss" onClick={handleDismissLocalAccountBanner} aria-label="Dismiss session notice">
              Close
            </button>
            <button type="button" className="dg-local-account-banner-action" onClick={handleNavigateToLogin}>
              Sign in
            </button>
          </div>
        </div>
      ) : null}
      <input
        ref={addImageInputRef}
        type="file"
        hidden
        accept="image/*"
        multiple
        onChange={onAddImageInputChange}
      />
      <input
        ref={addImportInputRef}
        type="file"
        hidden
        multiple
        accept=".svg,.fig,.psd,.aff,.afdesign,.afphoto,.afpub,.ppt,.pptx,.pdf,.ai,.eps,.sketch,.xd,.cdr,.indd,.idml,.png,.jpg,.jpeg,.webp,.gif,.bmp,.avif,.tif,.tiff"
        onChange={onImportInputChange}
      />
      <input
        ref={addSvgImportInputRef}
        type="file"
        hidden
        multiple
        accept=".svg,image/svg+xml"
        onChange={onSvgImportInputChange}
      />
      <PinselaAppShell
        theme={theme}
        uiVariant={isLocalSandbox ? "local_sandbox" : "default"}
        homeHref={api.homePath}
        showAutomations={api.supportsAutomations}
        compactViewport={isCompactViewport}
        leftPanelOpen={editorReady && leftOpen}
        activeLeftSection={activeLeft}
        rightPanelOpen={editorReady && rightOpen}
        activeRightSection={activeRight}
        activeInspectorTab={activeTab}
        canvasMode={canvasMode}
        onShowVersions={editorReady && api.supportsVersions ? () => setActiveModal("versions") : undefined}
        onShowExport={editorReady ? () => setActiveModal("export") : undefined}
        onShowBulk={editorReady && api.supportsBulkJobs ? () => setActiveModal("bulk") : undefined}
        onOpenImports={editorReady ? openImportsPanel : undefined}
        onOpenSvgImport={editorReady ? () => openSvgImportPicker(svgImportMode) : undefined}
        svgImportMode={svgImportMode}
        onSetSvgImportMode={editorReady ? (mode) => setSvgImportMode(mode) : undefined}
        onTogglePagesGrid={editorReady ? () => setPagesGridOpen((current) => !current) : undefined}
        pagesGridOpen={pagesGridOpen}
        onLeftSectionChange={editorReady ? (section: LeftSectionKey) => {
          if (section === "auto_layout") {
            activateCanvasTool("auto_layout");
          }
          if (activeLeft === section) {
            setLeftOpen(!leftOpen);
          } else {
            setActiveLeft(section);
            setLeftOpen(true);
            if (isCompactViewport) {
              setRightOpen(false);
            }
          }
        } : undefined}
        onToggleLeftPanel={editorReady ? () => {
          const nextOpen = !leftOpen;
          setLeftOpen(nextOpen);
          if (isCompactViewport && nextOpen) {
            setRightOpen(false);
          }
        } : undefined}
        onRightSectionChange={editorReady ? (section: RightSectionKey) => {
          if (section === "automations" && !api.supportsAutomations) return;
          if (activeRight === section) {
            setRightOpen(!rightOpen);
          } else {
            setActiveRight(section);
            setRightOpen(true);
            if (isCompactViewport) {
              setLeftOpen(false);
            }
          }
        } : undefined}
        onToggleRightPanel={editorReady ? () => {
          const nextOpen = !rightOpen;
          setRightOpen(nextOpen);
          if (isCompactViewport && nextOpen) {
            setLeftOpen(false);
          }
        } : undefined}
        onDismissPanels={editorReady && isCompactViewport ? () => {
          setLeftOpen(false);
          setRightOpen(false);
        } : undefined}
        onInspectorTabChange={editorReady ? (tab) => setActiveTab(tab) : undefined}
        projects={api.projects}
        automationBindingFields={automationBindingFields}
        automationTemplates={automationTemplates}
        activeProjectPageName={activeProjectPage?.name || "Page"}
        assets={api.assets}
        assetUploads={pendingAssetUploads}
        assetSearch={api.assetSearch}
        onAssetSearchChange={api.setAssetSearch}
        imports={rightImportItems}
        layers={deferredLayers}
        historyEntries={deferredHistoryEntries}
        rulesState={rulesPanelState}
        selectedNode={deferredSelectedNode}
        selectionSummary={deferredSelectionSummary}
        canUndo={editorReady ? engine.canUndo : false}
        canRedo={editorReady ? engine.canRedo : false}
        onUndo={editorReady ? engine.undo : undefined}
        onRedo={editorReady ? engine.redo : undefined}
        onSelectLayer={handleSelectLayer}
        onJumpToHistory={jumpToHistory}
        onPatchSelectedNode={patchSelectedNode}
        zoom={deferredZoomPercent}
        onZoomToPercent={editorReady ? (percent: number) => {
          renderer.setZoom(uiPercentToEngineZoom(Math.max(10, Math.min(500, percent))));
        } : undefined}
        onZoomFit={editorReady ? requestFitToScreen : undefined}
        rulersEnabled={rulersEnabled}
        onToggleRulers={toggleRulers}
        saveState={engine.store.saveStatus}
        snapEnabled={engine.store.snap.enabled}
        gridEnabled={engine.store.snap.toGrid}
        onToggleSnap={handleToggleSnap}
        onToggleGrid={handleToggleGrid}
        onSetSnapEnabled={handleSetSnapEnabled}
        onSetSnapToGrid={handleSetSnapToGrid}
        onSetSnapTolerance={handleSetSnapTolerance}
        onSetGridSize={handleSetGridSize}
        editorReady={editorReady}
        projectName={displayProjectName}
        formatLabel={formatLabel}
        canvasLabel={canvasLabel}
        templateKey={api.projectKey}
        onChangeFormat={requestFormatChange}
        leftPanelCallbacks={leftPanelCallbacks}
        rightPanelCallbacks={leftPanelCallbacks}
        leftImageTraceState={leftImageTraceState}
      >
        {!editorReady ? (
          initialLoadDone ? (
            <React.Suspense fallback={null}>
              <FormatPickerLazy
                mode={formatPickerMode}
                onSelect={handleFormatSelect}
                onBack={formatPickerMode === "replace" ? returnToCurrentEditor : undefined}
              />
            </React.Suspense>
          ) : (
            <div className="dg-editor-loading-state">
              <div className="dg-editor-loading-kicker">Opening project</div>
              <div className="dg-editor-loading-title">Loading the editor and restoring your last design.</div>
            </div>
          )
        ) : (
          <div
            style={{ display: "contents" }}
            onContextMenu={(e) => {
              const target = e.target as HTMLElement;
              if (target && target.closest("input,textarea,[contenteditable='true']")) return;
              e.preventDefault();
              setCtxMenu({ open: true, x: e.clientX, y: e.clientY });
            }}
          >
          <CanvasStage
            zoom={zoomPercent}
            mode={canvasMode}
            stageScale={renderer.stageScale}
            compactViewport={isCompactViewport}
            canvasWidth={engine.doc.canvas.width}
            canvasHeight={engine.doc.canvas.height}
            projectPages={canvasProjectPages}
            activeProjectPageId={activeProjectPageId}
            projectPagesLayout={projectPagesCanvasLayout}
            onSelectProjectPage={switchToProjectPage}
            onSelectProjectPageObject={selectProjectPageObject}
            onCreateProjectPageAdjacent={createBlankProjectPageAdjacent}
            onMoveProjectPage={moveProjectPageOnCanvas}
            onRenameProjectPage={renameProjectPage}
            onDeleteProjectPage={deleteProjectPage}
            projectPagesImageCacheRef={renderer.imageCacheRef}
            selectionSummary={canvasSelectionSummary}
            selectionLocked={isSelectionLocked}
            selectedBounds={engine.selectedBounds}
            selectedNodeKind={engine.selectedNode?.kind || null}
            selectedNodeGeometry={engine.selectedNode?.geometry || null}
            selectedAutoLayoutState={selectedAutoLayoutState}
            selectionRotationBaseDeg={selectionRotationBaseDeg}
            canvasRef={renderer.canvasRef}
            rulersEnabled={rulersEnabled}
            persistentGuides={artboardGuides}
            onChangeGuides={persistArtboardGuides}
            centerSignal={fitCenterSignal}
            onPointerDown={onToolPointerDown}
            onPointerMove={onToolPointerMove}
            onPointerUp={onToolPointerUp}
            onCanvasDoubleClick={onCanvasDoubleClick}
            onCanvasOutsideDoubleClick={toggleCanvasMenus}
            onZoomChange={(uiPercent) => renderer.setZoom(uiPercentToEngineZoom(uiPercent))}
            onToolbarAction={onToolbarAction}
            onCanvasBlankClick={() => {
              if (activeTool !== "select") {
                activateCanvasTool("select");
                return;
              }
              engine.setSelection([]);
              if (engine.mode !== "select") {
                engine.setMode("select");
              }
            }}
            onSelectionChromeClick={onSelectionChromeClick}
            onSelectionQuickAction={onSelectionQuickAction}
            onTranslateSelectionGesture={onTranslateSelectionGesture}
            onRotateSelectionGesture={onRotateSelectionGesture}
            onResizeSelectedNode={(patch) => {
              if (selectionSummary.count !== 1) return;
              patchSelectedNode({
                ...(patch.x != null ? { x: patch.x } : {}),
                ...(patch.y != null ? { y: patch.y } : {}),
                ...(patch.width != null ? { width: patch.width } : {}),
                ...(patch.height != null ? { height: patch.height } : {}),
              });
            }}
            onResizeSelectionGesture={onResizeSelectionGesture}
            onLineEndpointGesture={onLineEndpointGesture}
            pathEditData={pathEditData || undefined}
            onPathPointGesture={onPathPointGesture}
            imageBrushActive={imageBrushState.enabled && selectionSummary.kind === "single_image" && !isSelectionLocked}
            imageBrushSize={imageBrushState.size}
            imageBrushState={imageBrushState}
            onImageBrushGesture={onImageBrushGesture}
            imageTraceState={imageTraceState}
            tracePreviewPaths={tracePreview?.pathData || []}
            tracePreviewStroke={tracePreview?.strokeColor || "#22d3ee"}
            onImageFileDrop={onImageFileDrop}
            onImportFileDrop={onImportFileDrop}
            onImageUrlDrop={onImageUrlDrop}
            onExternalImageDragHover={onExternalImageDragHover}
            onCropWheel={onCropWheel}
            cropOverlay={cropOverlay}
            cropLiveRef={cropLiveRef}
            selectionMoveRasterPreview={selectionMoveRasterPreview}
            selectionMovePreviewOffsetRef={selectionMovePreviewOffsetRef}
            gestureGuidesRef={selectionGestureGuidesRef}
            suspendSelectionChrome={false}
            snapEnabled={engine.store.snap.enabled}
            snapTolerance={engine.store.snap.tolerance}
            gridEnabled={engine.store.snap.toGrid}
            gridSize={engine.store.snap.gridSize}
            artboardFill={engine.doc.canvas.background || "#f2ece4"}
            documentColors={documentColors}
            marqueeRect={pointer.marqueeRect}
            frameDropPreview={frameDropPreview}
            textToolbarState={textToolbarState}
            shapeToolbarState={shapeToolbarState}
            lineToolbarState={lineToolbarState}
            elementOpacityState={elementOpacityState}
            imageDuotoneState={imageDuotoneState}
            imageFadeState={imageFadeState}
            imageBackgroundRemovalState={imageBackgroundRemovalState}
            inlineTextEdit={inlineTextEditOverlay}
            onInlineTextChange={onInlineTextChange}
            onInlineTextCommit={onInlineTextCommit}
            onInlineTextCancel={onInlineTextCancel}
            cursorOverride={canvasCursorOverride}
            allowBlankViewportMarquee={activeTool === "select"}
          />
          </div>
        )}
      </PinselaAppShell>

      <CanvasContextMenu
        open={ctxMenu.open}
        x={ctxMenu.x}
        y={ctxMenu.y}
        hasSelection={engine.selection.length > 0}
        selectionCount={engine.selection.length}
        canPaste={canPasteFromClipboard()}
        canGroup={engine.selection.length >= 2}
        canUngroup={engine.doc.nodes.some((n) => engine.selection.includes(n.id) && n.kind === "group")}
        isLocked={engine.selection.length > 0 && areSelectionAllLocked(engine.doc, engine.selection)}
        isHidden={engine.selection.length > 0 && areSelectionAllHidden(engine.doc, engine.selection)}
        onCopy={() => engine.copySelection()}
        onCut={() => engine.cutSelection()}
        onPaste={() => engine.pasteClipboard()}
        onDuplicate={() => {
          engine.copySelection();
          engine.pasteClipboard();
        }}
        onDelete={() => engine.deleteSelection()}
        onSelectAll={() => {
          const allIds = engine.doc.nodes.filter((n) => n.id !== engine.doc.root_id).map((n) => n.id);
          engine.setSelection(allIds);
        }}
        onBringForward={() => engine.commitDoc(reorderSelection(engine.doc, engine.selection, "up"))}
        onSendBackward={() => engine.commitDoc(reorderSelection(engine.doc, engine.selection, "down"))}
        onBringToFront={() => engine.commitDoc(reorderSelection(engine.doc, engine.selection, "front"))}
        onSendToBack={() => engine.commitDoc(reorderSelection(engine.doc, engine.selection, "back"))}
        onAlign={(mode) => engine.commitDoc(alignSelection(engine.doc, engine.selection, mode))}
        onDistribute={(axis) => engine.commitDoc(distributeSelection(engine.doc, engine.selection, axis))}
        onGroup={() => {
          const grouped = groupSelectionIntoNewGroup(engine.doc, engine.selection);
          if (!grouped) return;
          engine.commitDoc(grouped.doc);
          engine.setSelection([grouped.groupId]);
        }}
        onUngroup={() => {
          const ungrouped = ungroupSelectedGroups(engine.doc, engine.selection);
          if (!ungrouped) return;
          engine.commitDoc(ungrouped.doc);
          engine.setSelection(ungrouped.childIds);
        }}
        onToggleLock={() => {
          if (!engine.selection.length) return;
          const nextLocked = !areSelectionAllLocked(engine.doc, engine.selection);
          engine.commitDoc(setSelectionLocked(engine.doc, engine.selection, nextLocked));
        }}
        onToggleVisibility={() => {
          if (!engine.selection.length) return;
          const nextVisible = areSelectionAllHidden(engine.doc, engine.selection);
          engine.commitDoc(setSelectionVisible(engine.doc, engine.selection, nextVisible));
        }}
        onClose={closeCtxMenu}
      />

      {editorReady && (
        <React.Suspense fallback={null}>
          <ProjectPagesGridLazy
            open={pagesGridOpen}
            pages={pagesGridOpen ? buildProjectPagesSnapshot(engine.doc) : projectPages}
            activePageId={activeProjectPageId}
            onClose={() => setPagesGridOpen(false)}
            onSelectPage={(pageId) => {
              switchToProjectPage(pageId);
              setPagesGridOpen(false);
            }}
            onRenamePage={renameProjectPage}
            onDuplicatePage={duplicateProjectPage}
            onDeletePage={deleteProjectPage}
            onMovePage={moveProjectPage}
            onCreateBlankPage={createBlankProjectPage}
            initialPageFormat={chosenFormat}
          />
        </React.Suspense>
      )}

      {editorReady && (
        <CanvasToolbelt
          uiVariant={isLocalSandbox ? "local_sandbox" : "default"}
          compactViewport={isCompactViewport}
          activeTool={activeTool}
          lastNavigationTool={lastNavigationTool}
          lastInsertTool={lastInsertTool}
          lastDrawTool={lastDrawTool}
          canUndo={engine.canUndo}
          canRedo={engine.canRedo}
          saveState={engine.store.saveStatus}
          pagesGridOpen={pagesGridOpen}
          selectionCount={selectionSummary.count}
          onSelectTool={activateCanvasTool}
          onUndo={engine.undo}
          onRedo={engine.redo}
          onTogglePagesGrid={() => setPagesGridOpen((current) => !current)}
          onShowExport={() => setActiveModal("export")}
          onBooleanOperation={(operation) => leftPanelCallbacks.onSelectionBooleanOperation?.(operation)}
          projectName={displayProjectName}
          pageLabel={activeProjectPage?.name || "Page"}
          canvasLabel={canvasLabel}
        />
      )}

      {editorReady && activeModal === "format_change_confirm" && (
        <React.Suspense fallback={null}>
          <FormatChangeConfirmModalLazy
            onClose={() => setActiveModal(null)}
            onConfirm={() => {
              setActiveModal(null);
              setFormatPickerMode("replace");
              setChosenFormat(null);
            }}
          />
        </React.Suspense>
      )}

      {editorReady && activeModal === "add_guides" && (
        <React.Suspense fallback={null}>
          <AddGuidesModalLazy
            onClose={() => setActiveModal(null)}
            onSubmit={applyAddGuides}
            initialValues={addGuidesValues}
          />
        </React.Suspense>
      )}

      {editorReady && activeModal === "versions" && (
        <React.Suspense fallback={null}>
          <VersionsModalLazy
            onClose={() => setActiveModal(null)}
            versions={api.versions}
            loading={api.busy}
            onLoadVersions={() => api.loadVersions(api.projectKey)}
            onRestore={async (versionId) => {
              const ok = await api.restoreVersion(api.projectKey, versionId);
              if (ok) {
                const doc = await api.loadProject(api.projectKey);
                if (doc) {
                  const parsed = parseProjectPagesFromDoc(doc);
                  const restoredPage = parsed.pages.find((page) => page.id === parsed.activePageId) || parsed.pages[0];
                  replaceProjectPagesState(parsed.pages);
                  applyProjectPageToEditor(restoredPage.id, restoredPage.doc, false);
                  markNextDocAsPersisted();
                }
                setActiveModal(null);
              }
            }}
          />
        </React.Suspense>
      )}

      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      {editorReady && activeModal === "export" && (
        <React.Suspense fallback={null}>
          <ExportModalLazy
            pages={projectPages.map((p) => ({ id: p.id, name: p.name }))}
            activePageId={activeProjectPageId}
            onClose={() => setActiveModal(null)}
            onExport={async (config, action) => {
              const { exportDocBlob } = await import("../pinsela/core/export");
              const format: ExportOutputKind = config.format === "jpg"
                ? "jpg"
                : config.format === "webp"
                  ? "webp"
                  : config.format === "pdf"
                    ? "pdf"
                    : "png";
              const scale = Math.max(0.25, Math.min(6, Number(config.scale || 1)));
              const withoutBackground = Boolean(config.withoutBackground) && (format === "png" || format === "webp");
              const renderOpts = {
                pixelRatio: scale,
                backgroundMode: (withoutBackground ? "transparent" : "as-is") as "transparent" | "as-is",
              };
              const pageIds: string[] = Array.isArray(config.pageIds) ? config.pageIds : [];

              // Multi-page export: PDF -> ONE multi-page PDF; images -> ONE ZIP.
              // Pages go out in project order (the order of project_pages_v1.pages[]).
              if (pageIds.length > 1) {
                const snapshot = buildProjectPagesSnapshot(engine.doc);
                const selectedPages = selectPagesInProjectOrder(snapshot, pageIds);
                const baseName = buildArtworkExportBaseName(api.projectKey);
                let blob: Blob;
                let filename: string;
                if (format === "pdf") {
                  const { exportDocsToPdfBlob } = await import("../pinsela/core/export");
                  blob = await exportDocsToPdfBlob(selectedPages.map((p) => stripProjectPagesMetadata(p.doc)), renderOpts);
                  filename = `${baseName}.pdf`;
                } else {
                  const { zipFilesBlob } = await import("../pinsela/core/export");
                  const files: Array<{ name: string; blob: Blob }> = [];
                  for (let i = 0; i < selectedPages.length; i += 1) {
                    const page = selectedPages[i];
                    files.push({
                      name: `${String(i + 1).padStart(2, "0")}-${buildArtworkExportBaseName(page.name)}.${format}`,
                      blob: await exportDocBlob(stripProjectPagesMetadata(page.doc), format, renderOpts),
                    });
                  }
                  blob = await zipFilesBlob(files);
                  filename = `${baseName}-${format}.zip`;
                }
                triggerBrowserDownload(blob, filename);
                markCurrentDocAsPersisted();
                setActiveModal(null);
                return;
              }

              // Single page: the chosen page if any, otherwise the active doc.
              let targetDoc = engine.doc;
              if (pageIds.length === 1 && pageIds[0] !== activeProjectPageId) {
                const snapshot = buildProjectPagesSnapshot(engine.doc);
                const chosen = snapshot.find((p) => p.id === pageIds[0]);
                if (chosen) targetDoc = chosen.doc;
              }
              const blob = await exportDocBlob(stripProjectPagesMetadata(targetDoc), format, renderOpts);
              const filename = buildArtworkExportFileName(api.projectKey, format, scale, withoutBackground);
              const saved = await saveBlobToLocalFile(blob, filename, format, action);
              if (!saved) return;
              markCurrentDocAsPersisted();
              setActiveModal(null);
            }}
          />
        </React.Suspense>
      )}

      {editorReady && activeModal === "bulk" && (
        <React.Suspense fallback={null}>
          <BulkCsvModalLazy
            onClose={() => setActiveModal(null)}
            busy={api.busy}
            onCreateJobs={async (csv) => {
              await api.createBulkJobs(api.projectKey, csv);
              setActiveModal(null);
            }}
          />
        </React.Suspense>
      )}
    </div>
  );
}
