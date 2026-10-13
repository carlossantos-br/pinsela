import React from "react";
import { PinselaIcon, GlassPanel } from "../index";
import {
  ImportsSection,
  AutomationsSection,
  SettingsSection,
  type AutomationBindingField,
  type AutomationTemplateSummary,
  LayersSection,
  type ImportLibraryItem,
  type LeftPanelCallbacks,
  type RulesPanelState,
} from "../panels/LeftPanelSections";
import type { PinselaNode } from "../../../core/types";

const PANEL_CLOSE_ANIMATION_MS = 140;
const RIGHT_PANEL_META: Record<RightSectionKey, { kicker: string; title: string; description: string }> = {
  imports: {
    kicker: "Uploads",
    title: "Files",
    description: "Files imported into the project, ready to use.",
  },
  automations: {
    kicker: "Scale",
    title: "Automations",
    description: "Template variables and page generation.",
  },
  layers: {
    kicker: "Document",
    title: "Layers",
    description: "Structure, search and order of layers.",
  },
  settings: {
    kicker: "Environment",
    title: "Settings",
    description: "Grid, snap and editor guides.",
  },
};

const MOBILE_RIGHT_SECTION_OPTIONS: Array<{ id: RightSectionKey; label: string }> = [
  { id: "layers", label: "Layers" },
  { id: "imports", label: "Files" },
  { id: "automations", label: "Automations" },
  { id: "settings", label: "Settings" },
];

export type RightSectionKey = "imports" | "automations" | "layers" | "settings";

export interface RightPanelProps {
  open: boolean;
  section: RightSectionKey;
  compactViewport?: boolean;
  onSectionChange?: (section: string) => void;
  onClose?: () => void;
  showAutomations?: boolean;
  automationBindingFields?: AutomationBindingField[];
  automationTemplates?: AutomationTemplateSummary[];
  activeProjectPageName?: string;
  imports?: ImportLibraryItem[];
  rulesState?: RulesPanelState;
  layers?: PinselaNode[];
  selectedNode?: PinselaNode | null;
  selectionCount?: number;
  selectedIds?: string[];
  callbacks?: LeftPanelCallbacks;
}

export const RightPanel = React.memo(function RightPanel({
  open,
  section,
  compactViewport = false,
  onSectionChange,
  onClose,
  showAutomations = true,
  automationBindingFields,
  automationTemplates,
  activeProjectPageName,
  imports,
  rulesState,
  layers,
  selectedNode,
  selectionCount,
  selectedIds,
  callbacks,
}: RightPanelProps) {
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
  const effectiveSection = !showAutomations && section === "automations" ? "layers" : section;
  const meta = RIGHT_PANEL_META[effectiveSection];
  const mobileOptions = React.useMemo(
    () => MOBILE_RIGHT_SECTION_OPTIONS.filter((option) => showAutomations || option.id !== "automations"),
    [showAutomations],
  );

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
      className={`dg-right-panel is-section-${effectiveSection} ${visible ? "is-open" : "is-closing"}${compactViewport ? " is-compact-viewport" : ""}${sheetDragging ? " is-sheet-dragging" : ""}`}
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
          {compactViewport ? (
            <div className="dg-panel-mobile-switcher" role="tablist" aria-label="Document sections">
              {mobileOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`dg-panel-mobile-switcher-btn ${effectiveSection === option.id ? "active" : ""}`}
                  aria-pressed={effectiveSection === option.id}
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
        {effectiveSection === "imports" && <ImportsSection imports={imports} callbacks={callbacks} />}
        {effectiveSection === "automations" && (
          <AutomationsSection
            callbacks={callbacks}
            bindingFields={automationBindingFields}
            automationTemplates={automationTemplates}
            activePageName={activeProjectPageName}
          />
        )}
        {effectiveSection === "layers" && (
          <LayersSection
            layers={layers}
            callbacks={callbacks}
            selectedNode={selectedNode}
            selectionCount={selectionCount}
            selectedIds={selectedIds}
          />
        )}
        {effectiveSection === "settings" && <SettingsSection callbacks={callbacks} rulesState={rulesState} />}
      </div>
    </GlassPanel>
  );
});
