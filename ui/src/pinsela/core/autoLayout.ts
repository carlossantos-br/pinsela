import type {
  PinselaDynamicRule,
  PinselaLayout,
  PinselaNode,
  PinselaTemplateDocV1,
} from "./types";

type LayoutDirection = Exclude<PinselaLayout["direction"], "none">;

const DEFAULT_LAYOUT: PinselaLayout = {
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
};

const AUTO_LAYOUT_CONTAINER_KINDS = new Set<PinselaNode["kind"]>(["group", "frame", "rect"]);

export type AutoLayoutContentLimitRule = PinselaDynamicRule & {
  type: "auto_layout_content_limit";
  container_id: string;
};

export type AutoLayoutContentLimitPatch = {
  enabled?: boolean;
  maxChars?: number | null;
  startFontSize?: number | null;
  minFontSize?: number | null;
  shrinkStep?: number | null;
  truncateMode?: "none" | "cut" | "ellipsis";
};

export type ReparentPlacement = "start" | "end" | "before" | "after";

export type ReparentToContainerOptions = {
  placement?: ReparentPlacement;
  referenceId?: string | null;
};

type LayoutItem = {
  id: string;
  main: number;
  cross: number;
};

type LayoutLine = {
  items: LayoutItem[];
  mainSize: number;
  crossSize: number;
};

function round2(value: number): number {
  return Math.round(Number(value || 0) * 100) / 100;
}

function clampPositive(value: number, fallback: number, min = 0): number {
  if (!Number.isFinite(value)) return fallback;
  if (value < min) return min;
  return value;
}

function normalizeLayout(layout?: Partial<PinselaLayout> | null): PinselaLayout {
  const wrapModeRaw = String(layout?.wrap_mode || DEFAULT_LAYOUT.wrap_mode).toLowerCase();
  const wrapMode = wrapModeRaw === "grid" ? "grid" : "flow";
  const gridColumns = Math.max(0, Math.round(Number(layout?.grid_columns || 0)));
  const gridRows = Math.max(0, Math.round(Number(layout?.grid_rows || 0)));
  return {
    ...DEFAULT_LAYOUT,
    ...(layout || {}),
    gap: clampPositive(Number(layout?.gap), 0, 0),
    padding_top: clampPositive(Number(layout?.padding_top), 0, 0),
    padding_right: clampPositive(Number(layout?.padding_right), 0, 0),
    padding_bottom: clampPositive(Number(layout?.padding_bottom), 0, 0),
    padding_left: clampPositive(Number(layout?.padding_left), 0, 0),
    align_main: (layout?.align_main || DEFAULT_LAYOUT.align_main) as PinselaLayout["align_main"],
    align_cross: (layout?.align_cross || DEFAULT_LAYOUT.align_cross) as PinselaLayout["align_cross"],
    sizing_mode: (layout?.sizing_mode || DEFAULT_LAYOUT.sizing_mode) as PinselaLayout["sizing_mode"],
    direction: (layout?.direction || DEFAULT_LAYOUT.direction) as PinselaLayout["direction"],
    wrap: Boolean(layout?.wrap),
    wrap_mode: wrapMode,
    grid_columns: gridColumns,
    grid_rows: gridRows,
  };
}

function isLayoutDirectionActive(layout?: Partial<PinselaLayout> | null): layout is PinselaLayout {
  return normalizeLayout(layout).direction !== "none";
}

export function canHostAutoLayout(node: PinselaNode | null | undefined): boolean {
  if (!node) return false;
  return AUTO_LAYOUT_CONTAINER_KINDS.has(node.kind);
}

export function isAutoLayoutContainerNode(node: PinselaNode | null | undefined): boolean {
  if (!node) return false;
  if (!canHostAutoLayout(node)) return false;
  return isLayoutDirectionActive(node.layout);
}

function isSameNumber(a: number, b: number): boolean {
  return Math.abs(a - b) <= 0.0001;
}

function sameStringArray(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

function nodeIndexMap(nodes: PinselaNode[]): Map<string, number> {
  const map = new Map<string, number>();
  nodes.forEach((node, index) => {
    map.set(node.id, index);
  });
  return map;
}

function normalizeParentMap(doc: PinselaTemplateDocV1): Map<string, string | null> {
  const nodeIds = new Set(doc.nodes.map((node) => node.id));
  const rawParentById = new Map<string, string | null>();
  for (const node of doc.nodes) {
    const rawParent = String(node.parent_id || "").trim();
    const parent = rawParent && nodeIds.has(rawParent) && rawParent !== node.id ? rawParent : null;
    rawParentById.set(node.id, parent);
  }

  const normalized = new Map<string, string | null>();
  for (const node of doc.nodes) {
    const nodeId = node.id;
    let candidate = rawParentById.get(nodeId) || null;
    if (!candidate) {
      normalized.set(nodeId, null);
      continue;
    }
    const seen = new Set<string>([nodeId]);
    let cursor: string | null = candidate;
    while (cursor) {
      if (seen.has(cursor)) {
        candidate = null;
        break;
      }
      seen.add(cursor);
      cursor = rawParentById.get(cursor) || null;
    }
    normalized.set(nodeId, candidate);
  }
  return normalized;
}

function buildChildrenMap(
  doc: PinselaTemplateDocV1,
  parentById: Map<string, string | null>,
): Map<string, string[]> {
  const byParent = new Map<string, string[]>();
  doc.nodes.forEach((node) => {
    byParent.set(node.id, []);
  });

  for (const node of doc.nodes) {
    const parentId = parentById.get(node.id) || null;
    if (!parentId) continue;
    const list = byParent.get(parentId);
    if (!list) continue;
    list.push(node.id);
  }

  const orderMap = nodeIndexMap(doc.nodes);
  const normalizedChildren = new Map<string, string[]>();
  for (const parentNode of doc.nodes) {
    const actual = byParent.get(parentNode.id) || [];
    const actualSet = new Set(actual);
    const ordered: string[] = [];
    const orderedSet = new Set<string>();

    for (const childId of parentNode.children_ids || []) {
      if (!actualSet.has(childId)) continue;
      if (orderedSet.has(childId)) continue;
      orderedSet.add(childId);
      ordered.push(childId);
    }

    const rest = [...actual].sort((a, b) => (orderMap.get(a) || 0) - (orderMap.get(b) || 0));
    for (const childId of rest) {
      if (orderedSet.has(childId)) continue;
      orderedSet.add(childId);
      ordered.push(childId);
    }

    normalizedChildren.set(parentNode.id, ordered);
  }
  return normalizedChildren;
}

export function normalizeDocHierarchy(doc: PinselaTemplateDocV1): PinselaTemplateDocV1 {
  if (!doc.nodes.length) return doc;
  const parentById = normalizeParentMap(doc);
  const childrenById = buildChildrenMap(doc, parentById);
  let changed = false;

  const nextNodes = doc.nodes.map((node) => {
    const nextParent = parentById.get(node.id) || null;
    const nextChildren = childrenById.get(node.id) || [];
    const parentChanged = (node.parent_id || null) !== nextParent;
    const childrenChanged = !sameStringArray(node.children_ids || [], nextChildren);
    if (!parentChanged && !childrenChanged) return node;
    changed = true;
    return {
      ...node,
      parent_id: nextParent,
      children_ids: nextChildren,
    };
  });

  if (!changed) return doc;
  return {
    ...doc,
    nodes: nextNodes,
  };
}

function isAncestor(
  descendantId: string,
  ancestorId: string,
  parentById: Map<string, string | null>,
): boolean {
  let cursor: string | null = parentById.get(descendantId) || null;
  const visited = new Set<string>();
  while (cursor) {
    if (cursor === ancestorId) return true;
    if (visited.has(cursor)) break;
    visited.add(cursor);
    cursor = parentById.get(cursor) || null;
  }
  return false;
}

function topLevelSelection(ids: string[], parentById: Map<string, string | null>): string[] {
  const selected = new Set(ids);
  return ids.filter((id) => {
    let cursor: string | null = parentById.get(id) || null;
    while (cursor) {
      if (selected.has(cursor)) return false;
      cursor = parentById.get(cursor) || null;
    }
    return true;
  });
}

function alignOffset(
  align: PinselaLayout["align_main"] | PinselaLayout["align_cross"],
  available: number,
  used: number,
): number {
  const spare = Math.max(0, available - used);
  if (align === "center") return spare / 2;
  if (align === "end") return spare;
  return 0;
}

function itemAxisValue(
  node: PinselaNode,
  direction: LayoutDirection,
): { main: number; cross: number } {
  const width = Math.max(1, Number(node.geometry.width || 1));
  const height = Math.max(1, Number(node.geometry.height || 1));
  if (direction === "horizontal") {
    return { main: width, cross: height };
  }
  return { main: height, cross: width };
}

function buildLayoutLines(
  items: LayoutItem[],
  direction: LayoutDirection,
  layout: PinselaLayout,
  mainLimit: number,
  gap: number,
): LayoutLine[] {
  if (!items.length) return [];
  const wrap = Boolean(layout.wrap);
  if (!wrap) {
    const mainSize = items.reduce((sum, item) => sum + item.main, 0) + gap * Math.max(0, items.length - 1);
    const crossSize = items.reduce((max, item) => Math.max(max, item.cross), 0);
    return [{ items: [...items], mainSize, crossSize }];
  }

  if (layout.wrap_mode === "grid") {
    const columns = Math.max(0, Math.round(Number(layout.grid_columns || 0)));
    const rows = Math.max(0, Math.round(Number(layout.grid_rows || 0)));
    let itemsPerLine = 0;
    if (direction === "horizontal") {
      if (columns > 0) itemsPerLine = columns;
      else if (rows > 0) itemsPerLine = Math.ceil(items.length / rows);
    } else {
      if (rows > 0) itemsPerLine = rows;
      else if (columns > 0) itemsPerLine = Math.ceil(items.length / columns);
    }

    if (itemsPerLine > 0) {
      const lines: LayoutLine[] = [];
      for (let index = 0; index < items.length; index += itemsPerLine) {
        const lineItems = items.slice(index, index + itemsPerLine);
        const mainSize = lineItems.reduce((sum, item) => sum + item.main, 0) + gap * Math.max(0, lineItems.length - 1);
        const crossSize = lineItems.reduce((max, item) => Math.max(max, item.cross), 0);
        lines.push({
          items: lineItems,
          mainSize,
          crossSize,
        });
      }
      return lines;
    }
  }

  const lines: LayoutLine[] = [];
  const effectiveLimit = Math.max(1, mainLimit);
  let lineItems: LayoutItem[] = [];
  let currentMain = 0;
  let currentCross = 0;

  const pushLine = () => {
    if (!lineItems.length) return;
    lines.push({
      items: lineItems,
      mainSize: currentMain,
      crossSize: currentCross,
    });
    lineItems = [];
    currentMain = 0;
    currentCross = 0;
  };

  for (const item of items) {
    const nextMain = lineItems.length ? currentMain + gap + item.main : item.main;
    const exceeds = lineItems.length > 0 && nextMain > effectiveLimit;
    if (exceeds) pushLine();
    lineItems.push(item);
    currentMain = lineItems.length === 1 ? item.main : currentMain + gap + item.main;
    currentCross = Math.max(currentCross, item.cross);
  }
  pushLine();

  if (!lines.length) {
    const mainSize = items.reduce((sum, item) => sum + item.main, 0) + gap * Math.max(0, items.length - 1);
    const crossSize = items.reduce((max, item) => Math.max(max, item.cross), 0);
    return [{ items: [...items], mainSize, crossSize }];
  }

  return lines;
}

function reflowContainer(
  container: PinselaNode,
  childNodes: PinselaNode[],
): { container: PinselaNode; children: Map<string, PinselaNode> } {
  const normalizedLayout = normalizeLayout(container.layout);
  if (normalizedLayout.direction === "none") {
    return { container, children: new Map(childNodes.map((child) => [child.id, child])) };
  }

  const direction = normalizedLayout.direction as LayoutDirection;
  const gap = clampPositive(Number(normalizedLayout.gap || 0), 0, 0);
  const padTop = clampPositive(Number(normalizedLayout.padding_top || 0), 0, 0);
  const padRight = clampPositive(Number(normalizedLayout.padding_right || 0), 0, 0);
  const padBottom = clampPositive(Number(normalizedLayout.padding_bottom || 0), 0, 0);
  const padLeft = clampPositive(Number(normalizedLayout.padding_left || 0), 0, 0);

  const childrenMap = new Map<string, PinselaNode>();
  childNodes.forEach((child) => childrenMap.set(child.id, child));

  let workingContainer = container;
  const visibleChildren = childNodes.filter((child) => child.style.visible !== false);
  const layoutItems: LayoutItem[] = visibleChildren.map((child) => {
    const axis = itemAxisValue(child, direction);
    return {
      id: child.id,
      main: axis.main,
      cross: axis.cross,
    };
  });

  const applyLayoutPass = (): void => {
    const innerWidth = Math.max(0, Number(workingContainer.geometry.width || 0) - padLeft - padRight);
    const innerHeight = Math.max(0, Number(workingContainer.geometry.height || 0) - padTop - padBottom);
    const mainLimit = direction === "horizontal" ? innerWidth : innerHeight;
    const crossLimit = direction === "horizontal" ? innerHeight : innerWidth;

    const lines = buildLayoutLines(
      layoutItems,
      direction,
      normalizedLayout,
      mainLimit,
      gap,
    );

    const maxMainSize = lines.reduce((max, line) => Math.max(max, line.mainSize), 0);
    const totalCrossSize = lines.length
      ? lines.reduce((sum, line) => sum + line.crossSize, 0) + gap * Math.max(0, lines.length - 1)
      : 0;

    if (normalizedLayout.sizing_mode === "hug") {
      const nextWidth = direction === "horizontal"
        ? padLeft + padRight + maxMainSize
        : padLeft + padRight + totalCrossSize;
      const nextHeight = direction === "horizontal"
        ? padTop + padBottom + totalCrossSize
        : padTop + padBottom + maxMainSize;
      workingContainer = {
        ...workingContainer,
        geometry: {
          ...workingContainer.geometry,
          width: Math.max(2, round2(nextWidth)),
          height: Math.max(2, round2(nextHeight)),
        },
      };
    }

    const availableMain = direction === "horizontal"
      ? Math.max(0, Number(workingContainer.geometry.width || 0) - padLeft - padRight)
      : Math.max(0, Number(workingContainer.geometry.height || 0) - padTop - padBottom);
    const availableCross = direction === "horizontal"
      ? Math.max(0, Number(workingContainer.geometry.height || 0) - padTop - padBottom)
      : Math.max(0, Number(workingContainer.geometry.width || 0) - padLeft - padRight);

    const blockCross = lines.length
      ? lines.reduce((sum, line) => sum + line.crossSize, 0) + gap * Math.max(0, lines.length - 1)
      : 0;
    const blockCrossOffset = alignOffset(normalizedLayout.align_cross, availableCross, blockCross);
    let crossCursor = blockCrossOffset;

    for (const line of lines) {
      const fixedMain = line.items.reduce((sum, item) => sum + item.main, 0);
      let lineGap = gap;
      let usedMain = fixedMain + gap * Math.max(0, line.items.length - 1);
      let mainOffset = alignOffset(normalizedLayout.align_main, availableMain, usedMain);

      if (
        normalizedLayout.align_main === "space_between"
        && line.items.length > 1
        && availableMain > fixedMain
      ) {
        lineGap = (availableMain - fixedMain) / Math.max(1, line.items.length - 1);
        usedMain = availableMain;
        mainOffset = 0;
      }

      const lineCrossSize = normalizedLayout.align_cross === "stretch" && !normalizedLayout.wrap
        ? availableCross
        : line.crossSize;

      let mainCursor = mainOffset;
      for (const item of line.items) {
        const child = childrenMap.get(item.id);
        if (!child) continue;

        const stretchedCross = normalizedLayout.align_cross === "stretch"
          ? Math.max(1, lineCrossSize)
          : item.cross;
        const crossOffset = normalizedLayout.align_cross === "center"
          ? (lineCrossSize - stretchedCross) / 2
          : normalizedLayout.align_cross === "end"
            ? (lineCrossSize - stretchedCross)
            : 0;

        const nextGeometry = { ...child.geometry };
        if (direction === "horizontal") {
          nextGeometry.x = round2(Number(workingContainer.geometry.x || 0) + padLeft + mainCursor);
          nextGeometry.y = round2(Number(workingContainer.geometry.y || 0) + padTop + crossCursor + crossOffset);
          nextGeometry.width = round2(item.main);
          if (normalizedLayout.align_cross === "stretch") {
            nextGeometry.height = round2(stretchedCross);
          }
        } else {
          nextGeometry.x = round2(Number(workingContainer.geometry.x || 0) + padLeft + crossCursor + crossOffset);
          nextGeometry.y = round2(Number(workingContainer.geometry.y || 0) + padTop + mainCursor);
          nextGeometry.height = round2(item.main);
          if (normalizedLayout.align_cross === "stretch") {
            nextGeometry.width = round2(stretchedCross);
          }
        }

        const changed =
          !isSameNumber(nextGeometry.x, Number(child.geometry.x || 0))
          || !isSameNumber(nextGeometry.y, Number(child.geometry.y || 0))
          || !isSameNumber(nextGeometry.width, Number(child.geometry.width || 0))
          || !isSameNumber(nextGeometry.height, Number(child.geometry.height || 0));
        if (changed) {
          childrenMap.set(child.id, {
            ...child,
            geometry: nextGeometry,
          });
        }

        mainCursor += item.main + lineGap;
      }

      crossCursor += lineCrossSize + gap;
      void usedMain;
    }
  };

  applyLayoutPass();
  if (normalizedLayout.sizing_mode === "hug") {
    applyLayoutPass();
  }

  return {
    container: workingContainer,
    children: childrenMap,
  };
}

function applyAutoLayoutReflow(doc: PinselaTemplateDocV1): PinselaTemplateDocV1 {
  const normalized = normalizeDocHierarchy(doc);
  const nodeById = new Map<string, PinselaNode>(normalized.nodes.map((node) => [node.id, node]));
  const parentById = new Map<string, string | null>(normalized.nodes.map((node) => [node.id, node.parent_id || null]));
  const depthCache = new Map<string, number>();

  const depthOf = (nodeId: string): number => {
    const cached = depthCache.get(nodeId);
    if (cached != null) return cached;
    const seen = new Set<string>();
    let cursor: string | null = nodeId;
    let depth = 0;
    while (cursor) {
      const parentId: string | null = parentById.get(cursor) ?? null;
      if (!parentId || seen.has(parentId)) break;
      depth += 1;
      seen.add(parentId);
      cursor = parentId;
    }
    depthCache.set(nodeId, depth);
    return depth;
  };

  const containers = normalized.nodes
    .filter((node) => isAutoLayoutContainerNode(node))
    .sort((a, b) => depthOf(b.id) - depthOf(a.id));

  if (!containers.length) return normalized;

  let changed = false;
  for (const container of containers) {
    const liveContainer = nodeById.get(container.id);
    if (!liveContainer || !isAutoLayoutContainerNode(liveContainer)) continue;

    const children = (liveContainer.children_ids || [])
      .map((childId) => nodeById.get(childId))
      .filter(Boolean)
      .filter((child) => child!.parent_id === liveContainer.id) as PinselaNode[];

    const reflowed = reflowContainer(liveContainer, children);
    const containerChanged =
      !isSameNumber(Number(reflowed.container.geometry.x || 0), Number(liveContainer.geometry.x || 0))
      || !isSameNumber(Number(reflowed.container.geometry.y || 0), Number(liveContainer.geometry.y || 0))
      || !isSameNumber(Number(reflowed.container.geometry.width || 0), Number(liveContainer.geometry.width || 0))
      || !isSameNumber(Number(reflowed.container.geometry.height || 0), Number(liveContainer.geometry.height || 0));
    if (containerChanged) {
      changed = true;
      nodeById.set(reflowed.container.id, reflowed.container);
    }

    reflowed.children.forEach((childNode, childId) => {
      const currentChild = nodeById.get(childId);
      if (!currentChild) return;
      const childChanged =
        !isSameNumber(Number(currentChild.geometry.x || 0), Number(childNode.geometry.x || 0))
        || !isSameNumber(Number(currentChild.geometry.y || 0), Number(childNode.geometry.y || 0))
        || !isSameNumber(Number(currentChild.geometry.width || 0), Number(childNode.geometry.width || 0))
        || !isSameNumber(Number(currentChild.geometry.height || 0), Number(childNode.geometry.height || 0));
      if (!childChanged) return;
      changed = true;
      nodeById.set(childId, childNode);
    });
  }

  if (!changed) return normalized;
  return {
    ...normalized,
    nodes: normalized.nodes.map((node) => nodeById.get(node.id) || node),
  };
}

function asAutoLayoutContentLimitRule(
  rule: PinselaDynamicRule,
): AutoLayoutContentLimitRule | null {
  if (rule.type !== "auto_layout_content_limit") return null;
  const containerId = String(rule.container_id || "").trim();
  if (!containerId) return null;
  return {
    ...rule,
    type: "auto_layout_content_limit",
    container_id: containerId,
  };
}

function normalizeTruncateMode(value: unknown): "none" | "cut" | "ellipsis" {
  const mode = String(value || "").toLowerCase();
  if (mode === "cut") return "cut";
  if (mode === "ellipsis") return "ellipsis";
  return "none";
}

function clampOptionalPositiveInt(value: unknown, max = 200000): number | undefined {
  const num = Number(value);
  if (!Number.isFinite(num)) return undefined;
  const rounded = Math.max(0, Math.min(max, Math.round(num)));
  return rounded;
}

function clampOptionalPositiveFloat(value: unknown, max = 1200): number | undefined {
  const num = Number(value);
  if (!Number.isFinite(num)) return undefined;
  return Math.max(0, Math.min(max, round2(num)));
}

function collectTextDescendants(
  containerId: string,
  nodeById: Map<string, PinselaNode>,
): string[] {
  const out: string[] = [];
  const queue = [containerId];
  const seen = new Set<string>();
  while (queue.length) {
    const currentId = queue.shift();
    if (!currentId || seen.has(currentId)) continue;
    seen.add(currentId);
    const node = nodeById.get(currentId);
    if (!node) continue;
    for (const childId of node.children_ids || []) {
      if (seen.has(childId)) continue;
      const child = nodeById.get(childId);
      if (!child) continue;
      if (child.kind === "text") out.push(child.id);
      queue.push(child.id);
    }
  }
  return out;
}

function applyContentLimitRuleToText(
  node: PinselaNode,
  rule: AutoLayoutContentLimitRule,
): PinselaNode {
  if (node.kind !== "text") return node;
  const text = String(node.text || "");
  const maxChars = clampOptionalPositiveInt(rule.max_chars);
  const truncateMode = normalizeTruncateMode(rule.truncate_mode);
  const startFontSize = clampOptionalPositiveFloat(rule.start_font_size);
  const minFontSize = clampOptionalPositiveFloat(rule.min_font_size);
  const shrinkStep = clampOptionalPositiveFloat(rule.shrink_step, 64);

  let nextText = text;
  if (maxChars != null && maxChars > 0 && text.length > maxChars) {
    if (truncateMode === "ellipsis" && maxChars > 1) {
      nextText = `${text.slice(0, maxChars - 1)}\u2026`;
    } else {
      nextText = text.slice(0, maxChars);
    }
  }

  const currentSizeRaw = Number(node.text_style?.size);
  const currentSize = Number.isFinite(currentSizeRaw) ? currentSizeRaw : undefined;
  let nextSize = currentSize;
  const effectiveStartSize = startFontSize != null
    ? startFontSize
    : currentSize;
  const overflow = maxChars != null && maxChars > 0 ? Math.max(0, text.length - maxChars) : 0;
  if (effectiveStartSize != null) {
    nextSize = effectiveStartSize;
    if (overflow > 0 && (shrinkStep || 0) > 0) {
      nextSize = effectiveStartSize - overflow * (shrinkStep || 0);
    }
    const effectiveMin = minFontSize != null ? minFontSize : 6;
    nextSize = Math.max(effectiveMin, nextSize);
  }

  const sizeChanged = nextSize != null && (!currentSize || !isSameNumber(nextSize, currentSize));
  const textChanged = nextText !== text;
  if (!textChanged && !sizeChanged) return node;

  return {
    ...node,
    text: nextText,
    text_style: {
      ...(node.text_style || {}),
      ...(nextSize != null ? { size: round2(nextSize) } : {}),
    },
  };
}

function applyAutoLayoutContentLimitRules(doc: PinselaTemplateDocV1): PinselaTemplateDocV1 {
  if (!Array.isArray(doc.dynamic_rules) || !doc.dynamic_rules.length) return doc;
  const ruleList = doc.dynamic_rules
    .map(asAutoLayoutContentLimitRule)
    .filter(Boolean) as AutoLayoutContentLimitRule[];
  if (!ruleList.length) return doc;

  const nodeById = new Map<string, PinselaNode>(doc.nodes.map((node) => [node.id, node]));
  let changed = false;

  for (const rule of ruleList) {
    if (rule.enabled === false) continue;
    const container = nodeById.get(rule.container_id);
    if (!container) continue;
    const textIds = collectTextDescendants(container.id, nodeById);
    for (const textId of textIds) {
      const current = nodeById.get(textId);
      if (!current || current.kind !== "text") continue;
      const next = applyContentLimitRuleToText(current, rule);
      if (next === current) continue;
      changed = true;
      nodeById.set(textId, next);
    }
  }

  if (!changed) return doc;
  return {
    ...doc,
    nodes: doc.nodes.map((node) => nodeById.get(node.id) || node),
  };
}

export function applyAutoLayoutDoc(doc: PinselaTemplateDocV1): PinselaTemplateDocV1 {
  const hierarchyNormalized = normalizeDocHierarchy(doc);
  const withContentRules = applyAutoLayoutContentLimitRules(hierarchyNormalized);
  return applyAutoLayoutReflow(withContentRules);
}

export function findAutoLayoutContentLimitRule(
  doc: PinselaTemplateDocV1,
  containerId: string | null | undefined,
): AutoLayoutContentLimitRule | null {
  const id = String(containerId || "").trim();
  if (!id) return null;
  for (const rule of doc.dynamic_rules || []) {
    const candidate = asAutoLayoutContentLimitRule(rule);
    if (!candidate) continue;
    if (candidate.container_id === id) return candidate;
  }
  return null;
}

function buildRuleId(): string {
  return `rule_${Math.random().toString(36).slice(2, 10)}`;
}

export function upsertAutoLayoutContentLimitRule(
  doc: PinselaTemplateDocV1,
  containerId: string,
  patch: AutoLayoutContentLimitPatch,
): PinselaTemplateDocV1 {
  const targetContainerId = String(containerId || "").trim();
  if (!targetContainerId) return doc;

  const existingIndex = (doc.dynamic_rules || []).findIndex((rule) => (
    rule.type === "auto_layout_content_limit"
    && String(rule.container_id || "").trim() === targetContainerId
  ));
  const existing = existingIndex >= 0
    ? asAutoLayoutContentLimitRule(doc.dynamic_rules[existingIndex])
    : null;

  const nextRule: AutoLayoutContentLimitRule = {
    ...(existing || {
      id: buildRuleId(),
      type: "auto_layout_content_limit" as const,
      container_id: targetContainerId,
    }),
    type: "auto_layout_content_limit",
    container_id: targetContainerId,
    enabled: patch.enabled != null ? Boolean(patch.enabled) : (existing?.enabled ?? true),
    max_chars: patch.maxChars != null
      ? clampOptionalPositiveInt(patch.maxChars)
      : existing?.max_chars,
    start_font_size: patch.startFontSize != null
      ? clampOptionalPositiveFloat(patch.startFontSize)
      : existing?.start_font_size,
    min_font_size: patch.minFontSize != null
      ? clampOptionalPositiveFloat(patch.minFontSize)
      : existing?.min_font_size,
    shrink_step: patch.shrinkStep != null
      ? clampOptionalPositiveFloat(patch.shrinkStep, 64)
      : existing?.shrink_step,
    truncate_mode: patch.truncateMode != null
      ? normalizeTruncateMode(patch.truncateMode)
      : normalizeTruncateMode(existing?.truncate_mode || "ellipsis"),
  };

  const dynamicRules = [...(doc.dynamic_rules || [])];
  if (existingIndex >= 0) {
    dynamicRules[existingIndex] = nextRule;
  } else {
    dynamicRules.push(nextRule);
  }

  return {
    ...doc,
    dynamic_rules: dynamicRules,
  };
}

export function removeAutoLayoutContentLimitRule(
  doc: PinselaTemplateDocV1,
  containerId: string | null | undefined,
): PinselaTemplateDocV1 {
  const targetContainerId = String(containerId || "").trim();
  if (!targetContainerId) return doc;
  const nextRules = (doc.dynamic_rules || []).filter((rule) => !(
    rule.type === "auto_layout_content_limit"
    && String(rule.container_id || "").trim() === targetContainerId
  ));
  if (nextRules.length === (doc.dynamic_rules || []).length) return doc;
  return {
    ...doc,
    dynamic_rules: nextRules,
  };
}

export function reparentNodesToContainer(
  doc: PinselaTemplateDocV1,
  nodeIds: string[],
  containerId: string,
  options?: ReparentToContainerOptions,
): PinselaTemplateDocV1 {
  const normalized = normalizeDocHierarchy(doc);
  const targetContainerId = String(containerId || "").trim();
  if (!targetContainerId) return normalized;

  const nodeById = new Map<string, PinselaNode>(normalized.nodes.map((node) => [node.id, node]));
  const targetContainer = nodeById.get(targetContainerId);
  if (!targetContainer || !canHostAutoLayout(targetContainer)) return normalized;

  const candidateIds = Array.from(new Set(
    nodeIds
      .map((id) => String(id || "").trim())
      .filter(Boolean)
      .filter((id) => id !== normalized.root_id && id !== targetContainerId && nodeById.has(id)),
  ));
  if (!candidateIds.length) return normalized;

  const parentById = new Map<string, string | null>(normalized.nodes.map((node) => [node.id, node.parent_id || null]));
  const topLevelCandidates = topLevelSelection(candidateIds, parentById).filter((nodeId) => (
    !isAncestor(targetContainerId, nodeId, parentById)
  ));
  if (!topLevelCandidates.length) return normalized;

  const sourceOrder = nodeIndexMap(normalized.nodes);
  const movingIds = [...topLevelCandidates].sort((a, b) => (sourceOrder.get(a) || 0) - (sourceOrder.get(b) || 0));
  const movingSet = new Set(movingIds);

  const childrenById = new Map<string, string[]>();
  normalized.nodes.forEach((node) => {
    childrenById.set(node.id, [...(node.children_ids || [])]);
  });

  for (const movingId of movingIds) {
    const parentId = parentById.get(movingId) || null;
    if (!parentId) continue;
    const parentChildren = childrenById.get(parentId) || [];
    childrenById.set(parentId, parentChildren.filter((childId) => childId !== movingId));
  }

  const targetChildren = (childrenById.get(targetContainerId) || []).filter((childId) => !movingSet.has(childId));
  const referenceId = String(options?.referenceId || "").trim();
  const placement = options?.placement || "end";
  const referenceIndex = referenceId ? targetChildren.indexOf(referenceId) : -1;
  const insertIndex = (() => {
    if (placement === "start") return 0;
    if (placement === "end") return targetChildren.length;
    if (referenceIndex < 0) return targetChildren.length;
    if (placement === "before") return referenceIndex;
    return referenceIndex + 1;
  })();

  const mergedChildren = [
    ...targetChildren.slice(0, insertIndex),
    ...movingIds,
    ...targetChildren.slice(insertIndex),
  ];
  childrenById.set(targetContainerId, mergedChildren);

  let changed = false;
  const nextNodes = normalized.nodes.map((node) => {
    const nextParent = movingSet.has(node.id) ? targetContainerId : (parentById.get(node.id) || null);
    const nextChildren = childrenById.get(node.id) || [];
    const parentChanged = (node.parent_id || null) !== nextParent;
    const childrenChanged = !sameStringArray(node.children_ids || [], nextChildren);
    if (!parentChanged && !childrenChanged) return node;
    changed = true;
    return {
      ...node,
      parent_id: nextParent,
      children_ids: nextChildren,
    };
  });

  if (!changed) return normalized;
  return {
    ...normalized,
    nodes: nextNodes,
  };
}
