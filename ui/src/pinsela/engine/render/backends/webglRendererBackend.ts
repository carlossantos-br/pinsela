import type { SceneSnapshot, SceneSnapshotNode } from "../types";
import type {
  RenderBackendFrameStats,
  RenderBackendSupport,
  RenderFrameInput,
  RendererBackend,
} from "./rendererBackend";

type ColorRGBA = [number, number, number, number];

type TextureEntry = {
  texture: WebGLTexture;
  width: number;
  height: number;
  bytes: number;
  lastUsedAt: number;
};

type ImageDraw = {
  src: string;
  opacity: number;
  p0: { x: number; y: number };
  p1: { x: number; y: number };
  p2: { x: number; y: number };
  p3: { x: number; y: number };
  u0: number;
  v0: number;
  u1: number;
  v1: number;
};

type ColorChunkEntry = {
  hash: number;
  verts: Float32Array;
};

type ColorFrameRange = {
  offset: number;
  length: number;
  hash: number;
};

type ColorFrameUpdate = {
  offset: number;
  chunk: Float32Array;
};

const SUPPORTED_KINDS = new Set(["rect", "frame", "group", "line", "image"]);
const TEXTURE_BUDGET_BYTES = 96 * 1024 * 1024;

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
}

function parseHexColor(input: string): ColorRGBA | null {
  const raw = input.trim().replace("#", "");
  if (![3, 4, 6, 8].includes(raw.length)) return null;
  if (raw.length === 3 || raw.length === 4) {
    const r = Number.parseInt(raw[0] + raw[0], 16) / 255;
    const g = Number.parseInt(raw[1] + raw[1], 16) / 255;
    const b = Number.parseInt(raw[2] + raw[2], 16) / 255;
    const a = raw.length === 4 ? Number.parseInt(raw[3] + raw[3], 16) / 255 : 1;
    return [clamp01(r), clamp01(g), clamp01(b), clamp01(a)];
  }
  const r = Number.parseInt(raw.slice(0, 2), 16) / 255;
  const g = Number.parseInt(raw.slice(2, 4), 16) / 255;
  const b = Number.parseInt(raw.slice(4, 6), 16) / 255;
  const a = raw.length === 8 ? Number.parseInt(raw.slice(6, 8), 16) / 255 : 1;
  return [clamp01(r), clamp01(g), clamp01(b), clamp01(a)];
}

function parseRgbColor(input: string): ColorRGBA | null {
  const text = input.trim().toLowerCase();
  const rgbaMatch = text.match(/^rgba?\(([^)]+)\)$/);
  if (!rgbaMatch) return null;
  const parts = rgbaMatch[1].split(",").map((x) => x.trim());
  if (parts.length < 3) return null;
  const r = Number(parts[0]);
  const g = Number(parts[1]);
  const b = Number(parts[2]);
  const a = parts.length >= 4 ? Number(parts[3]) : 1;
  return [clamp01(r / 255), clamp01(g / 255), clamp01(b / 255), clamp01(a)];
}

function colorToRgba(input: unknown, fallback: ColorRGBA = [0, 0, 0, 1]): ColorRGBA {
  if (typeof input === "string") {
    const hex = input.trim().startsWith("#") ? parseHexColor(input) : null;
    if (hex) return hex;
    const rgb = parseRgbColor(input);
    if (rgb) return rgb;
    return fallback;
  }
  if (input && typeof input === "object") {
    const obj = input as Record<string, unknown>;
    const rRaw = Number(obj.r ?? 0);
    const gRaw = Number(obj.g ?? 0);
    const bRaw = Number(obj.b ?? 0);
    const aRaw = Number(obj.a ?? 1);
    if (rRaw <= 1 && gRaw <= 1 && bRaw <= 1) return [clamp01(rRaw), clamp01(gRaw), clamp01(bRaw), clamp01(aRaw)];
    return [clamp01(rRaw / 255), clamp01(gRaw / 255), clamp01(bRaw / 255), clamp01(aRaw)];
  }
  return fallback;
}

function rotatePoint(px: number, py: number, cx: number, cy: number, deg: number): { x: number; y: number } {
  if (!deg) return { x: px, y: py };
  const rad = (deg * Math.PI) / 180;
  const dx = px - cx;
  const dy = py - cy;
  const rx = dx * Math.cos(rad) - dy * Math.sin(rad);
  const ry = dx * Math.sin(rad) + dy * Math.cos(rad);
  return { x: cx + rx, y: cy + ry };
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

function isGradientPaint(raw: unknown): raw is Record<string, unknown> {
  if (!raw || typeof raw !== "object") return false;
  const candidate = raw as Record<string, unknown>;
  if (!Array.isArray(candidate.stops)) return false;
  const typeName = String(candidate.type || "").toLowerCase();
  return typeName === "gradient" || typeof candidate.gradient_type === "string";
}

function hasGradientPaint(node: SceneSnapshotNode): boolean {
  if (isGradientPaint(node.style?.fill)) return true;
  const rawStroke = node.style?.stroke;
  if (!rawStroke) return false;
  if (typeof rawStroke === "object") {
    const strokeObj = rawStroke as Record<string, unknown>;
    return isGradientPaint(strokeObj.color ?? rawStroke);
  }
  return isGradientPaint(rawStroke);
}

function hasStrokeStack(node: SceneSnapshotNode): boolean {
  const raw = (node.style as Record<string, unknown> | undefined)?.strokes;
  return Array.isArray(raw) && raw.length > 0;
}

function isEllipseRectNode(node: SceneSnapshotNode): boolean {
  if (node.kind !== "rect") return false;
  return String((node.style as any)?.shape_type || "").toLowerCase() === "ellipse";
}

function pushVertex(vertices: number[], x: number, y: number, color: ColorRGBA): void {
  vertices.push(x, y, color[0], color[1], color[2], color[3]);
}

function pushRectTriangles(vertices: number[], node: SceneSnapshotNode, color: ColorRGBA): void {
  const g = node.geometry;
  const x = Number(g.x || 0);
  const y = Number(g.y || 0);
  const w = Math.max(0, Number(g.width || 0));
  const h = Math.max(0, Number(g.height || 0));
  if (w <= 0 || h <= 0) return;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rot = Number(g.rotation || 0);
  const p0 = rotatePoint(x, y, cx, cy, rot);
  const p1 = rotatePoint(x + w, y, cx, cy, rot);
  const p2 = rotatePoint(x + w, y + h, cx, cy, rot);
  const p3 = rotatePoint(x, y + h, cx, cy, rot);
  pushVertex(vertices, p0.x, p0.y, color);
  pushVertex(vertices, p1.x, p1.y, color);
  pushVertex(vertices, p2.x, p2.y, color);
  pushVertex(vertices, p0.x, p0.y, color);
  pushVertex(vertices, p2.x, p2.y, color);
  pushVertex(vertices, p3.x, p3.y, color);
}

function pushLineTriangles(vertices: number[], node: SceneSnapshotNode, color: ColorRGBA, thickness = 1): void {
  const g = node.geometry;
  const x1 = Number(g.x || 0);
  const y1 = Number(g.y || 0);
  const x2 = x1 + Number(g.width || 0);
  const y2 = y1 + Number(g.height || 0);
  const cx = x1 + Number(g.width || 0) / 2;
  const cy = y1 + Number(g.height || 0) / 2;
  const rot = Number(g.rotation || 0);
  const p1 = rotatePoint(x1, y1, cx, cy, rot);
  const p2 = rotatePoint(x2, y2, cx, cy, rot);
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy);
  if (!len) return;
  const nx = (-dy / len) * (thickness / 2);
  const ny = (dx / len) * (thickness / 2);
  const v0 = { x: p1.x - nx, y: p1.y - ny };
  const v1 = { x: p2.x - nx, y: p2.y - ny };
  const v2 = { x: p2.x + nx, y: p2.y + ny };
  const v3 = { x: p1.x + nx, y: p1.y + ny };
  pushVertex(vertices, v0.x, v0.y, color);
  pushVertex(vertices, v1.x, v1.y, color);
  pushVertex(vertices, v2.x, v2.y, color);
  pushVertex(vertices, v0.x, v0.y, color);
  pushVertex(vertices, v2.x, v2.y, color);
  pushVertex(vertices, v3.x, v3.y, color);
}

function hashNodeColorGeometry(node: SceneSnapshotNode): number {
  const g = node.geometry;
  const s = node.style;
  const stroke = strokeFromNode(node);
  let hash = 2166136261 >>> 0;
  const values = [
    node.kind,
    Number(g.x || 0),
    Number(g.y || 0),
    Number(g.width || 0),
    Number(g.height || 0),
    Number(g.rotation || 0),
    Number(g.corner_radius || 0),
    Number(s.opacity ?? 1),
    stableSerialize(s.fill),
    stroke.width,
    stroke.color[0],
    stroke.color[1],
    stroke.color[2],
    stroke.color[3],
    s.visible !== false ? 1 : 0,
  ];
  for (const value of values) {
    const text = String(value);
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
  }
  return hash >>> 0;
}

function buildRectChunk(node: SceneSnapshotNode): Float32Array {
  const color = colorFromNode(node);
  const out: number[] = [];
  pushRectTriangles(out, node, color);
  return new Float32Array(out);
}

function buildLineChunk(node: SceneSnapshotNode): Float32Array {
  const stroke = strokeFromNode(node);
  const out: number[] = [];
  pushLineTriangles(out, node, stroke.color, stroke.width);
  return new Float32Array(out);
}

function imageDimensions(source: CanvasImageSource): { width: number; height: number } {
  const raw = source as any;
  const w = Number(raw.naturalWidth || raw.videoWidth || raw.displayWidth || raw.width || 0);
  const h = Number(raw.naturalHeight || raw.videoHeight || raw.displayHeight || raw.height || 0);
  return { width: Math.max(1, Math.round(w || 1)), height: Math.max(1, Math.round(h || 1)) };
}

function createImageDraw(node: SceneSnapshotNode, source: CanvasImageSource, opacity: number): ImageDraw | null {
  const src = String(node.image_src || "").trim();
  if (!src) return null;
  const g = node.geometry;
  const x = Number(g.x || 0);
  const y = Number(g.y || 0);
  const w = Math.max(0, Number(g.width || 0));
  const h = Math.max(0, Number(g.height || 0));
  if (!w || !h) return null;
  const rot = Number(g.rotation || 0);
  const imageFit = String(node.style.image_fit || "fill").toLowerCase();
  const dim = imageDimensions(source);
  let sx = 0;
  let sy = 0;
  let sw = dim.width;
  let sh = dim.height;
  let dx = x;
  let dy = y;
  let dw = w;
  let dh = h;

  if (imageFit === "crop" && node.style.image_crop) {
    const crop = node.style.image_crop;
    sx = Math.max(0, Math.min(dim.width - 1, Number(crop.x || 0)));
    sy = Math.max(0, Math.min(dim.height - 1, Number(crop.y || 0)));
    sw = Math.max(1, Math.min(dim.width - sx, Number(crop.width || dim.width)));
    sh = Math.max(1, Math.min(dim.height - sy, Number(crop.height || dim.height)));
  } else if (imageFit === "fit") {
    const ratio = Math.min(w / dim.width, h / dim.height);
    dw = dim.width * ratio;
    dh = dim.height * ratio;
    dx = x + (w - dw) / 2;
    dy = y + (h - dh) / 2;
  } else {
    const targetAspect = w / h;
    const imageAspect = dim.width / dim.height;
    if (imageAspect > targetAspect) {
      sh = dim.height;
      sw = sh * targetAspect;
      sx = (dim.width - sw) / 2;
      sy = 0;
    } else {
      sw = dim.width;
      sh = sw / targetAspect;
      sx = 0;
      sy = (dim.height - sh) / 2;
    }
  }

  const u0 = sx / dim.width;
  const v0 = sy / dim.height;
  const u1 = (sx + sw) / dim.width;
  const v1 = (sy + sh) / dim.height;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const p0 = rotatePoint(dx, dy, cx, cy, rot);
  const p1 = rotatePoint(dx + dw, dy, cx, cy, rot);
  const p2 = rotatePoint(dx + dw, dy + dh, cx, cy, rot);
  const p3 = rotatePoint(dx, dy + dh, cx, cy, rot);

  return {
    src,
    opacity: clamp01(opacity),
    p0,
    p1,
    p2,
    p3,
    u0,
    v0,
    u1,
    v1,
  };
}

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("webgl createShader failed");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  const ok = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
  if (!ok) {
    const info = gl.getShaderInfoLog(shader) || "shader compile failed";
    gl.deleteShader(shader);
    throw new Error(info);
  }
  return shader;
}

function createProgram(gl: WebGLRenderingContext, vertexSource: string, fragmentSource: string): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    throw new Error("webgl createProgram failed");
  }
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  const ok = gl.getProgramParameter(program, gl.LINK_STATUS);
  if (!ok) {
    const info = gl.getProgramInfoLog(program) || "program link failed";
    gl.deleteProgram(program);
    throw new Error(info);
  }
  return program;
}

function colorFromNode(node: SceneSnapshotNode): ColorRGBA {
  const base = colorToRgba(node.style.fill, [0, 0, 0, 0]);
  const alpha = clamp01(Number(node.style.opacity ?? 1));
  return [base[0], base[1], base[2], clamp01(base[3] * alpha)];
}

function strokeFromNode(node: SceneSnapshotNode): { color: ColorRGBA; width: number } {
  const raw = node.style.stroke as any;
  if (!raw) {
    return { color: colorFromNode(node), width: 1 };
  }
  if (typeof raw === "object") {
    const color = colorToRgba(raw.color ?? raw, [0, 0, 0, 1]);
    const alpha = clamp01(Number(node.style.opacity ?? 1));
    return {
      color: [color[0], color[1], color[2], clamp01(color[3] * alpha)],
      width: Math.max(1, Number(raw.width || 1)),
    };
  }
  const color = colorToRgba(raw, [0, 0, 0, 1]);
  const alpha = clamp01(Number(node.style.opacity ?? 1));
  return {
    color: [color[0], color[1], color[2], clamp01(color[3] * alpha)],
    width: 1,
  };
}

export class WebGLRendererBackend implements RendererBackend {
  readonly kind = "webgl-v1";
  private canvas: HTMLCanvasElement | null = null;
  private gl: WebGLRenderingContext | null = null;
  private colorProgram: WebGLProgram | null = null;
  private textureProgram: WebGLProgram | null = null;
  private colorBuffer: WebGLBuffer | null = null;
  private textureBuffer: WebGLBuffer | null = null;
  private colorLoc = { position: -1, color: -1, resolution: null as WebGLUniformLocation | null };
  private texLoc = {
    position: -1,
    uv: -1,
    resolution: null as WebGLUniformLocation | null,
    sampler: null as WebGLUniformLocation | null,
    opacity: null as WebGLUniformLocation | null,
  };
  private textureCache = new Map<string, TextureEntry>();
  private totalTextureBytes = 0;
  private colorChunkCache = new Map<string, ColorChunkEntry>();
  private colorFrameData: Float32Array | null = null;
  private colorFrameRanges = new Map<string, ColorFrameRange>();
  private colorFrameOrder: string[] = [];
  private colorFrameFloats = 0;
  private lastStats: RenderBackendFrameStats | null = null;

  static isSupported(): boolean {
    if (typeof document === "undefined") return false;
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl") ||
      canvas.getContext("experimental-webgl")) as WebGLRenderingContext | null;
    return !!gl;
  }

  canRenderScene(snapshot: SceneSnapshot, imageCache?: Map<string, CanvasImageSource>): RenderBackendSupport {
    if (isGradientPaint(snapshot.canvas.background)) {
      return { supported: false, reason: "gradient_canvas_background" };
    }
    for (const node of snapshot.nodes) {
      if (node.geometry?.clip) {
        return { supported: false, reason: "clip_geometry" };
      }
      if (node.style?.visible === false) continue;
      if (!SUPPORTED_KINDS.has(String(node.kind))) {
        return { supported: false, reason: `unsupported_kind:${node.kind}` };
      }
      if (hasGradientPaint(node)) {
        return { supported: false, reason: "gradient_paint" };
      }
      if (hasStrokeStack(node)) {
        return { supported: false, reason: "stroke_stack" };
      }
      if (isEllipseRectNode(node)) {
        return { supported: false, reason: "ellipse" };
      }
      if (Number(node.geometry.corner_radius || 0) > 0) {
        return { supported: false, reason: "corner_radius" };
      }
      if (node.style?.mask) return { supported: false, reason: "mask" };
      if (Array.isArray(node.style?.effects) && node.style.effects.length) {
        return { supported: false, reason: "effects" };
      }
      if (Array.isArray((node.style as any)?.image_brush_strokes) && (node.style as any).image_brush_strokes.length > 0) {
        return { supported: false, reason: "image_brush" };
      }
      if (node.kind === "frame") {
        return { supported: false, reason: "frame" };
      }
      if (node.kind === "image") {
        const src = String(node.image_src || "").trim();
        if (!src) continue;
        if (!imageCache || !imageCache.get(src)) return { supported: false, reason: "image_not_loaded" };
      }
      if (node.kind === "text") return { supported: false, reason: "text" };
    }
    return { supported: true };
  }

  private clearProgramsAndBuffers(): void {
    const gl = this.gl;
    if (!gl) return;
    if (this.colorBuffer) gl.deleteBuffer(this.colorBuffer);
    if (this.textureBuffer) gl.deleteBuffer(this.textureBuffer);
    if (this.colorProgram) gl.deleteProgram(this.colorProgram);
    if (this.textureProgram) gl.deleteProgram(this.textureProgram);
    this.colorBuffer = null;
    this.textureBuffer = null;
    this.colorProgram = null;
    this.textureProgram = null;
    this.colorLoc = { position: -1, color: -1, resolution: null };
    this.texLoc = { position: -1, uv: -1, resolution: null, sampler: null, opacity: null };
  }

  private clearTextures(): void {
    const gl = this.gl;
    if (!gl) return;
    for (const entry of this.textureCache.values()) {
      gl.deleteTexture(entry.texture);
    }
    this.textureCache.clear();
    this.totalTextureBytes = 0;
  }

  private ensureContext(canvas: HTMLCanvasElement): WebGLRenderingContext {
    if (this.canvas === canvas && this.gl && this.colorProgram && this.textureProgram && this.colorBuffer && this.textureBuffer) {
      return this.gl;
    }
    if (this.gl) {
      this.clearTextures();
      this.clearProgramsAndBuffers();
    }
    this.canvas = canvas;
    const gl =
      (canvas.getContext("webgl", {
        alpha: true,
        antialias: true,
        preserveDrawingBuffer: false,
        premultipliedAlpha: true,
        desynchronized: true,
      }) as WebGLRenderingContext | null) ||
      (canvas.getContext("experimental-webgl") as WebGLRenderingContext | null);
    if (!gl) throw new Error("webgl context unavailable");

    const colorProgram = createProgram(
      gl,
      `
      attribute vec2 a_position;
      attribute vec4 a_color;
      uniform vec2 u_resolution;
      varying vec4 v_color;
      void main() {
        vec2 zeroToOne = a_position / u_resolution;
        vec2 zeroToTwo = zeroToOne * 2.0;
        vec2 clipSpace = zeroToTwo - 1.0;
        gl_Position = vec4(clipSpace * vec2(1.0, -1.0), 0.0, 1.0);
        v_color = a_color;
      }
      `,
      `
      precision mediump float;
      varying vec4 v_color;
      void main() {
        gl_FragColor = v_color;
      }
      `
    );
    const textureProgram = createProgram(
      gl,
      `
      attribute vec2 a_position;
      attribute vec2 a_texcoord;
      uniform vec2 u_resolution;
      varying vec2 v_texcoord;
      void main() {
        vec2 zeroToOne = a_position / u_resolution;
        vec2 zeroToTwo = zeroToOne * 2.0;
        vec2 clipSpace = zeroToTwo - 1.0;
        gl_Position = vec4(clipSpace * vec2(1.0, -1.0), 0.0, 1.0);
        v_texcoord = a_texcoord;
      }
      `,
      `
      precision mediump float;
      varying vec2 v_texcoord;
      uniform sampler2D u_texture;
      uniform float u_opacity;
      void main() {
        vec4 tex = texture2D(u_texture, v_texcoord);
        gl_FragColor = vec4(tex.rgb, tex.a * u_opacity);
      }
      `
    );

    const colorBuffer = gl.createBuffer();
    const textureBuffer = gl.createBuffer();
    if (!colorBuffer || !textureBuffer) {
      gl.deleteProgram(colorProgram);
      gl.deleteProgram(textureProgram);
      throw new Error("webgl buffer allocation failed");
    }

    this.gl = gl;
    this.colorProgram = colorProgram;
    this.textureProgram = textureProgram;
    this.colorBuffer = colorBuffer;
    this.textureBuffer = textureBuffer;
    this.colorLoc = {
      position: gl.getAttribLocation(colorProgram, "a_position"),
      color: gl.getAttribLocation(colorProgram, "a_color"),
      resolution: gl.getUniformLocation(colorProgram, "u_resolution"),
    };
    this.texLoc = {
      position: gl.getAttribLocation(textureProgram, "a_position"),
      uv: gl.getAttribLocation(textureProgram, "a_texcoord"),
      resolution: gl.getUniformLocation(textureProgram, "u_resolution"),
      sampler: gl.getUniformLocation(textureProgram, "u_texture"),
      opacity: gl.getUniformLocation(textureProgram, "u_opacity"),
    };
    return gl;
  }

  private ensureTexture(src: string, image: CanvasImageSource): TextureEntry | null {
    const gl = this.gl;
    if (!gl) return null;
    const now = Date.now();
    const existing = this.textureCache.get(src);
    if (existing) {
      existing.lastUsedAt = now;
      return existing;
    }
    const texture = gl.createTexture();
    if (!texture) return null;
    const dim = imageDimensions(image);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image as TexImageSource);
    const bytes = dim.width * dim.height * 4;
    const entry: TextureEntry = {
      texture,
      width: dim.width,
      height: dim.height,
      bytes,
      lastUsedAt: now,
    };
    this.textureCache.set(src, entry);
    this.totalTextureBytes += bytes;
    this.evictTexturesIfNeeded();
    return entry;
  }

  private evictTexturesIfNeeded(): void {
    const gl = this.gl;
    if (!gl) return;
    if (this.totalTextureBytes <= TEXTURE_BUDGET_BYTES) return;
    const sorted = Array.from(this.textureCache.entries()).sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt);
    for (const [key, entry] of sorted) {
      if (this.totalTextureBytes <= TEXTURE_BUDGET_BYTES) break;
      gl.deleteTexture(entry.texture);
      this.textureCache.delete(key);
      this.totalTextureBytes = Math.max(0, this.totalTextureBytes - entry.bytes);
    }
  }

  private hasSameColorOrder(nodeIds: readonly string[]): boolean {
    if (this.colorFrameOrder.length !== nodeIds.length) return false;
    for (let i = 0; i < nodeIds.length; i += 1) {
      if (this.colorFrameOrder[i] !== nodeIds[i]) return false;
    }
    return true;
  }

  async renderFrame(input: RenderFrameInput): Promise<void> {
    const { canvas, snapshot, pixelRatio, imageCache } = input;
    const gl = this.ensureContext(canvas);
    const w = Math.max(1, Math.round(snapshot.canvas.width));
    const h = Math.max(1, Math.round(snapshot.canvas.height));
    const pr = Math.max(1, Number(pixelRatio || 1));
    const targetW = Math.max(1, Math.round(w * pr));
    const targetH = Math.max(1, Math.round(h * pr));
    if (canvas.width !== targetW) canvas.width = targetW;
    if (canvas.height !== targetH) canvas.height = targetH;

    gl.viewport(0, 0, targetW, targetH);
    if (isGradientPaint(snapshot.canvas.background)) {
      throw new Error("webgl canvas gradient unsupported");
    }
    const bg = colorToRgba(snapshot.canvas.background, [0.95, 0.925, 0.89, 1]);
    gl.clearColor(bg[0], bg[1], bg[2], bg[3]);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const imageDraws: ImageDraw[] = [];
    const seenColorIds = new Set<string>();
    const colorChunks: Float32Array[] = [];
    const colorNodeIds: string[] = [];
    const colorNodeHashes: number[] = [];
    let totalColorFloats = 0;
    const nodeById = new Map(snapshot.nodes.map((node) => [node.id, node] as const));
    const effectiveOpacityById = new Map<string, number>();
    const resolveEffectiveOpacity = (node: SceneSnapshotNode): number => {
      const cached = effectiveOpacityById.get(node.id);
      if (cached != null) return cached;
      let opacity = clamp01(Number(node.style?.opacity ?? 1));
      const seen = new Set<string>();
      let cursorId: string | null = String(node.parent_id || "").trim() || null;
      while (cursorId) {
        if (seen.has(cursorId)) break;
        seen.add(cursorId);
        const parent = nodeById.get(cursorId) || null;
        if (!parent) break;
        opacity *= clamp01(Number(parent.style?.opacity ?? 1));
        cursorId = String(parent.parent_id || "").trim() || null;
      }
      const resolved = clamp01(opacity);
      effectiveOpacityById.set(node.id, resolved);
      return resolved;
    };

    for (const node of snapshot.nodes) {
      if (node.style?.visible === false) continue;
      const effectiveOpacity = resolveEffectiveOpacity(node);
      if (effectiveOpacity <= 0.0001) continue;
      const rawNodeOpacity = clamp01(Number(node.style?.opacity ?? 1));
      const effectiveNode = Math.abs(effectiveOpacity - rawNodeOpacity) <= 0.000001
        ? node
        : {
          ...node,
          style: {
            ...node.style,
            opacity: effectiveOpacity,
          },
        };
      if (!SUPPORTED_KINDS.has(String(effectiveNode.kind))) {
        throw new Error(`unsupported kind for webgl: ${effectiveNode.kind}`);
      }
      if (hasGradientPaint(effectiveNode)) {
        throw new Error("webgl gradient paint unsupported");
      }
      if (hasStrokeStack(effectiveNode)) {
        throw new Error("webgl stroke stack unsupported");
      }
      if (isEllipseRectNode(effectiveNode)) {
        throw new Error("webgl ellipse unsupported");
      }
      if (Number(effectiveNode.geometry.corner_radius || 0) > 0) {
        throw new Error("webgl corner radius unsupported");
      }
      if (effectiveNode.style?.mask) throw new Error("webgl mask unsupported");
      if (Array.isArray(effectiveNode.style?.effects) && effectiveNode.style.effects.length) {
        throw new Error("webgl effects unsupported");
      }
      if (Array.isArray((effectiveNode.style as any)?.image_brush_strokes) && (effectiveNode.style as any).image_brush_strokes.length > 0) {
        throw new Error("webgl image brush unsupported");
      }

      if (effectiveNode.kind === "line") {
        const hash = hashNodeColorGeometry(effectiveNode);
        const cached = this.colorChunkCache.get(effectiveNode.id);
        const chunk = cached && cached.hash === hash ? cached.verts : buildLineChunk(effectiveNode);
        if (!cached || cached.hash !== hash) {
          this.colorChunkCache.set(effectiveNode.id, { hash, verts: chunk });
        }
        seenColorIds.add(effectiveNode.id);
        colorNodeIds.push(effectiveNode.id);
        colorNodeHashes.push(hash);
        if (chunk.length) {
          colorChunks.push(chunk);
          totalColorFloats += chunk.length;
        }
        continue;
      }

      if (effectiveNode.kind === "frame") {
        throw new Error("webgl frame unsupported");
      }

      if (effectiveNode.kind === "image") {
        const src = String(effectiveNode.image_src || "").trim();
        if (!src) continue;
        const source = imageCache?.get(src);
        if (!source) continue;
        const draw = createImageDraw(effectiveNode, source, effectiveOpacity);
        if (draw) imageDraws.push(draw);
        continue;
      }

      const hash = hashNodeColorGeometry(effectiveNode);
      const cached = this.colorChunkCache.get(effectiveNode.id);
      const chunk = cached && cached.hash === hash ? cached.verts : buildRectChunk(effectiveNode);
      if (!cached || cached.hash !== hash) {
        this.colorChunkCache.set(effectiveNode.id, { hash, verts: chunk });
      }
      seenColorIds.add(effectiveNode.id);
      colorNodeIds.push(effectiveNode.id);
      colorNodeHashes.push(hash);
      if (chunk.length) {
        colorChunks.push(chunk);
        totalColorFloats += chunk.length;
      }
    }

    if (this.colorChunkCache.size) {
      const stale: string[] = [];
      for (const id of this.colorChunkCache.keys()) {
        if (!seenColorIds.has(id)) stale.push(id);
      }
      for (const id of stale) this.colorChunkCache.delete(id);
    }

    let drawCalls = 0;
    let triangles = 0;

    if (totalColorFloats > 0) {
      if (!this.colorProgram || !this.colorBuffer) throw new Error("webgl color pipeline unavailable");
      gl.useProgram(this.colorProgram);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);

      const fullRebuild =
        !this.colorFrameData ||
        this.colorFrameFloats !== totalColorFloats ||
        this.colorFrameRanges.size !== colorNodeIds.length ||
        !this.hasSameColorOrder(colorNodeIds);

      if (fullRebuild) {
        const frameData = new Float32Array(totalColorFloats);
        const ranges = new Map<string, ColorFrameRange>();
        let offset = 0;
        for (let i = 0; i < colorNodeIds.length; i += 1) {
          const nodeId = colorNodeIds[i];
          const chunk = colorChunks[i];
          const hash = colorNodeHashes[i];
          if (chunk.length) frameData.set(chunk, offset);
          ranges.set(nodeId, { offset, length: chunk.length, hash });
          offset += chunk.length;
        }
        this.colorFrameData = frameData;
        this.colorFrameRanges = ranges;
        this.colorFrameOrder = [...colorNodeIds];
        this.colorFrameFloats = totalColorFloats;
        gl.bufferData(gl.ARRAY_BUFFER, frameData, gl.DYNAMIC_DRAW);
      } else {
        const updates: ColorFrameUpdate[] = [];
        let changedFloats = 0;
        for (let i = 0; i < colorNodeIds.length; i += 1) {
          const nodeId = colorNodeIds[i];
          const chunk = colorChunks[i];
          const hash = colorNodeHashes[i];
          const range = this.colorFrameRanges.get(nodeId);
          if (!range) continue;
          if (range.hash === hash && range.length === chunk.length) continue;
          range.hash = hash;
          range.length = chunk.length;
          if (chunk.length && this.colorFrameData) this.colorFrameData.set(chunk, range.offset);
          updates.push({ offset: range.offset, chunk });
          changedFloats += chunk.length;
        }

        if (updates.length > 0) {
          if (!this.colorFrameData || changedFloats >= totalColorFloats * 0.45 || updates.length >= 200) {
            if (this.colorFrameData) {
              gl.bufferData(gl.ARRAY_BUFFER, this.colorFrameData, gl.DYNAMIC_DRAW);
            }
          } else {
            for (const update of updates) {
              if (!update.chunk.length) continue;
              gl.bufferSubData(gl.ARRAY_BUFFER, update.offset * 4, update.chunk);
            }
          }
        }
      }
      gl.enableVertexAttribArray(this.colorLoc.position);
      gl.vertexAttribPointer(this.colorLoc.position, 2, gl.FLOAT, false, 24, 0);
      gl.enableVertexAttribArray(this.colorLoc.color);
      gl.vertexAttribPointer(this.colorLoc.color, 4, gl.FLOAT, false, 24, 8);
      gl.uniform2f(this.colorLoc.resolution, w, h);
      const vertCount = totalColorFloats / 6;
      gl.drawArrays(gl.TRIANGLES, 0, vertCount);
      drawCalls += 1;
      triangles += Math.floor(vertCount / 3);
    }

    if (imageDraws.length) {
      if (!this.textureProgram || !this.textureBuffer) throw new Error("webgl texture pipeline unavailable");
      gl.useProgram(this.textureProgram);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.textureBuffer);
      gl.enableVertexAttribArray(this.texLoc.position);
      gl.enableVertexAttribArray(this.texLoc.uv);
      gl.uniform2f(this.texLoc.resolution, w, h);
      gl.uniform1i(this.texLoc.sampler, 0);

      for (const imageDraw of imageDraws) {
        const source = imageCache?.get(imageDraw.src);
        if (!source) continue;
        const textureEntry = this.ensureTexture(imageDraw.src, source);
        if (!textureEntry) continue;
        const verts = new Float32Array([
          imageDraw.p0.x,
          imageDraw.p0.y,
          imageDraw.u0,
          imageDraw.v0,
          imageDraw.p1.x,
          imageDraw.p1.y,
          imageDraw.u1,
          imageDraw.v0,
          imageDraw.p2.x,
          imageDraw.p2.y,
          imageDraw.u1,
          imageDraw.v1,
          imageDraw.p0.x,
          imageDraw.p0.y,
          imageDraw.u0,
          imageDraw.v0,
          imageDraw.p2.x,
          imageDraw.p2.y,
          imageDraw.u1,
          imageDraw.v1,
          imageDraw.p3.x,
          imageDraw.p3.y,
          imageDraw.u0,
          imageDraw.v1,
        ]);
        gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
        gl.vertexAttribPointer(this.texLoc.position, 2, gl.FLOAT, false, 16, 0);
        gl.vertexAttribPointer(this.texLoc.uv, 2, gl.FLOAT, false, 16, 8);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, textureEntry.texture);
        gl.uniform1f(this.texLoc.opacity, imageDraw.opacity);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        drawCalls += 1;
        triangles += 2;
      }
    }

    this.lastStats = {
      backend: this.kind,
      drawCalls,
      triangles,
      gpuMemoryBytes: this.totalTextureBytes,
      fallbackReason: null,
    };
  }

  getLastFrameStats(): RenderBackendFrameStats | null {
    return this.lastStats;
  }

  dispose(): void {
    if (this.gl) {
      this.clearTextures();
      this.clearProgramsAndBuffers();
    }
    this.gl = null;
    this.canvas = null;
    this.colorChunkCache.clear();
    this.colorFrameData = null;
    this.colorFrameRanges.clear();
    this.colorFrameOrder = [];
    this.colorFrameFloats = 0;
    this.lastStats = null;
  }
}
