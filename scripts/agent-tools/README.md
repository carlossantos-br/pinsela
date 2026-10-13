# pinsela_canvas — agent CLI + library for PinselaTemplateDocV1 docs

A small Python toolkit that lets Claude Code (or any caller) create, inspect,
patch and render the JSON documents the local Pinsela editor consumes.

## Install

No install step — it's a single script. Two ways to invoke:

1. **Recommended**: the wrapper script auto-selects the Pinsela API venv (which
   already has `pydantic`, `httpx`, `Pillow`):

   ```bash
   scripts/agent-tools/pinsela_canvas <command> ...
   ```

2. **Direct**: any Python 3 — the CLI works in stdlib-only mode, but `render`
   needs `httpx` and `extract-palette` needs `Pillow`:

   ```bash
   python3 scripts/agent-tools/pinsela_canvas.py <command> ...
   ```

The full pydantic-based validator is used automatically when reachable;
otherwise a pure-stdlib structural validator runs in its place.

## CLI commands

### `new` — create a fresh minimal doc

```bash
pinsela_canvas new --canvas 1080x1080 --bg "#FFFFFF" --out /tmp/doc.json
```

### `validate <doc>` — run the full validator (or fallback)

```bash
pinsela_canvas validate /tmp/doc.json
```

Exit code is `0` on success, `1` on invalid, `2` on I/O errors.

### `summarize <doc>` — structured text summary

```bash
pinsela_canvas summarize /tmp/doc.json
```

### `tree <doc>` — ASCII hierarchy

```bash
pinsela_canvas tree /tmp/doc.json
```

### `find <doc> [--by-name X | --by-kind K | --by-id ID] [--json]`

```bash
pinsela_canvas find /tmp/doc.json --by-kind text
pinsela_canvas find /tmp/doc.json --by-name title --json
```

### `patch <doc> <node_id> --set key=value [--set ...] [--json '<obj>']`

`key` may use dot notation. Values are auto-typed (int / float / bool / null
/ string). Use `--json` for complex objects.

```bash
pinsela_canvas patch /tmp/doc.json rect_abc \
    --set geometry.x=120 --set geometry.y=80 \
    --set style.fill='"#FF6600"'

pinsela_canvas patch /tmp/doc.json text_a1 --json '{"text_style":{"size":72,"color":"#111"}}'
```

### `add <doc> <parent_id> <kind> --name N [--props '<json>']`

Auto-generates id; sets `z_index = max+1`; merges optional `--props` into
the default node template. `kind` is one of `frame|group|rect|text|image|line|path`.

```bash
pinsela_canvas add /tmp/doc.json root rect --name HEADER \
    --props '{"geometry":{"x":40,"y":40,"width":1000,"height":160},"style":{"fill":"#0EA5E9"}}'
```

### `remove <doc> <node_id>`

Removes the node + every descendant; purges any bindings that referenced
them. Root cannot be removed.

### `reorder <doc> <node_id> (--delta N | --to-front | --to-back)`

```bash
pinsela_canvas reorder /tmp/doc.json rect_abc --to-front
pinsela_canvas reorder /tmp/doc.json text_xy --delta -1
```

### `clone <doc> <node_id> [--offset dx,dy]`

```bash
pinsela_canvas clone /tmp/doc.json rect_abc --offset 40,40
```

### `apply-pattern <doc> <pattern> --at <parent_id> [--vars k=v ...]`

`pattern` is either an absolute path or a bare name resolved against
`$PINSELA_PATTERN_DIR/<name>.json` (default `<repo>/patterns`). A pattern uses
`__ROOT__` as a placeholder for its mount point, and `{{var}}` substitutions
are applied to every string before insertion. All pattern node ids are
prefixed with `pN_` to avoid collisions.

```bash
pinsela_canvas apply-pattern /tmp/doc.json card_three_up --at root \
    --vars title="Promo" --vars subtitle="Hoje"
```

### `diff <a.json> <b.json>` — structural diff

```bash
pinsela_canvas diff /tmp/before.json /tmp/after.json
```

### `render <doc> [--out PATH] [--scale 1.0] [--bg as-is|transparent|white] [--api URL]`

POSTs the doc to `POST /api/agent/render` on the local Pinsela API (built by
agent 8). Default base URL is `http://localhost:8000`; falls back to
`http://localhost:8201` automatically.

```bash
pinsela_canvas render /tmp/doc.json
pinsela_canvas render /tmp/doc.json --out /tmp/preview.png --scale 0.5 --bg white
```

### `extract-palette <image> [--count 5] [--json]`

Extract a hex palette from a reference image, sorted by `saturation * prominence`.

```bash
pinsela_canvas extract-palette /tmp/reference.jpg --count 6 --json
```

## Library usage

Import the primitive ops directly:

```python
import sys
sys.path.insert(0, "scripts/agent-tools")

from pinsela_canvas_ops import (
    empty_doc, load_doc, save_doc, validate,
    find, patch, add, remove, reorder_z, clone,
    apply_pattern, summarize, tree, default_node, diff,
)

doc = empty_doc(1080, 1350, background="#0B0F14")
rect = add(doc, doc["root_id"], "rect", name="HERO",
           props={"geometry": {"x": 60, "y": 60, "width": 960, "height": 540},
                  "style": {"fill": "#F2B705"}})
patch(doc, rect, {"geometry": {"corner_radius": 24}})
ok, err = validate(doc)
save_doc("/tmp/hero.json", doc)
print(tree(doc))
```

`default_node(kind, name=None, **overrides)` mirrors the TypeScript
`defaultNode()` factory in `ui/src/pinsela/core/scene.ts` so the python-side
defaults stay in lockstep with what the editor expects.

`save_doc` writes a `<path>.bak` copy of any pre-existing file by default;
pass `backup=False` to disable.

## Patterns

Patterns referenced by `apply-pattern` live in `$PINSELA_PATTERN_DIR`
(default `<repo>/patterns`) as `<name>.json`. A pattern is a mini-doc
fragment with a single `__ROOT__` node whose children are the nodes to
splice into the target parent.

## Local project storage

Pinsela persists native docs at
`<data root>/projects/<project_key>/native/doc.json`.
To inject an agent-generated doc into a local project you can write straight
to that path (or to its sibling `draft/doc.json`) — `pinsela_canvas new --out`
accepts any destination.
