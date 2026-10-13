#!/usr/bin/env python3
"""pinsela_master — single entry point that dispatches to the pinsela_* CLIs.

Discovers every executable `pinsela_*.py` (except itself) next to this file,
parses its module docstring's first line for a one-liner description, and
exposes them as subcommands.

Usage:
    pinsela_master help
    pinsela_master <tool> <args...>

Tip — drop this in your shell rc:
    alias pinsela='python3 scripts/agent-tools/pinsela_master.py'
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PREFIX = "pinsela_"
SELF = Path(__file__).name


def _doc_summary(path: Path) -> str:
    """Read the first line of the module docstring."""
    try:
        text = path.read_text(encoding="utf-8")
    except Exception:
        return ""
    # match triple-double-quote docstring at top
    m = re.search(r'^"""([^\n]+)', text, re.MULTILINE)
    if m:
        first = m.group(1).strip()
        # strip "name — " prefix to keep summary clean
        return re.sub(r'^[a-zA-Z_]+\s*[-—:]+\s*', '', first)
    return ""


def discover() -> dict[str, Path]:
    out: dict[str, Path] = {}
    for f in sorted(HERE.iterdir()):
        if not f.is_file():
            continue
        if not f.name.endswith(".py"):
            continue
        if not f.name.startswith(PREFIX):
            continue
        if f.name == SELF:
            continue
        # tool name = stem without prefix
        tool = f.stem[len(PREFIX):]
        if not tool:
            continue
        out[tool] = f
    return out


def cmd_help(tools: dict[str, Path]) -> int:
    print("pinsela_master — unified Pinsela CLI dispatcher")
    print()
    print(f"  Usage: pinsela <tool> [args...]")
    print(f"         pinsela help")
    print()
    print(f"Discovered tools (in {HERE}):")
    print()
    width = max((len(t) for t in tools), default=10)
    for name, path in tools.items():
        summary = _doc_summary(path)
        print(f"  {name:<{width}}  {summary}")
    print()
    print("Examples:")
    print("  pinsela design 'Create Instagram post Morning coffee $29.90'")
    print("  pinsela palette harmonize '#936947'")
    print("  pinsela constraint_layout layout.yaml --pretty")
    print("  pinsela snapshot_test list")
    return 0


def main(argv: list[str]) -> int:
    tools = discover()
    if not argv or argv[0] in ("help", "--help", "-h"):
        return cmd_help(tools)
    tool = argv[0]
    rest = argv[1:]
    if tool not in tools:
        print(f"error: unknown tool {tool!r}", file=sys.stderr)
        print(f"       known: {', '.join(tools) or '(none)'}", file=sys.stderr)
        return 2
    path = tools[tool]
    # delegate via subprocess so the child has its own argv[0]
    res = subprocess.run(["python3", str(path), *rest])
    return res.returncode


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
