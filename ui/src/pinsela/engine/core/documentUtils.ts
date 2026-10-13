import type { PinselaNode } from "../../core/types";

const PINSELA_AUTOSAVE_PREFIX = "pinsela:pinsela:doc";

export function cloneDoc<T>(doc: T): T {
  return JSON.parse(JSON.stringify(doc));
}

export function autosaveKey(templateKey: string): string {
  const key = String(templateKey || "draft").trim().toLowerCase() || "draft";
  return `${PINSELA_AUTOSAVE_PREFIX}:${key}`;
}

function csvToRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (!inQuotes && ch === ",") {
      row.push(cell.trim());
      cell = "";
      continue;
    }
    if (!inQuotes && (ch === "\n" || ch === "\r")) {
      if (ch === "\r" && next === "\n") i += 1;
      row.push(cell.trim());
      cell = "";
      if (row.some((x) => x.length > 0)) rows.push(row);
      row = [];
      continue;
    }
    cell += ch;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell.trim());
    if (row.some((x) => x.length > 0)) rows.push(row);
  }
  return rows;
}

export function parseCsvPayloads(csvRaw: string): Record<string, any>[] {
  const rows = csvToRows(csvRaw);
  if (!rows.length) return [];
  const headers = rows[0].map((h) => String(h || "").trim()).filter(Boolean);
  if (!headers.length) return [];
  const out: Record<string, any>[] = [];
  for (let i = 1; i < rows.length; i += 1) {
    const r = rows[i];
    const payload: Record<string, any> = {};
    headers.forEach((h, idx) => {
      const v = String(r[idx] || "").trim();
      if (v) payload[h] = v;
    });
    if (Object.keys(payload).length) out.push(payload);
  }
  return out;
}

export function rotatePoint(px: number, py: number, cx: number, cy: number, deg: number) {
  const rad = (deg * Math.PI) / 180;
  const dx = px - cx;
  const dy = py - cy;
  return {
    x: cx + dx * Math.cos(rad) - dy * Math.sin(rad),
    y: cy + dx * Math.sin(rad) + dy * Math.cos(rad),
  };
}

export function intersectRect(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number }
): boolean {
  const ax2 = a.x + a.w;
  const ay2 = a.y + a.h;
  const bx2 = b.x + b.w;
  const by2 = b.y + b.h;
  return !(ax2 < b.x || bx2 < a.x || ay2 < b.y || by2 < a.y);
}

export function defaultBezierPointsForNode(node: PinselaNode) {
  const w = Math.max(8, Number(node.geometry.width || 0));
  const h = Math.max(8, Number(node.geometry.height || 0));
  return [
    { x: 0, y: h * 0.72 },
    { x: w * 0.28, y: h * 0.08 },
    { x: w * 0.72, y: h * 0.92 },
    { x: w, y: h * 0.32 },
  ];
}

