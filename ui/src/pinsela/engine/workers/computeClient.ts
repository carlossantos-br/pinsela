import type { GuideLine, SnapOptions } from "../../core/layout";
import { cycleHitUnderCursor, hitTestAll, hitTestTop } from "../../core/hitTest";
import { selectionBounds, snapMove } from "../../core/layout";
import type { PinselaNode, PinselaTemplateDocV1 } from "../../core/types";
import { parseCsvPayloads } from "../core/documentUtils";
import {
  createComputeRequestId,
  type WorkerComputeRequest,
  type WorkerComputeResponse,
  type WorkerComputeSuccessResponse,
} from "./protocol";

type PendingRequest = {
  timer: number;
  resolve: (value: WorkerComputeResponse) => void;
  reject: (reason?: unknown) => void;
};

export type ComputeClientOptions = {
  enabled: boolean;
  requestTimeoutMs?: number;
};

export type ComputeClient = {
  enabled: boolean;
  dispose: () => void;
  hitTestTop: (doc: PinselaTemplateDocV1, x: number, y: number, includeLocked?: boolean) => Promise<PinselaNode | null>;
  hitTestAll: (doc: PinselaTemplateDocV1, x: number, y: number, includeLocked?: boolean) => Promise<PinselaNode[]>;
  cycleHitUnderCursor: (doc: PinselaTemplateDocV1, x: number, y: number, currentId: string | null) => Promise<PinselaNode | null>;
  snapMove: (
    doc: PinselaTemplateDocV1,
    ids: string[],
    dx: number,
    dy: number,
    threshold?: number,
    options?: SnapOptions
  ) => Promise<{ dx: number; dy: number; guides: GuideLine[] }>;
  selectionBounds: (doc: PinselaTemplateDocV1, ids: string[]) => Promise<{ x: number; y: number; w: number; h: number } | null>;
  parseCsvPayloads: (csvRaw: string) => Promise<Record<string, any>[]>;
};

function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err || "worker compute error");
}

export function createComputeClient(opts: ComputeClientOptions): ComputeClient {
  const timeoutMs = Math.max(50, Number(opts.requestTimeoutMs || 5000));
  const enabled = !!opts.enabled;
  let worker: Worker | null = null;
  const pending = new Map<string, PendingRequest>();

  function cleanupPending(reason: unknown) {
    pending.forEach((entry) => {
      clearTimeout(entry.timer);
      entry.reject(reason);
    });
    pending.clear();
  }

  function dispose() {
    cleanupPending(new Error("worker disposed"));
    if (worker) {
      worker.terminate();
      worker = null;
    }
  }

  function fallbackRequest(req: WorkerComputeRequest): WorkerComputeResponse {
    if (req.type === "hit_test_top") {
      const { doc, point, includeLocked } = req.payload;
      return { id: req.id, ok: true, type: req.type, payload: { node: hitTestTop(doc, point.x, point.y, { includeLocked: !!includeLocked }) } };
    }
    if (req.type === "hit_test_all") {
      const { doc, point, includeLocked } = req.payload;
      return { id: req.id, ok: true, type: req.type, payload: { nodes: hitTestAll(doc, point.x, point.y, { includeLocked: !!includeLocked }) } };
    }
    if (req.type === "cycle_hit") {
      const { doc, point, currentId } = req.payload;
      return { id: req.id, ok: true, type: req.type, payload: { node: cycleHitUnderCursor(doc, point.x, point.y, currentId) } };
    }
    if (req.type === "snap_move") {
      const { doc, ids, dx, dy, threshold, options } = req.payload;
      return { id: req.id, ok: true, type: req.type, payload: snapMove(doc, ids, dx, dy, threshold, options) };
    }
    if (req.type === "selection_bounds") {
      const { doc, ids } = req.payload;
      return { id: req.id, ok: true, type: req.type, payload: { bounds: selectionBounds(doc, ids) } };
    }
    return { id: req.id, ok: true, type: req.type, payload: { rows: parseCsvPayloads(req.payload.csvRaw) } };
  }

  function ensureWorker(): Worker | null {
    if (!enabled) return null;
    if (typeof Worker === "undefined") return null;
    if (worker) return worker;
    try {
      worker = new Worker(new URL("./compute.worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (event: MessageEvent<WorkerComputeResponse>) => {
        const res = event.data;
        const entry = pending.get(res.id);
        if (!entry) return;
        pending.delete(res.id);
        clearTimeout(entry.timer);
        entry.resolve(res);
      };
      worker.onerror = (event: ErrorEvent) => {
        cleanupPending(new Error(event.message || "worker error"));
      };
    } catch {
      worker = null;
    }
    return worker;
  }

  async function request(req: Omit<WorkerComputeRequest, "id">): Promise<WorkerComputeResponse> {
    const id = createComputeRequestId();
    const requestWithId = { ...req, id } as WorkerComputeRequest;
    const active = ensureWorker();
    if (!active) return fallbackRequest(requestWithId);
    return new Promise<WorkerComputeResponse>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        pending.delete(id);
        reject(new Error(`worker timeout: ${req.type}`));
      }, timeoutMs);
      pending.set(id, { timer, resolve, reject });
      active.postMessage(requestWithId);
    }).catch(() => fallbackRequest(requestWithId));
  }

  async function requestOrThrow(req: Omit<WorkerComputeRequest, "id">): Promise<WorkerComputeSuccessResponse> {
    const res = await request(req);
    if (res.ok) return res;
    throw new Error(res.error || `worker request failed: ${req.type}`);
  }

  return {
    enabled,
    dispose,
    async hitTestTop(doc, x, y, includeLocked) {
      const res = await requestOrThrow({
        type: "hit_test_top",
        payload: { doc, point: { x, y }, includeLocked },
      });
      return res.type === "hit_test_top" ? res.payload.node : null;
    },
    async hitTestAll(doc, x, y, includeLocked) {
      const res = await requestOrThrow({
        type: "hit_test_all",
        payload: { doc, point: { x, y }, includeLocked },
      });
      return res.type === "hit_test_all" ? res.payload.nodes : [];
    },
    async cycleHitUnderCursor(doc, x, y, currentId) {
      const res = await requestOrThrow({
        type: "cycle_hit",
        payload: { doc, point: { x, y }, currentId },
      });
      return res.type === "cycle_hit" ? res.payload.node : null;
    },
    async snapMove(doc, ids, dx, dy, threshold, options) {
      const res = await requestOrThrow({
        type: "snap_move",
        payload: { doc, ids, dx, dy, threshold, options },
      });
      return res.type === "snap_move" ? res.payload : { dx, dy, guides: [] };
    },
    async selectionBounds(doc, ids) {
      const res = await requestOrThrow({
        type: "selection_bounds",
        payload: { doc, ids },
      });
      return res.type === "selection_bounds" ? res.payload.bounds : null;
    },
    async parseCsvPayloads(csvRaw) {
      const res = await requestOrThrow({
        type: "parse_csv_payloads",
        payload: { csvRaw: String(csvRaw || "") },
      });
      return res.type === "parse_csv_payloads" ? res.payload.rows : [];
    },
  };
}

export function safeComputeErrorMessage(err: unknown): string {
  return toErrorMessage(err);
}
