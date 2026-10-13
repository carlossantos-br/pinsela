# ADR-005 - Design system separate from the engine core

Date: 2026-02-21  
Status: Accepted

## Context

Pinsela's core must stay engine-oriented (document, interaction and render), while the shell needs visual evolution and theming.

## Decision

Keep a proprietary design system isolated in the UI shell layer:

1. Versioned tokens in `tokens.json`.
2. Theme runtime via CSS variables.
3. Proprietary primitives (`PinselaButton`, `PinselaField`).
4. No Material UI dependency in the engine core.

## Consequences

1. Reduces visual coupling with engine logic.
2. Themes can change without direct impact on render/interaction.
3. Initial cost of maintaining an internal component library.
