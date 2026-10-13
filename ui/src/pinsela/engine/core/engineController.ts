import { createHistory, historyPush, historyReplacePresent, type HistoryState } from "../../core/history";
import {
  addNode,
  moveSelection,
  patchNodeGeometry,
  patchNodeStyle,
  removeNodes,
  reorderNode,
  resizeNode,
  rotateNode,
  updateNode,
} from "../../core/scene";
import type { PinselaNode, PinselaTemplateDocV1 } from "../../core/types";
import { beginHistoryOperation, commitHistorySnapshot } from "./historyOps";

export type EngineCommand =
  | { type: "set_doc"; doc: PinselaTemplateDocV1 }
  | { type: "add_node"; node: PinselaNode }
  | { type: "remove_nodes"; ids: string[] }
  | { type: "update_node"; nodeId: string; patch: Partial<PinselaNode> }
  | { type: "patch_node_geometry"; nodeId: string; patch: Partial<PinselaNode["geometry"]> }
  | { type: "patch_node_style"; nodeId: string; patch: Partial<PinselaNode["style"]> }
  | { type: "move_selection"; ids: string[]; dx: number; dy: number }
  | { type: "resize_node"; nodeId: string; width: number; height: number }
  | { type: "rotate_node"; nodeId: string; rotation: number }
  | { type: "reorder_node"; nodeId: string; direction: "up" | "down" | "front" | "back" };

export type EngineCommitMode = "replace" | "push";

export function applyCommand(doc: PinselaTemplateDocV1, command: EngineCommand): PinselaTemplateDocV1 {
  switch (command.type) {
    case "set_doc":
      return command.doc;
    case "add_node":
      return addNode(doc, command.node);
    case "remove_nodes":
      return removeNodes(doc, command.ids);
    case "update_node":
      return updateNode(doc, command.nodeId, command.patch);
    case "patch_node_geometry":
      return patchNodeGeometry(doc, command.nodeId, command.patch);
    case "patch_node_style":
      return patchNodeStyle(doc, command.nodeId, command.patch);
    case "move_selection":
      return moveSelection(doc, command.ids, command.dx, command.dy);
    case "resize_node":
      return resizeNode(doc, command.nodeId, command.width, command.height);
    case "rotate_node":
      return rotateNode(doc, command.nodeId, command.rotation);
    case "reorder_node":
      return reorderNode(doc, command.nodeId, command.direction);
    default: {
      const _never: never = command;
      return doc;
    }
  }
}

export function applyCommands(doc: PinselaTemplateDocV1, commands: readonly EngineCommand[]): PinselaTemplateDocV1 {
  let next = doc;
  for (const command of commands) {
    next = applyCommand(next, command);
  }
  return next;
}

type EngineControllerOptions = {
  history?: HistoryState<PinselaTemplateDocV1>;
  maxHistory?: number;
  cloneDoc?: (doc: PinselaTemplateDocV1) => PinselaTemplateDocV1;
};

function cloneJsonDoc(doc: PinselaTemplateDocV1): PinselaTemplateDocV1 {
  return JSON.parse(JSON.stringify(doc)) as PinselaTemplateDocV1;
}

export class EngineController {
  private history: HistoryState<PinselaTemplateDocV1>;
  private readonly maxHistory: number;
  private readonly cloneDoc: (doc: PinselaTemplateDocV1) => PinselaTemplateDocV1;

  constructor(opts: EngineControllerOptions) {
    const max = Math.max(10, Number(opts.maxHistory || 180));
    this.maxHistory = max;
    this.cloneDoc = opts.cloneDoc || cloneJsonDoc;
    if (opts.history) {
      this.history = opts.history;
      return;
    }
    throw new Error("EngineController requires an explicit history state");
  }

  static fromDoc(doc: PinselaTemplateDocV1, opts?: Omit<EngineControllerOptions, "history">): EngineController {
    return new EngineController({
      ...(opts || {}),
      history: createHistory(doc),
    });
  }

  getHistory(): HistoryState<PinselaTemplateDocV1> {
    return this.history;
  }

  getDoc(): PinselaTemplateDocV1 {
    return this.history.present;
  }

  setHistory(history: HistoryState<PinselaTemplateDocV1>): HistoryState<PinselaTemplateDocV1> {
    this.history = history;
    return this.history;
  }

  beginOperation(): HistoryState<PinselaTemplateDocV1> {
    this.history = beginHistoryOperation(this.history, this.cloneDoc, this.maxHistory);
    return this.history;
  }

  commitDoc(doc: PinselaTemplateDocV1): HistoryState<PinselaTemplateDocV1> {
    this.history = commitHistorySnapshot(this.history, doc, this.cloneDoc, this.maxHistory);
    return this.history;
  }

  applyCommand(command: EngineCommand, mode: EngineCommitMode = "push"): HistoryState<PinselaTemplateDocV1> {
    const nextDoc = applyCommand(this.history.present, command);
    this.history =
      mode === "replace"
        ? historyReplacePresent(this.history, nextDoc)
        : historyPush(this.history, this.cloneDoc(nextDoc), this.maxHistory);
    return this.history;
  }

  applyCommands(commands: readonly EngineCommand[], mode: EngineCommitMode = "push"): HistoryState<PinselaTemplateDocV1> {
    const nextDoc = applyCommands(this.history.present, commands);
    this.history =
      mode === "replace"
        ? historyReplacePresent(this.history, nextDoc)
        : historyPush(this.history, this.cloneDoc(nextDoc), this.maxHistory);
    return this.history;
  }
}
