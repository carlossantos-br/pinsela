"""Component instance expander for Pinsela native docs.

A "component" is a reusable group of nodes defined in
``doc.metadata.components.definitions[]``. A "component instance" is a
placeholder node in the document tree that references a definition by id
and supplies props. Before render, this preprocessor expands each instance
into a deep copy of the definition's nodes — substituting ``{{prop_name}}``
placeholders, rewriting node ids to avoid collisions, and translating
geometry so the contained nodes land inside the instance's bounding box.

Definition shape::

    {
        "id": "price-card",
        "params": ["price", "unit"],         # informational
        "defaults": {"unit": "per unit"},  # default prop values
        "width": 320,                          # authoring viewport (px)
        "height": 200,
        "nodes": [
            {
                "id": "bg",
                "kind": "rect",
                "geometry": {"x": 0, "y": 0, "width": 320, "height": 200, ...},
                "style": {"fill": "$tokens.colors.primary"},
            },
            {
                "id": "price",
                "kind": "text",
                "text": "{{price}}",
                ...
            }
        ]
    }

Instance shape (in doc.nodes)::

    {
        "id": "card_a",
        "kind": "component_instance",
        "component_id": "price-card",
        "parent_id": "page",
        "props": {"price": "R$ 99,90", "unit": "per unit"},
        "geometry": {"x": 100, "y": 400, "width": 320, "height": 200, "z_index": 5}
    }

After expansion the instance is REMOVED from ``doc.nodes`` and the
definition's nodes are inserted in its place. Inserted node ids are
namespaced as ``<instance_id>__<original_id>`` to avoid collisions across
instances.

Nested instances are expanded recursively (a definition's nodes may contain
other component_instance nodes).
"""

from __future__ import annotations

import copy
import re
from typing import Any, Dict, List, Optional, Tuple

_PROP_RE = re.compile(r"\{\{\s*([A-Za-z0-9_]+)\s*\}\}")
_MAX_DEPTH = 8  # guards against accidental recursion loops
# Nested instances multiply nodes (10 instances x 8 levels = 10^8):
# cap on the size of any expanded list.
MAX_EXPANDED_NODES = 50_000


def expand_components(doc: Dict[str, Any]) -> Dict[str, Any]:
    """Return a deep-copy of ``doc`` with every component_instance expanded."""
    if not isinstance(doc, dict):
        raise TypeError("expand_components expects a dict")

    out = copy.deepcopy(doc)
    definitions = _collect_definitions(out)
    if not definitions:
        # No definitions: strip any instance nodes so the renderer doesn't see
        # an unknown kind (best-effort; leaves the doc unchanged otherwise).
        return out

    nodes = out.get("nodes")
    if not isinstance(nodes, list):
        return out

    expanded = _expand_node_list(nodes, definitions, depth=0)
    out["nodes"] = expanded
    return out


# --------------------------------------------------------------------------- #
# Internals.
# --------------------------------------------------------------------------- #


def _collect_definitions(doc: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    meta = doc.get("metadata") if isinstance(doc.get("metadata"), dict) else {}
    comp_root = meta.get("components") if isinstance(meta.get("components"), dict) else {}
    defs = comp_root.get("definitions")
    out: Dict[str, Dict[str, Any]] = {}
    if isinstance(defs, list):
        for d in defs:
            if isinstance(d, dict) and isinstance(d.get("id"), str):
                out[d["id"]] = d
    return out


def _expand_node_list(
    nodes: List[Dict[str, Any]],
    definitions: Dict[str, Dict[str, Any]],
    depth: int,
) -> List[Dict[str, Any]]:
    """Walk ``nodes`` and replace every component_instance with its expansion.

    Returns a fresh flat list. Children/parent_id bookkeeping is updated:
        - inside the expanded subtree, ids are namespaced and parent_id is
          rewritten consistently
        - the topmost expanded nodes inherit the instance's parent_id, and the
          instance's parent (if present) has its children_ids list updated
    """
    if depth > _MAX_DEPTH:
        raise ValueError(
            f"component_expander: recursion deeper than {_MAX_DEPTH} levels — "
            "check for self-referencing definitions"
        )

    by_id: Dict[str, Dict[str, Any]] = {
        n.get("id"): n for n in nodes if isinstance(n, dict) and isinstance(n.get("id"), str)
    }

    result: List[Dict[str, Any]] = []
    for node in nodes:
        if not isinstance(node, dict):
            result.append(node)
            continue
        if node.get("kind") != "component_instance":
            result.append(node)
            continue

        # It's an instance — expand.
        comp_id = node.get("component_id")
        definition = definitions.get(comp_id) if isinstance(comp_id, str) else None
        if definition is None:
            # Unknown component: drop the instance to avoid renderer errors.
            # Also unlink it from its parent's children_ids.
            _unlink_from_parent(by_id, node)
            continue

        expanded_nodes = _instantiate(node, definition, depth)

        # Re-walk in case the definition contains nested instances.
        expanded_nodes = _expand_node_list(expanded_nodes, definitions, depth + 1)

        # Update parent's children_ids: replace the instance id with all
        # top-level expanded ids.
        instance_id = node.get("id")
        parent_id = node.get("parent_id")
        parent = by_id.get(parent_id) if isinstance(parent_id, str) else None
        top_ids = [
            n["id"]
            for n in expanded_nodes
            if isinstance(n, dict) and n.get("parent_id") == parent_id and isinstance(n.get("id"), str)
        ]
        if parent is not None:
            kids = parent.get("children_ids")
            if isinstance(kids, list):
                new_kids: List[str] = []
                replaced = False
                for cid in kids:
                    if cid == instance_id:
                        new_kids.extend(top_ids)
                        replaced = True
                    else:
                        new_kids.append(cid)
                if not replaced:
                    new_kids.extend(top_ids)
                parent["children_ids"] = new_kids

        result.extend(expanded_nodes)
        if len(result) > MAX_EXPANDED_NODES:
            raise ValueError("component_expander: expansion too large")

    return result


def _instantiate(
    instance: Dict[str, Any],
    definition: Dict[str, Any],
    depth: int,
) -> List[Dict[str, Any]]:
    """Materialize a single component_instance into a flat list of nodes."""
    instance_id = str(instance.get("id") or "instance")
    parent_id = instance.get("parent_id")
    props: Dict[str, Any] = {}
    defaults = definition.get("defaults") if isinstance(definition.get("defaults"), dict) else None
    if defaults:
        props.update(defaults)
    inst_props = instance.get("props")
    if isinstance(inst_props, dict):
        props.update(inst_props)

    # Read instance geometry — defines the final placement of the component.
    inst_geom = instance.get("geometry") if isinstance(instance.get("geometry"), dict) else {}
    ox = float(inst_geom.get("x", 0) or 0)
    oy = float(inst_geom.get("y", 0) or 0)
    ow = float(inst_geom.get("width", 0) or 0)
    oh = float(inst_geom.get("height", 0) or 0)
    z_offset = int(inst_geom.get("z_index", 0) or 0)

    # Definition authoring viewport — used to compute scale if the instance
    # has a different bbox than the definition declared.
    def_w = float(definition.get("width", 0) or 0)
    def_h = float(definition.get("height", 0) or 0)
    scale_x = (ow / def_w) if (def_w > 0 and ow > 0) else 1.0
    scale_y = (oh / def_h) if (def_h > 0 and oh > 0) else 1.0

    raw_nodes = definition.get("nodes") if isinstance(definition.get("nodes"), list) else []

    # First pass: deep-copy nodes, rename ids, build id-rewrite map.
    id_map: Dict[str, str] = {}
    cloned: List[Dict[str, Any]] = []
    for n in raw_nodes:
        if not isinstance(n, dict):
            continue
        c = copy.deepcopy(n)
        orig_id = c.get("id")
        if isinstance(orig_id, str) and orig_id:
            new_id = f"{instance_id}__{orig_id}"
            id_map[orig_id] = new_id
            c["id"] = new_id
        cloned.append(c)

    # Second pass: rewrite parent_id/children_ids, substitute props, offset geo.
    top_level: List[Dict[str, Any]] = []
    for c in cloned:
        # Rewrite parent_id.
        pid = c.get("parent_id")
        if isinstance(pid, str) and pid in id_map:
            c["parent_id"] = id_map[pid]
        else:
            # Top-level node inside the definition → reparent to the
            # instance's parent.
            c["parent_id"] = parent_id
            top_level.append(c)

        # Rewrite children_ids.
        kids = c.get("children_ids")
        if isinstance(kids, list):
            c["children_ids"] = [id_map.get(k, k) for k in kids]

        # Apply geometry offset + scale to ALL nodes (children inherit too,
        # because they were authored in the definition's local coordinate
        # space, and we want the whole subtree shifted by the instance origin).
        geom = c.get("geometry")
        if isinstance(geom, dict):
            try:
                gx = float(geom.get("x", 0) or 0)
                gy = float(geom.get("y", 0) or 0)
                gw = float(geom.get("width", 0) or 0)
                gh = float(geom.get("height", 0) or 0)
                geom["x"] = ox + gx * scale_x
                geom["y"] = oy + gy * scale_y
                if gw > 0:
                    geom["width"] = gw * scale_x
                if gh > 0:
                    geom["height"] = gh * scale_y
                gz = int(geom.get("z_index", 0) or 0)
                geom["z_index"] = z_offset + gz
            except (TypeError, ValueError):
                pass

        # Substitute {{prop}} placeholders across the node.
        _substitute_props(c, props)

    return cloned


def _substitute_props(node: Any, props: Dict[str, Any]) -> None:
    """Walk a node tree and substitute every ``{{prop_name}}`` placeholder."""
    if isinstance(node, dict):
        for k, v in list(node.items()):
            if isinstance(v, str):
                node[k] = _sub_string(v, props)
            else:
                _substitute_props(v, props)
    elif isinstance(node, list):
        for i, v in enumerate(node):
            if isinstance(v, str):
                node[i] = _sub_string(v, props)
            else:
                _substitute_props(v, props)


def _sub_string(s: str, props: Dict[str, Any]) -> Any:
    """Replace ``{{prop}}`` placeholders. If the string is ONLY a placeholder
    and the prop is non-string, returns the raw value (so numeric props stay
    numeric)."""
    m = _PROP_RE.fullmatch(s)
    if m:
        name = m.group(1)
        if name in props:
            return props[name]
        return s

    def _r(match: re.Match) -> str:
        name = match.group(1)
        if name in props:
            val = props[name]
            return "" if val is None else str(val)
        return match.group(0)

    return _PROP_RE.sub(_r, s)


def _unlink_from_parent(by_id: Dict[str, Dict[str, Any]], instance: Dict[str, Any]) -> None:
    pid = instance.get("parent_id")
    iid = instance.get("id")
    if not isinstance(pid, str) or not isinstance(iid, str):
        return
    parent = by_id.get(pid)
    if parent is None:
        return
    kids = parent.get("children_ids")
    if isinstance(kids, list) and iid in kids:
        parent["children_ids"] = [k for k in kids if k != iid]


__all__ = ["expand_components"]
