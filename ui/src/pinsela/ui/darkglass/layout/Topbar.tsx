import React from "react";
import ReactDOM from "react-dom";
import { PillButton, Badge, IconButton, PinselaIcon, PinselaMark } from "../index";
import { isKeyboardEditableTarget, isKeyboardInMenuContext } from "../../../hooks/keyboardScope";
import type { SvgImportMode } from "../panels/LeftPanelSections";

type TopbarHistoryEntry = {
  id: string;
  label: string;
  active?: boolean;
};

function useMobileSheetDrag(enabled: boolean, onDismiss: () => void) {
  const dragStateRef = React.useRef<{
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
  const [offsetY, setOffsetY] = React.useState(0);
  const [dragging, setDragging] = React.useState(false);

  React.useEffect(() => {
    if (enabled) return;
    dragStateRef.current = {
      active: false,
      pointerId: null,
      startY: 0,
      startTime: 0,
      offsetY: 0,
    };
    setOffsetY(0);
    setDragging(false);
  }, [enabled]);

  const finishDrag = React.useCallback((shouldDismiss: boolean) => {
    dragStateRef.current = {
      active: false,
      pointerId: null,
      startY: 0,
      startTime: 0,
      offsetY: 0,
    };
    setDragging(false);
    setOffsetY(0);
    if (shouldDismiss) {
      onDismiss();
    }
  }, [onDismiss]);

  const dragHandleProps = React.useMemo<React.HTMLAttributes<HTMLDivElement>>(() => (
    enabled
      ? {
        onPointerDown: (event) => {
          if (event.button !== 0) return;
          const target = event.target as HTMLElement | null;
          if (target?.closest("button, input, textarea, select, a, label, [role='button']")) return;
          dragStateRef.current = {
            active: true,
            pointerId: event.pointerId,
            startY: event.clientY,
            startTime: typeof performance !== "undefined" ? performance.now() : Date.now(),
            offsetY: 0,
          };
          setDragging(true);
          event.currentTarget.setPointerCapture?.(event.pointerId);
        },
        onPointerMove: (event) => {
          if (!dragStateRef.current.active || dragStateRef.current.pointerId !== event.pointerId) return;
          const nextOffsetY = Math.max(0, event.clientY - dragStateRef.current.startY);
          dragStateRef.current.offsetY = nextOffsetY;
          setOffsetY(nextOffsetY);
        },
        onPointerUp: (event) => {
          if (!dragStateRef.current.active || dragStateRef.current.pointerId !== event.pointerId) return;
          event.currentTarget.releasePointerCapture?.(event.pointerId);
          const elapsedMs = Math.max(1, (typeof performance !== "undefined" ? performance.now() : Date.now()) - dragStateRef.current.startTime);
          const shouldDismiss = dragStateRef.current.offsetY > 116 || (dragStateRef.current.offsetY > 64 && elapsedMs < 220);
          finishDrag(shouldDismiss);
        },
        onPointerCancel: (event) => {
          if (!dragStateRef.current.active || dragStateRef.current.pointerId !== event.pointerId) return;
          event.currentTarget.releasePointerCapture?.(event.pointerId);
          finishDrag(false);
        },
      }
      : {}
  ), [enabled, finishDrag]);

  return {
    dragging,
    sheetStyle: enabled && (dragging || offsetY > 0)
      ? {
        transform: `translateY(${Math.round(offsetY)}px)`,
        transition: dragging ? "none" : undefined,
        willChange: "transform",
      }
      : undefined,
    dragHandleProps,
  };
}

export interface TopbarProps {
  theme?: "obsidian" | "sand" | "teal_ink";
  uiVariant?: "default" | "local_sandbox";
  compactViewport?: boolean;
  homeHref?: string;
  templateName: string;
  projectName?: string;
  templateKey: string;
  activeProjectPageName?: string;
  canvasLabel?: string;
  isDraft: boolean;
  saveState: "saved" | "saving" | "offline" | "expired";
  zoom: number;
  canvasMode: string;
  snapEnabled: boolean;
  gridEnabled: boolean;
  snapTolerance?: number;
  gridSize?: number;
  onToggleSnap?: () => void;
  onToggleGrid?: () => void;
  onSetSnapEnabled?: (enabled: boolean) => void;
  onSetSnapToGrid?: (enabled: boolean) => void;
  onSetSnapTolerance?: (value: number) => void;
  onSetGridSize?: (value: number) => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  historyEntries?: TopbarHistoryEntry[];
  onJumpToHistory?: (index: number) => void;
  onShowVersions?: () => void;
  onShowBulk?: () => void;
  onShowExport?: () => void;
  onChangeFormat?: () => void;
  onTogglePagesGrid?: () => void;
  pagesGridOpen?: boolean;
  importsCount?: number;
  onOpenImports?: () => void;
  onOpenSvgImport?: () => void;
  svgImportMode?: SvgImportMode;
  onSetSvgImportMode?: (mode: SvgImportMode) => void;
}

const SHORTCUT_GROUPS = [
  {
    title: "Insert",
    items: [
      { keys: ["R"], label: "Rectangle" },
      { keys: ["C"], label: "Circle" },
      { keys: ["F"], label: "Frame" },
      { keys: ["L"], label: "Line" },
      { keys: ["T"], label: "Text" },
      { keys: ["I"], label: "Image" },
    ],
  },
  {
    title: "Edit",
    items: [
      { keys: ["Cmd/Ctrl", "Z"], label: "Undo" },
      { keys: ["Shift", "Cmd/Ctrl", "Z"], label: "Redo" },
      { keys: ["Cmd/Ctrl", "C"], label: "Copy" },
      { keys: ["Cmd/Ctrl", "V"], label: "Paste" },
      { keys: ["Cmd/Ctrl", "D"], label: "Duplicate" },
      { keys: ["Delete"], label: "Delete selection" },
    ],
  },
  {
    title: "Arrange",
    items: [
      { keys: ["Cmd/Ctrl", "G"], label: "Group" },
      { keys: ["Shift", "Cmd/Ctrl", "G"], label: "Ungroup" },
      { keys: ["Cmd/Ctrl", "A"], label: "Select all" },
      { keys: ["Esc"], label: "Clear selection" },
      { keys: ["Arrows"], label: "Move 1px" },
      { keys: ["Shift", "Arrows"], label: "Move 10px" },
    ],
  },
] as const;

export const Topbar = React.memo(function Topbar({
  theme = "sand",
  uiVariant = "default",
  compactViewport = false,
  homeHref = "/projects",
  templateName,
  projectName,
  templateKey,
  activeProjectPageName,
  canvasLabel,
  isDraft,
  saveState,
  zoom,
  canvasMode,
  snapEnabled,
  gridEnabled,
  snapTolerance = 6,
  gridSize = 8,
  onToggleSnap,
  onToggleGrid,
  onSetSnapEnabled,
  onSetSnapToGrid,
  onSetSnapTolerance,
  onSetGridSize,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  historyEntries = [],
  onJumpToHistory,
  onShowVersions,
  onShowBulk,
  onShowExport,
  onChangeFormat,
  onTogglePagesGrid,
  pagesGridOpen = false,
  importsCount = 0,
  onOpenImports,
  onOpenSvgImport,
  svgImportMode = "current_page",
  onSetSvgImportMode,
}: TopbarProps) {
  const isLocalSandboxUi = uiVariant === "local_sandbox";
  const isCompactLocal = isLocalSandboxUi && compactViewport;
  const [rulesOpen, setRulesOpen] = React.useState(false);
  const [rulesAnchorRect, setRulesAnchorRect] = React.useState<DOMRect | null>(null);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [historyAnchorRect, setHistoryAnchorRect] = React.useState<DOMRect | null>(null);
  const [statusOpen, setStatusOpen] = React.useState(false);
  const [statusAnchorRect, setStatusAnchorRect] = React.useState<DOMRect | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false);
  const rulesSheetDrag = useMobileSheetDrag(isCompactLocal && rulesOpen, () => setRulesOpen(false));
  const historySheetDrag = useMobileSheetDrag(isCompactLocal && historyOpen, () => setHistoryOpen(false));
  const statusSheetDrag = useMobileSheetDrag(isCompactLocal && statusOpen, () => setStatusOpen(false));
  const shortcutsSheetDrag = useMobileSheetDrag(isCompactLocal && shortcutsOpen, () => setShortcutsOpen(false));

  function setSnapEnabled(next: boolean) {
    if (onSetSnapEnabled) {
      onSetSnapEnabled(next);
      return;
    }
    if (onToggleSnap && next !== snapEnabled) {
      onToggleSnap();
    }
  }

  function setSnapToGrid(next: boolean) {
    if (onSetSnapToGrid) {
      onSetSnapToGrid(next);
      return;
    }
    if (onToggleGrid && next !== gridEnabled) {
      onToggleGrid();
    }
  }

  const resolvedProjectName = (projectName || templateName || "Untitled").trim() || "Untitled";
  const normalizedPageName = (activeProjectPageName?.trim() || "").replace(/^P(?:a|\u00e1)gina(?= \d+$)/, "Page");
  const pageLabel = normalizedPageName || "Page 1";
  const resolvedCanvasLabel = canvasLabel?.trim() || "";
  const projectSummaryMeta = [pageLabel, resolvedCanvasLabel].filter(Boolean).join(" · ");
  const saveStateLabel = saveState === "saved" ? "Saved" : saveState === "saving" ? "Saving" : saveState === "expired" ? "Session expired" : "Offline";
  const saveStateTone = saveState === "saved" ? "ok" : saveState === "offline" || saveState === "expired" ? "bad" : "warn";
  const svgImportModeLabel = svgImportMode === "new_page" ? "New page" : "Current";
  const modeLabel = canvasMode === "text_edit"
    ? "Text"
    : canvasMode === "crop"
      ? "Crop"
      : canvasMode === "path_edit"
        ? "Points"
        : canvasMode === "transform"
          ? "Transform"
          : canvasMode === "pan"
            ? "Pan"
            : canvasMode === "view_only"
            ? "View"
      : "Select";
  const remoteActionsAvailable = Boolean(onShowVersions || onShowBulk);
  const mobileSheetStyle: React.CSSProperties | null = isCompactLocal
    ? {
      position: "fixed",
      left: 12,
      right: 12,
      bottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)",
      zIndex: 2200,
    }
    : null;
  const renderMobileSheetHeader = (
    title: string,
    onClose: () => void,
    note?: string,
    dragHandleProps?: React.HTMLAttributes<HTMLDivElement>,
  ) => (
    <div className="dg-mobile-sheet-shell" {...(dragHandleProps || {})}>
      <div className="dg-mobile-sheet-grabber" aria-hidden="true" />
      <div className="dg-mobile-sheet-head">
        <div className="dg-mobile-sheet-title-group">
          <div className="dg-mobile-sheet-title">{title}</div>
          {note ? <div className="dg-mobile-sheet-note">{note}</div> : null}
        </div>
        <button
          type="button"
          className="dg-mobile-sheet-close"
          onClick={onClose}
          aria-label={`Close ${title}`}
        >
          <PinselaIcon name="X" size={15} />
        </button>
      </div>
    </div>
  );
  const templateTitleButton = (
    <button
      type="button"
      className="dg-template-title"
      onClick={onChangeFormat}
      disabled={!onChangeFormat}
      title="Change document format"
    >
      <span className="dg-topbar-doc-kicker">Document</span>
      <span className="dg-topbar-doc-row">
        <span className="dg-topbar-doc-title">{templateName}</span>
        <span className="dg-chevron"><PinselaIcon name="ChevronDown" size={12} /></span>
      </span>
      <span className="dg-topbar-doc-meta">{pageLabel}{templateKey ? ` · ${templateKey}` : ""}</span>
    </button>
  );
  const localBackLink = (
    <a href={homeHref} className="dg-topbar-back-link" aria-label="Back to my projects">
      <PinselaIcon name="ArrowLeft" size={14} />
      <span>My projects</span>
    </a>
  );
  const localProjectCard = (
    <div className="dg-topbar-project-card" aria-label="Current project">
      <span className="dg-topbar-project-kicker">Current project</span>
      <span className="dg-topbar-project-title" title={resolvedProjectName}>{resolvedProjectName}</span>
      <span className="dg-topbar-project-meta" title={projectSummaryMeta || pageLabel}>
        {projectSummaryMeta || pageLabel}
      </span>
    </div>
  );
  const localProjectIdentity = (
    <div className="dg-topbar-project-inline" aria-label="Current project">
      <div className="dg-topbar-project-inline-copy">
        <span className="dg-topbar-project-inline-name" title={resolvedProjectName}>{resolvedProjectName}</span>
      </div>
      <div className="dg-topbar-project-inline-meta" title={projectSummaryMeta || pageLabel}>
        <span>{pageLabel}</span>
        {resolvedCanvasLabel ? <span className="dg-topbar-project-inline-dot" aria-hidden="true" /> : null}
        {resolvedCanvasLabel ? <span>{resolvedCanvasLabel}</span> : null}
      </div>
    </div>
  );
  const localSaveStatePill = (
    <span className={`dg-topbar-save-pill tone-${saveStateTone}`} aria-label={`Project status: ${saveStateLabel}`}>
      {saveState === "saved"
        ? <PinselaIcon name="CheckCircle2" size={12} />
        : <PinselaIcon name="CloudFog" size={12} />}
      <strong>{saveStateLabel}</strong>
    </span>
  );
  const localPagesButton = onTogglePagesGrid ? (
    <PillButton tone={pagesGridOpen ? "secondary" : "neutral"} size="sm" onClick={onTogglePagesGrid}>
      <PinselaIcon name="LayoutGrid" size={14} style={{ marginRight: 6 }} />
      Pages
    </PillButton>
  ) : null;
  const localImportsButton = onOpenImports ? (
    <PillButton tone="neutral" size="sm" onClick={onOpenImports}>
      <PinselaIcon name="FolderOpen" size={14} style={{ marginRight: 6 }} />
      <span>Files</span>
      {importsCount > 0 ? <span className="dg-pill-inline-count" aria-hidden="true">{importsCount}</span> : null}
    </PillButton>
  ) : null;
  const localSnapButton = (
    <PillButton
      tone={snapEnabled ? "secondary" : "neutral"}
      size="sm"
      onClick={() => setSnapEnabled(!snapEnabled)}
    >
      <PinselaIcon name="Magnet" size={14} style={{ marginRight: 6 }} />
      Snap
    </PillButton>
  );
  const localGridButton = (
    <PillButton
      tone={gridEnabled ? "secondary" : "neutral"}
      size="sm"
      onClick={() => setSnapToGrid(!gridEnabled)}
    >
      <PinselaIcon name="Grid" size={14} style={{ marginRight: 6 }} />
      Grid
    </PillButton>
  );
  const localRulesButton = (
    <PillButton
      tone={rulesOpen ? "secondary" : "neutral"}
      size="sm"
      onClick={(event) => {
        const rect = (event.currentTarget as HTMLButtonElement).getBoundingClientRect();
        setRulesAnchorRect(rect);
        setHistoryOpen(false);
        setRulesOpen((prev) => !prev);
      }}
    >
      <PinselaIcon name="Settings2" size={14} style={{ marginRight: 6 }} />
      Settings
    </PillButton>
  );
  const localHistoryButton = (
    <PillButton
      tone={historyOpen ? "secondary" : "neutral"}
      size="sm"
      onClick={(event) => {
        const rect = (event.currentTarget as HTMLButtonElement).getBoundingClientRect();
        setHistoryAnchorRect(rect);
        setRulesOpen(false);
        setHistoryOpen((prev) => !prev);
      }}
    >
      <PinselaIcon name="History" size={14} style={{ marginRight: 6 }} />
      History
    </PillButton>
  );
  const localNewArtworkButton = onChangeFormat ? (
    <PillButton tone="neutral" size="sm" onClick={onChangeFormat}>
      <PinselaIcon name="Plus" size={14} style={{ marginRight: 6 }} />
      New design
    </PillButton>
  ) : null;
  const localExportButton = onShowExport ? (
    <PillButton tone="secondary" size="sm" onClick={onShowExport}>
      <PinselaIcon name="Download" size={14} style={{ marginRight: 6 }} />
      Export
    </PillButton>
  ) : null;
  const localCanvasSummary = resolvedCanvasLabel ? (
    <span className="dg-topbar-mobile-summary-pill tone-static kind-size">
      <PinselaIcon name="Ruler" size={13} />
      <span className="dg-topbar-mobile-summary-pill-copy">
        <span className="dg-topbar-mobile-summary-pill-kicker">Size</span>
        <strong>{resolvedCanvasLabel}</strong>
      </span>
    </span>
  ) : null;
  const statusTrigger = isLocalSandboxUi ? (
    <button
      type="button"
      className={`dg-status-center-trigger tone-${saveStateTone}${isCompactLocal ? " compact" : ""}`}
      title={`${saveStateLabel} · ${modeLabel} · ${Math.round(zoom)}%`}
      aria-label={`Project status: ${saveStateLabel}. Mode: ${modeLabel}. Zoom ${Math.round(zoom)}%.`}
      onClick={(event) => {
        const rect = (event.currentTarget as HTMLButtonElement).getBoundingClientRect();
        setStatusAnchorRect(rect);
        setRulesOpen(false);
        setHistoryOpen(false);
        setShortcutsOpen(false);
        setStatusOpen((prev) => !prev);
      }}
    >
      <span className="dg-status-center-main">
        {saveState === "saved"
          ? <PinselaIcon name="CheckCircle2" size={12} />
          : <PinselaIcon name="CloudFog" size={12} />}
        <span>{saveStateLabel}</span>
      </span>
      <span className="dg-status-center-meta">{`${Math.round(zoom)}%`}</span>
      <PinselaIcon name="ChevronDown" size={12} />
    </button>
  ) : null;
  const shortcutsButton = isLocalSandboxUi ? (
    <PillButton
      tone="neutral"
      size="sm"
      onClick={() => {
        setStatusOpen(false);
        setRulesOpen(false);
        setHistoryOpen(false);
        setShortcutsOpen(true);
      }}
    >
      Shortcuts
    </PillButton>
  ) : null;
  const historyButton = (
    isCompactLocal ? (
      <IconButton
        size="sm"
        icon={<PinselaIcon name="History" size={14} />}
        title="History"
        onClick={(event) => {
          const rect = (event.currentTarget as HTMLButtonElement).getBoundingClientRect();
          setHistoryAnchorRect(rect);
          setRulesOpen(false);
          setHistoryOpen((prev) => !prev);
        }}
      />
    ) : (
      <PillButton
        tone="neutral"
        size="sm"
        onClick={(event) => {
          const rect = (event.currentTarget as HTMLButtonElement).getBoundingClientRect();
          setHistoryAnchorRect(rect);
          setRulesOpen(false);
          setHistoryOpen((prev) => !prev);
        }}
      >
        <PinselaIcon name="History" size={14} style={{ marginRight: 6 }} />
        History
      </PillButton>
    )
  );
  const exportButton = onShowExport ? (
    isCompactLocal ? (
      <IconButton
        size="sm"
        icon={<PinselaIcon name="Download" size={14} />}
        title="Export"
        onClick={onShowExport}
      />
    ) : (
      <PillButton tone="secondary" size="sm" onClick={onShowExport}>
        <PinselaIcon name="Download" size={14} style={{ marginRight: 6 }} />
        Export
      </PillButton>
    )
  ) : null;
  const pagesButton = (
    <IconButton
      size="sm"
      icon={<PinselaIcon name="LayoutGrid" size={14} />}
      active={pagesGridOpen}
      title="Pages"
      onClick={onTogglePagesGrid}
      disabled={!onTogglePagesGrid}
    />
  );
  const undoTools = (
    <div className="dg-tool-group">
      <IconButton
        size="sm"
        icon={<PinselaIcon name="Undo2" size={14} />}
        onClick={onUndo}
        title="Undo"
        style={{ opacity: canUndo ? 1 : 0.35 }}
        disabled={!canUndo}
      />
      <IconButton
        size="sm"
        icon={<PinselaIcon name="Redo2" size={14} />}
        onClick={onRedo}
        title="Redo"
        style={{ opacity: canRedo ? 1 : 0.35 }}
        disabled={!canRedo}
      />
    </div>
  );
  const precisionTools = (
    <div className="dg-tool-group">
      <IconButton size="sm" icon={<PinselaIcon name="Magnet" size={14} />} active={snapEnabled} title="Snap to guides" onClick={onToggleSnap} />
      <IconButton size="sm" icon={<PinselaIcon name="Grid" size={14} />} active={gridEnabled} title="Grid" onClick={onToggleGrid} />
      <IconButton
        size="sm"
        icon={<PinselaIcon name="MoreHorizontal" size={14} />}
        active={rulesOpen}
        title="Precision and grid"
        onClick={(event) => {
          const rect = (event.currentTarget as HTMLButtonElement).getBoundingClientRect();
          setRulesAnchorRect(rect);
          setHistoryOpen(false);
          setRulesOpen((prev) => !prev);
        }}
      />
    </div>
  );

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (isKeyboardEditableTarget(event.target)) return;
      if (isKeyboardInMenuContext(event.target)) return;
      if ((event.key === "?" || (event.key === "/" && event.shiftKey)) && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        setStatusOpen(false);
        setRulesOpen(false);
        setHistoryOpen(false);
        setShortcutsOpen(true);
        return;
      }
      if (event.key === "Escape") {
        setShortcutsOpen(false);
        setStatusOpen(false);
        setRulesOpen(false);
        setHistoryOpen(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="dg-topbar">
      {isCompactLocal ? (
        <>
          <div className="dg-topbar-mobile-main">
            <div className="dg-topbar-mobile-brand">{localBackLink}</div>
            <div className="dg-topbar-mobile-doc">{localProjectCard}</div>
            {undoTools}
            {statusTrigger || localSaveStatePill}
            {onShowExport ? (
              <PillButton tone="primary" size="sm" className="dg-topbar-mobile-export" onClick={onShowExport}>
                <PinselaIcon name="Download" size={14} style={{ marginRight: 6 }} />
                Export
              </PillButton>
            ) : null}
          </div>
        </>
      ) : (
        isLocalSandboxUi ? (
          <>
            <div className="dg-topbar-cluster dg-topbar-left dg-topbar-left-local">
              {localBackLink}
              {localProjectIdentity}
            </div>

            <div className="dg-topbar-cluster dg-topbar-center dg-topbar-center-local">
              {localRulesButton}
            </div>

            <div className="dg-topbar-cluster dg-topbar-right dg-topbar-right-local">
            </div>
          </>
        ) : (
        <>
          <div className="dg-topbar-cluster dg-topbar-left">
            <a href={homeHref} className="dg-topbar-home-link" aria-label="Back to projects">
              <PinselaMark size={22} className="dg-topbar-home-logo" />
            </a>
            {isLocalSandboxUi ? (
              <div className="dg-topbar-brand-copy">
                <span className="dg-topbar-brand-kicker">Local sandbox</span>
                <span className="dg-topbar-brand-title">Pinsela Editor Lab</span>
              </div>
            ) : null}
            {templateTitleButton}
            {!isLocalSandboxUi && templateKey ? <Badge tone="info" size="sm">{templateKey}</Badge> : null}
            {isDraft && <Badge tone="warn" size="sm">Draft</Badge>}
            {isLocalSandboxUi ? <span className="dg-topbar-local-note">Automatic local saving</span> : null}
          </div>

          <div className="dg-topbar-cluster dg-topbar-center">
            {undoTools}
            {precisionTools}
            {!isLocalSandboxUi ? (
              <>
                <Badge tone="info" size="sm">{modeLabel}</Badge>
                <Badge tone={saveStateTone} size="sm">
                  {saveState === "saved"
                    ? <PinselaIcon name="CheckCircle2" size={12} style={{ marginRight: 4 }} />
                    : <PinselaIcon name="CloudFog" size={12} style={{ marginRight: 4 }} />}
                  {saveStateLabel}
                </Badge>
              </>
            ) : null}
            <button
              type="button"
              className="dg-topbar-zoom-pill"
              title="Current zoom"
              onClick={() => {
                setRulesOpen(false);
                setHistoryOpen(false);
              }}
            >
              {Math.round(zoom)}%
            </button>
          </div>

          <div className="dg-topbar-cluster dg-topbar-right">
            {onOpenSvgImport ? (
              <PillButton
                tone="neutral"
                size="sm"
                onClick={onOpenSvgImport}
                title={`Import SVG into ${svgImportMode === "new_page" ? "a new page" : "the current page"}`}
              >
                <PinselaIcon name="FileUp" size={14} style={{ marginRight: 6 }} />
                SVG
              </PillButton>
            ) : null}
            {onSetSvgImportMode ? (
              <PillButton
                tone="neutral"
                size="sm"
                onClick={() => onSetSvgImportMode(svgImportMode === "new_page" ? "current_page" : "new_page")}
                title={svgImportMode === "new_page" ? "SVG will open in a new page" : "SVG will be added to the current page"}
              >
                {svgImportModeLabel}
              </PillButton>
            ) : null}
            {pagesButton}
            {statusTrigger}
            {shortcutsButton}
            {historyButton}
            {onShowBulk ? <PillButton tone="neutral" size="sm" onClick={onShowBulk}>Data</PillButton> : null}
            <div className="dg-separator" />
            {exportButton}
            <div className="dg-user-avatar" title="Current workspace"><PinselaIcon name="User" size={16} /></div>
          </div>
        </>
        )
      )}

      {rulesOpen && rulesAnchorRect && ReactDOM.createPortal(
        <div className="dg-floating-popover-layer" onMouseDown={() => setRulesOpen(false)}>
          <div
            className={`dg-rules-popover${isCompactLocal ? " dg-mobile-popover-sheet" : ""}`}
            style={isCompactLocal
              ? { ...(mobileSheetStyle || {}), ...(rulesSheetDrag.sheetStyle || {}) }
              : {
                position: "fixed",
                top: Math.round(rulesAnchorRect.bottom + 10),
                left: Math.round(Math.min(window.innerWidth - 280, Math.max(12, rulesAnchorRect.left - 180))),
                zIndex: 2200,
              }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            {isCompactLocal
              ? renderMobileSheetHeader("Settings", () => setRulesOpen(false), "Canvas snap and grid", rulesSheetDrag.dragHandleProps)
              : <div className="dg-rules-popover-title">Canvas settings</div>}

            <label className="dg-rules-popover-check">
              <span>Magnetic guides</span>
              <input
                type="checkbox"
                checked={snapEnabled}
                onChange={(event) => setSnapEnabled(event.target.checked)}
              />
            </label>

            <label className="dg-rules-popover-check">
              <span>Snap to grid</span>
              <input
                type="checkbox"
                checked={gridEnabled}
                onChange={(event) => setSnapToGrid(event.target.checked)}
              />
            </label>

            <label className="dg-rules-popover-field">
              <span>Grid size</span>
              <input
                type="number"
                min={2}
                value={Math.max(2, Math.round(Number(gridSize || 8)))}
                onChange={(event) => onSetGridSize?.(Math.max(2, Number(event.target.value || 2)))}
              />
            </label>

            <label className="dg-rules-popover-field">
              <span>Snap tolerance</span>
              <input
                type="number"
                min={1}
                value={Math.max(1, Math.round(Number(snapTolerance || 6)))}
                onChange={(event) => onSetSnapTolerance?.(Math.max(1, Number(event.target.value || 1)))}
              />
            </label>
          </div>
        </div>,
        document.body,
      )}

      {historyOpen && historyAnchorRect && ReactDOM.createPortal(
        <div className="dg-floating-popover-layer" onMouseDown={() => setHistoryOpen(false)}>
          <div
            className={`dg-history-popover${isCompactLocal ? " dg-mobile-popover-sheet" : ""}`}
            style={isCompactLocal
              ? { ...(mobileSheetStyle || {}), ...(historySheetDrag.sheetStyle || {}) }
              : {
                position: "fixed",
                top: Math.round(historyAnchorRect.bottom + 10),
                left: Math.round(Math.min(window.innerWidth - 336, Math.max(12, historyAnchorRect.left - 130))),
                zIndex: 2200,
              }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            {isCompactLocal
              ? renderMobileSheetHeader("History", () => setHistoryOpen(false), "Go back to recent snapshots", historySheetDrag.dragHandleProps)
              : <div className="dg-rules-popover-title">Recent history</div>}

            {(onShowVersions) ? (
              <div className="dg-history-popover-actions">
                {onShowVersions ? (
                  <PillButton
                    tone="neutral"
                    size="sm"
                    onClick={() => {
                      setHistoryOpen(false);
                      onShowVersions();
                    }}
                  >
                    Versions
                  </PillButton>
                ) : null}
              </div>
            ) : null}

            <div className="dg-history-popover-list">
              {historyEntries.length > 0 ? historyEntries.map((entry, index) => (
                <button
                  type="button"
                  key={entry.id}
                  className={`dg-history-row ${entry.active ? "active" : ""}`}
                  onClick={() => {
                    onJumpToHistory?.(index);
                    setHistoryOpen(false);
                  }}
                >
                  {entry.label}
                </button>
              )) : <div className="dg-empty-state-title">No history yet.</div>}
            </div>
          </div>
        </div>,
        document.body,
      )}

      {statusOpen && statusAnchorRect && ReactDOM.createPortal(
        <div className="dg-floating-popover-layer" onMouseDown={() => setStatusOpen(false)}>
          <div
            className={`dg-history-popover dg-status-popover${isCompactLocal ? " dg-mobile-popover-sheet" : ""}`}
            style={isCompactLocal
              ? { ...(mobileSheetStyle || {}), ...(statusSheetDrag.sheetStyle || {}) }
              : {
                position: "fixed",
                top: Math.round(statusAnchorRect.bottom + 10),
                left: Math.round(Math.min(window.innerWidth - 360, Math.max(12, statusAnchorRect.left - 170))),
                zIndex: 2200,
              }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            {isCompactLocal
              ? renderMobileSheetHeader("Project", () => setStatusOpen(false), "Document, shortcuts, theme and actions", statusSheetDrag.dragHandleProps)
              : <div className="dg-rules-popover-title">Project</div>}

            <div className="dg-status-popover-grid">
              <div className="dg-status-card">
                <span className="dg-status-card-label">Document</span>
                <strong>{saveStateLabel}</strong>
                <span>{saveState === "saved" ? "Local autosave up to date" : saveState === "saving" ? "Saving changes" : "Remote saving unavailable"}</span>
              </div>
              <div className="dg-status-card">
                <span className="dg-status-card-label">History</span>
                <strong>{historyEntries.length}</strong>
                <span>{historyEntries.length === 1 ? "local snapshot" : "local snapshots"}</span>
              </div>
              <div className="dg-status-card">
                <span className="dg-status-card-label">Files</span>
                <strong>{importsCount}</strong>
                <span>{importsCount === 1 ? "file in project" : "files in project"}</span>
              </div>
            </div>

            {isCompactLocal && isLocalSandboxUi ? (
              <div className="dg-status-popover-section">
                <div className="dg-status-popover-section-title">Canvas</div>
                <div className="dg-workspace-settings-rules">
                  <button type="button" role="switch" aria-checked={snapEnabled} className={`dg-settings-switch-row${snapEnabled ? " is-on" : ""}`} onClick={() => setSnapEnabled(!snapEnabled)}>
                    <PinselaIcon name="Magnet" size={15} />
                    <span className="dg-settings-switch-copy"><strong>Snap to guides</strong><small>Magnet when moving and resizing</small></span>
                    <span className="dg-settings-switch-track" aria-hidden="true"><i /></span>
                  </button>
                  <button type="button" role="switch" aria-checked={gridEnabled} className={`dg-settings-switch-row${gridEnabled ? " is-on" : ""}`} onClick={() => setSnapToGrid(!gridEnabled)}>
                    <PinselaIcon name="Grid" size={15} />
                    <span className="dg-settings-switch-copy"><strong>Snap to grid</strong><small>Positions in multiples of the grid size</small></span>
                    <span className="dg-settings-switch-track" aria-hidden="true"><i /></span>
                  </button>
                </div>
              </div>
            ) : null}

            <div className="dg-status-popover-section">
              <div className="dg-status-popover-section-title">Quick actions</div>
              <div className="dg-status-popover-actions">
                {onTogglePagesGrid && !isCompactLocal ? (
                  <PillButton tone="neutral" size="sm" onClick={() => {
                    setStatusOpen(false);
                    onTogglePagesGrid();
                  }}>
                    Pages
                  </PillButton>
                ) : null}
                {onOpenImports && !isCompactLocal ? (
                  <PillButton tone="neutral" size="sm" onClick={() => {
                    setStatusOpen(false);
                    onOpenImports();
                  }}>
                    Files
                  </PillButton>
                ) : null}
                {onShowExport && !isCompactLocal ? (
                  <PillButton tone="neutral" size="sm" onClick={() => {
                    setStatusOpen(false);
                    onShowExport();
                  }}>
                    Export
                  </PillButton>
                ) : null}
                <PillButton tone="neutral" size="sm" onClick={(event) => {
                  const rect = (event.currentTarget as HTMLButtonElement).getBoundingClientRect();
                  setStatusOpen(false);
                  setRulesOpen(false);
                  setShortcutsOpen(false);
                  setHistoryAnchorRect(rect);
                  setHistoryOpen((prev) => !prev);
                }}>
                  History
                </PillButton>
                <PillButton tone="neutral" size="sm" onClick={() => {
                  setStatusOpen(false);
                  setRulesOpen(false);
                  setHistoryOpen(false);
                  setShortcutsOpen(true);
                }}>
                  Shortcuts
                </PillButton>
                {onChangeFormat ? (
                  <PillButton tone="neutral" size="sm" onClick={() => {
                    setStatusOpen(false);
                    onChangeFormat();
                  }}>
                    New design
                  </PillButton>
                ) : null}
                {onShowVersions ? (
                  <PillButton tone="neutral" size="sm" onClick={() => {
                    setStatusOpen(false);
                    onShowVersions();
                  }}>
                    Versions
                  </PillButton>
                ) : null}
                {!isLocalSandboxUi && onShowBulk ? (
                  <PillButton tone="neutral" size="sm" onClick={() => {
                    setStatusOpen(false);
                    onShowBulk();
                  }}>
                    Data
                  </PillButton>
                ) : null}
              </div>
              {!isLocalSandboxUi && !remoteActionsAvailable ? (
                <div className="dg-status-popover-note">
                  Versions, processes and batch jobs belong to the legacy remote editor and are disabled in the local sandbox.
                </div>
              ) : null}
            </div>

          </div>
        </div>,
        document.body,
      )}

      {shortcutsOpen && ReactDOM.createPortal(
        <div className="dg-modal-backdrop dg-shortcuts-backdrop" onMouseDown={() => setShortcutsOpen(false)}>
          <div
            className={`dg-modal-panel dg-shortcuts-modal${isCompactLocal ? " dg-shortcuts-modal-mobile" : ""}`}
            onMouseDown={(event) => event.stopPropagation()}
            style={shortcutsSheetDrag.sheetStyle}
          >
            {isCompactLocal ? (
              <div className="dg-mobile-sheet-shell" {...shortcutsSheetDrag.dragHandleProps}>
                <div className="dg-mobile-sheet-grabber shortcuts" aria-hidden="true" />
              </div>
            ) : null}
            <div className="dg-shortcuts-modal-header">
              <div>
                <div className="dg-rules-popover-title">Editor shortcuts</div>
                <div className="dg-shortcuts-modal-note">Shortcuts used to be scattered across the interface. They are now collected here and also open with `?`.</div>
              </div>
              <button
                type="button"
                className="dg-shortcuts-close"
                onClick={() => setShortcutsOpen(false)}
                aria-label="Close shortcuts"
              >
                <PinselaIcon name="X" size={16} />
              </button>
            </div>

            <div className="dg-shortcuts-grid">
              {SHORTCUT_GROUPS.map((group) => (
                <section key={group.title} className="dg-shortcuts-section">
                  <div className="dg-status-popover-section-title">{group.title}</div>
                  <div className="dg-shortcuts-list">
                    {group.items.map((item) => (
                      <div key={`${group.title}-${item.label}`} className="dg-shortcuts-row">
                        <div className="dg-shortcuts-keys">
                          {item.keys.map((key) => <kbd key={`${item.label}-${key}`}>{key}</kbd>)}
                        </div>
                        <span>{item.label}</span>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
});
