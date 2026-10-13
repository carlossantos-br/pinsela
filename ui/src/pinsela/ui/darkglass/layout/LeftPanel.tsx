import React from "react";
import { PinselaIcon, GlassPanel } from "../index";
import {
  TemplatesSection,
  ElementsSection,
  AssetsSection,
  ImportsSection,
  StrokeSection,
  EffectsSection,
  AutoLayoutSection,
  BooleanOperationsSection,
  PerspectiveWarpSection,
  ImageTraceSection,
  LayersSection,
  type AssetUploadProgressItem,
  type AutomationBindingField,
  type AutomationTemplateSummary,
  type ImportLibraryItem,
  type LeftPanelCallbacks,
  type LeftPanelImageTraceState,
} from "../panels/LeftPanelSections";
import type { PinselaNode } from "../../../core/types";
import type { ProjectListItem, AssetItem } from "../../../platform/api/pinselaNativeApi";

const PANEL_CLOSE_ANIMATION_MS = 140;
const LEFT_PANEL_META: Record<string, { kicker: string; title: string; description: string }> = {
  elements: {
    kicker: "Content",
    title: "Elements",
    description: "Ready-made shapes, lines, blocks and text to insert on the canvas with one click.",
  },
  templates: {
    kicker: "Structure",
    title: "Templates",
    description: "Start faster with ready-made formats and bases, without taking focus off the canvas.",
  },
  assets: {
    kicker: "Library",
    title: "Library",
    description: "Media, uploads and project files in one place.",
  },
  stroke: {
    kicker: "Finish",
    title: "Strokes",
    description: "Border, weight and stroke alignment.",
  },
  effects: {
    kicker: "Style",
    title: "Effects",
    description: "Shadow, blur and visual finish.",
  },
  auto_layout: {
    kicker: "Structure",
    title: "Auto layout",
    description: "Flow, spacing and distribution of the container.",
  },
  boolean_ops: {
    kicker: "Vector",
    title: "Vector",
    description: "Unite, cut and combine shapes.",
  },
  perspective_warp: {
    kicker: "Transform",
    title: "Perspective",
    description: "Distortion and perspective adjustment.",
  },
  image_trace: {
    kicker: "Vectorizing",
    title: "Vectorize",
    description: "Convert an image to vector with a preview.",
  },
  layers: {
    kicker: "Document",
    title: "Layers",
    description: "Rename, reorder and adjust the selection with search, filters and properties side by side.",
  },
};

const MOBILE_LEFT_SECTION_OPTIONS: Array<{ id: string; label: string }> = [
  { id: "assets", label: "Library" },
];

export interface LeftPanelProps {
  open: boolean;
  section: string;
  compactViewport?: boolean;
  onSectionChange?: (section: string) => void;
  onClose?: () => void;
  assetSearch?: string;
  onAssetSearchChange?: (value: string) => void;
  projects?: ProjectListItem[];
  assets?: AssetItem[];
  assetUploads?: AssetUploadProgressItem[];
  imports?: ImportLibraryItem[];
  automationBindingFields?: AutomationBindingField[];
  automationTemplates?: AutomationTemplateSummary[];
  activeProjectPageName?: string;
  layers?: PinselaNode[];
  selectedNode?: PinselaNode | null;
  selectionCount?: number;
  selectedIds?: string[];
  imageTraceState?: LeftPanelImageTraceState;
  callbacks?: LeftPanelCallbacks;
}

export const LeftPanel = React.memo(function LeftPanel({
  open,
  section,
  compactViewport = false,
  onSectionChange,
  onClose,
  assetSearch,
  onAssetSearchChange,
  projects,
  assets,
  assetUploads,
  imports,
  automationBindingFields,
  automationTemplates,
  activeProjectPageName,
  layers,
  selectedNode,
  selectionCount,
  selectedIds,
  imageTraceState,
  callbacks,
}: LeftPanelProps) {
  const [mounted, setMounted] = React.useState(open);
  const [visible, setVisible] = React.useState(open);
  const [sheetDragOffsetY, setSheetDragOffsetY] = React.useState(0);
  const [sheetDragging, setSheetDragging] = React.useState(false);
  const sheetDragRef = React.useRef<{
    active: boolean;
    pointerId: number | null;
    startY: number;
    startTime: number;
    offsetY: number;
  }>({
    active: false,
    pointerId: null,
    startY: 0,
    startTime: 0,
    offsetY: 0,
  });
  const meta = LEFT_PANEL_META[section] || {
    kicker: "Panel",
    title: section
      .split("_")
      .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
      .join(" "),
    description: "Contextual tools for working on the canvas with less context switching.",
  };

  React.useEffect(() => {
    if (open) {
      setMounted(true);
      const rafId = window.requestAnimationFrame(() => setVisible(true));
      return () => window.cancelAnimationFrame(rafId);
    }
    setVisible(false);
    const timeoutId = window.setTimeout(() => setMounted(false), PANEL_CLOSE_ANIMATION_MS);
    return () => window.clearTimeout(timeoutId);
  }, [open]);

  React.useEffect(() => {
    if (open) return;
    sheetDragRef.current = {
      active: false,
      pointerId: null,
      startY: 0,
      startTime: 0,
      offsetY: 0,
    };
    setSheetDragging(false);
    setSheetDragOffsetY(0);
  }, [open]);

  const finishSheetDrag = React.useCallback((shouldDismiss: boolean) => {
    sheetDragRef.current = {
      active: false,
      pointerId: null,
      startY: 0,
      startTime: 0,
      offsetY: 0,
    };
    setSheetDragging(false);
    setSheetDragOffsetY(0);
    if (shouldDismiss) {
      onClose?.();
    }
  }, [onClose]);

  const handleSheetDragPointerDown = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!compactViewport || !onClose || event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("button, input, textarea, select, a, label, [role='button']")) return;
    sheetDragRef.current = {
      active: true,
      pointerId: event.pointerId,
      startY: event.clientY,
      startTime: typeof performance !== "undefined" ? performance.now() : Date.now(),
      offsetY: 0,
    };
    setSheetDragging(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, [compactViewport, onClose]);

  const handleSheetDragPointerMove = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!sheetDragRef.current.active || sheetDragRef.current.pointerId !== event.pointerId) return;
    const offsetY = Math.max(0, event.clientY - sheetDragRef.current.startY);
    sheetDragRef.current.offsetY = offsetY;
    setSheetDragOffsetY(offsetY);
  }, []);

  const handleSheetDragPointerEnd = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!sheetDragRef.current.active || sheetDragRef.current.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    const elapsedMs = Math.max(1, (typeof performance !== "undefined" ? performance.now() : Date.now()) - sheetDragRef.current.startTime);
    const offsetY = sheetDragRef.current.offsetY;
    const shouldDismiss = offsetY > 116 || (offsetY > 64 && elapsedMs < 220);
    finishSheetDrag(shouldDismiss);
  }, [finishSheetDrag]);

  if (!mounted) return null;

  return (
    <GlassPanel
      tone="panel"
      density="compact"
      border="subtle"
      className={`dg-left-panel ${visible ? "is-open" : "is-closing"}${compactViewport ? " is-compact-viewport" : ""}${sheetDragging ? " is-sheet-dragging" : ""}`}
      aria-hidden={!open}
      style={compactViewport && (sheetDragging || sheetDragOffsetY > 0)
        ? {
          transform: `translateY(${Math.round(sheetDragOffsetY)}px)`,
          transition: sheetDragging ? "none" : undefined,
          willChange: "transform",
        }
        : undefined}
    >
      <div
        className={`dg-panel-header${compactViewport ? " is-sheet-drag-handle" : ""}`}
        onPointerDown={compactViewport ? handleSheetDragPointerDown : undefined}
        onPointerMove={compactViewport ? handleSheetDragPointerMove : undefined}
        onPointerUp={compactViewport ? handleSheetDragPointerEnd : undefined}
        onPointerCancel={compactViewport ? handleSheetDragPointerEnd : undefined}
      >
        <div className="dg-panel-header-copy">
          {compactViewport ? <div className="dg-panel-sheet-grabber" aria-hidden="true" /> : null}
          <span className="dg-panel-kicker">{meta.kicker}</span>
          <div className="dg-panel-title-row">
            <h3 className="dg-panel-title">{meta.title}</h3>
            {onClose ? (
              <button
                type="button"
                className="dg-panel-close-btn"
                onClick={onClose}
                aria-label={`Close ${meta.title} panel`}
                title="Close panel"
              >
                <PinselaIcon name="X" size={16} />
              </button>
            ) : null}
          </div>
          <p className="dg-panel-description">{meta.description}</p>
          {compactViewport && MOBILE_LEFT_SECTION_OPTIONS.length > 1 ? (
            <div className="dg-panel-mobile-switcher" role="tablist" aria-label="Tool sections">
              {MOBILE_LEFT_SECTION_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`dg-panel-mobile-switcher-btn ${section === option.id ? "active" : ""}`}
                  aria-pressed={section === option.id}
                  onClick={() => onSectionChange?.(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      <div className="dg-panel-content">
        {section === "elements" && <ElementsSection callbacks={callbacks} />}
        {section === "templates" && <TemplatesSection templates={projects} callbacks={callbacks} />}
        {section === "assets" && (
          <>
            <ImportsSection imports={imports} callbacks={callbacks} compact />
            <AssetsSection
              assets={assets}
              assetUploads={assetUploads}
              callbacks={callbacks}
              searchValue={assetSearch}
              onSearchValueChange={onAssetSearchChange}
            />
          </>
        )}
        {section === "effects" && (
          <EffectsSection
            callbacks={callbacks}
            selectedNode={selectedNode}
          />
        )}
        {section === "stroke" && (
          <StrokeSection
            callbacks={callbacks}
            selectedNode={selectedNode}
          />
        )}
        {section === "auto_layout" && (
          <AutoLayoutSection
            callbacks={callbacks}
            selectedNode={selectedNode}
            selectionCount={selectionCount}
          />
        )}
        {section === "boolean_ops" && (
          <BooleanOperationsSection
            callbacks={callbacks}
            selectionCount={selectionCount}
          />
        )}
        {section === "perspective_warp" && (
          <PerspectiveWarpSection
            callbacks={callbacks}
            selectionCount={selectionCount}
          />
        )}
        {section === "image_trace" && (
          <ImageTraceSection
            callbacks={callbacks}
            imageTraceState={imageTraceState}
          />
        )}
        {section === "layers" && (
          <LayersSection
            layers={layers}
            callbacks={callbacks}
            selectedNode={selectedNode}
            selectionCount={selectionCount}
            selectedIds={selectedIds}
          />
        )}
      </div>
    </GlassPanel>
  );
});
