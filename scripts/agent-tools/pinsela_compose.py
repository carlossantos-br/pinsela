#!/usr/bin/env python3
"""pinsela_compose — debug helper for design tokens + components.

Subcommands:
    tokens-template            Emit a starter ``doc.tokens`` JSON to stdout.
    list-builtins              List the built-in component library with params.
    expand <doc.json>          Apply token_resolver + component_expander (no
                               render); print the expanded doc to stdout.

The CLI loads modules straight from the API service tree, so run from any
cwd as long as the repo layout is intact.

Examples::

    python3 pinsela_compose.py tokens-template > my_tokens.json
    python3 pinsela_compose.py list-builtins
    python3 pinsela_compose.py expand /tmp/my_doc.json > /tmp/expanded.json
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path


# Make sure we can import the pinsela package. The script lives at
# scripts/agent-tools/pinsela_compose.py
# so the API tree is at ../../apps/api relative to this file.
_HERE = Path(__file__).resolve().parent
_API = _HERE.parent.parent / "apps" / "api"
if _API.exists():
    sys.path.insert(0, str(_API))


def _cmd_tokens_template(_args) -> int:
    template = {
        "colors": {
            "primary": "#936947",
            "secondary": "#B8893F",
            "ink": "#1F1108",
            "paper": "#F5EBDD",
            "accent": "#FFD06E",
        },
        "fonts": {
            "headline": {
                "family": "Inter",
                "postscript": "Inter-Medium",
                "size": 72,
                "line_height": 110,
                "letter_spacing": -1
            },
            "body": {
                "family": "Inter",
                "postscript": "Inter-Regular",
                "size": 28,
                "line_height": 130
            },
            "caption": {
                "family": "Inter",
                "postscript": "Inter-Regular",
                "size": 18,
                "line_height": 130
            }
        },
        "spacing": {"xs": 8, "sm": 16, "md": 24, "lg": 48, "xl": 80, "xxl": 128},
        "radii": {"sm": 6, "md": 12, "lg": 24, "pill": 999}
    }
    json.dump(template, sys.stdout, indent=2, ensure_ascii=False)
    sys.stdout.write("\n")
    return 0


def _cmd_list_builtins(_args) -> int:
    from pinsela.services.builtin_components import list_builtin_components

    rows = list_builtin_components()
    width = max(len(r["id"]) for r in rows) if rows else 0
    print(f"{len(rows)} built-in components available:\n")
    for r in rows:
        params = ", ".join(r["params"]) if r["params"] else "(no params)"
        defaults = r.get("defaults") or {}
        defaults_str = ""
        if defaults:
            kvs = ", ".join(f"{k}={v!r}" for k, v in defaults.items())
            defaults_str = f"  defaults: {kvs}"
        print(f"  {r['id']:<{width}}  {r['width']}x{r['height']}  params: {params}{defaults_str}")
    return 0


def _cmd_expand(args) -> int:
    from pinsela.services.component_expander import expand_components
    from pinsela.services.token_resolver import resolve_tokens

    path = Path(args.doc)
    if not path.exists():
        print(f"error: file not found: {path}", file=sys.stderr)
        return 2
    raw = path.read_text(encoding="utf-8")
    try:
        doc = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"error: invalid JSON: {e}", file=sys.stderr)
        return 2

    if args.inject_builtins:
        from pinsela.services.builtin_components import inject_builtins
        doc = inject_builtins(doc)

    expanded = resolve_tokens(doc)
    expanded = expand_components(expanded)
    expanded = resolve_tokens(expanded)
    json.dump(expanded, sys.stdout, indent=2, ensure_ascii=False)
    sys.stdout.write("\n")
    return 0


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="pinsela_compose",
        description="Design tokens + components helper (preprocessor debugger).",
    )
    sub = p.add_subparsers(dest="cmd", required=True)

    sp = sub.add_parser("tokens-template", help="Emit a starter doc.tokens JSON.")
    sp.set_defaults(func=_cmd_tokens_template)

    sp = sub.add_parser("list-builtins", help="List built-in components.")
    sp.set_defaults(func=_cmd_list_builtins)

    sp = sub.add_parser("expand", help="Expand tokens + components in a doc JSON.")
    sp.add_argument("doc", help="Path to a doc JSON file.")
    sp.add_argument("--inject-builtins", action="store_true",
                    help="Inject the built-in component library before expansion.")
    sp.set_defaults(func=_cmd_expand)

    return p


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
