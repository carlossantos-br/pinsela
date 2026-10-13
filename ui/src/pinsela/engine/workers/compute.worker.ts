import { cycleHitUnderCursor, hitTestAll, hitTestTop } from "../../core/hitTest";
import { selectionBounds, snapMove } from "../../core/layout";
import { parseCsvPayloads } from "../core/documentUtils";
import type { WorkerComputeRequest, WorkerComputeResponse } from "./protocol";

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerComputeRequest>) => void) | null;
  postMessage: (payload: WorkerComputeResponse) => void;
};

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err || "unknown worker error");
}

workerScope.onmessage = (event: MessageEvent<WorkerComputeRequest>) => {
  const req = event.data;
  try {
    if (req.type === "hit_test_top") {
      const { doc, point, includeLocked } = req.payload;
      workerScope.postMessage({
        id: req.id,
        ok: true,
        type: req.type,
        payload: { node: hitTestTop(doc, point.x, point.y, { includeLocked: !!includeLocked }) },
      });
      return;
    }

    if (req.type === "hit_test_all") {
      const { doc, point, includeLocked } = req.payload;
      workerScope.postMessage({
        id: req.id,
        ok: true,
        type: req.type,
        payload: { nodes: hitTestAll(doc, point.x, point.y, { includeLocked: !!includeLocked }) },
      });
      return;
    }

    if (req.type === "cycle_hit") {
      const { doc, point, currentId } = req.payload;
      workerScope.postMessage({
        id: req.id,
        ok: true,
        type: req.type,
        payload: { node: cycleHitUnderCursor(doc, point.x, point.y, currentId) },
      });
      return;
    }

    if (req.type === "snap_move") {
      const { doc, ids, dx, dy, threshold, options } = req.payload;
      workerScope.postMessage({
        id: req.id,
        ok: true,
        type: req.type,
        payload: snapMove(doc, ids, dx, dy, threshold, options),
      });
      return;
    }

    if (req.type === "selection_bounds") {
      const { doc, ids } = req.payload;
      workerScope.postMessage({
        id: req.id,
        ok: true,
        type: req.type,
        payload: { bounds: selectionBounds(doc, ids) },
      });
      return;
    }

    if (req.type === "parse_csv_payloads") {
      const { csvRaw } = req.payload;
      workerScope.postMessage({
        id: req.id,
        ok: true,
        type: req.type,
        payload: { rows: parseCsvPayloads(csvRaw) },
      });
      return;
    }
  } catch (err) {
    workerScope.postMessage({
      id: req.id,
      ok: false,
      type: req.type,
      error: errorMessage(err),
    });
  }
};
