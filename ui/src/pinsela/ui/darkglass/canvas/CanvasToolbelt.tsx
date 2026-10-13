import React from "react";
import ReactDOM from "react-dom";
import { PinselaIcon } from "../PinselaIcon";

export type NavigationToolId = "select" | "node" | "hand";
export type InsertToolId = "rect" | "line" | "arrow" | "ellipse" | "polygon" | "star" | "media" | "frame" | "auto_layout";
export type DrawToolId = "pen" | "pencil" | "brush";
export type CanvasToolId = NavigationToolId | InsertToolId | DrawToolId | "text";
export type ToolbeltBooleanOperationId = "union" | "subtract" | "intersect" | "divide" | "exclude" | "slice";

type ToolGroupKey = "nav" | "insert" | "draw";

type ToolOption<T extends CanvasToolId> = {
  id: T;
  label: string;
  icon: React.ComponentProps<typeof PinselaIcon>["name"];
  shortcut?: string;
};

const NAV_TOOLS: Array<ToolOption<NavigationToolId>> = [
  { id: "select", label: "Select / Move", icon: "MousePointer2" },
  { id: "node", label: "Points / Edit path", icon: "Spline" },
  { id: "hand", label: "Hand / Pan", icon: "Hand" },
];

const INSERT_TOOLS: Array<ToolOption<InsertToolId>> = [
  { id: "rect", label: "Rectangle", icon: "Square", shortcut: "R" },
  { id: "line", label: "Line", icon: "Minus", shortcut: "L" },
  { id: "arrow", label: "Arrow", icon: "ArrowRight" },
  { id: "ellipse", label: "Ellipse", icon: "Circle", shortcut: "C" },
  { id: "polygon", label: "Polygon", icon: "Pentagon" },
  { id: "star", label: "Star", icon: "Star" },
  { id: "frame", label: "Frame", icon: "Frame", shortcut: "F" },
  { id: "auto_layout", label: "Auto Layout", icon: "LayoutTemplate", shortcut: "A" },
  { id: "media", label: "Image / Video", icon: "ImagePlus", shortcut: "I" },
];

const DRAW_TOOLS: Array<ToolOption<DrawToolId>> = [
  { id: "pen", label: "Pen", icon: "PenTool" },
  { id: "pencil", label: "Pencil", icon: "Pencil" },
  { id: "brush", label: "Brush", icon: "Paintbrush" },
];

export interface CanvasToolbeltProps {
  uiVariant?: "default" | "local_sandbox";
  compactViewport?: boolean;
  activeTool: CanvasToolId;
  lastNavigationTool: NavigationToolId;
  lastInsertTool: InsertToolId;
  lastDrawTool: DrawToolId;
  canUndo?: boolean;
  canRedo?: boolean;
  saveState?: "saved" | "saving" | "offline" | "expired";
  pagesGridOpen?: boolean;
  selectionCount?: number;
  onSelectTool: (tool: CanvasToolId) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onTogglePagesGrid?: () => void;
  onShowExport?: () => void;
  onBooleanOperation?: (operation: ToolbeltBooleanOperationId) => void;
  /* Project identity (rendered on the left of the bottom toolbar).
     Moved here from the now-hidden Topbar in local-sandbox desktop. */
  projectName?: string;
  pageLabel?: string;
  canvasLabel?: string;
}

function iconForTool(tool: CanvasToolId): React.ComponentProps<typeof PinselaIcon>["name"] {
  const map: Record<CanvasToolId, React.ComponentProps<typeof PinselaIcon>["name"]> = {
    select: "MousePointer2",
    node: "Spline",
    hand: "Hand",
    rect: "Square",
    line: "Minus",
    arrow: "ArrowRight",
    ellipse: "Circle",
    polygon: "Pentagon",
    star: "Star",
    media: "ImagePlus",
    frame: "Frame",
    auto_layout: "LayoutTemplate",
    pen: "PenTool",
    pencil: "Pencil",
    brush: "Paintbrush",
    text: "Type",
  };
  return map[tool];
}

function isNavigationTool(tool: CanvasToolId): tool is NavigationToolId {
  return tool === "select" || tool === "node" || tool === "hand";
}

function isInsertTool(tool: CanvasToolId): tool is InsertToolId {
  return tool === "rect"
    || tool === "line"
    || tool === "arrow"
    || tool === "ellipse"
    || tool === "polygon"
    || tool === "star"
    || tool === "media"
    || tool === "frame"
    || tool === "auto_layout";
}

function isDrawTool(tool: CanvasToolId): tool is DrawToolId {
  return tool === "pen" || tool === "pencil" || tool === "brush";
}

export function CanvasToolbelt({
  uiVariant = "default",
  compactViewport = false,
  activeTool,
  lastNavigationTool,
  lastInsertTool,
  lastDrawTool,
  canUndo,
  canRedo,
  saveState = "saved",
  pagesGridOpen,
  selectionCount = 0,
  onSelectTool,
  onUndo,
  onRedo,
  onTogglePagesGrid,
  onShowExport,
  onBooleanOperation,
  projectName,
  pageLabel,
  canvasLabel,
}: CanvasToolbeltProps) {
  const isLocalSandboxUi = uiVariant === "local_sandbox";
  const shouldDockIntoCenter = isLocalSandboxUi && !compactViewport;
  const showLabeledButtons = isLocalSandboxUi && !compactViewport;
  const [openGroup, setOpenGroup] = React.useState<ToolGroupKey | null>(null);
  const [booleanMenuOpen, setBooleanMenuOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const [portalHost, setPortalHost] = React.useState<HTMLElement | null>(null);

  React.useEffect(() => {
    if (!openGroup && !booleanMenuOpen) return;
    const onPointerDownCapture = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (rootRef.current?.contains(target)) return;
      setOpenGroup(null);
      setBooleanMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDownCapture, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDownCapture, true);
    };
  }, [openGroup, booleanMenuOpen]);

  React.useEffect(() => {
    if (typeof document === "undefined") return;
    const trayOpen = compactViewport && !!openGroup;
    document.body.classList.toggle("pinsela-mobile-toolbelt-tray-open", trayOpen);
    return () => {
      document.body.classList.remove("pinsela-mobile-toolbelt-tray-open");
    };
  }, [compactViewport, openGroup]);

  React.useEffect(() => {
    if (!shouldDockIntoCenter || typeof document === "undefined") {
      setPortalHost(null);
      return;
    }
    const nextHost = document.querySelector(".dg-local-editor .dg-app-center");
    setPortalHost(nextHost instanceof HTMLElement ? nextHost : null);
  }, [shouldDockIntoCenter]);

  const toolMeta = React.useMemo<Record<CanvasToolId, { label: string; hint: string }>>(() => ({
    select: { label: "Select", hint: "Move and edit" },
    node: { label: "Points", hint: "Edit path" },
    hand: { label: "Hand", hint: "Pan" },
    rect: { label: "Rectangle", hint: "Basic block" },
    line: { label: "Line", hint: "Straight stroke" },
    arrow: { label: "Arrow", hint: "Direction" },
    ellipse: { label: "Ellipse", hint: "Curved shape" },
    polygon: { label: "Polygon", hint: "Multiple sides" },
    star: { label: "Star", hint: "Highlight" },
    media: { label: "Media", hint: "Image and video" },
    frame: { label: "Frame", hint: "Container" },
    auto_layout: { label: "Layout", hint: "Automatic flow" },
    pen: { label: "Pen", hint: "Vector" },
    pencil: { label: "Pencil", hint: "Sketch" },
    brush: { label: "Brush", hint: "Painting" },
    text: { label: "Text", hint: "Typography" },
  }), []);

  const renderPrimaryToolButton = (tool: CanvasToolId, selected: boolean, onClick: () => void) => {
    const meta = toolMeta[tool];
    return (
      <button
        type="button"
        className={`dg-toolbelt-btn ${selected ? "selected" : ""}${showLabeledButtons ? " dg-toolbelt-btn-labeled" : ""}`}
        title={meta.label}
        onClick={onClick}
      >
        <PinselaIcon name={iconForTool(tool)} />
        {showLabeledButtons ? (
          <span className="dg-toolbelt-btn-copy">
            <span className="dg-toolbelt-btn-label">{meta.label}</span>
            <span className="dg-toolbelt-btn-hint">{meta.hint}</span>
          </span>
        ) : null}
      </button>
    );
  };

  const openGroupOptions = openGroup === "nav"
    ? NAV_TOOLS
    : openGroup === "insert"
      ? INSERT_TOOLS
      : openGroup === "draw"
        ? DRAW_TOOLS
        : [];

  const handleCompactGroupPress = React.useCallback((group: ToolGroupKey, primaryTool: CanvasToolId) => {
    const groupIsActive = group === "nav"
      ? isNavigationTool(activeTool)
      : group === "insert"
        ? isInsertTool(activeTool)
        : isDrawTool(activeTool);
    if (groupIsActive) {
      setOpenGroup((prev) => (prev === group ? null : group));
      return;
    }
    onSelectTool(primaryTool);
    setOpenGroup(null);
  }, [activeTool, onSelectTool]);

  if (compactViewport) {
    return (
      <div ref={rootRef} className={`dg-bottom-toolbelt is-mobile${openGroup ? " has-open-tray" : ""}`}>
        {openGroup ? (
          <div className="dg-toolbelt-mobile-tray" role="dialog" aria-label="Canvas tools">
            <div className="dg-toolbelt-mobile-tray-head">
              <span className="dg-toolbelt-mobile-tray-kicker">
                {openGroup === "nav" ? "Navigation" : openGroup === "insert" ? "Insert" : "Draw"}
              </span>
              <button
                type="button"
                className="dg-toolbelt-mobile-tray-close"
                onClick={() => setOpenGroup(null)}
                aria-label="Close tool group"
              >
                <PinselaIcon name="X" size={14} />
              </button>
            </div>
            <div className={`dg-toolbelt-mobile-tray-grid group-${openGroup}`}>
              {openGroupOptions.map((tool) => (
                <button
                  key={tool.id}
                  type="button"
                  className={`dg-toolbelt-mobile-tray-item ${activeTool === tool.id ? "active" : ""}`}
                  onClick={() => {
                    onSelectTool(tool.id);
                    setOpenGroup(null);
                  }}
                >
                  <span className="dg-toolbelt-mobile-tray-item-icon">
                    <PinselaIcon name={tool.icon} size={16} />
                  </span>
                  <span className="dg-toolbelt-mobile-tray-item-label">{tool.label}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="dg-bottom-toolbelt-inner">
          <button
            type="button"
            className={`dg-toolbelt-mobile-primary ${isNavigationTool(activeTool) ? "selected" : ""}${openGroup === "nav" ? " open" : ""}`}
            onClick={() => handleCompactGroupPress("nav", lastNavigationTool)}
            title={toolMeta[lastNavigationTool].label}
          >
            <span className="dg-toolbelt-mobile-primary-icon"><PinselaIcon name={iconForTool(lastNavigationTool)} size={17} /></span>
            <span className="dg-toolbelt-mobile-primary-copy">
              <span className="dg-toolbelt-mobile-primary-label">Navigate</span>
              <span className="dg-toolbelt-mobile-primary-hint">{toolMeta[lastNavigationTool].label}</span>
            </span>
          </button>

          <button
            type="button"
            className={`dg-toolbelt-mobile-primary ${isInsertTool(activeTool) ? "selected" : ""}${openGroup === "insert" ? " open" : ""}`}
            onClick={() => handleCompactGroupPress("insert", lastInsertTool)}
            title={toolMeta[lastInsertTool].label}
          >
            <span className="dg-toolbelt-mobile-primary-icon"><PinselaIcon name={iconForTool(lastInsertTool)} size={17} /></span>
            <span className="dg-toolbelt-mobile-primary-copy">
              <span className="dg-toolbelt-mobile-primary-label">Insert</span>
              <span className="dg-toolbelt-mobile-primary-hint">{toolMeta[lastInsertTool].label}</span>
            </span>
          </button>

          <button
            type="button"
            className={`dg-toolbelt-mobile-primary ${activeTool === "text" ? "selected" : ""}`}
            onClick={() => {
              onSelectTool("text");
              setOpenGroup(null);
            }}
            title="Text"
          >
            <span className="dg-toolbelt-mobile-primary-icon"><PinselaIcon name="Type" size={17} /></span>
            <span className="dg-toolbelt-mobile-primary-copy">
              <span className="dg-toolbelt-mobile-primary-label">Text</span>
              <span className="dg-toolbelt-mobile-primary-hint">Typography</span>
            </span>
          </button>

          <button
            type="button"
            className={`dg-toolbelt-mobile-primary ${isDrawTool(activeTool) ? "selected" : ""}${openGroup === "draw" ? " open" : ""}`}
            onClick={() => handleCompactGroupPress("draw", lastDrawTool)}
            title={toolMeta[lastDrawTool].label}
          >
            <span className="dg-toolbelt-mobile-primary-icon"><PinselaIcon name={iconForTool(lastDrawTool)} size={17} /></span>
            <span className="dg-toolbelt-mobile-primary-copy">
              <span className="dg-toolbelt-mobile-primary-label">Draw</span>
              <span className="dg-toolbelt-mobile-primary-hint">{toolMeta[lastDrawTool].label}</span>
            </span>
          </button>
        </div>
      </div>
    );
  }

  const identitySegment = isLocalSandboxUi && !compactViewport && projectName ? (
    <div className="dg-toolbelt-identity" title={projectName}>
      <span className="dg-toolbelt-identity-name">{projectName}</span>
      <span className="dg-toolbelt-identity-meta">
        {pageLabel ? <span>{pageLabel}</span> : null}
        {pageLabel && canvasLabel ? <span className="dg-toolbelt-identity-dot" aria-hidden="true" /> : null}
        {canvasLabel ? <span>{canvasLabel}</span> : null}
      </span>
    </div>
  ) : null;

  const desktopToolbelt = (
    <div ref={rootRef} className="dg-bottom-toolbelt">
      <div className="dg-bottom-toolbelt-inner">
        {identitySegment}
        <div className="dg-toolbelt-main-stack">
          <div className="dg-toolbelt-left-stack">
            <div className={`dg-toolbelt-group ${isNavigationTool(activeTool) ? "active" : ""}`}>
              {renderPrimaryToolButton(lastNavigationTool, activeTool === lastNavigationTool, () => onSelectTool(lastNavigationTool))}
              <button
                type="button"
                className={`dg-toolbelt-btn dg-toolbelt-caret ${openGroup === "nav" ? "open" : ""}`}
                title="Navigation tools"
                onClick={() => setOpenGroup((prev) => (prev === "nav" ? null : "nav"))}
              >
                <PinselaIcon name="ChevronDown" />
              </button>
              {openGroup === "nav" && (
                <div className="dg-toolbelt-menu">
                  {NAV_TOOLS.map((tool) => (
                    <button
                      key={tool.id}
                      type="button"
                      className={`dg-toolbelt-menu-item ${activeTool === tool.id ? "active" : ""}`}
                      onClick={() => {
                        onSelectTool(tool.id);
                        setOpenGroup(null);
                      }}
                    >
                      <span className="dg-toolbelt-menu-main">
                        <PinselaIcon name={tool.icon} />
                        <span>{tool.label}</span>
                      </span>
                      {tool.shortcut && <kbd>{tool.shortcut}</kbd>}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className={`dg-toolbelt-group ${isInsertTool(activeTool) ? "active" : ""}`}>
              {renderPrimaryToolButton(lastInsertTool, activeTool === lastInsertTool, () => onSelectTool(lastInsertTool))}
              <button
                type="button"
                className={`dg-toolbelt-btn dg-toolbelt-caret ${openGroup === "insert" ? "open" : ""}`}
                title="Insert elements"
                onClick={() => setOpenGroup((prev) => (prev === "insert" ? null : "insert"))}
              >
                <PinselaIcon name="ChevronDown" />
              </button>
              {openGroup === "insert" && (
                <div className="dg-toolbelt-menu">
                  {INSERT_TOOLS.map((tool) => (
                    <button
                      key={tool.id}
                      type="button"
                      className={`dg-toolbelt-menu-item ${activeTool === tool.id ? "active" : ""}`}
                      onClick={() => {
                        onSelectTool(tool.id);
                        setOpenGroup(null);
                      }}
                    >
                      <span className="dg-toolbelt-menu-main">
                        <PinselaIcon name={tool.icon} />
                        <span>{tool.label}</span>
                      </span>
                      {tool.shortcut && <kbd>{tool.shortcut}</kbd>}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className={`dg-toolbelt-group ${isDrawTool(activeTool) ? "active" : ""}`}>
              {renderPrimaryToolButton(lastDrawTool, activeTool === lastDrawTool, () => onSelectTool(lastDrawTool))}
              <button
                type="button"
                className={`dg-toolbelt-btn dg-toolbelt-caret ${openGroup === "draw" ? "open" : ""}`}
                title="Drawing tools"
                onClick={() => setOpenGroup((prev) => (prev === "draw" ? null : "draw"))}
              >
                <PinselaIcon name="ChevronDown" />
              </button>
              {openGroup === "draw" && (
                <div className="dg-toolbelt-menu">
                  {DRAW_TOOLS.map((tool) => (
                    <button
                      key={tool.id}
                      type="button"
                      className={`dg-toolbelt-menu-item ${activeTool === tool.id ? "active" : ""}`}
                      onClick={() => {
                        onSelectTool(tool.id);
                        setOpenGroup(null);
                      }}
                    >
                      <span className="dg-toolbelt-menu-main">
                        <PinselaIcon name={tool.icon} />
                        <span>{tool.label}</span>
                      </span>
                      {tool.shortcut && <kbd>{tool.shortcut}</kbd>}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              type="button"
              className={`dg-toolbelt-btn ${activeTool === "text" ? "selected" : ""}${showLabeledButtons ? " dg-toolbelt-btn-labeled" : ""}`}
              title="Text"
              onClick={() => onSelectTool("text")}
            >
              <PinselaIcon name="Type" />
              {showLabeledButtons ? (
                <span className="dg-toolbelt-btn-copy">
                  <span className="dg-toolbelt-btn-label">Text</span>
                  <span className="dg-toolbelt-btn-hint">Typography</span>
                </span>
              ) : null}
              <kbd>T</kbd>
            </button>

            <div className="dg-toolbelt-group dg-toolbelt-boolean-group">
              <button
                type="button"
                className={`dg-toolbelt-btn dg-toolbelt-caret ${booleanMenuOpen ? "open" : ""}`}
                title="Boolean operations"
                onClick={() => setBooleanMenuOpen((current) => !current)}
              >
                <PinselaIcon name="SquaresUnite" />
                {showLabeledButtons ? <span className="dg-toolbelt-btn-label">Boolean</span> : null}
                <PinselaIcon name="ChevronDown" size={13} />
              </button>
              {booleanMenuOpen && (
                <div className="dg-toolbelt-menu dg-toolbelt-boolean-menu">
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
                      className="dg-toolbelt-menu-item"
                      disabled={selectionCount !== 2}
                      onClick={() => {
                        onBooleanOperation?.(operation.id);
                        setBooleanMenuOpen(false);
                      }}
                    >
                      <span className="dg-toolbelt-menu-main">
                        <PinselaIcon name={operation.icon} />
                        <span>{operation.label}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Undo/Redo live in the top EditorHeader on desktop and in the
              compact .dg-topbar on small screens; only mirror them here when
              NEITHER is present (compact layout without the dg-topbar shouldn't
              happen, but keep a safety net behind compactViewport). */}
          {compactViewport ? (
            <div className="dg-toolbelt-center-stack">
              <button type="button" className="dg-toolbelt-btn" onClick={onUndo} disabled={!canUndo} title="Undo">
                <PinselaIcon name="Undo2" />
              </button>
              <button type="button" className="dg-toolbelt-btn" onClick={onRedo} disabled={!canRedo} title="Redo">
                <PinselaIcon name="Redo2" />
              </button>
            </div>
          ) : null}
        </div>

        {/* Bottom toolbelt is creation-tools-first. Save status / Undo·Redo /
            Export now live in the top header (no duplication). Keep only the
            Pages toggle here (it has no top-header equivalent). */}
        <div className="dg-toolbelt-right-stack">
          <button type="button" className={`dg-toolbelt-btn ${pagesGridOpen ? "selected" : ""}`} onClick={onTogglePagesGrid} title="Pages" disabled={!onTogglePagesGrid}>
            <PinselaIcon name="LayoutGrid" />
          </button>
        </div>
      </div>
    </div>
  );

  if (shouldDockIntoCenter && portalHost) {
    return ReactDOM.createPortal(desktopToolbelt, portalHost);
  }

  return desktopToolbelt;
}
