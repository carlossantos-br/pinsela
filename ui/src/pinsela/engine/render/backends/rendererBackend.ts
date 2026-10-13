import type { DirtyRegion, SceneSnapshot } from "../types";

export type RenderFrameInput = {
  canvas: HTMLCanvasElement;
  snapshot: SceneSnapshot;
  pixelRatio: number;
  dirtyRegions: DirtyRegion[] | null;
  imageCache?: Map<string, CanvasImageSource>;
};

export type RenderBackendSupport = {
  supported: boolean;
  reason?: string;
};

export type RenderBackendFrameStats = {
  backend: string;
  drawCalls: number;
  triangles: number;
  gpuMemoryBytes: number;
  fallbackReason: string | null;
};

export interface RendererBackend {
  readonly kind: string;
  canRenderScene?(snapshot: SceneSnapshot, imageCache?: Map<string, CanvasImageSource>): RenderBackendSupport;
  renderFrame(input: RenderFrameInput): Promise<void>;
  getLastFrameStats?(): RenderBackendFrameStats | null;
  dispose(): void;
}
