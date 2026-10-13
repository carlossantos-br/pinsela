# ADR-003 - Render Runtime V2 with a pluggable backend

Date: 2026-02-21  
Status: Accepted

## Context

A single renderer does not cover every scenario predictably. We need to combine functional safety with acceleration.

## Decision

Standardize the `RendererBackend` interface and select backends dynamically:

1. `canvas2d-main-v2` as the safe fallback.
2. `offscreen-worker-v2` to isolate the UI thread.
3. `webgl-v1` for compatible dense scenes.

Selection is by heuristic plus scene support, with automatic fallback on error or lack of support.

## Consequences

1. Allows the renderer to evolve incrementally without rewriting the shell.
2. Requires per-frame telemetry (`drawCalls`, `triangles`, `fallbackReason`).
3. Increases the test surface across a browser/GPU matrix.
