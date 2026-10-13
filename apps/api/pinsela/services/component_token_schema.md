# Pinsela Design Tokens & Components — Schema

The token resolver and component expander run as preprocessors inside
`expand_macros(doc)` (in `doc_macros.py`). Both are deep-copy pure functions
and idempotent.

Pipeline order (top of `expand_macros`):

```
doc -> resolve_tokens -> expand_components -> resolve_tokens
    -> shadow / glow / brush / gradient / metallic / tint / ...
```

The second `resolve_tokens` exists because component definitions can hold
`$tokens.*` strings; instantiating them produces fresh node copies that
must be re-resolved.

---

## 1. `doc.tokens`

A flat namespace of design constants. Any string-valued field anywhere in
the doc can reference one with `$tokens.<dotted.path>`. If the resolved
value is a dict (e.g. a full text style), it is *merged into the parent
dict* rather than written as a single value — so a `"style": "$tokens.fonts.h1"`
expands into `family`, `postscript`, `size`, etc. on the surrounding dict.

```json
"tokens": {
  "colors": {
    "primary": "#936947",
    "secondary": "#B8893F",
    "ink": "#1F1108",
    "paper": "#F5EBDD",
    "accent": "#FFD06E"
  },
  "fonts": {
    "headline": {
      "family": "Inter",
      "postscript": "Inter-Medium",
      "size": 72,
      "line_height": 110,
      "letter_spacing": -1
    },
    "body":    {"family": "Inter", "postscript": "Inter-Regular", "size": 28},
    "caption": {"family": "Inter", "postscript": "Inter-Regular", "size": 18}
  },
  "spacing": {"xs": 8, "sm": 16, "md": 24, "lg": 48, "xl": 80, "xxl": 128},
  "radii":   {"sm": 6, "md": 12, "lg": 24, "pill": 999}
}
```

### Reference syntax

```json
"fill":  "$tokens.colors.primary"      // scalar replace
"size":  "$tokens.spacing.lg"          // scalar replace (number)
"style": "$tokens.fonts.headline"      // dict merge into parent
```

Sibling keys win over merged keys: if you author
`{"style": "$tokens.fonts.headline", "size": 96}`, you keep `size: 96`.

Unresolvable refs (typo, missing path) pass through unchanged so the
validator can flag them.

---

## 2. `doc.metadata.components.definitions[]`

Reusable component library — declared once, instanced many times.

```jsonc
{
  "id": "price_card",            // referenced by component_instance.component_id
  "params": ["price", "unit"],   // informational
  "defaults": {"unit": "per unit"},
  "width": 320,                  // authoring viewport (used for scale)
  "height": 200,
  "nodes": [                     // local-coord node tree
    {
      "id": "bg",
      "kind": "rect",
      "parent_id": null,         // top-level inside the definition
      "children_ids": ["price", "unit_lbl"],
      "geometry": {"x": 0, "y": 0, "width": 320, "height": 200, "corner_radius": 18, "z_index": 0},
      "style":    {"fill": "$tokens.colors.primary"},
      "text": null, "text_runs": [], "image_src": null
    },
    { "id": "price", "kind": "text", "parent_id": "bg",
      "text": "{{price}}", "text_runs": [{"text": "{{price}}", "style": "$tokens.fonts.headline"}],
      "geometry": {"x": 16, "y": 28, "width": 288, "height": 96}
    },
    { "id": "unit_lbl", "kind": "text", "parent_id": "bg",
      "text": "{{unit}}",
      "geometry": {"x": 16, "y": 140, "width": 288, "height": 36}
    }
  ]
}
```

### Rules

- Node ids inside a definition are *local* (e.g. `bg`, `price`).
- `parent_id: null` marks definition-top-level nodes; multiple top-level
  nodes are supported.
- `{{prop}}` placeholders may appear in any string field
  (`text`, `image_src`, attribute values, etc.). When the entire string
  is `{{prop}}` and the prop is non-string, the raw value is substituted
  (numeric props stay numeric).
- `$tokens.*` references are resolved *after* expansion, so component
  definitions may also reference tokens freely.

---

## 3. `kind: "component_instance"`

A placeholder node that the expander replaces with a deep copy of the
definition's nodes.

```jsonc
{
  "id": "card_a",
  "kind": "component_instance",
  "component_id": "price_card",
  "parent_id": "page",
  "props": {"price": "R$ 99,90"},   // merged over definition.defaults
  "geometry": {
    "x": 100, "y": 500,
    "width": 320, "height": 200,    // controls final scale + bbox
    "z_index": 10
  }
}
```

### What expansion does

1. Deep-copies each definition node.
2. Renames every node id as `<instance_id>__<original_id>` to avoid
   collisions across instances.
3. Rewrites `parent_id` / `children_ids` to use the namespaced ids.
4. Top-level definition nodes are reparented to the instance's parent;
   nested children keep their internal hierarchy.
5. Offsets every node's geometry by the instance's `(x, y)` and *scales*
   width/height/x/y by `instance_geom.width / definition.width`
   (and same for height). z_index is offset by the instance's z_index.
6. Substitutes `{{prop}}` placeholders using `defaults` then `props`.
7. Updates the parent node's `children_ids`, replacing the instance id
   with the list of top-level expanded ids.
8. Recurses: a definition may itself contain component_instance nodes
   (max depth 8 to prevent loops).
9. Unknown `component_id` → the instance is silently dropped and unlinked
   from its parent.

---

## 4. Built-in component library

See `builtin_components.py` (or run `pinsela_compose.py list-builtins`).
Call `inject_builtins(doc)` once at the start of your build to make all of
them available without re-authoring definitions.

| id                 | size       | params                                          |
| ------------------ | ---------- | ----------------------------------------------- |
| `price_card`       | 320x200    | price, unit                                     |
| `title_header` | 1080x320   | brand_logo_asset, title, subtitle               |
| `contact_footer`   | 1080x160   | phone, city, whatsapp_asset, pin_asset          |
| `disclaimer_block` | 1080x80    | text                                            |
| `corner_brackets`  | 600x400    | color, weight (positional via instance geo)     |
| `metallic_band`    | 1080x40    | colors (uses `metallic` macro under the hood)   |
| `cta_button`       | 320x80     | label                                           |
| `info_chip`        | 240x56     | icon_asset, label                               |

All built-ins reference brand tokens (`$tokens.colors.primary`, etc.) so
swapping `doc.tokens` re-skins every instance instantly.

---

## 5. Examples

### Minimal: change brand color via tokens only

```jsonc
{
  "tokens": {"colors": {"primary": "#3D7A47", "paper": "#F8F4EC"}},
  "nodes": [
    {"id": "bg", "kind": "rect",
     "style": {"fill": "$tokens.colors.primary"},
     "geometry": {"x":0,"y":0,"width":1080,"height":1080}}
  ]
}
```

Change `primary` to anything else → entire piece re-skins.

### Two price cards driven by the same component

```jsonc
{
  "tokens": { /* ... */ },
  "metadata": {"components": {"definitions": [ /* price_card def */ ]}},
  "nodes": [
    {"id": "card_a", "kind": "component_instance", "component_id": "price_card",
     "parent_id": "page", "props": {"price": "R$ 99,90"},
     "geometry": {"x": 100, "y": 500, "width": 320, "height": 200, "z_index": 10}},
    {"id": "card_b", "kind": "component_instance", "component_id": "price_card",
     "parent_id": "page", "props": {"price": "R$ 199,00", "unit": "kit 3x"},
     "geometry": {"x": 600, "y": 500, "width": 320, "height": 200, "z_index": 10}}
  ]
}
```

---

## 6. Debugging

```bash
# See what your doc looks like after preprocessing (no render):
python3 scripts/agent-tools/pinsela_compose.py expand my_doc.json

# Same, but with built-ins injected first:
python3 scripts/agent-tools/pinsela_compose.py expand my_doc.json --inject-builtins

# Starter tokens.json:
python3 scripts/agent-tools/pinsela_compose.py tokens-template > tokens.json
```
