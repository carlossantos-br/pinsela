import React from "react";
import { PinselaIcon } from "../PinselaIcon";
import { PinselaLogo } from "../PinselaLogo";

export interface EditorHeaderProps {
  theme?: "obsidian" | "sand" | "teal_ink";
  homeHref?: string;
  projectName?: string;
  templateKey?: string;
  saveState?: "saved" | "saving" | "offline" | "expired";
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  zoomPercent?: number;
  onZoomToPercent?: (percent: number) => void;
  onZoomFit?: () => void;
  rulersEnabled?: boolean;
  onToggleRulers?: () => void;
  onShowExport?: () => void;
}

const ZOOM_MIN = 10;
const ZOOM_MAX = 500;

function clampZoom(value: number): number {
  if (!Number.isFinite(value)) return 100;
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(value)));
}

export function EditorHeader({
  theme = "sand",
  homeHref = "/projects",
  projectName = "Untitled",
  templateKey,
  saveState = "saved",
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
  zoomPercent = 100,
  onZoomToPercent,
  onZoomFit,
  rulersEnabled = false,
  onToggleRulers,
  onShowExport,
}: EditorHeaderProps) {
  const [zoomDraft, setZoomDraft] = React.useState<string | null>(null);

  const commitZoomDraft = React.useCallback(() => {
    if (zoomDraft == null) return;
    const parsed = Number(zoomDraft.replace(/[^0-9.,-]/g, "").replace(",", "."));
    setZoomDraft(null);
    if (Number.isFinite(parsed) && parsed > 0) onZoomToPercent?.(clampZoom(parsed));
  }, [onZoomToPercent, zoomDraft]);

  const saveLabel = saveState === "saving" ? "Saving…" : saveState === "offline" ? "Offline" : saveState === "expired" ? "Session expired" : "Saved";

  return (
    <header
      className="ec-editor-header"
      data-ec-theme={theme === "sand" ? "light" : undefined}
    >
      <div className="ec-eh-side ec-eh-left">
        {/* Back-to-projects lives in the LeftRail (single source); the old header
            arrow here was a duplicate. */}
        <PinselaLogo size={22} className="ec-eh-brand" />
        <span className="ec-eh-divider" aria-hidden="true" />
        <span className="ec-eh-project" title={templateKey ? `${projectName} — ${templateKey}` : projectName}>
          {projectName}
        </span>
        <span className={`ec-eh-save is-${saveState === "expired" ? "offline" : saveState}`} role="status">
          {saveState === "saved" ? <PinselaIcon name="Check" size={11} /> : null}
          {saveLabel}
        </span>
      </div>

      <div className="ec-eh-side ec-eh-right">
        <div className="ec-eh-group" role="group" aria-label="History">
          <button
            type="button"
            className="ec-eh-btn"
            title="Undo (Cmd+Z)"
            aria-label="Undo"
            disabled={!canUndo}
            onClick={onUndo}
          >
            <PinselaIcon name="Undo2" size={15} />
          </button>
          <button
            type="button"
            className="ec-eh-btn"
            title="Redo (Cmd+Shift+Z)"
            aria-label="Redo"
            disabled={!canRedo}
            onClick={onRedo}
          >
            <PinselaIcon name="Redo2" size={15} />
          </button>
        </div>

        <span className="ec-eh-divider" aria-hidden="true" />

        <div className="ec-eh-group" role="group" aria-label="Zoom">
          <button
            type="button"
            className="ec-eh-btn"
            title="Zoom out"
            aria-label="Zoom out"
            disabled={!onZoomToPercent}
            onClick={() => onZoomToPercent?.(clampZoom(zoomPercent - 10))}
          >
            <PinselaIcon name="Minus" size={14} />
          </button>
          <input
            className="ec-eh-zoom"
            value={zoomDraft ?? `${Math.round(zoomPercent)}%`}
            aria-label="Zoom level"
            disabled={!onZoomToPercent}
            onFocus={(event) => {
              setZoomDraft(String(Math.round(zoomPercent)));
              event.currentTarget.select();
            }}
            onChange={(event) => setZoomDraft(event.target.value)}
            onBlur={commitZoomDraft}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitZoomDraft();
                event.currentTarget.blur();
              } else if (event.key === "Escape") {
                setZoomDraft(null);
                event.currentTarget.blur();
              }
            }}
          />
          <button
            type="button"
            className="ec-eh-btn"
            title="Zoom in"
            aria-label="Zoom in"
            disabled={!onZoomToPercent}
            onClick={() => onZoomToPercent?.(clampZoom(zoomPercent + 10))}
          >
            <PinselaIcon name="Plus" size={14} />
          </button>
          <button
            type="button"
            className="ec-eh-btn ec-eh-fit"
            title="Fit to screen (Cmd+0)"
            disabled={!onZoomFit}
            onClick={onZoomFit}
          >
            Fit
          </button>
        </div>

        <span className="ec-eh-divider" aria-hidden="true" />

        <button
          type="button"
          className={`ec-eh-btn${rulersEnabled ? " is-active" : ""}`}
          title={rulersEnabled ? "Hide rulers" : "Show rulers"}
          aria-label="Rulers"
          aria-pressed={rulersEnabled}
          disabled={!onToggleRulers}
          onClick={onToggleRulers}
        >
          <PinselaIcon name="Ruler" size={15} />
        </button>

        <span className="ec-eh-divider" aria-hidden="true" />

        <button
          type="button"
          className="ec-eh-export"
          disabled={!onShowExport}
          onClick={onShowExport}
        >
          <PinselaIcon name="Download" size={14} />
          Export
        </button>
      </div>
    </header>
  );
}
