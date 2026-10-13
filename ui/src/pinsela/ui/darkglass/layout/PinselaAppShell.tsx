import React from "react";
import { Topbar } from "./Topbar";
import { EditorHeader } from "./EditorHeader";
import { LeftRail } from "./LeftRail";
import { LeftPanel } from "./LeftPanel";
import { RightRail } from "./RightRail";
import { RightPanel, type RightSectionKey } from "./RightPanel";
import { PinselaIcon } from "../index";
import { LayersSection } from "../panels/LeftPanelSections";
import type { PinselaNode } from "../../../core/types";
import type { ProjectListItem, AssetItem } from "../../../platform/api/pinselaNativeApi";
import type { SelectionSummary } from "../canvas/selectionSummary";
import type {
  LeftPanelCallbacks,
  AutomationBindingField,
  AutomationTemplateSummary,
  AssetUploadProgressItem,
  ImportLibraryItem,
  LeftPanelHistoryItem,
  LeftPanelImageTraceState,
  RulesPanelState,
  SvgImportMode,
} from "../panels/LeftPanelSections";

export type LeftSectionKey = "elements" | "templates" | "assets" | "stroke" | "effects" | "auto_layout" | "boolean_ops" | "perspective_warp" | "image_trace";
export type InspectorTabKey = "properties" | "data" | "rules" | "layers" | "history";
export type CanvasMode = "select" | "text_edit" | "crop" | "path_edit" | "transform" | "pan" | "view_only";

const LOCAL_LEFT_SECTION_META: Record<LeftSectionKey, { title: string; kicker: string; icon: React.ComponentProps<typeof PinselaIcon>["name"] }> = {
  elements: { title: "Elements", kicker: "Content", icon: "Pentagon" },
  templates: { title: "Templates", kicker: "Start", icon: "LayoutTemplate" },
  assets: { title: "Library", kicker: "Media", icon: "ImagePlus" },
  stroke: { title: "Stroke", kicker: "Finish", icon: "CircleDashed" },
  effects: { title: "Effects", kicker: "Style", icon: "Sparkles" },
  auto_layout: { title: "Layout", kicker: "Structure", icon: "LayoutTemplate" },
  boolean_ops: { title: "Vector", kicker: "Operations", icon: "SquaresUnite" },
  perspective_warp: { title: "Perspective", kicker: "Transform", icon: "Expand" },
  image_trace: { title: "Vectorize", kicker: "Image", icon: "ScanLine" },
};

const LOCAL_RIGHT_SECTION_META: Record<RightSectionKey, { title: string; kicker: string; icon: React.ComponentProps<typeof PinselaIcon>["name"] }> = {
  layers: { title: "Layers", kicker: "Document", icon: "Layers" },
  imports: { title: "Files", kicker: "Uploads", icon: "FileImage" },
  automations: { title: "Automations", kicker: "Scale", icon: "Bot" },
  settings: { title: "Settings", kicker: "Environment", icon: "SlidersHorizontal" },
};

export interface PinselaAppShellProps {
  theme?: "obsidian" | "sand" | "teal_ink";
  uiVariant?: "default" | "local_sandbox";
  homeHref?: string;
  showAutomations?: boolean;
  compactViewport?: boolean;
  leftPanelOpen: boolean;
  activeLeftSection: LeftSectionKey;
  rightPanelOpen?: boolean;
  activeRightSection?: RightSectionKey;
  activeInspectorTab: InspectorTabKey;
  canvasMode: CanvasMode;
  children: React.ReactNode;

  editorReady?: boolean;
  projectName?: string;
  formatLabel?: string;
  canvasLabel?: string;
  templateKey?: string;
  onChangeFormat?: () => void;

  projects?: ProjectListItem[];
  automationBindingFields?: AutomationBindingField[];
  automationTemplates?: AutomationTemplateSummary[];
  activeProjectPageName?: string;
  assets?: AssetItem[];
  assetUploads?: AssetUploadProgressItem[];
  assetSearch?: string;
  onAssetSearchChange?: (value: string) => void;
  imports?: ImportLibraryItem[];
  layers?: PinselaNode[];
  historyEntries?: LeftPanelHistoryItem[];
  rulesState?: RulesPanelState;
  selectedNode?: PinselaNode | null;
  selectionSummary?: SelectionSummary;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  zoom?: number;
  onZoomToPercent?: (percent: number) => void;
  onZoomFit?: () => void;
  rulersEnabled?: boolean;
  onToggleRulers?: () => void;
  saveState?: "saved" | "saving" | "offline" | "expired";
  snapEnabled?: boolean;
  gridEnabled?: boolean;
  onToggleSnap?: () => void;
  onToggleGrid?: () => void;
  onSetSnapEnabled?: (enabled: boolean) => void;
  onSetSnapToGrid?: (enabled: boolean) => void;
  onSetSnapTolerance?: (value: number) => void;
  onSetGridSize?: (value: number) => void;

  onShowVersions?: () => void;
  onShowBulk?: () => void;
  onShowExport?: () => void;
  onOpenImports?: () => void;
  onOpenSvgImport?: () => void;
  svgImportMode?: SvgImportMode;
  onSetSvgImportMode?: (mode: SvgImportMode) => void;
  onTogglePagesGrid?: () => void;
  pagesGridOpen?: boolean;
  onLeftSectionChange?: (section: LeftSectionKey) => void;
  onToggleLeftPanel?: () => void;
  onRightSectionChange?: (section: RightSectionKey) => void;
  onToggleRightPanel?: () => void;
  onDismissPanels?: () => void;
  onInspectorTabChange?: (tab: InspectorTabKey) => void;
  onSelectLayer?: (nodeId: string) => void;
  onJumpToHistory?: (index: number) => void;
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
    effects: PinselaNode["style"]["effects"];
  }>) => void;

  leftPanelCallbacks?: LeftPanelCallbacks;
  rightPanelCallbacks?: LeftPanelCallbacks;
  leftImageTraceState?: LeftPanelImageTraceState;
}

export function PinselaAppShell({
  theme = "sand",
  uiVariant = "default",
  homeHref = "/projects",
  showAutomations = true,
  compactViewport = false,
  leftPanelOpen,
  activeLeftSection,
  rightPanelOpen = true,
  activeRightSection = "layers",
  activeInspectorTab,
  canvasMode,
  children,
  editorReady = true,
  projectName,
  formatLabel,
  canvasLabel,
  templateKey,
  onChangeFormat,
  projects,
  automationBindingFields,
  automationTemplates,
  activeProjectPageName,
  assets,
  assetUploads,
  assetSearch,
  onAssetSearchChange,
  imports,
  layers = [],
  historyEntries = [],
  rulesState,
  selectedNode,
  selectionSummary,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  zoom = 100,
  onZoomToPercent,
  onZoomFit,
  rulersEnabled,
  onToggleRulers,
  saveState = "saved",
  snapEnabled = true,
  gridEnabled = true,
  onToggleSnap,
  onToggleGrid,
  onSetSnapEnabled,
  onSetSnapToGrid,
  onSetSnapTolerance,
  onSetGridSize,
  onShowVersions,
  onShowBulk,
  onShowExport,
  onOpenImports,
  onOpenSvgImport,
  svgImportMode = "current_page",
  onSetSvgImportMode,
  onTogglePagesGrid,
  pagesGridOpen = false,
  onLeftSectionChange,
  onToggleLeftPanel,
  onRightSectionChange,
  onToggleRightPanel,
  onDismissPanels,
  onInspectorTabChange,
  onSelectLayer,
  onJumpToHistory,
  onPatchSelectedNode,
  leftPanelCallbacks,
  rightPanelCallbacks,
  leftImageTraceState,
}: PinselaAppShellProps) {
  const shellRootRef = React.useRef<HTMLDivElement | null>(null);
  const isLocalSandboxUi = uiVariant === "local_sandbox";
  const [floatingLayersOpen, setFloatingLayersOpen] = React.useState(false);
  const [floatingLayersPos, setFloatingLayersPos] = React.useState({ x: 0, y: 0 });
  const floatingLayersDragRef = React.useRef<{
    pointerId: number | null;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const lockedStyle: React.CSSProperties = !editorReady
    ? { opacity: 0.35, pointerEvents: "none", filter: "grayscale(0.5)" }
    : {};
  const rightCallbacks = rightPanelCallbacks || leftPanelCallbacks;
  const showLocalMobileLaunchers = isLocalSandboxUi && compactViewport;
  const activeLeftMeta = LOCAL_LEFT_SECTION_META[activeLeftSection];
  const resolvedTopbarName = editorReady
    ? (
      uiVariant === "local_sandbox"
        ? (projectName || selectedNode?.name || "Untitled")
        : (formatLabel || selectedNode?.name || "Untitled")
    )
    : "Pinsela Editor";
  const handleLeftRailSectionChange = React.useCallback((section: string) => {
    onLeftSectionChange?.(section as LeftSectionKey);
  }, [onLeftSectionChange]);
  const handleRightRailSectionChange = React.useCallback((section: string) => {
    onRightSectionChange?.(section as RightSectionKey);
  }, [onRightSectionChange]);
  const handleMobileLeftLauncher = React.useCallback(() => {
    onToggleLeftPanel?.();
  }, [onToggleLeftPanel]);
  const handleMobileLayersLauncher = React.useCallback(() => {
    onRightSectionChange?.("layers");
  }, [onRightSectionChange]);
  const handleMobileImportsLauncher = React.useCallback(() => {
    onRightSectionChange?.("imports");
  }, [onRightSectionChange]);
  const handleMobilePagesLauncher = React.useCallback(() => {
    onDismissPanels?.();
    onTogglePagesGrid?.();
  }, [onDismissPanels, onTogglePagesGrid]);

  React.useEffect(() => {
    if (!isLocalSandboxUi || compactViewport || typeof window === "undefined") return;
    setFloatingLayersPos((current) => {
      if (current.x || current.y) return current;
      return {
        x: Math.max(360, window.innerWidth - 500),
        y: Math.max(92, Math.round((window.innerHeight - 620) / 2)),
      };
    });
  }, [isLocalSandboxUi, compactViewport]);

  const startFloatingLayersDrag = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("button, input, textarea, select, a, label, [role='button']")) return;
    floatingLayersDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: floatingLayersPos.x,
      originY: floatingLayersPos.y,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, [floatingLayersPos.x, floatingLayersPos.y]);

  const moveFloatingLayersDrag = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = floatingLayersDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const width = 420;
    const height = 560;
    setFloatingLayersPos({
      x: Math.max(12, Math.min(window.innerWidth - width - 12, drag.originX + event.clientX - drag.startX)),
      y: Math.max(72, Math.min(window.innerHeight - height - 12, drag.originY + event.clientY - drag.startY)),
    });
  }, []);

  const endFloatingLayersDrag = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = floatingLayersDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    floatingLayersDragRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }, []);

  React.useEffect(() => {
    const root = shellRootRef.current;
    if (!root) return;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
      }
    };
    root.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      root.removeEventListener("wheel", onWheel);
    };
  }, []);

  const mobileOverlayOpen = compactViewport && (leftPanelOpen || rightPanelOpen);

  return (
    <div
      ref={shellRootRef}
      className={`dg-app-root theme-${theme}${uiVariant === "local_sandbox" ? " ui-local-sandbox" : ""}${compactViewport ? " is-compact-viewport" : ""}${mobileOverlayOpen ? " has-mobile-panel" : ""}${leftPanelOpen ? " mobile-left-open" : ""}${rightPanelOpen ? " mobile-right-open" : ""}`}
    >
      <div className="dg-app-frame">
        {/* Topbar is hidden in the local-sandbox desktop variant. Its
            responsibilities migrated to:
              - "My projects" + project identity → LeftRail (top)
              - Project name / page / resolution → CanvasToolbelt (left)
              - Ajustes (snap/grid/rules) → LeftRail settings popover
            The mobile/compact variant still renders the Topbar because
            those entry points are not available in the compact layout. */}
        {!(isLocalSandboxUi && !compactViewport) ? (
          <Topbar
            theme={theme}
            uiVariant={uiVariant}
            compactViewport={compactViewport}
            homeHref={homeHref}
            templateName={resolvedTopbarName}
            projectName={editorReady ? projectName : undefined}
            templateKey={editorReady && uiVariant !== "local_sandbox" ? (templateKey || "untitled") : ""}
            activeProjectPageName={activeProjectPageName}
            canvasLabel={editorReady ? canvasLabel : undefined}
            isDraft={editorReady && uiVariant !== "local_sandbox"}
            saveState={editorReady ? saveState : "offline"}
            zoom={zoom}
            canvasMode={canvasMode}
            snapEnabled={editorReady ? snapEnabled : false}
            gridEnabled={editorReady ? gridEnabled : false}
            snapTolerance={rulesState?.snapTolerance ?? 6}
            gridSize={rulesState?.gridSize ?? 8}
            onToggleSnap={editorReady ? onToggleSnap : undefined}
            onToggleGrid={editorReady ? onToggleGrid : undefined}
            onSetSnapEnabled={editorReady ? onSetSnapEnabled : undefined}
            onSetSnapToGrid={editorReady ? onSetSnapToGrid : undefined}
            onSetSnapTolerance={editorReady ? onSetSnapTolerance : undefined}
            onSetGridSize={editorReady ? onSetGridSize : undefined}
            canUndo={editorReady ? canUndo : false}
            canRedo={editorReady ? canRedo : false}
            onUndo={editorReady ? onUndo : undefined}
            onRedo={editorReady ? onRedo : undefined}
            onShowVersions={editorReady ? onShowVersions : undefined}
            onChangeFormat={editorReady ? onChangeFormat : undefined}
            historyEntries={editorReady ? historyEntries : []}
            onJumpToHistory={editorReady ? onJumpToHistory : undefined}
            onShowBulk={editorReady ? onShowBulk : undefined}
            onShowExport={editorReady ? onShowExport : undefined}
            onOpenImports={editorReady ? onOpenImports : undefined}
            onOpenSvgImport={editorReady ? onOpenSvgImport : undefined}
            svgImportMode={svgImportMode}
            onSetSvgImportMode={editorReady ? onSetSvgImportMode : undefined}
            onTogglePagesGrid={editorReady ? onTogglePagesGrid : undefined}
            pagesGridOpen={pagesGridOpen}
            importsCount={imports?.length || 0}
                      />
        ) : (
          <EditorHeader
            theme={theme}
            homeHref={homeHref}
            projectName={editorReady ? projectName : "Opening project…"}
            templateKey={templateKey}
            saveState={editorReady ? saveState : "offline"}
            canUndo={editorReady ? canUndo : false}
            canRedo={editorReady ? canRedo : false}
            onUndo={editorReady ? onUndo : undefined}
            onRedo={editorReady ? onRedo : undefined}
            zoomPercent={zoom}
            onZoomToPercent={editorReady ? onZoomToPercent : undefined}
            onZoomFit={editorReady ? onZoomFit : undefined}
            rulersEnabled={rulersEnabled}
            onToggleRulers={editorReady ? onToggleRulers : undefined}
            onShowExport={editorReady ? onShowExport : undefined}
          />
        )}

        {showLocalMobileLaunchers ? (
          <div className="dg-mobile-panel-launchers" aria-label="Editor panel shortcuts">
            <button
              type="button"
              className={`dg-mobile-panel-launcher kind-tools ${leftPanelOpen ? "active" : ""}`}
              onClick={handleMobileLeftLauncher}
              aria-pressed={leftPanelOpen}
            >
              <span className="dg-mobile-panel-launcher-icon">
                <PinselaIcon name={activeLeftMeta.icon} size={17} />
              </span>
              <span className="dg-mobile-panel-launcher-copy">
                <span className="dg-mobile-panel-launcher-kicker">Tools</span>
                <span className="dg-mobile-panel-launcher-title">{activeLeftMeta.title}</span>
              </span>
            </button>
            <button
              type="button"
              className={`dg-mobile-panel-launcher kind-layers ${rightPanelOpen && activeRightSection === "layers" ? "active" : ""}`}
              onClick={handleMobileLayersLauncher}
              aria-pressed={rightPanelOpen && activeRightSection === "layers"}
            >
              <span className="dg-mobile-panel-launcher-icon">
                <PinselaIcon name={LOCAL_RIGHT_SECTION_META.layers.icon} size={17} />
              </span>
              <span className="dg-mobile-panel-launcher-copy">
                <span className="dg-mobile-panel-launcher-kicker">{LOCAL_RIGHT_SECTION_META.layers.kicker}</span>
                <span className="dg-mobile-panel-launcher-title">{LOCAL_RIGHT_SECTION_META.layers.title}</span>
              </span>
            </button>
            <button
              type="button"
              className={`dg-mobile-panel-launcher kind-imports ${rightPanelOpen && activeRightSection === "imports" ? "active" : ""}`}
              onClick={handleMobileImportsLauncher}
              aria-pressed={rightPanelOpen && activeRightSection === "imports"}
            >
              <span className="dg-mobile-panel-launcher-icon">
                <PinselaIcon name={LOCAL_RIGHT_SECTION_META.imports.icon} size={17} />
              </span>
              <span className="dg-mobile-panel-launcher-copy">
                <span className="dg-mobile-panel-launcher-kicker">{LOCAL_RIGHT_SECTION_META.imports.kicker}</span>
                <span className="dg-mobile-panel-launcher-title">
                  {LOCAL_RIGHT_SECTION_META.imports.title}
                  {imports?.length ? <span className="dg-mobile-panel-launcher-badge">{imports.length}</span> : null}
                </span>
              </span>
            </button>
            <button
              type="button"
              className={`dg-mobile-panel-launcher kind-pages ${pagesGridOpen ? "active" : ""}`}
              onClick={handleMobilePagesLauncher}
              aria-pressed={pagesGridOpen}
            >
              <span className="dg-mobile-panel-launcher-icon">
                <PinselaIcon name="LayoutGrid" size={17} />
              </span>
              <span className="dg-mobile-panel-launcher-copy">
                <span className="dg-mobile-panel-launcher-kicker">Document</span>
                <span className="dg-mobile-panel-launcher-title">Pages</span>
              </span>
            </button>
          </div>
        ) : null}

        {mobileOverlayOpen && onDismissPanels ? (
          <button
            type="button"
            className="dg-mobile-panel-scrim"
            aria-label="Close side panels"
            onClick={onDismissPanels}
          />
        ) : null}

        <div className="dg-app-main">
          <div
            className={`dg-app-left ${leftPanelOpen ? "panel-open" : "panel-collapsed"}`}
            style={lockedStyle}
            onWheelCapture={(event) => {
              event.stopPropagation();
            }}
          >
            {!showLocalMobileLaunchers ? (
              <LeftRail
                uiVariant={uiVariant}
                activeSection={activeLeftSection}
                collapsed={!leftPanelOpen}
                theme={theme as "obsidian" | "sand"}
                onShowVersions={onShowVersions}
                onSectionChange={handleLeftRailSectionChange}
                                homeHref={homeHref}
                snapEnabled={editorReady ? snapEnabled : false}
                gridEnabled={editorReady ? gridEnabled : false}
                onToggleSnap={editorReady ? onToggleSnap : undefined}
                onToggleGrid={editorReady ? onToggleGrid : undefined}
              />
            ) : null}
            <LeftPanel
              open={editorReady && leftPanelOpen}
              section={activeLeftSection}
              compactViewport={compactViewport}
              onSectionChange={handleLeftRailSectionChange}
              onClose={editorReady ? onToggleLeftPanel : undefined}
              assetSearch={assetSearch}
              onAssetSearchChange={onAssetSearchChange}
              projects={projects}
              assets={assets}
              assetUploads={assetUploads}
              imports={imports}
              automationBindingFields={automationBindingFields}
              automationTemplates={automationTemplates}
              activeProjectPageName={activeProjectPageName}
              layers={layers}
              selectedNode={editorReady ? (selectedNode || null) : null}
              selectionCount={selectionSummary?.count || 0}
              selectedIds={editorReady ? (selectionSummary?.selectedIds || []) : []}
              imageTraceState={leftImageTraceState}
              callbacks={leftPanelCallbacks}
            />
            {editorReady && onToggleLeftPanel && (
              <button
                type="button"
                className="dg-left-panel-edge-toggle"
                onClick={onToggleLeftPanel}
                title={leftPanelOpen ? "Collapse left panel" : "Open left panel"}
                aria-label={leftPanelOpen ? "Collapse left panel" : "Open left panel"}
                style={leftPanelOpen && (!isLocalSandboxUi || compactViewport) ? { right: "calc(-14px - var(--width-leftpanel))" } : undefined}
              >
                <PinselaIcon name={leftPanelOpen ? "PanelLeftClose" : "PanelLeftOpen"} size={18} />
              </button>
            )}
          </div>

          <div className="dg-app-center">{children}</div>

          {/* Right column.

              Previously the local-sandbox desktop variant rendered ONLY a
              floating "Layers" trigger button and skipped the full
              right rail. That hid Files/Flows/Canvas-settings tabs
              and confused users who expected an art-options column on
              the right. Now both variants render the full RightRail +
              RightPanel; the floating trigger is gone. */}
          <div
            className={`dg-app-right ${rightPanelOpen ? "panel-open" : "panel-collapsed"}`}
            style={lockedStyle}
            onWheelCapture={(event) => {
              event.stopPropagation();
            }}
          >
            {editorReady && onToggleRightPanel && (
              <button
                type="button"
                className="dg-right-panel-edge-toggle"
                onClick={onToggleRightPanel}
                title={rightPanelOpen ? "Collapse right panel" : "Open right panel"}
                aria-label={rightPanelOpen ? "Collapse right panel" : "Open right panel"}
                style={rightPanelOpen && (!isLocalSandboxUi || compactViewport) ? { left: "calc(-14px - var(--width-rightpanel))" } : undefined}
              >
                <PinselaIcon name={rightPanelOpen ? "PanelRightClose" : "PanelRightOpen"} size={18} />
              </button>
            )}
            <RightPanel
              open={editorReady && rightPanelOpen}
              section={activeRightSection}
              compactViewport={compactViewport}
              onSectionChange={handleRightRailSectionChange}
              onClose={editorReady ? onToggleRightPanel : undefined}
              showAutomations={showAutomations}
              automationBindingFields={automationBindingFields}
              automationTemplates={automationTemplates}
              activeProjectPageName={activeProjectPageName}
              imports={imports}
              rulesState={rulesState}
              layers={layers}
              selectedNode={editorReady ? (selectedNode || null) : null}
              selectionCount={selectionSummary?.count || 0}
              selectedIds={editorReady ? (selectionSummary?.selectedIds || []) : []}
              callbacks={rightCallbacks}
            />
            {!showLocalMobileLaunchers ? (
              <RightRail
                uiVariant={uiVariant}
                activeSection={activeRightSection}
                collapsed={!rightPanelOpen}
                showAutomations={showAutomations}
                onSectionChange={handleRightRailSectionChange}
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
