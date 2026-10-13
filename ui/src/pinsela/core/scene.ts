import type { PinselaNode, PinselaTemplateDocV1 } from "./types";

export function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function defaultNodeGeometry(partial?: Partial<PinselaNode["geometry"]>): PinselaNode["geometry"] {
  return {
    x: 80,
    y: 80,
    width: 280,
    height: 120,
    rotation: 0,
    corner_radius: 0,
    clip: false,
    z_index: 0,
    ...(partial || {}),
  };
}

export function defaultNode(kind: PinselaNode["kind"], partial?: Partial<PinselaNode>): PinselaNode {
  const geometrySeed =
    kind === "line"
      ? { width: 560, height: 0 }
      : kind === "path"
        ? { width: 320, height: 220 }
      : kind === "frame"
        ? { width: 320, height: 320, corner_radius: 18, clip: true }
        : undefined;
  return {
    id: uid(kind),
    parent_id: null,
    children_ids: [],
    name: kind.toUpperCase(),
    kind,
    geometry: defaultNodeGeometry(geometrySeed),
    layout: {
      direction: "none",
      gap: 0,
      padding_top: 0,
      padding_right: 0,
      padding_bottom: 0,
      padding_left: 0,
      align_main: "start",
      align_cross: "start",
      sizing_mode: "fixed",
      wrap: false,
      wrap_mode: "flow",
      grid_columns: 0,
      grid_rows: 0,
    },
    constraints: {
      x: "min",
      y: "min",
      width: "fixed",
      height: "fixed",
    },
    style: {
      visible: true,
      locked: false,
      opacity: 1,
      blend_mode: "normal",
      fill: kind === "line"
        ? "#8B6D52"
        : kind === "path"
          ? "rgba(0,0,0,0)"
          : kind === "group"
            ? null
            : kind === "frame"
              ? "rgba(0,0,0,0)"
              : "#D8C0A8",
      strokes: null,
      stroke:
        kind === "line"
          ? { color: "#F8FAFC", width: 4, dash: [], cap: "round" }
          : kind === "path"
            ? { color: "#0f172a", width: 2, dash: [], cap: "round" }
            : null,
      effects: [],
      image_fit: "fill",
      image_crop: null,
      image_duotone: null,
      image_brush_settings: null,
      image_brush_strokes: null,
      mask: false,
    },
    text: kind === "text" ? "New text" : null,
    text_model: kind === "text" ? "rich" : undefined,
    text_style:
      kind === "text"
        ? {
            family: "Inter",
            style: "Regular",
            postscript: "Inter-Regular",
            size: 42,
            line_height: 110,
            line_height_unit: "percent",
            letter_spacing: 0,
            text_align: "left",
            vertical_align: "top",
            color: "#111111",
          }
        : undefined,
    text_runs: [],
    text_path: null,
    fit: null,
    path_data: null,
    image_src: null,
    editable: false,
    component_instance: null,
    ...(partial || {}),
  };
}

export function createEmptyDoc(width = 1080, height = 1080): PinselaTemplateDocV1 {
  const root = defaultNode("frame", {
    id: "root",
    name: "ROOT",
    geometry: {
      x: 0,
      y: 0,
      width,
      height,
      rotation: 0,
      corner_radius: 0,
      clip: false,
      z_index: 0,
    },
    style: {
      visible: true,
      locked: false,
      opacity: 1,
      blend_mode: "normal",
      fill: "#F2ECE4",
      strokes: null,
      stroke: null,
      effects: [],
      image_fit: "fill",
      image_crop: null,
      image_duotone: null,
      image_brush_settings: null,
      image_brush_strokes: null,
      mask: false,
    },
  });
  return {
    version: 1,
    template_kind: "",
    canvas: { width, height, background: "#F2ECE4" },
    root_id: root.id,
    nodes: [root],
    bindings: { text: {}, images_single: {}, images_array: {}, product_frames: null },
    dynamic_rules: [],
    metadata: { source: "pinsela-pinsela", components: { definitions: [] } },
  };
}

export function nodeMap(doc: PinselaTemplateDocV1): Map<string, PinselaNode> {
  const m = new Map<string, PinselaNode>();
  for (const n of doc.nodes || []) m.set(n.id, n);
  return m;
}

export function sortedNodes(doc: PinselaTemplateDocV1): PinselaNode[] {
  return [...(doc.nodes || [])].sort((a, b) => (a.geometry?.z_index || 0) - (b.geometry?.z_index || 0));
}

export function updateNode(doc: PinselaTemplateDocV1, nodeId: string, patch: Partial<PinselaNode>): PinselaTemplateDocV1 {
  const next = {
    ...doc,
    nodes: (doc.nodes || []).map((n) => (n.id === nodeId ? { ...n, ...patch } : n)),
  };
  return next;
}

export function patchNodeGeometry(doc: PinselaTemplateDocV1, nodeId: string, patch: Partial<PinselaNode["geometry"]>): PinselaTemplateDocV1 {
  return {
    ...doc,
    nodes: (doc.nodes || []).map((n) => (n.id === nodeId ? { ...n, geometry: { ...(n.geometry || defaultNodeGeometry()), ...(patch || {}) } } : n)),
  };
}

export function patchNodeStyle(doc: PinselaTemplateDocV1, nodeId: string, patch: Partial<PinselaNode["style"]>): PinselaTemplateDocV1 {
  return {
    ...doc,
    nodes: (doc.nodes || []).map((n) => (n.id === nodeId ? { ...n, style: { ...(n.style || {}), ...(patch || {}) } } : n)),
  };
}

export function addNode(doc: PinselaTemplateDocV1, node: PinselaNode): PinselaTemplateDocV1 {
  const z = Math.max(0, ...doc.nodes.map((n) => n.geometry?.z_index || 0)) + 1;
  const fixed = { ...node, geometry: { ...(node.geometry || defaultNodeGeometry()), z_index: z } };
  return { ...doc, nodes: [...doc.nodes, fixed] };
}

export function removeNodes(doc: PinselaTemplateDocV1, ids: string[]): PinselaTemplateDocV1 {
  if (!ids.length) return doc;
  const dead = new Set(ids);
  let nodes = doc.nodes.filter((n) => !dead.has(n.id));
  const alive = new Set(nodes.map((n) => n.id));
  const bindings = {
    text: Object.fromEntries(Object.entries(doc.bindings.text || {}).filter(([, b]) => !dead.has(String((b as any)?.node_id || "")))),
    images_single: Object.fromEntries(Object.entries(doc.bindings.images_single || {}).filter(([, b]) => !dead.has(String((b as any)?.node_id || "")))),
    images_array: Object.fromEntries(
      Object.entries(doc.bindings.images_array || {}).map(([k, b]) => [k, { ...(b || {}), node_ids: ((b as any)?.node_ids || []).filter((x: string) => !dead.has(String(x))) }]).filter(([, b]) => ((b as any).node_ids || []).length > 0)
    ),
    product_frames:
      doc.bindings.product_frames && Array.isArray(doc.bindings.product_frames.node_ids)
        ? { ...doc.bindings.product_frames, node_ids: doc.bindings.product_frames.node_ids.filter((x) => !dead.has(String(x))) }
        : null,
  };
  const baseMeta = doc.metadata && typeof doc.metadata === "object" ? { ...doc.metadata } : {};
  const rawDefs =
    baseMeta.components && Array.isArray(baseMeta.components.definitions)
      ? baseMeta.components.definitions
      : [];
  const definitions = rawDefs
    .map((def) => {
      const source_node_ids = Array.isArray(def?.source_node_ids)
        ? def.source_node_ids.map((x: string) => String(x)).filter((x: string) => alive.has(x))
        : [];
      return { ...(def || {}), source_node_ids };
    })
    .filter((def) => def.source_node_ids.length > 0);
  const definitionIds = new Set(definitions.map((def) => String(def.id || "")));
  nodes = nodes.map((n) => {
    const inst = n.component_instance;
    if (!inst) return n;
    if (!alive.has(String(inst.source_node_id || ""))) return { ...n, component_instance: null };
    if (!definitionIds.has(String(inst.component_id || ""))) return { ...n, component_instance: null };
    return n;
  });
  const metadata = {
    ...baseMeta,
    components: {
      ...(baseMeta.components || {}),
      definitions,
    },
  };
  return { ...doc, nodes, bindings, metadata };
}

export function moveSelection(doc: PinselaTemplateDocV1, ids: string[], dx: number, dy: number): PinselaTemplateDocV1 {
  if (!ids.length) return doc;
  const selected = new Set(expandSelectionWithDescendants(doc, ids));
  return {
    ...doc,
    nodes: doc.nodes.map((n) =>
      selected.has(n.id)
        ? {
            ...n,
            geometry: {
              ...(n.geometry || defaultNodeGeometry()),
              x: (n.geometry?.x || 0) + dx,
              y: (n.geometry?.y || 0) + dy,
            },
          }
        : n
    ),
  };
}

export function expandSelectionWithDescendants(
  doc: PinselaTemplateDocV1,
  ids: string[],
): string[] {
  if (!ids.length) return [];
  const byId = new Map(doc.nodes.map((node) => [node.id, node] as const));
  const childrenByParent = new Map<string, Set<string>>();
  for (const node of doc.nodes) {
    const parentId = String(node.parent_id || "").trim();
    if (!parentId) continue;
    const bucket = childrenByParent.get(parentId) || new Set<string>();
    bucket.add(node.id);
    childrenByParent.set(parentId, bucket);
  }

  const orderedOut: string[] = [];
  const seen = new Set<string>();
  const queue = ids
    .map((id) => String(id || "").trim())
    .filter(Boolean);

  while (queue.length) {
    const id = String(queue.shift() || "").trim();
    if (!id || seen.has(id)) continue;
    if (!byId.has(id)) continue;
    seen.add(id);
    orderedOut.push(id);

    const node = byId.get(id)!;
    const nested = new Set<string>();
    for (const childId of Array.isArray(node.children_ids) ? node.children_ids : []) {
      const normalized = String(childId || "").trim();
      if (normalized) nested.add(normalized);
    }
    for (const childId of (childrenByParent.get(id) || new Set<string>())) {
      nested.add(childId);
    }
    for (const childId of nested) {
      if (!seen.has(childId)) queue.push(childId);
    }
  }
  return orderedOut;
}

export function resizeNode(doc: PinselaTemplateDocV1, id: string, w: number, h: number): PinselaTemplateDocV1 {
  return patchNodeGeometry(doc, id, { width: Math.max(4, w), height: Math.max(4, h) });
}

export function rotateNode(doc: PinselaTemplateDocV1, id: string, deg: number): PinselaTemplateDocV1 {
  return patchNodeGeometry(doc, id, { rotation: deg });
}

export function reorderNode(doc: PinselaTemplateDocV1, id: string, direction: "up" | "down" | "front" | "back"): PinselaTemplateDocV1 {
  const nodes = sortedNodes(doc);
  const idx = nodes.findIndex((n) => n.id === id);
  if (idx < 0) return doc;
  let next = [...nodes];
  if (direction === "up" && idx < next.length - 1) {
    [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
  } else if (direction === "down" && idx > 0) {
    [next[idx], next[idx - 1]] = [next[idx - 1], next[idx]];
  } else if (direction === "front") {
    const [n] = next.splice(idx, 1);
    next.push(n);
  } else if (direction === "back") {
    const [n] = next.splice(idx, 1);
    next.unshift(n);
  }
  next = next.map((n, i) => ({ ...n, geometry: { ...n.geometry, z_index: i } }));
  return { ...doc, nodes: next };
}

export function aabbWithRotation(node: PinselaNode): { x: number; y: number; w: number; h: number } {
  const g = node.geometry || defaultNodeGeometry();
  const x = g.x || 0;
  const y = g.y || 0;
  const w = Math.max(0, g.width || 0);
  const h = Math.max(0, g.height || 0);
  const rot = (g.rotation || 0) * (Math.PI / 180);
  if (!rot) return { x, y, w, h };

  const cx = x + w / 2;
  const cy = y + h / 2;
  const pts = [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ].map(([px, py]) => {
    const rx = px * Math.cos(rot) - py * Math.sin(rot);
    const ry = px * Math.sin(rot) + py * Math.cos(rot);
    return { x: cx + rx, y: cy + ry };
  });
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

export function hitTest(doc: PinselaTemplateDocV1, px: number, py: number): PinselaNode | null {
  const nodes = sortedNodes(doc).filter((n) => n.id !== doc.root_id && n.style?.visible !== false && !n.style?.locked);
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    const n = nodes[i];
    const box = aabbWithRotation(n);
    if (px >= box.x && px <= box.x + box.w && py >= box.y && py <= box.y + box.h) {
      return n;
    }
  }
  return null;
}
