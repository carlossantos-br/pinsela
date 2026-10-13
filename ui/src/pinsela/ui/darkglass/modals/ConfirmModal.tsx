import React from "react";
import { ModalFrame } from "./ModalFrame";
import { PillButton } from "../index";

export interface ConfirmModalProps {
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Marks the action as destructive (confirm button turns red). */
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/** In-app replacement for window.confirm. */
export function ConfirmModal({
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  busy = false,
  onConfirm,
  onClose,
}: ConfirmModalProps) {
  return (
    <ModalFrame
      title={title}
      onClose={onClose}
      width={460}
      footer={(
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
          <PillButton tone="neutral" onClick={onClose} disabled={busy}>{cancelLabel}</PillButton>
          <PillButton
            tone="primary"
            onClick={onConfirm}
            disabled={busy}
            data-testid="confirm-modal-confirm"
            style={danger ? { background: "#dc2626", borderColor: "#dc2626", color: "#fff" } : undefined}
          >
            {confirmLabel}
          </PillButton>
        </div>
      )}
    >
      <p style={{ margin: 0, lineHeight: 1.5, fontSize: 14 }}>{message}</p>
    </ModalFrame>
  );
}
