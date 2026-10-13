#!/usr/bin/env python3
"""'Single version' migration (spec 2026-06-22 §7) — lossless, idempotent.

For each native project: if the draft (native/draft/doc.json) is NEWER than
the canonical doc (native/doc.json + DB engine_doc_json) and differs from it, promote the
draft to the live version — snapshotting the current canonical doc into history first (nothing is
lost). Otherwise, no-op.

Usage:
    python scripts/migrate_single_version.py            # dry-run (does not write)
    python scripts/migrate_single_version.py --apply    # actually apply

Idempotent: after promoting, the canonical doc becomes the newest → re-running
does nothing.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
API_DIR = ROOT / "apps" / "api"


def _load_env(env_path: Path) -> None:
    if not env_path.exists():
        return
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


def decide_migration(
    draft_doc: dict | None,
    draft_mtime: float,
    canonical_doc: dict | None,
    canonical_mtime: float,
) -> str:
    """Pure decision: 'promote-draft' or 'noop'."""
    if not draft_doc:
        return "noop"
    if not canonical_doc:
        return "promote-draft"
    if json.dumps(draft_doc, sort_keys=True) == json.dumps(canonical_doc, sort_keys=True):
        return "noop"
    return "promote-draft" if draft_mtime > canonical_mtime else "noop"


def _mtime(path: Path) -> float:
    try:
        return path.stat().st_mtime
    except OSError:
        return 0.0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="apply (default: dry-run)")
    args = parser.parse_args(argv)
    dry = not args.apply

    _load_env(API_DIR / ".env.v2")
    sys.path.insert(0, str(API_DIR))
    from pinsela.api.routers import templates  # noqa: E402
    from pinsela.db import SessionLocal  # noqa: E402

    projects_root = templates._project_packs_root()
    print(f"{'[DRY-RUN] ' if dry else '[APPLY] '}data root: {projects_root}\n")

    promote: list[str] = []
    noop: list[str] = []
    failed: list[str] = []

    for proj_dir in sorted(p for p in projects_root.iterdir() if p.is_dir()):
        key = proj_dir.name
        native_root = templates._native_root_for_read(key)
        draft_root = templates._native_draft_root_for_read(key)
        canonical_doc = templates._read_native_doc_from_dir(native_root)
        draft_doc = templates._read_native_doc_from_dir(draft_root)
        c_m = _mtime(native_root / "doc.json")
        d_m = _mtime(draft_root / "doc.json")

        action = decide_migration(draft_doc, d_m, canonical_doc, c_m)
        if action == "noop":
            noop.append(key)
            continue

        print(f"PROMOTE draft→live: {key}  (draft mtime {d_m:.0f} > canonical {c_m:.0f})")
        promote.append(key)
        if dry:
            continue

        try:
            session = SessionLocal()
            try:
                meta = templates._read_json_object(native_root / "pack.meta.json") or {}
                name = str(meta.get("template_name") or meta.get("project_name") or key)
                # 1) snapshot of the current canonical doc (safety, pre-migration)
                if canonical_doc:
                    templates._publish_native_doc(
                        db=session,
                        template_key=key,
                        template_name=name,
                        doc_json=templates.validate_native_doc(dict(canonical_doc)),
                        preview_bytes=templates._read_native_preview_from_dir(native_root),
                        source="pre-migration-canonical",
                    )
                # 2) promote the draft to the live version (DB + disk)
                templates._sync_native_current_doc(
                    template_key=key,
                    doc_json=templates.validate_native_doc(dict(draft_doc)),
                    preview_bytes=templates._read_native_preview_from_dir(draft_root),
                    source="migration-promote-draft",
                    db=session,
                )
            finally:
                session.close()
        except Exception as e:  # noqa: BLE001
            print(f"  ERROR in {key}: {e}")
            failed.append(key)

    print(
        f"\nResumo: promote={len(promote)} noop={len(noop)} failed={len(failed)}"
        f"{' (dry-run, nothing written)' if dry else ''}"
    )
    if failed:
        print("Failed:", ", ".join(failed))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
