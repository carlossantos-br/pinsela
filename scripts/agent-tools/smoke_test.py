#!/usr/bin/env python3
"""End-to-end integration smoke test for the pinsela-canvas skill + tooling.

Runs every CLI verb at least once against a throwaway doc in a tempdir, then
validates every example and pattern shipped with the skill, then (if the
local Pinsela backend has the agent router deployed) renders a doc and asserts
that the PNG was produced.

Designed to fail loudly with actionable messages. Stdlib only — no external
deps. Output is plain ASCII with [OK]/[FAIL]/[SKIP]/[WARN] tags so it works
inside log capture pipelines.

Exit code: 0 if no FAILs (SKIP/WARN allowed), 1 otherwise.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

# --------------------------------------------------------------------------- #
# Config / paths
# --------------------------------------------------------------------------- #

PINSELA_ROOT = Path(__file__).resolve().parents[2]
AGENT_TOOLS = PINSELA_ROOT / "scripts" / "agent-tools"
CLI = AGENT_TOOLS / "pinsela_canvas.py"
PINSELA_VENV_PY = PINSELA_ROOT / "apps" / "api" / ".venv" / "bin" / "python"
PATTERNS_DIR = Path(os.environ.get("PINSELA_PATTERN_DIR") or PINSELA_ROOT / "patterns")
EXAMPLES_DIR = Path(os.environ.get("PINSELA_EXAMPLES_DIR") or PINSELA_ROOT / "examples")


def _python_for_render() -> str:
    """Pick an interpreter that can run the CLI's render command.

    The render command imports httpx. We prefer the pinsela backend venv
    (which always has httpx + pillow). Fall back to the current interpreter,
    which will fail loudly with an actionable message if httpx is missing.
    """
    if PINSELA_VENV_PY.exists():
        try:
            r = subprocess.run(
                [str(PINSELA_VENV_PY), "-c", "import httpx"],
                capture_output=True,
                timeout=5,
            )
            if r.returncode == 0:
                return str(PINSELA_VENV_PY)
        except Exception:
            pass
    return sys.executable

HEALTH_URLS = (
    "http://127.0.0.1:8000/api/agent/health",
    "http://127.0.0.1:8201/api/agent/health",
)

# --------------------------------------------------------------------------- #
# Reporting
# --------------------------------------------------------------------------- #

RESULTS: list[tuple[str, str, str]] = []  # (status, step, detail)


def _log(status: str, step: str, detail: str = "") -> None:
    tag = f"[{status}]".ljust(7)
    line = f"{tag} {step}"
    if detail:
        line += f"  -- {detail}"
    print(line, flush=True)
    RESULTS.append((status, step, detail))


def ok(step: str, detail: str = "") -> None:
    _log("OK", step, detail)


def fail(step: str, detail: str = "") -> None:
    _log("FAIL", step, detail)


def skip(step: str, detail: str = "") -> None:
    _log("SKIP", step, detail)


def warn(step: str, detail: str = "") -> None:
    _log("WARN", step, detail)


# --------------------------------------------------------------------------- #
# CLI runner
# --------------------------------------------------------------------------- #


def run_cli(
    args: list[str],
    *,
    check: bool = True,
    timeout: int = 30,
    python: str | None = None,
) -> subprocess.CompletedProcess:
    cmd = [python or sys.executable, str(CLI), *args]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(f"timeout after {timeout}s running: {' '.join(args)}") from exc
    if check and result.returncode != 0:
        raise RuntimeError(
            f"CLI exit {result.returncode} on `{' '.join(args)}`\n"
            f"stdout: {result.stdout.strip()[:400]}\n"
            f"stderr: {result.stderr.strip()[:400]}"
        )
    return result


def cli_available() -> bool:
    if not CLI.exists():
        return False
    try:
        r = run_cli(["--help"], check=False, timeout=10)
    except Exception:
        return False
    return r.returncode == 0


# --------------------------------------------------------------------------- #
# Health probe
# --------------------------------------------------------------------------- #


def agent_health_url() -> str | None:
    for url in HEALTH_URLS:
        try:
            with urllib.request.urlopen(url, timeout=2) as resp:
                if 200 <= resp.status < 300:
                    return url
        except urllib.error.HTTPError:
            continue
        except Exception:
            continue
    return None


# --------------------------------------------------------------------------- #
# Helpers to introspect doc state
# --------------------------------------------------------------------------- #


def load_doc(doc: Path) -> dict:
    return json.loads(doc.read_text())


def root_node_id(doc: Path) -> str | None:
    """Return the id of the canvas root frame (parent_id is None/empty)."""
    data = load_doc(doc)
    for n in data.get("nodes", []):
        if not n.get("parent_id"):
            return n.get("id")
    nodes = data.get("nodes", [])
    return nodes[0]["id"] if nodes else None


def find_node(doc: Path, node_id: str) -> dict | None:
    for n in load_doc(doc).get("nodes", []):
        if n.get("id") == node_id:
            return n
    return None


# --------------------------------------------------------------------------- #
# Steps
# --------------------------------------------------------------------------- #


def step_1_new(workdir: Path) -> Path | None:
    doc = workdir / "smoke.doc.json"
    try:
        run_cli(["new", "--canvas", "1080x1080", "--out", str(doc), "--no-backup"])
    except Exception as e:
        fail("Step 1: pinsela_canvas new", str(e))
        return None
    if not doc.exists():
        fail("Step 1: pinsela_canvas new", f"output file not created at {doc}")
        return None
    ok("Step 1: pinsela_canvas new", f"wrote {doc.name} ({doc.stat().st_size} bytes)")
    return doc


def step_2_validate(doc: Path) -> bool:
    try:
        run_cli(["validate", str(doc)])
    except Exception as e:
        fail("Step 2: pinsela_canvas validate", str(e))
        return False
    ok("Step 2: pinsela_canvas validate", "doc accepted by validator")
    return True


def step_3_tree(doc: Path) -> bool:
    try:
        r = run_cli(["tree", str(doc)])
    except Exception as e:
        fail("Step 3: pinsela_canvas tree", str(e))
        return False
    if not r.stdout.strip():
        fail("Step 3: pinsela_canvas tree", "empty output")
        return False
    ok("Step 3: pinsela_canvas tree", f"{len(r.stdout.splitlines())} lines")
    return True


def step_4_summarize(doc: Path) -> bool:
    try:
        r = run_cli(["summarize", str(doc)])
    except Exception as e:
        fail("Step 4: pinsela_canvas summarize", str(e))
        return False
    if not r.stdout.strip():
        fail("Step 4: pinsela_canvas summarize", "empty output")
        return False
    ok("Step 4: pinsela_canvas summarize", f"{len(r.stdout)} chars")
    return True


def step_5_add(doc: Path) -> str | None:
    parent = root_node_id(doc)
    if not parent:
        fail("Step 5: pinsela_canvas add", "no root node found in doc")
        return None
    # Props as JSON: set the displayed text + a unique-ish position so we can find it later
    props = json.dumps(
        {
            "text": "SMOKE",
            "geometry": {"x": 100, "y": 100, "width": 400, "height": 80, "z_index": 5},
        }
    )
    try:
        run_cli(
            [
                "add",
                str(doc),
                parent,
                "text",
                "--name", "SMOKE_TEXT",
                "--props", props,
                "--no-backup",
            ]
        )
    except Exception as e:
        fail("Step 5: pinsela_canvas add", str(e))
        return None
    # Find the new node by name in the doc.
    try:
        data = load_doc(doc)
        candidates = [
            n for n in data.get("nodes", [])
            if n.get("name") == "SMOKE_TEXT"
        ]
        if not candidates:
            fail("Step 5: pinsela_canvas add", "no node named SMOKE_TEXT found after add")
            return None
        node_id = candidates[-1]["id"]
    except Exception as e:
        fail("Step 5: pinsela_canvas add", f"could not read doc: {e}")
        return None
    ok("Step 5: pinsela_canvas add", f"added text node id={node_id}")
    return node_id


def step_6_find(doc: Path, node_id: str) -> bool:
    try:
        r = run_cli(["find", str(doc), "--by-name", "SMOKE_TEXT"])
    except Exception as e:
        fail("Step 6: pinsela_canvas find", str(e))
        return False
    if node_id not in r.stdout:
        fail("Step 6: pinsela_canvas find", f"id {node_id} not in find output")
        return False
    ok("Step 6: pinsela_canvas find", "located node by name")
    return True


def step_7_patch(doc: Path, node_id: str) -> bool:
    try:
        run_cli(
            [
                "patch",
                str(doc),
                node_id,
                "--set", "text_style.color=#FF3366",
                "--no-backup",
            ]
        )
    except Exception as e:
        fail("Step 7: pinsela_canvas patch", str(e))
        return False
    node = find_node(doc, node_id) or {}
    color = node.get("text_style", {}).get("color")
    if color != "#FF3366":
        fail("Step 7: pinsela_canvas patch", f"color is {color!r}, expected '#FF3366'")
        return False
    ok("Step 7: pinsela_canvas patch", "color set to #FF3366")
    return True


def step_8_clone(doc: Path, node_id: str) -> str | None:
    try:
        ids_before = {n["id"] for n in load_doc(doc).get("nodes", [])}
        run_cli(["clone", str(doc), node_id, "--offset", "20,20", "--no-backup"])
        ids_after = {n["id"] for n in load_doc(doc).get("nodes", [])}
    except Exception as e:
        fail("Step 8: pinsela_canvas clone", str(e))
        return None
    new_ids = ids_after - ids_before
    if not new_ids:
        fail("Step 8: pinsela_canvas clone", "no new node id appeared after clone")
        return None
    clone_id = next(iter(new_ids))
    ok("Step 8: pinsela_canvas clone", f"cloned to id={clone_id}")
    return clone_id


def step_9_reorder(doc: Path, node_id: str) -> bool:
    try:
        before = find_node(doc, node_id) or {}
        z_before = before.get("geometry", {}).get("z_index", 0)
        run_cli(["reorder", str(doc), node_id, "--to-front", "--no-backup"])
        after = find_node(doc, node_id) or {}
        z_after = after.get("geometry", {}).get("z_index", 0)
    except Exception as e:
        fail("Step 9: pinsela_canvas reorder", str(e))
        return False
    if z_after <= z_before:
        fail(
            "Step 9: pinsela_canvas reorder",
            f"z_index did not increase ({z_before} -> {z_after})",
        )
        return False
    ok("Step 9: pinsela_canvas reorder", f"z_index {z_before} -> {z_after}")
    return True


def step_10_apply_pattern(doc: Path) -> bool:
    pattern = PATTERNS_DIR / "headline-cta-pill.json"
    if not pattern.exists():
        skip("Step 10: pinsela_canvas apply-pattern", f"pattern not found at {pattern}")
        return True

    root_id = root_node_id(doc)
    if not root_id:
        skip("Step 10: pinsela_canvas apply-pattern", "no root node available")
        return True

    nodes_before = len(load_doc(doc).get("nodes", []))

    try:
        run_cli(
            [
                "apply-pattern",
                str(doc),
                "headline-cta-pill",
                "--at", root_id,
                "--vars",
                "headline_text=SMOKE TEST,"
                "subhead_text=ok,"
                "cta_text=GO,"
                "headline_color=#111111,"
                "subhead_color=#444444,"
                "cta_fill=#FF3366,"
                "cta_text_color=#FFFFFF",
                "--no-backup",
            ]
        )
    except Exception as e:
        fail("Step 10: pinsela_canvas apply-pattern", str(e))
        return False

    nodes_after = len(load_doc(doc).get("nodes", []))
    if nodes_after <= nodes_before:
        fail(
            "Step 10: pinsela_canvas apply-pattern",
            f"node count did not grow ({nodes_before} -> {nodes_after})",
        )
        return False
    ok(
        "Step 10: pinsela_canvas apply-pattern",
        f"added {nodes_after - nodes_before} nodes (headline-cta-pill)",
    )
    return True


def step_11_validate_again(doc: Path) -> bool:
    try:
        run_cli(["validate", str(doc)])
    except Exception as e:
        fail("Step 11: pinsela_canvas validate (post-edits)", str(e))
        return False
    ok("Step 11: pinsela_canvas validate (post-edits)", "doc still valid")
    return True


def step_12_agent_health() -> str | None:
    url = agent_health_url()
    if url:
        ok("Step 12: GET /api/agent/health", url)
    else:
        warn(
            "Step 12: GET /api/agent/health",
            "endpoint not reachable on :8000 or :8201 — render step will be skipped",
        )
    return url


def step_13_render(doc: Path, healthy_url: str | None) -> bool:
    if not healthy_url:
        skip("Step 13: pinsela_canvas render", "no healthy /api/agent endpoint")
        return True
    out_png = Path("/tmp/pinsela_smoke.png")
    if out_png.exists():
        out_png.unlink()
    api_base = "http://127.0.0.1:8000" if ":8000" in healthy_url else "http://127.0.0.1:8201"
    py = _python_for_render()
    try:
        run_cli(
            ["render", str(doc), "--out", str(out_png), "--api", api_base],
            timeout=90,
            python=py,
        )
    except Exception as e:
        msg = str(e)
        if "httpx required" in msg:
            warn(
                "Step 13: pinsela_canvas render",
                "httpx not installed in any python on PATH; install with "
                "`pip install httpx` or run via apps/api/.venv/bin/python",
            )
            return True
        fail("Step 13: pinsela_canvas render", msg)
        return False
    if not out_png.exists():
        fail("Step 13: pinsela_canvas render", f"PNG not written to {out_png}")
        return False
    size = out_png.stat().st_size
    if size < 1000:
        fail("Step 13: pinsela_canvas render", f"PNG too small ({size} bytes)")
        return False
    ok("Step 13: pinsela_canvas render", f"PNG written ({size} bytes) at {out_png}")
    return True


def step_14_remove(doc: Path, clone_id: str | None) -> bool:
    if not clone_id:
        skip("Step 14: pinsela_canvas remove", "no clone id from step 8")
        return True
    try:
        run_cli(["remove", str(doc), clone_id, "--no-backup"])
    except Exception as e:
        fail("Step 14: pinsela_canvas remove", str(e))
        return False
    if find_node(doc, clone_id) is not None:
        fail("Step 14: pinsela_canvas remove", f"node {clone_id} still present after remove")
        return False
    ok("Step 14: pinsela_canvas remove", f"removed {clone_id}")
    return True


def step_15_validate_examples() -> bool:
    if not EXAMPLES_DIR.exists():
        warn("Step 15: validate examples/*.doc.json", f"{EXAMPLES_DIR} does not exist")
        return True
    files = sorted(EXAMPLES_DIR.glob("*.doc.json"))
    if not files:
        warn("Step 15: validate examples/*.doc.json", "no examples found")
        return True
    all_ok = True
    for f in files:
        try:
            run_cli(["validate", str(f)])
        except Exception as e:
            first_line = str(e).splitlines()[0][:160]
            fail(f"Step 15: validate {f.name}", first_line)
            all_ok = False
            continue
        ok(f"Step 15: validate {f.name}")
    return all_ok


def step_16_parse_patterns() -> bool:
    if not PATTERNS_DIR.exists():
        warn("Step 16: parse patterns/*.json", f"{PATTERNS_DIR} does not exist")
        return True
    files = sorted(p for p in PATTERNS_DIR.glob("*.json") if p.name != "INDEX.md")
    if not files:
        warn("Step 16: parse patterns/*.json", "no patterns found")
        return True
    all_ok = True
    for f in files:
        try:
            data = json.loads(f.read_text())
        except Exception as e:
            fail(f"Step 16: parse {f.name}", f"invalid JSON: {e}")
            all_ok = False
            continue
        missing = [k for k in ("$pattern_name", "nodes") if k not in data]
        if missing:
            fail(f"Step 16: parse {f.name}", f"missing keys: {missing}")
            all_ok = False
            continue
        if not isinstance(data.get("nodes"), list):
            fail(f"Step 16: parse {f.name}", "'nodes' is not a list")
            all_ok = False
            continue
        ok(f"Step 16: parse {f.name}", f"{len(data['nodes'])} nodes")
    return all_ok


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #


def main() -> int:
    print("=" * 64)
    print("pinsela-canvas smoke test")
    print(f"  CLI:      {CLI}")
    print(f"  Patterns: {PATTERNS_DIR}")
    print(f"  Examples: {EXAMPLES_DIR}")
    print("=" * 64)

    if not cli_available():
        fail("CLI availability", f"{CLI} not runnable — other agent may not have finished")
        return print_summary()
    ok("CLI availability", str(CLI))

    with tempfile.TemporaryDirectory(prefix="pinsela-smoke-") as tmp:
        workdir = Path(tmp)

        doc = step_1_new(workdir)
        if not doc:
            return print_summary()

        step_2_validate(doc)
        step_3_tree(doc)
        step_4_summarize(doc)

        node_id = step_5_add(doc)
        clone_id = None
        if node_id:
            step_6_find(doc, node_id)
            step_7_patch(doc, node_id)
            clone_id = step_8_clone(doc, node_id)
            step_9_reorder(doc, node_id)
        else:
            skip("Step 6-9", "no node id from step 5")

        step_10_apply_pattern(doc)
        step_11_validate_again(doc)
        healthy = step_12_agent_health()
        step_13_render(doc, healthy)
        step_14_remove(doc, clone_id)

    step_15_validate_examples()
    step_16_parse_patterns()

    return print_summary()


def print_summary() -> int:
    print()
    print("=" * 64)
    print("SUMMARY")
    print("=" * 64)
    counts: dict[str, int] = {"OK": 0, "FAIL": 0, "SKIP": 0, "WARN": 0}
    for status, _, _ in RESULTS:
        counts[status] = counts.get(status, 0) + 1
    for k in ("OK", "FAIL", "SKIP", "WARN"):
        print(f"  {k:5s}: {counts.get(k, 0)}")
    print()

    fails = [(s, d) for status, s, d in RESULTS if status == "FAIL"]
    if fails:
        print("FAILED STEPS:")
        for s, d in fails:
            print(f"  - {s}: {d}")
        print()
        print("NEXT STEPS:")
        print("  1. If the CLI is missing or partial, rerun the agent that builds")
        print("     scripts/agent-tools/pinsela_canvas.py.")
        print("  2. If render failed, restart Pinsela so it picks up the agent router:")
        print("     bash scripts/local_start_pinsela.sh")
        print("     then curl http://127.0.0.1:8000/api/agent/health")
        print("  3. If a pattern or example failed to parse, validate it manually:")
        print("     python3 -m json.tool <path>")
        return 1

    if counts.get("WARN", 0) or counts.get("SKIP", 0):
        print("Smoke test PASSED with skips/warnings (acceptable).")
    else:
        print("Smoke test PASSED clean.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
