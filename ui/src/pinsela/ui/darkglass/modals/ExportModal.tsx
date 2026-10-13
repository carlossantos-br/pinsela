import React from "react";
import { ModalFrame } from "./ModalFrame";
import { PillButton } from "../index";
import { selectPagesInProjectOrder } from "../../../core/projectPages";

export interface ExportModalPage {
  id: string;
  name: string;
}

export interface ExportModalConfig {
  format: "png" | "jpg" | "webp" | "pdf";
  scale: number;
  withoutBackground: boolean;
  /**
   * IDs of the project pages to export. Empty array means "the current page"
   * (single-page projects, or callers that don't pass `pages`).
   */
  pageIds: string[];
}

export interface ExportModalProps {
  onClose: () => void;
  onExport: (config: ExportModalConfig, action: "download" | "save_as") => Promise<void> | void;
  /** All pages of the current project (omit/empty for a single-page export). */
  pages?: ExportModalPage[];
  /** The page currently open on the canvas, pre-selected by default. */
  activePageId?: string | null;
}

export function ExportModal({ onClose, onExport, pages, activePageId }: ExportModalProps) {
  const [format, setFormat] = React.useState<"png" | "jpg" | "webp" | "pdf">("png");
  const [scale, setScale] = React.useState<number>(1);
  const [withoutBackground, setWithoutBackground] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const pageList = React.useMemo(() => (Array.isArray(pages) ? pages.filter((p) => p && p.id) : []), [pages]);
  const isMultiPage = pageList.length > 1;
  // Default: export every page (the common "download all" case).
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set(pageList.map((p) => p.id)));
  // Keep selection valid if the page list changes while the modal is open.
  React.useEffect(() => {
    setSelected((prev) => {
      const valid = new Set(pageList.map((p) => p.id));
      const next = new Set<string>();
      prev.forEach((id) => { if (valid.has(id)) next.add(id); });
      return next.size ? next : new Set(pageList.map((p) => p.id));
    });
  }, [pageList]);

  const selectedCount = isMultiPage ? selected.size : 1;
  const allSelected = isMultiPage && selectedCount === pageList.length;
  const noneSelected = isMultiPage && selectedCount === 0;
  const selectAllRef = React.useRef<HTMLInputElement | null>(null);
  React.useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = !allSelected && !noneSelected;
  }, [allSelected, noneSelected]);

  const supportsNativeSaveDialog = typeof window !== "undefined"
    && typeof (window as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker === "function";
  const supportsTransparentBackground = format === "png" || format === "webp";
  // The native "Save as…" dialog prompts once per file — only offer it for a
  // single file. Multi-file exports go straight to the browser downloads folder.
  const offerSaveAs = supportsNativeSaveDialog && selectedCount <= 1;

  React.useEffect(() => {
    if (!supportsTransparentBackground && withoutBackground) setWithoutBackground(false);
  }, [supportsTransparentBackground, withoutBackground]);

  function togglePage(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected((prev) => (prev.size === pageList.length ? new Set() : new Set(pageList.map((p) => p.id))));
  }

  async function handleExport(action: "download" | "save_as") {
    if (busy || noneSelected) return;
    setBusy(true);
    setError(null);
    try {
      const pageIds = isMultiPage
        ? selectPagesInProjectOrder(pageList, selected).map((p) => p.id) // project (Pages panel) order
        : (activePageId ? [activePageId] : []);
      await onExport({
        format,
        scale,
        withoutBackground: supportsTransparentBackground ? withoutBackground : false,
        pageIds,
      }, action);
    } catch (e: any) {
      setError(String(e?.message || e || "").trim() || "Export failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const downloadLabel = busy
    ? "Processing…"
    : isMultiPage
      ? `Download ${selectedCount} ${selectedCount === 1 ? "page" : "pages"}`
      : "Download";

  return (
    <ModalFrame
      title="Export file"
      onClose={onClose}
      width={560}
      footer={(
        <div className="dg-export-footer">
          <PillButton tone="neutral" onClick={onClose} disabled={busy}>Cancel</PillButton>
          {offerSaveAs ? (
            <PillButton tone="secondary" onClick={() => void handleExport("save_as")} disabled={busy || noneSelected}>
              Save as…
            </PillButton>
          ) : null}
          <PillButton tone="primary" onClick={() => void handleExport("download")} disabled={busy || noneSelected}>
            {downloadLabel}
          </PillButton>
        </div>
      )}
    >
      <div className="dg-wizard-form">
        {error && (
          <div
            role="alert"
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid var(--color-bad-red)",
              color: "var(--color-bad-red)",
              background: "rgba(239, 68, 68, 0.08)",
              fontSize: 12,
              lineHeight: 1.4,
            }}
          >
            {error}
          </div>
        )}

        {isMultiPage && (
          <div className="dg-wizard-section">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <h3 style={{ margin: 0 }}>Pages</h3>
              <label className="dg-auto-layout-check" style={{ margin: 0, fontSize: 12 }}>
                <input ref={selectAllRef} type="checkbox" checked={allSelected} onChange={toggleAll} />
                <span>Select all</span>
              </label>
            </div>
            <div
              style={{
                marginTop: 10,
                maxHeight: 230,
                overflowY: "auto",
                border: "1px solid var(--color-border, rgba(0,0,0,0.12))",
                borderRadius: 10,
                padding: 6,
                display: "grid",
                gap: 2,
              }}
            >
              {pageList.map((p, i) => {
                const checked = selected.has(p.id);
                return (
                  <label
                    key={p.id}
                    className="dg-auto-layout-check"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "7px 8px",
                      borderRadius: 8,
                      cursor: "pointer",
                      background: checked ? "var(--color-surface-active, rgba(0,0,0,0.05))" : "transparent",
                    }}
                  >
                    <input type="checkbox" checked={checked} onChange={() => togglePage(p.id)} />
                    <span
                      style={{
                        flex: "0 0 auto",
                        minWidth: 22,
                        fontSize: 11,
                        opacity: 0.6,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span style={{ flex: 1, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {p.name || `Page ${i + 1}`}
                    </span>
                  </label>
                );
              })}
            </div>
            <div className="dg-empty-state-title" style={{ marginTop: 8 }}>
              {noneSelected
                ? "Select at least one page."
                : `${selectedCount} of ${pageList.length} selected${selectedCount === 1 ? "" : format === "pdf" ? " · all pages in a single PDF." : " · images are downloaded as a single ZIP file."}`}
            </div>
          </div>
        )}

        <div className="dg-wizard-section">
          <h3>Format</h3>
          <div className="dg-export-field">
            <span className="dg-export-label">File type</span>
            <div className="ec-seg ec-seg--compact" role="group" aria-label="File type">
              {(["png", "jpg", "webp", "pdf"] as const).map((f) => (
                <button key={f} type="button" className="ec-seg-btn" aria-pressed={format === f} onClick={() => setFormat(f)}>
                  {f.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <div className="dg-export-field">
            <span className="dg-export-label">Scale</span>
            <div className="ec-seg ec-seg--compact" role="group" aria-label="Scale">
              {[1, 2, 3, 4, 6].map((n) => (
                <button key={n} type="button" className="ec-seg-btn" aria-pressed={scale === n} onClick={() => setScale(n)}>
                  {n}x
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="dg-wizard-section">
          <h3>Background</h3>
          <label className="dg-auto-layout-check" style={{ marginTop: 4 }}>
            <input
              type="checkbox"
              checked={withoutBackground && supportsTransparentBackground}
              disabled={!supportsTransparentBackground}
              onChange={(event) => setWithoutBackground(event.target.checked)}
            />
            <span>Export without background</span>
          </label>
          <div className="dg-empty-state-title" style={{ marginTop: 8 }}>
            {supportsTransparentBackground
              ? "Removes the artboard color from the final file."
              : "Only available for PNG and WEBP."}
          </div>
          <div className="dg-empty-state-title" style={{ marginTop: 12 }}>
            {offerSaveAs
              ? "Download saves the file through your browser. Save as… opens the system file picker."
              : isMultiPage && selectedCount > 1
                ? (format === "pdf" ? "The PDF with all pages goes to your browser's Downloads folder." : "The ZIP file goes to your browser's Downloads folder.")
                : "The file will be downloaded by your browser."}
          </div>
        </div>
      </div>
    </ModalFrame>
  );
}
