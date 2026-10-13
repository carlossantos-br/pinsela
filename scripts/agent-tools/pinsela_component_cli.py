#!/usr/bin/env python3
"""pinsela_component_cli — manage reusable doc-fragment components.

Components live as JSON fragments under:
    $PINSELA_COMPONENTS_DIR/<name>.json (default <repo>/components)

Each component file is a doc-fragment with template tokens of the form
`{{ prop_name }}` that get substituted at `use` time.

Subcommands:
    define <name> <fragment.json> [--props "k:type:default,..."]
        Save a component definition. Optional --props records the param
        signature so `list` can show it.
    list
        List all defined components and their declared param signatures.
    use <name> --props k=v [--props k=v ...] [--out path]
        Substitute props into the fragment and emit the JSON. Tokens that
        have no matching prop are left untouched unless `--strict`.
    inspect <name>
        Pretty-print the component definition.
    remove <name>
        Delete a component definition.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Any


COMPONENTS_DIR = Path(os.environ.get("PINSELA_COMPONENTS_DIR") or Path(__file__).resolve().parents[2] / "components")
SIGNATURE_KEY = "__component__"
TOKEN_RE = re.compile(r"\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}")


def _ensure_dir() -> None:
    COMPONENTS_DIR.mkdir(parents=True, exist_ok=True)


def _path(name: str) -> Path:
    return COMPONENTS_DIR / f"{name}.json"


def _scan_tokens(value: Any, found: set[str]) -> None:
    if isinstance(value, str):
        for m in TOKEN_RE.finditer(value):
            found.add(m.group(1))
    elif isinstance(value, dict):
        for v in value.values():
            _scan_tokens(v, found)
    elif isinstance(value, list):
        for v in value:
            _scan_tokens(v, found)


def _substitute(value: Any, props: dict[str, str], strict: bool, missing: set[str]) -> Any:
    if isinstance(value, str):
        def repl(m: re.Match[str]) -> str:
            key = m.group(1)
            if key in props:
                return str(props[key])
            missing.add(key)
            if strict:
                return m.group(0)  # caller will fail
            return m.group(0)
        return TOKEN_RE.sub(repl, value)
    if isinstance(value, dict):
        return {k: _substitute(v, props, strict, missing) for k, v in value.items()}
    if isinstance(value, list):
        return [_substitute(v, props, strict, missing) for v in value]
    return value


# --------------------------------------------------------------------------- #
# Subcommands.
# --------------------------------------------------------------------------- #

def cmd_define(args: argparse.Namespace) -> int:
    _ensure_dir()
    name = args.name
    fragment = json.loads(Path(args.fragment).read_text(encoding="utf-8"))

    signature: dict[str, Any] = {}
    if args.props:
        for part in args.props.split(","):
            part = part.strip()
            if not part:
                continue
            tokens = part.split(":")
            pname = tokens[0]
            ptype = tokens[1] if len(tokens) > 1 else "str"
            pdefault = tokens[2] if len(tokens) > 2 else None
            signature[pname] = {"type": ptype, "default": pdefault}

    # discover tokens used and merge
    found: set[str] = set()
    _scan_tokens(fragment, found)
    for f in found:
        signature.setdefault(f, {"type": "str", "default": None})

    payload = {
        SIGNATURE_KEY: {
            "name": name,
            "params": signature,
            "tokens_used": sorted(found),
        },
        "fragment": fragment,
    }

    target = _path(name)
    target.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"defined: {target}")
    print(f"  params: {sorted(signature.keys())}")
    return 0


def cmd_list(args: argparse.Namespace) -> int:
    _ensure_dir()
    files = sorted(COMPONENTS_DIR.glob("*.json"))
    if not files:
        print("(no components defined yet)")
        return 0
    print(f"{'NAME':<32} PARAMS")
    print("-" * 70)
    for f in files:
        try:
            payload = json.loads(f.read_text(encoding="utf-8"))
            sig = payload.get(SIGNATURE_KEY) or {}
            params = sig.get("params") or {}
            param_list = ",".join(sorted(params.keys()))
            print(f"{f.stem:<32} {param_list}")
        except Exception as e:
            print(f"{f.stem:<32} (parse error: {e})")
    return 0


def cmd_use(args: argparse.Namespace) -> int:
    _ensure_dir()
    target = _path(args.name)
    if not target.exists():
        print(f"error: component {args.name!r} not found at {target}", file=sys.stderr)
        return 2
    payload = json.loads(target.read_text(encoding="utf-8"))
    fragment = payload.get("fragment", payload)
    sig = payload.get(SIGNATURE_KEY) or {}
    params = sig.get("params") or {}

    # parse k=v props
    props: dict[str, str] = {}
    # defaults
    for k, v in params.items():
        if v.get("default") is not None:
            props[k] = v["default"]
    for raw in args.prop or []:
        if "=" not in raw:
            print(f"error: --prop expects k=v, got {raw!r}", file=sys.stderr)
            return 2
        k, v = raw.split("=", 1)
        props[k.strip()] = v

    missing: set[str] = set()
    result = _substitute(fragment, props, args.strict, missing)

    unfilled = [m for m in missing if m not in props]
    if unfilled and args.strict:
        print(f"error: unfilled tokens: {sorted(unfilled)}", file=sys.stderr)
        return 3
    if unfilled:
        print(f"warning: unfilled tokens left in output: {sorted(unfilled)}", file=sys.stderr)

    out = json.dumps(result, indent=2, ensure_ascii=False)
    if args.out:
        Path(args.out).write_text(out, encoding="utf-8")
        print(f"emitted: {args.out}", file=sys.stderr)
    else:
        print(out)
    return 0


def cmd_inspect(args: argparse.Namespace) -> int:
    target = _path(args.name)
    if not target.exists():
        print(f"error: component {args.name!r} not found at {target}", file=sys.stderr)
        return 2
    payload = json.loads(target.read_text(encoding="utf-8"))
    print(json.dumps(payload, indent=2, ensure_ascii=False))
    return 0


def cmd_remove(args: argparse.Namespace) -> int:
    target = _path(args.name)
    if not target.exists():
        print(f"error: component {args.name!r} not found at {target}", file=sys.stderr)
        return 2
    target.unlink()
    print(f"removed: {target}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(prog="pinsela_component_cli", description="Manage reusable doc-fragment components.")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("define", help="Save a component definition")
    p.add_argument("name")
    p.add_argument("fragment", help="Path to JSON fragment with {{ token }} placeholders")
    p.add_argument("--props", help="comma-separated 'name:type:default' signature")
    p.set_defaults(fn=cmd_define)

    p = sub.add_parser("list", help="List defined components")
    p.set_defaults(fn=cmd_list)

    p = sub.add_parser("use", help="Instantiate a component")
    p.add_argument("name")
    p.add_argument("--prop", action="append", help="k=v prop (repeatable)")
    p.add_argument("--out", help="Output JSON path (default: stdout)")
    p.add_argument("--strict", action="store_true", help="Fail on unfilled tokens")
    p.set_defaults(fn=cmd_use)

    p = sub.add_parser("inspect", help="Pretty-print a component definition")
    p.add_argument("name")
    p.set_defaults(fn=cmd_inspect)

    p = sub.add_parser("remove", help="Delete a component definition")
    p.add_argument("name")
    p.set_defaults(fn=cmd_remove)

    args = ap.parse_args()
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
