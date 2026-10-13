import React from "react";
import { usePinselaStore } from "../state/store";
import { createEmptyDoc } from "../core/scene";
import type { PinselaTemplateDocV1, PinselaNode } from "../core/types";
import type { HistoryState } from "../core/history";
import type { PinselaAction, PinselaStoreState } from "../state/actions";
import { selectDoc, selectSelectedNode, selectSelectionBounds, selectCanUndo, selectCanRedo } from "../state/selectors";
import { commitHistorySnapshot, replaceHistoryPresent } from "../engine/core/historyOps";
import { cloneDoc, defaultBezierPointsForNode } from "../engine/core/documentUtils";
import { cloneNodeGraph, pasteOffsetForCanvas } from "../engine/core/cloneNodeGraph";
import { readClipboard, readClipboardMatching, writeClipboard, writeOsClipboardMarker, subscribeClipboard } from "../clipboardStore";
import { detectOverrideKeys, mergeOverrideKeys, readComponentsMeta } from "../engine/core/components";
import { applyAutoLayoutDoc } from "../core/autoLayout";
import {
    addNode,
    expandSelectionWithDescendants,
    removeNodes,
} from "../core/scene";
import { historyUndo, historyRedo } from "../core/history";

export interface EditorEngine {
    store: PinselaStoreState;
    dispatch: React.Dispatch<PinselaAction>;
    doc: PinselaTemplateDocV1;
    selectedNode: PinselaNode | null;
    selectedBounds: ReturnType<typeof selectSelectionBounds>;
    canUndo: boolean;
    canRedo: boolean;
    selection: string[];
    layerNodes: PinselaNode[];
    mode: string;

    // Mutations
    commitDoc: (next: PinselaTemplateDocV1) => void;
    replaceDoc: (next: PinselaTemplateDocV1) => void;
    setSelection: (ids: string[]) => void;
    patchSelectedNode: (mut: (n: PinselaNode) => PinselaNode) => void;
    undo: () => void;
    redo: () => void;
    setMode: (mode: string) => void;
    copySelection: () => void;
    /** Pastes an explicit payload (override) or, with no arg, the last internal copy. */
    pasteClipboard: (payload?: { nodes: PinselaNode[]; selectedIds: string[] }) => void;
    /** Pastes the element whose id matches the marker read from the OS clipboard. Returns whether it pasted. */
    pasteFromMarkerId: (id: string) => boolean;
    /** Duplicates the selection without touching the OS clipboard. */
    duplicateSelection: () => void;
    cutSelection: () => void;
    deleteSelection: () => void;
    clipboardRef: React.MutableRefObject<{ nodes: PinselaNode[]; selectedIds: string[] }>;
}

function newClipboardId(): string {
    try {
        if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
    } catch {
        // continue to the fallback
    }
    return `clip-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function useEditorEngine(initialDoc?: PinselaTemplateDocV1): EditorEngine {
    const [store, dispatch] = usePinselaStore(initialDoc || createEmptyDoc(1080, 1080));
    const doc = selectDoc(store);
    const selectedNode = selectSelectedNode(store);
    const selectedBounds = selectSelectionBounds(store);
    const canUndo = selectCanUndo(store);
    const canRedo = selectCanRedo(store);
    const initialPersisted = React.useRef(readClipboard()).current;
    const clipboardRef = React.useRef<{ nodes: PinselaNode[]; selectedIds: string[] }>(
        initialPersisted
            ? { nodes: initialPersisted.nodes, selectedIds: initialPersisted.selectedIds }
            : { nodes: [], selectedIds: [] },
    );
    // Keeps the ref in sync when another tab copies (cross-project/cross-tab clipboard).
    // Serves only as an in-memory fallback for the context menu; true recency comes from the
    // marker in the OS clipboard, read on the `paste` event.
    React.useEffect(() => {
        return subscribeClipboard(() => {
            const persisted = readClipboard();
            if (persisted) {
                clipboardRef.current = { nodes: persisted.nodes, selectedIds: persisted.selectedIds };
            }
        });
    }, []);
    const layerNodesCacheRef = React.useRef<{
        rootId: string;
        entries: Array<{
            id: string;
            parentId: string | null;
            name: string;
            zIndex: number;
            visible: boolean;
            locked: boolean;
        }>;
        value: PinselaNode[];
    } | null>(null);

    const layerNodes = React.useMemo(
        () => {
            const nextEntries = doc.nodes.map((node) => ({
                id: node.id,
                parentId: node.parent_id || null,
                name: String(node.name || ""),
                zIndex: Number(node.geometry?.z_index || 0),
                visible: node.style?.visible !== false,
                locked: !!node.style?.locked,
            }));
            const cached = layerNodesCacheRef.current;
            const canReuse = !!cached
                && cached.rootId === doc.root_id
                && cached.entries.length === nextEntries.length
                && cached.entries.every((entry, index) => {
                    const next = nextEntries[index];
                    return entry.id === next.id
                        && entry.parentId === next.parentId
                        && entry.name === next.name
                        && entry.zIndex === next.zIndex
                        && entry.visible === next.visible
                        && entry.locked === next.locked;
                });
            if (canReuse && cached) return cached.value;

            const nextValue = [...doc.nodes]
                .filter((n) => n.id !== doc.root_id)
                .sort((a, b) => (b.geometry.z_index || 0) - (a.geometry.z_index || 0));
            layerNodesCacheRef.current = {
                rootId: doc.root_id,
                entries: nextEntries,
                value: nextValue,
            };
            return nextValue;
        },
        [doc.nodes, doc.root_id]
    );

    function setHistory(history: HistoryState<PinselaTemplateDocV1>) {
        dispatch({ type: "set_history", history });
    }

    function replaceDocFn(next: PinselaTemplateDocV1) {
        // Hot path during pointer-move/drag: keep it lightweight and avoid auto-layout churn.
        setHistory(replaceHistoryPresent(store.history, next));
    }

    function commitDocFn(next: PinselaTemplateDocV1) {
        const normalizedNext = applyAutoLayoutDoc(next);
        setHistory(commitHistorySnapshot(store.history, normalizedNext, cloneDoc, 180));
        dispatch({ type: "set_save_status", saveStatus: "saving" });
    }

    function setSelectionFn(ids: string[]) {
        if (
            ids.length === store.selection.length
            && ids.every((id, index) => id === store.selection[index])
        ) {
            return;
        }
        dispatch({ type: "set_selection", selection: ids });
    }

    function patchSelectedNodeFn(mut: (n: PinselaNode) => PinselaNode) {
        if (!selectedNode) return;
        const next = {
            ...doc,
            nodes: doc.nodes.map((n) => {
                if (n.id !== selectedNode.id) return n;
                const updated = mut(n);
                if (!n.component_instance) return updated;
                const overrideKeys = detectOverrideKeys(n, updated);
                return {
                    ...updated,
                    component_instance: mergeOverrideKeys(updated.component_instance || n.component_instance, overrideKeys),
                };
            }),
        };
        commitDocFn(next);
    }

    function undo() {
        if (!canUndo) return;
        setHistory(historyUndo(store.history));
        // Undo changes the live doc, so it must be persisted like any other edit.
        // Without this the autosave effect (gated on saveStatus === "saving") never
        // fires and the server keeps the pre-undo version → silent data loss on close.
        dispatch({ type: "set_save_status", saveStatus: "saving" });
    }

    function redo() {
        if (!canRedo) return;
        setHistory(historyRedo(store.history));
        dispatch({ type: "set_save_status", saveStatus: "saving" });
    }

    function setModeFn(mode: string) {
        if (store.mode === mode) return;
        dispatch({ type: "set_mode", mode: mode as any });
    }

    function copySelection() {
        if (!store.selection.length) return;
        const selected = new Set(expandSelectionWithDescendants(doc, store.selection));
        const nodes = doc.nodes.filter((n) => selected.has(n.id)).map((n) => cloneDoc(n));
        const selectedIds = [...store.selection];
        clipboardRef.current = { nodes, selectedIds };
        // Canva-style round-trip: full payload in localStorage (keyed by id),
        // and ONLY the id goes to the OS clipboard (invisible marker). That way recency
        // is observable on `paste` and nothing visible pastes into other apps.
        const id = newClipboardId();
        writeClipboard({ id, nodes, selectedIds, savedAt: Date.now() });
        void writeOsClipboardMarker(id);
    }

    function pasteClipboardFn(payloadOverride?: { nodes: PinselaNode[]; selectedIds: string[] }) {
        let payload = payloadOverride;
        if (!payload) {
            if (!clipboardRef.current.nodes.length) {
                const persisted = readClipboard();
                if (persisted) clipboardRef.current = { nodes: persisted.nodes, selectedIds: persisted.selectedIds };
            }
            payload = clipboardRef.current;
        }
        const items = payload?.nodes || [];
        if (!items.length) return;
        // Coordinates in Pinsela are absolute. When pasting between projects with
        // different canvases (e.g. story 1080x1920 -> banner 1920x1080) nodes may fall
        // outside the visible area and "vanish". Computes an offset that repositions
        // the content inside the destination canvas when it doesn't fit in place.
        const { offsetX, offsetY } = pasteOffsetForCanvas(items, doc.canvas);
        const { clones, selectionIds } = cloneNodeGraph(items, payload.selectedIds, {
            offsetX,
            offsetY,
            unlock: true,
        });
        if (!clones.length) return;
        let next = doc;
        for (const c of clones) next = addNode(next, c);
        commitDocFn(next);
        setSelectionFn(selectionIds);
    }

    function pasteFromMarkerIdFn(id: string): boolean {
        const payload = readClipboardMatching(id);
        if (!payload) return false;
        pasteClipboardFn({ nodes: payload.nodes, selectedIds: payload.selectedIds });
        return true;
    }

    function duplicateSelectionFn() {
        if (!store.selection.length) return;
        const selected = new Set(expandSelectionWithDescendants(doc, store.selection));
        const nodes = doc.nodes.filter((n) => selected.has(n.id)).map((n) => cloneDoc(n));
        pasteClipboardFn({ nodes, selectedIds: [...store.selection] });
    }

    function cutSelectionFn() {
        copySelection();
        if (!store.selection.length) return;
        const idsToRemove = expandSelectionWithDescendants(doc, store.selection);
        commitDocFn(removeNodes(doc, idsToRemove));
        setSelectionFn([]);
    }

    function deleteSelectionFn() {
        if (!store.selection.length) return;
        const idsToRemove = expandSelectionWithDescendants(doc, store.selection);
        commitDocFn(removeNodes(doc, idsToRemove));
        setSelectionFn([]);
    }

    return {
        store,
        dispatch,
        doc,
        selectedNode,
        selectedBounds,
        canUndo,
        canRedo,
        selection: store.selection,
        layerNodes,
        mode: store.mode,

        commitDoc: commitDocFn,
        replaceDoc: replaceDocFn,
        setSelection: setSelectionFn,
        patchSelectedNode: patchSelectedNodeFn,
        undo,
        redo,
        setMode: setModeFn,
        copySelection,
        pasteClipboard: pasteClipboardFn,
        pasteFromMarkerId: pasteFromMarkerIdFn,
        duplicateSelection: duplicateSelectionFn,
        cutSelection: cutSelectionFn,
        deleteSelection: deleteSelectionFn,
        clipboardRef,
    };
}
