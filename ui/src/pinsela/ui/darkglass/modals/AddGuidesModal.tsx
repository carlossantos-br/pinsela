import React from "react";
import { ModalFrame } from "./ModalFrame";
import { PillButton } from "../index";

export interface AddGuidesValues {
  columns: number;
  columnGap: number;
  columnMargin: number;
  rows: number;
  rowGap: number;
  rowMargin: number;
}

const DEFAULT_VALUES: AddGuidesValues = {
  columns: 12,
  columnGap: 24,
  columnMargin: 48,
  rows: 0,
  rowGap: 24,
  rowMargin: 48,
};

function toNonNegativeInt(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.round(value));
}

function normalizeValues(values?: Partial<AddGuidesValues>): AddGuidesValues {
  return {
    columns: toNonNegativeInt(Number(values?.columns), DEFAULT_VALUES.columns),
    columnGap: toNonNegativeInt(Number(values?.columnGap), DEFAULT_VALUES.columnGap),
    columnMargin: toNonNegativeInt(Number(values?.columnMargin), DEFAULT_VALUES.columnMargin),
    rows: toNonNegativeInt(Number(values?.rows), DEFAULT_VALUES.rows),
    rowGap: toNonNegativeInt(Number(values?.rowGap), DEFAULT_VALUES.rowGap),
    rowMargin: toNonNegativeInt(Number(values?.rowMargin), DEFAULT_VALUES.rowMargin),
  };
}

export interface AddGuidesModalProps {
  onClose: () => void;
  onSubmit: (values: AddGuidesValues) => void;
  initialValues?: Partial<AddGuidesValues>;
}

export function AddGuidesModal({ onClose, onSubmit, initialValues }: AddGuidesModalProps) {
  const [values, setValues] = React.useState<AddGuidesValues>(() => normalizeValues(initialValues));

  React.useEffect(() => {
    setValues(normalizeValues(initialValues));
  }, [
    initialValues?.columns,
    initialValues?.columnGap,
    initialValues?.columnMargin,
    initialValues?.rows,
    initialValues?.rowGap,
    initialValues?.rowMargin,
  ]);

  const patchValue = React.useCallback((key: keyof AddGuidesValues, nextRaw: string) => {
    setValues((prev) => ({
      ...prev,
      [key]: toNonNegativeInt(Number(nextRaw), prev[key]),
    }));
  }, []);

  const submit = React.useCallback(() => {
    onSubmit(normalizeValues(values));
  }, [onSubmit, values]);

  return (
    <ModalFrame
      title="Add guides"
      onClose={onClose}
      width={620}
      footer={(
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
          <PillButton tone="neutral" onClick={onClose}>Cancel</PillButton>
          <PillButton tone="primary" onClick={submit}>Add guides</PillButton>
        </div>
      )}
    >
      <div className="dg-wizard-form dg-add-guides-modal">
        <div className="dg-wizard-section">
          <h3>Custom</h3>
          <div className="dg-add-guides-mode">Custom</div>
          <div className="dg-panel-inline-hint">
            Creates vertical and horizontal guides on the active page.
          </div>
        </div>

        <div className="dg-wizard-section">
          <h3>Columns</h3>
          <div className="dg-add-guides-grid">
            <label className="dg-add-guides-field">
              <span>Columns</span>
              <input
                type="number"
                min={0}
                value={values.columns}
                onChange={(event) => patchValue("columns", event.target.value)}
              />
            </label>
            <label className="dg-add-guides-field">
              <span>Gap (px)</span>
              <input
                type="number"
                min={0}
                value={values.columnGap}
                onChange={(event) => patchValue("columnGap", event.target.value)}
              />
            </label>
            <label className="dg-add-guides-field">
              <span>Margin (px)</span>
              <input
                type="number"
                min={0}
                value={values.columnMargin}
                onChange={(event) => patchValue("columnMargin", event.target.value)}
              />
            </label>
          </div>
        </div>

        <div className="dg-wizard-section">
          <h3>Rows</h3>
          <div className="dg-add-guides-grid">
            <label className="dg-add-guides-field">
              <span>Rows</span>
              <input
                type="number"
                min={0}
                value={values.rows}
                onChange={(event) => patchValue("rows", event.target.value)}
              />
            </label>
            <label className="dg-add-guides-field">
              <span>Gap (px)</span>
              <input
                type="number"
                min={0}
                value={values.rowGap}
                onChange={(event) => patchValue("rowGap", event.target.value)}
              />
            </label>
            <label className="dg-add-guides-field">
              <span>Margin (px)</span>
              <input
                type="number"
                min={0}
                value={values.rowMargin}
                onChange={(event) => patchValue("rowMargin", event.target.value)}
              />
            </label>
          </div>
        </div>
      </div>
    </ModalFrame>
  );
}
