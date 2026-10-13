import React from "react";
import { PinselaIcon, IconButton, PillButton } from "../index";
import type { PinselaNode, PinselaTemplateDocV1 } from "../../../core/types";
import { ConfirmModal } from "../modals/ConfirmModal";
import { CANVAS_PRESETS, type CanvasFormat } from "./FormatPicker";

export type ProjectPageView = {
  id: string;
  name: string;
  doc: PinselaTemplateDocV1;
};

export interface ProjectPagesGridProps {
  open: boolean;
  pages: ProjectPageView[];
  activePageId: string | null;
  onClose: () => void;
  onSelectPage: (pageId: string) => void;
  onRenamePage: (pageId: string, nextName: string) => void;
  onDuplicatePage: (pageId: string) => void;
  onDeletePage: (pageId: string) => void;
  /** Reorders the page in the project (also the export order). */
  onMovePage?: (pageId: string, delta: -1 | 1) => void;
  onCreateBlankPage: (format?: CanvasFormat) => void;
  initialPageFormat?: CanvasFormat | null;
}

type PageCardProps = {
  page: ProjectPageView;
  active: boolean;
  canDelete: boolean;
  onSelect: (pageId: string) => void;
  onRename: (pageId: string, nextName: string) => void;
  onDuplicate: (pageId: string) => void;
  onDelete: (pageId: string) => void;
  index: number;
  total: number;
  onMove?: (pageId: string, delta: -1 | 1) => void;
};

function previewColor(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim()) return value;
  if (!value || typeof value !== "object") return fallback;
  const entry = value as Record<string, unknown>;
  const stops = Array.isArray(entry.stops) ? entry.stops : [];
  for (const stop of stops) {
    if (!stop || typeof stop !== "object") continue;
    const color = (stop as Record<string, unknown>).color;
    if (typeof color === "string" && color.trim()) return color;
  }
  return fallback;
}

function normalizePageName(name: string, index: number): string {
  // Older projects stored the Portuguese "Pagina N" / "Página N"; display it as "Page N".
  const trimmed = String(name || "").trim().replace(/^P[aá]gina(?= \d+$)/, "Page");
  return trimmed || `Page ${index + 1}`;
}

function resolvePreviewNodes(doc: PinselaTemplateDocV1): PinselaNode[] {
  const rootId = String(doc.root_id || "").trim();
  return [...doc.nodes]
    .filter((node) => node.id !== rootId)
    .sort((a, b) => Number(a.geometry?.z_index || 0) - Number(b.geometry?.z_index || 0))
    .slice(0, 48);
}

function PageMiniPreview({ doc }: { doc: PinselaTemplateDocV1 }) {
  const canvasWidth = Math.max(1, Number(doc.canvas?.width || 1));
  const canvasHeight = Math.max(1, Number(doc.canvas?.height || 1));
  const previewWidth = 198;
  const previewHeight = 124;
  const safePadding = 8;
  const scale = Math.min(
    (previewWidth - safePadding * 2) / canvasWidth,
    (previewHeight - safePadding * 2) / canvasHeight,
  );
  const contentWidth = canvasWidth * scale;
  const contentHeight = canvasHeight * scale;
  const offsetX = Math.max(safePadding, Math.round((previewWidth - contentWidth) / 2));
  const offsetY = Math.max(safePadding, Math.round((previewHeight - contentHeight) / 2));
  const nodes = resolvePreviewNodes(doc);

  return (
    <div className="dg-page-grid-preview" style={{ background: previewColor(doc.canvas?.background, "#f2ece4") }}>
      {nodes.map((node) => {
        const width = Math.max(1, Number(node.geometry?.width || 0) * scale);
        const height = Math.max(1, Number(node.geometry?.height || 0) * scale);
        const x = offsetX + Number(node.geometry?.x || 0) * scale;
        const y = offsetY + Number(node.geometry?.y || 0) * scale;
        const rotation = Number(node.geometry?.rotation || 0);
        const opacity = Math.max(0.2, Math.min(1, Number(node.style?.opacity ?? 1)));
        const radius = Math.max(0, Number(node.geometry?.corner_radius || 0) * scale);

        if (node.kind === "text") {
          return (
            <div
              key={node.id}
              className="dg-page-grid-node dg-page-grid-node-text"
              style={{
                left: x,
                top: y,
                width,
                height: Math.max(4, Math.min(height, 14)),
                opacity,
                transform: `rotate(${rotation}deg)`,
              }}
            />
          );
        }

        if (node.kind === "line") {
          return (
            <div
              key={node.id}
              className="dg-page-grid-node dg-page-grid-node-line"
              style={{
                left: x,
                top: y,
                width: Math.max(8, width),
                height: Math.max(2, height || 2),
                opacity,
                transform: `rotate(${rotation}deg)`,
                background: previewColor(node.style?.stroke, "#0f172a"),
              }}
            />
          );
        }

        return (
          <div
            key={node.id}
            className="dg-page-grid-node"
            style={{
              left: x,
              top: y,
              width,
              height,
              opacity,
              borderRadius: radius,
              transform: `rotate(${rotation}deg)`,
              background: previewColor(node.style?.fill, "#d8c0a8"),
            }}
          />
        );
      })}
    </div>
  );
}

function PageCard({ page, active, canDelete, onSelect, onRename, onDuplicate, onDelete, index, total, onMove }: PageCardProps) {
  const [draftName, setDraftName] = React.useState(page.name);
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  React.useEffect(() => {
    setDraftName(page.name);
  }, [page.id, page.name]);

  function commitName() {
    const nextName = String(draftName || "").trim();
    if (!nextName || nextName === page.name) {
      setDraftName(page.name);
      return;
    }
    onRename(page.id, nextName);
  }

  return (
    <div className={`dg-page-grid-card ${active ? "is-active" : ""}`}>
      <button
        type="button"
        className="dg-page-grid-preview-btn"
        onClick={() => onSelect(page.id)}
        title={`Open ${page.name}`}
      >
        <PageMiniPreview doc={page.doc} />
      </button>
      <div className="dg-page-grid-meta">
        <input
          type="text"
          className="dg-input dg-page-grid-name-input"
          value={draftName}
          onChange={(event) => setDraftName(event.target.value)}
          onBlur={commitName}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              (event.currentTarget as HTMLInputElement).blur();
            }
          }}
          aria-label="Page name"
        />
        <div className="dg-page-grid-meta-row">
          <span className="dg-page-grid-node-count">{Math.max(0, page.doc.nodes.length - 1)} layers</span>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            {active && <span className="dg-page-grid-active-tag">Active</span>}
            {onMove ? (
              <>
                <IconButton
                  size="sm"
                  icon={<PinselaIcon name="ChevronUp" size={14} />}
                  title="Move page up (export order)"
                  aria-label="Move page up"
                  disabled={index <= 0}
                  onClick={() => onMove(page.id, -1)}
                />
                <IconButton
                  size="sm"
                  icon={<PinselaIcon name="ChevronDown" size={14} />}
                  title="Move page down (export order)"
                  aria-label="Move page down"
                  disabled={index >= total - 1}
                  onClick={() => onMove(page.id, 1)}
                />
              </>
            ) : null}
            <IconButton
              size="sm"
              icon={<PinselaIcon name="Copy" size={14} />}
              title="Duplicate page"
              aria-label="Duplicate page"
              onClick={() => onDuplicate(page.id)}
            />
            <IconButton
              size="sm"
              danger
              icon={<PinselaIcon name="Trash2" size={14} />}
              title={canDelete ? "Delete page" : "The last page can't be deleted"}
              aria-label="Delete page"
              disabled={!canDelete}
              onClick={() => {
                if (!canDelete) return;
                setConfirmDelete(true);
              }}
            />
          </div>
        </div>
      </div>
      {confirmDelete ? (
        <ConfirmModal
          title="Delete page"
          message={`Delete "${page.name}"? This can't be undone.`}
          confirmLabel="Delete"
          danger
          onClose={() => setConfirmDelete(false)}
          onConfirm={() => {
            setConfirmDelete(false);
            onDelete(page.id);
          }}
        />
      ) : null}
    </div>
  );
}

export function ProjectPagesGrid({
  open,
  pages,
  activePageId,
  onClose,
  onSelectPage,
  onRenamePage,
  onDuplicatePage,
  onDeletePage,
  onMovePage,
  onCreateBlankPage,
  initialPageFormat,
}: ProjectPagesGridProps) {
  if (!open) return null;

  const [newPageFormatId, setNewPageFormatId] = React.useState<string>(() => {
    const formatId = String(initialPageFormat?.id || "").trim();
    if (!formatId) return "current";
    if (formatId === "custom") return "custom";
    return CANVAS_PRESETS.some((preset) => preset.id === formatId) ? formatId : "current";
  });
  const [customWidth, setCustomWidth] = React.useState<string>(() => String(
    Math.max(1, Math.round(Number(initialPageFormat?.width || 1080))),
  ));
  const [customHeight, setCustomHeight] = React.useState<string>(() => String(
    Math.max(1, Math.round(Number(initialPageFormat?.height || 1080))),
  ));

  const selectablePresets = React.useMemo(
    () => CANVAS_PRESETS.filter((preset) => preset.id !== "custom"),
    [],
  );

  function resolveSelectedFormat(): CanvasFormat | undefined {
    if (newPageFormatId === "current") return undefined;
    if (newPageFormatId === "custom") {
      const width = Math.max(1, Math.round(Number(customWidth || initialPageFormat?.width || 1080)));
      const height = Math.max(1, Math.round(Number(customHeight || initialPageFormat?.height || 1080)));
      return {
        id: "custom",
        name: `Custom ${width}x${height}`,
        category: "Custom",
        width,
        height,
        icon: "Settings",
      };
    }
    return selectablePresets.find((preset) => preset.id === newPageFormatId);
  }

  return (
    <div
      className="dg-page-grid-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="dg-page-grid-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="dg-page-grid-header">
          <div>
            <h3 className="dg-page-grid-title">Project pages</h3>
            <p className="dg-page-grid-subtitle">All pages appear on the canvas; click a page to edit it.</p>
          </div>
          <div className="dg-page-grid-header-actions">
            <select
              className="dg-input"
              value={newPageFormatId}
              onChange={(event) => setNewPageFormatId(event.target.value)}
              aria-label="New page format"
              style={{ width: 220, minWidth: 220 }}
            >
              <option value="current">Current format</option>
              {selectablePresets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name} ({preset.width}x{preset.height})
                </option>
              ))}
              <option value="custom">Custom</option>
            </select>
            {newPageFormatId === "custom" && (
              <>
                <input
                  type="number"
                  className="dg-input"
                  min={1}
                  value={customWidth}
                  onChange={(event) => setCustomWidth(event.target.value)}
                  aria-label="Custom width"
                  style={{ width: 88 }}
                />
                <input
                  type="number"
                  className="dg-input"
                  min={1}
                  value={customHeight}
                  onChange={(event) => setCustomHeight(event.target.value)}
                  aria-label="Custom height"
                  style={{ width: 88 }}
                />
              </>
            )}
            <PillButton tone="secondary" size="sm" onClick={() => onCreateBlankPage(resolveSelectedFormat())}>
              <PinselaIcon name="Plus" size={14} style={{ marginRight: 6 }} />
              New page
            </PillButton>
            <IconButton
              size="sm"
              icon={<PinselaIcon name="X" size={14} />}
              onClick={onClose}
              title="Close page grid"
            />
          </div>
        </div>

        <div className="dg-page-grid-list">
          {pages.map((page, index) => (
            <PageCard
              key={page.id}
              page={{ ...page, name: normalizePageName(page.name, index) }}
              active={page.id === activePageId}
              canDelete={pages.length > 1}
              onSelect={onSelectPage}
              onRename={onRenamePage}
              onDuplicate={onDuplicatePage}
              onDelete={onDeletePage}
              index={index}
              total={pages.length}
              onMove={onMovePage}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
