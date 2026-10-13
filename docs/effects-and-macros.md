# Pinsela native renderer — effects and macros reference

The native Pillow renderer ignores `style.effects[]` silently. To compose
shadows, glows, gradients and other "designer touches" without modifying the
renderer, the doc-macro preprocessor expands them as sibling primitives before
rendering.

```
client doc with `_macros`  →  expand_macros()  →  flat doc  →  render
```

Add an `_macros` dict on any node, then either:

- call `POST /api/agent/macros/render` (expand + render), or
- call `POST /api/agent/macros/expand` then `POST /api/agent/render`.

The expanded doc no longer contains `_macros` on any node and is guaranteed
to pass `validate_native_doc`.

---

## 1. drop_shadow (legacy / cheap)

Stacks 4-10 silhouettes behind a source node with decaying alpha. Good for
text drops where blur is small.

```json
"_macros": {
  "drop_shadow": {
    "offset_x": 0, "offset_y": 4,
    "blur_px": 8,
    "color": "#000000",
    "opacity": 0.35
  }
}
```

Limitations: edges look stepped when blur > 16. Prefer `soft_shadow` for
photo cards and large product mockups.

---

## 2. soft_shadow (recommended)

Pre-renders a true Gaussian shadow PNG via Pillow's `GaussianBlur`, then
inserts a single image node behind the source. Much cleaner edges.

```json
"_macros": {
  "soft_shadow": {
    "offset_x": 0, "offset_y": 18,
    "blur": 32,
    "color": "#1A0F00",
    "opacity": 0.30
  }
}
```

Use for: product mockups, photo cards, hero images. The PNG is cached on
disk by shape + blur params, so reruns are free.

---

## 3. glow

Outer glow via stacked silhouettes that grow outward.

```json
"_macros": {
  "glow": {
    "radius": 24,
    "color": "#FFE6B0",
    "intensity": 0.55
  }
}
```

---

## 4. gradient

Generates a gradient PNG and sets it as the node's `image_src`. Supports
linear and radial.

```json
"_macros": {
  "gradient": {
    "type": "linear",
    "angle": 90,
    "stops": [
      {"offset": 0.0, "color": "#0F0C08"},
      {"offset": 1.0, "color": "#3D2C18"}
    ]
  }
}
```

Radial:

```json
"_macros": {
  "gradient": {
    "type": "radial",
    "stops": [
      {"offset": 0.0, "color": "#FFFFFFFF"},
      {"offset": 1.0, "color": "#FFFFFF00"}
    ],
    "transparent": true
  }
}
```

---

## 5. metallic

Like `gradient`, but with subtle per-pixel noise overlay and a curated 3-stop
default (gold ramp). Produces the brushed-metal eyebrow seen in metallic brand references and
other premium product ads.

```json
"_macros": {
  "metallic": {
    "colors": ["#B8893F", "#F5D88A", "#8E6A2F"],
    "direction": "vertical",
    "noise": 0.08
  }
}
```

When to use: gold/silver/copper bars, eyebrow ribbons, foil seals.
`noise` 0.05-0.12 looks brushed; 0.2+ looks coarse.

---

## 6. brush

Emits N jittered overlapping primitives over a node to fake ink/marker/chalk/
spray textures.

```json
"_macros": {
  "brush": {
    "preset": "ink",
    "weight": 6,
    "color": "#1F1F1F"
  }
}
```

---

## 7. photo_tint

Adds a translucent colored rect over an image to give a warm/cool cast for
brand consistency.

```json
"_macros": {
  "photo_tint": {
    "color": "#D4A867",
    "strength": 0.18
  }
}
```

Use when stock photos need to match brand palette without re-editing the
asset.

---

## 8. photo_border

Inset stroke on top of an image (transparent fill + stroke). Follows the
image's corner radius.

```json
"_macros": {
  "photo_border": {
    "color": "#9B7B3F",
    "weight": 2
  }
}
```

---

## 9. corner_brackets

Auto-generates 4 L-shaped brackets at the corners of a frame's bbox. Saves
Claude from manually computing 8 rect nodes.

```json
"_macros": {
  "corner_brackets": {
    "length": 60,
    "weight": 3,
    "color": "#9B7B3F",
    "inset": 24
  }
}
```

`inset` is the offset OUTSIDE the frame edges. Negative values put the
brackets inside the frame.

---

## 10. vignette

Radial dark overlay around an image (subtle darkened corners).

```json
"_macros": {
  "vignette": {
    "color": "#000000",
    "strength": 0.45,
    "falloff": 0.55
  }
}
```

`falloff` is the inner radius (0-1) before darkening starts.

---

## Stacking

Multiple macros can stack on the same node:

```json
"_macros": {
  "soft_shadow": { "offset_y": 18, "blur": 32, "opacity": 0.35 },
  "photo_border": { "color": "#9B7B3F", "weight": 2 },
  "vignette": { "strength": 0.30, "falloff": 0.65 }
}
```

Expansion order is fixed: `shadows → glows → brushes → gradients → metallic →
photo_tint → soft_shadow → photo_border → corner_brackets → vignette`.

---

## Endpoints

| Endpoint | Purpose |
|---|---|
| `POST /api/agent/macros/expand`   | Expand macros, return validated doc |
| `POST /api/agent/macros/render`   | Expand + render in one shot |
| `POST /api/agent/macros/gradient` | Standalone gradient PNG (now accepts `noise`) |
| `GET  /api/agent/macros/presets`  | Live schema for every supported macro |

Date: 2026-05-26
