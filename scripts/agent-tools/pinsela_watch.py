#!/usr/bin/env python3
"""pinsela_watch — auto-broadcast a doc.json file on every save.

Usage:
    python3 pinsela_watch.py <doc.json> [--scale 1.0] [--bg as-is|white|transparent]
                                       [--interval 0.5]

Polls the file's mtime every ``--interval`` seconds (default 500ms) and POSTs
to ``/api/agent/preview/render-and-broadcast`` whenever the file changes. The
preview page (``http://localhost:8000/preview``) updates instantly via SSE.

This is the loop that turns "agent edits doc -> see render" into a sub-second
feedback cycle: no curl, no Read tool, no waiting.

Stdlib only. Ctrl+C to stop.
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import sys
import time
import urllib.error
import urllib.request


DEFAULT_BASE = os.environ.get("PINSELA_API_BASE", "http://127.0.0.1:8000")
RENDER_PATH = "/api/agent/preview/render-and-broadcast"


def _post_doc(
    base: str,
    doc: dict,
    *,
    scale: float,
    background_mode: str,
    label: str | None,
    token: str | None,
) -> tuple[bool, str]:
    url = base.rstrip("/") + RENDER_PATH
    body: dict = {
        "doc": doc,
        "scale": float(scale),
        "background_mode": background_mode,
        "output_kind": "png",
    }
    if label:
        body["label"] = label
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
            payload = json.loads(resp.read().decode("utf-8"))
        rec = payload.get("render", {})
        return True, (
            f"sha={rec.get('sha256','')[:10]} "
            f"{rec.get('width')}x{rec.get('height')} "
            f"clients={payload.get('connected_clients', 0)} "
            f"{rec.get('duration_ms','?')}ms"
        )
    except urllib.error.HTTPError as e:
        try:
            payload = e.read().decode("utf-8")
        except Exception:  # noqa: BLE001
            payload = ""
        return False, f"HTTP {e.code}: {payload[:200]}"
    except urllib.error.URLError as e:
        return False, f"unreachable: {e.reason}"
    except Exception as e:  # noqa: BLE001
        return False, f"{type(e).__name__}: {e}"


def _stamp() -> str:
    return time.strftime("%H:%M:%S")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("doc", help="Path to pinsela_native_v1 doc JSON.")
    parser.add_argument("--scale", type=float, default=1.0)
    parser.add_argument(
        "--bg",
        choices=["as-is", "white", "transparent"],
        default="as-is",
        dest="background_mode",
    )
    parser.add_argument(
        "--interval", type=float, default=0.5, help="Poll seconds (default 0.5)."
    )
    parser.add_argument(
        "--label", default=None, help="Optional label included in each broadcast."
    )
    parser.add_argument("--base", default=DEFAULT_BASE)
    parser.add_argument(
        "--no-initial",
        action="store_true",
        help="Skip the immediate render on startup; wait for the first change.",
    )
    args = parser.parse_args(argv)

    doc_path = pathlib.Path(args.doc).expanduser().resolve()
    if not doc_path.exists():
        print(f"[pinsela_watch] doc not found: {doc_path}", file=sys.stderr)
        return 2

    token = os.environ.get("PINSELA_AGENT_TOKEN") or None
    print(f"[pinsela_watch] {_stamp()} watching {doc_path}")
    print(
        f"[pinsela_watch] {_stamp()} post -> {args.base.rstrip('/')}{RENDER_PATH}"
    )
    print(f"[pinsela_watch] {_stamp()} preview -> {args.base.rstrip('/')}/preview")
    print("[pinsela_watch] Ctrl+C to stop.")

    last_mtime = 0.0
    last_size = -1

    def _read_doc() -> dict | None:
        try:
            return json.loads(doc_path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return None
        except json.JSONDecodeError as e:
            print(
                f"[pinsela_watch] {_stamp()} JSON parse error: {e} (skipping)",
                file=sys.stderr,
            )
            return None

    # Optional initial render so the page is not blank.
    if not args.no_initial:
        doc = _read_doc()
        if doc is not None:
            ok, info = _post_doc(
                args.base,
                doc,
                scale=args.scale,
                background_mode=args.background_mode,
                label=args.label,
                token=token,
            )
            tag = "OK" if ok else "FAIL"
            print(f"[pinsela_watch] {_stamp()} initial {tag} {info}")
        try:
            last_mtime = doc_path.stat().st_mtime
            last_size = doc_path.stat().st_size
        except OSError:
            pass

    try:
        while True:
            try:
                st = doc_path.stat()
                mtime, size = st.st_mtime, st.st_size
            except FileNotFoundError:
                time.sleep(args.interval)
                continue

            if mtime != last_mtime or size != last_size:
                # Tiny debounce: wait one more interval, re-check stability.
                time.sleep(args.interval)
                try:
                    st2 = doc_path.stat()
                except FileNotFoundError:
                    continue
                if st2.st_mtime != mtime or st2.st_size != size:
                    # File still changing — pick up the newer one next loop.
                    last_mtime, last_size = st2.st_mtime, st2.st_size
                    continue

                last_mtime, last_size = mtime, size
                doc = _read_doc()
                if doc is None:
                    continue
                ok, info = _post_doc(
                    args.base,
                    doc,
                    scale=args.scale,
                    background_mode=args.background_mode,
                    label=args.label,
                    token=token,
                )
                tag = "OK" if ok else "FAIL"
                print(f"[pinsela_watch] {_stamp()} change {tag} {info}")
            else:
                time.sleep(args.interval)
    except KeyboardInterrupt:
        print(f"\n[pinsela_watch] {_stamp()} stopped.")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
