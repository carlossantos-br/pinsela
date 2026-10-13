# ADR-001 - Incremental migration behind flags

Date: 2026-02-21  
Status: Accepted

## Context

Pinsela has critical create, export and publish flows. A full rewrite would increase the risk of functional regressions and make rollback slow.

## Decision

Adopt a phased migration with independent feature flags:

1. `VITE_PINSELA_ENGINE_V2`
2. `VITE_PINSELA_WORKER_COMPUTE`
3. `VITE_PINSELA_OFFSCREEN_RENDER`
4. `VITE_PINSELA_WEBGL_RENDER`
5. `VITE_PINSELA_INTERACTION_V2`
6. `VITE_PINSELA_DESIGN_SYSTEM_V2`

Each phase ships with an immediate fallback to the stable path.

## Consequences

1. Operational rollback in minutes, without a structural redeploy.
2. Higher temporary maintenance cost because both paths coexist.
3. Strong observability is required to decide on rollout.
