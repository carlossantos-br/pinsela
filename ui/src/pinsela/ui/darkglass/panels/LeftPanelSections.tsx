import React from "react";
import { BUILTIN_TEMPLATES, builtinTemplateFormat, builtinTemplatePageCount } from "../../../templates/builtinTemplates";
import { createProjectFromDoc, duplicateProjectAsNew } from "../../../projects/createProject";
import { getRemoteBackedLocalEditorPath } from "../../../localAccount";
import { PillButton, IconButton, PinselaIcon, ChipTab, ColorPicker, colorToCssString } from "../index";
import type {
  PinselaLayerEffect,
  PinselaLayerEffectType,
  PinselaNode,
  PinselaTemplateDocV1,
  PinselaStrokeStackItem,
} from "../../../core/types";
import type {
  TemplateListItem,
  AssetItem,
} from "../../../platform/api/pinselaNativeApi";
import { FONT_LIBRARY } from "../fonts/fontLibrary";
import { defaultStrokeStackItem, normalizeStrokeStackFromNode, normalizeStrokeStackItem, STROKE_BRUSH_PRESETS } from "../../../core/strokes";

export interface LeftPanelHistoryItem {
  id: string;
  label: string;
  active?: boolean;
}

export interface ImportLibraryItem {
  id: string;
  name: string;
  extension: string;
  kindLabel: string;
  sizeLabel?: string;
  previewSrc?: string;
}

export type SvgImportMode = "current_page" | "new_page";

export interface RulesPanelState {
  snapEnabled: boolean;
  snapToGrid: boolean;
  snapTolerance: number;
  gridSize: number;
}

export interface AutoLayoutContentLimitRuleView {
  enabled?: boolean;
  maxChars?: number;
  startFontSize?: number;
  minFontSize?: number;
  shrinkStep?: number;
  truncateMode?: "none" | "cut" | "ellipsis";
}

export type AutoLayoutLimitPresetId = "story" | "a4" | "banner" | "generic";

export interface AutoLayoutLimitPresetView {
  id: AutoLayoutLimitPresetId;
  label: string;
  description: string;
  rule: AutoLayoutContentLimitRuleView;
}

export type AutomationBindingKind = "text" | "image" | "frame";

export type AssetUploadProgressItem = {
  id: string;
  name: string;
  previewUrl: string;
  progress: number;
  status: "uploading" | "error";
  error?: string | null;
};

export interface AutomationBindingField {
  id: string;
  layerName: string;
  kind: AutomationBindingKind;
}

export interface AutomationTemplateSummary {
  id: string;
  name: string;
  sourcePageName?: string | null;
  projectKey?: string | null;
  bindingCount: number;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface AutomationTemplateDetail {
  id: string;
  name: string;
  sourcePageName?: string | null;
  projectKey?: string | null;
  bindingCount: number;
  createdAt?: string | null;
  updatedAt?: string | null;
  doc: PinselaTemplateDocV1;
  bindings: AutomationBindingField[];
}

export interface AutomationSaveTemplatePayload {
  name: string;
  pageName: string;
  bindings: AutomationBindingField[];
  doc?: PinselaTemplateDocV1;
  templateId?: string | null;
}

export interface AutomationCreatePagePayload {
  pageName: string;
  bindings: AutomationBindingField[];
  valuesByBindingId: Record<string, string>;
  baseDoc?: PinselaTemplateDocV1;
  sourceTemplateId?: string | null;
}

function AssetThumbImage({ src, alt }: { src: string; alt: string }) {
  const hostRef = React.useRef<HTMLSpanElement | null>(null);
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    const node = hostRef.current;
    if (!node || visible) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting || entry.intersectionRatio > 0)) return;
        setVisible(true);
        observer.disconnect();
      },
      { root: null, rootMargin: "120px 0px", threshold: 0.01 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible]);

  return (
    <span ref={hostRef} className="dg-asset-card-media">
      {visible ? (
        <img
          src={src}
          alt={alt}
          className="dg-asset-card-img"
          loading="lazy"
          decoding="async"
        />
      ) : (
        <span className="dg-asset-card-fallback">
          <PinselaIcon name="ImagePlus" size={18} />
        </span>
      )}
    </span>
  );
}

export interface LeftPanelCallbacks {
  onAddNode?: (kind: PinselaNode["kind"], overrides?: Partial<PinselaNode>) => void;
  onActivateCanvasTool?: (tool: string) => void;
  onWrapSelectionInAutoLayout?: () => void;
  onAddImageFromDevice?: () => void;
  onPlaceAsset?: (assetId: string, asset?: AssetItem) => void;
  onUploadTraceImage?: () => void;
  onDeleteSelection?: () => void;
  onDuplicateSelection?: () => void;
  onGroupSelection?: () => void;
  onUngroupSelection?: () => void;
  onToggleVisibility?: (nodeId: string) => void;
  onToggleLock?: (nodeId: string) => void;
  onDeleteNode?: (nodeId: string) => void;
  onSelectNode?: (nodeId: string) => void;
  onSetSelection?: (ids: string[]) => void;
  onJumpToHistory?: (index: number) => void;
  onOpenVersions?: () => void;
  onSetSnapEnabled?: (enabled: boolean) => void;
  onSetSnapToGrid?: (enabled: boolean) => void;
  onSetSnapTolerance?: (value: number) => void;
  onSetGridSize?: (value: number) => void;
  onRunPreviewRules?: () => void;
  onExitPreviewRules?: () => void;
  onLoadSamplePayload?: () => void;
  onClearPreviewPayload?: () => void;
  onSelectFont?: (fontFamily: string, variantLabel?: string) => boolean | void;
  onSetTextColor?: (color: unknown) => void;
  onSetSelectedTextContent?: (text: string) => void;
  onPatchSelectedTextStyle?: (patch: Partial<{
    size: number;
    line_height: number;
    letter_spacing: number;
    text_align: "left" | "center" | "right" | "justify";
    color: unknown;
  }>) => void;
  onPatchSelectedNode?: (patch: Partial<{
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    opacity: number;
    fill: unknown;
    layout: Partial<PinselaNode["layout"]>;
    clip: boolean;
    effects: PinselaLayerEffect[];
  }>) => void;
  onSetSelectedStrokes?: (strokes: PinselaStrokeStackItem[]) => void;
  onSetSelectedEffects?: (effects: PinselaLayerEffect[]) => void;
  onReorderSelection?: (direction: "up" | "down" | "front" | "back") => void;
  onAlignSelection?: (mode: "left" | "center" | "right" | "top" | "middle" | "bottom") => void;
  onDistributeSelection?: (axis: "horizontal" | "vertical") => void;
  onToggleSelectionLock?: () => void;
  onToggleSelectionVisibility?: () => void;
  onMoveLayerByList?: (sourceIds: string[], targetId: string, placement: "before" | "after") => void;
  onRenameNode?: (nodeId: string, name: string) => void;
  onSelectImageTraceTarget?: (nodeId: string) => void;
  onImageTraceAction?: (payload: {
    phase: "preview" | "apply" | "cancel";
    edgeThreshold: number;
    curveTolerance: number;
    nodeId?: string | null;
  }) => void;
  onSelectionBooleanOperation?: (operation: SelectionBooleanOperationId) => void;
  onSelectionPerspectiveWarp?: (payload: SelectionPerspectiveWarpPayload) => void;
  onOpenImportPicker?: () => void;
  svgImportMode?: SvgImportMode;
  onSetSvgImportMode?: (mode: SvgImportMode) => void;
  onOpenSvgImportPicker?: (mode?: SvgImportMode) => void;
  onPlaceImport?: (importId: string) => void;
  onRemoveImport?: (importId: string) => void;
  onOpenAddGuides?: () => void;
  onUpsertAutoLayoutLimitRule?: (patch: AutoLayoutContentLimitRuleView) => void;
  onRemoveAutoLayoutLimitRule?: (containerId?: string) => void;
  onApplyAutoLayoutLimitPreset?: (presetId: AutoLayoutLimitPresetId) => void;
  onCreateAutomationPage?: (payload: AutomationCreatePagePayload) => boolean | void;
  onSaveAutomationTemplate?: (payload: AutomationSaveTemplatePayload) => boolean | void | Promise<boolean | void>;
  onLoadAutomationTemplate?: (templateId: string) => AutomationTemplateDetail | null | Promise<AutomationTemplateDetail | null>;
  onDeleteAutomationTemplate?: (templateId: string) => boolean | void | Promise<boolean | void>;
}

export interface LeftPanelTraceImageOption {
  id: string;
  name: string;
  src?: string | null;
}

export interface LeftPanelImageTraceState {
  targetImageId: string | null;
  images: LeftPanelTraceImageOption[];
  edgeThreshold: number;
  curveTolerance: number;
  processing: boolean;
  hasPreview: boolean;
}

export type SelectionBooleanOperationId =
  | "union"
  | "subtract"
  | "intersect"
  | "divide"
  | "exclude"
  | "slice";

export type SelectionPerspectiveWarpPayload = {
  tlx: number;
  tly: number;
  trx: number;
  try: number;
  brx: number;
  bry: number;
  blx: number;
  bly: number;
};

const DEFAULT_AUTO_LAYOUT: PinselaNode["layout"] = {
  direction: "none",
  gap: 0,
  padding_top: 0,
  padding_right: 0,
  padding_bottom: 0,
  padding_left: 0,
  align_main: "start",
  align_cross: "start",
  sizing_mode: "fixed",
  wrap: false,
  wrap_mode: "flow",
  grid_columns: 0,
  grid_rows: 0,
};

function isAutoLayoutHostNode(node: PinselaNode | null | undefined): boolean {
  if (!node) return false;
  return node.kind === "group" || node.kind === "frame" || node.kind === "rect";
}

function normalizeAutoLayout(node: PinselaNode): PinselaNode["layout"] {
  return {
    ...DEFAULT_AUTO_LAYOUT,
    ...(node.layout || {}),
  };
}

function toAlignAxisIndex(value: "start" | "center" | "end" | "stretch"): number {
  if (value === "start") return 0;
  if (value === "center" || value === "stretch") return 1;
  return 2;
}

function toAlignMainIndex(value: PinselaNode["layout"]["align_main"]): number {
  if (value === "start") return 0;
  if (value === "center" || value === "space_between") return 1;
  return 2;
}

function axisFromGridIndex(index: number): "start" | "center" | "end" {
  if (index <= 0) return "start";
  if (index >= 2) return "end";
  return "center";
}

function alignGridCell(layout: PinselaNode["layout"]): { row: number; col: number } {
  const cross = toAlignAxisIndex(layout.align_cross);
  const main = toAlignMainIndex(layout.align_main);
  if (layout.direction === "vertical") {
    return { row: main, col: cross };
  }
  return { row: cross, col: main };
}

function layoutPatchFromGridCell(
  layout: PinselaNode["layout"],
  row: number,
  col: number,
): Pick<PinselaNode["layout"], "align_main" | "align_cross"> {
  const rowAxis = axisFromGridIndex(row);
  const colAxis = axisFromGridIndex(col);
  if (layout.direction === "vertical") {
    return { align_main: rowAxis, align_cross: colAxis };
  }
  return { align_main: colAxis, align_cross: rowAxis };
}

export function TemplatesSection({ templates, callbacks }: { templates?: TemplateListItem[]; callbacks?: LeftPanelCallbacks }) {
  const [query, setQuery] = React.useState("");
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const needle = query.trim().toLowerCase();
  const builtin = BUILTIN_TEMPLATES.filter((item) => `${item.name} ${item.description}`.toLowerCase().includes(needle));
  const mine = (templates || []).filter((item) => item.name.toLowerCase().includes(needle));

  // Using a template always creates a NEW project; the source is never opened or edited.
  async function useTemplate(id: string, create: () => Promise<string>) {
    if (busyId) return;
    setBusyId(id);
    setError(null);
    try {
      const key = await create();
      window.location.assign(getRemoteBackedLocalEditorPath(key));
    } catch (e: any) {
      setError(String(e?.message || e || "Couldn't create the project."));
      setBusyId(null);
    }
  }

  return (
    <div className="dg-panel-section">
      <div className="dg-section-copy">
        <span>Pick a starting point: the template is copied into a new project and the original is left untouched.</span>
      </div>
      <input
        type="text"
        className="dg-input"
        placeholder="Search templates..."
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {error ? <div className="dg-list-item-subtle" role="alert" style={{ color: "#b91c1c" }}>{error}</div> : null}

      <div className="dg-panel-subtitle">Starter templates</div>
      <div className="dg-list-container">
        {builtin.length > 0 ? builtin.map((item) => (
          <button
            type="button"
            key={item.id}
            className="dg-list-item dg-list-item-template"
            disabled={busyId !== null}
            title={`Create a new project from “${item.name}”`}
            onClick={() => void useTemplate(item.id, () => createProjectFromDoc({ name: item.name, doc: item.doc_json, source: `projects:builtin:${item.id}` }))}
          >
            <div className="dg-list-item-main">
              <span className="dg-list-item-title">{item.name}</span>
              <span className="dg-list-item-subtle">
                {builtinTemplateFormat(item)}
                {builtinTemplatePageCount(item) > 1 ? ` · ${builtinTemplatePageCount(item)} pages` : ""}
              </span>
            </div>
            <span className="dg-list-item-subtle">{busyId === item.id ? "Creating…" : "Use"}</span>
          </button>
        )) : (
          <div className="dg-list-item-subtle">No templates match this search.</div>
        )}
      </div>

      <div className="dg-panel-subtitle">My projects</div>
      <div className="dg-list-item-subtle">Using a template creates a copy.</div>
      <div className="dg-list-container">
        {mine.length > 0 ? mine.map((item) => (
          <button
            type="button"
            key={item.key}
            className="dg-list-item dg-list-item-template"
            disabled={busyId !== null}
            title={`Duplicate “${item.name}” into a new project`}
            onClick={() => void useTemplate(item.key, () => duplicateProjectAsNew(item.key, `${item.name} (copy)`))}
          >
            <div className="dg-list-item-main">
              <span className="dg-list-item-title">{item.name}</span>
            </div>
            <span className="dg-list-item-subtle">{busyId === item.key ? "Creating…" : "Duplicate and use"}</span>
          </button>
        )) : (
          <div className="dg-empty-state">
            <div className="dg-empty-state-title">No projects match this search.</div>
          </div>
        )}
      </div>

      <div className="dg-panel-stack">
        <PillButton tone="neutral" onClick={() => { window.location.assign("/projects"); }}>+ Create blank project</PillButton>
      </div>
    </div>
  );
}

type ElementIconName = React.ComponentProps<typeof PinselaIcon>["name"];
type ElementSpec = {
  label: string;
  icon: ElementIconName;
  kind: PinselaNode["kind"];
  overrides?: Partial<PinselaNode>;
};
type ElementGroup = { name: string; items: ElementSpec[] };

// Canonical "Elements" catalog (Phase 6). Every item maps 1:1 to
// insertNodeFromPanel(kind, overrides) and renders in canvas2dPainter today —
// no asset files, no composed multi-node groups (those are v2). Built from the
// design workflow synthesis, grounded in scene.ts defaultNode + the painter.
const ELEMENT_GROUPS: ElementGroup[] = [
  {
    name: "Shapes",
    items: [
      { label: "Rectangle", icon: "Square", kind: "rect", overrides: { geometry: { x: 80, y: 80, width: 360, height: 240, rotation: 0, corner_radius: 0, clip: false, z_index: 0 }, style: { shape_type: "rect", fill: "#2563eb" } as any } },
      { label: "Rounded", icon: "SquareRoundCorner", kind: "rect", overrides: { geometry: { x: 80, y: 80, width: 360, height: 240, rotation: 0, corner_radius: 28, clip: false, z_index: 0 }, style: { shape_type: "rect", fill: "#1A1815" } as any } },
      { label: "Circle", icon: "Circle", kind: "rect", overrides: { geometry: { x: 80, y: 80, width: 240, height: 240, rotation: 0, corner_radius: 0, clip: false, z_index: 0 }, style: { shape_type: "ellipse", fill: "#2563eb" } as any } },
      { label: "Ellipse", icon: "Circle", kind: "rect", overrides: { geometry: { x: 80, y: 80, width: 340, height: 220, rotation: 0, corner_radius: 0, clip: false, z_index: 0 }, style: { shape_type: "ellipse", fill: "#D8C0A8" } as any } },
      { label: "Triangle", icon: "Play", kind: "rect", overrides: { geometry: { x: 80, y: 80, width: 220, height: 220, rotation: 0, corner_radius: 0, clip: false, z_index: 0 }, style: { shape_type: "polygon", shape_sides: 3, fill: "#2563eb" } as any } },
      { label: "Hexagon", icon: "Pentagon", kind: "rect", overrides: { geometry: { x: 80, y: 80, width: 240, height: 240, rotation: 0, corner_radius: 0, clip: false, z_index: 0 }, style: { shape_type: "polygon", shape_sides: 6, fill: "#2563eb" } as any } },
      { label: "Pentagon", icon: "Pentagon", kind: "rect", overrides: { geometry: { x: 80, y: 80, width: 240, height: 240, rotation: 0, corner_radius: 0, clip: false, z_index: 0 }, style: { shape_type: "polygon", shape_sides: 5, fill: "#D8C0A8" } as any } },
      { label: "Star", icon: "Star", kind: "rect", overrides: { geometry: { x: 80, y: 80, width: 220, height: 220, rotation: 0, corner_radius: 0, clip: false, z_index: 0 }, style: { shape_type: "star", star_points: 5, star_inner_ratio: 0.46, fill: "#2563eb" } as any } },
    ],
  },
  {
    name: "Pills & badges",
    items: [
      { label: "Pill", icon: "RectangleHorizontal", kind: "rect", overrides: { geometry: { x: 80, y: 80, width: 425, height: 144, rotation: 0, corner_radius: 72, clip: false, z_index: 0 }, style: { shape_type: "rect", fill: "#2563eb", effects: [{ type: "drop_shadow", x: 0, y: 8, blur: 24, color: "#000000", opacity: 18 }] } as any } },
      { label: "Badge", icon: "RectangleHorizontal", kind: "rect", overrides: { geometry: { x: 80, y: 80, width: 208, height: 54, rotation: 0, corner_radius: 27, clip: false, z_index: 0 }, style: { shape_type: "rect", fill: "#2563eb" } as any } },
      { label: "Seal", icon: "CheckCircle2", kind: "rect", overrides: { geometry: { x: 80, y: 80, width: 160, height: 160, rotation: 0, corner_radius: 0, clip: false, z_index: 0 }, style: { shape_type: "ellipse", fill: "#2563eb", stroke: { color: "#ffffff", width: 3, dash: [] }, effects: [{ type: "drop_shadow", x: 0, y: 6, blur: 18, color: "#000000", opacity: 20 }] } as any } },
      { label: "Outline pill", icon: "RectangleHorizontal", kind: "rect", overrides: { geometry: { x: 80, y: 80, width: 300, height: 96, rotation: 0, corner_radius: 48, clip: false, z_index: 0 }, style: { shape_type: "rect", fill: "rgba(0,0,0,0)", stroke: { color: "#2563eb", width: 2, dash: [] } } as any } },
      { label: "Frame", icon: "Square", kind: "rect", overrides: { geometry: { x: 80, y: 80, width: 520, height: 360, rotation: 0, corner_radius: 18, clip: false, z_index: 0 }, style: { shape_type: "rect", fill: "#ffffff", effects: [{ type: "drop_shadow", x: 0, y: 10, blur: 24, color: "#000000", opacity: 25 }] } as any } },
      { label: "Censor dot", icon: "EyeOff", kind: "rect", overrides: { geometry: { x: 80, y: 80, width: 92, height: 92, rotation: 0, corner_radius: 0, clip: false, z_index: 0 }, style: { shape_type: "ellipse", fill: "#000000" } as any } },
    ],
  },
  {
    name: "Text",
    items: [
      { label: "Title", icon: "Type", kind: "text", overrides: { text: "Title", text_style: { family: "Inter", postscript: "Inter-Bold", style: "Bold", size: 72, line_height: 110, text_align: "center", color: "#ffffff" } as any } },
      { label: "Subtitle", icon: "LetterText", kind: "text", overrides: { text: "Subtitle", text_style: { family: "Inter", postscript: "Inter-Bold", style: "Bold", size: 28, line_height: 120, text_align: "left", color: "#2563eb" } as any } },
      { label: "Body", icon: "AlignLeft", kind: "text", overrides: { text: "Body text", text_style: { family: "Inter", postscript: "Inter-Regular", style: "Regular", size: 18, line_height: 150, text_align: "left", color: "#ffffff" } as any } },
      { label: "Price", icon: "Bold", kind: "text", overrides: { text: "$0.00", text_style: { family: "Inter", postscript: "Inter-Bold", style: "Bold", size: 48, line_height: 100, text_align: "center", color: "#ffffff" } as any } },
      { label: "Tag", icon: "LetterText", kind: "text", overrides: { text: "SALE", text_style: { family: "Inter", postscript: "Inter-Medium", style: "Medium", size: 14, letter_spacing: 2, line_height: 120, text_align: "center", color: "#ffffff" } as any } },
      { label: "Highlight", icon: "Type", kind: "text", overrides: { text: "Highlight", text_style: { family: "Inter", postscript: "Inter-Bold", style: "Bold", size: 22, line_height: 120, text_align: "left", color: "#2563eb" } as any } },
    ],
  },
  {
    name: "Lines & dividers",
    items: [
      { label: "Line", icon: "Minus", kind: "line", overrides: { geometry: { x: 80, y: 200, width: 560, height: 0, rotation: 0, corner_radius: 0, clip: false, z_index: 0 }, style: { stroke: { color: "#ffffff", width: 4, dash: [], cap: "round" } } as any } },
      { label: "Divider", icon: "Slash", kind: "line", overrides: { geometry: { x: 300, y: 80, width: 0, height: 560, rotation: 0, corner_radius: 0, clip: false, z_index: 0 }, style: { stroke: { color: "#936947", width: 3, dash: [], cap: "butt" } } as any } },
      { label: "Arrow →", icon: "ArrowRight", kind: "line", overrides: { geometry: { x: 80, y: 200, width: 480, height: 0, rotation: 0, corner_radius: 0, clip: false, z_index: 0 }, style: { stroke: { color: "#2563eb", width: 5, dash: [], cap: "round", line_kind: "arrow_end" } } as any } },
      { label: "Arrow ↔", icon: "Expand", kind: "line", overrides: { geometry: { x: 80, y: 200, width: 480, height: 0, rotation: 0, corner_radius: 0, clip: false, z_index: 0 }, style: { stroke: { color: "#2563eb", width: 5, dash: [], cap: "round", line_kind: "arrow_both" } } as any } },
      { label: "Dashed", icon: "Minus", kind: "line", overrides: { geometry: { x: 80, y: 200, width: 560, height: 0, rotation: 0, corner_radius: 0, clip: false, z_index: 0 }, style: { stroke: { color: "#ffffff", width: 3, dash: [12, 8], cap: "butt" } } as any } },
      { label: "Dotted", icon: "Ellipsis", kind: "line", overrides: { geometry: { x: 80, y: 200, width: 560, height: 0, rotation: 0, corner_radius: 0, clip: false, z_index: 0 }, style: { stroke: { color: "#2563eb", width: 3, dash: [2, 8], cap: "round" } } as any } },
    ],
  },
  {
    name: "Effects & gradients",
    items: [
      { label: "Shadow card", icon: "CloudFog", kind: "rect", overrides: { geometry: { x: 80, y: 80, width: 520, height: 340, rotation: 0, corner_radius: 18, clip: false, z_index: 0 }, style: { shape_type: "rect", fill: "#1A1815", effects: [{ type: "drop_shadow", x: 0, y: 8, blur: 24, spread: 0, color: "#000000", opacity: 30 }] } as any } },
      { label: "Gradient", icon: "Blend", kind: "rect", overrides: { geometry: { x: 0, y: 80, width: 1080, height: 300, rotation: 0, corner_radius: 0, clip: false, z_index: 0 }, style: { shape_type: "rect", fill: { type: "gradient", gradient_type: "linear", angle: 90, stops: [{ offset: 0, color: "#2563eb" }, { offset: 1, color: "rgba(47,214,164,0)" }] } } as any } },
      { label: "Radial gradient", icon: "Droplet", kind: "rect", overrides: { geometry: { x: 80, y: 80, width: 280, height: 280, rotation: 0, corner_radius: 0, clip: false, z_index: 0 }, style: { shape_type: "ellipse", fill: { type: "gradient", gradient_type: "radial", stops: [{ offset: 0, color: "#2563eb" }, { offset: 1, color: "#0f9c74" }] } } as any } },
      { label: "Inner shadow", icon: "Square", kind: "rect", overrides: { geometry: { x: 80, y: 80, width: 360, height: 240, rotation: 0, corner_radius: 18, clip: false, z_index: 0 }, style: { shape_type: "rect", fill: "#1A1815", effects: [{ type: "inner_shadow", x: 0, y: 4, blur: 12, color: "#000000", opacity: 35 }] } as any } },
      { label: "Blur", icon: "Droplets", kind: "rect", overrides: { geometry: { x: 80, y: 80, width: 400, height: 400, rotation: 0, corner_radius: 200, clip: false, z_index: 0 }, style: { shape_type: "ellipse", fill: "#2563eb", effects: [{ type: "layer_blur", blur: 32, opacity: 100 }] } as any } },
      { label: "Outline", icon: "CircleDashed", kind: "rect", overrides: { geometry: { x: 80, y: 80, width: 360, height: 240, rotation: 0, corner_radius: 16, clip: false, z_index: 0 }, style: { shape_type: "rect", fill: "rgba(0,0,0,0)", stroke: { color: "#ffffff", width: 2, dash: [10, 8], cap: "butt" } } as any } },
    ],
  },
];

export function ElementsSection({ callbacks }: { callbacks?: LeftPanelCallbacks }) {
  const [query, setQuery] = React.useState("");
  const q = query.trim().toLowerCase();
  const groups = q
    ? ELEMENT_GROUPS
        .map((group) => ({ ...group, items: group.items.filter((item) => item.label.toLowerCase().includes(q)) }))
        .filter((group) => group.items.length > 0)
    : ELEMENT_GROUPS;

  return (
    <div className="dg-panel-section">
      <div className="dg-section-copy">
        <span>Click to insert on the canvas. Everything stays editable — adjust color, size and effects later.</span>
      </div>
      <input
        type="text"
        className="dg-input"
        placeholder="Search elements..."
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {groups.length === 0 ? (
        <div className="dg-empty-state">
          <div className="dg-empty-state-title">No elements match “{query}”.</div>
        </div>
      ) : groups.map((group) => (
        <div key={group.name} className="dg-elements-group">
          <div className="dg-elements-group-title">{group.name}</div>
          <div className="dg-elements-grid">
            {group.items.map((item) => (
              <button
                key={group.name + item.label}
                type="button"
                className="dg-element-tile"
                title={`Insert ${item.label}`}
                onClick={() => callbacks?.onAddNode?.(item.kind, item.overrides)}
              >
                <span className="dg-element-tile-icon"><PinselaIcon name={item.icon} size={20} /></span>
                <span className="dg-element-tile-label">{item.label}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function TextSection({ callbacks }: { callbacks?: LeftPanelCallbacks }) {
  const [fontQuery, setFontQuery] = React.useState("");
  const [expandedFamily, setExpandedFamily] = React.useState<string | null>(FONT_LIBRARY[0]?.family || null);
  const [fontApplyHint, setFontApplyHint] = React.useState<string>("");
  const normalizedQuery = fontQuery.trim().toLowerCase();
  const filtered = FONT_LIBRARY.filter((entry) => {
    if (!normalizedQuery) return true;
    if (entry.family.toLowerCase().includes(normalizedQuery)) return true;
    return entry.variants.some((variant) => variant.label.toLowerCase().includes(normalizedQuery));
  });

  return (
    <div className="dg-panel-section dg-panel-section-text">
      <div className="dg-panel-subtitle">Fonts</div>
      <input
        type="text"
        className="dg-input"
        placeholder="Search fonts..."
        value={fontQuery}
        onChange={(event) => setFontQuery(event.target.value)}
      />

      <div className="dg-panel-inline-hint">
        Select text on the canvas and pick the family/variant here.
      </div>
      {fontApplyHint ? <div className="dg-panel-inline-hint">{fontApplyHint}</div> : null}

      <div className="dg-font-list">
        {filtered.map((entry) => {
          const forceExpanded = !!normalizedQuery && (
            entry.family.toLowerCase().includes(normalizedQuery)
            || entry.variants.some((variant) => variant.label.toLowerCase().includes(normalizedQuery))
          );
          const isExpanded = expandedFamily === entry.family || forceExpanded;
          const visibleVariants = entry.variants.filter((variant) => (
            !normalizedQuery
            || entry.family.toLowerCase().includes(normalizedQuery)
            || variant.label.toLowerCase().includes(normalizedQuery)
          ));

          return (
            <div key={entry.family} className="dg-font-family-block">
              <button
                type="button"
                className={`dg-font-family-row ${isExpanded ? "is-open" : ""}`}
                onClick={() => setExpandedFamily((current) => (current === entry.family ? null : entry.family))}
              >
                <span className="dg-font-family-caret">{isExpanded ? "v" : ">"}</span>
                <span className="dg-font-family-name" style={{ fontFamily: entry.family }}>{entry.family}</span>
                <span className="dg-font-family-preview">AaBbCc</span>
              </button>

              {isExpanded && (
                <div className="dg-font-variants">
                  {visibleVariants.map((variant) => (
                    <button
                      key={`${entry.family}-${variant.label}`}
                      type="button"
                      className="dg-font-variant-row"
                      style={{ fontFamily: entry.family, fontWeight: variant.weight, fontStyle: variant.italic ? "italic" : "normal" }}
                      onClick={() => {
                        const applied = callbacks?.onSelectFont?.(entry.family, variant.label);
                        if (applied === false) {
                          setFontApplyHint("Select a text element to apply the font.");
                          return;
                        }
                        setFontApplyHint("");
                      }}
                    >
                      <span>{variant.label}</span>
                      <span className="dg-font-variant-meta">{variant.postscriptSuffix}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {!filtered.length ? (
          <div className="dg-empty-state-title">No font family matches this search.</div>
        ) : null}
      </div>
    </div>
  );
}

function clampPercent(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  if (value <= 0) return 0;
  if (value >= 100) return 100;
  return Math.round(value);
}

export function AssetsSection({
  assets,
  assetUploads,
  callbacks,
  searchValue,
  onSearchValueChange,
  title = "Search the library",
  emptyHint = "Try another name or upload a new image.",
  showUpload = true,
}: {
  assets?: AssetItem[];
  assetUploads?: AssetUploadProgressItem[];
  callbacks?: LeftPanelCallbacks;
  searchValue?: string;
  onSearchValueChange?: (value: string) => void;
  title?: string;
  emptyHint?: string;
  showUpload?: boolean;
}) {
  const [uncontrolledQuery, setUncontrolledQuery] = React.useState("");
  const query = searchValue ?? uncontrolledQuery;
  const normalizedQuery = query.trim().toLowerCase();
  const [visibleCount, setVisibleCount] = React.useState(12);
  const uploadRows = (assetUploads || []).filter((upload) => {
    if (!normalizedQuery) return true;
    const haystack = [
      upload.name,
      upload.status === "error" ? "error failed upload" : "uploading upload",
    ]
      .map((part) => String(part || "").trim().toLowerCase())
      .filter(Boolean)
      .join(" ");
    return haystack.includes(normalizedQuery);
  });
  const rows = (assets || []).filter((asset) => {
    if (!normalizedQuery) return true;
    const haystack = [
      asset.name,
      asset.source_label,
      asset.role,
      asset.folder,
      ...(asset.tags || []),
    ]
      .map((part) => String(part || "").trim().toLowerCase())
      .filter(Boolean)
      .join(" ");
    return haystack.includes(normalizedQuery);
  });
  const visibleRows = rows.slice(0, visibleCount);
  const totalCount = rows.length + uploadRows.length;
  const resultLabel = `${totalCount} ${totalCount === 1 ? "image" : "images"}`;

  React.useEffect(() => {
    setVisibleCount(normalizedQuery ? 24 : 12);
  }, [normalizedQuery]);

  const handleQueryChange = React.useCallback((value: string) => {
    if (searchValue == null) {
      setUncontrolledQuery(value);
    }
    onSearchValueChange?.(value);
  }, [onSearchValueChange, searchValue]);

  return (
    <div className="dg-panel-section">
      <div className="dg-panel-subtitle">{title}</div>
      <input type="text" className="dg-input" placeholder="Search images..." value={query} onChange={(e) => handleQueryChange(e.target.value)} />
      <div className="dg-list-item-subtle">{resultLabel}</div>
      {showUpload ? (
        <div className="dg-panel-stack">
        <PillButton
          tone="secondary"
          size="sm"
          onClick={() => callbacks?.onAddImageFromDevice?.()}
        >
          Upload
        </PillButton>
        </div>
      ) : null}
      <div className="dg-asset-grid" role="list" aria-label="Image library">
        {uploadRows.map((upload) => {
          const progress = Math.max(0, Math.min(100, Math.round(Number(upload.progress || 0))));
          const errored = upload.status === "error";
          return (
            <button
              key={upload.id}
              type="button"
              className={`dg-asset-card dg-asset-card-upload ${errored ? "is-error" : "is-uploading"}`}
              role="listitem"
              disabled
              aria-busy={!errored}
              title={upload.name || "Upload"}
              aria-label={`${upload.name || "Image"}: ${errored ? "upload error" : `enviando ${progress}%`}`}
            >
              <span className="dg-asset-card-media">
                {upload.previewUrl ? (
                  <img className="dg-asset-card-img" src={upload.previewUrl} alt={upload.name || "Image"} draggable={false} />
                ) : (
                  <span className="dg-asset-card-fallback">
                    <PinselaIcon name="FileImage" size={18} />
                  </span>
                )}
                <span className="dg-asset-upload-overlay">
                  <span className="dg-asset-upload-meter">
                    <span style={{ width: `${progress}%` }} />
                  </span>
                  <span className="dg-asset-upload-label">
                    {errored ? "Error" : `${progress}%`}
                  </span>
                </span>
              </span>
              <span className="dg-asset-card-footer">
                <span className="dg-asset-card-name">{upload.name || "Image"}</span>
                <span className="dg-asset-card-action">
                  <PinselaIcon name={errored ? "TriangleAlert" : "CloudUpload"} size={14} />
                </span>
              </span>
            </button>
          );
        })}
        {rows.length > 0 ? visibleRows.map((asset) => (
          <button
            key={`${asset.source || "asset"}:${asset.id}`}
            type="button"
            className="dg-asset-card"
            role="listitem"
            onClick={() => callbacks?.onPlaceAsset?.(asset.id, asset)}
            title={asset.name || "Image"}
            aria-label={`Add ${asset.name || "image"} to canvas`}
          >
            {(asset.thumbnail_url || asset.preview_url) ? (
              <AssetThumbImage src={asset.thumbnail_url || asset.preview_url} alt={asset.name || "Image"} />
            ) : (
              <span className="dg-asset-card-media">
                <span className="dg-asset-card-fallback">
                  <PinselaIcon name="FileImage" size={18} />
                </span>
              </span>
            )}
            <span className="dg-asset-card-footer">
              <span className="dg-asset-card-copy">
                <span className="dg-asset-card-name">{asset.name || "Image"}</span>
                {asset.source_label ? <span className="dg-asset-card-source">{asset.source_label}</span> : null}
              </span>
              <span className="dg-asset-card-action">
                <PinselaIcon name="Plus" size={14} />
              </span>
            </span>
          </button>
        )) : (
          <div className="dg-empty-state">
            <div className="dg-empty-state-title">No images found.</div>
            <div className="dg-panel-inline-hint">{emptyHint}</div>
          </div>
        )}
      </div>
      {rows.length > visibleRows.length ? (
        <div className="dg-panel-stack">
          <PillButton
            tone="secondary"
            size="sm"
            onClick={() => setVisibleCount((current) => Math.min(rows.length, current + 24))}
          >
            Show more
          </PillButton>
        </div>
      ) : null}
    </div>
  );
}

export function ImportsSection({
  imports,
  callbacks,
  compact = false,
}: {
  imports?: ImportLibraryItem[];
  callbacks?: LeftPanelCallbacks;
  compact?: boolean;
}) {
  const [query, setQuery] = React.useState("");
  const [kindFilter, setKindFilter] = React.useState<"all" | "image" | "vector" | "document">("all");
  const svgImportMode = callbacks?.svgImportMode === "new_page" ? "new_page" : "current_page";
  const rows = (imports || []).filter((entry) => {
    const haystack = `${entry.name} ${entry.extension} ${entry.kindLabel}`.toLowerCase();
    const matchesQuery = haystack.includes(query.trim().toLowerCase());
    const normalizedExtension = String(entry.extension || "").toLowerCase();
    const normalizedKind = String(entry.kindLabel || "").toLowerCase();
    const looksImage = /(png|jpg|jpeg|webp|gif|avif|image)/.test(`${normalizedExtension} ${normalizedKind}`);
    const looksVector = /(svg|eps|ai|pdf|vector)/.test(`${normalizedExtension} ${normalizedKind}`);
    const looksDocument = /(fig|psd|aff|ppt|pptx|doc|pdf|document)/.test(`${normalizedExtension} ${normalizedKind}`) && !looksVector;
    const matchesFilter = kindFilter === "all"
      || (kindFilter === "image" && looksImage)
      || (kindFilter === "vector" && looksVector)
      || (kindFilter === "document" && looksDocument);
    return matchesQuery && matchesFilter;
  });
  const resultLabel = `${rows.length} ${rows.length === 1 ? "file ready" : "files ready"}`;

  if (compact) {
    return (
      <div className="dg-panel-section dg-imports-compact-section">
        <div className="dg-imports-compact-head">
          <span className="dg-imports-compact-mark">
            <PinselaIcon name="FileUp" size={15} />
          </span>
          <div>
            <strong>Import files</strong>
            <span>SVG, PDF, vectors and external images.</span>
          </div>
        </div>

        <div className="dg-import-mode-switch dg-import-mode-switch-compact" role="tablist" aria-label="SVG destination">
          <button
            type="button"
            className={`dg-import-mode-btn ${svgImportMode === "current_page" ? "active" : ""}`}
            aria-pressed={svgImportMode === "current_page"}
            onClick={() => callbacks?.onSetSvgImportMode?.("current_page")}
          >
            Current page
          </button>
          <button
            type="button"
            className={`dg-import-mode-btn ${svgImportMode === "new_page" ? "active" : ""}`}
            aria-pressed={svgImportMode === "new_page"}
            onClick={() => callbacks?.onSetSvgImportMode?.("new_page")}
          >
            New page
          </button>
        </div>

        <div className="dg-imports-compact-actions">
          <PillButton tone="primary" size="sm" onClick={() => callbacks?.onOpenSvgImportPicker?.(svgImportMode)}>
            <PinselaIcon name="FileUp" size={14} style={{ marginRight: 6 }} />
            SVG
          </PillButton>
          <PillButton tone="neutral" size="sm" onClick={() => callbacks?.onOpenImportPicker?.()}>
            Other files
          </PillButton>
        </div>

        <div className="dg-imports-compact-list">
          <div className="dg-list-item-subtle">{resultLabel}</div>
          {rows.length > 0 ? rows.slice(0, 4).map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="dg-imports-compact-item"
              onClick={() => callbacks?.onPlaceImport?.(entry.id)}
              title={entry.name}
            >
              <span className="dg-list-thumb dg-list-thumb-import">
                {entry.previewSrc ? (
                  <img src={entry.previewSrc} alt={entry.name} className="dg-list-thumb-import-img" />
                ) : (
                  <PinselaIcon name="FileImage" size={14} />
                )}
              </span>
              <span>
                <strong>{entry.name}</strong>
                <small>{entry.kindLabel}{entry.sizeLabel ? ` · ${entry.sizeLabel}` : ""}</small>
              </span>
            </button>
          )) : (
            <div className="dg-imports-compact-empty">Drag files onto the canvas or use the buttons above.</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="dg-panel-section">
      <div className="dg-import-hero">
        <div className="dg-import-hero-head">
          <div className="dg-import-hero-mark">
            <PinselaIcon name="FileUp" size={16} />
          </div>
          <div className="dg-import-hero-copy">
            <div className="dg-import-hero-title">Import files</div>
            <div className="dg-import-hero-text">
              SVG imports with the most fidelity. Choose whether it goes to the current page or opens a new page.
            </div>
          </div>
        </div>

        <div className="dg-import-mode-switch" role="tablist" aria-label="SVG destination">
          <button
            type="button"
            className={`dg-import-mode-btn ${svgImportMode === "current_page" ? "active" : ""}`}
            aria-pressed={svgImportMode === "current_page"}
            onClick={() => callbacks?.onSetSvgImportMode?.("current_page")}
          >
            Current page
          </button>
          <button
            type="button"
            className={`dg-import-mode-btn ${svgImportMode === "new_page" ? "active" : ""}`}
            aria-pressed={svgImportMode === "new_page"}
            onClick={() => callbacks?.onSetSvgImportMode?.("new_page")}
          >
            New page
          </button>
        </div>

        <div className="dg-import-hero-actions">
          <PillButton tone="primary" size="sm" onClick={() => callbacks?.onOpenSvgImportPicker?.(svgImportMode)}>
            <PinselaIcon name="FileUp" size={14} style={{ marginRight: 6 }} />
            Upload SVG
          </PillButton>
          <PillButton tone="neutral" size="sm" onClick={() => callbacks?.onOpenImportPicker?.()}>
            Upload other files
          </PillButton>
        </div>

        <div className="dg-import-drop-hint">
          <PinselaIcon name="Sparkles" size={13} />
          <span>Drag a file onto the canvas to insert it on the current page.</span>
        </div>
      </div>

      <div className="dg-panel-inline-hint">
        Accepted types: .svg, .fig, .psd, .aff, .pptx, .pdf and image formats.
      </div>

      <div className="dg-divider" />

      <div className="dg-panel-subtitle">Imported files</div>
      <input
        type="text"
        className="dg-input"
        placeholder="Search by name, extension or type..."
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="dg-layer-tabs">
        <ChipTab active={kindFilter === "all"} onClick={() => setKindFilter("all")}>All</ChipTab>
        <ChipTab active={kindFilter === "image"} onClick={() => setKindFilter("image")}>Images</ChipTab>
        <ChipTab active={kindFilter === "vector"} onClick={() => setKindFilter("vector")}>Vectors</ChipTab>
        <ChipTab active={kindFilter === "document"} onClick={() => setKindFilter("document")}>Documents</ChipTab>
      </div>
      <div className="dg-list-item-subtle">{resultLabel}</div>
      <div className="dg-list-container">
        {rows.length > 0 ? rows.slice(0, 120).map((entry) => (
          <div key={entry.id} className="dg-list-item dg-list-item-import" onClick={() => callbacks?.onPlaceImport?.(entry.id)}>
            <div className="dg-list-thumb dg-list-thumb-import">
              {entry.previewSrc ? (
                <img src={entry.previewSrc} alt={entry.name} className="dg-list-thumb-import-img" />
              ) : (
                <PinselaIcon name="FileImage" size={14} />
              )}
            </div>
            <div className="dg-list-item-main">
              <span className="dg-list-item-title">{entry.name}</span>
              <span className="dg-list-item-subtle">
                {entry.kindLabel}
                {entry.sizeLabel ? ` · ${entry.sizeLabel}` : ""}
              </span>
            </div>
            <IconButton size="sm" icon={<PinselaIcon name="Plus" size={14} />} title="Add to canvas" aria-label="Add to canvas" />
          </div>
        )) : (
          <div className="dg-empty-state">
            <div className="dg-empty-state-title">No files match the current search.</div>
            <div className="dg-panel-inline-hint">Upload a file above or adjust the filter to find other formats.</div>
          </div>
        )}
      </div>
    </div>
  );
}

export function SettingsSection({
  callbacks,
  rulesState,
}: {
  callbacks?: LeftPanelCallbacks;
  rulesState?: RulesPanelState;
}) {
  const snapEnabled = Boolean(rulesState?.snapEnabled ?? true);
  const snapToGrid = Boolean(rulesState?.snapToGrid ?? false);
  const snapTolerance = Math.max(1, Math.round(Number(rulesState?.snapTolerance ?? 6)));
  const gridSize = Math.max(2, Math.round(Number(rulesState?.gridSize ?? 8)));

  return (
    <div className="dg-panel-section">
      <div className="dg-panel-subtitle">Canvas settings</div>
      <div className="dg-panel-inline-hint">
        Snap, grid and guides in one place.
      </div>
      <div className="dg-settings-grid">
        <label className="dg-rules-popover-check">
          <span>Magnetic guides</span>
          <input
            type="checkbox"
            checked={snapEnabled}
            onChange={(event) => callbacks?.onSetSnapEnabled?.(event.target.checked)}
          />
        </label>
        <label className="dg-rules-popover-check">
          <span>Snap to grid</span>
          <input
            type="checkbox"
            checked={snapToGrid}
            onChange={(event) => callbacks?.onSetSnapToGrid?.(event.target.checked)}
          />
        </label>
        <label className="dg-rules-popover-field">
          <span>Grid size</span>
          <input
            type="number"
            min={2}
            value={gridSize}
            onChange={(event) => callbacks?.onSetGridSize?.(Math.max(2, Number(event.target.value || 2)))}
          />
        </label>
        <label className="dg-rules-popover-field">
          <span>Snap strength</span>
          <input
            type="number"
            min={1}
            value={snapTolerance}
            onChange={(event) => callbacks?.onSetSnapTolerance?.(Math.max(1, Number(event.target.value || 1)))}
          />
        </label>
      </div>
      <button
        type="button"
        className="dg-settings-item"
        onClick={() => callbacks?.onOpenAddGuides?.()}
      >
        <span className="dg-settings-item-head">
          <PinselaIcon name="Ruler" size={14} />
          <span>Add guides</span>
        </span>
        <PinselaIcon name="ChevronRight" size={14} />
      </button>
    </div>
  );
}

export function AutoLayoutSection({
  callbacks,
  selectedNode,
  selectionCount = 0,
}: {
  callbacks?: LeftPanelCallbacks;
  selectedNode?: PinselaNode | null;
  selectionCount?: number;
}) {
  const canInspectNode = isAutoLayoutHostNode(selectedNode || null);
  const layout = React.useMemo(() => (
    canInspectNode && selectedNode ? normalizeAutoLayout(selectedNode) : DEFAULT_AUTO_LAYOUT
  ), [canInspectNode, selectedNode]);
  const alignCell = React.useMemo(() => alignGridCell(layout), [layout]);

  const patchLayout = (patch: Partial<PinselaNode["layout"]>) => {
    if (!canInspectNode) return;
    callbacks?.onPatchSelectedNode?.({ layout: patch });
  };

  return (
    <div className="dg-panel-section">
      <div className="dg-panel-subtitle">Auto layout</div>
      <div className="dg-panel-inline-hint">
        Draw a container or convert your selection into a container with automatic distribution.
      </div>

      <div className="dg-layer-actions-grid">
        <PillButton tone="primary" size="sm" onClick={() => callbacks?.onActivateCanvasTool?.("auto_layout")}>
          <PinselaIcon name="LayoutTemplate" size={14} style={{ marginRight: 6 }} />
          Draw container
        </PillButton>
        <PillButton
          tone="secondary"
          size="sm"
          onClick={() => callbacks?.onWrapSelectionInAutoLayout?.()}
          disabled={selectionCount < 1}
        >
          Convert selection
        </PillButton>
      </div>

      {!canInspectNode ? (
        <div className="dg-empty-state">
          <div className="dg-empty-state-title">Select a group, frame or rectangle to edit Auto layout.</div>
        </div>
      ) : (
        <>
          <div className="dg-auto-layout-caption">Flow</div>
          <div className="dg-auto-layout-flow">
            <button
              type="button"
              className={`dg-auto-layout-flow-btn ${layout.direction === "none" ? "active" : ""}`}
              onClick={() => patchLayout({ direction: "none", wrap: false, wrap_mode: "flow" })}
              title="No Auto layout"
            >
              <PinselaIcon name="Slash" size={14} />
              <span>Free</span>
            </button>
            <button
              type="button"
              className={`dg-auto-layout-flow-btn ${layout.direction === "vertical" && !layout.wrap ? "active" : ""}`}
              onClick={() => patchLayout({ direction: "vertical", wrap: false, wrap_mode: "flow" })}
              title="Vertical flow"
            >
              <PinselaIcon name="BetweenVerticalStart" size={14} />
              <span>Vertical</span>
            </button>
            <button
              type="button"
              className={`dg-auto-layout-flow-btn ${layout.direction === "horizontal" && !layout.wrap ? "active" : ""}`}
              onClick={() => patchLayout({ direction: "horizontal", wrap: false, wrap_mode: "flow" })}
              title="Horizontal flow"
            >
              <PinselaIcon name="BetweenHorizontalStart" size={14} />
              <span>Horizontal</span>
            </button>
            <button
              type="button"
              className={`dg-auto-layout-flow-btn ${layout.wrap ? "active" : ""}`}
              onClick={() => patchLayout({
                direction: layout.direction === "none" ? "horizontal" : layout.direction,
                wrap: true,
                wrap_mode: layout.wrap_mode || "flow",
              })}
              title="Wrap / Fluid grid"
            >
              <PinselaIcon name="Grid2x2" size={14} />
              <span>Wrap/Grid</span>
            </button>
          </div>

          <div className="dg-auto-layout-size-grid" style={{ marginTop: 8 }}>
            <label className="dg-auto-layout-field">
              <span>Wrap mode</span>
              <select
                value={layout.wrap_mode || "flow"}
                disabled={!layout.wrap}
                onChange={(event) => patchLayout({
                  wrap: true,
                  wrap_mode: event.target.value as "flow" | "grid",
                })}
              >
                <option value="flow">Flow</option>
                <option value="grid">Grid</option>
              </select>
            </label>
            <label className="dg-auto-layout-field">
              <span>Direction</span>
              <select
                value={layout.direction === "none" ? "horizontal" : layout.direction}
                onChange={(event) => patchLayout({ direction: event.target.value as "horizontal" | "vertical" })}
              >
                <option value="horizontal">Horizontal</option>
                <option value="vertical">Vertical</option>
              </select>
            </label>
          </div>

          {layout.wrap && layout.wrap_mode === "grid" && (
            <div className="dg-auto-layout-size-grid" style={{ marginTop: 8 }}>
              <label className="dg-auto-layout-field">
                  <span>Columns</span>
                <input
                  className="dg-input"
                  type="number"
                  min={0}
                  value={Math.max(0, Math.round(layout.grid_columns || 0))}
                  onChange={(event) => patchLayout({
                    grid_columns: Math.max(0, Math.round(Number(event.target.value || 0))),
                  })}
                />
              </label>
              <label className="dg-auto-layout-field">
                  <span>Rows</span>
                <input
                  className="dg-input"
                  type="number"
                  min={0}
                  value={Math.max(0, Math.round(layout.grid_rows || 0))}
                  onChange={(event) => patchLayout({
                    grid_rows: Math.max(0, Math.round(Number(event.target.value || 0))),
                  })}
                />
              </label>
            </div>
          )}

          <div className="dg-auto-layout-caption">Dimensions</div>
          <div className="dg-auto-layout-size-grid">
            <label className="dg-auto-layout-field">
              <span>Width</span>
              <select
                value={layout.sizing_mode}
                onChange={(event) => patchLayout({ sizing_mode: event.target.value as PinselaNode["layout"]["sizing_mode"] })}
              >
                <option value="fixed">Fixed</option>
                <option value="hug">Hug</option>
                <option value="fill">Fill</option>
              </select>
            </label>
            <label className="dg-auto-layout-field">
              <span>Height</span>
              <select
                value={layout.sizing_mode}
                onChange={(event) => patchLayout({ sizing_mode: event.target.value as PinselaNode["layout"]["sizing_mode"] })}
              >
                <option value="fixed">Fixed</option>
                <option value="hug">Hug</option>
                <option value="fill">Fill</option>
              </select>
            </label>
          </div>

          <div className="dg-auto-layout-caption">Alignment</div>
          <div className="dg-auto-layout-align-wrap">
            <div className="dg-auto-layout-align-grid">
              {Array.from({ length: 9 }).map((_, index) => {
                const row = Math.floor(index / 3);
                const col = index % 3;
                const active = alignCell.row === row && alignCell.col === col;
                return (
                  <button
                    key={`auto-align-${row}-${col}`}
                    type="button"
                    className={`dg-auto-layout-align-dot ${active ? "active" : ""}`}
                    onClick={() => patchLayout(layoutPatchFromGridCell(layout, row, col))}
                    title={`Alignment ${row + 1}-${col + 1}`}
                  />
                );
              })}
            </div>

            <label className="dg-auto-layout-field dg-auto-layout-field-tight">
              <span>Spacing</span>
              <select
                value={layout.align_main === "space_between" ? "space_between" : "packed"}
                onChange={(event) => {
                  if (event.target.value === "space_between") {
                    patchLayout({ align_main: "space_between" });
                    return;
                  }
                  patchLayout({
                    align_main: layout.align_main === "space_between" ? "start" : layout.align_main,
                  });
                }}
              >
                <option value="packed">Fixed spacing</option>
                <option value="space_between">Space between</option>
              </select>
            </label>
          </div>

          <div className="dg-inspector-row">
            <label className="dg-layer-prop-field">
              <span>Gap</span>
              <input
                type="number"
                value={Math.max(0, Math.round(layout.gap || 0))}
                onChange={(event) => patchLayout({ gap: Math.max(0, Math.round(Number(event.target.value || 0))) })}
              />
            </label>
            <label className="dg-layer-prop-field">
              <span>Padding H</span>
              <input
                type="number"
                value={Math.round((Number(layout.padding_left || 0) + Number(layout.padding_right || 0)) / 2)}
                onChange={(event) => {
                  const value = Math.max(0, Math.round(Number(event.target.value || 0)));
                  patchLayout({ padding_left: value, padding_right: value });
                }}
              />
            </label>
            <label className="dg-layer-prop-field">
              <span>Padding V</span>
              <input
                type="number"
                value={Math.round((Number(layout.padding_top || 0) + Number(layout.padding_bottom || 0)) / 2)}
                onChange={(event) => {
                  const value = Math.max(0, Math.round(Number(event.target.value || 0)));
                  patchLayout({ padding_top: value, padding_bottom: value });
                }}
              />
            </label>
          </div>

          <label className="dg-auto-layout-check">
            <input
              type="checkbox"
              checked={Boolean(selectedNode?.geometry.clip)}
              onChange={(event) => callbacks?.onPatchSelectedNode?.({ clip: event.target.checked })}
            />
            <span>Clip content</span>
          </label>
        </>
      )}
    </div>
  );
}

const EFFECT_TYPE_OPTIONS: Array<{ type: PinselaLayerEffectType; label: string }> = [
  { type: "inner_shadow", label: "Inner shadow" },
  { type: "drop_shadow", label: "Drop shadow" },
  { type: "layer_blur", label: "Layer blur" },
  { type: "background_blur", label: "Background blur" },
  { type: "noise", label: "Noise" },
  { type: "texture", label: "Texture" },
  { type: "glass", label: "Glass" },
];

function effectId(): string {
  return `fx_${Math.random().toString(36).slice(2, 10)}`;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, Math.round(num)));
}

function clampFloat(value: unknown, fallback: number, min: number, max: number): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, num));
}

function asHexColor(value: unknown, fallback = "#000000"): string {
  const raw = String(value || "").trim();
  if (/^#([a-f0-9]{3}|[a-f0-9]{6})$/i.test(raw)) {
    if (raw.length === 4) {
      const r = raw[1];
      const g = raw[2];
      const b = raw[3];
      return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
    }
    return raw.toLowerCase();
  }
  const rgb = raw.match(/^rgba?\(([^)]+)\)$/i);
  if (rgb) {
    const parts = rgb[1].split(",").map((part) => Number(part.trim()));
    if (parts.length >= 3 && parts.slice(0, 3).every(Number.isFinite)) {
      const toHex = (num: number) => Math.max(0, Math.min(255, Math.round(num))).toString(16).padStart(2, "0");
      return `#${toHex(parts[0])}${toHex(parts[1])}${toHex(parts[2])}`;
    }
  }
  return fallback;
}

function defaultLayerEffect(type: PinselaLayerEffectType, seed?: Partial<PinselaLayerEffect>): PinselaLayerEffect {
  const base: PinselaLayerEffect = {
    id: seed?.id || effectId(),
    type,
    enabled: seed?.enabled ?? true,
    visible: seed?.visible ?? true,
  };
  if (type === "drop_shadow" || type === "inner_shadow") {
    return {
      ...base,
      x: 0,
      y: 8,
      blur: 16,
      spread: 0,
      color: "#000000",
      opacity: 30,
      show_behind_transparent: false,
    };
  }
  if (type === "layer_blur" || type === "background_blur") {
    return {
      ...base,
      radius: 12,
      opacity: 100,
    };
  }
  if (type === "noise") {
    return {
      ...base,
      amount: 24,
      scale: 2,
      opacity: 45,
      color: "#9ca3af",
    };
  }
  if (type === "texture") {
    return {
      ...base,
      amount: 32,
      scale: 6,
      opacity: 36,
      color: "#94a3b8",
    };
  }
  return {
    ...base,
    blur: 18,
    saturation: 120,
    tint: "#dbeafe",
    opacity: 24,
    noise: 14,
  };
}

function normalizeLayerEffect(raw: unknown, index: number): PinselaLayerEffect {
  const effect = raw && typeof raw === "object" ? (raw as Partial<PinselaLayerEffect>) : {};
  const typeRaw = String(effect.type || "").trim().toLowerCase();
  const type = EFFECT_TYPE_OPTIONS.some((entry) => entry.type === typeRaw)
    ? (typeRaw as PinselaLayerEffectType)
    : "drop_shadow";
  const seeded = defaultLayerEffect(type, effect);
  const normalized: PinselaLayerEffect = {
    ...seeded,
    id: String(effect.id || seeded.id || `fx_${index}`),
    type,
    enabled: effect.enabled ?? seeded.enabled,
    visible: effect.visible ?? seeded.visible,
  };

  if (type === "drop_shadow" || type === "inner_shadow") {
    normalized.x = clampInt(effect.x ?? seeded.x, Number(seeded.x || 0), -2000, 2000);
    normalized.y = clampInt(effect.y ?? seeded.y, Number(seeded.y || 0), -2000, 2000);
    normalized.blur = clampFloat(effect.blur ?? seeded.blur, Number(seeded.blur || 0), 0, 600);
    normalized.spread = clampFloat(effect.spread ?? seeded.spread, Number(seeded.spread || 0), -200, 200);
    normalized.opacity = clampInt(effect.opacity ?? seeded.opacity, Number(seeded.opacity || 100), 0, 100);
    normalized.color = effect.color ?? seeded.color;
    normalized.show_behind_transparent = Boolean(effect.show_behind_transparent ?? seeded.show_behind_transparent);
    return normalized;
  }

  if (type === "layer_blur" || type === "background_blur") {
    normalized.radius = clampFloat(effect.radius ?? seeded.radius, Number(seeded.radius || 0), 0, 600);
    normalized.opacity = clampInt(effect.opacity ?? seeded.opacity, Number(seeded.opacity || 100), 0, 100);
    return normalized;
  }

  if (type === "noise" || type === "texture") {
    normalized.amount = clampInt(effect.amount ?? seeded.amount, Number(seeded.amount || 0), 0, 100);
    normalized.scale = clampFloat(effect.scale ?? seeded.scale, Number(seeded.scale || 1), 0.25, 80);
    normalized.opacity = clampInt(effect.opacity ?? seeded.opacity, Number(seeded.opacity || 100), 0, 100);
    normalized.color = effect.color ?? seeded.color;
    return normalized;
  }

  normalized.blur = clampFloat(effect.blur ?? seeded.blur, Number(seeded.blur || 0), 0, 600);
  normalized.saturation = clampInt(effect.saturation ?? seeded.saturation, Number(seeded.saturation || 100), 0, 300);
  normalized.tint = effect.tint ?? seeded.tint;
  normalized.opacity = clampInt(effect.opacity ?? seeded.opacity, Number(seeded.opacity || 100), 0, 100);
  normalized.noise = clampInt(effect.noise ?? seeded.noise, Number(seeded.noise || 0), 0, 100);
  return normalized;
}

export function EffectsSection({
  callbacks,
  selectedNode,
}: {
  callbacks?: LeftPanelCallbacks;
  selectedNode?: PinselaNode | null;
}) {
  const effectItems = React.useMemo<PinselaLayerEffect[]>(() => {
    const raw = Array.isArray(selectedNode?.style?.effects) ? selectedNode?.style?.effects : [];
    return raw.map((entry, index) => normalizeLayerEffect(entry, index));
  }, [selectedNode?.id, selectedNode?.style?.effects]);
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const [draggingId, setDraggingId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!effectItems.length) {
      setExpandedId(null);
      return;
    }
    if (!expandedId || !effectItems.some((entry) => entry.id === expandedId)) {
      setExpandedId(effectItems[0].id);
    }
  }, [effectItems, expandedId]);

  const commitEffects = React.useCallback((nextItems: PinselaLayerEffect[]) => {
    callbacks?.onSetSelectedEffects?.(nextItems.map((entry, index) => normalizeLayerEffect(entry, index)));
  }, [callbacks]);

  const updateEffect = React.useCallback((effectIdValue: string, patch: Partial<PinselaLayerEffect>) => {
    const next = effectItems.map((entry) => (
      entry.id === effectIdValue ? normalizeLayerEffect({ ...entry, ...patch }, 0) : entry
    ));
    commitEffects(next);
  }, [commitEffects, effectItems]);

  const removeEffect = React.useCallback((effectIdValue: string) => {
    const next = effectItems.filter((entry) => entry.id !== effectIdValue);
    commitEffects(next);
    setExpandedId((current) => (current === effectIdValue ? next[0]?.id || null : current));
  }, [commitEffects, effectItems]);

  const addEffect = React.useCallback(() => {
    const nextEffect = defaultLayerEffect("drop_shadow");
    commitEffects([...effectItems, nextEffect]);
    setExpandedId(nextEffect.id);
  }, [commitEffects, effectItems]);

  const reorderEffects = React.useCallback((sourceId: string, targetId: string) => {
    if (!sourceId || !targetId || sourceId === targetId) return;
    const sourceIndex = effectItems.findIndex((entry) => entry.id === sourceId);
    const targetIndex = effectItems.findIndex((entry) => entry.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const next = [...effectItems];
    const [moving] = next.splice(sourceIndex, 1);
    next.splice(targetIndex, 0, moving);
    commitEffects(next);
  }, [commitEffects, effectItems]);

  if (!selectedNode) {
    return (
      <div className="dg-panel-section">
        <div className="dg-panel-subtitle">Effects</div>
        <div className="dg-empty-state">
          <div className="dg-empty-state-title">Select a layer to edit effects.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="dg-panel-section">
      <div className="dg-panel-subtitle">Effects</div>
      <div className="dg-panel-inline-hint">
        Effects stack per layer. Add, reorder, toggle and combine multiple effects.
      </div>

      <div className="dg-layer-actions-grid">
        <PillButton tone="primary" size="sm" onClick={addEffect}>
          <PinselaIcon name="Plus" size={14} style={{ marginRight: 6 }} />
          Add effect
        </PillButton>
      </div>

      <div className="dg-effects-list">
        {effectItems.length > 0 ? effectItems.map((effect) => {
          const effectTypeLabel = EFFECT_TYPE_OPTIONS.find((entry) => entry.type === effect.type)?.label || effect.type;
          const expanded = expandedId === effect.id;
          return (
            <div
              key={effect.id}
              className={`dg-effects-item ${expanded ? "is-open" : ""}`}
              draggable
              onDragStart={() => setDraggingId(effect.id)}
              onDragEnd={() => setDraggingId(null)}
              onDragOver={(event) => {
                if (!draggingId || draggingId === effect.id) return;
                event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (!draggingId) return;
                reorderEffects(draggingId, effect.id);
                setDraggingId(null);
              }}
            >
              <div className="dg-effects-row">
                <span className="dg-effects-handle" title="Drag to reorder">
                  <PinselaIcon name="GripVertical" size={14} />
                </span>
                <input
                  type="checkbox"
                  checked={effect.enabled !== false}
                  onChange={(event) => updateEffect(effect.id, { enabled: event.target.checked })}
                  title="Enable/disable"
                />
                <select
                  className="dg-effects-type"
                  value={effect.type}
                  onChange={(event) => {
                    const type = event.target.value as PinselaLayerEffectType;
                    const next = defaultLayerEffect(type, {
                      id: effect.id,
                      enabled: effect.enabled,
                      visible: effect.visible,
                    });
                    updateEffect(effect.id, next);
                  }}
                >
                  {EFFECT_TYPE_OPTIONS.map((option) => (
                    <option key={option.type} value={option.type}>{option.label}</option>
                  ))}
                </select>
                <IconButton
                  size="sm"
                  icon={<PinselaIcon name={effect.visible === false ? "EyeOff" : "Eye"} size={14} />}
                  onClick={() => updateEffect(effect.id, { visible: effect.visible === false })}
                  title={effect.visible === false ? "Show effect" : "Hide effect"}
                />
                <IconButton
                  size="sm"
                  icon={<PinselaIcon name={expanded ? "ChevronDown" : "ChevronRight"} size={14} />}
                  onClick={() => setExpandedId((current) => (current === effect.id ? null : effect.id))}
                  title={expanded ? "Collapse" : "Expand"}
                />
                <IconButton
                  size="sm"
                  icon={<PinselaIcon name="Trash2" size={14} />}
                  onClick={() => removeEffect(effect.id)}
                  title="Remove"
                />
              </div>

              {expanded && (
                <div className="dg-effects-body">
                  <div className="dg-panel-inline-hint">{effectTypeLabel}</div>

                  {(effect.type === "drop_shadow" || effect.type === "inner_shadow") && (
                    <>
                      <div className="dg-inspector-row">
                        <label className="dg-layer-prop-field">
                          <span>X</span>
                          <input
                            type="number"
                            value={Math.round(Number(effect.x || 0))}
                            onChange={(event) => updateEffect(effect.id, { x: Number(event.target.value || 0) })}
                          />
                        </label>
                        <label className="dg-layer-prop-field">
                          <span>Y</span>
                          <input
                            type="number"
                            value={Math.round(Number(effect.y || 0))}
                            onChange={(event) => updateEffect(effect.id, { y: Number(event.target.value || 0) })}
                          />
                        </label>
                      </div>
                      <div className="dg-inspector-row">
                        <label className="dg-layer-prop-field">
                          <span>Blur</span>
                          <input
                            type="number"
                            min={0}
                            value={Math.round(Number(effect.blur || 0))}
                            onChange={(event) => updateEffect(effect.id, { blur: Number(event.target.value || 0) })}
                          />
                        </label>
                        <label className="dg-layer-prop-field">
                          <span>Spread</span>
                          <input
                            type="number"
                            value={Math.round(Number(effect.spread || 0))}
                            onChange={(event) => updateEffect(effect.id, { spread: Number(event.target.value || 0) })}
                          />
                        </label>
                        <label className="dg-layer-prop-field">
                          <span>Opacity %</span>
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={Math.round(Number(effect.opacity ?? 100))}
                            onChange={(event) => updateEffect(effect.id, { opacity: Number(event.target.value || 0) })}
                          />
                        </label>
                      </div>
                      <div className="dg-inspector-row">
                        <label className="dg-layer-prop-field">
                          <span>Color</span>
                          <input
                            type="color"
                            value={asHexColor(effect.color, "#000000")}
                            onChange={(event) => updateEffect(effect.id, { color: event.target.value })}
                          />
                        </label>
                        {effect.type === "drop_shadow" && (
                          <label className="dg-auto-layout-check">
                            <input
                              type="checkbox"
                              checked={Boolean(effect.show_behind_transparent)}
                              onChange={(event) => updateEffect(effect.id, { show_behind_transparent: event.target.checked })}
                            />
                            <span>Show behind transparent areas</span>
                          </label>
                        )}
                      </div>
                    </>
                  )}

                  {(effect.type === "layer_blur" || effect.type === "background_blur") && (
                    <div className="dg-inspector-row">
                      <label className="dg-layer-prop-field">
                        <span>Radius</span>
                        <input
                          type="number"
                          min={0}
                          value={Math.round(Number(effect.radius || 0))}
                          onChange={(event) => updateEffect(effect.id, { radius: Number(event.target.value || 0) })}
                        />
                      </label>
                      <label className="dg-layer-prop-field">
                        <span>Opacity %</span>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={Math.round(Number(effect.opacity ?? 100))}
                          onChange={(event) => updateEffect(effect.id, { opacity: Number(event.target.value || 0) })}
                        />
                      </label>
                    </div>
                  )}

                  {effect.type === "noise" && (
                    <div className="dg-inspector-row">
                      <label className="dg-layer-prop-field">
                        <span>Intensity %</span>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={Math.round(Number(effect.amount || 0))}
                          onChange={(event) => updateEffect(effect.id, { amount: Number(event.target.value || 0) })}
                        />
                      </label>
                      <label className="dg-layer-prop-field">
                        <span>Scale</span>
                        <input
                          type="number"
                          min={0.25}
                          max={80}
                          step={0.25}
                          value={Number(effect.scale || 1)}
                          onChange={(event) => updateEffect(effect.id, { scale: Number(event.target.value || 1) })}
                        />
                      </label>
                      <label className="dg-layer-prop-field">
                        <span>Opacity %</span>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={Math.round(Number(effect.opacity ?? 100))}
                          onChange={(event) => updateEffect(effect.id, { opacity: Number(event.target.value || 0) })}
                        />
                      </label>
                    </div>
                  )}

                  {effect.type === "texture" && (
                    <div className="dg-inspector-row">
                      <label className="dg-layer-prop-field">
                        <span>Intensity %</span>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={Math.round(Number(effect.amount || 0))}
                          onChange={(event) => updateEffect(effect.id, { amount: Number(event.target.value || 0) })}
                        />
                      </label>
                      <label className="dg-layer-prop-field">
                        <span>Scale</span>
                        <input
                          type="number"
                          min={0.25}
                          max={80}
                          step={0.25}
                          value={Number(effect.scale || 1)}
                          onChange={(event) => updateEffect(effect.id, { scale: Number(event.target.value || 1) })}
                        />
                      </label>
                      <label className="dg-layer-prop-field">
                        <span>Opacity %</span>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={Math.round(Number(effect.opacity ?? 100))}
                          onChange={(event) => updateEffect(effect.id, { opacity: Number(event.target.value || 0) })}
                        />
                      </label>
                    </div>
                  )}

                  {effect.type === "glass" && (
                    <>
                      <div className="dg-inspector-row">
                        <label className="dg-layer-prop-field">
                          <span>Blur</span>
                          <input
                            type="number"
                            min={0}
                            value={Math.round(Number(effect.blur || 0))}
                            onChange={(event) => updateEffect(effect.id, { blur: Number(event.target.value || 0) })}
                          />
                        </label>
                        <label className="dg-layer-prop-field">
                          <span>Saturation %</span>
                          <input
                            type="number"
                            min={0}
                            max={300}
                            value={Math.round(Number(effect.saturation || 100))}
                            onChange={(event) => updateEffect(effect.id, { saturation: Number(event.target.value || 100) })}
                          />
                        </label>
                        <label className="dg-layer-prop-field">
                          <span>Opacity %</span>
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={Math.round(Number(effect.opacity ?? 100))}
                            onChange={(event) => updateEffect(effect.id, { opacity: Number(event.target.value || 0) })}
                          />
                        </label>
                      </div>
                      <div className="dg-inspector-row">
                        <label className="dg-layer-prop-field">
                          <span>Tint</span>
                          <input
                            type="color"
                            value={asHexColor(effect.tint, "#dbeafe")}
                            onChange={(event) => updateEffect(effect.id, { tint: event.target.value })}
                          />
                        </label>
                        <label className="dg-layer-prop-field">
                          <span>Noise %</span>
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={Math.round(Number(effect.noise || 0))}
                            onChange={(event) => updateEffect(effect.id, { noise: Number(event.target.value || 0) })}
                          />
                        </label>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        }) : (
          <div className="dg-empty-state">
            <div className="dg-empty-state-title">No effects on this layer.</div>
          </div>
        )}
      </div>
    </div>
  );
}

type StrokeAdvancedTab = "basic" | "dynamic" | "brush";

function strokeColorFallback(node: PinselaNode | null | undefined): unknown {
  if (!node) return "#0f172a";
  if (node.kind === "text") {
    return (node.text_style as Record<string, unknown> | undefined)?.color ?? node.style?.fill ?? "#0f172a";
  }
  if (node.kind === "line") {
    const rawStroke = node.style?.stroke && typeof node.style.stroke === "object"
      ? (node.style.stroke as Record<string, unknown>)
      : null;
    return rawStroke?.color ?? node.style?.fill ?? "#8b6d52";
  }
  if (Array.isArray((node.style as Record<string, unknown>)?.strokes)) {
    const first = (node.style as Record<string, unknown>).strokes as unknown[];
    const firstColor = first.find((entry) => entry && typeof entry === "object" && (entry as Record<string, unknown>).color != null) as Record<string, unknown> | undefined;
    if (firstColor?.color != null) return firstColor.color;
  }
  if (node.style?.stroke && typeof node.style.stroke === "object") {
    const strokeObj = node.style.stroke as Record<string, unknown>;
    if (strokeObj.color != null) return strokeObj.color;
  }
  return node.style?.fill ?? "#0f172a";
}

function widthProfileLabel(profile: PinselaStrokeStackItem["width_profile"]): string {
  if (profile === "taper_start") return "Taper start";
  if (profile === "taper_end") return "Taper end";
  if (profile === "taper_both") return "Taper both";
  return "Uniform";
}

export function StrokeSection({
  callbacks,
  selectedNode,
}: {
  callbacks?: LeftPanelCallbacks;
  selectedNode?: PinselaNode | null;
}) {
  const strokeItems = React.useMemo<PinselaStrokeStackItem[]>(() => (
    normalizeStrokeStackFromNode(selectedNode as unknown as {
      kind?: unknown;
      style?: Record<string, unknown>;
      text_style?: Record<string, unknown>;
    })
  ), [selectedNode?.id, selectedNode?.style?.stroke, selectedNode?.style?.strokes, selectedNode?.text_style?.color, selectedNode?.style?.fill]);

  const [selectedStrokeId, setSelectedStrokeId] = React.useState<string | null>(null);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [extrasOpen, setExtrasOpen] = React.useState(false);
  const [advancedStrokeId, setAdvancedStrokeId] = React.useState<string | null>(null);
  const [advancedTab, setAdvancedTab] = React.useState<StrokeAdvancedTab>("basic");
  const [hexDraftByStrokeId, setHexDraftByStrokeId] = React.useState<Record<string, string>>({});
  const [draggingStrokeId, setDraggingStrokeId] = React.useState<string | null>(null);
  const [dragOverStrokeId, setDragOverStrokeId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!strokeItems.length) {
      setSelectedStrokeId(null);
      setAdvancedStrokeId(null);
      setExtrasOpen(false);
      return;
    }
    if (!selectedStrokeId || !strokeItems.some((entry) => entry.id === selectedStrokeId)) {
      setSelectedStrokeId(strokeItems[0].id);
    }
  }, [strokeItems, selectedStrokeId]);

  React.useEffect(() => {
    if (!strokeItems.length) {
      setHexDraftByStrokeId({});
      return;
    }
    setHexDraftByStrokeId(() => {
      const next: Record<string, string> = {};
      for (const entry of strokeItems) {
        next[entry.id] = asHexColor(entry.color, "#0f172a");
      }
      return next;
    });
  }, [strokeItems]);

  const selectedStroke = strokeItems.find((entry) => entry.id === selectedStrokeId) || null;
  const advancedStroke = strokeItems.find((entry) => entry.id === advancedStrokeId) || null;

  const commitStrokes = React.useCallback((nextItems: PinselaStrokeStackItem[]) => {
    callbacks?.onSetSelectedStrokes?.(nextItems.map((entry, index) => normalizeStrokeStackItem(entry, index)));
  }, [callbacks]);

  const updateStroke = React.useCallback((strokeIdValue: string, patch: Partial<PinselaStrokeStackItem>) => {
    const next = strokeItems.map((entry, index) => (
      entry.id === strokeIdValue ? normalizeStrokeStackItem({ ...entry, ...patch }, index) : entry
    ));
    commitStrokes(next);
  }, [commitStrokes, strokeItems]);

  const removeStroke = React.useCallback((strokeIdValue: string) => {
    const next = strokeItems.filter((entry) => entry.id !== strokeIdValue);
    commitStrokes(next);
    setSelectedStrokeId((current) => (current === strokeIdValue ? next[0]?.id || null : current));
    setAdvancedStrokeId((current) => (current === strokeIdValue ? null : current));
    setHexDraftByStrokeId((prev) => {
      if (!(strokeIdValue in prev)) return prev;
      const { [strokeIdValue]: _, ...rest } = prev;
      return rest;
    });
  }, [commitStrokes, strokeItems]);

  const addStroke = React.useCallback(() => {
    const nextStroke = defaultStrokeStackItem({
      id: undefined,
      color: strokeColorFallback(selectedNode || null),
      weight: selectedNode?.kind === "line" ? 4 : selectedNode?.kind === "text" ? 1.2 : 2,
      align: selectedNode?.kind === "line" ? "center" : "inside",
      style: "solid",
      opacity: 100,
    });
    const next = [...strokeItems, nextStroke];
    commitStrokes(next);
    setSelectedStrokeId(nextStroke.id);
  }, [commitStrokes, strokeItems, selectedNode]);

  const duplicateSelectedStroke = React.useCallback(() => {
    if (!selectedStroke) return;
    const duplicated = defaultStrokeStackItem({
      ...selectedStroke,
      id: undefined,
    });
    const next = [...strokeItems, duplicated];
    commitStrokes(next);
    setSelectedStrokeId(duplicated.id);
    setMenuOpen(false);
  }, [commitStrokes, selectedStroke, strokeItems]);

  const moveStroke = React.useCallback((strokeIdValue: string, direction: -1 | 1) => {
    const index = strokeItems.findIndex((entry) => entry.id === strokeIdValue);
    if (index < 0) return;
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= strokeItems.length) return;
    const next = [...strokeItems];
    const [moved] = next.splice(index, 1);
    next.splice(targetIndex, 0, moved);
    commitStrokes(next);
    setSelectedStrokeId(moved.id);
  }, [commitStrokes, strokeItems]);

  const reorderStrokes = React.useCallback((sourceId: string, targetId: string) => {
    if (!sourceId || !targetId || sourceId === targetId) return;
    const sourceIndex = strokeItems.findIndex((entry) => entry.id === sourceId);
    const targetIndex = strokeItems.findIndex((entry) => entry.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const next = [...strokeItems];
    const [moving] = next.splice(sourceIndex, 1);
    next.splice(targetIndex, 0, moving);
    commitStrokes(next);
    setSelectedStrokeId(moving.id);
  }, [commitStrokes, strokeItems]);

  const commitStrokeHexDraft = React.useCallback((strokeIdValue: string) => {
    const entry = strokeItems.find((candidate) => candidate.id === strokeIdValue);
    if (!entry) return;
    const fallbackHex = asHexColor(entry.color, "#0f172a");
    const draftRaw = String(hexDraftByStrokeId[strokeIdValue] ?? fallbackHex).trim();
    const isValid = /^#([a-fA-F0-9]{3}|[a-fA-F0-9]{6})$/.test(draftRaw);
    if (!isValid) {
      setHexDraftByStrokeId((prev) => ({ ...prev, [strokeIdValue]: fallbackHex }));
      return;
    }
    const normalizedHex = asHexColor(draftRaw, fallbackHex);
    setHexDraftByStrokeId((prev) => ({ ...prev, [strokeIdValue]: normalizedHex }));
    if (normalizedHex.toLowerCase() !== fallbackHex.toLowerCase()) {
      updateStroke(strokeIdValue, { color: normalizedHex });
    }
  }, [hexDraftByStrokeId, strokeItems, updateStroke]);

  if (!selectedNode) {
    return (
      <div className="dg-panel-section">
        <div className="dg-panel-subtitle">Stroke</div>
        <div className="dg-empty-state">
          <div className="dg-empty-state-title">Select a layer to edit strokes.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="dg-panel-section">
      <div className="dg-stroke-head">
        <div className="dg-panel-subtitle">Stroke</div>
        <div className="dg-stroke-head-actions">
          <IconButton
            size="sm"
            icon={<PinselaIcon name="Plus" size={14} />}
            onClick={addStroke}
            title="Add stroke"
          />
          <IconButton
            size="sm"
            icon={<PinselaIcon name="MoreHorizontal" size={14} />}
            onClick={() => setMenuOpen((prev) => !prev)}
            title="Stroke options"
            active={menuOpen}
          />
        </div>
      </div>
      {menuOpen ? (
        <div className="dg-stroke-menu">
          <button type="button" className="dg-stroke-menu-item" disabled={!selectedStroke} onClick={duplicateSelectedStroke}>
            Duplicate selected stroke
          </button>
          <button
            type="button"
            className="dg-stroke-menu-item"
            disabled={strokeItems.length === 0}
            onClick={() => {
              commitStrokes([]);
              setMenuOpen(false);
              setSelectedStrokeId(null);
              setAdvancedStrokeId(null);
            }}
          >
            Remove all strokes
          </button>
        </div>
      ) : null}

      <div className="dg-panel-inline-hint">
        Stackable list per layer: each item keeps its own color, opacity, alignment, weight and advanced settings.
      </div>

      <div className="dg-stroke-list">
        {strokeItems.length > 0 ? strokeItems.map((entry, index) => {
          const selected = entry.id === selectedStrokeId;
          const colorValue = asHexColor(entry.color, "#0f172a");
          const opacity = Math.max(0, Math.min(100, Math.round(Number(entry.opacity ?? 100))));
          return (
            <div
              key={entry.id}
              className={`dg-stroke-item ${selected ? "is-selected" : ""} ${dragOverStrokeId === entry.id ? "is-drop-target" : ""}`}
              onDragOver={(event) => {
                if (!draggingStrokeId || draggingStrokeId === entry.id) return;
                event.preventDefault();
                if (dragOverStrokeId !== entry.id) setDragOverStrokeId(entry.id);
              }}
              onDragLeave={() => {
                if (dragOverStrokeId === entry.id) setDragOverStrokeId(null);
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (!draggingStrokeId) return;
                reorderStrokes(draggingStrokeId, entry.id);
                setDraggingStrokeId(null);
                setDragOverStrokeId(null);
              }}
              onClick={() => setSelectedStrokeId(entry.id)}
            >
              <div className="dg-stroke-row">
                <div className="dg-stroke-label">Stroke {index + 1}</div>
                <div className="dg-stroke-row-actions">
                  <span
                    className="dg-stroke-handle"
                    title="Drag to reorder"
                    draggable
                    onClick={(event) => event.stopPropagation()}
                    onDragStart={(event) => {
                      event.stopPropagation();
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", entry.id);
                      setDraggingStrokeId(entry.id);
                    }}
                    onDragEnd={(event) => {
                      event.stopPropagation();
                      setDraggingStrokeId(null);
                      setDragOverStrokeId(null);
                    }}
                  >
                    <PinselaIcon name="GripVertical" size={14} />
                  </span>
                  <label
                    className="dg-stroke-enabled-toggle"
                    title={entry.enabled === false ? "Enable stroke" : "Disable stroke"}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={entry.enabled !== false}
                      onChange={(event) => updateStroke(entry.id, { enabled: event.target.checked })}
                    />
                    <span>Active</span>
                  </label>
                  <IconButton
                    size="sm"
                    icon={<PinselaIcon name="ChevronUp" size={14} />}
                    onClick={(event) => {
                      event.stopPropagation();
                      moveStroke(entry.id, -1);
                    }}
                    disabled={index === 0}
                    title="Move up"
                  />
                  <IconButton
                    size="sm"
                    icon={<PinselaIcon name="ChevronDown" size={14} />}
                    onClick={(event) => {
                      event.stopPropagation();
                      moveStroke(entry.id, 1);
                    }}
                    disabled={index === strokeItems.length - 1}
                    title="Move down"
                  />
                  <IconButton
                    size="sm"
                    icon={<PinselaIcon name={entry.visible === false ? "EyeOff" : "Eye"} size={14} />}
                    onClick={(event) => {
                      event.stopPropagation();
                      updateStroke(entry.id, { visible: entry.visible === false });
                    }}
                    title={entry.visible === false ? "Show stroke" : "Hide stroke"}
                  />
                  <IconButton
                    size="sm"
                    icon={<PinselaIcon name="Minus" size={14} />}
                    onClick={(event) => {
                      event.stopPropagation();
                      removeStroke(entry.id);
                    }}
                    title="Remove stroke"
                  />
                </div>
              </div>

              <div className="dg-stroke-row">
                <label className="dg-stroke-color-field">
                  <span>Color</span>
                  <input
                    type="color"
                    value={colorValue}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => updateStroke(entry.id, { color: event.target.value })}
                  />
                </label>
                <label className="dg-stroke-hex-field">
                  <span>Hex</span>
                  <input
                    type="text"
                    value={hexDraftByStrokeId[entry.id] ?? colorValue}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => setHexDraftByStrokeId((prev) => ({ ...prev, [entry.id]: event.target.value }))}
                    onBlur={() => commitStrokeHexDraft(entry.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        commitStrokeHexDraft(entry.id);
                      }
                    }}
                  />
                </label>
                <label className="dg-stroke-opacity-field">
                  <span>Opacity %</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={opacity}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => updateStroke(entry.id, { opacity: Number(event.target.value || 0) })}
                  />
                </label>
              </div>
            </div>
          );
        }) : (
          <div className="dg-empty-state">
            <div className="dg-empty-state-title">No strokes on this layer.</div>
            <PillButton tone="primary" size="sm" onClick={addStroke}>Add first stroke</PillButton>
          </div>
        )}
      </div>

      {selectedStroke ? (
        <>
          <div className="dg-divider" />
          <div className="dg-layer-actions-grid">
            <label className="dg-layer-prop-field">
              <span>Alignment</span>
              <select
                className="dg-input"
                value={selectedStroke.align || "center"}
                onChange={(event) => updateStroke(selectedStroke.id, { align: event.target.value as any })}
              >
                <option value="inside">Inside</option>
                <option value="center">Center</option>
                <option value="outside">Outside</option>
              </select>
            </label>
            <label className="dg-layer-prop-field">
              <span>Weight</span>
              <input
                type="number"
                min={0}
                step={0.1}
                value={Math.max(0, Number(selectedStroke.weight || 0))}
                onChange={(event) => updateStroke(selectedStroke.id, { weight: Number(event.target.value || 0) })}
              />
            </label>
          </div>

          <div className="dg-stroke-cta-row">
            <PillButton
              tone="secondary"
              size="sm"
              onClick={() => {
                setAdvancedStrokeId(selectedStroke.id);
                const nextTab = (selectedStroke.mode || "basic") as StrokeAdvancedTab;
                setAdvancedTab(nextTab);
                updateStroke(selectedStroke.id, { mode: nextTab });
              }}
            >
              <PinselaIcon name="SlidersHorizontal" size={14} style={{ marginRight: 6 }} />
              Stroke settings
            </PillButton>
            <IconButton
              size="sm"
              icon={<PinselaIcon name="PanelTopDashed" size={14} />}
              title="Extra controls"
              active={extrasOpen}
              onClick={() => setExtrasOpen((prev) => !prev)}
            />
          </div>

          {extrasOpen ? (
            <div className="dg-stroke-extras">
              <div className="dg-stroke-extra-title">Apply per side</div>
              <div className="dg-stroke-side-grid">
                {([
                  ["top", "Top"],
                  ["right", "Right"],
                  ["bottom", "Bottom"],
                  ["left", "Left"],
                ] as const).map(([side, label]) => (
                  <label key={side} className="dg-auto-layout-check">
                    <input
                      type="checkbox"
                      checked={selectedStroke.sides?.[side] !== false}
                      onChange={(event) => updateStroke(selectedStroke.id, {
                        sides: {
                          ...(selectedStroke.sides || {}),
                          [side]: event.target.checked,
                        },
                      })}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
              <div className="dg-layer-actions-grid">
                <PillButton
                  tone="neutral"
                  size="sm"
                  onClick={() => updateStroke(selectedStroke.id, {
                    sides: { top: true, right: true, bottom: true, left: true },
                  })}
                >
                  All borders
                </PillButton>
                <PillButton
                  tone="neutral"
                  size="sm"
                  onClick={() => updateStroke(selectedStroke.id, {
                    sides: { top: true, right: false, bottom: true, left: false },
                  })}
                >
                  Horizontal only
                </PillButton>
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      {advancedStroke ? (
        <div className="dg-stroke-advanced-overlay" onClick={() => setAdvancedStrokeId(null)}>
          <div className="dg-stroke-advanced-panel" onClick={(event) => event.stopPropagation()}>
            <div className="dg-stroke-advanced-head">
              <strong>Stroke settings</strong>
              <IconButton
                size="sm"
                icon={<PinselaIcon name="X" size={14} />}
                onClick={() => setAdvancedStrokeId(null)}
                title="Close"
              />
            </div>
            <div className="dg-stroke-advanced-tabs">
              {([
                ["basic", "Basic"],
                ["dynamic", "Dynamic"],
                ["brush", "Brush"],
              ] as const).map(([tabId, label]) => (
                <ChipTab
                  key={tabId}
                  active={advancedTab === tabId}
                  onClick={() => {
                    setAdvancedTab(tabId);
                    updateStroke(advancedStroke.id, { mode: tabId });
                  }}
                >
                  {label}
                </ChipTab>
              ))}
            </div>

            {advancedTab === "basic" ? (
              <div className="dg-stroke-advanced-body">
                <label className="dg-layer-prop-field">
                  <span>Style</span>
                  <select
                    className="dg-input"
                    value={advancedStroke.style || "solid"}
                    onChange={(event) => updateStroke(advancedStroke.id, { style: event.target.value as any })}
                  >
                    <option value="solid">Solid</option>
                    <option value="dash">Dashed</option>
                    <option value="long_dash">Long dashed</option>
                    <option value="dotted">Dotted</option>
                  </select>
                </label>

                <div className="dg-stroke-profile-block">
                  <div className="dg-stroke-profile-caption">Width profile</div>
                  <div className={`dg-stroke-profile-preview ${(advancedStroke.width_profile || "uniform")} ${advancedStroke.width_profile_flip ? "flip" : ""}`} />
                  <div className="dg-stroke-profile-controls">
                    <select
                      className="dg-input"
                      value={advancedStroke.width_profile || "uniform"}
                      onChange={(event) => updateStroke(advancedStroke.id, { width_profile: event.target.value as any })}
                    >
                      <option value="uniform">{widthProfileLabel("uniform")}</option>
                      <option value="taper_start">{widthProfileLabel("taper_start")}</option>
                      <option value="taper_end">{widthProfileLabel("taper_end")}</option>
                      <option value="taper_both">{widthProfileLabel("taper_both")}</option>
                    </select>
                    <IconButton
                      size="sm"
                      icon={<PinselaIcon name="FlipHorizontal2" size={14} />}
                      title="Flip profile"
                      onClick={() => updateStroke(advancedStroke.id, { width_profile_flip: !advancedStroke.width_profile_flip })}
                    />
                  </div>
                </div>

                <div className="dg-stroke-join-row">
                  {([
                    ["miter", "Miter"],
                    ["bevel", "Bevel"],
                    ["round", "Round"],
                  ] as const).map(([join, label]) => (
                    <button
                      key={join}
                      type="button"
                      className={`dg-stroke-join-btn ${(advancedStroke.join || "round") === join ? "active" : ""}`}
                      onClick={() => updateStroke(advancedStroke.id, { join })}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <label className="dg-layer-prop-field">
                  <span>Miter angle</span>
                  <input
                    type="number"
                    min={0.2}
                    max={180}
                    step={0.1}
                    value={Number(advancedStroke.miter_limit || 4)}
                    onChange={(event) => updateStroke(advancedStroke.id, { miter_limit: Number(event.target.value || 4) })}
                  />
                </label>
              </div>
            ) : null}

            {advancedTab === "dynamic" ? (
              <div className="dg-stroke-advanced-body">
                <label className="dg-stroke-range-field">
                  <span>Frequency (%)</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={Math.max(0, Math.min(100, Math.round(Number(advancedStroke.dynamic_frequency || 0))))}
                    onChange={(event) => updateStroke(advancedStroke.id, { dynamic_frequency: Number(event.target.value || 0) })}
                  />
                </label>
                <label className="dg-stroke-range-field">
                  <span>Movement (%)</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={Math.max(0, Math.min(100, Math.round(Number(advancedStroke.dynamic_movement || 0))))}
                    onChange={(event) => updateStroke(advancedStroke.id, { dynamic_movement: Number(event.target.value || 0) })}
                  />
                </label>
                <label className="dg-stroke-range-field">
                  <span>Smooth (%)</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={Math.max(0, Math.min(100, Math.round(Number(advancedStroke.dynamic_smooth || 0))))}
                    onChange={(event) => updateStroke(advancedStroke.id, { dynamic_smooth: Number(event.target.value || 0) })}
                  />
                </label>
              </div>
            ) : null}

            {advancedTab === "brush" ? (
              <div className="dg-stroke-advanced-body">
                <label className="dg-layer-prop-field">
                  <span>Brush</span>
                  <select
                    className="dg-input"
                    value={advancedStroke.brush_preset || "ink"}
                    onChange={(event) => updateStroke(advancedStroke.id, { brush_preset: event.target.value as any })}
                  >
                    {STROKE_BRUSH_PRESETS.map((preset) => (
                      <option key={preset} value={preset}>{preset}</option>
                    ))}
                  </select>
                </label>
                <div className="dg-stroke-orientation-row">
                  <button
                    type="button"
                    className={`dg-stroke-join-btn ${advancedStroke.brush_flip ? "" : "active"}`}
                    onClick={() => updateStroke(advancedStroke.id, { brush_flip: false })}
                  >
                    <PinselaIcon name="ArrowLeft" size={14} />
                  </button>
                  <button
                    type="button"
                    className={`dg-stroke-join-btn ${advancedStroke.brush_flip ? "active" : ""}`}
                    onClick={() => updateStroke(advancedStroke.id, { brush_flip: true })}
                  >
                    <PinselaIcon name="ArrowRight" size={14} />
                  </button>
                </div>

                <div className="dg-stroke-profile-block">
                  <div className="dg-stroke-profile-caption">Width profile</div>
                  <div className={`dg-stroke-profile-preview ${(advancedStroke.width_profile || "uniform")} ${advancedStroke.width_profile_flip ? "flip" : ""}`} />
                  <div className="dg-stroke-profile-controls">
                    <select
                      className="dg-input"
                      value={advancedStroke.width_profile || "uniform"}
                      onChange={(event) => updateStroke(advancedStroke.id, { width_profile: event.target.value as any })}
                    >
                      <option value="uniform">{widthProfileLabel("uniform")}</option>
                      <option value="taper_start">{widthProfileLabel("taper_start")}</option>
                      <option value="taper_end">{widthProfileLabel("taper_end")}</option>
                      <option value="taper_both">{widthProfileLabel("taper_both")}</option>
                    </select>
                    <IconButton
                      size="sm"
                      icon={<PinselaIcon name="FlipHorizontal2" size={14} />}
                      title="Flip profile"
                      onClick={() => updateStroke(advancedStroke.id, { width_profile_flip: !advancedStroke.width_profile_flip })}
                    />
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

const DEFAULT_PERSPECTIVE_WARP: SelectionPerspectiveWarpPayload = {
  tlx: 0,
  tly: 0,
  trx: 0,
  try: 0,
  brx: 0,
  bry: 0,
  blx: 0,
  bly: 0,
};

export function BooleanOperationsSection({
  callbacks,
  selectionCount = 0,
}: {
  callbacks?: LeftPanelCallbacks;
  selectionCount?: number;
}) {
  const [isOpen, setIsOpen] = React.useState(true);
  const requiresTwoSelection = selectionCount === 2;

  return (
    <div className="dg-panel-section">
      <div className="dg-panel-subtitle">Boolean operations</div>
      <div className="dg-panel-inline-hint">
        Select exactly 2 elements to enable the operations.
      </div>

      <div className="dg-selection-tool-header">
        <IconButton
          icon={<PinselaIcon name="Combine" size={16} />}
          active={isOpen}
          className="dg-selection-tool-icon-btn"
          title="Boolean operations"
          onClick={() => setIsOpen((prev) => !prev)}
        />
        <span>{isOpen ? "Hide menu" : "Open menu"}</span>
      </div>

      {isOpen && (
        <div className="dg-selection-tool-grid">
          {([
            { id: "union", icon: "SquaresUnite", label: "Union" },
            { id: "subtract", icon: "SquaresSubtract", label: "Subtract" },
            { id: "intersect", icon: "SquaresIntersect", label: "Intersect" },
            { id: "exclude", icon: "SquaresExclude", label: "Exclude" },
            { id: "divide", icon: "Split", label: "Divide" },
            { id: "slice", icon: "ScissorsLineDashed", label: "Slice" },
          ] as const).map((operation) => (
            <button
              key={operation.id}
              type="button"
              className="dg-selection-tool-grid-btn"
              disabled={!requiresTwoSelection}
              onClick={() => callbacks?.onSelectionBooleanOperation?.(operation.id)}
              title={operation.label}
            >
              <PinselaIcon name={operation.icon as any} size={16} />
              <span>{operation.label}</span>
            </button>
          ))}
        </div>
      )}

      {!requiresTwoSelection ? (
        <div className="dg-empty-state-title">Select 2 elements to use boolean operations.</div>
      ) : null}
    </div>
  );
}

export function PerspectiveWarpSection({
  callbacks,
  selectionCount = 0,
}: {
  callbacks?: LeftPanelCallbacks;
  selectionCount?: number;
}) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [perspective, setPerspective] = React.useState<SelectionPerspectiveWarpPayload>(DEFAULT_PERSPECTIVE_WARP);
  const requiresAnySelection = selectionCount > 0;

  const patchPerspective = (key: keyof SelectionPerspectiveWarpPayload, value: number) => {
    setPerspective((prev) => ({ ...prev, [key]: Number.isFinite(value) ? value : 0 }));
  };

  return (
    <div className="dg-panel-section">
      <div className="dg-panel-subtitle">Perspective</div>
      <div className="dg-panel-inline-hint">
        Click the icon to open the settings.
      </div>

      <div className="dg-selection-tool-header">
        <IconButton
          icon={<PinselaIcon name="Move3d" size={16} />}
          active={isOpen}
          className="dg-selection-tool-icon-btn"
          title="Perspective distortion"
          onClick={() => setIsOpen((prev) => !prev)}
        />
        <span>{isOpen ? "Hide settings" : "Open settings"}</span>
      </div>

      {isOpen && (
        <>
          <div className="dg-selection-perspective-grid">
            {([
              ["TL X", "tlx"],
              ["TL Y", "tly"],
              ["TR X", "trx"],
              ["TR Y", "try"],
              ["BR X", "brx"],
              ["BR Y", "bry"],
              ["BL X", "blx"],
              ["BL Y", "bly"],
            ] as const).map(([label, key]) => (
              <label key={key} className="dg-layer-prop-field">
                <span>{label}</span>
                <input
                  type="number"
                  value={perspective[key]}
                  onChange={(event) => patchPerspective(key, Number(event.target.value))}
                />
              </label>
            ))}
          </div>

          <div className="dg-layer-actions-grid">
            <PillButton
              tone="neutral"
              size="sm"
              onClick={() => setPerspective(DEFAULT_PERSPECTIVE_WARP)}
            >
              Reset
            </PillButton>
            <PillButton
              tone="primary"
              size="sm"
              disabled={!requiresAnySelection}
              onClick={() => callbacks?.onSelectionPerspectiveWarp?.(perspective)}
            >
              Apply
            </PillButton>
          </div>
        </>
      )}
      {!requiresAnySelection ? (
        <div className="dg-empty-state-title">Select at least 1 element to apply perspective distortion.</div>
      ) : null}
    </div>
  );
}

export function ImageTraceSection({
  callbacks,
  imageTraceState,
}: {
  callbacks?: LeftPanelCallbacks;
  imageTraceState?: LeftPanelImageTraceState;
}) {
  const traceImages = imageTraceState?.images || [];
  const selectedTraceImageId = String(imageTraceState?.targetImageId || "");
  const canTrace = selectedTraceImageId.length > 0;
  const baseEdgeThreshold = clampPercent(Number(imageTraceState?.edgeThreshold), 50);
  const baseCurveTolerance = clampPercent(Number(imageTraceState?.curveTolerance), 40);
  const [traceEdgeInput, setTraceEdgeInput] = React.useState(String(baseEdgeThreshold));
  const [traceCurveInput, setTraceCurveInput] = React.useState(String(baseCurveTolerance));

  React.useEffect(() => {
    setTraceEdgeInput(String(baseEdgeThreshold));
  }, [baseEdgeThreshold]);

  React.useEffect(() => {
    setTraceCurveInput(String(baseCurveTolerance));
  }, [baseCurveTolerance]);

  const emitTraceAction = React.useCallback((
    phase: "preview" | "apply" | "cancel",
    options?: Partial<{ edgeThreshold: number; curveTolerance: number; nodeId: string | null }>,
  ) => {
    const edgeThreshold = clampPercent(
      Number(options?.edgeThreshold ?? Number(traceEdgeInput)),
      baseEdgeThreshold,
    );
    const curveTolerance = clampPercent(
      Number(options?.curveTolerance ?? Number(traceCurveInput)),
      baseCurveTolerance,
    );
    const nodeId = options?.nodeId ?? (selectedTraceImageId || null);
    callbacks?.onImageTraceAction?.({
      phase,
      edgeThreshold,
      curveTolerance,
      nodeId,
    });
  }, [
    callbacks,
    traceEdgeInput,
    traceCurveInput,
    baseEdgeThreshold,
    baseCurveTolerance,
    selectedTraceImageId,
  ]);

  return (
    <div className="dg-panel-section">
      <div className="dg-panel-subtitle">Image vectorizing</div>
      <div className="dg-panel-inline-hint">
        Select an image on the artboard (or upload one) to trace.
      </div>

      <label className="dg-layer-prop-field">
        <span>Page image</span>
        <select
          className="dg-input"
          value={selectedTraceImageId}
          onChange={(event) => {
            const nextId = String(event.target.value || "").trim();
            if (!nextId) {
              callbacks?.onSelectImageTraceTarget?.("");
              emitTraceAction("cancel", { nodeId: null });
              return;
            }
            callbacks?.onSelectImageTraceTarget?.(nextId);
            emitTraceAction("preview", { nodeId: nextId });
          }}
        >
          {traceImages.length ? null : <option value="">No images on the page</option>}
          {traceImages.map((entry, index) => (
            <option key={entry.id} value={entry.id}>
              {entry.name || `Image ${index + 1}`}
            </option>
          ))}
        </select>
      </label>

      <div className="dg-layer-actions-grid">
        <PillButton
          tone="secondary"
          size="sm"
          disabled={!canTrace}
          onClick={() => {
            if (!canTrace) return;
            callbacks?.onSelectImageTraceTarget?.(selectedTraceImageId);
          }}
        >
          Select on canvas
        </PillButton>
        <PillButton
          tone="neutral"
          size="sm"
          onClick={() => {
            if (callbacks?.onUploadTraceImage) {
              callbacks.onUploadTraceImage();
              return;
            }
            callbacks?.onAddImageFromDevice?.();
          }}
        >
          Upload image
        </PillButton>
      </div>

      <label className="dg-image-brush-row dg-image-brush-slider-row">
        <span>Edge threshold</span>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={clampPercent(Number(traceEdgeInput), baseEdgeThreshold)}
          disabled={!canTrace}
          onChange={(event) => {
            const value = clampPercent(Number(event.target.value), baseEdgeThreshold);
            setTraceEdgeInput(String(value));
            if (canTrace) emitTraceAction("preview", { edgeThreshold: value });
          }}
        />
        <input
          className="dg-image-brush-value"
          type="number"
          min={0}
          max={100}
          step={1}
          value={traceEdgeInput}
          disabled={!canTrace}
          onChange={(event) => {
            const next = event.target.value;
            setTraceEdgeInput(next);
            if (!canTrace) return;
            const value = clampPercent(Number(next), baseEdgeThreshold);
            emitTraceAction("preview", { edgeThreshold: value });
          }}
          onBlur={() => {
            const value = clampPercent(Number(traceEdgeInput), baseEdgeThreshold);
            setTraceEdgeInput(String(value));
            if (canTrace) emitTraceAction("preview", { edgeThreshold: value });
          }}
        />
        <em>%</em>
      </label>

      <label className="dg-image-brush-row dg-image-brush-slider-row">
        <span>Curve tolerance</span>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={clampPercent(Number(traceCurveInput), baseCurveTolerance)}
          disabled={!canTrace}
          onChange={(event) => {
            const value = clampPercent(Number(event.target.value), baseCurveTolerance);
            setTraceCurveInput(String(value));
            if (canTrace) emitTraceAction("preview", { curveTolerance: value });
          }}
        />
        <input
          className="dg-image-brush-value"
          type="number"
          min={0}
          max={100}
          step={1}
          value={traceCurveInput}
          disabled={!canTrace}
          onChange={(event) => {
            const next = event.target.value;
            setTraceCurveInput(next);
            if (!canTrace) return;
            const value = clampPercent(Number(next), baseCurveTolerance);
            emitTraceAction("preview", { curveTolerance: value });
          }}
          onBlur={() => {
            const value = clampPercent(Number(traceCurveInput), baseCurveTolerance);
            setTraceCurveInput(String(value));
            if (canTrace) emitTraceAction("preview", { curveTolerance: value });
          }}
        />
        <em>%</em>
      </label>

      <div className="dg-layer-actions-grid">
        <PillButton
          tone="secondary"
          size="sm"
          disabled={!canTrace}
          onClick={() => emitTraceAction("cancel")}
        >
          Cancel
        </PillButton>
        <PillButton
          tone="primary"
          size="sm"
          disabled={!canTrace}
          onClick={() => emitTraceAction("apply")}
        >
          {imageTraceState?.processing ? "Processing..." : "Apply"}
        </PillButton>
      </div>
      <div className="dg-panel-inline-hint">
        {imageTraceState?.hasPreview ? "Preview active on the canvas." : "Adjust the controls to generate a preview."}
      </div>
    </div>
  );
}

export function AutomationsSection({
  callbacks,
  bindingFields = [],
  automationTemplates = [],
  activePageName = "Current page",
}: {
  callbacks?: LeftPanelCallbacks;
  bindingFields?: AutomationBindingField[];
  automationTemplates?: AutomationTemplateSummary[];
  activePageName?: string;
}) {
  const bindingKindIcons: Record<AutomationBindingKind, keyof typeof import("lucide-react")> = {
    text: "Type",
    image: "Image",
    frame: "PanelTop",
  };
  const [activeTemplate, setActiveTemplate] = React.useState<AutomationTemplateDetail | null>(null);
  const [editingTemplate, setEditingTemplate] = React.useState<AutomationTemplateDetail | null>(null);
  const [templateNameDraft, setTemplateNameDraft] = React.useState("");
  const [loadingTemplateId, setLoadingTemplateId] = React.useState<string | null>(null);
  const [deletingTemplateId, setDeletingTemplateId] = React.useState<string | null>(null);
  const [savingTemplate, setSavingTemplate] = React.useState(false);
  const [selectedBindingIds, setSelectedBindingIds] = React.useState<string[]>([]);
  const [valuesByBindingId, setValuesByBindingId] = React.useState<Record<string, string>>({});
  const [imageFileByBindingId, setImageFileByBindingId] = React.useState<Record<string, { name: string; dataUrl: string }>>({});
  const [newPageName, setNewPageName] = React.useState("Generated page");
  const [templateQuery, setTemplateQuery] = React.useState("");
  const [bindingQuery, setBindingQuery] = React.useState("");
  const effectiveBindingFields = React.useMemo<AutomationBindingField[]>(
    () => editingTemplate ? bindingFields : (activeTemplate?.bindings?.length ? activeTemplate.bindings : bindingFields),
    [editingTemplate, activeTemplate, bindingFields],
  );

  function isImageBindingKind(kind: AutomationBindingKind): boolean {
    return kind === "image" || kind === "frame";
  }

  function readImageFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Failed to read the image file."));
      reader.onload = () => resolve(String(reader.result || ""));
      reader.readAsDataURL(file);
    });
  }

  React.useEffect(() => {
    const validIds = new Set(effectiveBindingFields.map((entry) => entry.id));
    setSelectedBindingIds((current) => current.filter((entry) => validIds.has(entry)));
    setValuesByBindingId((current) => {
      let changed = false;
      const next: Record<string, string> = {};
      for (const [id, value] of Object.entries(current)) {
        if (!validIds.has(id)) {
          changed = true;
          continue;
        }
        next[id] = value;
      }
      return changed ? next : current;
    });
    setImageFileByBindingId((current) => {
      let changed = false;
      const next: Record<string, { name: string; dataUrl: string }> = {};
      for (const [id, value] of Object.entries(current)) {
        if (!validIds.has(id)) {
          changed = true;
          continue;
        }
        next[id] = value;
      }
      return changed ? next : current;
    });
  }, [effectiveBindingFields]);

  React.useEffect(() => {
    if (!activeTemplate) return;
    const stillExists = automationTemplates.some((entry) => entry.id === activeTemplate.id);
    if (!stillExists) {
      setActiveTemplate(null);
      setSelectedBindingIds([]);
      setValuesByBindingId({});
      setImageFileByBindingId({});
    }
  }, [automationTemplates, activeTemplate]);

  React.useEffect(() => {
    if (!editingTemplate) return;
    const stillExists = automationTemplates.some((entry) => entry.id === editingTemplate.id);
    if (!stillExists) {
      setEditingTemplate(null);
      setTemplateNameDraft("");
      setSelectedBindingIds([]);
      setValuesByBindingId({});
      setImageFileByBindingId({});
    }
  }, [automationTemplates, editingTemplate]);

  const selectedBindings = React.useMemo(
    () => effectiveBindingFields.filter((binding) => selectedBindingIds.includes(binding.id)),
    [effectiveBindingFields, selectedBindingIds],
  );
  const filteredTemplates = React.useMemo(() => {
    const q = templateQuery.trim().toLowerCase();
    if (!q) return automationTemplates;
    return automationTemplates.filter((template) => {
      const haystack = `${template.name} ${template.sourcePageName || ""} ${template.projectKey || ""}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [automationTemplates, templateQuery]);
  const filteredBindingFields = React.useMemo(() => {
    const q = bindingQuery.trim().toLowerCase();
    if (!q) return effectiveBindingFields;
    return effectiveBindingFields.filter((binding) => {
      const haystack = `${binding.layerName} ${binding.kind}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [effectiveBindingFields, bindingQuery]);

  function toggleBinding(bindingId: string) {
    setSelectedBindingIds((current) => (
      current.includes(bindingId)
        ? current.filter((id) => id !== bindingId)
        : [...current, bindingId]
    ));
  }

  function resolveBindingValue(binding: AutomationBindingField): string {
    const rawValue = String(valuesByBindingId[binding.id] || "");
    if (!isImageBindingKind(binding.kind)) return rawValue;
    const trimmed = rawValue.trim();
    if (trimmed) return trimmed;
    return String(imageFileByBindingId[binding.id]?.dataUrl || "");
  }

  async function handleImageBindingFileChange(binding: AutomationBindingField, file: File | null) {
    if (!file || !isImageBindingKind(binding.kind)) return;
    if (!String(file.type || "").startsWith("image/")) return;
    try {
      const dataUrl = await readImageFileAsDataUrl(file);
      if (!dataUrl) return;
      setValuesByBindingId((current) => ({ ...current, [binding.id]: "" }));
      setImageFileByBindingId((current) => ({
        ...current,
        [binding.id]: { name: String(file.name || "image"), dataUrl },
      }));
    } catch {
      // Ignore local read failure; the user can paste a URL manually.
    }
  }

  function clearImageBindingFile(bindingId: string) {
    setImageFileByBindingId((current) => {
      if (!current[bindingId]) return current;
      const next = { ...current };
      delete next[bindingId];
      return next;
    });
  }

  async function handleLoadTemplate(templateId: string) {
    const id = String(templateId || "").trim();
    if (!id || !callbacks?.onLoadAutomationTemplate) return;
    setLoadingTemplateId(id);
    try {
      const loaded = await callbacks.onLoadAutomationTemplate(id);
      if (!loaded) return;
      setActiveTemplate(loaded);
      setEditingTemplate(null);
      setTemplateNameDraft(loaded.name);
      setSelectedBindingIds(loaded.bindings.map((binding) => binding.id));
      setValuesByBindingId({});
      setImageFileByBindingId({});
      setNewPageName(`Page ${loaded.name}`);
    } finally {
      setLoadingTemplateId(null);
    }
  }

  async function handleEditTemplate(templateId: string) {
    const id = String(templateId || "").trim();
    if (!id || !callbacks?.onLoadAutomationTemplate) return;
    setLoadingTemplateId(id);
    try {
      const loaded = await callbacks.onLoadAutomationTemplate(id);
      if (!loaded) return;
      setActiveTemplate(null);
      setEditingTemplate(loaded);
      setTemplateNameDraft(loaded.name);
      setSelectedBindingIds(loaded.bindings.map((binding) => binding.id));
      setValuesByBindingId({});
      setImageFileByBindingId({});
    } finally {
      setLoadingTemplateId(null);
    }
  }

  async function handleDeleteTemplate(templateId: string) {
    const id = String(templateId || "").trim();
    if (!id || !callbacks?.onDeleteAutomationTemplate) return;
    setDeletingTemplateId(id);
    try {
      const deleted = await callbacks.onDeleteAutomationTemplate(id);
      if (deleted === false) return;
      if (activeTemplate?.id === id) {
        setActiveTemplate(null);
        setSelectedBindingIds([]);
        setValuesByBindingId({});
        setImageFileByBindingId({});
      }
      if (editingTemplate?.id === id) {
        setEditingTemplate(null);
        setTemplateNameDraft("");
        setSelectedBindingIds([]);
        setValuesByBindingId({});
        setImageFileByBindingId({});
      }
    } finally {
      setDeletingTemplateId(null);
    }
  }

  async function handleSaveTemplate() {
    const name = String(templateNameDraft || "").trim();
    if (!name || !selectedBindings.length || !callbacks?.onSaveAutomationTemplate) return;
    setSavingTemplate(true);
    try {
      const created = await callbacks.onSaveAutomationTemplate({
        name,
        pageName: editingTemplate ? activePageName : (activeTemplate?.sourcePageName || activePageName),
        bindings: selectedBindings,
        doc: editingTemplate ? undefined : activeTemplate?.doc,
        templateId: editingTemplate?.id || null,
      });
      if (created === false) return;
      if (editingTemplate) {
        setEditingTemplate({
          ...editingTemplate,
          name,
          bindingCount: selectedBindings.length,
          bindings: [...selectedBindings],
        });
        return;
      }
      setTemplateNameDraft("");
    } finally {
      setSavingTemplate(false);
    }
  }

  function handleCreatePage() {
    const pageName = String(newPageName || "").trim();
    if (!pageName || !selectedBindings.length || !callbacks?.onCreateAutomationPage) return;
    const payload: AutomationCreatePagePayload = {
      pageName,
      bindings: selectedBindings,
      valuesByBindingId: Object.fromEntries(
        selectedBindings.map((binding) => [binding.id, resolveBindingValue(binding)]),
      ),
      baseDoc: activeTemplate?.doc,
      sourceTemplateId: activeTemplate?.id || null,
    };
    const created = callbacks.onCreateAutomationPage(payload);
    if (created === false) return;
    setSelectedBindingIds([]);
    setValuesByBindingId({});
    setImageFileByBindingId({});
  }

  return (
    <div className="dg-panel-section">
      <div className="dg-automation-command-card">
        <div className="dg-automation-command-head">
          <span className="dg-panel-subtitle">Automations</span>
        </div>
        <div className="dg-automation-command-title">
          Saved templates and page generation share the same flow.
        </div>
        <div className="dg-automation-command-stats" aria-label="Automations summary">
          <span><strong>{automationTemplates.length}</strong> templates</span>
          <span><strong>{selectedBindings.length}</strong> selected fields</span>
        </div>
      </div>

      <div className="dg-panel-subtitle">1. Save and reuse templates</div>
      <div className="dg-panel-inline-hint">
        {editingTemplate
          ? `Editing bindings for ${editingTemplate.name}. The update uses the current page.`
          : "Save the current page as a template to reuse in other projects."}
      </div>
      <div className="dg-panel-stack">
        <label className="dg-layer-prop-field">
          <span>Template name</span>
          <input
            type="text"
            className="dg-input"
            value={templateNameDraft}
            onChange={(event) => setTemplateNameDraft(event.target.value)}
            placeholder="e.g. Instagram offer 01"
          />
        </label>
        <PillButton
          tone="secondary"
          size="sm"
          disabled={!callbacks?.onSaveAutomationTemplate || !selectedBindings.length || !String(templateNameDraft || "").trim() || savingTemplate}
          onClick={() => {
            void handleSaveTemplate();
          }}
        >
          {savingTemplate
            ? (editingTemplate ? "Updating..." : "Saving...")
            : (editingTemplate ? "Update template" : "Save automation template")}
        </PillButton>
        {editingTemplate ? (
          <PillButton
            tone="neutral"
            size="sm"
            disabled={savingTemplate}
            onClick={() => {
              setEditingTemplate(null);
              setTemplateNameDraft("");
              setSelectedBindingIds([]);
              setValuesByBindingId({});
              setImageFileByBindingId({});
            }}
          >
            Cancel editing
          </PillButton>
        ) : null}
      </div>
      {automationTemplates.length === 0 ? (
        <div className="dg-empty-state">
          <div className="dg-empty-state-title">No automation templates saved yet.</div>
          <div className="dg-panel-inline-hint">Pick variable layers below and save a template to reuse later.</div>
        </div>
      ) : (
        <>
          <input
            type="text"
            className="dg-input"
            placeholder="Search templates by name or page..."
            value={templateQuery}
            onChange={(event) => setTemplateQuery(event.target.value)}
          />
          <div className="dg-list-item-subtle">
            {filteredTemplates.length} {filteredTemplates.length === 1 ? "visible template" : "visible templates"}
          </div>
          <div className="dg-automation-template-list">
            {filteredTemplates.map((template) => {
            const isActive = activeTemplate?.id === template.id;
            const isEditing = editingTemplate?.id === template.id;
            const canLoad = !!callbacks?.onLoadAutomationTemplate;
            const canDelete = !!callbacks?.onDeleteAutomationTemplate;
            const canEdit = !!callbacks?.onLoadAutomationTemplate;
            return (
              <div key={template.id} className={`dg-automation-template-card ${isActive || isEditing ? "active" : ""}`}>
                <div className="dg-automation-template-head">
                  <div className="dg-automation-template-title-wrap">
                    <span className="dg-automation-template-kicker">
                      {isEditing ? "Editing bindings" : isActive ? "Template in use" : "Saved template"}
                    </span>
                    <strong className="dg-automation-template-title" title={template.name}>
                      {template.name}
                    </strong>
                  </div>
                </div>

                <div className="dg-automation-template-meta">
                  <span title={template.sourcePageName || "No source page"}>
                    Page: <strong>{template.sourcePageName || "No source"}</strong>
                  </span>
                  <span>
                    Campos: <strong>{template.bindingCount}</strong>
                  </span>
                  {template.projectKey ? (
                    <span title={template.projectKey}>
                      Project: <strong>{template.projectKey}</strong>
                    </span>
                  ) : null}
                </div>

                <div className="dg-automation-template-actions">
                  <PillButton
                    tone={isActive ? "primary" : "neutral"}
                    size="sm"
                    disabled={!canLoad || loadingTemplateId === template.id || isEditing}
                    onClick={() => {
                      void handleLoadTemplate(template.id);
                    }}
                  >
                    {loadingTemplateId === template.id ? "Opening..." : (isActive ? "In use" : "Use")}
                  </PillButton>
                  <PillButton
                    tone={isEditing ? "primary" : "neutral"}
                    size="sm"
                    disabled={!canEdit || loadingTemplateId === template.id}
                    onClick={() => {
                      void handleEditTemplate(template.id);
                    }}
                  >
                    {loadingTemplateId === template.id ? "Opening..." : (isEditing ? "Editing" : "Edit bindings")}
                  </PillButton>
                  <PillButton
                    tone="neutral"
                    size="sm"
                    disabled={!canDelete || deletingTemplateId === template.id}
                    onClick={() => {
                      void handleDeleteTemplate(template.id);
                    }}
                  >
                    {deletingTemplateId === template.id ? "Deleting..." : "Delete"}
                  </PillButton>
                </div>
              </div>
            );
            })}
            {!filteredTemplates.length ? (
              <div className="dg-empty-state">
                <div className="dg-empty-state-title">No templates match this search.</div>
              </div>
            ) : null}
          </div>
        </>
      )}
      {activeTemplate ? (
        <div className="dg-panel-stack">
          <div className="dg-panel-inline-hint">
            Active template: {activeTemplate.name}. The new page will be created from it.
          </div>
          <PillButton
            tone="neutral"
            size="sm"
            onClick={() => {
              setActiveTemplate(null);
              setEditingTemplate(null);
              setSelectedBindingIds([]);
              setValuesByBindingId({});
              setImageFileByBindingId({});
              setNewPageName("Generated page");
            }}
          >
            Back to current page
          </PillButton>
        </div>
      ) : null}
      <div className="dg-panel-subtitle">2. Choose variable layers</div>
      <div className="dg-panel-inline-hint">
        Choose text, image or frame layers. The list follows the same name and type pattern as the Layers tab.
      </div>
      <input
        type="text"
        className="dg-input"
        placeholder="Search variable layers by name or type..."
        value={bindingQuery}
        onChange={(event) => setBindingQuery(event.target.value)}
        disabled={!effectiveBindingFields.length}
      />
      <div className="dg-list-item-subtle">
        {filteredBindingFields.length} {filteredBindingFields.length === 1 ? "variable layer" : "variable layers"}
      </div>

      {effectiveBindingFields.length === 0 ? (
        <div className="dg-empty-state">
          <div className="dg-empty-state-title">No text, image or frame layers found.</div>
        </div>
      ) : (
        <div className="dg-layers-list dg-automation-bindings-list">
          {filteredBindingFields.map((binding) => {
            const checked = selectedBindingIds.includes(binding.id);
            const kindLabel = binding.kind.toUpperCase();
            return (
              <label key={binding.id} className={`dg-layer-item dg-automation-binding-row ${checked ? "active" : ""}`}>
                <input
                  type="checkbox"
                  className="dg-automation-binding-check"
                  checked={checked}
                  onChange={() => toggleBinding(binding.id)}
                  onClick={(event) => event.stopPropagation()}
                />
                <span className="dg-layer-name">
                  <PinselaIcon name={bindingKindIcons[binding.kind] || "Square"} size={12} />
                  <span className="dg-layer-name-label">{binding.layerName}</span>
                </span>
                <span className="dg-list-item-subtle" style={{ textTransform: "uppercase" }}>
                  {kindLabel}
                </span>
              </label>
            );
          })}
          {!filteredBindingFields.length ? (
            <div className="dg-empty-state">
              <div className="dg-empty-state-title">No variable layers match this search.</div>
            </div>
          ) : null}
        </div>
      )}

      <div className="dg-panel-subtitle">3. Fill in the values</div>
      {selectedBindings.length === 0 ? (
        <div className="dg-empty-state">
          <div className="dg-empty-state-title">Select at least one layer to generate the inputs.</div>
        </div>
      ) : (
        <div className="dg-panel-stack">
          {selectedBindings.map((binding) => {
            const isImageBinding = isImageBindingKind(binding.kind);
            const selectedFile = imageFileByBindingId[binding.id] || null;
            const filePickerId = `automation-binding-file-${binding.id}`;
            return (
              <div key={binding.id} className="dg-panel-stack">
                <label className="dg-layer-prop-field">
                  <span>
                    {isImageBinding
                      ? (binding.kind === "frame"
                        ? `Which image goes in frame ${binding.layerName}?`
                        : `Which image goes in layer ${binding.layerName}?`)
                      : `Which text goes in layer ${binding.layerName}?`}
                  </span>
                  <input
                    type="text"
                    className="dg-input"
                    value={valuesByBindingId[binding.id] || ""}
                    placeholder={isImageBinding ? "Paste the image URL (or use Choose image)" : "Text content"}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      setValuesByBindingId((current) => ({ ...current, [binding.id]: nextValue }));
                      if (isImageBinding && String(nextValue || "").trim()) {
                        clearImageBindingFile(binding.id);
                      }
                    }}
                  />
                </label>
                {isImageBinding ? (
                  <>
                    <input
                      id={filePickerId}
                      type="file"
                      accept="image/*"
                      style={{ display: "none" }}
                      onChange={(event) => {
                        const file = event.target.files?.[0] || null;
                        void handleImageBindingFileChange(binding, file);
                        event.currentTarget.value = "";
                      }}
                    />
                    <div className="dg-layer-actions-grid">
                      <PillButton
                        tone="secondary"
                        size="sm"
                        onClick={() => (document.getElementById(filePickerId) as HTMLInputElement | null)?.click()}
                      >
                        Choose image
                      </PillButton>
                      <PillButton
                        tone="neutral"
                        size="sm"
                        disabled={!selectedFile}
                        onClick={() => clearImageBindingFile(binding.id)}
                      >
                        Clear file
                      </PillButton>
                    </div>
                    <div className="dg-panel-inline-hint">
                      {selectedFile
                        ? `Selected file: ${selectedFile.name}`
                        : "Optional: pick an image from your device."}
                    </div>
                  </>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      <div className="dg-panel-subtitle">4. Generate page</div>
      <div className="dg-panel-stack">
        <label className="dg-layer-prop-field">
          <span>Page name</span>
          <input
            type="text"
            className="dg-input"
            value={newPageName}
            onChange={(event) => setNewPageName(event.target.value)}
            placeholder="New page name"
          />
        </label>
        <PillButton
          tone="primary"
          size="sm"
          disabled={!callbacks?.onCreateAutomationPage || !selectedBindings.length || !String(newPageName || "").trim()}
          onClick={handleCreatePage}
        >
          Create page
        </PillButton>
      </div>
    </div>
  );
}

// Friendly type label that resolves rect-based shapes (ellipse/polygon/star)
// instead of leaking the raw kind (e.g. a polygon showed "POLYGONRECT").
function resolveNodeKindLabel(node: PinselaNode | null | undefined): string {
  if (!node) return "";
  const kind = String(node.kind || "");
  if (kind === "rect") {
    const shape = String((node.style as Record<string, unknown> | undefined)?.shape_type || "rect").toLowerCase();
    if (shape === "ellipse") return "Ellipse";
    if (shape === "polygon") return "Polygon";
    if (shape === "star") return "Star";
    return "Rectangle";
  }
  const map: Record<string, string> = {
    text: "Text", image: "Image", line: "Line", group: "Group",
    frame: "Frame", path: "Vector",
  };
  return map[kind] || kind.toUpperCase();
}

// Friendly layer name for the Layers panel: a user-set name wins; otherwise derive
// from the node's content (text → its words, image → filename) so the panel isn't a
// wall of identical "TEXT"/"RECTANGLE" rows. defaultNode seeds name = kind.toUpperCase().
function resolveNodeDisplayName(node: PinselaNode | null | undefined): string {
  if (!node) return "";
  const kind = String(node.kind || "");
  const rawName = String(node.name || "").trim();
  const isDefaultName = !rawName || rawName === kind.toUpperCase();
  const truncate = (s: string) => (s.length > 28 ? `${s.slice(0, 28)}…` : s);
  if (!isDefaultName) return rawName;
  if (kind === "text") {
    const text = String((node as Record<string, unknown>).text || "").replace(/\s+/g, " ").trim();
    if (text) return truncate(text);
  }
  if (kind === "image") {
    const src = String(
      (node.style as Record<string, unknown> | undefined)?.image_src
      || (node as Record<string, unknown>).image_src
      || "",
    );
    const file = src.split(/[/\\?#]/).filter(Boolean).pop() || "";
    const clean = decodeURIComponent(file).replace(/\.[a-z0-9]+$/i, "");
    if (clean && !/^[0-9a-f-]{20,}$/i.test(clean)) return truncate(clean);
  }
  return resolveNodeKindLabel(node);
}

export function LayersSection({
  layers,
  callbacks,
  selectedNode,
  selectionCount = 0,
  selectedIds = [],
}: {
  layers?: PinselaNode[];
  callbacks?: LeftPanelCallbacks;
  selectedNode?: PinselaNode | null;
  selectionCount?: number;
  selectedIds?: string[];
}) {
  type PositionDraftKey = "x" | "y" | "w" | "h" | "r" | "op";
  type TextNumericDraftKey = "size" | "lineHeight" | "tracking";
  const items = layers || [];
  const [activeTab, setActiveTab] = React.useState<"position" | "layers">("position");
  const [lastClickedId, setLastClickedId] = React.useState<string | null>(null);
  const [draggingId, setDraggingId] = React.useState<string | null>(null);
  const [dropIndicator, setDropIndicator] = React.useState<{ targetId: string; placement: "before" | "after" } | null>(null);
  const [editingLayerId, setEditingLayerId] = React.useState<string | null>(null);
  const [editingLayerName, setEditingLayerName] = React.useState("");
  const [isColorEditorOpen, setIsColorEditorOpen] = React.useState(false);
  const [collapsedLayerIds, setCollapsedLayerIds] = React.useState<Set<string>>(() => new Set());
  const [positionDrafts, setPositionDrafts] = React.useState<Record<PositionDraftKey, string>>({
    x: "0",
    y: "0",
    w: "0",
    h: "0",
    r: "0",
    op: "100",
  });
  const [textContentDraft, setTextContentDraft] = React.useState("");
  const [textNumericDrafts, setTextNumericDrafts] = React.useState<Record<TextNumericDraftKey, string>>({
    size: "42",
    lineHeight: "120",
    tracking: "0",
  });
  const kindIcons: Record<string, keyof typeof import("lucide-react")> = {
    rect: "Square",
    text: "Type",
    image: "Image",
    frame: "PanelTop",
    group: "Group",
    line: "Minus",
  };

  const node = selectedNode || null;
  const selectedIdList = React.useMemo(
    () => Array.from(new Set(
      selectedIds
        .map((id) => String(id || "").trim())
        .filter(Boolean),
    )),
    [selectedIds],
  );
  const selectedSet = React.useMemo(() => new Set(selectedIdList), [selectedIdList]);

  // Layers panel: scroll the selected row into view when selection changes from
  // outside (e.g. clicking an element on the canvas), and auto-scroll the list
  // while dragging a layer near the edges.
  const layersListRef = React.useRef<HTMLDivElement | null>(null);
  const layerRowRefs = React.useRef<Map<string, HTMLDivElement>>(new Map());
  React.useEffect(() => {
    if (activeTab !== "layers") return;
    const firstId = selectedIdList[0];
    if (!firstId) return;
    const el = layerRowRefs.current.get(firstId);
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIdList, activeTab]);
  const getLayersScrollEl = React.useCallback((): HTMLElement | null => {
    let el: HTMLElement | null = layersListRef.current;
    while (el) {
      if (el.scrollHeight > el.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(el).overflowY)) return el;
      el = el.parentElement;
    }
    return null;
  }, []);
  const autoScrollLayersDuringDrag = React.useCallback((clientY: number) => {
    const sc = getLayersScrollEl();
    if (!sc) return;
    const r = sc.getBoundingClientRect();
    const edge = 52;
    if (clientY < r.top + edge) sc.scrollTop -= 14;
    else if (clientY > r.bottom - edge) sc.scrollTop += 14;
  }, [getLayersScrollEl]);

  const nodeById = React.useMemo(() => new Map(items.map((entry) => [entry.id, entry] as const)), [items]);
  const parentById = React.useMemo(() => {
    const out = new Map<string, string | null>();
    for (const item of items) {
      const parentIdRaw = String(item.parent_id || "").trim();
      const parentId = parentIdRaw && nodeById.has(parentIdRaw) ? parentIdRaw : null;
      out.set(item.id, parentId);
    }
    return out;
  }, [items, nodeById]);
  const childrenByParent = React.useMemo(() => {
    const map = new Map<string | null, PinselaNode[]>();
    const sortedFrontToBack = [...items].sort((a, b) => Number(b.geometry.z_index || 0) - Number(a.geometry.z_index || 0));
    for (const item of sortedFrontToBack) {
      const parentId = parentById.get(item.id) ?? null;
      const bucket = map.get(parentId) || [];
      bucket.push(item);
      map.set(parentId, bucket);
    }
    return map;
  }, [items, parentById]);
  const layerRows = React.useMemo(() => {
    const out: Array<{ node: PinselaNode; depth: number; hasChildren: boolean; collapsed: boolean }> = [];
    const walk = (parentId: string | null, depth: number) => {
      const children = childrenByParent.get(parentId) || [];
      for (const entry of children) {
        const nested = childrenByParent.get(entry.id) || [];
        const hasChildren = nested.length > 0;
        const collapsed = collapsedLayerIds.has(entry.id);
        out.push({ node: entry, depth, hasChildren, collapsed });
        if (hasChildren && !collapsed) {
          walk(entry.id, depth + 1);
        }
      }
    };
    walk(null, 0);
    return out;
  }, [childrenByParent, collapsedLayerIds]);
  const visibleLayerRows = layerRows;
  const selectedLayerRows = React.useMemo(
    () => layerRows.filter(({ node: layerNode }) => selectedSet.has(layerNode.id)),
    [layerRows, selectedSet],
  );
  const idsInLayerOrder = React.useMemo(() => visibleLayerRows.map((entry) => entry.node.id), [visibleLayerRows]);
  const documentColors = React.useMemo(() => {
    const out: unknown[] = [];
    const seen = new Set<string>();
    const keyOf = (value: unknown): string => {
      if (typeof value === "string") return value.trim().toLowerCase();
      if (!value || typeof value !== "object") return "";
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    };
    const pushColor = (value: unknown) => {
      if (value == null) return;
      if (typeof value === "string" && !value.trim()) return;
      const key = keyOf(value);
      if (!key || seen.has(key)) return;
      seen.add(key);
      out.push(value);
    };

    for (const item of items) {
      pushColor(item.style?.fill);
      const stroke = item.style?.stroke;
      if (stroke && typeof stroke === "object" && !Array.isArray(stroke)) {
        const strokeObj = stroke as Record<string, unknown>;
        pushColor(strokeObj.color ?? stroke);
      } else {
        pushColor(stroke);
      }

      const textStyle = item.text_style as Record<string, unknown> | undefined;
      pushColor(textStyle?.color);

      const duotone = item.style?.image_duotone as Record<string, unknown> | undefined;
      pushColor(duotone?.shadows);
      pushColor(duotone?.highlights);
    }
    return out;
  }, [items]);
  const styleColor = React.useMemo(() => {
    if (!node) return "#2563eb";
    if (node.kind === "text") {
      const textStyle = node.text_style as Record<string, unknown> | undefined;
      return textStyle?.color ?? node.style?.fill ?? "#2563eb";
    }
    if (node.kind === "line") {
      const rawStroke = node.style?.stroke;
      if (rawStroke && typeof rawStroke === "object") {
        const stroke = rawStroke as Record<string, unknown>;
        return stroke.color ?? node.style?.fill ?? "#2563eb";
      }
      return rawStroke ?? node.style?.fill ?? "#2563eb";
    }
    return node.style?.fill ?? "#2563eb";
  }, [node]);
  const styleColorLabel = node?.kind === "line" ? "Stroke color" : node?.kind === "text" ? "Text color" : "Fill color";
  const isSingleTextSelection = selectionCount === 1 && node?.kind === "text";
  const buildLayerPath = React.useCallback((nodeId: string, options?: { includeSelf?: boolean }) => {
    const includeSelf = options?.includeSelf ?? false;
    const labels: string[] = [];
    const seen = new Set<string>();
    let cursor = includeSelf ? nodeId : (parentById.get(nodeId) || null);
    while (cursor) {
      if (seen.has(cursor)) break;
      seen.add(cursor);
      const current = nodeById.get(cursor);
      if (!current) break;
      labels.unshift(String(current.name || current.kind || "Layer"));
      cursor = parentById.get(cursor) || null;
    }
    return labels;
  }, [nodeById, parentById]);
  const selectionPath = React.useMemo(
    () => (selectionCount === 1 && node ? buildLayerPath(node.id) : []),
    [buildLayerPath, node, selectionCount],
  );
  const selectedLayerNames = React.useMemo(
    () => selectedLayerRows.slice(0, 4).map(({ node: layerNode }) => String(layerNode.name || layerNode.kind || "Layer")),
    [selectedLayerRows],
  );
  const textAlignValue = React.useMemo<"left" | "center" | "right" | "justify">(() => {
    if (!isSingleTextSelection || !node) return "left";
    const textStyle = node.text_style as Record<string, unknown> | undefined;
    const align = String(textStyle?.text_align || "left");
    return align === "center" || align === "right" || align === "justify" ? align : "left";
  }, [isSingleTextSelection, node]);

  React.useEffect(() => {
    setIsColorEditorOpen(false);
  }, [node?.id, selectionCount]);

  React.useEffect(() => {
    if (!isSingleTextSelection || !node) {
      setTextContentDraft("");
      setTextNumericDrafts({
        size: "42",
        lineHeight: "120",
        tracking: "0",
      });
      return;
    }
    const textStyle = node.text_style as Record<string, unknown> | undefined;
    setTextContentDraft(String(node.text || ""));
    setTextNumericDrafts({
      size: String(Math.max(1, Math.round(Number(textStyle?.size || 42)))),
      lineHeight: String(Math.max(1, Math.round(Number(textStyle?.line_height || 120)))),
      tracking: String(Math.round(Number(textStyle?.letter_spacing || 0))),
    });
  }, [
    isSingleTextSelection,
    node?.id,
    node?.text,
    node?.text_style,
  ]);

  React.useEffect(() => {
    setCollapsedLayerIds((prev) => {
      const next = new Set<string>();
      prev.forEach((id) => {
        if (nodeById.has(id)) next.add(id);
      });
      return next;
    });
  }, [nodeById]);

  React.useEffect(() => {
    if (selectionCount !== 1 || !node) {
      setPositionDrafts({
        x: "0",
        y: "0",
        w: "0",
        h: "0",
        r: "0",
        op: "100",
      });
      return;
    }
    setPositionDrafts({
      x: String(Math.round(Number(node.geometry.x || 0))),
      y: String(Math.round(Number(node.geometry.y || 0))),
      w: String(Math.round(Number(node.geometry.width || 0))),
      h: String(Math.round(Number(node.geometry.height || 0))),
      r: String(Math.round(Number(node.geometry.rotation || 0))),
      op: String(Math.round((Number(node.style.opacity ?? 1)) * 100)),
    });
  }, [
    selectionCount,
    node?.id,
    node?.geometry.x,
    node?.geometry.y,
    node?.geometry.width,
    node?.geometry.height,
    node?.geometry.rotation,
    node?.style.opacity,
  ]);

  // Last value committed per field: Enter followed by blur (or a blur without any
  // change) must not push a second history entry — one edit = one undo step.
  const committedPositionRef = React.useRef<Partial<Record<PositionDraftKey, string>>>({});
  React.useEffect(() => {
    committedPositionRef.current = {};
  }, [node?.id, node?.geometry.x, node?.geometry.y, node?.geometry.width, node?.geometry.height, node?.geometry.rotation, node?.style.opacity]);

  function positionInput(
    label: string,
    key: PositionDraftKey,
    fallbackValue: number,
    suffix: string,
    onCommit?: (value: number) => void,
  ) {
    const commitDraft = () => {
      const raw = String(positionDrafts[key] ?? "").trim();
      if (!onCommit) return;
      if (!raw || raw === "-" || raw === "+" || raw === "." || raw === "-." || raw === "+.") {
        setPositionDrafts((prev) => ({ ...prev, [key]: String(fallbackValue) }));
        return;
      }
      const next = Number(raw);
      if (!Number.isFinite(next)) {
        setPositionDrafts((prev) => ({ ...prev, [key]: String(fallbackValue) }));
        return;
      }
      if (next === fallbackValue || committedPositionRef.current[key] === raw) return;
      committedPositionRef.current[key] = raw;
      onCommit(next);
    };

    return (
      <label className="dg-position-field">
        <span>{label}</span>
        <span className="dg-position-input-shell">
          <input
            type="number"
            value={positionDrafts[key] ?? String(fallbackValue)}
            onChange={(event) => {
              const next = event.target.value;
              delete committedPositionRef.current[key];
              setPositionDrafts((prev) => ({ ...prev, [key]: next }));
            }}
            onBlur={commitDraft}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitDraft();
                return;
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setPositionDrafts((prev) => ({ ...prev, [key]: String(fallbackValue) }));
              }
            }}
            disabled={!onCommit}
          />
          <em>{suffix}</em>
        </span>
      </label>
    );
  }

  function positionActionButton(
    label: string,
    icon: string,
    onClick?: () => void,
    disabled?: boolean,
  ) {
    return (
      <button
        type="button"
        className="dg-position-action-btn"
        title={label}
        aria-label={label}
        disabled={disabled || !onClick}
        onClick={onClick}
      >
        <PinselaIcon name={icon} size={16} />
      </button>
    );
  }

  function commitTextContentDraft() {
    if (!isSingleTextSelection || !node) return;
    const nextText = String(textContentDraft);
    const fallback = String(node.text || "");
    if (nextText === fallback) return;
    callbacks?.onSetSelectedTextContent?.(nextText);
  }

  function applyTextNumericLive(key: TextNumericDraftKey, rawValue: string) {
    if (!isSingleTextSelection || !node) return;
    if (!rawValue || rawValue === "-" || rawValue === "+" || rawValue === "." || rawValue === "-." || rawValue === "+.") {
      return;
    }
    const value = Number(rawValue);
    if (!Number.isFinite(value)) return;
    if (key === "size") {
      const normalized = Math.max(6, Math.min(640, Math.round(value)));
      callbacks?.onPatchSelectedTextStyle?.({ size: normalized });
      return;
    }
    if (key === "lineHeight") {
      const normalized = Math.max(40, Math.min(400, Math.round(value)));
      callbacks?.onPatchSelectedTextStyle?.({ line_height: normalized });
      return;
    }
    const normalized = Math.max(-200, Math.min(400, Math.round(value)));
    callbacks?.onPatchSelectedTextStyle?.({ letter_spacing: normalized });
  }

  function commitTextNumericDraft(key: TextNumericDraftKey) {
    if (!isSingleTextSelection || !node) return;
    const raw = String(textNumericDrafts[key] ?? "").trim();
    const textStyle = node.text_style as Record<string, unknown> | undefined;
    const fallback = key === "size"
      ? Number(textStyle?.size || 42)
      : key === "lineHeight"
        ? Number(textStyle?.line_height || 120)
        : Number(textStyle?.letter_spacing || 0);
    if (!raw || raw === "-" || raw === "+" || raw === "." || raw === "-." || raw === "+.") {
      setTextNumericDrafts((prev) => ({ ...prev, [key]: String(Math.round(fallback)) }));
      return;
    }
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      setTextNumericDrafts((prev) => ({ ...prev, [key]: String(Math.round(fallback)) }));
      return;
    }

    if (key === "size") {
      const normalized = Math.max(6, Math.min(640, Math.round(value)));
      setTextNumericDrafts((prev) => ({ ...prev, size: String(normalized) }));
      callbacks?.onPatchSelectedTextStyle?.({ size: normalized });
      return;
    }
    if (key === "lineHeight") {
      const normalized = Math.max(40, Math.min(400, Math.round(value)));
      setTextNumericDrafts((prev) => ({ ...prev, lineHeight: String(normalized) }));
      callbacks?.onPatchSelectedTextStyle?.({ line_height: normalized });
      return;
    }
    const normalized = Math.max(-200, Math.min(400, Math.round(value)));
    setTextNumericDrafts((prev) => ({ ...prev, tracking: String(normalized) }));
    callbacks?.onPatchSelectedTextStyle?.({ letter_spacing: normalized });
  }

  function handleLayerClick(event: React.MouseEvent<HTMLDivElement>, nodeId: string) {
    const isShift = event.shiftKey;
    const isToggle = event.metaKey || event.ctrlKey;

    if (isShift && lastClickedId && callbacks?.onSetSelection) {
      const a = idsInLayerOrder.indexOf(lastClickedId);
      const b = idsInLayerOrder.indexOf(nodeId);
      if (a >= 0 && b >= 0) {
        const [start, end] = a < b ? [a, b] : [b, a];
        callbacks.onSetSelection(idsInLayerOrder.slice(start, end + 1));
        return;
      }
    }

    if (isToggle && callbacks?.onSetSelection) {
      const next = selectedSet.has(nodeId)
        ? selectedIds.filter((id) => id !== nodeId)
        : [...selectedIds, nodeId];
      callbacks.onSetSelection(next);
      setLastClickedId(nodeId);
      return;
    }

    if (callbacks?.onSetSelection) {
      callbacks.onSetSelection([nodeId]);
    } else {
      callbacks?.onSelectNode?.(nodeId);
    }
    setLastClickedId(nodeId);
  }

  function beginRenameLayer(node: PinselaNode) {
    setEditingLayerId(node.id);
    setEditingLayerName(String(node.name || node.kind || "Layer"));
  }

  function finishRenameLayer(node: PinselaNode) {
    if (editingLayerId !== node.id) return;
    const nextName = String(editingLayerName || "").trim().replace(/\s+/g, " ");
    if (nextName && nextName !== String(node.name || node.kind || "")) {
      callbacks?.onRenameNode?.(node.id, nextName);
    }
    setEditingLayerId(null);
    setEditingLayerName("");
  }

  function cancelRenameLayer() {
    setEditingLayerId(null);
    setEditingLayerName("");
  }

  function toggleLayerCollapse(nodeId: string) {
    setCollapsedLayerIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }

  return (
    <div className="dg-panel-section dg-position-panel">
      <div className="dg-position-tabs" role="tablist" aria-label="Layer navigation">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "position"}
          className={activeTab === "position" ? "active" : ""}
          onClick={() => setActiveTab("position")}
        >
          Position
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "layers"}
          className={activeTab === "layers" ? "active" : ""}
          onClick={() => setActiveTab("layers")}
        >
          Layers
        </button>
      </div>

      {activeTab === "position" && (
        <>
          {selectionCount > 0 ? (
            <div className="dg-panel-stack">
              <div className="dg-position-card">
                <div className="dg-position-selection-head">
                  <strong>{selectionCount > 1 ? `${selectionCount} layers selected` : (node?.name || resolveNodeKindLabel(node) || "Selection")}</strong>
                  {selectionCount === 1 && node ? <span>{resolveNodeKindLabel(node)}</span> : null}
                </div>

                <div className="dg-position-action-grid">
                  {positionActionButton("Forward", "ArrowUp", () => callbacks?.onReorderSelection?.("up"))}
                  {positionActionButton("Backward", "ArrowDown", () => callbacks?.onReorderSelection?.("down"))}
                  {positionActionButton("Bring to front", "ArrowUpToLine", () => callbacks?.onReorderSelection?.("front"))}
                  {positionActionButton("Send to back", "ArrowDownToLine", () => callbacks?.onReorderSelection?.("back"))}
                </div>

                <div className="dg-position-section-title">Align to page</div>
                <div className="dg-position-action-grid">
                  {positionActionButton("Top", "ArrowUpToLine", () => callbacks?.onAlignSelection?.("top"))}
                  {positionActionButton("Left", "AlignLeft", () => callbacks?.onAlignSelection?.("left"))}
                  {positionActionButton("Middle", "AlignVerticalJustifyCenter", () => callbacks?.onAlignSelection?.("middle"))}
                  {positionActionButton("Center", "AlignCenter", () => callbacks?.onAlignSelection?.("center"))}
                  {positionActionButton("Bottom", "ArrowDownToLine", () => callbacks?.onAlignSelection?.("bottom"))}
                  {positionActionButton("Right", "AlignRight", () => callbacks?.onAlignSelection?.("right"))}
                </div>

                <div className="dg-position-action-grid is-compact">
                  {positionActionButton("Distribute H", "AlignHorizontalDistributeCenter", () => callbacks?.onDistributeSelection?.("horizontal"))}
                  {positionActionButton("Distribute V", "AlignVerticalDistributeCenter", () => callbacks?.onDistributeSelection?.("vertical"))}
                  {positionActionButton("Group", "Group", () => callbacks?.onGroupSelection?.())}
                  {positionActionButton("Ungroup", "Ungroup", () => callbacks?.onUngroupSelection?.())}
                  {/* Duplicate/Delete live in the floating on-object quick-stack — not repeated here. */}
                </div>

                {selectionCount === 1 && node && (
                  <>
                    <div className="dg-position-section-title">Advanced</div>
                    <div className="dg-position-fields-grid">
                      {positionInput("Width", "w", Math.round(node.geometry.width), "px", (v) => callbacks?.onPatchSelectedNode?.({ width: Math.max(4, v) }))}
                      {positionInput("Height", "h", Math.round(node.geometry.height), "px", (v) => callbacks?.onPatchSelectedNode?.({ height: Math.max(4, v) }))}
                      <label className="dg-position-field">
                        <span>Ratio</span>
                        <button type="button" className="dg-position-ratio-btn" disabled>
                          <PinselaIcon name="Lock" size={24} />
                        </button>
                      </label>
                      {positionInput("X", "x", Math.round(node.geometry.x), "px", (v) => callbacks?.onPatchSelectedNode?.({ x: v }))}
                      {positionInput("Y", "y", Math.round(node.geometry.y), "px", (v) => callbacks?.onPatchSelectedNode?.({ y: v }))}
                      {positionInput("Rotate", "r", Math.round(node.geometry.rotation), "°", (v) => callbacks?.onPatchSelectedNode?.({ rotation: v }))}
                      {positionInput("Opacity", "op", Math.round((node.style.opacity || 1) * 100), "%", (v) => callbacks?.onPatchSelectedNode?.({ opacity: Math.max(0, Math.min(100, v)) / 100 }))}
                    </div>
                    <div className="dg-layer-fill-row">
                      <button
                        type="button"
                        className="dg-color-chip"
                        style={{ background: colorToCssString(styleColor), width: 28, height: 28 }}
                        onClick={() => setIsColorEditorOpen((prev) => !prev)}
                      />
                      <span className="dg-list-item-subtle">{styleColorLabel}</span>
                      <PillButton tone="neutral" size="sm" onClick={() => setIsColorEditorOpen((prev) => !prev)}>
                        {isColorEditorOpen ? "Close" : "Edit"}
                      </PillButton>
                    </div>
                    {isColorEditorOpen && (
                      <div className="dg-layer-color-editor">
                        <ColorPicker
                          color={styleColor}
                          allowGradient
                          documentColors={documentColors}
                          title={styleColorLabel}
                          onChange={(nextColor) => {
                            if (node?.kind === "text") {
                              callbacks?.onPatchSelectedTextStyle?.({ color: nextColor });
                              return;
                            }
                            callbacks?.onPatchSelectedNode?.({ fill: nextColor });
                          }}
                          onClose={() => setIsColorEditorOpen(false)}
                        />
                      </div>
                    )}

                    {isSingleTextSelection && (
                      <div className="dg-layer-text-editor">
                        <label className="dg-layer-prop-field">
                          <span>Text</span>
                          <textarea
                            className="dg-input dg-textarea dg-layer-textarea"
                            value={textContentDraft}
                            onChange={(event) => {
                              const next = event.target.value;
                              setTextContentDraft(next);
                              callbacks?.onSetSelectedTextContent?.(next);
                            }}
                            onBlur={commitTextContentDraft}
                            onKeyDown={(event) => {
                              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                                event.preventDefault();
                                commitTextContentDraft();
                                return;
                              }
                              if (event.key === "Escape") {
                                event.preventDefault();
                                setTextContentDraft(String(node.text || ""));
                              }
                            }}
                          />
                        </label>

                        <div className="dg-layer-props-grid">
                          <label className="dg-layer-prop-field">
                            <span>Size</span>
                            <input
                              type="number"
                              value={textNumericDrafts.size}
                              onChange={(event) => {
                                const next = event.target.value;
                                setTextNumericDrafts((prev) => ({ ...prev, size: next }));
                                applyTextNumericLive("size", next);
                              }}
                              onBlur={() => commitTextNumericDraft("size")}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  commitTextNumericDraft("size");
                                  return;
                                }
                                if (event.key === "Escape") {
                                  event.preventDefault();
                                  const textStyle = node.text_style as Record<string, unknown> | undefined;
                                  setTextNumericDrafts((prev) => ({ ...prev, size: String(Math.max(1, Math.round(Number(textStyle?.size || 42)))) }));
                                }
                              }}
                            />
                          </label>
                          <label className="dg-layer-prop-field">
                            <span>Line height %</span>
                            <input
                              type="number"
                              value={textNumericDrafts.lineHeight}
                              onChange={(event) => {
                                const next = event.target.value;
                                setTextNumericDrafts((prev) => ({ ...prev, lineHeight: next }));
                                applyTextNumericLive("lineHeight", next);
                              }}
                              onBlur={() => commitTextNumericDraft("lineHeight")}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  commitTextNumericDraft("lineHeight");
                                  return;
                                }
                                if (event.key === "Escape") {
                                  event.preventDefault();
                                  const textStyle = node.text_style as Record<string, unknown> | undefined;
                                  setTextNumericDrafts((prev) => ({ ...prev, lineHeight: String(Math.max(1, Math.round(Number(textStyle?.line_height || 120)))) }));
                                }
                              }}
                            />
                          </label>
                          <label className="dg-layer-prop-field">
                            <span>Tracking</span>
                            <input
                              type="number"
                              value={textNumericDrafts.tracking}
                              onChange={(event) => {
                                const next = event.target.value;
                                setTextNumericDrafts((prev) => ({ ...prev, tracking: next }));
                                applyTextNumericLive("tracking", next);
                              }}
                              onBlur={() => commitTextNumericDraft("tracking")}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  commitTextNumericDraft("tracking");
                                  return;
                                }
                                if (event.key === "Escape") {
                                  event.preventDefault();
                                  const textStyle = node.text_style as Record<string, unknown> | undefined;
                                  setTextNumericDrafts((prev) => ({ ...prev, tracking: String(Math.round(Number(textStyle?.letter_spacing || 0))) }));
                                }
                              }}
                            />
                          </label>
                        </div>

                        <div className="dg-layer-text-align-row">
                          {([
                            { id: "left", label: "Left" },
                            { id: "center", label: "Center" },
                            { id: "right", label: "Right" },
                            { id: "justify", label: "Justify" },
                          ] as const).map((alignOption) => (
                            <button
                              key={`text-align-${alignOption.id}`}
                              type="button"
                              className={`dg-layer-text-align-btn ${textAlignValue === alignOption.id ? "active" : ""}`}
                              onClick={() => callbacks?.onPatchSelectedTextStyle?.({ text_align: alignOption.id })}
                            >
                              {alignOption.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="dg-empty-state-title">Select one or more layers to unlock properties and quick actions.</div>
          )}
        </>
      )}

      {activeTab === "layers" && (
        <>
          {selectedIdList.length > 0 ? (
            <div className="dg-layer-selection-summary">
              <div className="dg-layer-selection-summary-head">
                <div className="dg-layer-selection-summary-copy">
                  <div className="dg-panel-subtitle">Pinned selection</div>
                  <strong>{selectionCount > 1 ? `${selectionCount} active layers` : (node?.name || node?.kind || "Selection")}</strong>
                  {selectionPath.length > 0 ? (
                    <div className="dg-layer-path">
                      {selectionPath.map((segment, index) => (
                        <span key={`selection-path-${index}-${segment}`} className="dg-layer-path-segment">{segment}</span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="dg-layer-selection-actions">
                <PillButton tone="neutral" size="sm" onClick={() => callbacks?.onDuplicateSelection?.()}>Duplicate</PillButton>
                <PillButton tone="neutral" size="sm" onClick={() => callbacks?.onToggleSelectionLock?.()}>Lock</PillButton>
                <PillButton tone="neutral" size="sm" onClick={() => callbacks?.onToggleSelectionVisibility?.()}>Hide</PillButton>
                <PillButton tone="neutral" size="sm" onClick={() => callbacks?.onDeleteSelection?.()}>Delete</PillButton>
              </div>
              <div className="dg-layer-selection-chips">
                {selectedLayerNames.map((label, index) => (
                  <span key={`selected-layer-${index}-${label}`} className="dg-layer-selection-chip">{label}</span>
                ))}
                {selectedLayerRows.length > selectedLayerNames.length ? (
                  <span className="dg-layer-selection-chip">+{selectedLayerRows.length - selectedLayerNames.length}</span>
                ) : null}
              </div>
            </div>
          ) : null}
          <div className="dg-layers-list" ref={layersListRef}>
            {visibleLayerRows.length > 0 ? visibleLayerRows.map((layerRow) => {
              const layerNode = layerRow.node;
              const isSelected = selectedSet.has(layerNode.id);
              const isEditing = editingLayerId === layerNode.id;
              const dropBefore = dropIndicator?.targetId === layerNode.id && dropIndicator.placement === "before";
              const dropAfter = dropIndicator?.targetId === layerNode.id && dropIndicator.placement === "after";
              const showCollapse = layerRow.hasChildren;
              const collapsed = layerRow.collapsed;
              const parentPath = buildLayerPath(layerNode.id);
              return (
                <div
                  key={layerNode.id}
                  ref={(el) => {
                    if (el) layerRowRefs.current.set(layerNode.id, el);
                    else layerRowRefs.current.delete(layerNode.id);
                  }}
                  className={[
                    "dg-layer-item",
                    isSelected ? "active" : "",
                    draggingId === layerNode.id ? "dragging" : "",
                    dropBefore ? "drop-before" : "",
                    dropAfter ? "drop-after" : "",
                  ].filter(Boolean).join(" ")}
                  draggable={!isEditing}
                  onDragStart={(event) => {
                    if (isEditing) {
                      event.preventDefault();
                      return;
                    }
                    setDraggingId(layerNode.id);
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", layerNode.id);
                  }}
                  onDragEnd={() => {
                    setDraggingId(null);
                    setDropIndicator(null);
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    autoScrollLayersDuringDrag(event.clientY);
                    const sourceId = String(draggingId || "").trim();
                    if (!sourceId || sourceId === layerNode.id) return;
                    const rect = (event.currentTarget as HTMLDivElement).getBoundingClientRect();
                    const placement: "before" | "after" = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
                    setDropIndicator({ targetId: layerNode.id, placement });
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const sourceId = String(draggingId || event.dataTransfer.getData("text/plain") || "").trim();
                    if (!sourceId || sourceId === layerNode.id || !dropIndicator || dropIndicator.targetId !== layerNode.id) {
                      setDraggingId(null);
                      setDropIndicator(null);
                      return;
                    }
                    const sourceIds = selectedSet.has(sourceId) && selectedIdList.length > 1
                      ? selectedIdList
                      : [sourceId];
                    if (sourceIds.includes(layerNode.id)) {
                      setDraggingId(null);
                      setDropIndicator(null);
                      return;
                    }
                    callbacks?.onMoveLayerByList?.(sourceIds, layerNode.id, dropIndicator.placement);
                    setDraggingId(null);
                    setDropIndicator(null);
                  }}
                  onClick={(event) => {
                    if (isEditing) return;
                    handleLayerClick(event, layerNode.id);
                  }}
                >
                  <span
                    className="dg-layer-name"
                    style={{ paddingLeft: `${Math.min(9, Math.max(0, layerRow.depth)) * 14}px` }}
                    onDoubleClick={(event) => {
                      event.stopPropagation();
                      beginRenameLayer(layerNode);
                    }}
                  >
                    <button
                      type="button"
                      className={`dg-layer-tree-toggle ${showCollapse ? "has-children" : "placeholder"}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (!showCollapse) return;
                        toggleLayerCollapse(layerNode.id);
                      }}
                      aria-label={showCollapse ? (collapsed ? "Expand group" : "Collapse group") : "No children"}
                      title={showCollapse ? (collapsed ? "Expand group" : "Collapse group") : ""}
                    >
                      {showCollapse ? <PinselaIcon name={collapsed ? "ChevronRight" : "ChevronDown"} size={12} /> : null}
                    </button>
                    <PinselaIcon name={kindIcons[layerNode.kind] || "Square"} size={12} />
                    {isEditing ? (
                      <input
                        type="text"
                        className="dg-layer-name-input"
                        value={editingLayerName}
                        autoFocus
                        onChange={(event) => setEditingLayerName(event.target.value)}
                        onBlur={() => finishRenameLayer(layerNode)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            finishRenameLayer(layerNode);
                            return;
                          }
                          if (event.key === "Escape") {
                            event.preventDefault();
                            cancelRenameLayer();
                          }
                        }}
                        onClick={(event) => event.stopPropagation()}
                        onPointerDown={(event) => event.stopPropagation()}
                      />
                    ) : (
                      <span className="dg-layer-name-stack">
                        <span className="dg-layer-name-label">{resolveNodeDisplayName(layerNode)}</span>
                        {isSelected && parentPath.length > 0 ? (
                          <span className="dg-layer-name-meta">{parentPath.join(" / ")}</span>
                        ) : null}
                      </span>
                    )}
                  </span>
                  <div className="dg-layer-actions">
                    <IconButton
                      size="sm"
                      icon={<PinselaIcon name={layerNode.style.visible === false ? "EyeOff" : "Eye"} size={14} />}
                      title={layerNode.style.visible === false ? "Show layer" : "Hide layer"}
                      aria-label={layerNode.style.visible === false ? "Show layer" : "Hide layer"}
                      onClick={(event) => {
                        event.stopPropagation();
                        callbacks?.onToggleVisibility?.(layerNode.id);
                      }}
                    />
                    <IconButton
                      size="sm"
                      icon={<PinselaIcon name={layerNode.style.locked ? "Lock" : "Unlock"} size={14} />}
                      title={layerNode.style.locked ? "Unlock layer" : "Lock layer"}
                      aria-label={layerNode.style.locked ? "Unlock layer" : "Lock layer"}
                      onClick={(event) => {
                        event.stopPropagation();
                        callbacks?.onToggleLock?.(layerNode.id);
                      }}
                    />
                    <IconButton
                      size="sm"
                      icon={<PinselaIcon name="Trash2" size={14} />}
                      title="Delete layer"
                      aria-label="Delete layer"
                      onClick={(event) => {
                        event.stopPropagation();
                        callbacks?.onDeleteNode?.(layerNode.id);
                      }}
                    />
                  </div>
                </div>
              );
            }) : (
              <div className="dg-empty-state">
                <div className="dg-empty-state-title">
                  No layers in the document yet.
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export function HistorySection({ entries, callbacks }: { entries?: LeftPanelHistoryItem[]; callbacks?: LeftPanelCallbacks }) {
  const rows = entries || [];
  return (
    <div className="dg-panel-section">
      <div className="dg-panel-subtitle">History</div>
      <div className="dg-panel-stack">
        <PillButton tone="neutral" onClick={() => callbacks?.onOpenVersions?.()}>Open versions</PillButton>
      </div>
      <div className="dg-history-list">
        {rows.length > 0 ? rows.map((entry, index) => (
          <button
            type="button"
            key={entry.id}
            className={`dg-history-row ${entry.active ? "active" : ""}`}
            onClick={() => callbacks?.onJumpToHistory?.(index)}
          >
            {entry.label}
          </button>
        )) : <div className="dg-empty-state-title">No snapshots in history.</div>}
      </div>
    </div>
  );
}
