"""Core primitive operations for manipulating PinselaTemplateDocV1 documents.

Importable as `from pinsela_canvas_ops import ...`.

All public functions take a doc dict and return either a new dict or the
mutated doc (mutation is intentional for performance and simplicity; callers
that need immutability can deepcopy beforehand). Functions never raise on
"not found" conditions unless documented otherwise.
"""

from __future__ import annotations

import copy
import json
import os
import sys
import uuid
from pathlib import Path
from typing import Any, Iterable

# --------------------------------------------------------------------------- #
# Validator: prefer the real pydantic-based one from apps/api when available.
# --------------------------------------------------------------------------- #

_API_ROOT = str(Path(__file__).resolve().parents[2] / "apps" / "api")
_HAS_NATIVE_VALIDATOR = False
_validate_native_doc = None
try:
    if _API_ROOT not in sys.path:
        sys.path.insert(0, _API_ROOT)
    from pinsela.services.template_native import (  # type: ignore
        validate_native_doc as _validate_native_doc,
    )

    _HAS_NATIVE_VALIDATOR = True
except Exception:
    _HAS_NATIVE_VALIDATOR = False
    _validate_native_doc = None


# --------------------------------------------------------------------------- #
# Default node factory (port of ui/src/pinsela/core/scene.ts:defaultNode).
# --------------------------------------------------------------------------- #

VALID_KINDS = ("frame", "group", "rect", "text", "image", "line", "path")


def _new_id(kind: str) -> str:
    return f"{kind}_{uuid.uuid4().hex[:8]}"


def _default_geometry(overrides: dict | None = None) -> dict:
    g = {
        "x": 80.0,
        "y": 80.0,
        "width": 280.0,
        "height": 120.0,
        "rotation": 0.0,
        "corner_radius": 0.0,
        "clip": False,
        "z_index": 0,
        "transform_matrix": None,
    }
    if overrides:
        g.update(overrides)
    return g


def _default_layout() -> dict:
    return {
        "direction": "none",
        "gap": 0.0,
        "padding_top": 0.0,
        "padding_right": 0.0,
        "padding_bottom": 0.0,
        "padding_left": 0.0,
        "align_main": "start",
        "align_cross": "start",
        "sizing_mode": "fixed",
        "wrap": False,
        "wrap_mode": "flow",
        "grid_columns": 0,
        "grid_rows": 0,
    }


def _default_constraints() -> dict:
    return {"x": "min", "y": "min", "width": "fixed", "height": "fixed"}


def _default_style(kind: str) -> dict:
    fill: Any
    if kind == "line":
        fill = "#8B6D52"
    elif kind == "path":
        fill = "rgba(0,0,0,0)"
    elif kind == "group":
        fill = None
    elif kind == "frame":
        fill = "rgba(0,0,0,0)"
    else:
        fill = "#D8C0A8"

    stroke: Any
    if kind == "line":
        stroke = {"color": "#F8FAFC", "width": 4, "dash": [], "cap": "round"}
    elif kind == "path":
        stroke = {"color": "#0f172a", "width": 2, "dash": [], "cap": "round"}
    else:
        stroke = None

    return {
        "visible": True,
        "locked": False,
        "opacity": 1.0,
        "blend_mode": "normal",
        "shape_type": None,
        "shape_sides": None,
        "star_points": None,
        "star_inner_ratio": None,
        "fill": fill,
        "strokes": None,
        "stroke": stroke,
        "effects": [],
        "image_fit": "fill",
        "image_crop": None,
        "image_duotone": None,
        "image_brush_settings": None,
        "image_brush_strokes": None,
        "image_trim": None,
        "image_scale": None,
        "image_align_x": None,
        "image_align_y": None,
        "mask": False,
    }


def _default_text_style(kind: str) -> dict:
    if kind == "text":
        return {
            "family": "Inter",
            "postscript": "Inter-Regular",
            "style": "Regular",
            "size": 42.0,
            "line_height": 110.0,
            "line_height_unit": "percent",
            "letter_spacing": 0.0,
            "text_align": "left",
            "vertical_align": "top",
            "baseline_shift": None,
            "line_height_scale": None,
            "underline": None,
            "color": "#111111",
        }
    return {
        "family": None,
        "postscript": None,
        "style": None,
        "size": None,
        "line_height": None,
        "line_height_unit": "percent",
        "letter_spacing": None,
        "text_align": "left",
        "vertical_align": "top",
        "baseline_shift": None,
        "line_height_scale": None,
        "underline": None,
        "color": None,
    }


def default_node(kind: str, name: str | None = None, **overrides: Any) -> dict:
    """Return a fresh node dict for `kind`, mirroring scene.ts:defaultNode."""
    if kind not in VALID_KINDS:
        raise ValueError(f"unknown kind: {kind!r}; expected one of {VALID_KINDS}")

    if kind == "line":
        geom_seed = {"width": 560.0, "height": 0.0}
    elif kind == "path":
        geom_seed = {"width": 320.0, "height": 220.0}
    elif kind == "frame":
        geom_seed = {"width": 320.0, "height": 320.0, "corner_radius": 18.0, "clip": True}
    else:
        geom_seed = None

    node: dict = {
        "id": _new_id(kind),
        "parent_id": None,
        "children_ids": [],
        "name": name if name is not None else kind.upper(),
        "kind": kind,
        "geometry": _default_geometry(geom_seed),
        "layout": _default_layout(),
        "constraints": _default_constraints(),
        "style": _default_style(kind),
        "text": "New text" if kind == "text" else None,
        "text_style": _default_text_style(kind),
        "text_runs": [],
        "text_path": None,
        "path_data": None,
        "image_src": None,
        "image_asset_id": None,
        "editable": False,
        "component_instance": None,
    }
    if overrides:
        node = deep_merge(node, overrides)
    return node


# --------------------------------------------------------------------------- #
# Doc lifecycle.
# --------------------------------------------------------------------------- #

def empty_doc(width: int = 1080, height: int = 1080, background: str = "#F2ECE4") -> dict:
    """Mirror scene.ts:createEmptyDoc — a root frame and nothing else."""
    root = default_node(
        "frame",
        name="ROOT",
        id="root",
        geometry={
            "x": 0.0,
            "y": 0.0,
            "width": float(width),
            "height": float(height),
            "rotation": 0.0,
            "corner_radius": 0.0,
            "clip": False,
            "z_index": 0,
        },
        style={"fill": background, "stroke": None},
    )
    root["id"] = "root"  # deep_merge in default_node consumes id override
    return {
        "version": 1,
        "template_kind": "",
        "canvas": {"width": int(width), "height": int(height), "background": background},
        "root_id": "root",
        "nodes": [root],
        "bindings": {
            "text": {},
            "images_single": {},
            "images_array": {},
            "product_frames": None,
        },
        "dynamic_rules": [],
        "metadata": {"source": "agent-tools", "components": {"definitions": []}},
    }


def load_doc(path: str | Path) -> dict:
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"doc not found: {p}")
    with p.open("r", encoding="utf-8") as f:
        return json.load(f)


def save_doc(path: str | Path, doc: dict, backup: bool = True) -> Path:
    """Pretty-print save, with optional .bak of any pre-existing file."""
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    if backup and p.exists():
        bak = p.with_suffix(p.suffix + ".bak")
        bak.write_bytes(p.read_bytes())
    tmp = p.with_suffix(p.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(doc, f, indent=2, ensure_ascii=False)
        f.write("\n")
    os.replace(tmp, p)
    return p


# --------------------------------------------------------------------------- #
# Validation.
# --------------------------------------------------------------------------- #

def _structural_validate(doc: dict) -> tuple[bool, str | None]:
    """Pure-stdlib fallback if pydantic models aren't reachable."""
    if not isinstance(doc, dict):
        return False, "doc must be a JSON object"
    if doc.get("version") != 1:
        return False, "doc.version must be 1"
    canvas = doc.get("canvas") or {}
    try:
        w = int(canvas.get("width"))
        h = int(canvas.get("height"))
    except Exception:
        return False, "doc.canvas.{width,height} required as integers"
    if not (64 <= w <= 8192 and 64 <= h <= 8192):
        return False, f"doc.canvas size out of bounds (got {w}x{h}, allowed 64..8192)"
    root_id = doc.get("root_id")
    if not isinstance(root_id, str) or not root_id:
        return False, "doc.root_id required (non-empty string)"
    nodes = doc.get("nodes")
    if not isinstance(nodes, list) or not nodes:
        return False, "doc.nodes must be a non-empty list"
    ids = set()
    for n in nodes:
        if not isinstance(n, dict):
            return False, "every node must be a JSON object"
        nid = n.get("id")
        if not isinstance(nid, str) or not nid:
            return False, "every node must have a string id"
        if nid in ids:
            return False, f"duplicate node id: {nid}"
        ids.add(nid)
        kind = n.get("kind", "group")
        if kind not in VALID_KINDS:
            return False, f"node {nid} has invalid kind: {kind}"
    if root_id not in ids:
        return False, f"root_id {root_id!r} not present in nodes"
    for n in nodes:
        pid = n.get("parent_id")
        if pid and pid not in ids:
            return False, f"node {n['id']} parent_id {pid!r} not present in nodes"
        for c in n.get("children_ids") or []:
            if c not in ids:
                return False, f"node {n['id']} children_ids references missing {c!r}"
    return True, None


def validate(doc: dict) -> tuple[bool, str | None]:
    """Validate a doc. Uses pydantic models if available, else structural check."""
    if _HAS_NATIVE_VALIDATOR:
        try:
            _validate_native_doc(doc)
            return True, None
        except Exception as exc:
            return False, str(exc)
    return _structural_validate(doc)


# --------------------------------------------------------------------------- #
# Internals: lookups and tree ops.
# --------------------------------------------------------------------------- #

def _index(doc: dict) -> dict[str, dict]:
    return {n["id"]: n for n in doc.get("nodes") or []}


def get_node(doc: dict, node_id: str) -> dict | None:
    return _index(doc).get(node_id)


def descendants(doc: dict, node_id: str) -> list[str]:
    by_id = _index(doc)
    out: list[str] = []
    stack = [node_id]
    seen = set()
    while stack:
        cur = stack.pop()
        if cur in seen:
            continue
        seen.add(cur)
        node = by_id.get(cur)
        if not node:
            continue
        for cid in node.get("children_ids") or []:
            if cid not in seen:
                out.append(cid)
                stack.append(cid)
    return out


def _max_z(doc: dict) -> int:
    return max((int((n.get("geometry") or {}).get("z_index") or 0) for n in doc.get("nodes") or []), default=0)


# --------------------------------------------------------------------------- #
# Find.
# --------------------------------------------------------------------------- #

def find(
    doc: dict,
    by_name: str | None = None,
    by_kind: str | None = None,
    by_id: str | None = None,
) -> list[dict]:
    """Return nodes matching any of the provided filters. `by_name` is a
    case-insensitive substring match. All filters AND together."""
    out = []
    name_q = by_name.lower() if by_name else None
    for n in doc.get("nodes") or []:
        if by_id is not None and n.get("id") != by_id:
            continue
        if by_kind is not None and n.get("kind") != by_kind:
            continue
        if name_q is not None and name_q not in str(n.get("name") or "").lower():
            continue
        out.append(n)
    return out


# --------------------------------------------------------------------------- #
# Patch.
# --------------------------------------------------------------------------- #

def deep_merge(base: dict, patch: dict) -> dict:
    """Recursively merge `patch` into a copy of `base`. Lists overwrite."""
    out = copy.deepcopy(base) if not isinstance(base, dict) else dict(base)
    for k, v in patch.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = deep_merge(out[k], v)
        else:
            out[k] = copy.deepcopy(v) if isinstance(v, (dict, list)) else v
    return out


def _expand_dot_path(key: str, value: Any) -> dict:
    """`geometry.x` + 120 -> {'geometry': {'x': 120}}"""
    parts = key.split(".")
    cur: Any = value
    for p in reversed(parts):
        cur = {p: cur}
    return cur


def patch(doc: dict, node_id: str, patch_dict: dict) -> dict:
    """Deep-merge `patch_dict` into the node identified by `node_id`."""
    nodes = doc.get("nodes") or []
    for i, n in enumerate(nodes):
        if n.get("id") == node_id:
            nodes[i] = deep_merge(n, patch_dict)
            return doc
    raise KeyError(f"node not found: {node_id}")


# --------------------------------------------------------------------------- #
# Add / Remove / Reorder / Clone.
# --------------------------------------------------------------------------- #

def add(
    doc: dict,
    parent_id: str,
    kind: str,
    name: str | None = None,
    props: dict | None = None,
) -> str:
    """Add a new node under `parent_id`. Returns new node id."""
    parent = get_node(doc, parent_id)
    if parent is None:
        raise KeyError(f"parent not found: {parent_id}")
    node = default_node(kind, name=name)
    if props:
        node = deep_merge(node, props)
    node["parent_id"] = parent_id
    node.setdefault("children_ids", [])
    geom = node.setdefault("geometry", _default_geometry())
    geom["z_index"] = _max_z(doc) + 1
    doc.setdefault("nodes", []).append(node)
    parent.setdefault("children_ids", []).append(node["id"])
    return node["id"]


def remove(doc: dict, node_id: str) -> dict:
    """Remove node + all descendants. Cleans the parent's children_ids and
    purges any bindings that point at removed nodes."""
    nodes = doc.get("nodes") or []
    if node_id == doc.get("root_id"):
        raise ValueError("cannot remove the root node")
    target = get_node(doc, node_id)
    if target is None:
        raise KeyError(f"node not found: {node_id}")
    dead = set([node_id, *descendants(doc, node_id)])
    doc["nodes"] = [n for n in nodes if n["id"] not in dead]
    for n in doc["nodes"]:
        kids = n.get("children_ids") or []
        if any(k in dead for k in kids):
            n["children_ids"] = [k for k in kids if k not in dead]
    bindings = doc.get("bindings") or {}
    txt = bindings.get("text") or {}
    bindings["text"] = {k: v for k, v in txt.items() if not (isinstance(v, dict) and v.get("node_id") in dead)}
    isng = bindings.get("images_single") or {}
    bindings["images_single"] = {k: v for k, v in isng.items() if not (isinstance(v, dict) and v.get("node_id") in dead)}
    iarr = bindings.get("images_array") or {}
    new_iarr: dict = {}
    for k, v in iarr.items():
        if not isinstance(v, dict):
            continue
        ids = [x for x in (v.get("node_ids") or []) if x not in dead]
        if ids:
            nv = dict(v)
            nv["node_ids"] = ids
            new_iarr[k] = nv
    bindings["images_array"] = new_iarr
    pf = bindings.get("product_frames")
    if isinstance(pf, dict):
        ids = [x for x in (pf.get("node_ids") or []) if x not in dead]
        if ids:
            pf["node_ids"] = ids
            bindings["product_frames"] = pf
        else:
            bindings["product_frames"] = None
    doc["bindings"] = bindings
    return doc


def reorder_z(
    doc: dict,
    node_id: str,
    delta: int | None = None,
    to_front: bool = False,
    to_back: bool = False,
) -> dict:
    node = get_node(doc, node_id)
    if node is None:
        raise KeyError(f"node not found: {node_id}")
    geom = node.setdefault("geometry", _default_geometry())
    if to_front:
        geom["z_index"] = _max_z(doc) + 1
    elif to_back:
        z_min = min((int((n.get("geometry") or {}).get("z_index") or 0) for n in doc.get("nodes") or []), default=0)
        geom["z_index"] = z_min - 1
    elif delta is not None:
        geom["z_index"] = int(geom.get("z_index") or 0) + int(delta)
    return doc


def clone(doc: dict, node_id: str, offset: tuple[float, float] = (0.0, 0.0)) -> str:
    """Duplicate node + descendants under the same parent with new ids."""
    src = get_node(doc, node_id)
    if src is None:
        raise KeyError(f"node not found: {node_id}")
    if node_id == doc.get("root_id"):
        raise ValueError("cannot clone the root node")

    ids_to_copy = [node_id, *descendants(doc, node_id)]
    by_id = _index(doc)
    remap: dict[str, str] = {old: _new_id(by_id[old].get("kind") or "node") for old in ids_to_copy}

    new_root_id = remap[node_id]
    new_nodes: list[dict] = []
    for old in ids_to_copy:
        n = copy.deepcopy(by_id[old])
        n["id"] = remap[old]
        n["children_ids"] = [remap[c] for c in (n.get("children_ids") or []) if c in remap]
        if old == node_id:
            n["parent_id"] = src.get("parent_id")
            geom = n.setdefault("geometry", _default_geometry())
            geom["x"] = float(geom.get("x") or 0) + float(offset[0])
            geom["y"] = float(geom.get("y") or 0) + float(offset[1])
            geom["z_index"] = _max_z(doc) + 1
        else:
            pid = n.get("parent_id")
            n["parent_id"] = remap.get(pid, pid)
        new_nodes.append(n)
    doc.setdefault("nodes", []).extend(new_nodes)
    parent_id = src.get("parent_id")
    if parent_id:
        parent = get_node(doc, parent_id)
        if parent is not None:
            parent.setdefault("children_ids", []).append(new_root_id)
    return new_root_id


# --------------------------------------------------------------------------- #
# Patterns.
# --------------------------------------------------------------------------- #

# Pattern directory: $PINSELA_PATTERN_DIR, default <repo>/patterns.
_PATTERN_DIR = Path(os.environ.get("PINSELA_PATTERN_DIR") or Path(__file__).resolve().parents[2] / "patterns")


def _resolve_pattern_path(name_or_path: str) -> Path:
    p = Path(name_or_path)
    if p.exists():
        return p
    candidate = _PATTERN_DIR / (name_or_path if name_or_path.endswith(".json") else f"{name_or_path}.json")
    if candidate.exists():
        return candidate
    raise FileNotFoundError(
        f"pattern not found: {name_or_path!r} (looked at {p} and {candidate})"
    )


def _substitute_vars(obj: Any, vars_map: dict[str, str]) -> Any:
    if not vars_map:
        return obj
    if isinstance(obj, str):
        out = obj
        for k, v in vars_map.items():
            out = out.replace("{{" + k + "}}", str(v))
        return out
    if isinstance(obj, list):
        return [_substitute_vars(x, vars_map) for x in obj]
    if isinstance(obj, dict):
        return {k: _substitute_vars(v, vars_map) for k, v in obj.items()}
    return obj


def apply_pattern(
    doc: dict,
    pattern_path: str,
    parent_id: str,
    vars: dict[str, str] | None = None,
) -> dict:
    """Splice a pattern under `parent_id`.

    Pattern JSON contract:
      { "nodes": [ {... node ...}, ... ] }
    The pattern's __ROOT__ node (id == "__ROOT__") will be rebound to parent_id
    (i.e. its children attach directly to parent_id and the __ROOT__ node itself
    is discarded). If no __ROOT__ node exists, every top-level pattern node
    (parent_id == null) is attached to parent_id directly.
    All pattern node ids are prefixed with `pN_` (N = next pattern counter) to
    avoid collisions, and `{{var}}` placeholders are substituted in strings.
    """
    parent = get_node(doc, parent_id)
    if parent is None:
        raise KeyError(f"parent not found: {parent_id}")
    p = _resolve_pattern_path(pattern_path)
    with p.open("r", encoding="utf-8") as f:
        pattern = json.load(f)
    pattern = _substitute_vars(pattern, vars or {})

    p_nodes = pattern.get("nodes") or []
    if not isinstance(p_nodes, list):
        raise ValueError("pattern must contain a 'nodes' list")

    existing_prefixes = {
        nid.split("_", 1)[0]
        for nid in (n.get("id") or "" for n in doc.get("nodes") or [])
        if nid.startswith("p") and "_" in nid and nid.split("_", 1)[0][1:].isdigit()
    }
    n = 1
    while f"p{n}" in existing_prefixes:
        n += 1
    prefix = f"p{n}"

    remap: dict[str, str] = {}
    has_root_marker = any(n.get("id") == "__ROOT__" for n in p_nodes)
    for pn in p_nodes:
        pid = pn.get("id")
        if not pid:
            continue
        if pid == "__ROOT__":
            remap[pid] = parent_id
        else:
            remap[pid] = f"{prefix}_{pid}"

    base_z = _max_z(doc)
    for i, pn in enumerate(p_nodes):
        old_id = pn.get("id")
        if old_id == "__ROOT__":
            continue
        n2 = copy.deepcopy(pn)
        n2["id"] = remap[old_id]
        old_parent = pn.get("parent_id")
        if old_parent in remap:
            n2["parent_id"] = remap[old_parent]
        elif has_root_marker and old_parent is None:
            n2["parent_id"] = None
        else:
            n2["parent_id"] = parent_id
        n2["children_ids"] = [remap[c] for c in (pn.get("children_ids") or []) if c in remap]
        geom = n2.setdefault("geometry", _default_geometry())
        geom["z_index"] = base_z + i + 1
        doc.setdefault("nodes", []).append(n2)

    # Wire pattern roots into parent.children_ids.
    parent.setdefault("children_ids", [])
    if has_root_marker:
        root_pattern_node = next((x for x in p_nodes if x.get("id") == "__ROOT__"), None)
        if root_pattern_node:
            for cid in root_pattern_node.get("children_ids") or []:
                if cid in remap:
                    parent["children_ids"].append(remap[cid])
    else:
        for pn in p_nodes:
            if not pn.get("parent_id"):
                parent["children_ids"].append(remap[pn["id"]])
    return doc


# --------------------------------------------------------------------------- #
# Summarize / tree / diff.
# --------------------------------------------------------------------------- #

def _node_summary_line(n: dict) -> str:
    g = n.get("geometry") or {}
    return (
        f"{n.get('kind','?'):5s}  {n.get('id',''):28s}  "
        f"name={n.get('name','')!r:24s} "
        f"x={g.get('x',0):>6.1f} y={g.get('y',0):>6.1f} "
        f"w={g.get('width',0):>6.1f} h={g.get('height',0):>6.1f} "
        f"z={g.get('z_index',0):>3d}"
    )


def summarize(doc: dict) -> str:
    canvas = doc.get("canvas") or {}
    lines = [
        f"canvas:     {canvas.get('width','?')}x{canvas.get('height','?')}  bg={canvas.get('background')!r}",
        f"root_id:    {doc.get('root_id')!r}",
        f"node_count: {len(doc.get('nodes') or [])}",
        f"template_kind: {doc.get('template_kind')!r}",
        "",
        "nodes (in document order):",
    ]
    for n in doc.get("nodes") or []:
        lines.append("  " + _node_summary_line(n))
    bindings = doc.get("bindings") or {}
    text_b = bindings.get("text") or {}
    img_b = bindings.get("images_single") or {}
    arr_b = bindings.get("images_array") or {}
    lines.append("")
    lines.append(
        f"bindings: text={len(text_b)} images_single={len(img_b)} images_array={len(arr_b)}"
    )
    return "\n".join(lines)


def tree(doc: dict) -> str:
    by_id = _index(doc)
    root_id = doc.get("root_id")
    if root_id not in by_id:
        return "<no root>"

    children_by_parent: dict[str, list[str]] = {}
    explicit_children: set[str] = set()
    for n in doc.get("nodes") or []:
        for cid in n.get("children_ids") or []:
            explicit_children.add(cid)
            children_by_parent.setdefault(n["id"], []).append(cid)
    # nodes with parent_id but missing from parent's children_ids
    for n in doc.get("nodes") or []:
        pid = n.get("parent_id")
        if pid and n["id"] not in explicit_children:
            children_by_parent.setdefault(pid, []).append(n["id"])

    out: list[str] = []

    def _walk(nid: str, prefix: str, last: bool, depth: int) -> None:
        n = by_id.get(nid)
        if not n:
            return
        if depth == 0:
            head = ""
        else:
            head = prefix + ("`-- " if last else "|-- ")
        g = n.get("geometry") or {}
        label = (
            f"[{n.get('kind','?')}] {n.get('id','')} "
            f"name={n.get('name','')!r} "
            f"({g.get('width',0):.0f}x{g.get('height',0):.0f} @ {g.get('x',0):.0f},{g.get('y',0):.0f}, z={g.get('z_index',0)})"
        )
        out.append(head + label)
        kids = children_by_parent.get(nid, [])
        next_prefix = prefix + ("    " if last else "|   ") if depth > 0 else ""
        for i, cid in enumerate(kids):
            _walk(cid, next_prefix, i == len(kids) - 1, depth + 1)

    _walk(root_id, "", True, 0)
    # orphans
    visited: set[str] = set()

    def _collect(nid: str) -> None:
        if nid in visited:
            return
        visited.add(nid)
        for cid in children_by_parent.get(nid, []):
            _collect(cid)

    _collect(root_id)
    orphans = [n["id"] for n in doc.get("nodes") or [] if n["id"] not in visited]
    if orphans:
        out.append("")
        out.append("orphans (not reachable from root):")
        for oid in orphans:
            out.append("  " + _node_summary_line(by_id[oid]))
    return "\n".join(out)


def diff(a: dict, b: dict) -> str:
    a_by = _index(a)
    b_by = _index(b)
    added = sorted(b_by.keys() - a_by.keys())
    removed = sorted(a_by.keys() - b_by.keys())
    common = sorted(a_by.keys() & b_by.keys())
    modified: list[tuple[str, list[str]]] = []
    for k in common:
        changes = _node_changes(a_by[k], b_by[k])
        if changes:
            modified.append((k, changes))

    lines = []
    ca = a.get("canvas") or {}
    cb = b.get("canvas") or {}
    if ca != cb:
        lines.append(f"canvas changed: {ca} -> {cb}")
    if a.get("root_id") != b.get("root_id"):
        lines.append(f"root_id changed: {a.get('root_id')!r} -> {b.get('root_id')!r}")
    lines.append(f"added:    {len(added)}")
    for k in added:
        lines.append(f"  + {_node_summary_line(b_by[k])}")
    lines.append(f"removed:  {len(removed)}")
    for k in removed:
        lines.append(f"  - {_node_summary_line(a_by[k])}")
    lines.append(f"modified: {len(modified)}")
    for k, changes in modified:
        lines.append(f"  ~ {k}")
        for c in changes:
            lines.append(f"      {c}")
    return "\n".join(lines)


def _node_changes(a: dict, b: dict, prefix: str = "") -> list[str]:
    out: list[str] = []
    keys = set(a.keys()) | set(b.keys())
    for k in sorted(keys):
        av = a.get(k)
        bv = b.get(k)
        path = f"{prefix}{k}"
        if isinstance(av, dict) and isinstance(bv, dict):
            out.extend(_node_changes(av, bv, path + "."))
        elif av != bv:
            out.append(f"{path}: {_short(av)} -> {_short(bv)}")
    return out


def _short(v: Any) -> str:
    s = json.dumps(v, ensure_ascii=False, default=str)
    if len(s) > 80:
        s = s[:77] + "..."
    return s


# --------------------------------------------------------------------------- #
# Iteration helpers for callers.
# --------------------------------------------------------------------------- #

def iter_nodes(doc: dict) -> Iterable[dict]:
    return iter(doc.get("nodes") or [])
