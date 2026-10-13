import React from "react";
import type { PinselaTemplateDocV1 } from "../core/types";
import type { GuideLine, SnapOptions } from "../core/layout";
import { snapMove } from "../core/layout";
import { hitTestAll, hitTestTop, queryNodesInRect } from "../core/hitTest";
import { addNode, expandSelectionWithDescendants, moveSelection, removeNodes } from "../core/scene";
import { isAutoLayoutContainerNode, reparentNodesToContainer } from "../core/autoLayout";
import { cloneNodeGraph } from "../engine/core/cloneNodeGraph";

export type PointerMode = "idle" | "move" | "resize" | "rotate" | "marquee" | "pan" | "path-edit";
const DIRECT_DRAG_START_THRESHOLD_PX = 4;

type DirectSelectionTranslateGestureEvent = {
    phase: "start" | "move" | "end";
    dx?: number;
    dy?: number;
    altKey?: boolean;
    metaKey?: boolean;
    shiftKey?: boolean;
    selectionIds?: string[];
    baseDoc?: PinselaTemplateDocV1;
};

export interface PointerMachineState {
    mode: PointerMode;
    cursor: string;
}

export interface UsePointerMachineResult {
    pointerState: PointerMachineState;
    marqueeRect: { x: number; y: number; w: number; h: number } | null;
    frameDropTargetId: string | null;
    onPointerDown: (ev: React.PointerEvent<HTMLCanvasElement>) => void;
    onPointerMove: (ev: React.PointerEvent<HTMLCanvasElement>) => void;
    onPointerUp: (ev: React.PointerEvent<HTMLCanvasElement>) => void;
}

/**
 * Pointer machine — handles mouse/touch interactions on the canvas.
 * Basic hit-test selection is implemented; full move/resize/rotate
 * will be migrated incrementally from the Shell monolith.
 */
export function usePointerMachine(
    doc: PinselaTemplateDocV1,
    selection: string[],
    stageScale: number,
    commitDoc: (d: PinselaTemplateDocV1) => void,
    replaceDoc: (d: PinselaTemplateDocV1) => void,
    setSelection: (ids: string[]) => void,
    snapOptions?: SnapOptions,
    setGuides?: (guides: GuideLine[]) => void,
    onTranslateSelectionGesture?: (event: DirectSelectionTranslateGestureEvent) => void,
): UsePointerMachineResult {
    const [pointerState, setPointerState] = React.useState<PointerMachineState>({
        mode: "idle",
        cursor: "default",
    });
    const [marqueeRect, setMarqueeRect] = React.useState<{ x: number; y: number; w: number; h: number } | null>(null);
    const [frameDropTargetId, setFrameDropTargetId] = React.useState<string | null>(null);
    const dragRef = React.useRef<{
        active: boolean;
        pointerId: number | null;
        startX: number;
        startY: number;
        lastDx: number;
        lastDy: number;
        moved: boolean;
        ids: string[];
        startDoc: PinselaTemplateDocV1 | null;
        latestDoc: PinselaTemplateDocV1 | null;
        duplicated: boolean;
        gestureStarted: boolean;
        delegated: boolean;
    }>({
        active: false,
        pointerId: null,
        startX: 0,
        startY: 0,
        lastDx: 0,
        lastDy: 0,
        moved: false,
        ids: [],
        startDoc: null,
        latestDoc: null,
        duplicated: false,
        gestureStarted: false,
        delegated: false,
    });
    const marqueeRef = React.useRef<{
        active: boolean;
        pointerId: number | null;
        startX: number;
        startY: number;
        currentX: number;
        currentY: number;
        moved: boolean;
        additive: boolean;
        toggle: boolean;
        baseSelection: string[];
    }>({
        active: false,
        pointerId: null,
        startX: 0,
        startY: 0,
        currentX: 0,
        currentY: 0,
        moved: false,
        additive: false,
        toggle: false,
        baseSelection: [],
    });

    function resetDrag() {
        dragRef.current = {
            active: false,
            pointerId: null,
            startX: 0,
            startY: 0,
            lastDx: 0,
            lastDy: 0,
            moved: false,
            ids: [],
            startDoc: null,
            latestDoc: null,
            duplicated: false,
            gestureStarted: false,
            delegated: false,
        };
        setFrameDropTargetId(null);
    }

    function sameSelectionIds(left: string[], right: string[]) {
        if (left.length !== right.length) return false;
        for (let index = 0; index < left.length; index += 1) {
            if (left[index] !== right[index]) return false;
        }
        return true;
    }

    function duplicateDraggedNodes(
        inputDoc: PinselaTemplateDocV1,
        selectedIds: string[],
    ): { doc: PinselaTemplateDocV1; duplicatedIds: string[] } {
        if (!selectedIds.length) return { doc: inputDoc, duplicatedIds: [] };
        const expandedSelection = expandSelectionWithDescendants(inputDoc, selectedIds);
        const expandedSet = new Set(expandedSelection);
        const nodeById = new Map(inputDoc.nodes.map((node) => [node.id, node] as const));
        const sourceNodes = inputDoc.nodes
            .filter((node) => expandedSet.has(node.id))
            .map((node) => nodeById.get(node.id) || null)
            .filter((node): node is NonNullable<typeof node> => !!node);
        if (!sourceNodes.length) return { doc: inputDoc, duplicatedIds: [] };
        const { clones, selectionIds } = cloneNodeGraph(sourceNodes, selectedIds, { unlock: true });
        if (!clones.length) return { doc: inputDoc, duplicatedIds: [] };

        let nextDoc = inputDoc;
        for (const cloned of clones) {
            nextDoc = addNode(nextDoc, cloned);
        }
        return {
            doc: nextDoc,
            duplicatedIds: selectionIds,
        };
    }

    function resetMarquee() {
        marqueeRef.current = {
            active: false,
            pointerId: null,
            startX: 0,
            startY: 0,
            currentX: 0,
            currentY: 0,
            moved: false,
            additive: false,
            toggle: false,
            baseSelection: [],
        };
        setMarqueeRect(null);
        setFrameDropTargetId(null);
    }

    function normalizeRect(startX: number, startY: number, currentX: number, currentY: number) {
        const x = Math.min(startX, currentX);
        const y = Math.min(startY, currentY);
        const w = Math.abs(currentX - startX);
        const h = Math.abs(currentY - startY);
        return { x, y, w, h };
    }

    function docCanvasSize() {
        return {
            width: Math.max(1, Number(doc.canvas?.width || 1)),
            height: Math.max(1, Number(doc.canvas?.height || 1)),
        };
    }

    function clampDocPoint(point: { x: number; y: number }) {
        const size = docCanvasSize();
        return {
            x: Math.max(0, Math.min(size.width, point.x)),
            y: Math.max(0, Math.min(size.height, point.y)),
        };
    }

    function isPointInsideDocCanvas(point: { x: number; y: number }) {
        const size = docCanvasSize();
        return (
            point.x >= 0
            && point.x <= size.width
            && point.y >= 0
            && point.y <= size.height
        );
    }

    function clampRectToDocCanvas(rect: { x: number; y: number; w: number; h: number }) {
        const size = docCanvasSize();
        const x1 = Math.max(0, Math.min(size.width, rect.x));
        const y1 = Math.max(0, Math.min(size.height, rect.y));
        const x2 = Math.max(0, Math.min(size.width, rect.x + rect.w));
        const y2 = Math.max(0, Math.min(size.height, rect.y + rect.h));
        return {
            x: Math.min(x1, x2),
            y: Math.min(y1, y2),
            w: Math.abs(x2 - x1),
            h: Math.abs(y2 - y1),
        };
    }

    function toDocPoint(
        ev: React.PointerEvent<HTMLCanvasElement>,
        options?: { requireInside?: boolean; clampToCanvas?: boolean },
    ) {
        const canvas = ev.currentTarget;
        const rect = canvas.getBoundingClientRect();
        const size = docCanvasSize();
        const x = ((ev.clientX - rect.left) / Math.max(1, rect.width)) * size.width;
        const y = ((ev.clientY - rect.top) / Math.max(1, rect.height)) * size.height;
        const point = { x, y };
        if (options?.requireInside && !isPointInsideDocCanvas(point)) return null;
        return options?.clampToCanvas ? clampDocPoint(point) : point;
    }

    function findFrameDropTarget(
        inputDoc: PinselaTemplateDocV1,
        px: number,
        py: number,
        draggedIds: string[],
    ) {
        const draggedSet = new Set(draggedIds);
        const hits = hitTestAll(inputDoc, px, py, { includeLocked: false, viewportScale: stageScale });
        return hits.find((node) => (
            node.kind === "frame"
            && node.id !== inputDoc.root_id
            && !node.style?.locked
            && !isAutoLayoutContainerNode(node)
            && !draggedSet.has(node.id)
        )) || null;
    }

    function isInsideDraggedBranch(
        inputDoc: PinselaTemplateDocV1,
        nodeId: string,
        draggedSet: Set<string>,
    ): boolean {
        const parentById = new Map(inputDoc.nodes.map((node) => [node.id, node.parent_id || null] as const));
        let cursor: string | null = nodeId;
        const seen = new Set<string>();
        while (cursor) {
            if (draggedSet.has(cursor)) return true;
            if (seen.has(cursor)) break;
            seen.add(cursor);
            cursor = parentById.get(cursor) || null;
        }
        return false;
    }

    function findAutoLayoutDropTarget(
        inputDoc: PinselaTemplateDocV1,
        px: number,
        py: number,
        draggedIds: string[],
    ) {
        const draggedSet = new Set(draggedIds);
        const hits = hitTestAll(inputDoc, px, py, { includeLocked: false, viewportScale: stageScale });
        return hits.find((node) => (
            node.id !== inputDoc.root_id
            && !node.style?.locked
            && isAutoLayoutContainerNode(node)
            && !draggedSet.has(node.id)
            && !isInsideDraggedBranch(inputDoc, node.id, draggedSet)
        )) || null;
    }

    function applyDraggedNodesIntoAutoLayout(
        inputDoc: PinselaTemplateDocV1,
        draggedIds: string[],
        px: number,
        py: number,
    ): { doc: PinselaTemplateDocV1; selectionIds: string[] } | null {
        if (!draggedIds.length) return null;
        const target = findAutoLayoutDropTarget(inputDoc, px, py, draggedIds);
        if (!target) return null;
        const nextDoc = reparentNodesToContainer(inputDoc, draggedIds, target.id, { placement: "end" });
        if (nextDoc === inputDoc) return null;
        return { doc: nextDoc, selectionIds: draggedIds };
    }

    function applyDraggedImageIntoFrame(
        inputDoc: PinselaTemplateDocV1,
        draggedIds: string[],
        px: number,
        py: number,
        bypassFrameApply: boolean,
    ): { doc: PinselaTemplateDocV1; selectionId: string } | null {
        if (bypassFrameApply) return null;
        if (draggedIds.length !== 1) return null;

        const draggedImageId = draggedIds[0];
        const draggedNode = inputDoc.nodes.find((node) => node.id === draggedImageId);
        if (!draggedNode || draggedNode.kind !== "image") return null;
        const src = String(draggedNode.image_src || "").trim();
        if (!src) return null;

        const frameTarget = findFrameDropTarget(inputDoc, px, py, draggedIds);
        if (!frameTarget) return null;

        const withAppliedFrame: PinselaTemplateDocV1 = {
            ...inputDoc,
            nodes: inputDoc.nodes.map((node) => (
                node.id !== frameTarget.id
                    ? node
                    : {
                        ...node,
                        image_src: src,
                        editable: true,
                        style: {
                            ...node.style,
                            image_fit: "fill",
                            image_crop: null,
                        },
                    }
            )),
        };
        const cleanedDoc = removeNodes(withAppliedFrame, [draggedImageId]);
        return { doc: cleanedDoc, selectionId: frameTarget.id };
    }

    function previewFrameDropTargetId(
        inputDoc: PinselaTemplateDocV1,
        draggedIds: string[],
        px: number,
        py: number,
        bypassFrameApply: boolean,
    ): string | null {
        const autoLayoutTarget = findAutoLayoutDropTarget(inputDoc, px, py, draggedIds);
        if (autoLayoutTarget) return autoLayoutTarget.id;
        if (bypassFrameApply) return null;
        if (draggedIds.length !== 1) return null;
        const draggedNode = inputDoc.nodes.find((node) => node.id === draggedIds[0]);
        if (!draggedNode || draggedNode.kind !== "image") return null;
        const src = String(draggedNode.image_src || "").trim();
        if (!src) return null;
        return findFrameDropTarget(inputDoc, px, py, draggedIds)?.id || null;
    }

    function onPointerDown(ev: React.PointerEvent<HTMLCanvasElement>) {
        if (ev.button !== 0) return;
        const point = toDocPoint(ev, { requireInside: true });
        if (!point) return;
        const { x, y } = point;
        const additive = ev.shiftKey;
        const toggle = ev.metaKey || ev.ctrlKey;

        // Basic hit test for selection
        const rawHit = hitTestTop(doc, x, y, { includeLocked: true, viewportScale: stageScale });
        const hit = rawHit;
        resetMarquee();
        if (hit) {
            if (toggle || additive) {
                const selected = new Set(selection);
                if (toggle) {
                    if (selected.has(hit.id)) {
                        selected.delete(hit.id);
                    } else {
                        selected.add(hit.id);
                    }
                } else {
                    selected.add(hit.id);
                }
                setSelection([...selected]);
                setGuides?.([]);
                resetDrag();
                ev.currentTarget.releasePointerCapture?.(ev.pointerId);
                setPointerState({ mode: "idle", cursor: "default" });
                return;
            }

            const dragIds = selection.includes(hit.id) && selection.length ? [...selection] : [hit.id];
            if (!sameSelectionIds(selection, dragIds)) {
                setSelection(dragIds);
            }
            setGuides?.([]);

            // Locked nodes remain selectable from the artboard, but should not start move drag.
            if (hit.style?.locked) {
                resetDrag();
                setPointerState({ mode: "idle", cursor: "default" });
                return;
            }

            dragRef.current = {
                active: true,
                pointerId: ev.pointerId,
                startX: x,
                startY: y,
                lastDx: 0,
                lastDy: 0,
                moved: false,
                ids: dragIds,
                startDoc: doc,
                latestDoc: doc,
                duplicated: false,
                gestureStarted: false,
                delegated: false,
            };
            ev.currentTarget.setPointerCapture?.(ev.pointerId);
            setPointerState({ mode: "idle", cursor: "default" });
        } else {
            resetDrag();
            const additiveMarquee = toggle || additive;
            if (!additiveMarquee) {
                setSelection([]);
            }
            setGuides?.([]);
            marqueeRef.current = {
                active: true,
                pointerId: ev.pointerId,
                startX: x,
                startY: y,
                currentX: x,
                currentY: y,
                moved: false,
                additive,
                toggle,
                baseSelection: [...selection],
            };
            setMarqueeRect({ x, y, w: 0, h: 0 });
            ev.currentTarget.setPointerCapture?.(ev.pointerId);
            setPointerState({ mode: "marquee", cursor: "crosshair" });
        }
    }

    function onPointerMove(ev: React.PointerEvent<HTMLCanvasElement>) {
        const marquee = marqueeRef.current;
        if (marquee.active) {
            if (marquee.pointerId != null && ev.pointerId !== marquee.pointerId) return;
            const point = toDocPoint(ev, { clampToCanvas: true });
            if (!point) return;
            const { x, y } = point;
            marquee.currentX = x;
            marquee.currentY = y;
            const rect = clampRectToDocCanvas(normalizeRect(marquee.startX, marquee.startY, x, y));
            marquee.moved = marquee.moved || rect.w >= 2 || rect.h >= 2;
            setMarqueeRect(rect);
            return;
        }

        const drag = dragRef.current;
        if (!drag.active) return;
        if (drag.pointerId != null && ev.pointerId !== drag.pointerId) return;
        if (!drag.startDoc || !drag.ids.length) return;

        const dragPoint = toDocPoint(ev);
        if (!dragPoint) return;
        const { x, y } = dragPoint;
        const dx = Math.round(x - drag.startX);
        const dy = Math.round(y - drag.startY);
        const startThreshold = Math.max(1, DIRECT_DRAG_START_THRESHOLD_PX / Math.max(0.0001, stageScale));
        if (!drag.gestureStarted) {
            if (Math.hypot(dx, dy) < startThreshold) return;
            drag.gestureStarted = true;
            drag.delegated = !!onTranslateSelectionGesture;
            setPointerState({ mode: "move", cursor: "grabbing" });
            if (onTranslateSelectionGesture && drag.startDoc && drag.ids.length) {
                onTranslateSelectionGesture({
                    phase: "start",
                    altKey: ev.altKey,
                    metaKey: ev.metaKey,
                    shiftKey: ev.shiftKey,
                    selectionIds: [...drag.ids],
                    baseDoc: drag.startDoc,
                });
            }
        }
        if (dx === drag.lastDx && dy === drag.lastDy) return;

        drag.lastDx = dx;
        drag.lastDy = dy;
        drag.moved = drag.moved || dx !== 0 || dy !== 0;

        if (drag.delegated) {
            onTranslateSelectionGesture?.({
                phase: "move",
                dx,
                dy,
                altKey: ev.altKey,
                metaKey: ev.metaKey,
                shiftKey: ev.shiftKey,
            });
            return;
        }

        const wantsDuplicate = ev.altKey;
        if (!drag.duplicated && wantsDuplicate && (dx !== 0 || dy !== 0)) {
            const duplicated = duplicateDraggedNodes(drag.startDoc, drag.ids);
            if (duplicated.duplicatedIds.length) {
                drag.startDoc = duplicated.doc;
                drag.ids = duplicated.duplicatedIds;
                drag.latestDoc = duplicated.doc;
                drag.duplicated = true;
                setSelection(duplicated.duplicatedIds);
            }
        }

        const freeMove = ev.metaKey;
        const effectiveSnapOptions: SnapOptions = freeMove
          ? { ...(snapOptions || {}), enabled: false, viewportScale: stageScale }
          : { ...(snapOptions || {}), viewportScale: stageScale };
        const snapped = snapMove(
          drag.startDoc,
          drag.ids,
          dx,
          dy,
          Number(snapOptions?.tolerance ?? 20),
          effectiveSnapOptions,
        );
        const next = moveSelection(drag.startDoc, drag.ids, snapped.dx, snapped.dy);
        drag.latestDoc = next;
        const bypassFrameApply = ev.altKey && !drag.duplicated;
        setFrameDropTargetId(
            isPointInsideDocCanvas({ x, y })
                ? previewFrameDropTargetId(next, drag.ids, x, y, bypassFrameApply)
                : null,
        );
        setGuides?.(freeMove ? [] : (snapped.guides || []));
        replaceDoc(next);
    }

    function onPointerUp(ev: React.PointerEvent<HTMLCanvasElement>) {
        const marquee = marqueeRef.current;
        if (marquee.active && (marquee.pointerId == null || ev.pointerId === marquee.pointerId)) {
            ev.currentTarget.releasePointerCapture?.(ev.pointerId);
            const rect = clampRectToDocCanvas(normalizeRect(marquee.startX, marquee.startY, marquee.currentX, marquee.currentY));
            const hasArea = rect.w >= 2 || rect.h >= 2;
            if (hasArea && marquee.moved) {
                const hitIds = queryNodesInRect(doc, rect, { includeLocked: false }).map((node) => node.id);
                if (marquee.toggle) {
                    const selected = new Set(marquee.baseSelection);
                    for (const id of hitIds) {
                        if (selected.has(id)) selected.delete(id);
                        else selected.add(id);
                    }
                    setSelection([...selected]);
                } else if (marquee.additive) {
                    setSelection([...new Set([...marquee.baseSelection, ...hitIds])]);
                } else {
                    setSelection(hitIds);
                }
            } else if (!marquee.additive && !marquee.toggle) {
                setSelection([]);
            }
            setGuides?.([]);
            resetMarquee();
            setPointerState({ mode: "idle", cursor: "default" });
            return;
        }

        const drag = dragRef.current;
        if (drag.active && (drag.pointerId == null || ev.pointerId === drag.pointerId)) {
            ev.currentTarget.releasePointerCapture?.(ev.pointerId);
            if (drag.delegated && drag.gestureStarted) {
                onTranslateSelectionGesture?.({
                    phase: "end",
                    altKey: ev.altKey,
                    metaKey: ev.metaKey,
                    shiftKey: ev.shiftKey,
                });
                setGuides?.([]);
                resetDrag();
                setPointerState({ mode: "idle", cursor: "default" });
                return;
            }
            if (drag.moved && drag.latestDoc) {
                const releasePoint = toDocPoint(ev, { requireInside: true });
                const bypassFrameApply = ev.altKey && !drag.duplicated;
                const frameApplied = releasePoint
                    ? applyDraggedImageIntoFrame(drag.latestDoc, drag.ids, releasePoint.x, releasePoint.y, bypassFrameApply)
                    : null;
                if (frameApplied) {
                    commitDoc(frameApplied.doc);
                    setSelection([frameApplied.selectionId]);
                    setFrameDropTargetId(null);
                } else {
                    const autoLayoutApplied = releasePoint
                        ? applyDraggedNodesIntoAutoLayout(drag.latestDoc, drag.ids, releasePoint.x, releasePoint.y)
                        : null;
                    if (autoLayoutApplied) {
                        commitDoc(autoLayoutApplied.doc);
                        setSelection(autoLayoutApplied.selectionIds);
                    } else {
                        commitDoc(drag.latestDoc);
                    }
                }
            }
            setGuides?.([]);
            resetDrag();
        }
        setFrameDropTargetId(null);
        setPointerState({ mode: "idle", cursor: "default" });
    }

    return {
        pointerState,
        marqueeRect,
        frameDropTargetId,
        onPointerDown,
        onPointerMove,
        onPointerUp,
    };
}
