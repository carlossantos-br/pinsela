#!/usr/bin/env python3
from __future__ import annotations

import argparse
import copy
import json
import sys
from pathlib import Path
from typing import Any

from assets_maintenance_common import (
    AssetRegistry,
    BackfillStats,
    bootstrap_runtime,
    format_backfill_summary,
    iter_db_native_docs,
    iter_native_doc_locations,
    load_disk_doc,
    mutate_doc_image_nodes,
    save_disk_doc,
)


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Backfill of DataURL images in native docs into InputAsset + a server-side blob. "
            "Dry-run by default."
        )
    )
    parser.add_argument("--apply", action="store_true", help="Applies changes (default is dry-run).")
    parser.add_argument("--db-only", action="store_true", help="Processes only native docs in the DB.")
    parser.add_argument("--disk-only", action="store_true", help="Processes only native docs on disk.")
    parser.add_argument("--max-docs", type=int, default=0, help="Limits the total number of processed docs (0 = no limit).")
    parser.add_argument("--report-json", type=str, default="", help="Saves a JSON report at this path.")
    parser.add_argument("--verbose", action="store_true", help="Shows details per changed doc/error.")
    return parser


def _write_report(path_str: str, payload: dict[str, Any]) -> None:
    if not path_str:
        return
    path = Path(path_str).expanduser().resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _patch_doc_images(
    doc: dict[str, Any],
    *,
    apply: bool,
    registry: AssetRegistry,
    stats: BackfillStats,
) -> int:
    def _mutate(node: dict[str, Any]) -> bool:
        src = str(node.get("image_src") or "").strip()
        if not src.startswith("data:image"):
            return False

        stats.dataurl_nodes_seen += 1
        result = registry.resolve_data_url(src, preferred_name=str(node.get("name") or "").strip() or None)
        if not result.can_patch:
            return False

        stats.patchable_nodes += 1
        if not apply:
            return True
        if not result.asset_id or not result.image_src:
            return False

        changed = False
        next_asset_id = str(result.asset_id)
        next_src = str(result.image_src)
        if str(node.get("image_asset_id") or "").strip() != next_asset_id:
            node["image_asset_id"] = next_asset_id
            changed = True
        if str(node.get("image_src") or "").strip() != next_src:
            node["image_src"] = next_src
            changed = True
        return changed

    image_nodes_seen, changed_nodes = mutate_doc_image_nodes(doc, _mutate)
    stats.image_nodes_seen += image_nodes_seen
    if apply:
        stats.patched_nodes += changed_nodes
    return changed_nodes


def main() -> int:
    parser = _build_parser()
    args = parser.parse_args()

    if args.db_only and args.disk_only:
        parser.error("Use only one of --db-only and --disk-only.")

    include_db = not bool(args.disk_only)
    include_disk = not bool(args.db_only)
    max_docs = max(0, int(args.max_docs or 0))

    runtime = bootstrap_runtime()
    settings = runtime.get_settings()
    server_data_root = Path(settings.server_data_root).expanduser().resolve()
    asset_root = server_data_root / "assets"

    stats = BackfillStats()
    docs_processed = 0

    asset_session = runtime.SessionLocal()
    doc_session = runtime.SessionLocal() if include_db else None
    registry = AssetRegistry(session=asset_session, runtime=runtime, asset_root=asset_root, apply=bool(args.apply), stats=stats)

    try:
        if include_db and doc_session is not None:
            for row in iter_db_native_docs(doc_session, runtime):
                if max_docs and docs_processed >= max_docs:
                    break
                docs_processed += 1
                stats.docs_scanned_db += 1

                try:
                    doc_json = copy.deepcopy(row.engine_doc_json)
                    changed_nodes = _patch_doc_images(doc_json, apply=bool(args.apply), registry=registry, stats=stats)
                    if changed_nodes <= 0:
                        continue
                    stats.docs_changed_db += 1
                    if args.verbose:
                        print(f"[backfill] {'would_update' if not args.apply else 'updated':>11}  db:{row.key} nodes={changed_nodes}")
                    if args.apply:
                        row.engine_doc_json = doc_json
                        doc_session.commit()
                except Exception as exc:
                    if args.apply and doc_session is not None:
                        doc_session.rollback()
                    msg = f"db:{getattr(row, 'key', '?')}: {exc}"
                    stats.errors.append(msg)
                    if args.verbose:
                        print(f"[backfill] error       {msg}", file=sys.stderr)

        if include_disk and (not max_docs or docs_processed < max_docs):
            for location in iter_native_doc_locations(server_data_root):
                if max_docs and docs_processed >= max_docs:
                    break
                docs_processed += 1
                stats.docs_scanned_disk += 1

                try:
                    loaded = load_disk_doc(location, runtime)
                    if loaded is None:
                        continue
                    changed_nodes = _patch_doc_images(loaded.doc_json, apply=bool(args.apply), registry=registry, stats=stats)
                    if changed_nodes <= 0:
                        continue
                    stats.docs_changed_disk += 1
                    if args.verbose:
                        print(
                            f"[backfill] {'would_update' if not args.apply else 'updated':>11}  "
                            f"disk:{loaded.location.path} nodes={changed_nodes}"
                        )
                    if args.apply:
                        save_disk_doc(loaded, runtime)
                except Exception as exc:
                    msg = f"disk:{location.path}: {exc}"
                    stats.errors.append(msg)
                    if args.verbose:
                        print(f"[backfill] error       {msg}", file=sys.stderr)

        summary = format_backfill_summary(stats)
        summary.update(
            {
                "mode": "apply" if args.apply else "dry_run",
                "server_data_root": str(server_data_root),
                "asset_root": str(asset_root),
                "docs_processed": docs_processed,
                "sources": {"db": include_db, "disk": include_disk},
                "max_docs": max_docs or None,
            }
        )
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        _write_report(args.report_json, summary)
        return 0 if not stats.errors else 1
    finally:
        try:
            if doc_session is not None:
                doc_session.close()
        finally:
            asset_session.close()


if __name__ == "__main__":
    raise SystemExit(main())
