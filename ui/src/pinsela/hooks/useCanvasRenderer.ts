import React from "react";
import type { PinselaTemplateDocV1 } from "../core/types";
import type { GuideLine } from "../core/layout";
import { getPinselaFeatureFlags } from "../engine/flags";
import { createComputeClient } from "../engine/workers/computeClient";
import type { RenderRuntimeV2 } from "../engine/render/runtimeV2";
import { uiPercentToEngineZoom } from "../ui/darkglass/canvas/zoomMapping";
import { collectDocImageSources, preloadCanvasImage } from "../core/imageAssets";

export interface CanvasRendererState {
    canvasRef: React.RefObject<HTMLCanvasElement | null>;
    zoom: number;
    setZoom: (z: number) => void;
    fitToViewport: (options?: {
        horizontalPadding?: number;
        topPadding?: number;
        bottomPadding?: number;
        minZoom?: number;
        maxZoom?: number;
    }) => boolean;
    stageScale: number;
    imageCacheRef: React.MutableRefObject<Map<string, HTMLImageElement>>;
    computeClientRef: React.MutableRefObject<ReturnType<typeof createComputeClient> | null>;
    renderRuntimeRef: React.MutableRefObject<RenderRuntimeV2 | null>;
    showPreviewScene: (scene: {
        doc: PinselaTemplateDocV1;
        guides?: GuideLine[];
        selectionBounds?: { x: number; y: number; w: number; h: number } | null;
    }) => void;
    clearPreviewScene: () => void;
    repaint: () => void;
}

const MAX_RENDER_PIXEL_RATIO = 4;
const MAX_RENDER_SURFACE_EDGE = 8192;
const PREVIEW_RENDER_PIXEL_RATIO_CAP = 1;
const SETTLED_RENDER_PIXEL_RATIO_BOOST_CAP = 1.35;
const SETTLED_RENDER_PIXEL_RATIO_EXPONENT = 0.5;
const RENDER_PIXEL_RATIO_SETTLE_MS = 220;

type RenderSceneState = {
    doc: PinselaTemplateDocV1;
    guides: GuideLine[];
    selectionBounds: { x: number; y: number; w: number; h: number } | null;
};

export function useCanvasRenderer(
    doc: PinselaTemplateDocV1,
    guides: GuideLine[],
    selectionBounds: { x: number; y: number; w: number; h: number } | null,
    containerWidth: number
): CanvasRendererState {
    const flags = React.useMemo(() => getPinselaFeatureFlags(), []);
    const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
    const imageCacheRef = React.useRef<Map<string, HTMLImageElement>>(new Map());
    const imageLoadPromisesRef = React.useRef<Map<string, Promise<HTMLImageElement | null>>>(new Map());
    const computeClientRef = React.useRef<ReturnType<typeof createComputeClient> | null>(null);
    const renderRuntimeRef = React.useRef<RenderRuntimeV2 | null>(null);
    const [zoom, setZoom] = React.useState(uiPercentToEngineZoom(100));
    const assetVersionRef = React.useRef(0);
    const renderConfigRef = React.useRef({ pixelRatio: 1, assetVersion: 0 });
    const baseSceneRef = React.useRef<RenderSceneState>({
        doc,
        guides,
        selectionBounds: selectionBounds || null,
    });
    const previewSceneRef = React.useRef<RenderSceneState | null>(null);
    const paintSchedulerRef = React.useRef<{
        frame: number | null;
        running: boolean;
        pending: boolean;
        disposed: boolean;
    }>({
        frame: null,
        running: false,
        pending: false,
        disposed: false,
    });

    const fitBaseScale = React.useMemo(() => {
        const available = Math.max(320, containerWidth - 24);
        return Math.min(1, available / Math.max(1, doc.canvas.width));
    }, [doc.canvas.width, containerWidth]);

    const stageScale = React.useMemo(() => Math.max(0.1, fitBaseScale * zoom), [fitBaseScale, zoom]);
    const [settledStageScale, setSettledStageScale] = React.useState(stageScale);

    React.useEffect(() => {
        if (Math.abs(settledStageScale - stageScale) < 0.0001) return;
        const timer = window.setTimeout(() => {
            setSettledStageScale(stageScale);
        }, RENDER_PIXEL_RATIO_SETTLE_MS);
        return () => {
            window.clearTimeout(timer);
        };
    }, [settledStageScale, stageScale]);

    const renderPixelRatio = React.useMemo(() => {
        const dpr = typeof window === "undefined" ? 1 : Math.max(1, Number(window.devicePixelRatio || 1));
        // Keep interaction responsive by letting CSS scaling handle live zoom,
        // then recover extra detail once the viewport settles.
        const stageBoost = Math.min(
            SETTLED_RENDER_PIXEL_RATIO_BOOST_CAP,
            Math.pow(Math.max(1, Number(settledStageScale || 1)), SETTLED_RENDER_PIXEL_RATIO_EXPONENT),
        );
        const desired = dpr * stageBoost;
        const longestEdge = Math.max(1, Number(doc.canvas.width || 1), Number(doc.canvas.height || 1));
        const bySurfaceLimit = Math.max(1, MAX_RENDER_SURFACE_EDGE / longestEdge);
        return Math.max(1, Math.min(desired, MAX_RENDER_PIXEL_RATIO, bySurfaceLimit));
    }, [doc.canvas.height, doc.canvas.width, settledStageScale]);

    const renderSceneNow = React.useCallback(async () => {
        const canvas = canvasRef.current;
        const runtime = renderRuntimeRef.current;
        if (!canvas || !runtime) return;
        const previewScene = previewSceneRef.current;
        const scene = previewScene || baseSceneRef.current;
        const renderConfig = renderConfigRef.current;
        try {
            await runtime.renderFrame({
                canvas,
                doc: scene.doc,
                guides: scene.guides,
                selectionBounds: scene.selectionBounds,
                pixelRatio: previewScene
                    ? Math.max(1, Math.min(renderConfig.pixelRatio, PREVIEW_RENDER_PIXEL_RATIO_CAP))
                    : renderConfig.pixelRatio,
                imageCache: imageCacheRef.current as unknown as Map<string, CanvasImageSource>,
                assetVersion: renderConfig.assetVersion,
            });
        } catch {
            // Render runtime failed — no fallback at this layer
        }
    }, []);

    const flushScheduledPaint = React.useCallback(async () => {
        const scheduler = paintSchedulerRef.current;
        if (scheduler.running || scheduler.disposed) return;
        scheduler.running = true;
        try {
            do {
                scheduler.pending = false;
                await renderSceneNow();
            } while (scheduler.pending && !scheduler.disposed);
        } finally {
            scheduler.running = false;
        }
    }, [renderSceneNow]);

    const schedulePaint = React.useCallback(() => {
        const scheduler = paintSchedulerRef.current;
        if (scheduler.disposed) {
            if (!canvasRef.current) return;
            scheduler.disposed = false;
        }
        scheduler.pending = true;
        if (scheduler.frame != null || scheduler.running) return;
        scheduler.frame = window.requestAnimationFrame(() => {
            scheduler.frame = null;
            void flushScheduledPaint();
        });
    }, [flushScheduledPaint]);

    const bumpAssetVersion = React.useCallback(() => {
        assetVersionRef.current += 1;
        renderConfigRef.current = {
            ...renderConfigRef.current,
            assetVersion: assetVersionRef.current,
        };
        schedulePaint();
    }, [schedulePaint]);

    React.useEffect(() => {
        renderConfigRef.current = {
            pixelRatio: renderPixelRatio,
            assetVersion: assetVersionRef.current,
        };
        schedulePaint();
    }, [renderPixelRatio, schedulePaint]);

    React.useEffect(() => {
        baseSceneRef.current = {
            doc,
            guides,
            selectionBounds: selectionBounds || null,
        };
        schedulePaint();
    }, [doc, guides, selectionBounds, schedulePaint]);

    const fitToViewport = React.useCallback((options?: {
        horizontalPadding?: number;
        topPadding?: number;
        bottomPadding?: number;
        minZoom?: number;
        maxZoom?: number;
    }): boolean => {
        const canvas = canvasRef.current;
        if (!canvas) return false;
        const viewport = canvas.closest(".dg-canvas-viewport");
        if (!(viewport instanceof HTMLElement)) return false;
        const viewportRect = viewport.getBoundingClientRect();
        const horizontalPadding = Math.max(24, Number(options?.horizontalPadding ?? 72));
        const topPadding = Math.max(24, Number(options?.topPadding ?? 108));
        const bottomPadding = Math.max(24, Number(options?.bottomPadding ?? 132));
        const availableWidth = Math.max(120, viewportRect.width - horizontalPadding * 2);
        const availableHeight = Math.max(120, viewportRect.height - topPadding - bottomPadding);
        const fitScale = Math.min(
            availableWidth / Math.max(1, Number(doc.canvas.width || 1)),
            availableHeight / Math.max(1, Number(doc.canvas.height || 1)),
        );
        if (!Number.isFinite(fitScale) || fitScale <= 0) return false;
        const minZoom = Number.isFinite(options?.minZoom) ? Number(options?.minZoom) : 0.05;
        const maxZoom = Number.isFinite(options?.maxZoom) ? Number(options?.maxZoom) : 3;
        const safeFitBase = Math.max(0.0001, fitBaseScale);
        const targetZoom = fitScale / safeFitBase;
        const nextZoom = Math.max(minZoom, Math.min(maxZoom, targetZoom));
        setZoom(nextZoom);
        return true;
    }, [doc.canvas.height, doc.canvas.width, fitBaseScale]);

    // Init compute client
    React.useEffect(() => {
        const client = createComputeClient({ enabled: !!flags.workerCompute, requestTimeoutMs: 5000 });
        computeClientRef.current = client;
        return () => {
            client.dispose();
            if (computeClientRef.current === client) computeClientRef.current = null;
        };
    }, [flags.workerCompute]);

    // Init render runtime
    React.useEffect(() => {
        let cancelled = false;
        let runtime: RenderRuntimeV2 | null = null;

        void (async () => {
            const { createRenderRuntimeV2 } = await import("../engine/render/runtimeV2");
            if (cancelled) return;
            runtime = createRenderRuntimeV2({
                offscreenPreferred: !!flags.offscreenRender,
                webglPreferred: !!flags.webglRender,
                webglAutoMinNodes: 900,
            });
            renderRuntimeRef.current = runtime;
            schedulePaint();
        })();

        return () => {
            cancelled = true;
            runtime?.dispose();
            if (renderRuntimeRef.current === runtime) renderRuntimeRef.current = null;
        };
    }, [flags.offscreenRender, flags.webglRender, schedulePaint]);

    // Preload images
    React.useEffect(() => {
        const srcs = collectDocImageSources(doc);
        srcs.forEach((src) => {
            if (imageCacheRef.current.has(src) || imageLoadPromisesRef.current.has(src)) return;
            const pending = preloadCanvasImage(src, imageCacheRef.current)
                .then((image) => {
                    if (image) bumpAssetVersion();
                    return image;
                })
                .finally(() => {
                    imageLoadPromisesRef.current.delete(src);
                });
            imageLoadPromisesRef.current.set(src, pending);
        });
    }, [bumpAssetVersion, doc.nodes]);

    React.useEffect(() => {
        const scheduler = paintSchedulerRef.current;
        return () => {
            scheduler.disposed = true;
            if (scheduler.frame != null) {
                window.cancelAnimationFrame(scheduler.frame);
                scheduler.frame = null;
            }
            previewSceneRef.current = null;
        };
    }, []);

    const showPreviewScene = React.useCallback((scene: {
        doc: PinselaTemplateDocV1;
        guides?: GuideLine[];
        selectionBounds?: { x: number; y: number; w: number; h: number } | null;
    }) => {
        previewSceneRef.current = {
            doc: scene.doc,
            guides: scene.guides ? [...scene.guides] : [],
            selectionBounds: scene.selectionBounds || null,
        };
        schedulePaint();
    }, [schedulePaint]);

    const clearPreviewScene = React.useCallback(() => {
        if (!previewSceneRef.current) return;
        previewSceneRef.current = null;
        schedulePaint();
    }, [schedulePaint]);

    function repaint() {
        bumpAssetVersion();
    }

    return {
        canvasRef,
        zoom,
        setZoom,
        fitToViewport,
        stageScale,
        imageCacheRef,
        computeClientRef,
        renderRuntimeRef,
        showPreviewScene,
        clearPreviewScene,
        repaint,
    };
}
