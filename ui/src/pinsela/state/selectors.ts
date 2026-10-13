import { selectionBounds } from "../core/layout";
import type { PinselaStoreState } from "./actions";

export function selectDoc(state: PinselaStoreState) {
  return state.history.present;
}

export function selectSelectedNode(state: PinselaStoreState) {
  if (state.selection.length !== 1) return null;
  return state.history.present.nodes.find((n) => n.id === state.selection[0]) || null;
}

export function selectSelectionBounds(state: PinselaStoreState) {
  return selectionBounds(state.history.present, state.selection);
}

export function selectCanUndo(state: PinselaStoreState) {
  return state.history.past.length > 0;
}

export function selectCanRedo(state: PinselaStoreState) {
  return state.history.future.length > 0;
}

