import type { HistoryState } from "../../core/history";
import { historyPush, historyReplacePresent } from "../../core/history";

export function replaceHistoryPresent<T>(history: HistoryState<T>, next: T): HistoryState<T> {
  return historyReplacePresent(history, next);
}

export function commitHistorySnapshot<T>(
  history: HistoryState<T>,
  next: T,
  clone: (value: T) => T,
  max = 180
): HistoryState<T> {
  return historyPush(history, clone(next), max);
}

export function beginHistoryOperation<T>(
  history: HistoryState<T>,
  clone: (value: T) => T,
  max = 180
): HistoryState<T> {
  return {
    past: [...history.past, clone(history.present)].slice(-max),
    present: clone(history.present),
    future: [],
  };
}

