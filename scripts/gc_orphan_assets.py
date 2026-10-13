#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from assets_maintenance_common import (
    OrphanGcStats,
    bootstrap_runtime,
    collect_asset_refs_from_doc,
    format_orphan_gc_summary,
    iter_db_native_docs,
    iter_native_doc_locations,
    load_disk_doc,
    path_within,
)


DEFAULT_BACKFILL_TAG = "dataurl-backfill"


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Safe cleanup of orphan InputAssets (not referenced by native docs in DB/disk). "
            "Dry-run by default."
        )
    )
    parser.add_argument("--apply", action="store_true", help="Applies deletions (default is dry-run).")
    parser.add_argument("--all-assets", action="store_true", help="Considers all assets (default: only the dataurl-backfill tag).")
    parser.add_argument(
        "--require-tag",
        action="append",
        default=[],
        help=(
            "Tag required to consider deletion (can be repeated). "
            "Ignored with --all-assets. Default: dataurl-backfill."
        ),
    )
    parser.add_argument("--min-age-hours", type=int, default=168, help="Minimum age in hours to be eligible (default: 168h).")
    parser.add_argument("--max-assets", type=int, default=0, help="Limits processed candidates (0 = no limit).")
    parser.add_argument("--db-only", action="store_true", help="Collect refs only from docs in the DB.")
    parser.add_argument("--disk-only", action="store_true", help="Collect refs only from docs on disk.")
    parser.add_argument("--keep-files", action="store_true", help="Deletes only the DB row (keeps the file on disk).")
    parser.add_argument("--report-json", type=str, default="", help="Saves a JSON report at this path.")
    parser.add_argument("--verbose", action="store_true", help="Shows details per candidate/error.")
    return parser


def _write_report(path_str: str, payload: dict[str, Any]) -> None:
    if not path_str:
        return
    path = Path(path_str).expanduser().resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _normalize_tags(raw_tags: Any) -> list[str]:
    if not isinstance(raw_tags, list):
        return []
    out: list[str] = []
    for item in raw_tags:
        tag = str(item or "").strip().lower()
        if tag:
            out.append(tag)
    return out


def _to_utc(value: Any) -> datetime | None:
    if not isinstance(value, datetime):
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def main() -> int:
    parser = _build_parser()
    args = parser.parse_args()

    if args.db_only and args.disk_only:
        parser.error("Use only one of --db-only and --disk-only.")

    include_db = not bool(args.disk_only)
    include_disk = not bool(args.db_only)
    require_tags = [] if args.all_assets else [
        str(tag or "").strip().lower()
        for tag in (args.require_tag or [DEFAULT_BACKFILL_TAG])
        if str(tag or "").strip()
    ]
    min_age_hours = max(0, int(args.min_age_hours or 0))
    cutoff = datetime.now(timezone.utc) - timedelta(hours=min_age_hours)
    max_assets = max(0, int(args.max_assets or 0))

    runtime = bootstrap_runtime()
    settings = runtime.get_settings()
    server_data_root = Path(settings.server_data_root).expanduser().resolve()
    asset_root = (server_data_root / "assets").resolve()

    stats = OrphanGcStats()
    referenced_asset_ids: set[str] = set()

    db = runtime.SessionLocal()
    try:
        if include_db:
            for row in iter_db_native_docs(db, runtime):
                stats.db_docs_scanned += 1
                try:
                    refs = collect_asset_refs_from_doc(row.engine_doc_json)
                    before = len(referenced_asset_ids)
                    referenced_asset_ids.update(refs)
                    stats.refs_from_db_docs += max(0, len(referenced_asset_ids) - before)
                except Exception as exc:
                    msg = f"db:{getattr(row, 'key', '?')}: {exc}"
                    stats.errors.append(msg)
                    if args.verbose:
                        print(f"[gc-assets] error       {msg}", file=sys.stderr)

        if include_disk:
            for location in iter_native_doc_locations(server_data_root):
                stats.disk_docs_scanned += 1
                try:
                    loaded = load_disk_doc(location, runtime)
                    if loaded is None:
                        continue
                    refs = collect_asset_refs_from_doc(loaded.doc_json)
                    before = len(referenced_asset_ids)
                    referenced_asset_ids.update(refs)
                    stats.refs_from_disk_docs += max(0, len(referenced_asset_ids) - before)
                except Exception as exc:
                    msg = f"disk:{location.path}: {exc}"
                    stats.errors.append(msg)
                    if args.verbose:
                        print(f"[gc-assets] error       {msg}", file=sys.stderr)

        InputAsset = runtime.InputAsset
        assets = db.query(InputAsset).order_by(InputAsset.created_at.asc()).all()
        stats.assets_total = len(assets)

        candidates_processed = 0
        for asset in assets:
            asset_id = str(asset.id)
            tags = _normalize_tags(getattr(asset, "tags", None))

            if require_tags and not all(tag in tags for tag in require_tags):
                stats.assets_skipped_tag += 1
                continue

            stats.assets_considered += 1

            if asset_id in referenced_asset_ids:
                stats.assets_referenced += 1
                continue

            created_at = _to_utc(getattr(asset, "created_at", None))
            if created_at is not None and created_at > cutoff:
                stats.assets_too_new += 1
                continue

            stats.candidates += 1
            if max_assets and candidates_processed >= max_assets:
                continue
            candidates_processed += 1

            if args.verbose:
                age_info = created_at.isoformat() if created_at else "unknown"
                print(f"[gc-assets] {'would_delete' if not args.apply else 'candidate':>11}  id={asset_id} created_at={age_info} tags={tags}")

            if not args.apply:
                continue

            if not args.keep_files:
                try:
                    server_path = Path(str(getattr(asset, "server_path", "") or ""))
                except Exception:
                    server_path = Path("")
                if server_path and str(server_path) != ".":
                    if not path_within(server_path, asset_root):
                        stats.skipped_outside_assets_root += 1
                        if args.verbose:
                            print(f"[gc-assets] skip_path   id={asset_id} path={server_path}")
                        continue
                    if server_path.exists() and server_path.is_file():
                        try:
                            server_path.unlink()
                            stats.deleted_files += 1
                        except Exception as exc:
                            msg = f"file:{asset_id}:{server_path}: {exc}"
                            stats.errors.append(msg)
                            if args.verbose:
                                print(f"[gc-assets] error       {msg}", file=sys.stderr)
                            continue
                    else:
                        stats.missing_files += 1

            try:
                db.delete(asset)
                db.commit()
                stats.deleted_rows += 1
            except Exception as exc:
                db.rollback()
                msg = f"db_delete:{asset_id}: {exc}"
                stats.errors.append(msg)
                if args.verbose:
                    print(f"[gc-assets] error       {msg}", file=sys.stderr)

        summary = format_orphan_gc_summary(stats)
        summary.update(
            {
                "mode": "apply" if args.apply else "dry_run",
                "server_data_root": str(server_data_root),
                "asset_root": str(asset_root),
                "sources": {"db": include_db, "disk": include_disk},
                "reference_set_size": len(referenced_asset_ids),
                "min_age_hours": min_age_hours,
                "cutoff_utc": cutoff.isoformat(),
                "keep_files": bool(args.keep_files),
                "tag_filter": None if args.all_assets else require_tags,
                "max_assets": max_assets or None,
            }
        )
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        _write_report(args.report_json, summary)
        return 0 if not stats.errors else 1
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
