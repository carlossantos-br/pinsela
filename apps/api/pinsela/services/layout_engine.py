"""Flexbox auto-layout solver for the native renderer.

This module implements a CSS-flexbox-like algorithm consumed by
`render_engine_native.py`. It is additive: nodes whose
`layout.direction == "none"` are not touched, preserving backward
compatibility with previously authored documents.

Public API
==========
- compute_flex_layout(parent_node, children_nodes_in_order, all_nodes_map)
    Mutates the children's `geometry` (x, y, width, height) in-place
    based on parent's `layout` (direction, gap, padding_*, align_main,
    align_cross, sizing_mode, wrap).
- apply_flex_to_doc(doc) — walks every node with direction != "none"
    and runs compute_flex_layout for its direct children.

We deliberately keep the algorithm focused on the features described in
the PinselaTemplateDocV1 schema (template_native.py). It is NOT a full
CSS flexbox; in particular flex-grow weighting beyond `sizing_mode=fill`
and `space_around` are out of scope.
"""

from __future__ import annotations

from typing import Any


def _f(v: Any, default: float = 0.0) -> float:
    try:
        return float(v)
    except Exception:
        return default


def _children_in_order(parent: dict[str, Any], all_nodes_map: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for cid in parent.get("children_ids") or []:
        c = all_nodes_map.get(str(cid))
        if isinstance(c, dict):
            out.append(c)
    return out


def _is_visible(node: dict[str, Any]) -> bool:
    style = node.get("style") if isinstance(node.get("style"), dict) else {}
    return bool(style.get("visible", True))


def _main_axis(direction: str) -> str:
    return "x" if direction == "horizontal" else "y"


def _cross_axis(direction: str) -> str:
    return "y" if direction == "horizontal" else "x"


def _main_size(geom: dict[str, Any], direction: str) -> float:
    return _f(geom.get("width" if direction == "horizontal" else "height"), 0.0)


def _cross_size(geom: dict[str, Any], direction: str) -> float:
    return _f(geom.get("height" if direction == "horizontal" else "width"), 0.0)


def _set_main_size(geom: dict[str, Any], direction: str, value: float) -> None:
    geom["width" if direction == "horizontal" else "height"] = max(0.0, value)


def _set_cross_size(geom: dict[str, Any], direction: str, value: float) -> None:
    geom["height" if direction == "horizontal" else "width"] = max(0.0, value)


def _main_pos_keys(direction: str) -> tuple[str, str]:
    """Return (parent_inner_main_start_offset_keyx, child_position_key)."""
    return ("padding_left", "x") if direction == "horizontal" else ("padding_top", "y")


def _cross_pos_keys(direction: str) -> tuple[str, str]:
    return ("padding_top", "y") if direction == "horizontal" else ("padding_left", "x")


def compute_flex_layout(
    parent: dict[str, Any],
    children: list[dict[str, Any]],
    all_nodes_map: dict[str, dict[str, Any]] | None = None,
) -> dict[str, tuple[float, float, float, float]]:
    """Solve flexbox positions and sizes for the direct children of `parent`.

    Mutates each child's `geometry` in place. Returns a dict mapping
    child id -> (x, y, w, h) for inspection/tests.
    """
    layout = parent.get("layout") if isinstance(parent.get("layout"), dict) else {}
    direction = str(layout.get("direction") or "none").strip().lower()
    if direction not in {"horizontal", "vertical"}:
        return {}

    visible_children = [c for c in children if _is_visible(c)]
    if not visible_children:
        return {}

    pgeom = parent.get("geometry") if isinstance(parent.get("geometry"), dict) else {}
    parent_x = _f(pgeom.get("x"), 0.0)
    parent_y = _f(pgeom.get("y"), 0.0)
    parent_w = _f(pgeom.get("width"), 0.0)
    parent_h = _f(pgeom.get("height"), 0.0)

    pad_top = _f(layout.get("padding_top"), 0.0)
    pad_right = _f(layout.get("padding_right"), 0.0)
    pad_bottom = _f(layout.get("padding_bottom"), 0.0)
    pad_left = _f(layout.get("padding_left"), 0.0)

    inner_w = max(0.0, parent_w - pad_left - pad_right)
    inner_h = max(0.0, parent_h - pad_top - pad_bottom)
    inner_main = inner_w if direction == "horizontal" else inner_h
    inner_cross = inner_h if direction == "horizontal" else inner_w

    gap = max(0.0, _f(layout.get("gap"), 0.0))
    align_main = str(layout.get("align_main") or "start").strip().lower()
    align_cross = str(layout.get("align_cross") or "start").strip().lower()
    sizing_mode = str(layout.get("sizing_mode") or "fixed").strip().lower()
    wrap = bool(layout.get("wrap", False))

    # 1) Resolve each child's main/cross size honoring sizing_mode=fill etc.
    fill_children: list[dict[str, Any]] = []
    fixed_main_total = 0.0
    for c in visible_children:
        cgeom = c.get("geometry") if isinstance(c.get("geometry"), dict) else {}
        c_layout = c.get("layout") if isinstance(c.get("layout"), dict) else {}
        c_sizing = str(c_layout.get("sizing_mode") or "fixed").strip().lower()
        if c_sizing == "fill":
            fill_children.append(c)
        else:
            fixed_main_total += _main_size(cgeom, direction)

    # cross: align_cross == "stretch" expands children to inner_cross
    for c in visible_children:
        cgeom = c.get("geometry") if isinstance(c.get("geometry"), dict) else {}
        c_layout = c.get("layout") if isinstance(c.get("layout"), dict) else {}
        c_sizing = str(c_layout.get("sizing_mode") or "fixed").strip().lower()
        if align_cross == "stretch" or c_sizing == "fill":
            _set_cross_size(cgeom, direction, inner_cross)
        c["geometry"] = cgeom

    # main: distribute remaining space across fill children
    if fill_children and inner_main > 0:
        total_gaps = gap * max(0, len(visible_children) - 1)
        remaining = max(0.0, inner_main - fixed_main_total - total_gaps)
        per = remaining / float(len(fill_children))
        for c in fill_children:
            cgeom = c.get("geometry") if isinstance(c.get("geometry"), dict) else {}
            _set_main_size(cgeom, direction, per)
            c["geometry"] = cgeom

    # 2) Wrap into lines if needed (parent dimension matters here)
    lines: list[list[dict[str, Any]]] = []
    if wrap and inner_main > 0:
        current: list[dict[str, Any]] = []
        used = 0.0
        for c in visible_children:
            cgeom = c.get("geometry") if isinstance(c.get("geometry"), dict) else {}
            sz = _main_size(cgeom, direction)
            needed = sz + (gap if current else 0.0)
            if current and (used + needed) > inner_main + 1e-3:
                lines.append(current)
                current = [c]
                used = sz
            else:
                current.append(c)
                used += needed
        if current:
            lines.append(current)
    else:
        lines = [visible_children]

    out: dict[str, tuple[float, float, float, float]] = {}

    # 3) Position children line-by-line
    cross_cursor_start = pad_top if direction == "horizontal" else pad_left
    cross_cursor = cross_cursor_start

    # Pre-compute per-line cross extents (for wrap multi-line). For align_cross stretch,
    # each line takes the full inner_cross when only one line; otherwise per-line max child cross.
    for line_idx, line in enumerate(lines):
        # compute per-line total main and per-line max cross
        line_main_total = 0.0
        line_max_cross = 0.0
        for i, c in enumerate(line):
            cgeom = c.get("geometry") if isinstance(c.get("geometry"), dict) else {}
            line_main_total += _main_size(cgeom, direction)
            if i < len(line) - 1:
                line_main_total += gap
            line_max_cross = max(line_max_cross, _cross_size(cgeom, direction))

        # main-axis start offset
        free = max(0.0, inner_main - line_main_total)
        if align_main == "center":
            main_start = (pad_left if direction == "horizontal" else pad_top) + (free / 2.0)
        elif align_main == "end":
            main_start = (pad_left if direction == "horizontal" else pad_top) + free
        elif align_main == "space_between" and len(line) > 1:
            main_start = pad_left if direction == "horizontal" else pad_top
            # gap will be overridden per-line
            line_gap = gap + (free / float(len(line) - 1))
        else:
            main_start = pad_left if direction == "horizontal" else pad_top
            line_gap = gap

        if align_main != "space_between" or len(line) <= 1:
            line_gap = gap

        main_cursor = (parent_x if direction == "horizontal" else parent_y) + main_start

        for i, c in enumerate(line):
            cgeom = c.get("geometry") if isinstance(c.get("geometry"), dict) else {}
            c_main = _main_size(cgeom, direction)
            c_cross = _cross_size(cgeom, direction)

            # cross-axis offset within this line
            line_cross_extent = inner_cross if (len(lines) == 1) else line_max_cross
            if align_cross == "center":
                cross_offset = (line_cross_extent - c_cross) / 2.0
            elif align_cross == "end":
                cross_offset = line_cross_extent - c_cross
            elif align_cross == "stretch":
                cross_offset = 0.0
                _set_cross_size(cgeom, direction, line_cross_extent)
                c_cross = line_cross_extent
            else:  # start
                cross_offset = 0.0

            cross_abs = (parent_y if direction == "horizontal" else parent_x) + cross_cursor + cross_offset

            if direction == "horizontal":
                cgeom["x"] = main_cursor
                cgeom["y"] = cross_abs
            else:
                cgeom["y"] = main_cursor
                cgeom["x"] = cross_abs

            c["geometry"] = cgeom
            cid = str(c.get("id") or "")
            out[cid] = (
                _f(cgeom.get("x"), 0.0),
                _f(cgeom.get("y"), 0.0),
                _f(cgeom.get("width"), 0.0),
                _f(cgeom.get("height"), 0.0),
            )

            main_cursor += c_main
            if i < len(line) - 1:
                main_cursor += line_gap

        cross_cursor += line_max_cross + (gap if line_idx < len(lines) - 1 else 0.0)

    # 4) sizing_mode=hug for the parent itself: shrink to fit content
    if sizing_mode == "hug":
        if direction == "horizontal":
            # main = sum of line main_total (single line) OR max per line
            content_main = 0.0
            for line in lines:
                lt = 0.0
                for i, c in enumerate(line):
                    cg = c.get("geometry") if isinstance(c.get("geometry"), dict) else {}
                    lt += _main_size(cg, direction)
                    if i < len(line) - 1:
                        lt += gap
                content_main = max(content_main, lt)
            content_cross = sum(
                max((_cross_size(c.get("geometry") or {}, direction) for c in line), default=0.0)
                for line in lines
            ) + gap * max(0, len(lines) - 1)
            pgeom["width"] = content_main + pad_left + pad_right
            pgeom["height"] = content_cross + pad_top + pad_bottom
        else:
            content_main = 0.0
            for line in lines:
                lt = 0.0
                for i, c in enumerate(line):
                    cg = c.get("geometry") if isinstance(c.get("geometry"), dict) else {}
                    lt += _main_size(cg, direction)
                    if i < len(line) - 1:
                        lt += gap
                content_main = max(content_main, lt)
            content_cross = sum(
                max((_cross_size(c.get("geometry") or {}, direction) for c in line), default=0.0)
                for line in lines
            ) + gap * max(0, len(lines) - 1)
            pgeom["height"] = content_main + pad_top + pad_bottom
            pgeom["width"] = content_cross + pad_left + pad_right
        parent["geometry"] = pgeom

    return out


def apply_flex_to_doc(doc: dict[str, Any]) -> int:
    """Walk every node in doc and apply flex layout to its direct children.

    Returns the number of containers that were resolved.
    """
    nodes = doc.get("nodes") if isinstance(doc.get("nodes"), list) else []
    nmap: dict[str, dict[str, Any]] = {}
    for n in nodes:
        if isinstance(n, dict) and n.get("id"):
            nmap[str(n["id"])] = n

    resolved = 0
    # Process parents in two-pass: first leaves, then up — but a simple
    # depth-aware order via DFS from root.
    root_id = str(doc.get("root_id") or "").strip()

    def _walk(node_id: str) -> None:
        nonlocal resolved
        node = nmap.get(node_id)
        if not node:
            return
        # Recurse children first so hug-sizing parents can react to resolved children.
        for cid in node.get("children_ids") or []:
            _walk(str(cid))
        layout = node.get("layout") if isinstance(node.get("layout"), dict) else {}
        direction = str(layout.get("direction") or "none").strip().lower()
        if direction in {"horizontal", "vertical"}:
            children = _children_in_order(node, nmap)
            if children:
                compute_flex_layout(node, children, nmap)
                resolved += 1

    if root_id:
        _walk(root_id)
    else:
        for n in nodes:
            if isinstance(n, dict):
                _walk(str(n.get("id") or ""))

    return resolved
