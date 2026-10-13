import {
  createRenderRequestId,
  type RenderWorkerRequest,
  type RenderWorkerResponse,
  type RenderWorkerSuccessResponse,
} from "../../workers/renderProtocol";
import type { RenderBackendFrameStats, RenderFrameInput, RendererBackend } from "./rendererBackend";

type PendingRequest = {
  timer: number;
  resolve: (response: RenderWorkerResponse) => void;
  reject: (reason?: unknown) => void;
};

type OffscreenCanvasTransferTarget = HTMLCanvasElement & {
  transferControlToOffscreen?: () => OffscreenCanvas;
};

export class OffscreenWorkerRendererBackend implements RendererBackend {
  readonly kind = "offscreen-worker-v2";

  private worker: Worker | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private initializedCanvas: HTMLCanvasElement | null = null;
  private disposed = false;
  private inFlightRender = false;
  private pendingRenderPayload: {
    snapshot: RenderFrameInput["snapshot"];
    pixelRatio: number;
    dirtyRegions: RenderFrameInput["dirtyRegions"];
  } | null = null;
  private fatalRenderError: Error | null = null;
  private lastStats: RenderBackendFrameStats | null = null;

  private ensureWorker(): Worker {
    if (this.disposed) throw new Error("offscreen backend disposed");
    if (this.worker) return this.worker;
    const worker = new Worker(new URL("../../workers/render.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<RenderWorkerResponse>) => {
      const response = event.data;
      const entry = this.pending.get(response.id);
      if (!entry) return;
      this.pending.delete(response.id);
      clearTimeout(entry.timer);
      entry.resolve(response);
    };
    worker.onerror = (event: ErrorEvent) => {
      this.failPending(new Error(event.message || "render worker error"));
    };
    this.worker = worker;
    return worker;
  }

  private failPending(reason: unknown): void {
    this.pending.forEach((entry) => {
      clearTimeout(entry.timer);
      entry.reject(reason);
    });
    this.pending.clear();
  }

  private async request(
    req: Omit<RenderWorkerRequest, "id">,
    transferList?: Transferable[]
  ): Promise<RenderWorkerSuccessResponse> {
    const worker = this.ensureWorker();
    const id = createRenderRequestId();
    const withId = { ...req, id } as RenderWorkerRequest;
    const response = await new Promise<RenderWorkerResponse>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`render worker timeout: ${req.type}`));
      }, 8000);
      this.pending.set(id, { timer, resolve, reject });
      if (transferList?.length) worker.postMessage(withId, transferList);
      else worker.postMessage(withId);
    });
    if (!response.ok) throw new Error(response.error || `render worker request failed: ${req.type}`);
    return response;
  }

  private async ensureInitialized(canvas: HTMLCanvasElement, pixelRatio: number): Promise<void> {
    if (this.initializedCanvas === canvas) return;
    if (this.initializedCanvas && this.initializedCanvas !== canvas) {
      throw new Error("offscreen renderer already bound to a different canvas instance");
    }
    const target = canvas as OffscreenCanvasTransferTarget;
    if (typeof target.transferControlToOffscreen !== "function") {
      throw new Error("transferControlToOffscreen is unavailable");
    }
    const offscreen = target.transferControlToOffscreen();
    await this.request(
      {
        type: "init",
        payload: {
          canvas: offscreen,
          pixelRatio: Math.max(1, Number(pixelRatio || 1)),
        },
      },
      [offscreen]
    );
    this.initializedCanvas = canvas;
  }

  async renderFrame(input: RenderFrameInput): Promise<void> {
    if (this.fatalRenderError) throw this.fatalRenderError;
    const { canvas, snapshot, pixelRatio, dirtyRegions } = input;
    await this.ensureInitialized(canvas, pixelRatio);
    this.pendingRenderPayload = {
      snapshot,
      pixelRatio: Math.max(1, Number(pixelRatio || 1)),
      dirtyRegions,
    };
    if (this.inFlightRender) return;
    this.inFlightRender = true;
    void this.drainRenderQueue();
  }

  private async drainRenderQueue(): Promise<void> {
    try {
      while (!this.disposed && this.pendingRenderPayload) {
        const payload = this.pendingRenderPayload;
        this.pendingRenderPayload = null;
        await this.request({
          type: "render",
          payload,
        });
        this.lastStats = {
          backend: this.kind,
          drawCalls: 0,
          triangles: 0,
          gpuMemoryBytes: 0,
          fallbackReason: null,
        };
      }
    } catch (err) {
      this.fatalRenderError = err instanceof Error ? err : new Error(String(err || "offscreen render failed"));
    } finally {
      this.inFlightRender = false;
      if (!this.disposed && this.pendingRenderPayload && !this.fatalRenderError) {
        this.inFlightRender = true;
        void this.drainRenderQueue();
      }
    }
  }

  getLastFrameStats(): RenderBackendFrameStats | null {
    return this.lastStats;
  }

  dispose(): void {
    this.disposed = true;
    this.pendingRenderPayload = null;
    this.fatalRenderError = null;
    this.inFlightRender = false;
    this.failPending(new Error("offscreen backend disposed"));
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.initializedCanvas = null;
    this.lastStats = null;
  }
}
