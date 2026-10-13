import React from "react";
import { createHistory } from "../core/history";
import { createEmptyDoc } from "../core/scene";
import type { PinselaTemplateDocV1 } from "../core/types";
import { resolveMode } from "./modeMachine";
import type { PinselaAction, PinselaStoreState } from "./actions";
import type { GuideLine } from "../core/layout";

function sameStringArray(left: string[], right: string[]) {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function sameGuides(left: GuideLine[], right: GuideLine[]) {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (a.axis !== b.axis || a.value !== b.value || a.source !== b.source) return false;
  }
  return true;
}

function initialState(doc?: PinselaTemplateDocV1): PinselaStoreState {
  return {
    history: createHistory(doc || createEmptyDoc(1080, 1080)),
    selection: [],
    guides: [],
    mode: "select",
    ui: {
      leftTab: "templates",
      rightTab: "properties",
      showExportModal: false,
      showVersionsModal: false,
      showBulkModal: false,
    },
    snap: {
      enabled: true,
      toPage: true,
      toObjects: true,
      toGrid: false,
      gridSize: 8,
      tolerance: 20,
      priorityMode: "distance",
      viewportScale: 1,
    },
    saveStatus: "saved",
  };
}

function reducer(state: PinselaStoreState, action: PinselaAction): PinselaStoreState {
  switch (action.type) {
    case "set_history":
      if (state.history === action.history) return state;
      return { ...state, history: action.history };
    case "set_selection":
      if (sameStringArray(state.selection, action.selection)) return state;
      return { ...state, selection: action.selection };
    case "set_guides":
      if (sameGuides(state.guides, action.guides)) return state;
      return { ...state, guides: action.guides };
    case "set_mode": {
      const nextMode = resolveMode(action.mode);
      if (state.mode === nextMode) return state;
      return { ...state, mode: nextMode };
    }
    case "set_left_tab":
      if (state.ui.leftTab === action.leftTab) return state;
      return { ...state, ui: { ...state.ui, leftTab: action.leftTab } };
    case "set_right_tab":
      if (state.ui.rightTab === action.rightTab) return state;
      return { ...state, ui: { ...state.ui, rightTab: action.rightTab } };
    case "set_ui_flag":
      if (state.ui[action.flag] === action.value) return state;
      return { ...state, ui: { ...state.ui, [action.flag]: action.value } };
    case "set_snap": {
      const nextSnap = { ...state.snap, ...action.snap };
      const unchanged = Object.keys(action.snap).every((key) => {
        const snapKey = key as keyof typeof nextSnap;
        return nextSnap[snapKey] === state.snap[snapKey];
      });
      if (unchanged) return state;
      return { ...state, snap: nextSnap };
    }
    case "set_save_status":
      if (state.saveStatus === action.saveStatus) return state;
      return { ...state, saveStatus: action.saveStatus };
    default:
      return state;
  }
}

export function usePinselaStore(doc?: PinselaTemplateDocV1) {
  return React.useReducer(reducer, initialState(doc));
}
