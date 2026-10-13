import type { GuideLine, SnapOptions } from "../../core/layout";
import type { PinselaNode, PinselaTemplateDocV1 } from "../../core/types";

export type ComputeRequestId = string;

type Point2D = { x: number; y: number };

type HitTestTopRequest = {
  id: ComputeRequestId;
  type: "hit_test_top";
  payload: {
    doc: PinselaTemplateDocV1;
    point: Point2D;
    includeLocked?: boolean;
  };
};

type HitTestAllRequest = {
  id: ComputeRequestId;
  type: "hit_test_all";
  payload: {
    doc: PinselaTemplateDocV1;
    point: Point2D;
    includeLocked?: boolean;
  };
};

type CycleHitRequest = {
  id: ComputeRequestId;
  type: "cycle_hit";
  payload: {
    doc: PinselaTemplateDocV1;
    point: Point2D;
    currentId: string | null;
  };
};

type SnapMoveRequest = {
  id: ComputeRequestId;
  type: "snap_move";
  payload: {
    doc: PinselaTemplateDocV1;
    ids: string[];
    dx: number;
    dy: number;
    threshold?: number;
    options?: SnapOptions;
  };
};

type SelectionBoundsRequest = {
  id: ComputeRequestId;
  type: "selection_bounds";
  payload: {
    doc: PinselaTemplateDocV1;
    ids: string[];
  };
};

type ParseCsvPayloadsRequest = {
  id: ComputeRequestId;
  type: "parse_csv_payloads";
  payload: {
    csvRaw: string;
  };
};

export type WorkerComputeRequest =
  | HitTestTopRequest
  | HitTestAllRequest
  | CycleHitRequest
  | SnapMoveRequest
  | SelectionBoundsRequest
  | ParseCsvPayloadsRequest;

type SuccessResponseBase = {
  id: ComputeRequestId;
  ok: true;
};

type HitTestTopSuccess = SuccessResponseBase & {
  type: "hit_test_top";
  payload: { node: PinselaNode | null };
};

type HitTestAllSuccess = SuccessResponseBase & {
  type: "hit_test_all";
  payload: { nodes: PinselaNode[] };
};

type CycleHitSuccess = SuccessResponseBase & {
  type: "cycle_hit";
  payload: { node: PinselaNode | null };
};

type SnapMoveSuccess = SuccessResponseBase & {
  type: "snap_move";
  payload: { dx: number; dy: number; guides: GuideLine[] };
};

type SelectionBoundsSuccess = SuccessResponseBase & {
  type: "selection_bounds";
  payload: { bounds: { x: number; y: number; w: number; h: number } | null };
};

type ParseCsvPayloadsSuccess = SuccessResponseBase & {
  type: "parse_csv_payloads";
  payload: { rows: Record<string, any>[] };
};

export type WorkerComputeSuccessResponse =
  | HitTestTopSuccess
  | HitTestAllSuccess
  | CycleHitSuccess
  | SnapMoveSuccess
  | SelectionBoundsSuccess
  | ParseCsvPayloadsSuccess;

export type WorkerComputeErrorResponse = {
  id: ComputeRequestId;
  ok: false;
  type: WorkerComputeRequest["type"];
  error: string;
};

export type WorkerComputeResponse = WorkerComputeSuccessResponse | WorkerComputeErrorResponse;

export function createComputeRequestId(prefix = "pinsela_req"): ComputeRequestId {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
