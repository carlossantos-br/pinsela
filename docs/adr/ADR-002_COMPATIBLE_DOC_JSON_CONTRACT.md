# ADR-002 - `doc_json` contract stays compatible throughout the migration

Date: 2026-02-21  
Status: Accepted

## Context

The native backend and the publish/export pipeline depend on the `doc_json` contract. Breaking compatibility mid-migration would block operations and version restore.

## Decision

Keep `doc_json` as the canonical contract until the end of the program (phase 8), with only backward-compatible changes.

Rules:

1. Existing fields do not change without a fallback.
2. New fields are optional.
3. Preflight validations reject inconsistent payloads/docs before export/publish.

## Consequences

1. Preserves interoperability with the current native endpoints.
2. Reduces the risk of corruption in versions/restore.
3. Limits model changes without an adaptation layer.
