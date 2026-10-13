import React from "react";

export type ToastTone = "info" | "warning" | "error";

export interface ToastItem {
  id: string;
  tone: ToastTone;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  /** Auto-dismiss after this many ms (omit for sticky toasts). */
  durationMs?: number;
}

const TONE_COLORS: Record<ToastTone, string> = {
  info: "#2563eb",
  warning: "#d97706",
  error: "#dc2626",
};

/** Small in-app toast stack (bottom center). State lives in useToasts(). */
export function ToastStack({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: string) => void }) {
  if (!toasts.length) return null;
  return (
    <div
      aria-live="polite"
      style={{
        position: "fixed",
        left: "50%",
        bottom: 88,
        transform: "translateX(-50%)",
        display: "grid",
        gap: 8,
        zIndex: 400,
        width: "min(520px, calc(100vw - 32px))",
      }}
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role={toast.tone === "error" ? "alert" : "status"}
          data-toast-tone={toast.tone}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "10px 12px 10px 14px",
            borderRadius: 12,
            border: "1px solid #e5e5e5",
            borderLeft: `3px solid ${TONE_COLORS[toast.tone]}`,
            background: "#ffffff",
            color: "#171717",
            fontSize: 13,
            lineHeight: 1.4,
            boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
          }}
        >
          <span style={{ flex: 1, minWidth: 0 }}>{toast.message}</span>
          {toast.actionLabel && toast.onAction ? (
            <button
              type="button"
              className="dg-pill-btn dg-pill-btn-primary dg-pill-btn-sm"
              onClick={() => {
                toast.onAction?.();
                onDismiss(toast.id);
              }}
            >
              {toast.actionLabel}
            </button>
          ) : null}
          <button
            type="button"
            aria-label="Dismiss notification"
            onClick={() => onDismiss(toast.id)}
            style={{ background: "transparent", border: "none", color: "#737373", cursor: "pointer", fontSize: 16, lineHeight: 1 }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

/** Toast state. Pushing a toast with an existing id replaces it (no stacking of repeats). */
export function useToasts() {
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);
  const timers = React.useRef(new Map<string, number>());

  const dismiss = React.useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer != null) window.clearTimeout(timer);
    timers.current.delete(id);
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const push = React.useCallback((toast: ToastItem) => {
    setToasts((current) => [...current.filter((t) => t.id !== toast.id), toast]);
    const prev = timers.current.get(toast.id);
    if (prev != null) window.clearTimeout(prev);
    if (toast.durationMs) {
      timers.current.set(toast.id, window.setTimeout(() => dismiss(toast.id), toast.durationMs));
    }
  }, [dismiss]);

  React.useEffect(() => () => {
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current.clear();
  }, []);

  return { toasts, push, dismiss };
}
