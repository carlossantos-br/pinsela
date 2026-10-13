#!/usr/bin/env python3
"""Local dry-run render helper for the Pinsela agent loop.

Reads a native doc JSON, POSTs it to /api/agent/render on the local Pinsela
backend, saves the resulting PNG, and prints a small JSON summary.

Usage:
    python3 render_local.py <doc_path.json> [--out preview.png] [--scale 1.0]
                            [--api http://localhost:8000] [--bg as-is|transparent|white]
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import httpx


DEFAULT_APIS = ("http://localhost:8000", "http://localhost:8201")


def _eprint(*args: object) -> None:
    print(*args, file=sys.stderr)


def _build_headers() -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    tok = os.environ.get("PINSELA_AGENT_TOKEN", "").strip()
    if tok:
        headers["X-Agent-Token"] = tok
    return headers


def _post_render(
    *,
    api_base: str,
    doc: dict,
    scale: float,
    background_mode: str,
    timeout: float,
) -> httpx.Response:
    url = api_base.rstrip("/") + "/api/agent/render"
    body = {
        "doc": doc,
        "payload": {},
        "output_kind": "png",
        "scale": scale,
        "background_mode": background_mode,
        "return_format": "binary",
    }
    return httpx.post(url, json=body, headers=_build_headers(), timeout=timeout)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Pinsela agent dry-run render helper.")
    parser.add_argument("doc_path", help="Path to a native doc JSON file.")
    parser.add_argument("--out", default=None, help="Output PNG path (default: <doc>.preview.png).")
    parser.add_argument("--scale", type=float, default=1.0, help="Render scale (0.25-4.0).")
    parser.add_argument("--api", default=None, help="API base URL (default: tries 8000 then 8201).")
    parser.add_argument(
        "--bg",
        default="as-is",
        choices=("as-is", "transparent", "white"),
        help="Background mode.",
    )
    parser.add_argument("--timeout", type=float, default=30.0, help="HTTP timeout seconds.")
    args = parser.parse_args(argv)

    doc_path = Path(args.doc_path)
    if not doc_path.exists():
        _eprint(f"doc not found: {doc_path}")
        return 2
    try:
        doc = json.loads(doc_path.read_text(encoding="utf-8"))
    except Exception as exc:
        _eprint(f"invalid JSON in doc: {exc}")
        return 2

    out_path = Path(args.out) if args.out else doc_path.with_suffix(doc_path.suffix + ".preview.png")
    if args.out is None and doc_path.suffix.lower() == ".json":
        out_path = doc_path.with_suffix(".preview.png")

    api_candidates = [args.api] if args.api else list(DEFAULT_APIS)

    last_error: str = ""
    for api_base in api_candidates:
        try:
            resp = _post_render(
                api_base=api_base,
                doc=doc,
                scale=float(args.scale),
                background_mode=str(args.bg),
                timeout=float(args.timeout),
            )
        except httpx.ConnectError as exc:
            last_error = f"connection_refused:{api_base}:{exc}"
            continue
        except httpx.HTTPError as exc:
            last_error = f"http_error:{api_base}:{exc}"
            continue

        if resp.status_code == 200:
            out_path.parent.mkdir(parents=True, exist_ok=True)
            out_path.write_bytes(resp.content)
            summary = {
                "path": str(out_path),
                "width": int(resp.headers.get("X-Render-Width", "0") or 0),
                "height": int(resp.headers.get("X-Render-Height", "0") or 0),
                "bytes": int(resp.headers.get("X-Render-Bytes", str(len(resp.content))) or 0),
                "duration_ms": int(resp.headers.get("X-Render-Duration-Ms", "0") or 0),
                "sha256": resp.headers.get("X-Render-Sha256", ""),
                "api": api_base,
            }
            print(json.dumps(summary, ensure_ascii=False))
            return 0

        if resp.status_code == 404:
            _eprint("endpoint not mounted, restart uvicorn")
            _eprint(f"detail: {resp.text[:400]}")
            return 4
        if resp.status_code == 401:
            _eprint("set PINSELA_AGENT_TOKEN or run from loopback")
            _eprint(f"detail: {resp.text[:400]}")
            return 5
        if resp.status_code == 422:
            _eprint("doc failed validation:")
            try:
                _eprint(json.dumps(resp.json(), indent=2, ensure_ascii=False))
            except Exception:
                _eprint(resp.text[:1000])
            return 6
        last_error = f"http_{resp.status_code}:{resp.text[:300]}"
        # Non-recoverable status from this API base; try next.
        continue

    _eprint("is Pinsela running? try `scripts/local_start_pinsela.sh`")
    _eprint(f"last_error: {last_error}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
