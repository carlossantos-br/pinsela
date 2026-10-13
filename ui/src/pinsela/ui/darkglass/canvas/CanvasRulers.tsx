import React from "react";
import type { GuideLine } from "../../../core/layout";

export const RULER_SIZE = 22;

export interface CanvasRulersProps {
  viewportRef: React.RefObject<HTMLDivElement | null>;
  artboardRef: React.RefObject<HTMLDivElement | null>;
  docWidth: number;
  docHeight: number;
  scale: number;
  guides: GuideLine[];
  onChangeGuides: (next: GuideLine[]) => void;
  dark?: boolean;
}

type Frame = { pageLeft: number; pageTop: number; scale: number; vw: number; vh: number; topOffset: number };

const STEP_CANDIDATES = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000];

function niceStep(scale: number): number {
  for (const s of STEP_CANDIDATES) {
    if (s * scale >= 56) return s;
  }
  return 20000;
}

/**
 * Figma/Photoshop-style rulers. Purely additive overlay: reads the active
 * artboard's on-screen rect each frame (no coupling to the interaction code)
 * and maps document px <-> screen px. Drag from a bar to create a guide;
 * drag a guide to move it; double-click (or drop off-page) to delete.
 * Guides commit into the existing `artboardGuides` store (source "page"), so
 * they render via the canvas painter and participate in snapping for free.
 */
export function CanvasRulers({
  viewportRef,
  artboardRef,
  docWidth,
  docHeight,
  scale,
  guides,
  onChangeGuides,
  dark = false,
}: CanvasRulersProps) {
  const topCanvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const leftCanvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const frameRef = React.useRef<Frame>({ pageLeft: 0, pageTop: 0, scale, vw: 0, vh: 0, topOffset: 0 });
  const cursorRef = React.useRef<{ x: number; y: number } | null>(null);
  const [frame, setFrame] = React.useState<Frame>(frameRef.current);
  const guidesRef = React.useRef(guides);
  guidesRef.current = guides;

  // Live drag state for creating/moving a guide.
  const dragRef = React.useRef<
    | null
    | { kind: "create" | "move"; axis: "x" | "y"; index: number; value: number }
  >(null);
  const [draft, setDraft] = React.useState<null | { axis: "x" | "y"; value: number; valid: boolean }>(null);

  void dark; // light-only interface
  const ink = { bg: "#f5f5f4", line: "rgba(23,23,23,0.28)", major: "rgba(23,23,23,0.62)", text: "rgba(23,23,23,0.72)", edge: "rgba(23,23,23,0.16)", cursor: "#2563eb" };

  // rAF loop: keep the rulers locked to the live artboard rect (which moves
  // with pan/zoom via DOM transforms we can't subscribe to).
  React.useEffect(() => {
    let raf = 0;
    let alive = true;
    const tick = () => {
      if (!alive) return;
      const vp = viewportRef.current;
      const ab = artboardRef.current;
      if (vp && ab) {
        const vr = vp.getBoundingClientRect();
        const ar = ab.getBoundingClientRect();
        // The local editor's main toolbar is a full-width bar pinned to the
        // viewport top; sit the rulers just below it so they never collide.
        const tb = vp.querySelector<HTMLElement>(".dg-context-toolbar");
        let topOffset = 0;
        if (tb) {
          const tr = tb.getBoundingClientRect();
          topOffset = Math.max(0, Math.round(tr.bottom - vr.top));
          if (topOffset > vr.height * 0.5) topOffset = 0; // ignore weird states
        }
        const next: Frame = {
          pageLeft: ar.left - vr.left,
          pageTop: ar.top - vr.top,
          scale,
          vw: vr.width,
          vh: vr.height,
          topOffset,
        };
        const prev = frameRef.current;
        if (
          Math.abs(prev.pageLeft - next.pageLeft) > 0.5 ||
          Math.abs(prev.pageTop - next.pageTop) > 0.5 ||
          Math.abs(prev.scale - next.scale) > 0.0005 ||
          Math.abs(prev.vw - next.vw) > 0.5 ||
          Math.abs(prev.vh - next.vh) > 0.5 ||
          Math.abs(prev.topOffset - next.topOffset) > 0.5
        ) {
          frameRef.current = next;
          setFrame(next);
        }
        drawRulers();
      }
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => {
      alive = false;
      window.cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale]);

  // Track pointer position over the viewport for the cursor indicator marks.
  React.useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const onMove = (e: PointerEvent) => {
      const vr = vp.getBoundingClientRect();
      cursorRef.current = { x: e.clientX - vr.left, y: e.clientY - vr.top };
    };
    const onLeave = () => {
      cursorRef.current = null;
    };
    vp.addEventListener("pointermove", onMove);
    vp.addEventListener("pointerleave", onLeave);
    return () => {
      vp.removeEventListener("pointermove", onMove);
      vp.removeEventListener("pointerleave", onLeave);
    };
  }, [viewportRef]);

  const drawRulers = React.useCallback(() => {
    const f = frameRef.current;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const step = niceStep(f.scale);
    const minor = step / 5;
    const cursor = cursorRef.current;

    const paint = (
      canvas: HTMLCanvasElement | null,
      axis: "x" | "y",
    ) => {
      if (!canvas) return;
      const cssW = axis === "x" ? Math.max(1, f.vw - RULER_SIZE) : RULER_SIZE;
      const cssH = axis === "x" ? RULER_SIZE : Math.max(1, f.vh - RULER_SIZE - f.topOffset);
      if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
        canvas.width = Math.round(cssW * dpr);
        canvas.height = Math.round(cssH * dpr);
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);
      ctx.fillStyle = ink.bg;
      ctx.fillRect(0, 0, cssW, cssH);
      ctx.fillStyle = ink.text;
      ctx.font = "9px ui-sans-serif, system-ui, sans-serif";
      ctx.textBaseline = "alphabetic";

      // origin offset: the top bar starts after the RULER_SIZE corner (doc 0 at
      // pageLeft - RULER_SIZE); the left bar starts below the toolbar + corner.
      const originScreen = axis === "x"
        ? f.pageLeft - RULER_SIZE
        : f.pageTop - f.topOffset - RULER_SIZE;
      const docSize = axis === "x" ? docWidth : docHeight;
      const barLen = axis === "x" ? cssW : cssH;

      const docStart = -originScreen / f.scale;
      const docEnd = (barLen - originScreen) / f.scale;
      const firstMinor = Math.floor(docStart / minor) * minor;

      ctx.lineWidth = 1;
      for (let d = firstMinor; d <= docEnd; d += minor) {
        const s = Math.round(originScreen + d * f.scale) + 0.5;
        if (s < 0 || s > barLen) continue;
        const isMajor = Math.abs(d % step) < 0.001 || Math.abs((d % step) - step) < 0.001;
        const within = d >= -0.001 && d <= docSize + 0.001;
        ctx.strokeStyle = isMajor ? ink.major : ink.line;
        const tickLen = isMajor ? RULER_SIZE * 0.5 : RULER_SIZE * 0.28;
        ctx.globalAlpha = within ? 1 : 0.45;
        ctx.beginPath();
        if (axis === "x") {
          ctx.moveTo(s, RULER_SIZE - tickLen);
          ctx.lineTo(s, RULER_SIZE);
        } else {
          ctx.moveTo(RULER_SIZE - tickLen, s);
          ctx.lineTo(RULER_SIZE, s);
        }
        ctx.stroke();
        if (isMajor) {
          const label = String(Math.round(d));
          ctx.fillStyle = ink.text;
          if (axis === "x") {
            ctx.fillText(label, s + 3, 9);
          } else {
            ctx.save();
            ctx.translate(9, s - 3);
            ctx.rotate(-Math.PI / 2);
            ctx.fillText(label, 0, 0);
            ctx.restore();
          }
        }
        ctx.globalAlpha = 1;
      }

      // cursor indicator
      if (cursor) {
        const cScreen = axis === "x" ? cursor.x - RULER_SIZE : cursor.y - f.topOffset - RULER_SIZE;
        if (cScreen >= 0 && cScreen <= barLen) {
          ctx.strokeStyle = ink.cursor;
          ctx.lineWidth = 1;
          ctx.beginPath();
          if (axis === "x") {
            ctx.moveTo(cScreen + 0.5, 0);
            ctx.lineTo(cScreen + 0.5, RULER_SIZE);
          } else {
            ctx.moveTo(0, cScreen + 0.5);
            ctx.lineTo(RULER_SIZE, cScreen + 0.5);
          }
          ctx.stroke();
        }
      }
    };

    paint(topCanvasRef.current, "x");
    paint(leftCanvasRef.current, "y");
  }, [docWidth, docHeight, ink.bg, ink.cursor, ink.line, ink.major, ink.text]);

  // Convert a clientX/clientY into a document coordinate on the given axis.
  const clientToDoc = React.useCallback(
    (axis: "x" | "y", clientX: number, clientY: number): number => {
      const vp = viewportRef.current;
      if (!vp) return 0;
      const vr = vp.getBoundingClientRect();
      const f = frameRef.current;
      if (axis === "x") return (clientX - vr.left - f.pageLeft) / f.scale;
      return (clientY - vr.top - f.pageTop) / f.scale;
    },
    [viewportRef],
  );

  const beginGuideDrag = React.useCallback(
    (kind: "create" | "move", axis: "x" | "y", index: number, e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const value = clientToDoc(axis, e.clientX, e.clientY);
      dragRef.current = { kind, axis, index, value };
      const docSize = axis === "x" ? docWidth : docHeight;
      setDraft({ axis, value, valid: value >= 0 && value <= docSize });

      const onMove = (ev: PointerEvent) => {
        const d = dragRef.current;
        if (!d) return;
        const v = clientToDoc(d.axis, ev.clientX, ev.clientY);
        const size = d.axis === "x" ? docWidth : docHeight;
        const valid = v >= -0.001 && v <= size + 0.001;
        dragRef.current = { ...d, value: v };
        setDraft({ axis: d.axis, value: v, valid });
        if (d.kind === "move") {
          // Live-update the moved guide so the painter reflects the drag.
          const next = guidesRef.current.slice();
          if (next[d.index]) {
            next[d.index] = { ...next[d.index], value: Math.max(0, Math.min(size, Math.round(v))) };
            onChangeGuides(next);
          }
        }
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        const d = dragRef.current;
        dragRef.current = null;
        setDraft(null);
        if (!d) return;
        const size = d.axis === "x" ? docWidth : docHeight;
        const inside = d.value >= 0 && d.value <= size;
        if (d.kind === "create") {
          if (inside) {
            const next = guidesRef.current.slice();
            next.push({ axis: d.axis, value: Math.round(d.value), source: "page" });
            onChangeGuides(next);
          }
        } else {
          // move: drop off-page deletes the guide.
          if (!inside) {
            const next = guidesRef.current.slice();
            next.splice(d.index, 1);
            onChangeGuides(next);
          }
        }
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [clientToDoc, docWidth, docHeight, onChangeGuides],
  );

  const removeGuide = React.useCallback(
    (index: number) => {
      const next = guidesRef.current.slice();
      next.splice(index, 1);
      onChangeGuides(next);
    },
    [onChangeGuides],
  );

  // Guide hit-strips (for moving/removing) + draft line.
  const pageLeft = frame.pageLeft;
  const pageTop = frame.pageTop;
  const s = frame.scale;
  const off = frame.topOffset;
  const contentTop = off + RULER_SIZE; // y where the canvas area (below both bars) begins

  return (
    <div className="ec-rulers" aria-hidden="true">
      <div className="ec-ruler-corner" style={{ top: off, background: ink.bg, borderColor: ink.edge }} />
      <div
        className="ec-ruler ec-ruler-top"
        style={{ top: off, left: RULER_SIZE, borderColor: ink.edge, cursor: "ew-resize" }}
        onPointerDown={(e) => beginGuideDrag("create", "x", -1, e)}
      >
        <canvas ref={topCanvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
      </div>
      <div
        className="ec-ruler ec-ruler-left"
        style={{ top: contentTop, borderColor: ink.edge, cursor: "ns-resize" }}
        onPointerDown={(e) => beginGuideDrag("create", "y", -1, e)}
      >
        <canvas ref={leftCanvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
      </div>

      {/* Interactive hit-strips over existing guides (move / double-click delete) */}
      <div className="ec-ruler-guide-layer">
        {guides.map((g, i) => {
          if (g.axis === "x") {
            const x = pageLeft + g.value * s;
            if (x < RULER_SIZE - 2 || x > frame.vw) return null;
            return (
              <div
                key={`gx-${i}-${g.value}`}
                className="ec-guide-strip ec-guide-strip-v"
                style={{ left: x - 4, top: contentTop, height: Math.max(0, frame.vh - contentTop) }}
                title="Drag to move · double-click to remove"
                onPointerDown={(e) => beginGuideDrag("move", "x", i, e)}
                onDoubleClick={(e) => { e.stopPropagation(); removeGuide(i); }}
              />
            );
          }
          const y = pageTop + g.value * s;
          if (y < contentTop - 2 || y > frame.vh) return null;
          return (
            <div
              key={`gy-${i}-${g.value}`}
              className="ec-guide-strip ec-guide-strip-h"
              style={{ top: y - 4, left: RULER_SIZE, width: Math.max(0, frame.vw - RULER_SIZE) }}
              title="Drag to move · double-click to remove"
              onPointerDown={(e) => beginGuideDrag("move", "y", i, e)}
              onDoubleClick={(e) => { e.stopPropagation(); removeGuide(i); }}
            />
          );
        })}

        {draft ? (
          draft.axis === "x" ? (
            <div
              className="ec-guide-draft ec-guide-draft-v"
              style={{ left: pageLeft + draft.value * s, top: contentTop, height: Math.max(0, frame.vh - contentTop), opacity: draft.valid ? 1 : 0.4 }}
            >
              <span className="ec-guide-readout">{Math.round(draft.value)}</span>
            </div>
          ) : (
            <div
              className="ec-guide-draft ec-guide-draft-h"
              style={{ top: pageTop + draft.value * s, left: RULER_SIZE, width: Math.max(0, frame.vw - RULER_SIZE), opacity: draft.valid ? 1 : 0.4 }}
            >
              <span className="ec-guide-readout">{Math.round(draft.value)}</span>
            </div>
          )
        ) : null}
      </div>
    </div>
  );
}
