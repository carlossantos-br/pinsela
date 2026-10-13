import type { GuideLine } from "../../core/layout";
import type { PinselaNode } from "../../core/types";

export type DirtyRegion = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type SceneSnapshotNode = {
  id: string;
  renderHash: number;
  parent_id: string | null;
  kind: PinselaNode["kind"];
  geometry: PinselaNode["geometry"];
  style: PinselaNode["style"];
  text: PinselaNode["text"];
  text_model?: PinselaNode["text_model"];
  text_style?: PinselaNode["text_style"];
  text_runs?: PinselaNode["text_runs"];
  text_path?: PinselaNode["text_path"];
  fit?: PinselaNode["fit"];
  path_data?: PinselaNode["path_data"];
  image_src?: PinselaNode["image_src"];
};

export type SceneSnapshot = {
  key: string;
  rootId: string;
  canvas: {
    width: number;
    height: number;
    background: unknown;
  };
  nodes: readonly SceneSnapshotNode[];
  guides: readonly GuideLine[];
  selectionBounds: { x: number; y: number; w: number; h: number } | null;
  imageSources: readonly string[];
  createdAtMs: number;
};
