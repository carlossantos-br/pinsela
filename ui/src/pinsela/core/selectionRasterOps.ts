import { drawDocToCanvas, type RenderOptions } from "./export";
import { clonePathData } from "./pathData";
import type { PinselaNode, PinselaTemplateDocV1 } from "./types";

export type SelectionBooleanOperationId =
  | "union"
  | "subtract"
  | "intersect"
  | "divide"
  | "exclude"
  | "slice";

export type PerspectiveWarpOffsets = {
  tlx: number;
  tly: number;
  trx: number;
  try: number;
  brx: number;
  bry: number;
  blx: number;
  bly: number;
};

export type RasterizedPiece = {
  x: number;
  y: number;
  width: number;
  height: number;
  dataUrl: string;
};

type Point2D = { x: number; y: number };
type RectLike = { x: number; y: number; w: number; h: number };

function clampRange(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  if (value <= min) return min;
  if (value >= max) return max;
  return value;
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

function cloneNode(node: PinselaNode): PinselaNode {
  return {
    ...node,
    children_ids: [...(node.children_ids || [])],
    geometry: { ...(node.geometry || {}) },
    layout: { ...(node.layout || {}) },
    constraints: { ...(node.constraints || {}) },
    style: { ...(node.style || {}) },
    text_style: node.text_style ? { ...node.text_style } : undefined,
    text_runs: Array.isArray(node.text_runs) ? [...node.text_runs] : node.text_runs,
    text_path: node.text_path ? { ...node.text_path } : node.text_path,
    fit: node.fit ? { ...node.fit } : node.fit,
    path_data: clonePathData(node.path_data),
    component_instance: node.component_instance ? { ...node.component_instance } : node.component_instance,
  };
}

function buildTransientDoc(
  doc: PinselaTemplateDocV1,
  nodes: PinselaNode[],
): PinselaTemplateDocV1 {
  const rootNode = doc.nodes.find((node) => node.id === doc.root_id) || null;
  const root = rootNode
    ? cloneNode(rootNode)
    : ({
      id: doc.root_id,
      parent_id: null,
      children_ids: [],
      name: "ROOT",
      kind: "frame",
      geometry: {
        x: 0,
        y: 0,
        width: Math.max(1, Number(doc.canvas.width || 1)),
        height: Math.max(1, Number(doc.canvas.height || 1)),
        rotation: 0,
        corner_radius: 0,
        clip: false,
        z_index: 0,
      },
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
        fill: "rgba(0,0,0,0)",
        stroke: null,
        effects: [],
      },
      text: null,
      text_style: undefined,
      text_runs: [],
      text_path: null,
      path_data: null,
      image_src: null,
      editable: false,
      component_instance: null,
    } as PinselaNode);

  const safeNodes = nodes
    .map((node) => cloneNode(node))
    .sort((a, b) => Number(a.geometry?.z_index || 0) - Number(b.geometry?.z_index || 0));

  return {
    ...doc,
    canvas: {
      ...doc.canvas,
      background: "rgba(0,0,0,0)",
    },
    nodes: [root, ...safeNodes],
  };
}

async function renderNodesToCanvas(
  doc: PinselaTemplateDocV1,
  nodes: PinselaNode[],
  imageCache?: Map<string, HTMLImageElement>,
): Promise<HTMLCanvasElement> {
  const canvas = createCanvas(doc.canvas.width, doc.canvas.height);
  const renderDoc = buildTransientDoc(doc, nodes);
  const options: RenderOptions = {
    width: doc.canvas.width,
    height: doc.canvas.height,
    backgroundMode: "transparent",
    imageCache,
    pixelRatio: 1,
    guides: [],
    selectionBounds: null,
  };
  await drawDocToCanvas(renderDoc, canvas, options);
  return canvas;
}

function detectOpaqueBounds(canvas: HTMLCanvasElement, alphaThreshold = 4): RectLike | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const width = canvas.width;
  const height = canvas.height;
  if (width <= 0 || height <= 0) return null;
  const data = ctx.getImageData(0, 0, width, height).data;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    const row = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      const alpha = data[row + x * 4 + 3];
      if (alpha < alphaThreshold) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < minX || maxY < minY) return null;
  return {
    x: minX,
    y: minY,
    w: maxX - minX + 1,
    h: maxY - minY + 1,
  };
}

function canvasRegionToPiece(canvas: HTMLCanvasElement, bounds: RectLike): RasterizedPiece | null {
  const width = Math.max(1, Math.round(bounds.w));
  const height = Math.max(1, Math.round(bounds.h));
  if (width <= 0 || height <= 0) return null;
  const crop = createCanvas(width, height);
  const cropCtx = crop.getContext("2d");
  if (!cropCtx) return null;
  cropCtx.clearRect(0, 0, width, height);
  cropCtx.drawImage(
    canvas,
    Math.round(bounds.x),
    Math.round(bounds.y),
    width,
    height,
    0,
    0,
    width,
    height,
  );
  return {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width,
    height,
    dataUrl: crop.toDataURL("image/png"),
  };
}

function composeBooleanCanvas(
  operation: SelectionBooleanOperationId,
  canvasA: HTMLCanvasElement,
  canvasB: HTMLCanvasElement,
  width: number,
  height: number,
): HTMLCanvasElement[] {
  const makeCanvas = () => createCanvas(width, height);
  const drawSubtract = (source: HTMLCanvasElement, cutter: HTMLCanvasElement): HTMLCanvasElement => {
    const canvas = makeCanvas();
    const ctx = canvas.getContext("2d");
    if (!ctx) return canvas;
    ctx.drawImage(source, 0, 0);
    ctx.globalCompositeOperation = "destination-out";
    ctx.drawImage(cutter, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    return canvas;
  };
  const drawIntersect = (source: HTMLCanvasElement, mask: HTMLCanvasElement): HTMLCanvasElement => {
    const canvas = makeCanvas();
    const ctx = canvas.getContext("2d");
    if (!ctx) return canvas;
    ctx.drawImage(source, 0, 0);
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(mask, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    return canvas;
  };
  if (operation === "subtract") {
    return [drawSubtract(canvasA, canvasB)];
  }
  if (operation === "intersect") {
    return [drawIntersect(canvasA, canvasB)];
  }
  if (operation === "exclude") {
    const canvas = makeCanvas();
    const ctx = canvas.getContext("2d");
    if (!ctx) return [canvas];
    ctx.drawImage(canvasA, 0, 0);
    ctx.globalCompositeOperation = "xor";
    ctx.drawImage(canvasB, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    return [canvas];
  }
  if (operation === "divide" || operation === "slice") {
    const aMinusB = drawSubtract(canvasA, canvasB);
    const overlap = drawIntersect(canvasA, canvasB);
    const bMinusA = drawSubtract(canvasB, canvasA);
    return [aMinusB, overlap, bMinusA];
  }

  const union = makeCanvas();
  const unionCtx = union.getContext("2d");
  if (!unionCtx) return [union];
  unionCtx.drawImage(canvasA, 0, 0);
  unionCtx.drawImage(canvasB, 0, 0);
  return [union];
}

function lerpPoint(a: Point2D, b: Point2D, t: number): Point2D {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

function warpCanvasToQuad(
  source: HTMLCanvasElement,
  destination: HTMLCanvasElement,
  topLeft: Point2D,
  topRight: Point2D,
  bottomRight: Point2D,
  bottomLeft: Point2D,
): void {
  const ctx = destination.getContext("2d");
  if (!ctx) return;
  const sw = source.width;
  const sh = source.height;
  const strips = Math.max(24, Math.min(420, Math.round(sw)));

  for (let i = 0; i < strips; i += 1) {
    const t0 = i / strips;
    const t1 = (i + 1) / strips;
    const sx0 = Math.max(0, Math.min(sw - 1, Math.floor(t0 * sw)));
    const sx1 = Math.max(sx0 + 1, Math.min(sw, Math.ceil(t1 * sw) + 1));
    const sourceWidth = Math.max(1, sx1 - sx0);

    const top0 = lerpPoint(topLeft, topRight, t0);
    const top1 = lerpPoint(topLeft, topRight, t1);
    const bottom0 = lerpPoint(bottomLeft, bottomRight, t0);
    const bottom1 = lerpPoint(bottomLeft, bottomRight, t1);

    const vx = { x: top1.x - top0.x, y: top1.y - top0.y };
    const vy = { x: bottom0.x - top0.x, y: bottom0.y - top0.y };

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(top0.x, top0.y);
    ctx.lineTo(top1.x, top1.y);
    ctx.lineTo(bottom1.x, bottom1.y);
    ctx.lineTo(bottom0.x, bottom0.y);
    ctx.closePath();
    ctx.clip();

    ctx.transform(vx.x, vx.y, vy.x / sh, vy.y / sh, top0.x, top0.y);
    ctx.drawImage(source, sx0, 0, sourceWidth, sh, 0, 0, 1, sh);
    ctx.restore();
  }
}

export async function rasterizeSelectionBooleanOperation(
  doc: PinselaTemplateDocV1,
  firstNode: PinselaNode,
  secondNode: PinselaNode,
  operation: SelectionBooleanOperationId,
  imageCache?: Map<string, HTMLImageElement>,
): Promise<RasterizedPiece[]> {
  if (typeof document === "undefined") return [];
  const width = Math.max(1, Math.round(Number(doc.canvas.width || 1)));
  const height = Math.max(1, Math.round(Number(doc.canvas.height || 1)));
  const firstCanvas = await renderNodesToCanvas(doc, [firstNode], imageCache);
  const secondCanvas = await renderNodesToCanvas(doc, [secondNode], imageCache);
  const composedCanvases = composeBooleanCanvas(operation, firstCanvas, secondCanvas, width, height);

  const pieces: RasterizedPiece[] = [];
  for (const canvas of composedCanvases) {
    const bounds = detectOpaqueBounds(canvas);
    if (!bounds) continue;
    const piece = canvasRegionToPiece(canvas, bounds);
    if (!piece) continue;
    pieces.push(piece);
  }
  return pieces;
}

export async function rasterizeNodesToPiece(
  doc: PinselaTemplateDocV1,
  nodes: PinselaNode[],
  imageCache?: Map<string, HTMLImageElement>,
): Promise<RasterizedPiece | null> {
  if (typeof document === "undefined") return null;
  if (!nodes.length) return null;
  const rendered = await renderNodesToCanvas(doc, nodes, imageCache);
  const bounds = detectOpaqueBounds(rendered);
  if (!bounds) return null;
  return canvasRegionToPiece(rendered, bounds);
}

export async function rasterizePerspectiveWarp(
  doc: PinselaTemplateDocV1,
  selectionNodes: PinselaNode[],
  offsets: Partial<PerspectiveWarpOffsets>,
  imageCache?: Map<string, HTMLImageElement>,
): Promise<RasterizedPiece | null> {
  if (typeof document === "undefined") return null;
  if (!selectionNodes.length) return null;
  const rendered = await renderNodesToCanvas(doc, selectionNodes, imageCache);
  const sourceBounds = detectOpaqueBounds(rendered);
  if (!sourceBounds) return null;

  const source = createCanvas(sourceBounds.w, sourceBounds.h);
  const sourceCtx = source.getContext("2d");
  if (!sourceCtx) return null;
  sourceCtx.drawImage(
    rendered,
    sourceBounds.x,
    sourceBounds.y,
    sourceBounds.w,
    sourceBounds.h,
    0,
    0,
    sourceBounds.w,
    sourceBounds.h,
  );

  const maxOffset = Math.max(12, Math.round(Math.max(sourceBounds.w, sourceBounds.h) * 1.5));
  const safeOffsets: PerspectiveWarpOffsets = {
    tlx: clampRange(Number(offsets.tlx), -maxOffset, maxOffset, 0),
    tly: clampRange(Number(offsets.tly), -maxOffset, maxOffset, 0),
    trx: clampRange(Number(offsets.trx), -maxOffset, maxOffset, 0),
    try: clampRange(Number(offsets.try), -maxOffset, maxOffset, 0),
    brx: clampRange(Number(offsets.brx), -maxOffset, maxOffset, 0),
    bry: clampRange(Number(offsets.bry), -maxOffset, maxOffset, 0),
    blx: clampRange(Number(offsets.blx), -maxOffset, maxOffset, 0),
    bly: clampRange(Number(offsets.bly), -maxOffset, maxOffset, 0),
  };

  const rawTopLeft: Point2D = { x: safeOffsets.tlx, y: safeOffsets.tly };
  const rawTopRight: Point2D = { x: source.width + safeOffsets.trx, y: safeOffsets.try };
  const rawBottomRight: Point2D = { x: source.width + safeOffsets.brx, y: source.height + safeOffsets.bry };
  const rawBottomLeft: Point2D = { x: safeOffsets.blx, y: source.height + safeOffsets.bly };

  const minX = Math.min(rawTopLeft.x, rawTopRight.x, rawBottomRight.x, rawBottomLeft.x);
  const minY = Math.min(rawTopLeft.y, rawTopRight.y, rawBottomRight.y, rawBottomLeft.y);
  const maxX = Math.max(rawTopLeft.x, rawTopRight.x, rawBottomRight.x, rawBottomLeft.x);
  const maxY = Math.max(rawTopLeft.y, rawTopRight.y, rawBottomRight.y, rawBottomLeft.y);
  const destWidth = Math.max(1, Math.ceil(maxX - minX));
  const destHeight = Math.max(1, Math.ceil(maxY - minY));

  const destination = createCanvas(destWidth, destHeight);
  const topLeft: Point2D = { x: rawTopLeft.x - minX, y: rawTopLeft.y - minY };
  const topRight: Point2D = { x: rawTopRight.x - minX, y: rawTopRight.y - minY };
  const bottomRight: Point2D = { x: rawBottomRight.x - minX, y: rawBottomRight.y - minY };
  const bottomLeft: Point2D = { x: rawBottomLeft.x - minX, y: rawBottomLeft.y - minY };
  warpCanvasToQuad(source, destination, topLeft, topRight, bottomRight, bottomLeft);

  const warpedBounds = detectOpaqueBounds(destination);
  if (!warpedBounds) return null;
  const croppedWarped = canvasRegionToPiece(destination, warpedBounds);
  if (!croppedWarped) return null;

  return {
    ...croppedWarped,
    x: Math.round(sourceBounds.x + minX + warpedBounds.x),
    y: Math.round(sourceBounds.y + minY + warpedBounds.y),
  };
}
