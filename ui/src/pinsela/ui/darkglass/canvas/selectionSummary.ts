import type { PinselaTemplateDocV1, PinselaNode } from "../../../core/types";

export type SelectionKind =
  | "none"
  | "single_shape"
  | "single_frame"
  | "single_text"
  | "single_image"
  | "single_group"
  | "single_component_instance"
  | "single_component_source"
  | "multi_homogeneous_shape"
  | "multi_homogeneous_text"
  | "multi_homogeneous_image"
  | "multi_mixed";

export type SelectionShapeType =
  | "rect"
  | "ellipse"
  | "polygon"
  | "star"
  | "path"
  | "line";

export interface SelectionSummary {
  kind: SelectionKind;
  count: number;
  isMixed: boolean;
  primaryType?: PinselaNode["kind"];
  shapeType?: SelectionShapeType;
  selectedIds: string[];
}

function kindCategory(node: PinselaNode): "shape" | "text" | "image" | "component_instance" {
  if (node.component_instance) return "component_instance";
  if (node.kind === "text") return "text";
  if (node.kind === "image") return "image";
  return "shape";
}

function isComponentSource(doc: PinselaTemplateDocV1, nodeId: string): boolean {
  const defs = doc.metadata?.components?.definitions || [];
  for (const def of defs) {
    const sources = Array.isArray(def?.source_node_ids) ? def.source_node_ids : [];
    if (sources.includes(nodeId)) return true;
  }
  return false;
}

function resolveSelectionShapeType(node: PinselaNode): SelectionShapeType | undefined {
  if (node.kind === "line") return "line";
  if (node.kind !== "rect" && node.kind !== "path") return undefined;
  const raw = String((node.style as Record<string, unknown> | undefined)?.shape_type || "").toLowerCase();
  if (raw === "ellipse" || raw === "polygon" || raw === "star" || raw === "rect") return raw;
  return node.kind === "rect" ? "rect" : "path";
}

function resolveSelectedNodes(doc: PinselaTemplateDocV1, ids: string[]): PinselaNode[] {
  if (ids.length === 1) {
    const node = doc.nodes.find((entry) => entry.id === ids[0]);
    return node ? [node] : [];
  }
  const pending = new Set(ids);
  const found = new Map<string, PinselaNode>();
  for (const node of doc.nodes) {
    if (!pending.has(node.id)) continue;
    found.set(node.id, node);
    pending.delete(node.id);
    if (!pending.size) break;
  }
  return ids.map((id) => found.get(id)).filter(Boolean) as PinselaNode[];
}

export function computeSelectionSummary(doc: PinselaTemplateDocV1, selectedIds: string[]): SelectionSummary {
  const ids = [...selectedIds];
  if (!ids.length) {
    return { kind: "none", count: 0, isMixed: false, selectedIds: [] };
  }

  const nodes = resolveSelectedNodes(doc, ids);
  if (!nodes.length) {
    return { kind: "none", count: 0, isMixed: false, selectedIds: [] };
  }

  if (nodes.length === 1) {
    const node = nodes[0];
    if (node.component_instance) {
      return {
        kind: "single_component_instance",
        count: 1,
        isMixed: false,
        primaryType: node.kind,
        selectedIds: ids,
      };
    }
    if (isComponentSource(doc, node.id)) {
      return {
        kind: "single_component_source",
        count: 1,
        isMixed: false,
        primaryType: node.kind,
        selectedIds: ids,
      };
    }
    if (node.kind === "text") {
      return { kind: "single_text", count: 1, isMixed: false, primaryType: "text", selectedIds: ids };
    }
    if (node.kind === "image") {
      return { kind: "single_image", count: 1, isMixed: false, primaryType: "image", selectedIds: ids };
    }
    if (node.kind === "group") {
      return { kind: "single_group", count: 1, isMixed: false, primaryType: "group", selectedIds: ids };
    }
    if (node.kind === "frame") {
      return { kind: "single_frame", count: 1, isMixed: false, primaryType: "frame", selectedIds: ids };
    }
    return {
      kind: "single_shape",
      count: 1,
      isMixed: false,
      primaryType: node.kind,
      shapeType: resolveSelectionShapeType(node),
      selectedIds: ids,
    };
  }

  const categories = new Set(nodes.map(kindCategory));
  if (categories.size !== 1 || categories.has("component_instance")) {
    return {
      kind: "multi_mixed",
      count: nodes.length,
      isMixed: true,
      primaryType: nodes[0]?.kind,
      selectedIds: ids,
    };
  }

  const only = Array.from(categories)[0];
  if (only === "text") {
    return {
      kind: "multi_homogeneous_text",
      count: nodes.length,
      isMixed: false,
      primaryType: "text",
      selectedIds: ids,
    };
  }
  if (only === "image") {
    return {
      kind: "multi_homogeneous_image",
      count: nodes.length,
      isMixed: false,
      primaryType: "image",
      selectedIds: ids,
    };
  }
  const shapeTypes = new Set(
    nodes
      .map((node) => resolveSelectionShapeType(node))
      .filter(Boolean) as SelectionShapeType[],
  );
  return {
    kind: "multi_homogeneous_shape",
    count: nodes.length,
    isMixed: false,
    primaryType: nodes[0]?.kind,
    shapeType: shapeTypes.size === 1 ? Array.from(shapeTypes)[0] : undefined,
    selectedIds: ids,
  };
}
