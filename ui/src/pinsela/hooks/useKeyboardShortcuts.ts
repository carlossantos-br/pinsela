import React from "react";
import type { EditorEngine } from "./useEditorEngine";
import { moveSelection } from "../core/scene";
import { groupSelectionIntoNewGroup, ungroupSelectedGroups, reorderSelection } from "../engine/core/layerOps";
import { isKeyboardEditableTarget, isKeyboardInMenuContext } from "./keyboardScope";
import { parseClipboardMarkerId } from "../clipboardStore";

export type InsertShortcutKind = "rect" | "circle" | "frame" | "line" | "text" | "image";

interface UseKeyboardShortcutsOptions {
    onInsertShortcut?: (kind: InsertShortcutKind) => void;
    /** Single-key tool switches: V select, H hand/pan, P pen, B brush. */
    onToolShortcut?: (tool: "select" | "hand" | "pen" | "brush") => void;
    /** Ctrl/Cmd + = / + */
    onZoomIn?: () => void;
    /** Ctrl/Cmd + - / _ */
    onZoomOut?: () => void;
    /** Ctrl/Cmd + 0 → reset to 100% */
    onZoomReset?: () => void;
    onEscape?: () => void;
}

export function useKeyboardShortcuts(engine: EditorEngine, options?: UseKeyboardShortcutsOptions) {
    const onInsertShortcut = options?.onInsertShortcut;
    const onToolShortcut = options?.onToolShortcut;
    const onZoomIn = options?.onZoomIn;
    const onZoomOut = options?.onZoomOut;
    const onZoomReset = options?.onZoomReset;
    const onEscape = options?.onEscape;

    React.useEffect(() => {
        function onKey(ev: KeyboardEvent) {
            if (isKeyboardEditableTarget(ev.target)) return;
            if (isKeyboardInMenuContext(ev.target)) return;

            const ctrl = ev.ctrlKey || ev.metaKey;
            const key = String(ev.key || "").toLowerCase();

            // Insert shortcuts (no modifiers): R Rect, C Circle, F Frame, L Line, T Text, I Image
            if (!ctrl && !ev.altKey && engine.mode !== "text-edit") {
                let insertKind: InsertShortcutKind | null = null;
                if (key === "r") insertKind = "rect";
                else if (key === "c") insertKind = "circle";
                else if (key === "f") insertKind = "frame";
                else if (key === "l") insertKind = "line";
                else if (key === "t") insertKind = "text";
                else if (key === "i") insertKind = "image";

                if (insertKind) {
                    ev.preventDefault();
                    onInsertShortcut?.(insertKind);
                    return;
                }

                // Tool switches (Figma/Canva muscle memory): V select, H hand, P pen, B brush.
                let toolKind: "select" | "hand" | "pen" | "brush" | null = null;
                if (key === "v") toolKind = "select";
                else if (key === "h") toolKind = "hand";
                else if (key === "p") toolKind = "pen";
                else if (key === "b") toolKind = "brush";

                if (toolKind) {
                    ev.preventDefault();
                    onToolShortcut?.(toolKind);
                    return;
                }
            }

            // Zoom: Ctrl/Cmd + (= or +) in, (- or _) out, 0 resets to 100%.
            // preventDefault stops the browser's own page-zoom so the canvas zooms instead.
            if (ctrl && (key === "=" || key === "+")) {
                ev.preventDefault();
                onZoomIn?.();
                return;
            }
            if (ctrl && (key === "-" || key === "_")) {
                ev.preventDefault();
                onZoomOut?.();
                return;
            }
            if (ctrl && key === "0") {
                ev.preventDefault();
                onZoomReset?.();
                return;
            }

            // Undo
            if (ctrl && key === "z" && !ev.shiftKey) {
                ev.preventDefault();
                engine.undo();
                return;
            }
            // Redo
            if (ctrl && (key === "y" || (key === "z" && ev.shiftKey))) {
                ev.preventDefault();
                engine.redo();
                return;
            }
            // Copy
            if (ctrl && key === "c") {
                ev.preventDefault();
                engine.copySelection();
                return;
            }
            // Cut
            if (ctrl && key === "x") {
                ev.preventDefault();
                engine.cutSelection();
                return;
            }
            // Paste (Cmd+V): do NOT intercept on keydown. Let the native `paste`
            // event fire — it carries the real OS clipboard content, which is the
            // only source of truth for recency. onPaste below decides by the
            // marker (Pinsela element) vs. external content. No guessing, no timers.

            // Duplicate (Cmd+D): clones in memory, without touching the OS clipboard.
            if (ctrl && key === "d") {
                ev.preventDefault();
                engine.duplicateSelection();
                return;
            }
            // Group / Ungroup
            if (ctrl && key === "g" && !ev.shiftKey) {
                ev.preventDefault();
                const grouped = groupSelectionIntoNewGroup(engine.doc, engine.selection);
                if (!grouped) return;
                engine.commitDoc(grouped.doc);
                engine.setSelection([grouped.groupId]);
                return;
            }
            if (ctrl && key === "g" && ev.shiftKey) {
                ev.preventDefault();
                const ungrouped = ungroupSelectedGroups(engine.doc, engine.selection);
                if (!ungrouped) return;
                engine.commitDoc(ungrouped.doc);
                engine.setSelection(ungrouped.childIds);
                return;
            }
            // Layer order: Cmd+] / Cmd+[ (one step), Cmd+Shift+] / Cmd+Shift+[ (extremes)
            if (ctrl && (key === "]" || key === "[")) {
                if (!engine.selection.length) return;
                ev.preventDefault();
                const direction = key === "]"
                    ? (ev.shiftKey ? "front" : "up")
                    : (ev.shiftKey ? "back" : "down");
                engine.commitDoc(reorderSelection(engine.doc, engine.selection, direction));
                return;
            }
            // Delete
            if (ev.key === "Delete" || ev.key === "Backspace") {
                ev.preventDefault();
                engine.deleteSelection();
                return;
            }
            // Escape → deselect
            if (ev.key === "Escape") {
                engine.setSelection([]);
                engine.setMode("select");
                onEscape?.();
                return;
            }
            // Select All
            if (ctrl && key === "a") {
                ev.preventDefault();
                const allIds = engine.doc.nodes
                    .filter((n) => n.id !== engine.doc.root_id)
                    .map((n) => n.id);
                engine.setSelection(allIds);
                return;
            }
            // Nudge selection
            if (key === "arrowleft" || key === "arrowright" || key === "arrowup" || key === "arrowdown") {
                if (!engine.selection.length) return;
                ev.preventDefault();
                const step = ev.shiftKey ? 10 : 1;
                const dx = key === "arrowleft" ? -step : key === "arrowright" ? step : 0;
                const dy = key === "arrowup" ? -step : key === "arrowdown" ? step : 0;
                engine.commitDoc(moveSelection(engine.doc, engine.selection, dx, dy));
                return;
            }
        }

        window.addEventListener("keydown", onKey);
        // Single decision point for paste: if the OS clipboard carries the Pinsela
        // marker (text/html with data-pinsela-clip), paste the ELEMENT (cross-project
        // included). If there is no marker, it is external content (image/text) — let
        // the page's external handler deal with it (they are mutually exclusive by
        // content, so there is no race or registration order to respect).
        function onPaste(ev: ClipboardEvent) {
            if (isKeyboardEditableTarget(ev.target)) return;
            if (isKeyboardInMenuContext(ev.target)) return;
            const html = String(ev.clipboardData?.getData("text/html") || "");
            const markerId = parseClipboardMarkerId(html);
            if (!markerId) return; // no marker → external content, not ours
            if (engine.pasteFromMarkerId(markerId)) {
                ev.preventDefault();
            }
        }

        window.addEventListener("paste", onPaste);
        return () => {
            window.removeEventListener("keydown", onKey);
            window.removeEventListener("paste", onPaste);
        };
    }, [engine, onInsertShortcut, onToolShortcut, onZoomIn, onZoomOut, onZoomReset, onEscape]);
}
