#!/usr/bin/env python3
"""pinsela_preview — POST a doc.json to the hot-reload preview server.

Usage:
    python3 pinsela_preview.py <doc.json> [--scale 1.0] [--bg as-is|white|transparent]
                                         [--label "checkpoint"] [--no-open]

Sends the document to ``POST /api/agent/preview/render-and-broadcast`` so every
browser currently watching ``http://localhost:8000/preview`` updates
instantly. On the first invocation we also try to open the preview page in
the default browser (macOS ``open`` command) — pass ``--no-open`` to skip.

Stdlib only (urllib). The optional ``PINSELA_AGENT_TOKEN`` env var is forwarded
as the ``X-Agent-Token`` header.
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import subprocess
import sys
import urllib.error
import urllib.request


DEFAULT_BASE = os.environ.get("PINSELA_API_BASE", "http://127.0.0.1:8000")
PREVIEW_PAGE = "/preview"
RENDER_PATH = "/api/agent/preview/render-and-broadcast"
OPEN_FLAG_FILE = pathlib.Path("/tmp/pinsela_preview_opened.flag")


def _post_json(url: str, body: dict, token: str | None) -> dict:
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    if token:
        req.add_header("X-Agent-Token", token)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            payload = e.read().decode("utf-8")
        except Exception:  # noqa: BLE001
            payload = ""
        raise SystemExit(
            f"[pinsela_preview] HTTP {e.code} from {url}\n{payload}"
        ) from e
    except urllib.error.URLError as e:
        raise SystemExit(
            f"[pinsela_preview] cannot reach {url}: {e.reason}\n"
            "Is the pinsela API running on 127.0.0.1:8000?"
        ) from e


def _maybe_open_browser(base: str) -> None:
    if OPEN_FLAG_FILE.exists():
        return
    if sys.platform != "darwin":
        return
    try:
        subprocess.run(
            ["open", base + PREVIEW_PAGE],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        OPEN_FLAG_FILE.write_text("opened\n")
    except Exception:  # noqa: BLE001
        pass


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("doc", help="Path to pinsela_native_v1 doc JSON file.")
    parser.add_argument("--scale", type=float, default=1.0)
    parser.add_argument(
        "--bg",
        choices=["as-is", "white", "transparent"],
        default="as-is",
        dest="background_mode",
    )
    parser.add_argument("--label", default=None)
    parser.add_argument("--base", default=DEFAULT_BASE)
    parser.add_argument("--no-open", action="store_true")
    args = parser.parse_args(argv)

    doc_path = pathlib.Path(args.doc).expanduser().resolve()
    if not doc_path.exists():
        print(f"[pinsela_preview] doc not found: {doc_path}", file=sys.stderr)
        return 2
    try:
        doc = json.loads(doc_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        print(f"[pinsela_preview] invalid JSON: {e}", file=sys.stderr)
        return 2

    if not args.no_open:
        _maybe_open_browser(args.base)

    url = args.base.rstrip("/") + RENDER_PATH
    body = {
        "doc": doc,
        "scale": float(args.scale),
        "background_mode": args.background_mode,
        "output_kind": "png",
    }
    if args.label:
        body["label"] = args.label

    token = os.environ.get("PINSELA_AGENT_TOKEN") or None
    resp = _post_json(url, body, token)
    if not resp.get("ok"):
        print(f"[pinsela_preview] server returned not-ok: {resp}", file=sys.stderr)
        return 1
    rec = resp.get("render", {})
    print(
        "[pinsela_preview] broadcast OK  "
        f"sha={rec.get('sha256','')[:12]} "
        f"size={rec.get('width')}x{rec.get('height')} "
        f"bytes={rec.get('bytes')} "
        f"clients={resp.get('connected_clients', 0)}"
    )
    print(f"[pinsela_preview] view at {args.base.rstrip('/')}{PREVIEW_PAGE}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
