# ADR-004 - Compute in a Worker with a typed protocol

Date: 2026-02-21  
Status: Accepted

## Context

Hit-testing, snapping and CSV parsing on large scenes increase latency on the UI thread.

## Decision

Move heavy computation to `EngineComputeWorker` with a typed protocol and a synchronous fallback on the main thread.

Covered operations:

1. `hit_test_top`
2. `hit_test_all`
3. `cycle_hit`
4. `snap_move`
5. `selection_bounds`
6. `parse_csv_payloads`

A `latest-only` queue is applied to high-frequency operations (`snap_move`) to avoid backlog.

## Consequences

1. The UI is less likely to stall during continuous drags.
2. Serialization overhead becomes an explicit tradeoff.
3. Requires parity tests between the worker and the fallback.
