from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any


def _is_primitive(v: Any) -> bool:
    return v is None or isinstance(v, (str, int, float, bool))


def diff(before: Any, after: Any, *, path: str = "") -> dict:
    """
    Produces a JSON-serializable diff.
    Not a full RFC-6902 patch; optimized for human review in the editor UI.
    """

    out = {"added": [], "removed": [], "changed": []}

    def add(kind: str, p: str, b: Any = None, a: Any = None) -> None:
        if kind == "added":
            out["added"].append({"path": p, "value": a})
        elif kind == "removed":
            out["removed"].append({"path": p, "value": b})
        else:
            out["changed"].append({"path": p, "before": b, "after": a})

    if _is_primitive(before) and _is_primitive(after):
        if before != after:
            add("changed", path or ".", before, after)
        return out

    if isinstance(before, Mapping) and isinstance(after, Mapping):
        keys = set(before.keys()) | set(after.keys())
        for k in sorted(keys):
            p = f"{path}.{k}" if path else str(k)
            if k not in before:
                add("added", p, None, after[k])
            elif k not in after:
                add("removed", p, before[k], None)
            else:
                sub = diff(before[k], after[k], path=p)
                out["added"].extend(sub["added"])
                out["removed"].extend(sub["removed"])
                out["changed"].extend(sub["changed"])
        return out

    # Lists: if primitive list, compare directly; otherwise fallback to whole-list change.
    if isinstance(before, Sequence) and isinstance(after, Sequence) and not isinstance(before, (str, bytes)) and not isinstance(after, (str, bytes)):
        if all(_is_primitive(x) for x in before) and all(_is_primitive(x) for x in after):
            if list(before) != list(after):
                add("changed", path or ".", list(before), list(after))
            return out
        # Complex arrays: treat as a single changed value to avoid noisy diffs.
        if before != after:
            add("changed", path or ".", before, after)
        return out

    # Type mismatch or complex structures.
    if before != after:
        add("changed", path or ".", before, after)
    return out
