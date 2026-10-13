#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Any


def _json_request(base_api: str, token: str, method: str, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    url = f"{base_api.rstrip('/')}{path}"
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    headers = {
        "X-Admin-Token": token,
        "Accept": "application/json",
    }
    if payload is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url=url, method=method.upper(), data=body, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=40) as resp:
            raw = resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {e.code} {method.upper()} {path}: {raw[:800]}") from e
    except urllib.error.URLError as e:
        raise RuntimeError(f"Network error {method.upper()} {path}: {e}") from e
    try:
        return json.loads(raw) if raw.strip() else {}
    except Exception as e:
        raise RuntimeError(f"Invalid JSON response for {method.upper()} {path}: {raw[:400]}") from e


def _bytes_request(base_api: str, token: str, path: str) -> bytes:
    url = f"{base_api.rstrip('/')}{path}"
    req = urllib.request.Request(url=url, method="GET", headers={"X-Admin-Token": token})
    try:
        with urllib.request.urlopen(req, timeout=40) as resp:
            return resp.read()
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {e.code} GET {path}: {raw[:800]}") from e


def _is_unsupported_endpoint(err: RuntimeError) -> bool:
    msg = str(err)
    return "HTTP 404" in msg or "HTTP 405" in msg


def _poll_job(base_api: str, token: str, job_id: str, timeout_sec: int) -> dict[str, Any]:
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        data = _json_request(base_api, token, "GET", f"/jobs/{job_id}")
        status = str((data.get("job") or {}).get("status") or "").upper()
        if status in {"DONE", "FAILED"}:
            return data
        time.sleep(2)
    raise RuntimeError(f"Timeout waiting job {job_id} after {timeout_sec}s")


def _build_smoke_doc() -> dict[str, Any]:
    return {
        "version": 1,
        "template_kind": "master1ofc",
        "canvas": {"width": 1080, "height": 1080, "background": "#f6efe4"},
        "root_id": "root",
        "nodes": [
            {
                "id": "root",
                "parent_id": None,
                "children_ids": ["title_1", "body_1", "cta_1"],
                "name": "ROOT",
                "kind": "frame",
                "geometry": {"x": 0, "y": 0, "width": 1080, "height": 1080, "rotation": 0, "corner_radius": 0, "clip": False, "z_index": 0},
                "layout": {"direction": "none", "gap": 0, "padding_top": 0, "padding_right": 0, "padding_bottom": 0, "padding_left": 0, "align_main": "start", "align_cross": "start", "sizing_mode": "fixed", "wrap": False},
                "constraints": {"x": "min", "y": "min", "width": "fixed", "height": "fixed"},
                "style": {"visible": True, "locked": False, "opacity": 1, "blend_mode": "normal", "fill": "#f6efe4", "stroke": None, "effects": [], "image_fit": "fill", "image_crop": None, "mask": False},
                "text": None,
                "text_style": {"family": "Inter", "postscript": "Inter-Regular", "style": "Regular", "size": 42, "line_height": 110, "line_height_unit": "percent", "letter_spacing": 0, "text_align": "left", "vertical_align": "top"},
                "text_runs": [],
                "text_path": None,
                "image_src": None,
                "editable": False,
                "component_instance": None,
            },
            {
                "id": "title_1",
                "parent_id": "root",
                "children_ids": [],
                "name": "TITLE1",
                "kind": "text",
                "geometry": {"x": 120, "y": 180, "width": 840, "height": 120, "rotation": 0, "corner_radius": 0, "clip": False, "z_index": 1},
                "layout": {"direction": "none", "gap": 0, "padding_top": 0, "padding_right": 0, "padding_bottom": 0, "padding_left": 0, "align_main": "start", "align_cross": "start", "sizing_mode": "fixed", "wrap": False},
                "constraints": {"x": "min", "y": "min", "width": "fixed", "height": "fixed"},
                "style": {"visible": True, "locked": False, "opacity": 1, "blend_mode": "normal", "fill": "#111111", "stroke": None, "effects": [], "image_fit": "fill", "image_crop": None, "mask": False},
                "text": "Smoke",
                "text_style": {"family": "Inter", "postscript": "Inter-Bold", "style": "Bold", "size": 78, "line_height": 96, "line_height_unit": "percent", "letter_spacing": 0, "text_align": "center", "vertical_align": "top", "color": "#111111"},
                "text_runs": [],
                "text_path": None,
                "image_src": None,
                "editable": True,
                "component_instance": None,
            },
            {
                "id": "body_1",
                "parent_id": "root",
                "children_ids": [],
                "name": "BODY1",
                "kind": "text",
                "geometry": {"x": 140, "y": 334, "width": 800, "height": 180, "rotation": 0, "corner_radius": 0, "clip": False, "z_index": 2},
                "layout": {"direction": "none", "gap": 0, "padding_top": 0, "padding_right": 0, "padding_bottom": 0, "padding_left": 0, "align_main": "start", "align_cross": "start", "sizing_mode": "fixed", "wrap": False},
                "constraints": {"x": "min", "y": "min", "width": "fixed", "height": "fixed"},
                "style": {"visible": True, "locked": False, "opacity": 1, "blend_mode": "normal", "fill": "#222222", "stroke": None, "effects": [], "image_fit": "fill", "image_crop": None, "mask": False},
                "text": "Pipeline end-to-end",
                "text_style": {"family": "Inter", "postscript": "Inter-Regular", "style": "Regular", "size": 40, "line_height": 110, "line_height_unit": "percent", "letter_spacing": 0, "text_align": "center", "vertical_align": "top", "color": "#222222"},
                "text_runs": [],
                "text_path": None,
                "image_src": None,
                "editable": True,
                "component_instance": None,
            },
            {
                "id": "cta_1",
                "parent_id": "root",
                "children_ids": [],
                "name": "CTA",
                "kind": "rect",
                "geometry": {"x": 340, "y": 760, "width": 400, "height": 120, "rotation": 0, "corner_radius": 60, "clip": False, "z_index": 3},
                "layout": {"direction": "none", "gap": 0, "padding_top": 0, "padding_right": 0, "padding_bottom": 0, "padding_left": 0, "align_main": "start", "align_cross": "start", "sizing_mode": "fixed", "wrap": False},
                "constraints": {"x": "min", "y": "min", "width": "fixed", "height": "fixed"},
                "style": {"visible": True, "locked": False, "opacity": 1, "blend_mode": "normal", "fill": "#111111", "stroke": None, "effects": [], "image_fit": "fill", "image_crop": None, "mask": False},
                "text": None,
                "text_style": {"family": "Inter", "postscript": "Inter-Regular", "style": "Regular", "size": 32, "line_height": 110, "line_height_unit": "percent", "letter_spacing": 0, "text_align": "center", "vertical_align": "top"},
                "text_runs": [],
                "text_path": None,
                "image_src": None,
                "editable": False,
                "component_instance": None,
            },
        ],
        "bindings": {
            "text": {
                "title1": {
                    "node_id": "title_1",
                    "required": True,
                    "max_length": 48,
                    "fit": {"start_size": 78, "min_size": 50, "max_lines": 2, "min_lines": 1, "truncate_mode": "none"},
                    "font": {"family": "Inter", "postscript": "Inter-Bold", "style": "Bold", "size": 78, "line_height": 96, "line_height_unit": "percent", "letter_spacing": 0, "text_align": "center", "vertical_align": "top"},
                    "label": "Titulo",
                },
                "body1": {
                    "node_id": "body_1",
                    "required": True,
                    "max_length": 120,
                    "fit": {"start_size": 40, "min_size": 26, "max_lines": 3, "min_lines": 1, "truncate_mode": "none"},
                    "font": {"family": "Inter", "postscript": "Inter-Regular", "style": "Regular", "size": 40, "line_height": 110, "line_height_unit": "percent", "letter_spacing": 0, "text_align": "center", "vertical_align": "top"},
                    "label": "Body",
                },
            },
            "images_single": {},
            "images_array": {},
            "product_frames": None,
        },
        "dynamic_rules": [],
        "metadata": {
            "source": "e2e-smoke",
            "components": {"definitions": []},
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Native E2E smoke test: upload/publish/create/download")
    parser.add_argument("--base-api", default=os.getenv("PINSELA_API_BASE", "http://localhost:8000/api"))
    parser.add_argument("--admin-token", default=os.getenv("PINSELA_ADMIN_TOKEN", ""))
    parser.add_argument("--timeout-sec", type=int, default=300)
    parser.add_argument("--template-key", default="")
    args = parser.parse_args()

    token = str(args.admin_token or "").strip()
    if not token:
        print("PINSELA_ADMIN_TOKEN is missing", file=sys.stderr)
        return 2

    now = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    template_key = (args.template_key or f"pinsela_smoke_{now}").strip().lower()
    if len(template_key) > 63:
        template_key = template_key[:63]

    doc = _build_smoke_doc()
    summary: dict[str, Any] = {
        "template_key": template_key,
        "base_api": args.base_api,
        "steps": {},
    }

    up = _json_request(
        args.base_api,
        token,
        "POST",
        "/templates/upload-native",
        {
            "template_key": template_key,
            "template_name": f"Smoke {now}",
            "doc_json": doc,
            "source": "e2e-smoke",
        },
    )
    summary["steps"]["upload_native"] = {"ok": bool(up.get("ok")), "pack_version": up.get("pack_version")}

    draft_doc = json.loads(json.dumps(doc))
    for n in draft_doc.get("nodes") or []:
        if n.get("id") == "title_1":
            n["text"] = f"Smoke Draft {now[-4:]}"
    try:
        draft = _json_request(
            args.base_api,
            token,
            "POST",
            f"/templates/{template_key}/native/draft",
            {"doc_json": draft_doc, "source": "e2e-smoke-draft"},
        )
        summary["steps"]["save_draft"] = {"ok": bool(draft.get("ok")), "status": draft.get("status")}
    except RuntimeError as err:
        if _is_unsupported_endpoint(err):
            summary["steps"]["save_draft"] = {"ok": False, "skipped": True, "reason": "endpoint_not_available"}
        else:
            raise

    try:
        pub = _json_request(
            args.base_api,
            token,
            "POST",
            f"/templates/{template_key}/native/publish",
            {"use_draft": True, "source": "e2e-smoke-publish"},
        )
        summary["steps"]["publish_native"] = {
            "ok": bool(pub.get("ok")),
            "pack_version": pub.get("pack_version"),
            "published_from": pub.get("published_from"),
        }
    except RuntimeError as err:
        if _is_unsupported_endpoint(err):
            summary["steps"]["publish_native"] = {"ok": False, "skipped": True, "reason": "endpoint_not_available"}
        else:
            raise

    create_job = _json_request(
        args.base_api,
        token,
        "POST",
        "/jobs/create-artworks",
        {
            "count": 1,
            "template_key": template_key,
            "content": {"title1": f"Smoke {now}", "body1": "E2E flow", "price1": "R$ 99,90"},
            "render_local": True,
            "output_kind": "png",
        },
    )
    job_id = str(create_job.get("job_id") or "").strip()
    if not job_id:
        raise RuntimeError("create-artworks did not return a job_id")
    job_done = _poll_job(args.base_api, token, job_id, args.timeout_sec)
    job_status = str((job_done.get("job") or {}).get("status") or "")
    summary["steps"]["create_artwork_job"] = {"job_id": job_id, "status": job_status}
    if job_status != "DONE":
        summary["steps"]["create_artwork_job"]["error"] = job_done.get("error")
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return 1

    created = ((job_done.get("result") or {}).get("created") or [{}])[0]
    artwork_id = str(created.get("artwork_id") or "").strip()
    version_id = str(created.get("version_id") or "").strip()
    if not artwork_id or not version_id:
        raise RuntimeError("job result has no artwork_id/version_id")

    art = _json_request(args.base_api, token, "GET", f"/artworks/{artwork_id}")
    exports_by_version = art.get("exports_by_version") if isinstance(art.get("exports_by_version"), dict) else {}
    version_exports = exports_by_version.get(version_id) if isinstance(exports_by_version.get(version_id), list) else []
    if not version_exports:
        # fallback: take the first non-empty list
        for _vid, items in exports_by_version.items():
            if isinstance(items, list) and items:
                version_exports = items
                break
    if not version_exports:
        raise RuntimeError("no export found for artwork/version")

    export_asset_id = str(version_exports[0].get("id") or "").strip()
    if not export_asset_id:
        raise RuntimeError("export asset has no id")
    blob = _bytes_request(args.base_api, token, f"/exports/{export_asset_id}")
    if len(blob) < 1024:
        raise RuntimeError(f"exported file too small: {len(blob)} bytes")
    summary["steps"]["download_export"] = {
        "asset_id": export_asset_id,
        "bytes": len(blob),
        "artwork_id": artwork_id,
        "version_id": version_id,
    }

    try:
        bulk = _json_request(
            args.base_api,
            token,
            "POST",
            "/jobs/create-artworks-bulk",
            {
                "template_key": template_key,
                "rows": [
                    {"title1": f"Bulk A {now[-3:]}", "body1": "A", "price1": "R$ 10,00"},
                    {"title1": f"Bulk B {now[-3:]}", "body1": "B", "price1": "R$ 20,00"},
                ],
                "output_kind": "png",
                "render_local": True,
            },
        )
        items = bulk.get("items") if isinstance(bulk.get("items"), list) else []
        bulk_job_ids = [str(it.get("job_id") or "").strip() for it in items if it.get("ok")]
        bulk_statuses: list[str] = []
        for jid in bulk_job_ids[:2]:
            if not jid:
                continue
            data = _poll_job(args.base_api, token, jid, args.timeout_sec)
            bulk_statuses.append(str((data.get("job") or {}).get("status") or ""))
        summary["steps"]["bulk_create"] = {
            "created": bulk.get("created"),
            "failed": bulk.get("failed"),
            "job_statuses": bulk_statuses,
        }
    except RuntimeError as err:
        if _is_unsupported_endpoint(err):
            summary["steps"]["bulk_create"] = {"ok": False, "skipped": True, "reason": "endpoint_not_available"}
        else:
            raise

    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise
