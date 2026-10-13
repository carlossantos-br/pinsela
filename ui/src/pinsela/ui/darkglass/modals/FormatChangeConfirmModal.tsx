import React from "react";
import { ModalFrame } from "./ModalFrame";
import { PillButton, PinselaIcon } from "../index";

export interface FormatChangeConfirmModalProps {
  onClose: () => void;
  onConfirm: () => void;
}

export function FormatChangeConfirmModal({ onClose, onConfirm }: FormatChangeConfirmModalProps) {
  return (
    <ModalFrame
      title="Create new design"
      onClose={onClose}
      width={560}
      footer={(
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
          <PillButton tone="neutral" onClick={onClose}>Back to editor</PillButton>
          <PillButton tone="primary" onClick={onConfirm}>Choose format</PillButton>
        </div>
      )}
    >
      <div className="dg-format-change-modal">
        <div className="dg-format-change-warning">
          <div className="dg-format-change-warning-head">
            <PinselaIcon name="TriangleAlert" size={16} />
            <strong>Unsaved changes</strong>
          </div>
          <p>Your current document has changes you may want to keep.</p>
        </div>

        <div className="dg-format-change-copy">
          <p>When you choose a format for the new design:</p>
          <ul>
            <li>the current editor will be replaced with a blank canvas;</li>
            <li>changes to the current file can't be recovered here.</li>
          </ul>
        </div>

        <div className="dg-empty-state-title">
          To keep this design, go back to the editor and export or finish your work before creating another.
        </div>
      </div>
    </ModalFrame>
  );
}
