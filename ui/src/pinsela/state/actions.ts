import type { GuideLine, SnapOptions } from "../core/layout";
import type { HistoryState } from "../core/history";
import type { PinselaTemplateDocV1 } from "../core/types";
import type { PinselaMode } from "./modeMachine";

export type PinselaUiState = {
  leftTab: "templates" | "elements" | "text" | "assets" | "components";
  rightTab: "properties" | "layers" | "bindings" | "rules" | "history";
  showExportModal: boolean;
  showVersionsModal: boolean;
  showBulkModal: boolean;
};

export type SnapState = Required<SnapOptions>;

export type PinselaStoreState = {
  history: HistoryState<PinselaTemplateDocV1>;
  selection: string[];
  guides: GuideLine[];
  mode: PinselaMode;
  ui: PinselaUiState;
  snap: SnapState;
  saveStatus: "saved" | "saving" | "offline" | "expired";
};

export type PinselaAction =
  | { type: "set_history"; history: HistoryState<PinselaTemplateDocV1> }
  | { type: "set_selection"; selection: string[] }
  | { type: "set_guides"; guides: GuideLine[] }
  | { type: "set_mode"; mode: PinselaMode }
  | { type: "set_left_tab"; leftTab: PinselaUiState["leftTab"] }
  | { type: "set_right_tab"; rightTab: PinselaUiState["rightTab"] }
  | { type: "set_ui_flag"; flag: keyof Pick<PinselaUiState, "showExportModal" | "showVersionsModal" | "showBulkModal">; value: boolean }
  | { type: "set_snap"; snap: Partial<SnapState> }
  | { type: "set_save_status"; saveStatus: PinselaStoreState["saveStatus"] };
