import { paintSceneSnapshotToContext } from "../canvas2dPainter";
import type { RenderBackendFrameStats, RenderFrameInput, RendererBackend } from "./rendererBackend";

export class Canvas2DRendererBackend implements RendererBackend {
  readonly kind = "canvas2d-main-v2";
  private readonly textMetricsCache = new Map<string, number>();
  private lastStats: RenderBackendFrameStats | null = null;

  async renderFrame(input: RenderFrameInput): Promise<void> {
    const { canvas, snapshot, pixelRatio, dirtyRegions, imageCache } = input;
    const w = Math.max(1, Math.round(snapshot.canvas.width));
    const h = Math.max(1, Math.round(snapshot.canvas.height));
    const pr = Math.max(1, Number(pixelRatio || 1));

    const nextW = Math.round(w * pr);
    const nextH = Math.round(h * pr);
    if (canvas.width !== nextW) canvas.width = nextW;
    if (canvas.height !== nextH) canvas.height = nextH;

    const ctx = canvas.getContext("2d", { alpha: true, desynchronized: true });
    if (!ctx) throw new Error("2d context unavailable");

    paintSceneSnapshotToContext(ctx, snapshot, {
      width: w,
      height: h,
      pixelRatio: pr,
      dirtyRegions,
      imageCache,
      textMetricsCache: this.textMetricsCache,
    });
    this.lastStats = {
      backend: this.kind,
      drawCalls: 0,
      triangles: 0,
      gpuMemoryBytes: 0,
      fallbackReason: null,
    };
  }

  getLastFrameStats(): RenderBackendFrameStats | null {
    return this.lastStats;
  }

  dispose(): void {
    this.textMetricsCache.clear();
    this.lastStats = null;
  }
}
