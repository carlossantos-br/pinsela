export type HistoryState<T> = {
  past: T[];
  present: T;
  future: T[];
};

export function createHistory<T>(initial: T): HistoryState<T> {
  return { past: [], present: initial, future: [] };
}

export function historyPush<T>(state: HistoryState<T>, next: T, max = 100): HistoryState<T> {
  if (Object.is(state.present, next)) return state;
  const past = [...state.past, state.present];
  if (past.length > max) past.shift();
  return { past, present: next, future: [] };
}

export function historyReplacePresent<T>(state: HistoryState<T>, next: T): HistoryState<T> {
  if (Object.is(state.present, next)) return state;
  return { ...state, present: next };
}

export function historyUndo<T>(state: HistoryState<T>): HistoryState<T> {
  if (!state.past.length) return state;
  const prev = state.past[state.past.length - 1];
  const past = state.past.slice(0, -1);
  return {
    past,
    present: prev,
    future: [state.present, ...state.future],
  };
}

export function historyRedo<T>(state: HistoryState<T>): HistoryState<T> {
  if (!state.future.length) return state;
  const [next, ...rest] = state.future;
  return {
    past: [...state.past, state.present],
    present: next,
    future: rest,
  };
}
