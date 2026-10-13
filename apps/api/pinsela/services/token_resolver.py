"""Design token resolver for Pinsela native docs.

Operates as a PREPROCESSOR before macro expansion. Walks the entire doc tree
and replaces ``$tokens.<path.to.value>`` references with the resolved value
from ``doc.tokens``.

Tokens shape (example)::

    doc["tokens"] = {
        "colors": {
            "primary": "#936947",
            "ink": "#1F1108",
            "paper": "#F5EBDD",
        },
        "fonts": {
            "headline": {
                "family": "Inter",
                "postscript": "Inter-Medium",
                "size": 72,
                "line_height": 110,
                "letter_spacing": -1,
            },
            "body": {
                "family": "Inter",
                "postscript": "Inter-Regular",
                "size": 28,
            },
        },
        "spacing": {"xs": 8, "sm": 16, "md": 24, "lg": 48, "xl": 80},
        "radii": {"sm": 6, "md": 12, "lg": 24, "pill": 999},
    }

Usage from a node::

    {
        "id": "title",
        "kind": "text",
        "text": "Bem-vinda",
        "text_runs": [{
            "text": "Bem-vinda",
            "style": "$tokens.fonts.headline",
            "fill": "$tokens.colors.primary"
        }],
        "style": {"fill": "$tokens.colors.paper"},
        "geometry": {"x": "$tokens.spacing.lg", "y": "$tokens.spacing.lg"}
    }

When a token reference points to a dict (e.g. ``$tokens.fonts.headline``),
that whole dict replaces the original value. This makes it easy to apply a
full text style with one reference.

The resolver is idempotent: re-running on a doc with no remaining
``$tokens.*`` strings is a no-op.
"""

from __future__ import annotations

import copy
import re
from typing import Any, Dict

# Match values like "$tokens.colors.primary" or "$tokens.fonts.headline.size".
# Path must be at least 1 segment (must contain a dot after $tokens).
_TOKEN_RE = re.compile(r"^\$tokens\.([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)$")


def resolve_tokens(doc: Dict[str, Any]) -> Dict[str, Any]:
    """Return a deep-copy of ``doc`` with every ``$tokens.*`` reference resolved.

    Unresolvable references are left as-is (so the validator can complain
    further down the pipeline if needed). The function is safe to call
    multiple times and on docs without a ``tokens`` table.
    """
    if not isinstance(doc, dict):
        raise TypeError("resolve_tokens expects a dict")

    out = copy.deepcopy(doc)
    tokens = out.get("tokens")
    if not isinstance(tokens, dict):
        # Nothing to resolve, but still walk so we strip nothing weird.
        return out

    _walk(out, tokens, ("",), [MAX_RESOLVED_NODES])
    return out


# --------------------------------------------------------------------------- #
# Internals.
# --------------------------------------------------------------------------- #


def _lookup(tokens: Dict[str, Any], path: str) -> Any:
    """Walk dotted path inside ``tokens``. Returns sentinel ``_MISS`` if absent."""
    cur: Any = tokens
    for seg in path.split("."):
        if not isinstance(cur, dict) or seg not in cur:
            return _MISS
        cur = cur[seg]
    return cur


_MISS = object()

# Cap on nodes copied per resolution: a large token referenced thousands of
# times would multiply memory/CPU ("billion laughs"-style amplification).
MAX_RESOLVED_NODES = 200_000


class TokenBudgetExceeded(ValueError):
    pass


def _count_nodes(value: Any) -> int:
    stack, n = [value], 0
    while stack:
        cur = stack.pop()
        n += 1
        if isinstance(cur, dict):
            stack.extend(cur.values())
        elif isinstance(cur, list):
            stack.extend(cur)
    return n


def _charge(budget: list, value: Any) -> None:
    budget[0] -= _count_nodes(value)
    if budget[0] < 0:
        raise TokenBudgetExceeded("token_expansion_too_large")


def _resolve_value(value: Any, tokens: Dict[str, Any], budget: list) -> Any:
    """If ``value`` is a token reference string, return its resolved value."""
    if not isinstance(value, str):
        return value
    m = _TOKEN_RE.match(value)
    if not m:
        return value
    resolved = _lookup(tokens, m.group(1))
    if resolved is _MISS:
        return value
    _charge(budget, resolved)
    # Deep-copy so callers can mutate without poisoning the tokens table.
    return copy.deepcopy(resolved)


def _walk(node: Any, tokens: Dict[str, Any], breadcrumbs: tuple, budget: list) -> None:
    """Recursively replace token refs in-place.

    Dict-valued resolutions of fields like ``style`` get merged INTO the parent
    dict (so ``"style": "$tokens.fonts.headline"`` expands the headline dict
    into the surrounding style block). Scalar fields are simply replaced.
    """
    if isinstance(node, dict):
        # Two-pass: first identify keys whose VALUE is a dict-token-ref, so we
        # can merge them into the parent rather than overwriting.
        merge_keys: list[str] = []
        for k, v in list(node.items()):
            if isinstance(v, str):
                resolved = _resolve_value(v, tokens, budget)
                if resolved is v:
                    # No change.
                    continue
                if isinstance(resolved, dict):
                    # Merge: drop the key (e.g. "style": "$tokens.fonts.h1") and
                    # then splice every key from the resolved dict into the
                    # parent. Existing sibling keys take precedence — they were
                    # likely authored as overrides.
                    merge_keys.append(k)
                    for inner_k, inner_v in resolved.items():
                        if inner_k not in node:
                            # `resolved` is already a fresh copy: do not copy again.
                            node[inner_k] = inner_v
                else:
                    node[k] = resolved
            else:
                _walk(v, tokens, breadcrumbs + (str(k),), budget)
        for k in merge_keys:
            # Remove the original ref string only if we merged INTO this dict
            # at the top level. If the key is itself a structural one (e.g.
            # "style" with sub-fields), we already merged inner fields, so we
            # drop the ref placeholder safely.
            node.pop(k, None)
    elif isinstance(node, list):
        for i, v in enumerate(node):
            if isinstance(v, str):
                resolved = _resolve_value(v, tokens, budget)
                if resolved is not v:
                    node[i] = resolved
            else:
                _walk(v, tokens, breadcrumbs + (str(i),), budget)


__all__ = ["resolve_tokens", "TokenBudgetExceeded", "MAX_RESOLVED_NODES"]
