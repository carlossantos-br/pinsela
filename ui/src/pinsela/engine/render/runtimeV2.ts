import type { GuideLine } from "../../core/layout";
import type { PinselaTemplateDocV1 } from "../../core/types";
import { computeDirtyRegions } from "./invalidations";
import { createSceneSnapshot } from "./snapshot";
import { Canvas2DRendererBackend } from "./backends/canvas2dRendererBackend";
import { OffscreenWorkerRendererBackend } from "./backends/offscreenWorkerRendererBackend";
import { WebGLRendererBackend } from "./backends/webglRendererBackend";
import type { RenderBackendFrameStats, RendererBackend } from "./backends/rendererBackend";

type RenderRuntimeV2Options = {
  offscreenPreferred: boolean;
  webglPreferred?: boolean;
  webglAutoMinNodes?: number;
  forceBackend?: "auto" | "canvas2d" | "offscreen" | "webgl";
};

type RenderRuntimeFrameInput = {
  canvas: HTMLCanvasElement;
  doc: PinselaTemplateDocV1;
  guides: GuideLine[];
  selectionBounds: { x: number; y: number; w: number; h: number } | null;
  pixelRatio: number;
  imageCache?: Map<string, CanvasImageSource>;
  assetVersion?: number;
};

function isOffscreenRuntimeSupported(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof Worker === "undefined") return false;
  if (typeof HTMLCanvasElement === "undefined") return false;
  return "transferControlToOffscreen" in HTMLCanvasElement.prototype;
}

export class RenderRuntimeV2 {
  private readonly canvasBackend = new Canvas2DRendererBackend();
  private readonly offscreenBackend: OffscreenWorkerRendererBackend | null;
  private readonly webglBackend: WebGLRendererBackend | null;
  private readonly offscreenPreferred: boolean;
  private readonly webglPreferred: boolean;
  private readonly webglAutoMinNodes: number;
  private readonly forceBackend: "auto" | "canvas2d" | "offscreen" | "webgl";
  private activeBackend: RendererBackend;
  private activeFallbackReason: string | null = null;
  private previousSnapshot: ReturnType<typeof createSceneSnapshot> | null = null;
  private lastAssetVersion: number | null = null;
  private lastPixelRatio: number | null = null;
  private lastCanvas: HTMLCanvasElement | null = null;
  private lastFrameStats: RenderBackendFrameStats | null = null;

  constructor(opts: RenderRuntimeV2Options) {
    this.offscreenPreferred = !!opts.offscreenPreferred;
    this.webglPreferred = !!opts.webglPreferred;
    this.webglAutoMinNodes = Math.max(100, Number(opts.webglAutoMinNodes || 900));
    this.forceBackend = opts.forceBackend || "auto";
    this.offscreenBackend =
      this.offscreenPreferred && isOffscreenRuntimeSupported() ? new OffscreenWorkerRendererBackend() : null;
    this.webglBackend = this.webglPreferred && WebGLRendererBackend.isSupported() ? new WebGLRendererBackend() : null;
    this.activeBackend = this.canvasBackend;
    this.refreshActiveBackend();
  }

  getActiveBackendKind(): string {
    return this.activeBackend.kind;
  }

  getLastFrameStats(): RenderBackendFrameStats | null {
    return this.lastFrameStats;
  }

  private refreshActiveBackend(): void {
    if (this.forceBackend === "canvas2d") {
      this.activeBackend = this.canvasBackend;
      return;
    }
    if (this.forceBackend === "offscreen" && this.offscreenBackend) {
      this.activeBackend = this.offscreenBackend;
      return;
    }
    if (this.forceBackend === "webgl" && this.webglBackend) {
      this.activeBackend = this.webglBackend;
      return;
    }
    if (this.webglPreferred && this.webglBackend) {
      this.activeBackend = this.webglBackend;
      return;
    }
    if (this.offscreenPreferred && this.offscreenBackend) {
      this.activeBackend = this.offscreenBackend;
      return;
    }
    this.activeBackend = this.canvasBackend;
  }

  private chooseBackend(
    snapshot: ReturnType<typeof createSceneSnapshot>,
    input: RenderRuntimeFrameInput
  ): RendererBackend {
    this.activeFallbackReason = null;
    if (this.forceBackend === "canvas2d") return this.canvasBackend;
    if (this.forceBackend === "offscreen") return this.offscreenBackend || this.canvasBackend;
    if (this.forceBackend === "webgl") {
      if (!this.webglBackend) {
        this.activeFallbackReason = "webgl_unavailable";
        return this.canvasBackend;
      }
      const support = this.webglBackend.canRenderScene
        ? this.webglBackend.canRenderScene(snapshot, input.imageCache)
        : { supported: true };
      if (!support.supported) {
        this.activeFallbackReason = support.reason || "webgl_unsupported_scene";
        return this.canvasBackend;
      }
      return this.webglBackend;
    }

    if (this.webglPreferred && this.webglBackend) {
      if (snapshot.nodes.length >= this.webglAutoMinNodes) {
        const support = this.webglBackend.canRenderScene
          ? this.webglBackend.canRenderScene(snapshot, input.imageCache)
          : { supported: true };
        if (support.supported) return this.webglBackend;
        this.activeFallbackReason = support.reason || "webgl_unsupported_scene";
      } else {
        this.activeFallbackReason = "below_webgl_threshold";
      }
    }

    if (this.offscreenPreferred && this.offscreenBackend) return this.offscreenBackend;
    return this.canvasBackend;
  }

  async renderFrame(input: RenderRuntimeFrameInput): Promise<void> {
    if (this.lastCanvas && this.lastCanvas !== input.canvas) {
      this.previousSnapshot = null;
      this.lastAssetVersion = null;
      this.lastPixelRatio = null;
    }
    this.lastCanvas = input.canvas;
    this.refreshActiveBackend();

    const snapshot = createSceneSnapshot({
      doc: input.doc,
      guides: input.guides,
      selectionBounds: input.selectionBounds,
    });

    let dirtyRegions = computeDirtyRegions(this.previousSnapshot, snapshot);
    if (input.assetVersion !== undefined) {
      if (this.lastAssetVersion === null || input.assetVersion !== this.lastAssetVersion) {
        dirtyRegions = null;
      }
      this.lastAssetVersion = input.assetVersion;
    }
    // When the render scale changes (Retina DPR, zoom-settle pixelRatio boost),
    // the backend resizes/clears the canvas — a partial dirty-region repaint then
    // leaves stale/ghosted content (visible especially at devicePixelRatio 2).
    // Force a full repaint on any pixelRatio change.
    const framePixelRatio = Math.max(1, Number(input.pixelRatio || 1));
    if (this.lastPixelRatio === null || framePixelRatio !== this.lastPixelRatio) {
      dirtyRegions = null;
    }
    this.lastPixelRatio = framePixelRatio;

    // Page switch / artboard resize: when the canvas dimensions change, the
    // previous snapshot describes a different page, so a partial dirty-region
    // repaint would leave the old page's content ghosted. Force a full repaint.
    const prevCanvas = (this.previousSnapshot as { canvas?: { width?: number; height?: number } } | null)?.canvas;
    const nextCanvas = (snapshot as { canvas?: { width?: number; height?: number } }).canvas;
    if (
      prevCanvas && nextCanvas
      && (prevCanvas.width !== nextCanvas.width || prevCanvas.height !== nextCanvas.height)
    ) {
      dirtyRegions = null;
    }

    if (dirtyRegions && dirtyRegions.length === 0) {
      this.previousSnapshot = snapshot;
      return;
    }

    const backend = this.chooseBackend(snapshot, input);
    this.activeBackend = backend;

    try {
      await backend.renderFrame({
        canvas: input.canvas,
        snapshot,
        pixelRatio: Math.max(1, Number(input.pixelRatio || 1)),
        dirtyRegions,
        imageCache: input.imageCache,
      });
      const baseStats = backend.getLastFrameStats?.() || {
        backend: backend.kind,
        drawCalls: 0,
        triangles: 0,
        gpuMemoryBytes: 0,
        fallbackReason: null,
      };
      this.lastFrameStats = {
        ...baseStats,
        fallbackReason: this.activeFallbackReason || baseStats.fallbackReason || null,
      };
    } catch {
      if (backend !== this.canvasBackend && backend !== this.offscreenBackend) {
        await this.canvasBackend.renderFrame({
          canvas: input.canvas,
          snapshot,
          pixelRatio: Math.max(1, Number(input.pixelRatio || 1)),
          dirtyRegions: null,
          imageCache: input.imageCache,
        });
        const baseStats = this.canvasBackend.getLastFrameStats?.() || {
          backend: this.canvasBackend.kind,
          drawCalls: 0,
          triangles: 0,
          gpuMemoryBytes: 0,
          fallbackReason: null,
        };
        this.lastFrameStats = {
          ...baseStats,
          fallbackReason: `runtime_fallback:${backend.kind}`,
        };
      } else if (backend === this.offscreenBackend) {
        throw new Error("render failed in offscreen backend");
      } else {
        throw new Error("render failed in canvas backend");
      }
    }

    this.previousSnapshot = snapshot;
  }

  dispose(): void {
    this.offscreenBackend?.dispose();
    this.webglBackend?.dispose();
    this.canvasBackend.dispose();
    this.previousSnapshot = null;
    this.lastAssetVersion = null;
    this.lastPixelRatio = null;
    this.lastCanvas = null;
    this.lastFrameStats = null;
    this.activeFallbackReason = null;
  }
}

export function createRenderRuntimeV2(opts: RenderRuntimeV2Options): RenderRuntimeV2 {
  return new RenderRuntimeV2(opts);
}
