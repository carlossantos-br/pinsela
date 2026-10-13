import React from "react";
import ReactDOM from "react-dom";
import {
  IconButton,
  PillButton,
  PinselaIcon,
  ColorPicker,
  colorToCssString,
  isGradientColorValue,
  type ColorPickerValue,
} from "../index";
import { buildToolbarModel, type ToolbarAction, type ToolbarActionId, type ToolbarCanvasMode } from "./toolbarModel";
import type { SelectionSummary } from "./selectionSummary";
import { useHoverHelpTooltip } from "../HoverHelpTooltip";
import { FONT_LIBRARY, resolveFontStyleForFamily } from "../fonts/fontLibrary";

export interface ContextToolbarTextState {
  fontFamily: string;
  fontStyle?: string;
  fontSize: number;
  lineHeight: number;
  tracking: number;
  color: unknown;
  textAlign?: "left" | "center" | "right" | "justify";
  fitMode?: "free" | "fit";
  canItalic?: boolean;
  canUnderline?: boolean;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  radius?: number;
  startAngle?: number;
  sweepAngle?: number;
  hasPath?: boolean;
}

function normalizeFontToken(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

type TextAlignValue = "left" | "center" | "right" | "justify";
/** Immediate tooltip (same look as the icons) for controls that are raw buttons/fields. */
function TipWrap({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  const help = useHoverHelpTooltip({ label, description, delayMs: 350 });
  return (
    <>
      <span className="dg-tip-wrap" {...help.bind}>{children}</span>
      {help.tooltip}
    </>
  );
}

type TextToolbarDropdown = "mode" | "align" | "spacing" | "path";
type EditMenuOption = {
  id: ToolbarActionId;
  label: string;
  description: string;
  icon: React.ComponentProps<typeof PinselaIcon>["name"];
};

function normalizeTextAlign(value?: string): TextAlignValue {
  if (value === "center" || value === "right" || value === "justify") return value;
  return "left";
}

function textAlignActionId(value: TextAlignValue): ToolbarActionId {
  if (value === "center") return "align_center";
  if (value === "right") return "align_right";
  if (value === "justify") return "align_justify";
  return "align_left";
}

function textAlignIconName(value: TextAlignValue): string {
  if (value === "center") return "AlignCenter";
  if (value === "right") return "AlignRight";
  if (value === "justify") return "AlignJustify";
  return "AlignLeft";
}

function textAlignLabel(value: TextAlignValue): string {
  if (value === "center") return "Center";
  if (value === "right") return "Right";
  if (value === "justify") return "Justify";
  return "Left";
}

export interface ContextToolbarLineState {
  color: unknown;
  width: number;
  opacity: number; // 0..100
  dashPreset: "solid" | "dash" | "long_dash" | "dotted";
  roundedEndpoints: boolean;
}

export interface ContextToolbarElementOpacityState {
  opacity: number; // 0..100
}

export interface ContextToolbarImageBrushState {
  enabled: boolean;
  mode: "shadow" | "erase";
  color: unknown;
  size: number;
  opacity: number;
  flow: number;
  hardness: number;
  accumulation: number;
  spacing: number;
  shape: number;
  rotation: number;
}

export interface ContextToolbarImageDuotoneState {
  enabled: boolean;
  shadows: unknown;
  highlights: unknown;
  amount: number;
}

export interface ContextToolbarImageFadeState {
  enabled: boolean;
  softness: number;
  linear: { angle: number; start: number; end: number } | null;
  radial: { cx: number; cy: number; inner: number; outer: number } | null;
  edges: { top: number; right: number; bottom: number; left: number };
}

export interface ContextToolbarImageTraceState {
  edgeThreshold: number; // 0..100
  curveTolerance: number; // 0..100
  processing?: boolean;
}

export interface ContextToolbarImageBackgroundRemovalState {
  processing: boolean;
  error?: string | null;
}

export interface ContextToolbarProps {
  visible: boolean;
  selectionSummary: SelectionSummary;
  canvasMode: ToolbarCanvasMode;
  anchor?: "top_center" | "near_selection";
  zoom: number;
  snapEnabled?: boolean;
  gridEnabled?: boolean;
  artboardFill?: unknown;
  textState?: ContextToolbarTextState;
  shapeState?: {
    cornerRadius: number;
    maxCornerRadius: number;
    fill?: unknown;
    stroke?: unknown;
    strokeEnabled?: boolean;
    strokeWidth?: number;
    strokeDashPreset?: "solid" | "dash" | "long_dash" | "dotted";
    shapeType?: string;
    shapeSides?: number;
    starPoints?: number;
  };
  lineState?: ContextToolbarLineState;
  elementOpacityState?: ContextToolbarElementOpacityState;
  imageDuotoneState?: ContextToolbarImageDuotoneState;
  imageFadeState?: ContextToolbarImageFadeState;
  imageBrushState?: ContextToolbarImageBrushState;
  imageTraceState?: ContextToolbarImageTraceState;
  imageBackgroundRemovalState?: ContextToolbarImageBackgroundRemovalState;
  documentColors?: unknown[];
  style?: React.CSSProperties;
  onAction?: (actionId: ToolbarActionId, payload?: Record<string, unknown>) => void;
}

function useCompactScale(deps: React.DependencyList) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = React.useState(1);

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const parent = el.parentElement;
    const parentRect = parent?.getBoundingClientRect();
    const sideMargin = parentRect
      ? Math.max(24, Math.min(parentRect.left, window.innerWidth - parentRect.right))
      : 24;
    const available = Math.max(520, Math.min(window.innerWidth - 40, window.innerWidth - sideMargin * 1.15));
    const natural = el.scrollWidth;
    if (!natural) {
      setScale(1);
      return;
    }
    const next = natural > available ? Math.max(0.88, available / natural) : 1;
    if (Math.abs(next - scale) > 0.01) {
      setScale(next);
    }
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  return { ref, scale };
}

function iconForAction(actionId: ToolbarActionId): React.ReactNode {
  switch (actionId) {
    case "tool_select": return <PinselaIcon name="MousePointer2" size={14} />;
    case "tool_pan": return <PinselaIcon name="Hand" size={14} />;
    case "toggle_snap": return <PinselaIcon name="Magnet" size={14} />;
    case "toggle_grid": return <PinselaIcon name="Grid" size={14} />;
    case "artboard_fill": return <PinselaIcon name="PaintBucket" size={14} />;
    case "arrange_backward": return <PinselaIcon name="ArrowDownToLine" size={14} />;
    case "arrange_forward": return <PinselaIcon name="ArrowUpToLine" size={14} />;
    case "arrange_back": return <PinselaIcon name="ArrowDown" size={14} />;
    case "arrange_front": return <PinselaIcon name="ArrowUp" size={14} />;
    case "align_left": return <PinselaIcon name="AlignLeft" size={14} />;
    case "align_center": return <PinselaIcon name="AlignCenter" size={14} />;
    case "align_right": return <PinselaIcon name="AlignRight" size={14} />;
    case "align_justify": return <PinselaIcon name="AlignJustify" size={14} />;
    case "align_top": return <PinselaIcon name="AlignVerticalJustifyStart" size={14} />;
    case "align_middle": return <PinselaIcon name="AlignVerticalJustifyCenter" size={14} />;
    case "align_bottom": return <PinselaIcon name="AlignVerticalJustifyEnd" size={14} />;
    case "distribute_h": return <PinselaIcon name="AlignHorizontalDistributeCenter" size={14} />;
    case "distribute_v": return <PinselaIcon name="AlignVerticalDistributeCenter" size={14} />;
    case "group": return <PinselaIcon name="Group" size={14} />;
    case "ungroup": return <PinselaIcon name="Ungroup" size={14} />;
    case "toggle_lock": return <PinselaIcon name="Lock" size={14} />;
    case "toggle_visibility": return <PinselaIcon name="EyeOff" size={14} />;
    case "edit_menu": return <PinselaIcon name="SlidersHorizontal" size={14} />;
    case "line_color": return <PinselaIcon name="Paintbrush" size={14} />;
    case "line_weight": return <PinselaIcon name="Minus" size={14} />;
    case "line_style": return <PinselaIcon name="SlidersHorizontal" size={14} />;
    case "line_opacity": return <span className="dg-toolbar-opacity-glyph" aria-hidden="true" />;
    case "element_opacity": return <span className="dg-toolbar-opacity-glyph" aria-hidden="true" />;
    case "text_bold": return <PinselaIcon name="Bold" size={14} />;
    case "text_italic": return <PinselaIcon name="Italic" size={14} />;
    case "text_underline": return <PinselaIcon name="Underline" size={14} />;
    case "text_fit_mode": return <PinselaIcon name="RectangleHorizontal" size={14} />;
    case "text_align_menu": return <PinselaIcon name="AlignLeft" size={14} />;
    case "text_spacing_menu": return <PinselaIcon name="Rows3" size={14} />;
    case "text_path_menu": return <PinselaIcon name="SplinePointer" size={14} />;
    case "text_line_height": return <PinselaIcon name="Rows3" size={14} />;
    case "text_tracking": return <PinselaIcon name="BetweenHorizontalStart" size={14} />;
    case "text_path_toggle": return <PinselaIcon name="SplinePointer" size={14} />;
    case "convert_to_curves": return <PinselaIcon name="Spline" size={14} />;
    case "shape_stroke": return <PinselaIcon name="Square" size={14} />;
    case "image_crop": return <PinselaIcon name="Crop" size={14} />;
    case "image_remove_background": return <PinselaIcon name="Sparkles" size={14} />;
    case "image_duotone": return <PinselaIcon name="Contrast" size={14} />;
    case "image_fade": return <PinselaIcon name="Blend" size={14} />;
    case "image_brush": return <PinselaIcon name="Brush" size={14} />;
    case "image_trace": return <PinselaIcon name="ScanLine" size={14} />;
    case "vectorize_image": return <PinselaIcon name="ScanLine" size={14} />;
    case "perspective_warp": return <PinselaIcon name="Expand" size={14} />;
    case "effects_menu": return <PinselaIcon name="Sparkles" size={14} />;
    case "image_replace": return <PinselaIcon name="Replace" size={14} />;
    case "component_sync": return <PinselaIcon name="RefreshCcw" size={14} />;
    case "component_merge": return <PinselaIcon name="Merge" size={14} />;
    case "component_reset": return <PinselaIcon name="Undo" size={14} />;
    case "component_highlight": return <PinselaIcon name="MousePointerClick" size={14} />;
    case "mode_confirm": return <PinselaIcon name="Check" size={14} />;
    case "mode_cancel": return <PinselaIcon name="X" size={14} />;
    case "mode_reset_crop": return <PinselaIcon name="RotateCcw" size={14} />;
    case "path_exit": return <PinselaIcon name="LogOut" size={14} />;
    case "path_reset": return <PinselaIcon name="RotateCcw" size={14} />;
    case "path_add": return <PinselaIcon name="Plus" size={14} />;
    case "path_remove": return <PinselaIcon name="Minus" size={14} />;
    case "path_smooth": return <PinselaIcon name="Blend" size={14} />;
    case "path_corner": return <PinselaIcon name="CornerDownRight" size={14} />;
    case "text_exit": return <PinselaIcon name="LogOut" size={14} />;
    case "fit_view": return <PinselaIcon name="Expand" size={14} />;
    case "reset_zoom": return <PinselaIcon name="ZoomOut" size={14} />;
    default: return <PinselaIcon name="MoreHorizontal" size={14} />;
  }
}

function pillLabel(actionId: ToolbarActionId): string {
  switch (actionId) {
    case "image_fit": return "Fit";
    case "image_fill": return "Fill";
    case "component_go_source": return "Go to source";
    case "style_menu": return "...";
    case "text_style_menu": return "...";
    case "images_menu": return "...";
    case "edit_menu": return "Edit";
    case "zoom_menu": return "Zoom";
    default: return "Action";
  }
}

function actionLabel(actionId: ToolbarActionId): string {
  switch (actionId) {
    case "tool_select": return "Select";
    case "tool_pan": return "Pan";
    case "toggle_snap": return "Snap to guides";
    case "toggle_grid": return "Grid";
    case "zoom_menu": return "Zoom";
    case "fit_view": return "Fit view";
    case "reset_zoom": return "Reset to 100%";
    case "group": return "Group";
    case "ungroup": return "Ungroup";
    case "toggle_lock": return "Lock";
    case "toggle_visibility": return "Visibility";
    case "edit_menu": return "Edit";
    case "arrange_backward": return "Send backward";
    case "arrange_forward": return "Bring forward";
    case "arrange_back": return "Send to back";
    case "arrange_front": return "Bring to front";
    case "align_left": return "Align left";
    case "align_center": return "Center";
    case "align_right": return "Align right";
    case "align_justify": return "Justify";
    case "align_top": return "Align top";
    case "align_middle": return "Center vertically";
    case "align_bottom": return "Align bottom";
    case "distribute_h": return "Distribute horizontally";
    case "distribute_v": return "Distribute vertically";
    case "shape_fill": return "Fill";
    case "shape_stroke": return "Border";
    case "artboard_fill": return "Page color";
    case "shape_radius": return "Corner radius";
    case "shape_sides": return "Polygon sides";
    case "shape_points": return "Star points";
    case "line_color": return "Stroke color";
    case "line_weight": return "Stroke weight";
    case "line_style": return "Stroke style";
    case "line_opacity": return "Stroke opacity";
    case "element_opacity": return "Opacity";
    case "text_font": return "Font";
    case "text_fit_mode": return "Text mode";
    case "text_align_menu": return "Text alignment";
    case "text_spacing_menu": return "Text spacing";
    case "text_path_menu": return "Curved text";
    case "text_size": return "Font size";
    case "text_color": return "Text color";
    case "text_bold": return "Bold";
    case "text_italic": return "Italic";
    case "text_underline": return "Underline";
    case "text_line_height": return "Line height";
    case "text_tracking": return "Tracking";
    case "text_path_toggle": return "Text on path";
    case "convert_to_curves": return "Convert to curves";
    case "image_fit": return "Fit image";
    case "image_fill": return "Fill frame";
    case "image_crop": return "Crop image";
    case "image_remove_background": return "Remove background";
    case "image_duotone": return "Duotone";
    case "image_fade": return "Fade";
    case "image_brush": return "Brush";
    case "image_trace": return "Trace image";
    case "vectorize_image": return "Vectorize";
    case "perspective_warp": return "Perspective";
    case "effects_menu": return "Effects";
    case "image_replace": return "Replace image";
    case "mode_confirm": return "Confirm";
    case "mode_cancel": return "Cancel";
    case "mode_reset_crop": return "Reset crop";
    case "path_exit": return "Exit point editing";
    case "path_reset": return "Reset path";
    case "path_add": return "Add point";
    case "path_remove": return "Remove point";
    case "path_smooth": return "Smooth point";
    case "path_corner": return "Corner point";
    case "path_radius": return "Path radius";
    case "path_start_angle": return "Start angle";
    case "path_sweep_angle": return "End angle";
    case "text_exit": return "Exit text editing";
    default: return actionId.replace(/_/g, " ");
  }
}

function actionDescription(actionId: ToolbarActionId): string {
  switch (actionId) {
    case "tool_select": return "Returns to selection mode to move, resize, and change focus without leaving the canvas.";
    case "tool_pan": return "Pans the visible canvas area without changing the current selection.";
    case "toggle_snap": return "Turns magnetic guides on or off while moving and resizing.";
    case "toggle_grid": return "Turns grid snapping on or off for precise positioning.";
    case "zoom_menu": return "Shows quick zoom options without opening heavy menus.";
    case "fit_view": return "Fits the page in the visible canvas area.";
    case "reset_zoom": return "Resets the zoom to 100%.";
    case "edit_menu": return "Opens contextual actions for finishing, effects, vectorizing, and perspective.";
    case "shape_radius": return "Opens the corner controls for the selected element with immediate numeric adjustment.";
    case "shape_sides": return "Sets the number of sides of the selected polygon.";
    case "shape_points": return "Sets the number of points of the selected star.";
    case "shape_stroke": return "Turns on the rectangle border and adjusts its color and thickness.";
    case "artboard_fill": return "Opens the color picker for the current page.";
    case "line_color": return "Opens the stroke color picker for the selected element.";
    case "line_weight": return "Changes the stroke thickness of the selected layer.";
    case "line_style": return "Opens stroke style, dashes, and caps.";
    case "line_opacity": return "Controls the stroke transparency.";
    case "element_opacity": return "Controls the transparency of the selected layer.";
    case "align_justify": return "Spreads the text to fill the width of the text box.";
    case "text_font": return "Opens the font family and style picker.";
    case "text_fit_mode": return "Switches between free text and text that shrinks to fit the box.";
    case "text_align_menu": return "Groups text alignment options in a compact menu.";
    case "text_spacing_menu": return "Adjusts line height and letter spacing.";
    case "text_path_menu": return "Adjusts curved text, radius, and path angles.";
    case "text_size": return "Changes the size of the selected text.";
    case "text_color": return "Opens the color picker and applies it to the selected text.";
    case "text_bold": return "Turns bold on or off for the selected text.";
    case "text_italic": return "Turns italic on or off for the selected text.";
    case "text_underline": return "Turns underline on or off for the selected text.";
    case "convert_to_curves": return "Turns the current selection into editable vectors and opens point editing.";
    case "image_fit": return "Fits the image inside the frame without distorting its proportions.";
    case "image_fill": return "Fills the frame with the image, cropping when needed.";
    case "image_crop": return "Enters crop mode for the selected image.";
    case "image_remove_background": return "Automatically cuts out the main subject of the image and produces a PNG with refined transparency.";
    case "image_duotone": return "Applies a two-tone recolor while preserving transparency.";
    case "image_brush": return "Opens the image brush controls for shading or soft erasing.";
    case "image_trace": return "Traces the image edges to generate editable vectors.";
    case "vectorize_image": return "Converts the raster image into editable vector paths.";
    case "perspective_warp": return "Opens perspective adjustment to distort the selection.";
    case "effects_menu": return "Opens shadows, blur, and visual finishes for the selection.";
    case "image_replace": return "Opens the asset library to replace the current image.";
    case "mode_confirm": return "Confirms the current edit and applies the result.";
    case "mode_cancel": return "Cancels the current edit and returns to the previous state.";
    case "mode_reset_crop": return "Resets the crop of the selected image.";
    default: return "Runs this action on the current selection or the active canvas mode.";
  }
}

export function ContextToolbar({
  visible,
  selectionSummary,
  canvasMode,
  anchor = "top_center",
  zoom,
  snapEnabled = true,
  gridEnabled = true,
  artboardFill,
  textState,
  shapeState,
  lineState,
  elementOpacityState,
  imageDuotoneState,
  imageFadeState,
  imageBrushState,
  imageTraceState,
  imageBackgroundRemovalState,
  documentColors,
  style,
  onAction,
}: ContextToolbarProps) {
  const stopCanvasGesturePropagation = React.useCallback((event: React.SyntheticEvent) => {
    const target = event.target;
    if (
      typeof Element !== "undefined"
      && target instanceof Element
      && target.closest('[data-function-panel-trigger="true"]')
    ) {
      event.preventDefault();
    }
    event.stopPropagation();
  }, []);
  const model = React.useMemo(
    () => buildToolbarModel({ canvasMode, selection: selectionSummary }),
    [canvasMode, selectionSummary],
  );

  const [fontSizeInput, setFontSizeInput] = React.useState("42");
  const [textLineHeightInput, setTextLineHeightInput] = React.useState("120");
  const [textTrackingInput, setTextTrackingInput] = React.useState("0");
  const [fontSearchInput, setFontSearchInput] = React.useState("");
  const [expandedFontFamily, setExpandedFontFamily] = React.useState<string | null>(null);
  const [shapeRadiusInput, setShapeRadiusInput] = React.useState("0");
  const [shapeSidesInput, setShapeSidesInput] = React.useState("6");
  const [starPointsInput, setStarPointsInput] = React.useState("5");
  const [shapeStrokeWidthInput, setShapeStrokeWidthInput] = React.useState("2");
  const [lineWeightInput, setLineWeightInput] = React.useState("4");
  const [lineOpacityInput, setLineOpacityInput] = React.useState("100");
  const [elementOpacityInput, setElementOpacityInput] = React.useState("100");
  const [pathRadiusInput, setPathRadiusInput] = React.useState("120");
  const [pathStartInput, setPathStartInput] = React.useState("0");
  const [pathSweepInput, setPathSweepInput] = React.useState("180");
  const [isColorPickerOpen, setIsColorPickerOpen] = React.useState(false);
  const [colorPickerTarget, setColorPickerTarget] = React.useState<
    "text" | "line" | "shape_fill" | "shape_stroke" | "artboard" | "brush" | "duotone_shadows" | "duotone_highlights"
  >("text");
  const [isShapeRadiusOpen, setIsShapeRadiusOpen] = React.useState(false);
  const [isLineStyleOpen, setIsLineStyleOpen] = React.useState(false);
  const [isImageDuotoneOpen, setIsImageDuotoneOpen] = React.useState(false);
  const [isImageFadeOpen, setIsImageFadeOpen] = React.useState(false);
  const [isImageBrushOpen, setIsImageBrushOpen] = React.useState(false);
  const [isImageTraceOpen, setIsImageTraceOpen] = React.useState(false);
  const [isTextFontOpen, setIsTextFontOpen] = React.useState(false);
  const [isOpacityOpen, setIsOpacityOpen] = React.useState(false);
  const [isEditMenuOpen, setIsEditMenuOpen] = React.useState(false);
  const [editMenuAnchorRect, setEditMenuAnchorRect] = React.useState<DOMRect | null>(null);
  const [activeTextDropdown, setActiveTextDropdown] = React.useState<TextToolbarDropdown | null>(null);
  const [opacityTarget, setOpacityTarget] = React.useState<"element" | "line">("element");
  const [traceEdgeThreshold, setTraceEdgeThreshold] = React.useState(50);
  const [traceCurveTolerance, setTraceCurveTolerance] = React.useState(40);
  const sidePanelRef = React.useRef<HTMLDivElement | null>(null);
  const onActionRef = React.useRef(onAction);

  React.useEffect(() => {
    onActionRef.current = onAction;
  }, [onAction]);

  const emit = React.useCallback((actionId: ToolbarActionId, payload?: Record<string, unknown>) => {
    onActionRef.current?.(actionId, payload);
  }, []);

  React.useEffect(() => {
    setFontSizeInput(String(Math.round(textState?.fontSize || 42)));
    setTextLineHeightInput(String(Math.round(textState?.lineHeight || 120)));
    setTextTrackingInput(String(Math.round(textState?.tracking || 0)));
    setShapeRadiusInput(String(Math.round(shapeState?.cornerRadius || 0)));
    setShapeSidesInput(String(Math.max(3, Math.round(Number(shapeState?.shapeSides ?? 6)))));
    setStarPointsInput(String(Math.max(4, Math.round(Number(shapeState?.starPoints ?? 5)))));
    setShapeStrokeWidthInput(String(Math.max(1, Math.round(Number(shapeState?.strokeWidth || 2)))));
    setLineWeightInput(String(Math.round(lineState?.width || 4)));
    setLineOpacityInput(String(Math.round(lineState?.opacity ?? 100)));
    setElementOpacityInput(String(Math.round(elementOpacityState?.opacity ?? 100)));
    setPathRadiusInput(String(Math.round(textState?.radius || 120)));
    setPathStartInput(String(Math.round(textState?.startAngle || 0)));
    setPathSweepInput(String(Math.round(textState?.sweepAngle || 180)));
  }, [
    textState?.fontSize,
    textState?.lineHeight,
    textState?.tracking,
    textState?.radius,
    textState?.startAngle,
    textState?.sweepAngle,
    shapeState?.cornerRadius,
    shapeState?.shapeSides,
    shapeState?.starPoints,
    shapeState?.strokeWidth,
    lineState?.width,
    lineState?.opacity,
    elementOpacityState?.opacity,
  ]);

  React.useEffect(() => {
    if (!isTextFontOpen) return;
    const nextFamily = String(textState?.fontFamily || FONT_LIBRARY[0]?.family || "Inter");
    setExpandedFontFamily(nextFamily);
  }, [isTextFontOpen, textState?.fontFamily]);

  React.useEffect(() => {
    if (!imageTraceState) return;
    setTraceEdgeThreshold(Math.max(0, Math.min(100, Math.round(Number(imageTraceState.edgeThreshold || 0)))));
    setTraceCurveTolerance(Math.max(0, Math.min(100, Math.round(Number(imageTraceState.curveTolerance || 0)))));
  }, [imageTraceState?.edgeThreshold, imageTraceState?.curveTolerance]);

  React.useEffect(() => {
    if (isImageTraceOpen) {
      emit("image_trace", {
        phase: "cancel",
        edgeThreshold: traceEdgeThreshold,
        curveTolerance: traceCurveTolerance,
      });
    }
    setIsColorPickerOpen(false);
    setIsShapeRadiusOpen(false);
    setIsLineStyleOpen(false);
    setIsImageDuotoneOpen(false);
    setIsImageFadeOpen(false);
    setIsImageBrushOpen(false);
    setIsImageTraceOpen(false);
    setIsTextFontOpen(false);
    setIsOpacityOpen(false);
    setIsEditMenuOpen(false);
    setEditMenuAnchorRect(null);
    setActiveTextDropdown(null);
  }, [
    selectionSummary.kind,
    selectionSummary.count,
    canvasMode,
    isImageTraceOpen,
    traceEdgeThreshold,
    traceCurveTolerance,
    emit,
  ]);

  const closeFunctionPanels = React.useCallback(() => {
    if (isImageTraceOpen) {
      emit("image_trace", {
        phase: "cancel",
        edgeThreshold: traceEdgeThreshold,
        curveTolerance: traceCurveTolerance,
      });
    }
    setIsColorPickerOpen(false);
    setIsShapeRadiusOpen(false);
    setIsLineStyleOpen(false);
    setIsImageDuotoneOpen(false);
    setIsImageFadeOpen(false);
    setIsImageBrushOpen(false);
    setIsImageTraceOpen(false);
    setIsTextFontOpen(false);
    setIsOpacityOpen(false);
    setIsEditMenuOpen(false);
    setEditMenuAnchorRect(null);
    setActiveTextDropdown(null);
  }, [isImageTraceOpen, emit, traceEdgeThreshold, traceCurveTolerance]);

  const openColorPanel = React.useCallback((
    target: "text" | "line" | "shape_fill" | "shape_stroke" | "artboard" | "brush" | "duotone_shadows" | "duotone_highlights",
  ) => {
    const isSameTarget = isColorPickerOpen && colorPickerTarget === target;
    if (isImageTraceOpen) {
      emit("image_trace", {
        phase: "cancel",
        edgeThreshold: traceEdgeThreshold,
        curveTolerance: traceCurveTolerance,
      });
      setIsImageTraceOpen(false);
    }
    setColorPickerTarget(target);
    setIsShapeRadiusOpen(false);
    setIsLineStyleOpen(false);
    setIsImageDuotoneOpen(false);
    setIsImageBrushOpen(false);
    setIsTextFontOpen(false);
    setIsOpacityOpen(false);
    setIsEditMenuOpen(false);
    setEditMenuAnchorRect(null);
    setActiveTextDropdown(null);
    setIsColorPickerOpen(!isSameTarget);
  }, [
    isColorPickerOpen,
    colorPickerTarget,
    isImageTraceOpen,
    emit,
    traceEdgeThreshold,
    traceCurveTolerance,
  ]);

  const toggleTextDropdown = React.useCallback((dropdown: TextToolbarDropdown) => {
    if (isImageTraceOpen) {
      emit("image_trace", {
        phase: "cancel",
        edgeThreshold: traceEdgeThreshold,
        curveTolerance: traceCurveTolerance,
      });
      setIsImageTraceOpen(false);
    }
    setIsColorPickerOpen(false);
    setIsShapeRadiusOpen(false);
    setIsLineStyleOpen(false);
    setIsImageDuotoneOpen(false);
    setIsImageBrushOpen(false);
    setIsTextFontOpen(false);
    setIsOpacityOpen(false);
    setIsEditMenuOpen(false);
    setEditMenuAnchorRect(null);
    setActiveTextDropdown((current) => (current === dropdown ? null : dropdown));
  }, [isImageTraceOpen, emit, traceEdgeThreshold, traceCurveTolerance]);

  React.useEffect(() => {
    if (
      !isColorPickerOpen
      && !isShapeRadiusOpen
      && !isLineStyleOpen
      && !isImageDuotoneOpen
      && !isImageBrushOpen
      && !isImageTraceOpen
      && !isTextFontOpen
      && !isOpacityOpen
      && !isEditMenuOpen
      && !activeTextDropdown
    ) return;
    const onPointerDown = (event: PointerEvent) => {
      const eventPath = typeof event.composedPath === "function" ? event.composedPath() : [];
      const target = (eventPath[0] as Node | undefined) || (event.target as Node | null);
      if (!target) return;
      const activeElement = document.activeElement;
      if (activeElement instanceof HTMLInputElement && activeElement.type === "color") return;
      const panel = sidePanelRef.current;
      const inPanel = !!panel && (
        panel.contains(target)
        || eventPath.some((entry) => entry instanceof Node && panel.contains(entry))
      );
      if (inPanel) return;
      const fromTrigger = eventPath.some((entry) => (
        entry instanceof Element && !!entry.closest('[data-function-panel-trigger="true"]')
      ));
      if (fromTrigger) return;
      if (target instanceof Element && target.closest('[data-function-panel-trigger="true"]')) return;
      closeFunctionPanels();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [isColorPickerOpen, isShapeRadiusOpen, isLineStyleOpen, isImageDuotoneOpen, isImageFadeOpen, isImageBrushOpen, isImageTraceOpen, isTextFontOpen, isOpacityOpen, isEditMenuOpen, activeTextDropdown, closeFunctionPanels]);

  const { ref, scale } = useCompactScale([
    model,
    anchor,
    textState?.fontFamily,
    textState?.fitMode,
    textState?.textAlign,
    textState?.hasPath,
    activeTextDropdown,
    shapeState?.strokeEnabled,
    shapeState?.strokeDashPreset,
    lineState?.dashPreset,
    lineState?.roundedEndpoints,
    imageDuotoneState?.enabled,
    imageBrushState?.enabled,
    imageTraceState?.processing,
    isEditMenuOpen,
  ]);

  const currentFontFamily = String(textState?.fontFamily || FONT_LIBRARY[0]?.family || "Inter");
  const inferredFontStyle = String(
    textState?.fontStyle
    || (textState?.bold && textState?.italic ? "Bold Italic" : textState?.bold ? "Bold" : textState?.italic ? "Italic" : "Regular"),
  ).trim() || "Regular";
  const currentFontStyle = resolveFontStyleForFamily(currentFontFamily, inferredFontStyle);
  const normalizedCurrentFontStyle = normalizeFontToken(currentFontStyle);
  const normalizedFontQuery = fontSearchInput.trim().toLowerCase();
  const filteredFontFamilies = React.useMemo(() => (
    FONT_LIBRARY.filter((entry) => {
      if (!normalizedFontQuery) return true;
      if (entry.family.toLowerCase().includes(normalizedFontQuery)) return true;
      return entry.variants.some((variant) => variant.label.toLowerCase().includes(normalizedFontQuery));
    })
  ), [normalizedFontQuery]);

  const editMenuOptions = React.useMemo<EditMenuOption[]>(() => {
    const kind = selectionSummary.kind;
    const primary = selectionSummary.primaryType;
    const options: EditMenuOption[] = [];
    const addOption = (option: EditMenuOption) => {
      if (options.some((entry) => entry.id === option.id)) return;
      options.push(option);
    };
    const addSharedFinish = () => {
      addOption({ id: "effects_menu", label: "Effects", description: "Shadows, blur, and finishes.", icon: "Sparkles" });
      addOption({ id: "perspective_warp", label: "Perspective", description: "Distortion and perspective adjustment.", icon: "Expand" });
    };

    if (kind === "single_image" || kind === "multi_homogeneous_image") {
      if (kind === "single_image") {
        addOption({ id: "image_crop", label: "Crop", description: "Adjust the image framing.", icon: "Crop" });
        addOption({ id: "image_duotone", label: "Duotone", description: "Recolor in two tones.", icon: "Contrast" });
        addOption({ id: "image_fade", label: "Fade", description: "Fade the image to transparent.", icon: "Blend" });
        addOption({ id: "image_brush", label: "Brush", description: "Painting, shading, and soft erasing.", icon: "Brush" });
        addOption({ id: "image_trace", label: "Trace image", description: "Preview vector edges.", icon: "ScanLine" });
      }
      addOption({ id: "vectorize_image", label: "Vectorize", description: "Convert to editable paths.", icon: "ScanLine" });
      addSharedFinish();
      return options;
    }

    if (
      kind === "single_shape"
      || kind === "single_frame"
      || kind === "single_group"
      || kind === "multi_homogeneous_shape"
      || kind === "multi_mixed"
    ) {
      addOption({ id: "style_menu", label: "Stroke and borders", description: "Open finishing controls.", icon: "Square" });
      if (primary !== "frame" && primary !== "path") {
        addOption({ id: "convert_to_curves", label: "Convert to curves", description: "Turn into editable vectors.", icon: "Spline" });
      }
      addSharedFinish();
      return options;
    }

    if (kind === "single_text" || kind === "multi_homogeneous_text") {
      addOption({ id: "text_style_menu", label: "Text style", description: "Open finishing controls.", icon: "Type" });
      addOption({ id: "convert_to_curves", label: "Convert to curves", description: "Edit text as a vector.", icon: "Spline" });
      addSharedFinish();
      return options;
    }

    addSharedFinish();
    return options;
  }, [selectionSummary.kind, selectionSummary.primaryType]);

  const handleEditMenuAction = React.useCallback((actionId: ToolbarActionId) => {
    setIsEditMenuOpen(false);
    setEditMenuAnchorRect(null);

    if (actionId === "image_duotone") {
      if (isImageTraceOpen) {
        emit("image_trace", { phase: "cancel", edgeThreshold: traceEdgeThreshold, curveTolerance: traceCurveTolerance });
        setIsImageTraceOpen(false);
      }
      setIsColorPickerOpen(false);
      setIsShapeRadiusOpen(false);
      setIsLineStyleOpen(false);
      setIsImageBrushOpen(false);
      setIsOpacityOpen(false);
      setIsTextFontOpen(false);
      setActiveTextDropdown(null);
      setIsImageFadeOpen(false);
      setIsImageDuotoneOpen(true);
      return;
    }

    if (actionId === "image_fade") {
      if (isImageTraceOpen) {
        emit("image_trace", { phase: "cancel", edgeThreshold: traceEdgeThreshold, curveTolerance: traceCurveTolerance });
        setIsImageTraceOpen(false);
      }
      setIsColorPickerOpen(false);
      setIsShapeRadiusOpen(false);
      setIsLineStyleOpen(false);
      setIsImageDuotoneOpen(false);
      setIsImageBrushOpen(false);
      setIsOpacityOpen(false);
      setIsTextFontOpen(false);
      setActiveTextDropdown(null);
      setIsImageFadeOpen(true);
      return;
    }

    if (actionId === "image_brush") {
      if (isImageTraceOpen) {
        emit("image_trace", { phase: "cancel", edgeThreshold: traceEdgeThreshold, curveTolerance: traceCurveTolerance });
        setIsImageTraceOpen(false);
      }
      setIsColorPickerOpen(false);
      setIsShapeRadiusOpen(false);
      setIsLineStyleOpen(false);
      setIsImageDuotoneOpen(false);
      setIsOpacityOpen(false);
      setIsTextFontOpen(false);
      setActiveTextDropdown(null);
      if (!imageBrushState?.enabled) {
        emit("image_brush", { enabled: true });
      }
      setIsImageBrushOpen(true);
      return;
    }

    if (actionId === "image_trace") {
      setIsColorPickerOpen(false);
      setIsShapeRadiusOpen(false);
      setIsLineStyleOpen(false);
      setIsImageDuotoneOpen(false);
      setIsImageBrushOpen(false);
      setIsOpacityOpen(false);
      setIsTextFontOpen(false);
      setActiveTextDropdown(null);
      setIsImageTraceOpen(true);
      emit("image_trace", {
        phase: "preview",
        edgeThreshold: traceEdgeThreshold,
        curveTolerance: traceCurveTolerance,
      });
      return;
    }

    emit(actionId);
  }, [emit, imageBrushState?.enabled, isImageTraceOpen, traceEdgeThreshold, traceCurveTolerance]);

  if (!visible || model.groups.length === 0) return null;

  function renderAction(action: ToolbarAction) {
    if (action.id === "edit_menu") {
      return (
        <div className="dg-toolbar-edit-wrap" data-function-panel-trigger="true">
          <button
            type="button"
            className={`dg-toolbar-radius-btn ${isEditMenuOpen ? "active" : ""}`}
            title={actionLabel("edit_menu")}
            onClick={(event) => {
              if (isImageTraceOpen) {
                emit("image_trace", { phase: "cancel", edgeThreshold: traceEdgeThreshold, curveTolerance: traceCurveTolerance });
                setIsImageTraceOpen(false);
              }
              setIsColorPickerOpen(false);
              setIsShapeRadiusOpen(false);
              setIsLineStyleOpen(false);
              setIsImageDuotoneOpen(false);
              setIsImageBrushOpen(false);
              setIsOpacityOpen(false);
              setIsTextFontOpen(false);
              setActiveTextDropdown(null);
              const rect = event.currentTarget.getBoundingClientRect();
              setEditMenuAnchorRect(rect);
              setIsEditMenuOpen((current) => {
                if (current) {
                  setEditMenuAnchorRect(null);
                  return false;
                }
                return true;
              });
            }}
          >
            <PinselaIcon name="SlidersHorizontal" size={13} />
            <span>Edit</span>
            <PinselaIcon name="ChevronDown" size={12} />
          </button>
        </div>
      );
    }

    if (action.id === "zoom_menu") {
      return (
        <PillButton
          tone="neutral"
          size="sm"
          onClick={() => emit("zoom_menu")}
          title={actionLabel("zoom_menu")}
          tooltipDescription={actionDescription("zoom_menu")}
        >
          {zoom}% <PinselaIcon name="ChevronDown" size={12} style={{ marginLeft: 4 }} />
        </PillButton>
      );
    }

    if (action.id === "text_font") {
      return (
        <PillButton
          tone="neutral"
          size="sm"
          data-function-panel-trigger="true"
          className={`dg-toolbar-font-btn ${isTextFontOpen ? "active" : ""}`}
          title={actionLabel("text_font")}
          tooltipDescription={actionDescription("text_font")}
          onClick={() => {
            if (isImageTraceOpen) {
              emit("image_trace", { phase: "cancel", edgeThreshold: traceEdgeThreshold, curveTolerance: traceCurveTolerance });
              setIsImageTraceOpen(false);
            }
            const nextOpen = !isTextFontOpen;
            if (nextOpen) {
              setFontSearchInput("");
              setExpandedFontFamily(currentFontFamily);
            }
            setIsColorPickerOpen(false);
            setIsShapeRadiusOpen(false);
            setIsLineStyleOpen(false);
            setIsImageDuotoneOpen(false);
            setIsImageBrushOpen(false);
            setIsOpacityOpen(false);
            setActiveTextDropdown(null);
            setIsTextFontOpen(nextOpen);
          }}
        >
          <span>{textState?.fontFamily || "Inter"}</span>
          <PinselaIcon name="ChevronDown" size={12} />
        </PillButton>
      );
    }

    if (action.id === "text_size") {
      return (
        <div className="dg-toolbar-stepper">
          <button type="button" aria-label="Decrease font size" title="Decrease" onClick={() => emit("text_size", { delta: -1 })}><PinselaIcon name="Minus" size={14} /></button>
          <input
            aria-label="Font size"
            value={fontSizeInput}
            onChange={(event) => {
              const next = event.target.value;
              setFontSizeInput(next);
              const value = Number(next);
              if (Number.isFinite(value)) emit("text_size", { value });
            }}
            onBlur={() => {
              const value = Number(fontSizeInput);
              if (Number.isFinite(value)) emit("text_size", { value });
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                const value = Number(fontSizeInput);
                if (Number.isFinite(value)) emit("text_size", { value });
              }
            }}
          />
          <button type="button" aria-label="Increase font size" title="Increase" onClick={() => emit("text_size", { delta: 1 })}><PinselaIcon name="Plus" size={14} /></button>
        </div>
      );
    }

    if (action.id === "text_color") {
      const textColorCss = colorToCssString(textState?.color || "#2563eb");
      return (
        <button
          type="button"
          data-function-panel-trigger="true"
          className="dg-toolbar-color-btn"
          title="Text color"
          onClick={() => openColorPanel("text")}
        >
          <PinselaIcon name="Type" size={14} />
          <span className="dg-toolbar-color-line" style={{ background: textColorCss }} />
        </button>
      );
    }

    if (action.id === "text_fit_mode") {
      const currentMode = textState?.fitMode === "fit" ? "fit" : "free";
      return (
        <button
          type="button"
          data-function-panel-trigger="true"
          className={`dg-toolbar-radius-btn dg-toolbar-dropdown-btn ${activeTextDropdown === "mode" ? "active" : ""}`}
          title={actionLabel("text_fit_mode")}
          onClick={() => toggleTextDropdown("mode")}
        >
          <PinselaIcon name={currentMode === "fit" ? "WrapText" : "Type"} size={13} />
          <span>{currentMode === "fit" ? "Fit" : "Free"}</span>
          <PinselaIcon name="ChevronDown" size={12} className="dg-toolbar-menu-chevron" />
        </button>
      );
    }

    if (action.id === "text_align_menu") {
      const currentAlign = normalizeTextAlign(textState?.textAlign);
      return (
        <button
          type="button"
          data-function-panel-trigger="true"
          className={`dg-toolbar-radius-btn dg-toolbar-dropdown-btn ${activeTextDropdown === "align" ? "active" : ""}`}
          title={actionLabel("text_align_menu")}
          onClick={() => toggleTextDropdown("align")}
        >
          <PinselaIcon name={textAlignIconName(currentAlign)} size={13} />
          <span>{textAlignLabel(currentAlign)}</span>
          <PinselaIcon name="ChevronDown" size={12} className="dg-toolbar-menu-chevron" />
        </button>
      );
    }

    if (action.id === "text_spacing_menu") {
      return (
        <button
          type="button"
          data-function-panel-trigger="true"
          className={`dg-toolbar-radius-btn dg-toolbar-dropdown-btn ${activeTextDropdown === "spacing" ? "active" : ""}`}
          title={actionLabel("text_spacing_menu")}
          onClick={() => toggleTextDropdown("spacing")}
        >
          <PinselaIcon name="Rows3" size={13} />
          <span>Spacing</span>
          <PinselaIcon name="ChevronDown" size={12} className="dg-toolbar-menu-chevron" />
        </button>
      );
    }

    if (action.id === "text_path_menu") {
      const hasPath = Boolean(textState?.hasPath);
      return (
        <button
          type="button"
          data-function-panel-trigger="true"
          className={`dg-toolbar-radius-btn dg-toolbar-dropdown-btn ${activeTextDropdown === "path" || hasPath ? "active" : ""}`}
          title={actionLabel("text_path_menu")}
          onClick={() => toggleTextDropdown("path")}
        >
          <PinselaIcon name="SplinePointer" size={13} />
          <span>{hasPath ? "Curved" : "Straight"}</span>
          <PinselaIcon name="ChevronDown" size={12} className="dg-toolbar-menu-chevron" />
        </button>
      );
    }

    if (action.id === "line_color") {
      const lineColorCss = colorToCssString(lineState?.color || "#8B6D52");
      return (
        <button
          type="button"
          data-function-panel-trigger="true"
          className="dg-toolbar-color-btn"
          title={actionLabel("line_color")}
          onClick={() => openColorPanel("line")}
        >
          <PinselaIcon name="Minus" size={14} />
          <span className="dg-toolbar-color-line" style={{ background: lineColorCss }} />
        </button>
      );
    }

    if (action.id === "line_weight") {
      return (
        <div className="dg-toolbar-number dg-toolbar-number-tight">
          <PinselaIcon name="Minus" size={12} />
          <input
            value={lineWeightInput}
            onChange={(event) => {
              const next = event.target.value;
              setLineWeightInput(next);
              const value = Number(next);
              if (Number.isFinite(value)) emit("line_weight", { value });
            }}
            onBlur={() => {
              const value = Number(lineWeightInput);
              if (Number.isFinite(value)) emit("line_weight", { value });
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                const value = Number(lineWeightInput);
                if (Number.isFinite(value)) emit("line_weight", { value });
              }
            }}
          />
        </div>
      );
    }

    if (action.id === "line_opacity") {
      const lineOpacity = Math.max(0, Math.min(100, Math.round(lineState?.opacity ?? 100)));
      return (
        <TipWrap label="Opacity" description="Transparency of the selected layer (100% = opaque).">
        <button
          type="button"
          data-function-panel-trigger="true"
          className={`dg-toolbar-radius-btn dg-toolbar-value-btn ${isOpacityOpen && opacityTarget === "line" ? "active" : ""}`}
          onClick={() => {
            if (isImageTraceOpen) {
              emit("image_trace", { phase: "cancel", edgeThreshold: traceEdgeThreshold, curveTolerance: traceCurveTolerance });
            }
            const nextOpen = !(isOpacityOpen && opacityTarget === "line");
            setOpacityTarget("line");
            setIsColorPickerOpen(false);
            setIsShapeRadiusOpen(false);
            setIsLineStyleOpen(false);
            setIsImageDuotoneOpen(false);
            setIsImageBrushOpen(false);
            setIsTextFontOpen(false);
            setIsImageTraceOpen(false);
            setActiveTextDropdown(null);
            setIsOpacityOpen(nextOpen);
          }}
          aria-label={`${actionLabel("line_opacity")}: ${lineOpacity}%`}
        >
          <span className="dg-toolbar-opacity-glyph" aria-hidden="true" />
          <span>{lineOpacity}%</span>
        </button>
        </TipWrap>
      );
    }

    if (action.id === "element_opacity") {
      const elementOpacity = Math.max(0, Math.min(100, Math.round(elementOpacityState?.opacity ?? 100)));
      return (
        <TipWrap label="Opacity" description="Transparency of the selected layer (100% = opaque).">
        <button
          type="button"
          data-function-panel-trigger="true"
          className={`dg-toolbar-radius-btn dg-toolbar-value-btn ${isOpacityOpen && opacityTarget === "element" ? "active" : ""}`}
          onClick={() => {
            if (isImageTraceOpen) {
              emit("image_trace", { phase: "cancel", edgeThreshold: traceEdgeThreshold, curveTolerance: traceCurveTolerance });
            }
            const nextOpen = !(isOpacityOpen && opacityTarget === "element");
            setOpacityTarget("element");
            setIsColorPickerOpen(false);
            setIsShapeRadiusOpen(false);
            setIsLineStyleOpen(false);
            setIsImageDuotoneOpen(false);
            setIsImageBrushOpen(false);
            setIsTextFontOpen(false);
            setIsImageTraceOpen(false);
            setActiveTextDropdown(null);
            setIsOpacityOpen(nextOpen);
          }}
          aria-label={`${actionLabel("element_opacity")}: ${elementOpacity}%`}
        >
          <span className="dg-toolbar-opacity-glyph" aria-hidden="true" />
          <span>{elementOpacity}%</span>
        </button>
        </TipWrap>
      );
    }

    if (action.id === "line_style") {
      return (
        <button
          type="button"
          data-function-panel-trigger="true"
          className={`dg-toolbar-radius-btn ${isLineStyleOpen ? "active" : ""}`}
          title={actionLabel("line_style")}
          onClick={() => {
            if (isImageTraceOpen) {
              emit("image_trace", { phase: "cancel", edgeThreshold: traceEdgeThreshold, curveTolerance: traceCurveTolerance });
              setIsImageTraceOpen(false);
            }
            setIsColorPickerOpen(false);
            setIsShapeRadiusOpen(false);
            setIsOpacityOpen(false);
            setIsImageDuotoneOpen(false);
            setIsImageBrushOpen(false);
            setIsTextFontOpen(false);
            setActiveTextDropdown(null);
            setIsLineStyleOpen((prev) => !prev);
          }}
        >
          <PinselaIcon name="SlidersHorizontal" size={13} />
          <span>Stroke</span>
        </button>
      );
    }

    if (action.id === "shape_fill") {
      const fillCss = colorToCssString(shapeState?.fill || "#2563eb");
      return (
        <TipWrap label="Fill" description="Fill color of the selected shape.">
          <span className="dg-toolbar-mini-label">Fill</span>
          <button
            type="button"
            data-function-panel-trigger="true"
            className="dg-toolbar-shape-swatch"
            aria-label="Fill"
            onClick={() => openColorPanel("shape_fill")}
            style={{ background: fillCss }}
          />
        </TipWrap>
      );
    }

    if (action.id === "shape_stroke") {
      const strokeEnabled = Boolean(shapeState?.strokeEnabled);
      const strokeColorCss = colorToCssString(shapeState?.stroke || "#0f172a");
      return (
        <div className="dg-toolbar-stroke-control">
          <span className="dg-toolbar-mini-label">Border</span>
          <TipWrap label="Border" description="Turns the shape border on or off.">
            <button
              type="button"
              className={`dg-toolbar-stroke-toggle ${strokeEnabled ? "active" : ""}`}
              aria-pressed={strokeEnabled}
              aria-label={strokeEnabled ? "Turn border off" : "Turn border on"}
              onClick={() => emit("shape_stroke", { enabled: !strokeEnabled })}
            >
              <span className="dg-toolbar-stroke-toggle-thumb" />
            </button>
          </TipWrap>
          <TipWrap label="Border color" description="Opens the border color picker.">
            <button
              type="button"
              data-function-panel-trigger="true"
              className="dg-toolbar-color-btn"
              aria-label="Border color"
              onClick={() => openColorPanel("shape_stroke")}
            >
              <PinselaIcon name="Square" size={14} />
              <span className="dg-toolbar-color-line" style={{ background: strokeColorCss }} />
            </button>
          </TipWrap>
          <TipWrap label="Border thickness" description="Border width in pixels.">
            <div className="dg-toolbar-number dg-toolbar-number-tight">
              <input
                aria-label="Border thickness"
                value={shapeStrokeWidthInput}
                onChange={(event) => {
                  const next = event.target.value;
                  setShapeStrokeWidthInput(next);
                  const value = Number(next);
                  if (Number.isFinite(value)) emit("shape_stroke", { enabled: true, width: value });
                }}
                onBlur={() => {
                  const value = Number(shapeStrokeWidthInput);
                  if (Number.isFinite(value)) emit("shape_stroke", { enabled: true, width: value });
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    const value = Number(shapeStrokeWidthInput);
                    if (Number.isFinite(value)) emit("shape_stroke", { enabled: true, width: value });
                  }
                }}
              />
              <span className="dg-toolbar-unit">px</span>
            </div>
          </TipWrap>
        </div>
      );
    }

    if (action.id === "artboard_fill") {
      const fillCss = colorToCssString(artboardFill || "#f2ece4");
      return (
        <TipWrap label="Page color" description="Changes the background color of the current page.">
          <span className="dg-toolbar-mini-label">Page background</span>
          <button
            type="button"
            data-function-panel-trigger="true"
            className="dg-toolbar-shape-swatch"
            aria-label="Page color"
            onClick={() => openColorPanel("artboard")}
            style={{ background: fillCss }}
          />
        </TipWrap>
      );
    }

    if (action.id === "shape_radius") {
      return (
        <TipWrap label="Corner radius" description="Rounds the shape corners, in pixels.">
        <button
          type="button"
          data-function-panel-trigger="true"
          className={`dg-toolbar-radius-btn ${isShapeRadiusOpen ? "active" : ""}`}
          aria-label="Corner radius"
          onClick={() => {
            if (isImageTraceOpen) {
              emit("image_trace", { phase: "cancel", edgeThreshold: traceEdgeThreshold, curveTolerance: traceCurveTolerance });
              setIsImageTraceOpen(false);
            }
            setIsColorPickerOpen(false);
            setIsLineStyleOpen(false);
            setIsOpacityOpen(false);
            setIsImageDuotoneOpen(false);
            setIsImageBrushOpen(false);
            setIsTextFontOpen(false);
            setActiveTextDropdown(null);
            setIsShapeRadiusOpen((prev) => !prev);
          }}
        >
          <PinselaIcon name="SquareRoundCorner" size={13} />
          <span>{Math.round(Number(shapeState?.cornerRadius || 0))}</span>
          <span className="dg-toolbar-unit">px</span>
        </button>
        </TipWrap>
      );
    }

    if (action.id === "shape_sides") {
      return (
        <div className="dg-toolbar-labeled-stepper"><span className="dg-toolbar-mini-label">Sides</span>
        <div className="dg-toolbar-stepper" title={actionLabel("shape_sides")}>
          <button type="button" aria-label="Fewer sides" title="Fewer sides" onClick={() => emit("shape_sides", { delta: -1 })}><PinselaIcon name="Minus" size={14} /></button>
          <input
            aria-label={actionLabel("shape_sides")}
            value={shapeSidesInput}
            onChange={(event) => {
              const next = event.target.value;
              setShapeSidesInput(next);
              const value = Number(next);
              if (Number.isFinite(value)) emit("shape_sides", { value });
            }}
            onBlur={() => {
              const value = Number(shapeSidesInput);
              if (Number.isFinite(value)) emit("shape_sides", { value });
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                const value = Number(shapeSidesInput);
                if (Number.isFinite(value)) emit("shape_sides", { value });
              }
            }}
          />
          <button type="button" aria-label="More sides" title="More sides" onClick={() => emit("shape_sides", { delta: 1 })}><PinselaIcon name="Plus" size={14} /></button>
        </div>
        </div>
      );
    }

    if (action.id === "shape_points") {
      return (
        <div className="dg-toolbar-labeled-stepper"><span className="dg-toolbar-mini-label">Points</span>
        <div className="dg-toolbar-stepper" title={actionLabel("shape_points")}>
          <button type="button" aria-label="Fewer points" title="Fewer points" onClick={() => emit("shape_points", { delta: -1 })}><PinselaIcon name="Minus" size={14} /></button>
          <input
            aria-label={actionLabel("shape_points")}
            value={starPointsInput}
            onChange={(event) => {
              const next = event.target.value;
              setStarPointsInput(next);
              const value = Number(next);
              if (Number.isFinite(value)) emit("shape_points", { value });
            }}
            onBlur={() => {
              const value = Number(starPointsInput);
              if (Number.isFinite(value)) emit("shape_points", { value });
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                const value = Number(starPointsInput);
                if (Number.isFinite(value)) emit("shape_points", { value });
              }
            }}
          />
          <button type="button" aria-label="More points" title="More points" onClick={() => emit("shape_points", { delta: 1 })}><PinselaIcon name="Plus" size={14} /></button>
        </div>
        </div>
      );
    }

    if (action.id === "image_duotone") {
      const duotoneEnabled = Boolean(imageDuotoneState?.enabled);
      return (
        <button
          type="button"
          data-function-panel-trigger="true"
          className={`dg-toolbar-radius-btn ${isImageDuotoneOpen || duotoneEnabled ? "active" : ""}`}
          title={actionLabel("image_duotone")}
          onClick={() => {
            if (isImageTraceOpen) {
              emit("image_trace", { phase: "cancel", edgeThreshold: traceEdgeThreshold, curveTolerance: traceCurveTolerance });
              setIsImageTraceOpen(false);
            }
            setIsColorPickerOpen(false);
            setIsShapeRadiusOpen(false);
            setIsLineStyleOpen(false);
            setIsOpacityOpen(false);
            setIsImageBrushOpen(false);
            setIsTextFontOpen(false);
            setActiveTextDropdown(null);
            setIsImageDuotoneOpen((prev) => !prev);
          }}
        >
          <PinselaIcon name="Contrast" size={13} />
          <span>Duotone</span>
        </button>
      );
    }

    if (action.id === "image_fade") {
      const fadeEnabled = Boolean(imageFadeState?.enabled);
      return (
        <button
          type="button"
          data-function-panel-trigger="true"
          className={`dg-toolbar-radius-btn ${isImageFadeOpen || fadeEnabled ? "active" : ""}`}
          title={actionLabel("image_fade")}
          onClick={() => {
            if (isImageTraceOpen) {
              emit("image_trace", { phase: "cancel", edgeThreshold: traceEdgeThreshold, curveTolerance: traceCurveTolerance });
              setIsImageTraceOpen(false);
            }
            setIsColorPickerOpen(false);
            setIsShapeRadiusOpen(false);
            setIsLineStyleOpen(false);
            setIsOpacityOpen(false);
            setIsImageDuotoneOpen(false);
            setIsImageBrushOpen(false);
            setIsTextFontOpen(false);
            setActiveTextDropdown(null);
            setIsImageFadeOpen((prev) => !prev);
          }}
        >
          <PinselaIcon name="Blend" size={13} />
          <span>Fade</span>
        </button>
      );
    }

    if (action.id === "image_brush") {
      const isActive = Boolean(imageBrushState?.enabled);
      return (
        <button
          type="button"
          data-function-panel-trigger="true"
          className={`dg-toolbar-radius-btn ${isImageBrushOpen || isActive ? "active" : ""}`}
          title={actionLabel("image_brush")}
          onClick={() => {
            if (isImageTraceOpen) {
              emit("image_trace", { phase: "cancel", edgeThreshold: traceEdgeThreshold, curveTolerance: traceCurveTolerance });
              setIsImageTraceOpen(false);
            }
            setIsColorPickerOpen(false);
            setIsShapeRadiusOpen(false);
            setIsLineStyleOpen(false);
            setIsImageDuotoneOpen(false);
            setIsOpacityOpen(false);
            setIsTextFontOpen(false);
            setActiveTextDropdown(null);
            if (!isActive) {
              emit("image_brush", { enabled: true });
              setIsImageBrushOpen(true);
              return;
            }
            setIsImageBrushOpen((prev) => !prev);
          }}
        >
          <PinselaIcon name="Brush" size={13} />
          <span>Brush</span>
        </button>
      );
    }

    if (action.id === "image_trace") {
      return (
        <button
          type="button"
          data-function-panel-trigger="true"
          className={`dg-toolbar-radius-btn ${isImageTraceOpen ? "active" : ""}`}
          title={actionLabel("image_trace")}
          onClick={() => {
            const nextOpen = !isImageTraceOpen;
            setIsColorPickerOpen(false);
            setIsShapeRadiusOpen(false);
            setIsLineStyleOpen(false);
            setIsImageDuotoneOpen(false);
            setIsImageBrushOpen(false);
            setIsOpacityOpen(false);
            setIsTextFontOpen(false);
            setActiveTextDropdown(null);
            setIsImageTraceOpen(nextOpen);
            if (nextOpen) {
              emit("image_trace", {
                phase: "preview",
                edgeThreshold: traceEdgeThreshold,
                curveTolerance: traceCurveTolerance,
              });
            } else {
              emit("image_trace", {
                phase: "cancel",
                edgeThreshold: traceEdgeThreshold,
                curveTolerance: traceCurveTolerance,
              });
            }
          }}
        >
          <PinselaIcon name="ScanLine" size={13} />
          <span>Trace</span>
        </button>
      );
    }

    if (action.id === "vectorize_image") {
      return (
        <button
          type="button"
          className="dg-toolbar-radius-btn"
          title={actionLabel("vectorize_image")}
          onClick={() => emit("vectorize_image")}
        >
          <PinselaIcon name="ScanLine" size={13} />
          <span>Trace</span>
        </button>
      );
    }

    if (action.id === "image_replace") {
      return (
        <button
          type="button"
          className="dg-toolbar-radius-btn"
          title={actionLabel("image_replace")}
          onClick={() => emit("image_replace")}
        >
          <PinselaIcon name="Replace" size={13} />
          <span>Replace</span>
        </button>
      );
    }

    if (action.id === "image_remove_background") {
      const processing = Boolean(imageBackgroundRemovalState?.processing);
      const errorDescription = String(imageBackgroundRemovalState?.error || "").trim();
      const buttonTitle = errorDescription
        ? `${actionLabel("image_remove_background")}: ${errorDescription}`
        : actionLabel("image_remove_background");
      return (
        <button
          type="button"
          className="dg-toolbar-radius-btn"
          title={buttonTitle}
          disabled={processing}
          onClick={() => emit("image_remove_background")}
          aria-busy={processing}
          aria-label={errorDescription ? `${actionLabel("image_remove_background")}. ${errorDescription}` : actionLabel("image_remove_background")}
        >
          <PinselaIcon name={processing ? "CloudFog" : errorDescription ? "TriangleAlert" : "Sparkles"} size={13} />
          <span>{processing ? "Removing..." : "Remove background"}</span>
        </button>
      );
    }

    if (action.id === "text_line_height") {
      return (
        <div className="dg-toolbar-number">
          <PinselaIcon name="AlignVerticalSpaceAround" size={12} />
          <input
            value={String(Math.round(textState?.lineHeight || 120))}
            onChange={(event) => emit("text_line_height", { value: Number(event.target.value) })}
          />
        </div>
      );
    }

    if (action.id === "text_tracking") {
      return (
        <div className="dg-toolbar-number">
          <PinselaIcon name="BetweenVerticalStart" size={12} />
          <input
            value={String(Math.round(textState?.tracking || 0))}
            onChange={(event) => emit("text_tracking", { value: Number(event.target.value) })}
          />
        </div>
      );
    }

    if (action.id === "path_radius" || action.id === "path_start_angle" || action.id === "path_sweep_angle") {
      const [value, setValue] = action.id === "path_radius"
        ? [pathRadiusInput, setPathRadiusInput]
        : action.id === "path_start_angle"
          ? [pathStartInput, setPathStartInput]
          : [pathSweepInput, setPathSweepInput];
      const iconName = action.id === "path_radius" ? "Circle" : action.id === "path_start_angle" ? "Play" : "RotateCw";
      return (
        <div className="dg-toolbar-number">
          <PinselaIcon name={iconName as any} size={12} />
          <input
            value={value}
            onChange={(event) => {
              const next = event.target.value;
              setValue(next);
              const num = Number(next);
              if (Number.isFinite(num)) emit(action.id, { value: num });
            }}
            onBlur={() => {
              const num = Number(value);
              if (Number.isFinite(num)) emit(action.id, { value: num });
            }}
          />
        </div>
      );
    }

    if (["image_fit", "image_fill", "component_go_source", "style_menu", "text_style_menu", "images_menu"].includes(action.id)) {
      return (
        <PillButton
          tone="neutral"
          size="sm"
          onClick={() => emit(action.id)}
          title={actionLabel(action.id)}
          tooltipDescription={actionDescription(action.id)}
        >
          {pillLabel(action.id)}
          {action.id.endsWith("_menu") && <PinselaIcon name="ChevronDown" size={12} style={{ marginLeft: 4 }} />}
        </PillButton>
      );
    }

    if (["mode_confirm", "mode_cancel", "mode_reset_crop"].includes(action.id)) {
      const tone = action.id === "mode_confirm" ? "primary" : action.id === "mode_cancel" ? "secondary" : "neutral";
      return (
        <PillButton
          tone={tone as "primary" | "secondary" | "neutral"}
          size="sm"
          onClick={() => emit(action.id)}
          title={actionLabel(action.id)}
          tooltipDescription={actionDescription(action.id)}
        >
          {action.id === "mode_confirm" ? "Confirm" : action.id === "mode_cancel" ? "Cancel" : "Reset crop"}
        </PillButton>
      );
    }

    const isActive =
      (action.id === "toggle_snap" && snapEnabled) ||
      (action.id === "toggle_grid" && gridEnabled) ||
      (action.id === "tool_select" && canvasMode === "select") ||
      (action.id === "tool_pan" && canvasMode === "pan") ||
      (action.id === "align_left" && textState?.textAlign === "left") ||
      (action.id === "align_center" && textState?.textAlign === "center") ||
      (action.id === "align_right" && textState?.textAlign === "right") ||
      (action.id === "align_justify" && textState?.textAlign === "justify") ||
      (action.id === "text_bold" && !!textState?.bold) ||
      (action.id === "text_italic" && !!textState?.italic) ||
      (action.id === "text_underline" && !!textState?.underline);
    const unsupportedTextAction =
      (action.id === "text_italic" && textState?.canItalic === false) ||
      (action.id === "text_underline" && textState?.canUnderline === false);
    const unavailableDescription =
      action.id === "text_italic"
        ? "The current font has no italic variant."
        : "The current font doesn't support underline.";

    return (
      <IconButton
        size="sm"
        icon={iconForAction(action.id)}
        disabled={Boolean(action.disabled || unsupportedTextAction)}
        active={isActive}
        onClick={() => emit(action.id)}
        title={actionLabel(action.id)}
        tooltipDescription={unsupportedTextAction ? unavailableDescription : actionDescription(action.id)}
      />
    );
  }

  const toolbarStyle: React.CSSProperties = {
    ...style,
    ["--dg-toolbar-scale" as string]: String(scale),
  };
  const pickerAllowGradient =
    colorPickerTarget === "shape_fill"
    || colorPickerTarget === "shape_stroke"
    || colorPickerTarget === "brush"
    || colorPickerTarget === "line"
    || colorPickerTarget === "text"
    || colorPickerTarget === "artboard";
  const pickerColor = colorPickerTarget === "line"
    ? (lineState?.color || "#8B6D52")
    : colorPickerTarget === "shape_stroke"
      ? (shapeState?.stroke || "#0f172a")
    : colorPickerTarget === "text"
      ? (textState?.color || "#2563eb")
      : colorPickerTarget === "artboard"
        ? (artboardFill || "#f2ece4")
      : colorPickerTarget === "brush"
        ? (imageBrushState?.color || "#0f172a")
      : colorPickerTarget === "duotone_shadows"
        ? (imageDuotoneState?.shadows || "#111114")
      : colorPickerTarget === "duotone_highlights"
        ? (imageDuotoneState?.highlights || "#f8fafc")
        : (shapeState?.fill || "#2563eb");
  const pickerTitle = colorPickerTarget === "line"
    ? "Stroke color"
    : colorPickerTarget === "shape_stroke"
      ? "Border color"
    : colorPickerTarget === "text"
      ? "Text color"
      : colorPickerTarget === "artboard"
        ? "Page color"
      : colorPickerTarget === "brush"
        ? "Brush color"
      : colorPickerTarget === "duotone_shadows"
        ? "Duotone shadows"
      : colorPickerTarget === "duotone_highlights"
        ? "Duotone highlights"
        : "Fill color";
  const activeFunctionPanel:
    | "color"
    | "text_font"
    | "text_mode"
    | "text_align"
    | "text_spacing"
    | "text_path"
    | "shape_radius"
    | "line_style"
    | "opacity"
    | "image_duotone"
    | "image_fade"
    | "image_brush"
    | "image_trace"
    | null =
    isColorPickerOpen ? "color"
    : isTextFontOpen ? "text_font"
    : activeTextDropdown === "mode" ? "text_mode"
    : activeTextDropdown === "align" ? "text_align"
    : activeTextDropdown === "spacing" ? "text_spacing"
    : activeTextDropdown === "path" ? "text_path"
    : isShapeRadiusOpen ? "shape_radius"
    : isLineStyleOpen ? "line_style"
    : isOpacityOpen ? "opacity"
    : isImageDuotoneOpen ? "image_duotone"
    : isImageFadeOpen ? "image_fade"
    : isImageBrushOpen ? "image_brush"
    : isImageTraceOpen ? "image_trace"
    : null;
  const functionPanelTitle =
    activeFunctionPanel === "color" ? pickerTitle
    : activeFunctionPanel === "text_font" ? "Font"
    : activeFunctionPanel === "text_mode" ? "Text mode"
    : activeFunctionPanel === "text_align" ? "Alignment"
    : activeFunctionPanel === "text_spacing" ? "Spacing"
    : activeFunctionPanel === "text_path" ? "Curved text"
    : activeFunctionPanel === "shape_radius" ? "Corner radius"
    : activeFunctionPanel === "line_style" ? "Stroke style"
    : activeFunctionPanel === "opacity" ? "Transparency"
    : activeFunctionPanel === "image_duotone" ? "Duotone"
    : activeFunctionPanel === "image_fade" ? "Fade"
    : activeFunctionPanel === "image_brush" ? "Brush - General"
    : activeFunctionPanel === "image_trace" ? "Image tracing"
    : "";
  const activeOpacityValue = opacityTarget === "line"
    ? Math.max(0, Math.min(100, Math.round(Number(lineState?.opacity ?? 100))))
    : Math.max(0, Math.min(100, Math.round(Number(elementOpacityState?.opacity ?? 100))));
  const duotoneState = imageDuotoneState || {
    enabled: false,
    shadows: "#111114",
    highlights: "#f8fafc",
    amount: 100,
  };
  const fadeState: ContextToolbarImageFadeState = imageFadeState || {
    enabled: false,
    softness: 0,
    linear: null,
    radial: null,
    edges: { top: 0, right: 0, bottom: 0, left: 0 },
  };
  // Emits the full fade spec after applying a partial patch (the popover does the merge).
  const emitFade = (patch: {
    enabled?: boolean;
    softness?: number;
    linear?: ContextToolbarImageFadeState["linear"];
    radial?: ContextToolbarImageFadeState["radial"];
    edges?: Partial<ContextToolbarImageFadeState["edges"]>;
  }) => {
    const next: ContextToolbarImageFadeState = {
      enabled: patch.enabled ?? fadeState.enabled,
      softness: patch.softness ?? fadeState.softness,
      linear: patch.linear !== undefined ? patch.linear : fadeState.linear,
      radial: patch.radial !== undefined ? patch.radial : fadeState.radial,
      edges: patch.edges ? { ...fadeState.edges, ...patch.edges } : fadeState.edges,
    };
    emit("image_fade", { fade: next });
  };
  const brushState = imageBrushState || {
    enabled: false,
    mode: "shadow" as const,
    color: "#111111",
    size: 120,
    opacity: 100,
    flow: 100,
    hardness: 50,
    accumulation: 100,
    spacing: 15,
    shape: 100,
    rotation: 0,
  };
  const editMenuStyle = editMenuAnchorRect && typeof window !== "undefined"
    ? {
      position: "fixed" as const,
      top: Math.min(window.innerHeight - 220, Math.max(12, Math.round(editMenuAnchorRect.bottom + 8))),
      left: Math.min(window.innerWidth - 272, Math.max(12, Math.round(editMenuAnchorRect.left))),
      zIndex: 2600,
    }
    : undefined;

  return (
    <>
      <div
        ref={ref}
        className={`dg-context-toolbar anchor-${anchor} ${scale < 0.99 ? "compact" : ""}`}
        data-canvas-ui="true"
        style={toolbarStyle}
        onPointerDown={stopCanvasGesturePropagation}
        onMouseDown={stopCanvasGesturePropagation}
        onWheel={stopCanvasGesturePropagation}
      >
        {model.groups.map((group, groupIndex) => (
          <React.Fragment key={group.id}>
            {groupIndex > 0 && <div className="dg-separator" />}
            <div className={`dg-toolbar-group dg-toolbar-group-${group.id}`}>
              {group.actions.map((action) => (
                <React.Fragment key={action.id}>{renderAction(action)}</React.Fragment>
              ))}
            </div>
          </React.Fragment>
        ))}
      </div>

      {isEditMenuOpen && editMenuStyle && ReactDOM.createPortal(
        <div
          className="dg-toolbar-edit-menu dg-toolbar-edit-menu-floating"
          data-canvas-ui="true"
          data-function-panel-trigger="true"
          style={editMenuStyle}
          onPointerDown={stopCanvasGesturePropagation}
          onMouseDown={stopCanvasGesturePropagation}
          onWheel={stopCanvasGesturePropagation}
        >
          {editMenuOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              className="dg-toolbar-edit-menu-item"
              onClick={() => handleEditMenuAction(option.id)}
            >
              <PinselaIcon name={option.icon} size={14} />
              <span>
                <strong>{option.label}</strong>
                <small>{option.description}</small>
              </span>
            </button>
          ))}
        </div>,
        document.body,
      )}

      {activeFunctionPanel && ReactDOM.createPortal(
        <div
          className="dg-function-panel-layer"
          data-canvas-ui="true"
          onPointerDown={stopCanvasGesturePropagation}
          onMouseDown={stopCanvasGesturePropagation}
          onWheel={stopCanvasGesturePropagation}
        >
          <div
            ref={sidePanelRef}
            className="dg-function-panel"
            data-canvas-ui="true"
          >
            {activeFunctionPanel !== "color" && (
              <div className="dg-function-panel-head">
                <strong>{functionPanelTitle}</strong>
                <button type="button" className="dg-function-panel-close" onClick={closeFunctionPanels} title="Close panel">
                  <PinselaIcon name="X" size={14} />
                </button>
              </div>
            )}

            <div className="dg-function-panel-body">
              {activeFunctionPanel === "color" && (
                <ColorPicker
                  color={pickerColor}
                  allowGradient={pickerAllowGradient}
                  documentColors={documentColors}
                  title={pickerTitle}
                  onChange={(nextColor, meta) => {
                    const colorPayload: ColorPickerValue =
                      !pickerAllowGradient && isGradientColorValue(nextColor)
                        ? colorToCssString(nextColor)
                        : nextColor;
                    const colorActionPayload = {
                      commit: meta?.commit,
                      transient: meta?.transient,
                    };
                    if (colorPickerTarget === "line") {
                      emit("line_color", { color: colorPayload, ...colorActionPayload });
                      return;
                    }
                    if (colorPickerTarget === "text") {
                      emit("text_color", { color: colorPayload, ...colorActionPayload });
                      return;
                    }
                    if (colorPickerTarget === "shape_fill") {
                      emit("shape_fill", { color: colorPayload, ...colorActionPayload });
                      return;
                    }
                    if (colorPickerTarget === "shape_stroke") {
                      emit("shape_stroke", { color: colorPayload, enabled: true, ...colorActionPayload });
                      return;
                    }
                    if (colorPickerTarget === "artboard") {
                      emit("artboard_fill", { color: colorPayload, ...colorActionPayload });
                      return;
                    }
                    if (colorPickerTarget === "brush") {
                      emit("image_brush", { color: colorPayload, enabled: true, ...colorActionPayload });
                      return;
                    }
                    if (colorPickerTarget === "duotone_shadows") {
                      emit("image_duotone", { shadows: colorPayload, enabled: true, ...colorActionPayload });
                      return;
                    }
                    if (colorPickerTarget === "duotone_highlights") {
                      emit("image_duotone", { highlights: colorPayload, enabled: true, ...colorActionPayload });
                      return;
                    }
                    emit("shape_fill", { color: colorPayload, ...colorActionPayload });
                  }}
                  onClose={closeFunctionPanels}
                  className="dg-toolbar-color-popover dg-function-panel-color"
                  onMouseDown={(event) => event.stopPropagation()}
                />
              )}

              {activeFunctionPanel === "text_font" && (
                <div className="dg-toolbar-font-popover dg-function-panel-inline">
                  <input
                    type="text"
                    className="dg-input dg-toolbar-font-search"
                    placeholder="Search fonts..."
                    value={fontSearchInput}
                    onChange={(event) => setFontSearchInput(event.target.value)}
                  />
                  <div className="dg-toolbar-font-current">
                    <span>Current</span>
                    <strong style={{ fontFamily: currentFontFamily }}>
                      {currentFontFamily} · {currentFontStyle}
                    </strong>
                  </div>

                  <div className="dg-font-list dg-toolbar-font-list">
                    {filteredFontFamilies.map((entry) => {
                      const forceExpanded = !!normalizedFontQuery && (
                        entry.family.toLowerCase().includes(normalizedFontQuery)
                        || entry.variants.some((variant) => variant.label.toLowerCase().includes(normalizedFontQuery))
                      );
                      const isExpanded = expandedFontFamily === entry.family || forceExpanded;
                      const visibleVariants = entry.variants.filter((variant) => (
                        !normalizedFontQuery
                        || entry.family.toLowerCase().includes(normalizedFontQuery)
                        || variant.label.toLowerCase().includes(normalizedFontQuery)
                      ));

                      return (
                        <div key={entry.family} className="dg-font-family-block">
                          <button
                            type="button"
                            className={`dg-font-family-row ${isExpanded ? "is-open" : ""} ${entry.family === currentFontFamily ? "active" : ""}`}
                            onClick={() => {
                              // Clicking a family APPLIES it AND expands its variants — a user
                              // shouldn't have to drill in to pick a font. Preserve the current
                              // weight (e.g. Bold) across the swap; resolveFontStyleForFamily
                              // falls back to Regular if the new family lacks that variant.
                              emit("text_font", {
                                fontFamily: entry.family,
                                fontStyle: resolveFontStyleForFamily(entry.family, currentFontStyle),
                              });
                              setExpandedFontFamily(entry.family);
                            }}
                          >
                            <span className="dg-font-family-caret"><PinselaIcon name={isExpanded ? "ChevronDown" : "ChevronRight"} size={12} /></span>
                            <span className="dg-font-family-name" style={{ fontFamily: entry.family }}>{entry.family}</span>
                            <span className="dg-font-family-preview" style={{ fontFamily: entry.family }}>AaBbCc</span>
                          </button>

                          {isExpanded && (
                            <div className="dg-font-variants">
                              {visibleVariants.map((variant) => {
                                const variantKey = normalizeFontToken(variant.label);
                                const isActiveVariant =
                                  entry.family === currentFontFamily
                                  && variantKey === normalizedCurrentFontStyle;
                                return (
                                  <button
                                    key={`${entry.family}-${variant.label}`}
                                    type="button"
                                    className={`dg-font-variant-row ${isActiveVariant ? "active" : ""}`}
                                    style={{ fontFamily: entry.family, fontWeight: variant.weight, fontStyle: variant.italic ? "italic" : "normal" }}
                                    onClick={() => {
                                      emit("text_font", {
                                        fontFamily: entry.family,
                                        fontStyle: resolveFontStyleForFamily(entry.family, variant.label),
                                      });
                                      setExpandedFontFamily(entry.family);
                                    }}
                                  >
                                    <span>{variant.label}</span>
                                    <span className="dg-font-variant-meta">{variant.postscriptSuffix}</span>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {!filteredFontFamilies.length ? (
                      <div className="dg-empty-state-title">No font families match this search.</div>
                    ) : null}
                  </div>
                </div>
              )}

              {activeFunctionPanel === "text_mode" && (
                <div className="dg-text-dropdown-popover dg-function-panel-inline">
                  {([
                    { mode: "free", label: "Free text", description: "Keeps the font size and lets the box control wrapping.", icon: "Type" },
                    { mode: "fit", label: "Fit to box", description: "Shrinks the text automatically to fit inside the box.", icon: "WrapText" },
                  ] as const).map((option) => {
                    const isActive = (textState?.fitMode === "fit" ? "fit" : "free") === option.mode;
                    return (
                      <button
                        key={option.mode}
                        type="button"
                        className={`dg-text-menu-option ${isActive ? "active" : ""}`}
                        onClick={() => {
                          emit("text_fit_mode", { mode: option.mode });
                          closeFunctionPanels();
                        }}
                      >
                        <PinselaIcon name={option.icon} size={16} />
                        <span>
                          <strong>{option.label}</strong>
                          <small>{option.description}</small>
                        </span>
                        {isActive && <PinselaIcon name="Check" size={15} />}
                      </button>
                    );
                  })}
                </div>
              )}

              {activeFunctionPanel === "text_align" && (
                <div className="dg-text-dropdown-popover dg-function-panel-inline">
                  {(["left", "center", "right", "justify"] as const).map((align) => {
                    const currentAlign = normalizeTextAlign(textState?.textAlign);
                    const isActive = currentAlign === align;
                    return (
                      <button
                        key={align}
                        type="button"
                        className={`dg-text-menu-option dg-text-menu-option-compact ${isActive ? "active" : ""}`}
                        onClick={() => {
                          emit(textAlignActionId(align));
                          closeFunctionPanels();
                        }}
                      >
                        <PinselaIcon name={textAlignIconName(align)} size={16} />
                        <span><strong>{textAlignLabel(align)}</strong></span>
                        {isActive && <PinselaIcon name="Check" size={15} />}
                      </button>
                    );
                  })}
                </div>
              )}

              {activeFunctionPanel === "text_spacing" && (
                <div className="dg-text-dropdown-popover dg-function-panel-inline">
                  <label className="dg-text-setting-row">
                    <span className="dg-text-setting-label">
                      <PinselaIcon name="Rows3" size={15} />
                      <strong>Line height</strong>
                    </span>
                    <input
                      type="range"
                      min={60}
                      max={300}
                      step={1}
                      value={Math.round(Number(textState?.lineHeight || 120))}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        setTextLineHeightInput(String(value));
                        emit("text_line_height", { value });
                      }}
                    />
                    <span className="dg-text-setting-value">
                      <input
                        type="number"
                        min={60}
                        max={300}
                        value={textLineHeightInput}
                        onChange={(event) => {
                          const next = event.target.value;
                          const value = Number(next);
                          setTextLineHeightInput(next);
                          if (Number.isFinite(value)) emit("text_line_height", { value });
                        }}
                        onBlur={() => {
                          const value = Number(textLineHeightInput);
                          if (Number.isFinite(value)) emit("text_line_height", { value });
                        }}
                      />
                      <em>%</em>
                    </span>
                  </label>

                  <label className="dg-text-setting-row">
                    <span className="dg-text-setting-label">
                      <PinselaIcon name="BetweenHorizontalStart" size={15} />
                      <strong>Letter spacing</strong>
                    </span>
                    <input
                      type="range"
                      min={-20}
                      max={50}
                      step={1}
                      value={Math.round(Number(textState?.tracking || 0))}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        setTextTrackingInput(String(value));
                        emit("text_tracking", { value });
                      }}
                    />
                    <span className="dg-text-setting-value">
                      <input
                        type="number"
                        min={-20}
                        max={50}
                        value={textTrackingInput}
                        onChange={(event) => {
                          const next = event.target.value;
                          const value = Number(next);
                          setTextTrackingInput(next);
                          if (Number.isFinite(value)) emit("text_tracking", { value });
                        }}
                        onBlur={() => {
                          const value = Number(textTrackingInput);
                          if (Number.isFinite(value)) emit("text_tracking", { value });
                        }}
                      />
                      <em>px</em>
                    </span>
                  </label>
                </div>
              )}

              {activeFunctionPanel === "text_path" && (
                <div className="dg-text-dropdown-popover dg-function-panel-inline">
                  <div className="dg-text-path-actions">
                    <button
                      type="button"
                      className={`dg-text-menu-option ${textState?.hasPath ? "active" : ""}`}
                      onClick={() => emit("text_path_toggle")}
                    >
                      <PinselaIcon name="SplinePointer" size={16} />
                      <span>
                        <strong>{textState?.hasPath ? (canvasMode === "path_edit" ? "Exit editing" : "Edit curve") : "Curve text"}</strong>
                        <small>{textState?.hasPath ? "Adjust the curved path of the selected text." : "Creates an editable curved path for this text."}</small>
                      </span>
                    </button>
                    {textState?.hasPath && (
                      <button
                        type="button"
                        className="dg-text-menu-option dg-text-menu-option-danger"
                        onClick={() => {
                          emit("text_path_toggle", { mode: "remove" });
                          closeFunctionPanels();
                        }}
                      >
                        <PinselaIcon name="Baseline" size={16} />
                        <span>
                          <strong>Back to straight text</strong>
                          <small>Removes the path, keeping content and style.</small>
                        </span>
                      </button>
                    )}
                  </div>

                  <label className="dg-text-setting-row">
                    <span className="dg-text-setting-label">
                      <PinselaIcon name="Radius" size={15} />
                      <strong>Radius</strong>
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={1000}
                      step={1}
                      value={Math.max(0, Math.min(1000, Math.round(Number(textState?.radius || 120))))}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        setPathRadiusInput(String(value));
                        emit("path_radius", { value });
                      }}
                    />
                    <span className="dg-text-setting-value">
                      <input
                        type="number"
                        min={0}
                        value={pathRadiusInput}
                        onChange={(event) => {
                          const next = event.target.value;
                          const value = Number(next);
                          setPathRadiusInput(next);
                          if (Number.isFinite(value)) emit("path_radius", { value });
                        }}
                        onBlur={() => {
                          const value = Number(pathRadiusInput);
                          if (Number.isFinite(value)) emit("path_radius", { value });
                        }}
                      />
                      <em>px</em>
                    </span>
                  </label>

                  <label className="dg-text-setting-row">
                    <span className="dg-text-setting-label">
                      <PinselaIcon name="Play" size={15} />
                      <strong>Start angle</strong>
                    </span>
                    <input
                      type="range"
                      min={-360}
                      max={360}
                      step={1}
                      value={Math.max(-360, Math.min(360, Math.round(Number(textState?.startAngle || 0))))}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        setPathStartInput(String(value));
                        emit("path_start_angle", { value });
                      }}
                    />
                    <span className="dg-text-setting-value">
                      <input
                        type="number"
                        min={-360}
                        max={360}
                        value={pathStartInput}
                        onChange={(event) => {
                          const next = event.target.value;
                          const value = Number(next);
                          setPathStartInput(next);
                          if (Number.isFinite(value)) emit("path_start_angle", { value });
                        }}
                        onBlur={() => {
                          const value = Number(pathStartInput);
                          if (Number.isFinite(value)) emit("path_start_angle", { value });
                        }}
                      />
                      <em>°</em>
                    </span>
                  </label>

                  <label className="dg-text-setting-row">
                    <span className="dg-text-setting-label">
                      <PinselaIcon name="UnfoldVertical" size={15} />
                      <strong>Arc sweep</strong>
                    </span>
                    <input
                      type="range"
                      min={-360}
                      max={360}
                      step={1}
                      value={Math.max(-360, Math.min(360, Math.round(Number(textState?.sweepAngle || 180))))}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        setPathSweepInput(String(value));
                        emit("path_sweep_angle", { value });
                      }}
                    />
                    <span className="dg-text-setting-value">
                      <input
                        type="number"
                        min={-360}
                        max={360}
                        value={pathSweepInput}
                        onChange={(event) => {
                          const next = event.target.value;
                          const value = Number(next);
                          setPathSweepInput(next);
                          if (Number.isFinite(value)) emit("path_sweep_angle", { value });
                        }}
                        onBlur={() => {
                          const value = Number(pathSweepInput);
                          if (Number.isFinite(value)) emit("path_sweep_angle", { value });
                        }}
                      />
                      <em>°</em>
                    </span>
                  </label>
                </div>
              )}

              {activeFunctionPanel === "shape_radius" && (
                <div className="dg-shape-radius-popover dg-function-panel-inline">
                  <div className="dg-shape-radius-head">
                    <span>Corner radius</span>
                    <strong>{Math.round(Number(shapeState?.cornerRadius || 0))}</strong>
                  </div>
                  <input
                    className="dg-shape-radius-slider"
                    type="range"
                    min={0}
                    max={Math.max(8, Math.round(shapeState?.maxCornerRadius || 240))}
                    step={1}
                    value={Math.round(Number(shapeState?.cornerRadius || 0))}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      setShapeRadiusInput(String(value));
                      emit("shape_radius", { value });
                    }}
                  />
                  <div className="dg-shape-radius-row">
                    <input
                      className="dg-shape-radius-input"
                      type="number"
                      min={0}
                      max={Math.max(8, Math.round(shapeState?.maxCornerRadius || 240))}
                      value={shapeRadiusInput}
                      onChange={(event) => {
                        const next = event.target.value;
                        setShapeRadiusInput(next);
                        const value = Number(next);
                        if (Number.isFinite(value)) emit("shape_radius", { value });
                      }}
                      onBlur={() => {
                        const value = Number(shapeRadiusInput);
                        if (Number.isFinite(value)) emit("shape_radius", { value });
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          const value = Number(shapeRadiusInput);
                          if (Number.isFinite(value)) emit("shape_radius", { value });
                        }
                      }}
                    />
                    <PillButton
                      tone="secondary"
                      size="sm"
                      onClick={() => {
                        setShapeRadiusInput("0");
                        emit("shape_radius", { value: 0 });
                      }}
                    >
                      Straight
                    </PillButton>
                  </div>
                </div>
              )}

              {activeFunctionPanel === "line_style" && (
                <div className="dg-line-style-popover dg-function-panel-inline">
                  <div className="dg-line-style-presets">
                    {[
                      { key: "solid", dash: [] as number[], label: "Solid" },
                      { key: "dash", dash: [10, 8] as number[], label: "Dashed" },
                      { key: "long_dash", dash: [18, 10] as number[], label: "Long dash" },
                      { key: "dotted", dash: [2, 6] as number[], label: "Dotted" },
                    ].map((preset) => (
                      <button
                        key={preset.key}
                        type="button"
                        className={`dg-line-style-chip ${lineState?.dashPreset === preset.key ? "active" : ""}`}
                        title={preset.label}
                        onClick={() => emit("line_style", { dashPreset: preset.key })}
                      >
                        <span className="dg-line-style-chip-preview">
                          <svg viewBox="0 0 44 12" width="44" height="12" aria-hidden="true">
                            <line
                              x1="2"
                              y1="6"
                              x2="42"
                              y2="6"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap={lineState?.roundedEndpoints ? "round" : "butt"}
                              strokeDasharray={preset.dash.length ? preset.dash.join(" ") : undefined}
                            />
                          </svg>
                        </span>
                      </button>
                    ))}
                  </div>

                  <div className="dg-line-style-row">
                    <span>Rounded caps</span>
                    <button
                      type="button"
                      className={`dg-line-toggle ${lineState?.roundedEndpoints ? "active" : ""}`}
                      onClick={() => emit("line_style", { roundedEndpoints: !lineState?.roundedEndpoints })}
                    >
                      <span className="dg-line-toggle-thumb" />
                    </button>
                  </div>

                  <div className="dg-line-style-row dg-line-style-row-slider">
                    <span>Stroke thickness</span>
                    <input
                      type="range"
                      min={1}
                      max={64}
                      step={1}
                      value={Math.round(lineState?.width || 4)}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        setLineWeightInput(String(value));
                        emit("line_weight", { value });
                      }}
                    />
                    <input
                      className="dg-shape-radius-input dg-line-style-mini-input"
                      type="number"
                      min={1}
                      max={999}
                      value={lineWeightInput}
                      onChange={(event) => {
                        const next = event.target.value;
                        setLineWeightInput(next);
                        const value = Number(next);
                        if (Number.isFinite(value)) emit("line_weight", { value });
                      }}
                      onBlur={() => {
                        const value = Number(lineWeightInput);
                        if (Number.isFinite(value)) emit("line_weight", { value });
                      }}
                    />
                  </div>

                  <div className="dg-line-style-row dg-line-style-row-slider">
                    <span>Transparency</span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={Math.round(lineState?.opacity ?? 100)}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        setLineOpacityInput(String(value));
                        emit("line_opacity", { value });
                      }}
                    />
                    <input
                      className="dg-shape-radius-input dg-line-style-mini-input"
                      type="number"
                      min={0}
                      max={100}
                      value={lineOpacityInput}
                      onChange={(event) => {
                        const next = event.target.value;
                        setLineOpacityInput(next);
                        const value = Number(next);
                        if (Number.isFinite(value)) emit("line_opacity", { value });
                      }}
                      onBlur={() => {
                        const value = Number(lineOpacityInput);
                        if (Number.isFinite(value)) emit("line_opacity", { value });
                      }}
                    />
                  </div>
                </div>
              )}

              {activeFunctionPanel === "opacity" && (
                <div className="dg-line-style-popover dg-function-panel-inline">
                  <div className="dg-line-style-row dg-line-style-row-slider">
                    <span>{opacityTarget === "line" ? "Line transparency" : "Element transparency"}</span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={activeOpacityValue}
                      onChange={(event) => {
                        const value = Math.max(0, Math.min(100, Number(event.target.value) || 0));
                        if (opacityTarget === "line") {
                          setLineOpacityInput(String(value));
                          emit("line_opacity", { value });
                          return;
                        }
                        setElementOpacityInput(String(value));
                        emit("element_opacity", { value });
                      }}
                    />
                    <input
                      className="dg-shape-radius-input dg-line-style-mini-input dg-opacity-value-input"
                      type="number"
                      min={0}
                      max={100}
                      value={opacityTarget === "line" ? lineOpacityInput : elementOpacityInput}
                      onChange={(event) => {
                        const next = event.target.value;
                        const value = Number(next);
                        if (opacityTarget === "line") {
                          setLineOpacityInput(next);
                          if (Number.isFinite(value)) emit("line_opacity", { value });
                          return;
                        }
                        setElementOpacityInput(next);
                        if (Number.isFinite(value)) emit("element_opacity", { value });
                      }}
                      onBlur={() => {
                        const raw = opacityTarget === "line" ? lineOpacityInput : elementOpacityInput;
                        const value = Number(raw);
                        if (!Number.isFinite(value)) return;
                        const next = Math.max(0, Math.min(100, Math.round(value)));
                        if (opacityTarget === "line") {
                          setLineOpacityInput(String(next));
                          emit("line_opacity", { value: next });
                          return;
                        }
                        setElementOpacityInput(String(next));
                        emit("element_opacity", { value: next });
                      }}
                    />
                  </div>
                </div>
              )}

              {activeFunctionPanel === "image_duotone" && (
                <div className="dg-image-duotone-popover dg-image-brush-popover dg-function-panel-inline">
                  <div className="dg-image-brush-head">
                    <PillButton
                      tone={duotoneState.enabled ? "secondary" : "primary"}
                      size="sm"
                      onClick={() => {
                        emit("image_duotone", { enabled: !duotoneState.enabled });
                      }}
                    >
                      {duotoneState.enabled ? "Disable" : "Enable"}
                    </PillButton>
                  </div>

                  <div className="dg-image-brush-row dg-image-brush-color-row">
                    <span>Shadows</span>
                    <button
                      type="button"
                      className="dg-image-brush-color-btn"
                      style={{ background: colorToCssString(duotoneState.shadows || "#111114") }}
                      onClick={() => openColorPanel("duotone_shadows")}
                    />
                  </div>

                  <div className="dg-image-brush-row dg-image-brush-color-row">
                    <span>Highlights</span>
                    <button
                      type="button"
                      className="dg-image-brush-color-btn"
                      style={{ background: colorToCssString(duotoneState.highlights || "#f8fafc") }}
                      onClick={() => openColorPanel("duotone_highlights")}
                    />
                  </div>

                  <label className="dg-image-brush-row dg-image-brush-slider-row">
                    <span>Intensity</span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={Math.round(Number(duotoneState.amount || 100))}
                      onChange={(event) => emit("image_duotone", {
                        enabled: true,
                        amount: Number(event.target.value),
                      })}
                    />
                    <input
                      className="dg-image-brush-value"
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={Math.round(Number(duotoneState.amount || 100))}
                      onChange={(event) => emit("image_duotone", {
                        enabled: true,
                        amount: Number(event.target.value),
                      })}
                    />
                    <em>%</em>
                  </label>
                </div>
              )}

              {activeFunctionPanel === "image_fade" && (
                <div className="dg-image-fade-popover dg-image-brush-popover dg-function-panel-inline">
                  <div className="dg-image-brush-head">
                    <PillButton
                      tone={fadeState.enabled ? "secondary" : "primary"}
                      size="sm"
                      onClick={() => emitFade({ enabled: !fadeState.enabled })}
                    >
                      {fadeState.enabled ? "Disable" : "Enable"}
                    </PillButton>
                  </div>

                  <div className="dg-image-brush-mode">
                    <button
                      type="button"
                      className={`dg-image-brush-mode-btn ${fadeState.linear ? "active" : ""}`}
                      onClick={() => emitFade({ enabled: true, linear: fadeState.linear ? null : { angle: 90, start: 0.4, end: 1 } })}
                    >Linear</button>
                    <button
                      type="button"
                      className={`dg-image-brush-mode-btn ${fadeState.radial ? "active" : ""}`}
                      onClick={() => emitFade({ enabled: true, radial: fadeState.radial ? null : { cx: 0.5, cy: 0.5, inner: 0.5, outer: 1 } })}
                    >Radial</button>
                  </div>

                  {fadeState.linear && (
                    <>
                      <label className="dg-image-brush-row dg-image-brush-slider-row">
                        <span>Angle</span>
                        <input type="range" min={0} max={360} step={1}
                          value={Math.round(fadeState.linear.angle)}
                          onChange={(e) => emitFade({ enabled: true, linear: { ...fadeState.linear!, angle: Number(e.target.value) } })} />
                        <em>{Math.round(fadeState.linear.angle)}°</em>
                      </label>
                      <label className="dg-image-brush-row dg-image-brush-slider-row">
                        <span>Start</span>
                        <input type="range" min={0} max={100} step={1}
                          value={Math.round(fadeState.linear.start * 100)}
                          onChange={(e) => emitFade({ enabled: true, linear: { ...fadeState.linear!, start: Number(e.target.value) / 100 } })} />
                        <em>{Math.round(fadeState.linear.start * 100)}%</em>
                      </label>
                      <label className="dg-image-brush-row dg-image-brush-slider-row">
                        <span>End</span>
                        <input type="range" min={0} max={100} step={1}
                          value={Math.round(fadeState.linear.end * 100)}
                          onChange={(e) => emitFade({ enabled: true, linear: { ...fadeState.linear!, end: Number(e.target.value) / 100 } })} />
                        <em>{Math.round(fadeState.linear.end * 100)}%</em>
                      </label>
                    </>
                  )}

                  {fadeState.radial && (
                    <>
                      <label className="dg-image-brush-row dg-image-brush-slider-row">
                        <span>Sharp center</span>
                        <input type="range" min={0} max={100} step={1}
                          value={Math.round(fadeState.radial.inner * 100)}
                          onChange={(e) => emitFade({ enabled: true, radial: { ...fadeState.radial!, inner: Number(e.target.value) / 100 } })} />
                        <em>{Math.round(fadeState.radial.inner * 100)}%</em>
                      </label>
                      <label className="dg-image-brush-row dg-image-brush-slider-row">
                        <span>Edge fade</span>
                        <input type="range" min={0} max={100} step={1}
                          value={Math.round(fadeState.radial.outer * 100)}
                          onChange={(e) => emitFade({ enabled: true, radial: { ...fadeState.radial!, outer: Number(e.target.value) / 100 } })} />
                        <em>{Math.round(fadeState.radial.outer * 100)}%</em>
                      </label>
                    </>
                  )}

                  <div className="dg-panel-subtitle">Edges (fade per side)</div>
                  {(["top", "right", "bottom", "left"] as const).map((side) => {
                    const labels = { top: "Top", right: "Right", bottom: "Bottom", left: "Left" };
                    return (
                      <label key={side} className="dg-image-brush-row dg-image-brush-slider-row">
                        <span>{labels[side]}</span>
                        <input type="range" min={0} max={100} step={1}
                          value={Math.round((fadeState.edges[side] || 0) * 100)}
                          onChange={(e) => emitFade({ enabled: true, edges: { [side]: Number(e.target.value) / 100 } })} />
                        <em>{Math.round((fadeState.edges[side] || 0) * 100)}%</em>
                      </label>
                    );
                  })}

                  <label className="dg-image-brush-row dg-image-brush-slider-row">
                    <span>Softness</span>
                    <input type="range" min={0} max={100} step={1}
                      value={Math.round(fadeState.softness * 100)}
                      onChange={(e) => emitFade({ enabled: true, softness: Number(e.target.value) / 100 })} />
                    <em>{Math.round(fadeState.softness * 100)}%</em>
                  </label>

                  <div className="dg-image-brush-head">
                    <PillButton
                      tone="secondary"
                      size="sm"
                      onClick={() => emit("image_fade", { fade: { enabled: false, softness: 0, linear: null, radial: null, edges: { top: 0, right: 0, bottom: 0, left: 0 } } })}
                    >
                      Remove fade
                    </PillButton>
                  </div>
                </div>
              )}

              {activeFunctionPanel === "image_brush" && (
                <div className="dg-image-brush-popover dg-function-panel-inline">
                  <div className="dg-image-brush-head">
                    <PillButton
                      tone={brushState.enabled ? "secondary" : "primary"}
                      size="sm"
                      onClick={() => {
                        const nextEnabled = !brushState.enabled;
                        emit("image_brush", { enabled: nextEnabled });
                        if (!nextEnabled) closeFunctionPanels();
                      }}
                    >
                      {brushState.enabled ? "Disable" : "Enable"}
                    </PillButton>
                  </div>

                  <div className="dg-image-brush-mode">
                    <button
                      type="button"
                      className={`dg-image-brush-mode-btn ${brushState.mode === "shadow" ? "active" : ""}`}
                      onClick={() => emit("image_brush", { enabled: true, mode: "shadow" })}
                    >
                      Shadow/Gradient
                    </button>
                    <button
                      type="button"
                      className={`dg-image-brush-mode-btn ${brushState.mode === "erase" ? "active" : ""}`}
                      onClick={() => emit("image_brush", { enabled: true, mode: "erase" })}
                    >
                      No background
                    </button>
                  </div>

                  <div className="dg-image-brush-presets">
                    <span>Presets</span>
                    <div className="dg-image-brush-presets-grid">
                      {[
                        {
                          id: "soft",
                          label: "Soft",
                          patch: { size: 180, opacity: 70, flow: 70, hardness: 18, accumulation: 80, spacing: 12, shape: 100, rotation: 0 },
                        },
                        {
                          id: "hard",
                          label: "Firm",
                          patch: { size: 120, opacity: 100, flow: 100, hardness: 85, accumulation: 100, spacing: 10, shape: 100, rotation: 0 },
                        },
                        {
                          id: "mist",
                          label: "Mist",
                          patch: { size: 320, opacity: 55, flow: 42, hardness: 5, accumulation: 62, spacing: 18, shape: 100, rotation: 0 },
                        },
                        {
                          id: "erase",
                          label: "Erase",
                          patch: { size: 160, opacity: 100, flow: 100, hardness: 34, accumulation: 100, spacing: 12, shape: 100, rotation: 0 },
                          mode: "erase" as const,
                        },
                      ].map((preset) => (
                        <button
                          key={preset.id}
                          type="button"
                          className="dg-image-brush-preset-btn"
                          onClick={() => emit("image_brush", {
                            enabled: true,
                            mode: preset.mode ?? brushState.mode,
                            settings: preset.patch,
                          })}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="dg-image-brush-row dg-image-brush-color-row">
                    <span>Color</span>
                    <button
                      type="button"
                      className="dg-image-brush-color-btn"
                      style={{ background: colorToCssString(brushState.color || "#111111") }}
                      onClick={() => openColorPanel("brush")}
                    />
                  </div>

                  {([
                    { key: "size", label: "Size", min: 1, max: 2200, step: 1, value: brushState.size, unit: "px" },
                    { key: "opacity", label: "Opacity", min: 0, max: 100, step: 1, value: brushState.opacity, unit: "%" },
                    { key: "flow", label: "Flow", min: 1, max: 100, step: 1, value: brushState.flow, unit: "%" },
                    { key: "hardness", label: "Hardness", min: 0, max: 100, step: 1, value: brushState.hardness, unit: "%" },
                    { key: "accumulation", label: "Buildup", min: 0, max: 100, step: 1, value: brushState.accumulation, unit: "%" },
                    { key: "spacing", label: "Spacing", min: 1, max: 100, step: 1, value: brushState.spacing, unit: "%" },
                    { key: "shape", label: "Shape", min: 1, max: 100, step: 1, value: brushState.shape, unit: "%" },
                    { key: "rotation", label: "Rotation", min: -180, max: 180, step: 1, value: brushState.rotation, unit: "°" },
                  ] as const).map((control) => (
                    <label key={control.key} className="dg-image-brush-row dg-image-brush-slider-row">
                      <span>{control.label}</span>
                      <input
                        type="range"
                        min={control.min}
                        max={control.max}
                        step={control.step}
                        value={Math.round(Number(control.value))}
                        onChange={(event) => emit("image_brush", {
                          enabled: true,
                          settings: { [control.key]: Number(event.target.value) },
                        })}
                      />
                      <input
                        className="dg-image-brush-value"
                        type="number"
                        min={control.min}
                        max={control.max}
                        step={control.step}
                        value={Math.round(Number(control.value))}
                        onChange={(event) => emit("image_brush", {
                          enabled: true,
                          settings: { [control.key]: Number(event.target.value) },
                        })}
                      />
                      <em>{control.unit}</em>
                    </label>
                  ))}

                  <div className="dg-image-brush-shortcuts">
                    Shortcuts: <kbd>[</kbd>/<kbd>]</kbd> size · <kbd>Shift+[</kbd>/<kbd>Shift+]</kbd> opacity
                  </div>
                </div>
              )}

              {activeFunctionPanel === "image_trace" && (
                <div className="dg-image-brush-popover dg-function-panel-inline">
                  <label className="dg-image-brush-row dg-image-brush-slider-row">
                    <span>Edge threshold</span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={Math.round(traceEdgeThreshold)}
                      onChange={(event) => {
                        const value = Math.max(0, Math.min(100, Number(event.target.value) || 0));
                        setTraceEdgeThreshold(value);
                        emit("image_trace", {
                          phase: "preview",
                          edgeThreshold: value,
                          curveTolerance: traceCurveTolerance,
                        });
                      }}
                    />
                    <input
                      className="dg-image-brush-value"
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={Math.round(traceEdgeThreshold)}
                      onChange={(event) => {
                        const value = Math.max(0, Math.min(100, Number(event.target.value) || 0));
                        setTraceEdgeThreshold(value);
                        emit("image_trace", {
                          phase: "preview",
                          edgeThreshold: value,
                          curveTolerance: traceCurveTolerance,
                        });
                      }}
                    />
                    <em>%</em>
                  </label>

                  <label className="dg-image-brush-row dg-image-brush-slider-row">
                    <span>Curve fit tolerance</span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={Math.round(traceCurveTolerance)}
                      onChange={(event) => {
                        const value = Math.max(0, Math.min(100, Number(event.target.value) || 0));
                        setTraceCurveTolerance(value);
                        emit("image_trace", {
                          phase: "preview",
                          edgeThreshold: traceEdgeThreshold,
                          curveTolerance: value,
                        });
                      }}
                    />
                    <input
                      className="dg-image-brush-value"
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={Math.round(traceCurveTolerance)}
                      onChange={(event) => {
                        const value = Math.max(0, Math.min(100, Number(event.target.value) || 0));
                        setTraceCurveTolerance(value);
                        emit("image_trace", {
                          phase: "preview",
                          edgeThreshold: traceEdgeThreshold,
                          curveTolerance: value,
                        });
                      }}
                    />
                    <em>%</em>
                  </label>

                  <div className="dg-image-brush-head" style={{ justifyContent: "space-between" }}>
                    <PillButton
                      tone="secondary"
                      size="sm"
                      onClick={() => {
                        emit("image_trace", {
                          phase: "cancel",
                          edgeThreshold: traceEdgeThreshold,
                          curveTolerance: traceCurveTolerance,
                        });
                        setIsImageTraceOpen(false);
                      }}
                    >
                      Cancel
                    </PillButton>
                    <PillButton
                      tone="primary"
                      size="sm"
                      onClick={() => {
                        emit("image_trace", {
                          phase: "apply",
                          edgeThreshold: traceEdgeThreshold,
                          curveTolerance: traceCurveTolerance,
                        });
                        setIsImageTraceOpen(false);
                      }}
                    >
                      {imageTraceState?.processing ? "Processing..." : "Apply"}
                    </PillButton>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
