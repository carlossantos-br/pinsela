import type { DirtyRegion, SceneSnapshot } from "../render/types";

export type RenderRequestId = string;

type InitRequest = {
  id: RenderRequestId;
  type: "init";
  payload: {
    canvas: OffscreenCanvas;
    pixelRatio: number;
  };
};

type RenderRequest = {
  id: RenderRequestId;
  type: "render";
  payload: {
    snapshot: SceneSnapshot;
    pixelRatio: number;
    dirtyRegions: DirtyRegion[] | null;
  };
};

export type RenderWorkerRequest = InitRequest | RenderRequest;

type SuccessBase = {
  id: RenderRequestId;
  ok: true;
};

type InitSuccess = SuccessBase & {
  type: "init";
};

type RenderSuccess = SuccessBase & {
  type: "render";
};

export type RenderWorkerSuccessResponse = InitSuccess | RenderSuccess;

export type RenderWorkerErrorResponse = {
  id: RenderRequestId;
  ok: false;
  type: RenderWorkerRequest["type"];
  error: string;
};

export type RenderWorkerResponse = RenderWorkerSuccessResponse | RenderWorkerErrorResponse;

export function createRenderRequestId(prefix = "pinsela_render"): RenderRequestId {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
