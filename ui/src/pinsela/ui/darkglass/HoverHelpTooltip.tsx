import React from "react";
import ReactDOM from "react-dom";

export interface HoverHelpTooltipOptions {
  label?: string;
  description?: string;
  delayMs?: number;
  disabled?: boolean;
}

function defaultDescription(label: string): string {
  const key = label.trim().toLowerCase();
  if (key.includes("undo")) return "Undoes the last change made in the editor.";
  if (key.includes("redo")) return "Reapplies the last undone change.";
  if (key.includes("snap") || key.includes("guides")) return "Turns guide snapping on or off when moving and resizing.";
  if (key.includes("grid")) return "Turns grid snapping on or off for precise alignment.";
  if (key.includes("zoom in")) return "Zooms in on the canvas.";
  if (key.includes("zoom out")) return "Zooms out on the canvas.";
  if (key.includes("export")) return "Opens the export options.";
  if (key.includes("versions")) return "Opens version history and restore options.";
  if (key.includes("template")) return "Opens the templates panel.";
  if (key.includes("insert")) return "Opens the tools for inserting elements on the canvas.";
  if (key.includes("text")) return "Opens text presets, fonts, and text tools.";
  if (key.includes("media") || key.includes("assets")) return "Opens the image and media library.";
  if (key.includes("stroke")) return "Opens the stroke controls for the selected layer.";
  if (key.includes("layers")) return "Opens the layer list and selection actions.";
  if (key.includes("history")) return "Opens history and version actions.";
  return "Runs this action in the editor.";
}

export function useHoverHelpTooltip({ label, description, delayMs = 600, disabled = false }: HoverHelpTooltipOptions) {
  const [open, setOpen] = React.useState(false);
  const [rect, setRect] = React.useState<DOMRect | null>(null);
  const timerRef = React.useRef<number | null>(null);

  const clearTimer = React.useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const hide = React.useCallback(() => {
    clearTimer();
    setOpen(false);
  }, [clearTimer]);

  React.useEffect(() => () => clearTimer(), [clearTimer]);

  const schedule = React.useCallback((target: HTMLElement) => {
    if (disabled || !label) return;
    clearTimer();
    setRect(target.getBoundingClientRect());
    timerRef.current = window.setTimeout(() => {
      setRect(target.getBoundingClientRect());
      setOpen(true);
    }, delayMs);
  }, [clearTimer, delayMs, disabled, label]);

  const bind = React.useMemo(() => ({
    onMouseEnter: (event: React.MouseEvent<HTMLElement>) => schedule(event.currentTarget),
    onMouseMove: (event: React.MouseEvent<HTMLElement>) => {
      if (open) setRect(event.currentTarget.getBoundingClientRect());
    },
    onMouseLeave: () => hide(),
    onFocus: (event: React.FocusEvent<HTMLElement>) => schedule(event.currentTarget as HTMLElement),
    onBlur: () => hide(),
    onMouseDown: () => hide(),
  }), [hide, open, schedule]);

  const tooltip = (!open || !label || typeof document === "undefined" || !rect)
    ? null
    : ReactDOM.createPortal(
      <div
        className="dg-help-tooltip"
        style={{
          position: "fixed",
          top: Math.max(8, Math.round(rect.bottom + 10)),
          left: Math.round(Math.max(8, Math.min(window.innerWidth - 280, rect.left + rect.width / 2 - 130))),
          zIndex: 2600,
        }}
        role="tooltip"
      >
        <div className="dg-help-tooltip-title">{label}</div>
        <div className="dg-help-tooltip-copy">{description || defaultDescription(label)}</div>
      </div>,
      document.body,
    );

  return { bind, tooltip, hide };
}
