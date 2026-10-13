import type { GuideLine } from "../../core/layout";
import { clonePathData, getPathFillRule, getPathSubpaths } from "../../core/pathData";
import type { PinselaNode, PinselaTemplateDocV1 } from "../../core/types";
import type { SceneSnapshot, SceneSnapshotNode } from "./types";

type SceneSnapshotInput = {
  doc: PinselaTemplateDocV1;
  guides?: GuideLine[];
  selectionBounds?: { x: number; y: number; w: number; h: number } | null;
};

const EMPTY_EFFECTS = Object.freeze([]) as unknown as any[];
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function hashString(text: string, seed = FNV_OFFSET): number {
  let hash = seed >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash >>> 0;
}

function stableSerialize(value: unknown): string {
  if (value == null) return "";
  if (typeof value !== "object") return String(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableSerialize(entry)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((key) => `${key}:${stableSerialize(obj[key])}`).join(",")}}`;
}

function hashValue(hash: number, value: unknown): number {
  return hashString(stableSerialize(value), hash);
}

function copyGeometry(geometry: PinselaNode["geometry"]): PinselaNode["geometry"] {
  return Object.freeze({ ...geometry });
}

function copyStyle(style: PinselaNode["style"]): PinselaNode["style"] {
  const stroke =
    style?.stroke && typeof style.stroke === "object"
      ? Object.freeze({ ...(style.stroke as Record<string, unknown>) })
      : style?.stroke;
  const strokes = Array.isArray((style as any)?.strokes)
    ? Object.freeze(
        (style as any).strokes.map((entry: unknown) => (
          entry && typeof entry === "object"
            ? Object.freeze({ ...(entry as Record<string, unknown>) })
            : entry
        ))
      )
    : (style as any)?.strokes;
  const effects = Array.isArray(style?.effects)
    ? Object.freeze(
        style.effects.map((fx) =>
          fx && typeof fx === "object" ? Object.freeze({ ...(fx as Record<string, unknown>) }) : fx
        )
      )
    : EMPTY_EFFECTS;
  const imageCrop =
    style?.image_crop && typeof style.image_crop === "object"
      ? Object.freeze({ ...style.image_crop })
      : style?.image_crop;
  const imageDuotone =
    style?.image_duotone && typeof style.image_duotone === "object"
      ? Object.freeze({ ...(style.image_duotone as Record<string, unknown>) })
      : style?.image_duotone;
  const imageBrushSettings =
    style?.image_brush_settings && typeof style.image_brush_settings === "object"
      ? Object.freeze({ ...(style.image_brush_settings as Record<string, unknown>) })
      : style?.image_brush_settings;
  const imageBrushStrokes = Array.isArray(style?.image_brush_strokes)
    ? Object.freeze(
        style.image_brush_strokes.map((stroke) => {
          if (!stroke || typeof stroke !== "object") return stroke;
          const rawStroke = stroke as Record<string, unknown>;
          const points = Array.isArray(rawStroke.points)
            ? Object.freeze(
                rawStroke.points.map((point) => {
                  if (!point || typeof point !== "object") return point;
                  const rawPoint = point as Record<string, unknown>;
                  return Object.freeze({
                    u: Number(rawPoint.u || 0),
                    v: Number(rawPoint.v || 0),
                  });
                })
              )
            : Object.freeze([]);
          return Object.freeze({
            ...rawStroke,
            points,
          });
        })
      )
    : style?.image_brush_strokes;
  return Object.freeze({
    ...(style || {}),
    stroke,
    strokes,
    effects,
    image_crop: imageCrop,
    image_duotone: imageDuotone,
    image_brush_settings: imageBrushSettings,
    image_brush_strokes: imageBrushStrokes,
  }) as PinselaNode["style"];
}

function copyTextStyle(textStyle: PinselaNode["text_style"]): PinselaNode["text_style"] {
  if (!textStyle) return undefined;
  return Object.freeze({ ...textStyle });
}

function copyTextRuns(textRuns: PinselaNode["text_runs"]): PinselaNode["text_runs"] {
  if (!Array.isArray(textRuns)) return [];
  return Object.freeze(
    textRuns.map((run) => Object.freeze({
      start: Number(run?.start || 0),
      end: Number(run?.end || 0),
      style: run?.style && typeof run.style === "object"
        ? Object.freeze({ ...(run.style as Record<string, unknown>) })
        : {},
    }))
  ) as PinselaNode["text_runs"];
}

function copyTextPath(textPath: PinselaNode["text_path"]): PinselaNode["text_path"] {
  if (!textPath) return null;
  if (textPath.type === "bezier") {
    const points = Array.isArray(textPath.points)
      ? textPath.points.map((p) => ({ x: Number(p.x || 0), y: Number(p.y || 0) }))
      : [];
    return Object.freeze({
      ...textPath,
      type: "bezier" as const,
      points,
    });
  }
  return Object.freeze({ ...textPath });
}

function copyTextFit(fit: PinselaNode["fit"]): PinselaNode["fit"] {
  if (!fit) return null;
  return Object.freeze({
    start_size: fit.start_size ?? null,
    min_size: fit.min_size ?? null,
    max_lines: fit.max_lines ?? null,
    min_lines: fit.min_lines ?? null,
    truncate_mode: fit.truncate_mode || "none",
  });
}

function copyPathData(pathData: PinselaNode["path_data"]): PinselaNode["path_data"] {
  const cloned = clonePathData(pathData);
  if (!cloned) return null;
  return Object.freeze({
    ...cloned,
    points: Object.freeze((cloned.points || []).map((point) => Object.freeze({
      ...point,
      in: point.in ? Object.freeze({ ...point.in }) : point.in ?? null,
      out: point.out ? Object.freeze({ ...point.out }) : point.out ?? null,
    }))),
    subpaths: Object.freeze((cloned.subpaths || []).map((subpath) => Object.freeze({
      closed: subpath.closed !== false,
      points: Object.freeze((subpath.points || []).map((point) => Object.freeze({
        ...point,
        in: point.in ? Object.freeze({ ...point.in }) : point.in ?? null,
        out: point.out ? Object.freeze({ ...point.out }) : point.out ?? null,
      }))),
    }))),
  }) as unknown as PinselaNode["path_data"];
}

function toSceneNode(node: PinselaNode): SceneSnapshotNode {
  const draft = {
    id: node.id,
    renderHash: 0,
    parent_id: node.parent_id || null,
    kind: node.kind,
    geometry: copyGeometry(node.geometry),
    style: copyStyle(node.style),
    text: node.text ?? null,
    text_model: node.text_model,
    text_style: copyTextStyle(node.text_style),
    text_runs: copyTextRuns(node.text_runs),
    text_path: copyTextPath(node.text_path),
    fit: copyTextFit(node.fit),
    path_data: copyPathData(node.path_data),
    image_src: node.image_src ?? null,
  } satisfies SceneSnapshotNode;
  return Object.freeze({
    ...draft,
    renderHash: hashSceneNode(draft),
  });
}

function hashSceneNode(node: SceneSnapshotNode): number {
  const g = node.geometry;
  const s = node.style;
  let hash = FNV_OFFSET;
  hash = hashValue(hash, node.id);
  hash = hashValue(hash, String(node.parent_id || ""));
  hash = hashValue(hash, node.kind);
  hash = hashValue(hash, Number(g.x || 0));
  hash = hashValue(hash, Number(g.y || 0));
  hash = hashValue(hash, Number(g.width || 0));
  hash = hashValue(hash, Number(g.height || 0));
  hash = hashValue(hash, Number(g.rotation || 0));
  hash = hashValue(hash, Number(g.corner_radius || 0));
  hash = hashValue(hash, g.clip ? 1 : 0);
  hash = hashValue(hash, s.visible !== false ? 1 : 0);
  hash = hashValue(hash, Number(s.opacity ?? 1));
  hash = hashValue(hash, String((s as any)?.shape_type || ""));
  hash = hashValue(hash, Number((s as any)?.shape_sides || 0));
  hash = hashValue(hash, Number((s as any)?.star_points || 0));
  hash = hashValue(hash, Number((s as any)?.star_inner_ratio || 0));
  hash = hashValue(hash, s.fill);
  if (s?.stroke && typeof s.stroke === "object") {
    hash = hashValue(hash, (s.stroke as any).color ?? "");
    hash = hashValue(hash, Number((s.stroke as any).width || 0));
    hash = hashValue(hash, String((s.stroke as any).cap || ""));
    hash = hashValue(hash, String((s.stroke as any).line_kind || ""));
    const dash = Array.isArray((s.stroke as any).dash) ? (s.stroke as any).dash : [];
    hash = hashValue(hash, dash.length);
    for (const seg of dash) hash = hashValue(hash, Number(seg || 0));
  } else {
    hash = hashValue(hash, s?.stroke || "");
  }
  if (Array.isArray((s as any)?.strokes)) {
    const strokes = (s as any).strokes as unknown[];
    hash = hashValue(hash, strokes.length);
    for (const stroke of strokes) {
      hash = hashValue(
        hash,
        stroke && typeof stroke === "object"
          ? stableSerialize(stroke as Record<string, unknown>)
          : String(stroke ?? ""),
      );
    }
  } else {
    hash = hashValue(hash, 0);
  }
  if (Array.isArray(s.effects)) {
    hash = hashValue(hash, s.effects.length);
    for (const effect of s.effects) {
      hash = hashValue(
        hash,
        effect && typeof effect === "object"
          ? stableSerialize(effect as Record<string, unknown>)
          : String(effect ?? ""),
      );
    }
  } else {
    hash = hashValue(hash, 0);
  }
  hash = hashValue(hash, String(s.image_fit || ""));
  if (s.image_crop) {
    hash = hashValue(hash, Number(s.image_crop.x || 0));
    hash = hashValue(hash, Number(s.image_crop.y || 0));
    hash = hashValue(hash, Number(s.image_crop.width || 0));
    hash = hashValue(hash, Number(s.image_crop.height || 0));
  }
  if (s.image_duotone && typeof s.image_duotone === "object") {
    const duotone = s.image_duotone as Record<string, unknown>;
    hash = hashValue(hash, duotone.enabled ? 1 : 0);
    hash = hashValue(hash, duotone.shadows || "");
    hash = hashValue(hash, duotone.highlights || "");
    hash = hashValue(hash, Number(duotone.amount || 0));
  }
  if (s.image_fade && typeof s.image_fade === "object") {
    const fade = s.image_fade as Record<string, unknown>;
    hash = hashValue(hash, fade.enabled ? 1 : 0);
    hash = hashValue(hash, Number(fade.softness || 0));
    hash = hashValue(hash, JSON.stringify(fade.linear ?? null));
    hash = hashValue(hash, JSON.stringify(fade.radial ?? null));
    hash = hashValue(hash, JSON.stringify(fade.edges ?? null));
  }
  if (s.image_brush_settings && typeof s.image_brush_settings === "object") {
    const bs = s.image_brush_settings as Record<string, unknown>;
    hash = hashValue(hash, Number(bs.size || 0));
    hash = hashValue(hash, Number(bs.opacity || 0));
    hash = hashValue(hash, Number(bs.flow || 0));
    hash = hashValue(hash, Number(bs.hardness || 0));
    hash = hashValue(hash, Number(bs.accumulation || 0));
    hash = hashValue(hash, Number(bs.spacing || 0));
    hash = hashValue(hash, Number(bs.shape || 0));
    hash = hashValue(hash, Number(bs.rotation || 0));
    hash = hashValue(hash, String(bs.mode || ""));
    hash = hashValue(hash, bs.color || "");
  }
  if (Array.isArray(s.image_brush_strokes)) {
    hash = hashValue(hash, s.image_brush_strokes.length);
    for (const rawStroke of s.image_brush_strokes) {
      if (!rawStroke || typeof rawStroke !== "object") continue;
      const stroke = rawStroke as Record<string, unknown>;
      hash = hashValue(hash, String(stroke.id || ""));
      hash = hashValue(hash, String(stroke.mode || ""));
      hash = hashValue(hash, Number(stroke.size || 0));
      hash = hashValue(hash, Number(stroke.opacity || 0));
      hash = hashValue(hash, Number(stroke.flow || 0));
      hash = hashValue(hash, Number(stroke.hardness || 0));
      hash = hashValue(hash, Number(stroke.accumulation || 0));
      hash = hashValue(hash, Number(stroke.spacing || 0));
      hash = hashValue(hash, Number(stroke.shape || 0));
      hash = hashValue(hash, Number(stroke.rotation || 0));
      hash = hashValue(hash, stroke.color || "");
      const points = Array.isArray(stroke.points) ? stroke.points : [];
      hash = hashValue(hash, points.length);
      for (const rawPoint of points) {
        if (!rawPoint || typeof rawPoint !== "object") continue;
        const point = rawPoint as Record<string, unknown>;
        hash = hashValue(hash, Number(point.u || 0));
        hash = hashValue(hash, Number(point.v || 0));
      }
    }
  }
  hash = hashValue(hash, String(node.text || ""));
  hash = hashValue(hash, String(node.text_model || ""));
  if (node.text_style) {
    hash = hashValue(hash, String(node.text_style.family || ""));
    hash = hashValue(hash, String(node.text_style.style || ""));
    hash = hashValue(hash, Number(node.text_style.size || 0));
    hash = hashValue(hash, Number(node.text_style.line_height || 0));
    hash = hashValue(hash, String(node.text_style.line_height_unit || ""));
    hash = hashValue(hash, Number(node.text_style.letter_spacing || 0));
    hash = hashValue(hash, String(node.text_style.text_align || ""));
    hash = hashValue(hash, String(node.text_style.vertical_align || ""));
    hash = hashValue(hash, node.text_style.color || "");
  }
  if (Array.isArray(node.text_runs)) {
    hash = hashValue(hash, node.text_runs.length);
    for (const run of node.text_runs) {
      hash = hashValue(hash, Number(run?.start || 0));
      hash = hashValue(hash, Number(run?.end || 0));
      hash = hashValue(hash, run?.style && typeof run.style === "object" ? stableSerialize(run.style) : "");
    }
  }
  if (node.text_path) {
    hash = hashValue(hash, node.text_path.type);
    hash = hashValue(hash, Number(node.text_path.radius || 0));
    hash = hashValue(hash, Number(node.text_path.start_angle || 0));
    hash = hashValue(hash, Number(node.text_path.sweep_angle || 0));
    hash = hashValue(hash, node.text_path.clockwise ? 1 : 0);
    hash = hashValue(hash, Number(node.text_path.start_offset || 0));
    hash = hashValue(hash, node.text_path.reverse ? 1 : 0);
    hash = hashValue(hash, String(node.text_path.anchor || ""));
    hash = hashValue(hash, Number(node.text_path.baseline_shift || 0));
    if (Array.isArray(node.text_path.points)) {
      for (const point of node.text_path.points) {
        hash = hashValue(hash, Number(point.x || 0));
        hash = hashValue(hash, Number(point.y || 0));
      }
    }
  }
  if (node.fit) {
    hash = hashValue(hash, Number(node.fit.start_size || 0));
    hash = hashValue(hash, Number(node.fit.min_size || 0));
    hash = hashValue(hash, Number(node.fit.max_lines || 0));
    hash = hashValue(hash, Number(node.fit.min_lines || 0));
    hash = hashValue(hash, String(node.fit.truncate_mode || ""));
  }
  if (node.path_data && Array.isArray(node.path_data.points)) {
    const subpaths = getPathSubpaths(node.path_data);
    hash = hashValue(hash, getPathFillRule(node.path_data));
    hash = hashValue(hash, subpaths.length);
    for (const subpath of subpaths) {
      hash = hashValue(hash, subpath.closed !== false ? 1 : 0);
      hash = hashValue(hash, subpath.points.length);
      for (const point of subpath.points) {
        hash = hashValue(hash, Number(point.x || 0));
        hash = hashValue(hash, Number(point.y || 0));
        hash = hashValue(hash, String(point.mode || ""));
        hash = hashValue(hash, Number(point.in?.x || 0));
        hash = hashValue(hash, Number(point.in?.y || 0));
        hash = hashValue(hash, Number(point.out?.x || 0));
        hash = hashValue(hash, Number(point.out?.y || 0));
      }
    }
  }
  hash = hashValue(hash, String(node.image_src || ""));
  return hash >>> 0;
}

export function createSceneSnapshot(input: SceneSnapshotInput): SceneSnapshot {
  const { doc } = input;
  const nodes = Object.freeze(
    [...doc.nodes]
      .filter((n) => n.id !== doc.root_id)
      .sort((a, b) => (a.geometry.z_index || 0) - (b.geometry.z_index || 0))
      .map((n) => toSceneNode(n))
  );
  const guides = Object.freeze((input.guides || []).map((g) => Object.freeze({ axis: g.axis, value: Number(g.value || 0), source: g.source })));
  const selectionBounds = input.selectionBounds
    ? Object.freeze({
        x: Number(input.selectionBounds.x || 0),
        y: Number(input.selectionBounds.y || 0),
        w: Number(input.selectionBounds.w || 0),
        h: Number(input.selectionBounds.h || 0),
      })
    : null;
  const imageSources = Object.freeze(
    Array.from(
      new Set(
        nodes
          .map((n) => String(n.image_src || "").trim())
          .filter(Boolean)
      )
    )
  );

  let sceneHash = FNV_OFFSET;
  sceneHash = hashValue(sceneHash, Math.max(1, Math.round(Number(doc.canvas.width || 1))));
  sceneHash = hashValue(sceneHash, Math.max(1, Math.round(Number(doc.canvas.height || 1))));
  sceneHash = hashValue(sceneHash, doc.canvas.background ?? "#f2ece4");
  sceneHash = hashValue(sceneHash, nodes.length);
  for (const node of nodes) {
    sceneHash = hashValue(sceneHash, node.renderHash);
  }
  const key = `v2:${sceneHash.toString(16)}:${nodes.length}`;

  return Object.freeze({
    key,
    rootId: doc.root_id,
    canvas: Object.freeze({
      width: Math.max(1, Math.round(Number(doc.canvas.width || 1))),
      height: Math.max(1, Math.round(Number(doc.canvas.height || 1))),
      background: doc.canvas.background ?? "#f2ece4",
    }),
    nodes,
    guides,
    selectionBounds,
    imageSources,
    createdAtMs: Date.now(),
  });
}
