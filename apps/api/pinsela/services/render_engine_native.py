from __future__ import annotations

import base64
import copy
import hashlib
import io
import math
import os
import re
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx
from PIL import Image, ImageChops, ImageDraw, ImageFont

from pinsela.config import get_settings
from pinsela.security import fetch_public_url, resolve_under
from pinsela.services import effects_engine, gradient_native, image_fade, layout_engine, shape_native, text_engine


class NativeRenderEngineError(RuntimeError):
    pass


# Blend mode mapping: PIL ImageChops verbs that operate on RGBA images
# require the two layers to be the same size, so we handle them per-node
# by compositing onto a temporary canvas sized like the node layer.
_BLEND_MODES = {"multiply", "screen", "overlay", "darken", "lighten", "difference", "soft_light"}


def _apply_blend(base: Image.Image, top: Image.Image, mode: str, paste_xy: tuple[int, int]) -> None:
    """Composite `top` onto `base` at `paste_xy` honoring blend mode.

    Falls back to normal alpha composite on unknown modes.
    """
    mode = str(mode or "normal").strip().lower()
    if mode in {"", "normal", "pass-through", "pass_through"}:
        base.alpha_composite(top, paste_xy)
        return

    bw, bh = base.size
    tw, th = top.size
    px, py = paste_xy
    # crop region of base that overlaps top
    x1 = max(0, px)
    y1 = max(0, py)
    x2 = min(bw, px + tw)
    y2 = min(bh, py + th)
    if x2 <= x1 or y2 <= y1:
        return

    region = base.crop((x1, y1, x2, y2))
    top_crop = top.crop((x1 - px, y1 - py, x2 - px, y2 - py))

    # Blend using ImageChops on RGB; preserve alpha via mask
    region_rgb = region.convert("RGB")
    top_rgb = top_crop.convert("RGB")

    if mode == "multiply":
        blended = ImageChops.multiply(region_rgb, top_rgb)
    elif mode == "screen":
        blended = ImageChops.screen(region_rgb, top_rgb)
    elif mode == "darken":
        blended = ImageChops.darker(region_rgb, top_rgb)
    elif mode == "lighten":
        blended = ImageChops.lighter(region_rgb, top_rgb)
    elif mode == "difference":
        blended = ImageChops.difference(region_rgb, top_rgb)
    elif mode == "overlay":
        # overlay = a < 128 ? 2*a*b/255 : 255 - 2*(255-a)*(255-b)/255 — emulate
        blended = ImageChops.overlay(region_rgb, top_rgb)
    elif mode == "soft_light":
        blended = ImageChops.soft_light(region_rgb, top_rgb) if hasattr(ImageChops, "soft_light") else ImageChops.overlay(region_rgb, top_rgb)
    else:
        base.alpha_composite(top, paste_xy)
        return

    blended_rgba = blended.convert("RGBA")
    top_alpha = top_crop.split()[-1]
    blended_rgba.putalpha(top_alpha)
    region.alpha_composite(blended_rgba)
    base.paste(region, (x1, y1))


_UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
_DATA_URI_RE = re.compile(r"^data:([^;,]+)?(;base64)?,(.*)$", re.IGNORECASE | re.DOTALL)
_CSS_RGB_RE = re.compile(r"^rgba?\((.+)\)$", re.IGNORECASE)
_ASSET_URI_RE = re.compile(
    r"^(?:asset://|(?:https?://[^/]+)?(?:/v2)?/api/assets/)([0-9a-fA-F-]{36})(?:[/?#].*)?$",
    re.IGNORECASE,
)


def _repo_root() -> Path:
    try:
        return Path(__file__).resolve().parents[4]
    except Exception:
        return Path.cwd()


_REPO_ROOT = _repo_root()
BUNDLED_FONTS_DIR = _REPO_ROOT / "ui" / "public" / "fonts" / "google"


def _extra_font_dirs() -> list[Path]:
    """Extra font directories from $PINSELA_FONT_DIRS (os.pathsep-separated)."""
    raw = str(os.environ.get("PINSELA_FONT_DIRS") or "").strip()
    return [Path(p).expanduser() for p in raw.split(os.pathsep) if p.strip()]


def _font_dirs() -> list[Path]:
    return [
        BUNDLED_FONTS_DIR,
        *_extra_font_dirs(),
        Path("/usr/local/share/fonts"),
        Path("/usr/share/fonts"),
        Path("/usr/share/fonts/truetype"),
        Path("/usr/share/fonts/truetype/dejavu"),
        Path("/usr/share/fonts/truetype/liberation"),
        Path("/Library/Fonts"),
    ]


DEFAULT_FONT_FAMILY = "Inter"
_BUNDLED_FILE_RE = re.compile(r"^(?P<slug>[a-z0-9-]+?)-(?P<weight>\d{3})(?P<italic>i?)\.woff2$")
_WEIGHT_WORDS = (
    ("thin", 100),
    ("hairline", 100),
    ("extralight", 200),
    ("ultralight", 200),
    ("semibold", 600),
    ("demibold", 600),
    ("extrabold", 800),
    ("ultrabold", 800),
    ("light", 300),
    ("medium", 500),
    ("bold", 700),
    ("black", 900),
    ("heavy", 900),
)


def _family_slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(name or "").lower())


def _bundled_index() -> dict[str, list[tuple[int, bool, Path]]]:
    """family slug -> [(weight, italic, path)] for the OFL fonts shipped in the repo."""
    out: dict[str, list[tuple[int, bool, Path]]] = {}
    try:
        files = sorted(BUNDLED_FONTS_DIR.glob("*.woff2"))
    except OSError:
        return out
    for f in files:
        m = _BUNDLED_FILE_RE.match(f.name)
        if not m:
            continue
        out.setdefault(_family_slug(m.group("slug")), []).append((int(m.group("weight")), bool(m.group("italic")), f))
    return out


_BUNDLED_INDEX: dict[str, list[tuple[int, bool, Path]]] | None = None


def _style_to_weight_italic(style: str | None, postscript: str | None) -> tuple[int, bool]:
    text = f"{style or ''} {postscript or ''}".lower().replace("-", "").replace(" ", "").replace("_", "")
    italic = "italic" in text or "oblique" in text
    weight = 400
    for word, w in _WEIGHT_WORDS:
        if word in text:
            weight = w
            break
    return weight, italic


def _load_bundled_font(family: str, weight: int, italic: bool, size: int) -> ImageFont.FreeTypeFont | None:
    global _BUNDLED_INDEX
    if _BUNDLED_INDEX is None:
        _BUNDLED_INDEX = _bundled_index()
    entries = _BUNDLED_INDEX.get(_family_slug(family))
    if not entries:
        return None
    same_style = [e for e in entries if e[1] == italic] or entries
    best = min(same_style, key=lambda e: abs(e[0] - weight))
    try:
        font = ImageFont.truetype(str(best[2]), size)
    except Exception:
        return None
    try:
        axes = font.get_variation_axes()
        if axes:
            lo, hi = axes[0]["minimum"], axes[0]["maximum"]
            font.set_variation_by_axes([max(lo, min(hi, weight))])
    except Exception:
        pass
    return font


@dataclass
class NativeRenderedImage:
    bytes: bytes
    width: int
    height: int
    sha256: str


def _safe_float(v: Any, default: float = 0.0) -> float:
    try:
        return float(v)
    except Exception:
        return default


def _safe_int(v: Any, default: int = 0) -> int:
    try:
        return int(v)
    except Exception:
        return default


def _clamp_byte(v: Any) -> int:
    return max(0, min(255, int(round(_safe_float(v, 0.0)))))


def _coerce_alpha_factor(v: Any, default: float = 1.0) -> float:
    x = _safe_float(v, default)
    if x > 1.0:
        x = x / 255.0 if x > 100 else x / 100.0
    return max(0.0, min(1.0, x))


def _mul_alpha(rgba: tuple[int, int, int, int], factor: float) -> tuple[int, int, int, int]:
    f = max(0.0, min(1.0, factor))
    a = max(0, min(255, int(round((rgba[3] / 255.0) * f * 255.0))))
    return (rgba[0], rgba[1], rgba[2], a)


def _coerce_rgba(v: Any, default: tuple[int, int, int, int] = (0, 0, 0, 255)) -> tuple[int, int, int, int]:
    if isinstance(v, (list, tuple)):
        parts = list(v)
        if len(parts) >= 3:
            r = _clamp_byte(parts[0])
            g = _clamp_byte(parts[1])
            b = _clamp_byte(parts[2])
            a = _clamp_byte(parts[3]) if len(parts) >= 4 else 255
            return (r, g, b, a)
    if isinstance(v, str):
        s = v.strip()
        low = s.lower()
        if low in {"transparent", "none"}:
            return (0, 0, 0, 0)
        if s.startswith("#"):
            s = s[1:]
            if len(s) == 3:
                s = "".join(ch * 2 for ch in s)
            if len(s) == 6:
                try:
                    return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16), 255)
                except Exception:
                    return default
            if len(s) == 8:
                try:
                    return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16), int(s[6:8], 16))
                except Exception:
                    return default
        m = _CSS_RGB_RE.match(s)
        if m:
            raw = m.group(1).replace("/", ",")
            parts = [p for p in re.split(r"[,\s]+", raw) if p]
            if len(parts) >= 3:
                def _parse_chan(txt: str) -> float:
                    t = txt.strip()
                    if t.endswith("%"):
                        return (_safe_float(t[:-1], 0.0) / 100.0) * 255.0
                    return _safe_float(t, 0.0)

                r = _clamp_byte(_parse_chan(parts[0]))
                g = _clamp_byte(_parse_chan(parts[1]))
                b = _clamp_byte(_parse_chan(parts[2]))
                a = 255
                if len(parts) >= 4:
                    af = _coerce_alpha_factor(parts[3], 1.0)
                    a = _clamp_byte(af * 255.0)
                return (r, g, b, a)
        return default
    if isinstance(v, dict):
        if "color" in v:
            base = _coerce_rgba(v.get("color"), default=default)
            af = _coerce_alpha_factor(v.get("a"), 1.0) * _coerce_alpha_factor(v.get("opacity"), 1.0)
            return (base[0], base[1], base[2], _clamp_byte((base[3] / 255.0) * af * 255.0))
        if {"r", "g", "b"} <= set(v.keys()):
            r = _safe_float(v.get("r", 0))
            g = _safe_float(v.get("g", 0))
            b = _safe_float(v.get("b", 0))
            a = _safe_float(v.get("a", 1))
            opacity = _safe_float(v.get("opacity", 1))
            if max(r, g, b, a) <= 1.0:
                return (
                    max(0, min(255, int(round(r * 255)))),
                    max(0, min(255, int(round(g * 255)))),
                    max(0, min(255, int(round(b * 255)))),
                    max(0, min(255, int(round(a * opacity * 255)))),
                )
            return (
                max(0, min(255, int(round(r)))),
                max(0, min(255, int(round(g)))),
                max(0, min(255, int(round(b)))),
                max(0, min(255, int(round(a * opacity)))),
            )
    return default


def _stroke_width_profile_scale(profile: str) -> float:
    p = str(profile or "").strip().lower()
    if p == "taper_both":
        return 0.76
    if p in {"taper_start", "taper_end"}:
        return 0.88
    return 1.0


def _compute_stroke_width(stroke: dict[str, Any], default_width: float) -> float:
    base = max(0.0, _safe_float(stroke.get("width"), default_width))
    if base <= 0:
        return 0.0
    width = base * _stroke_width_profile_scale(str(stroke.get("width_profile") or "uniform"))
    mode = str(stroke.get("mode") or "basic").strip().lower()
    if mode == "dynamic":
        movement = max(0.0, min(1.0, _safe_float(stroke.get("dynamic_movement"), 0.0) / 100.0))
        smooth = max(0.0, min(1.0, _safe_float(stroke.get("dynamic_smooth"), 100.0) / 100.0))
        width *= 1.0 + movement * 0.34 * (1.0 - smooth * 0.6)
    elif mode == "brush":
        preset = str(stroke.get("brush_preset") or "ink").strip().lower()
        if preset == "marker":
            width *= 1.18
        elif preset == "chalk":
            width *= 1.26
        elif preset == "spray":
            width *= 1.34
        else:
            width *= 1.02
    return max(0.2, width)


def _stroke_from_stack_item(raw: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {
        "color": raw.get("color"),
        "width": raw.get("weight", raw.get("width")),
    }
    for key in (
        "opacity",
        "align",
        "mode",
        "width_profile",
        "width_profile_flip",
        "dynamic_frequency",
        "dynamic_movement",
        "dynamic_smooth",
        "brush_preset",
        "brush_flip",
        "sides",
        "cap",
        "join",
        "miter_limit",
        "dash",
    ):
        if key in raw:
            out[key] = raw.get(key)
    return out


def _resolve_stroke_layers(style: dict[str, Any]) -> list[dict[str, Any]]:
    layers: list[dict[str, Any]] = []
    stack = style.get("strokes")
    if isinstance(stack, list):
        for raw in stack:
            if not isinstance(raw, dict):
                continue
            if not bool(raw.get("enabled", True)) or not bool(raw.get("visible", True)):
                continue
            layers.append(_stroke_from_stack_item(raw))
    primary = style.get("stroke")
    if isinstance(primary, dict):
        if not layers:
            layers.append(primary)
        else:
            primary_mapped = _stroke_from_stack_item(primary)
            if layers[0] != primary_mapped:
                layers.insert(0, primary)
    return layers


def _asset_id_from_ref(ref: str) -> str | None:
    s = str(ref or "").strip()
    if not s:
        return None
    if _UUID_RE.match(s):
        return s
    m = _ASSET_URI_RE.match(s)
    if not m:
        return None
    candidate = str(m.group(1) or "").strip()
    return candidate if _UUID_RE.match(candidate) else None


def _load_input_asset_bytes(asset_id: str, *, db: Any | None = None) -> bytes | None:
    if db is None:
        return None
    from pinsela.models import InputAsset

    aid_txt = str(asset_id or "").strip()
    if not _UUID_RE.match(aid_txt):
        return None
    try:
        aid = uuid.UUID(aid_txt)
    except Exception:
        return None

    asset = db.query(InputAsset).filter(InputAsset.id == aid).one_or_none()
    if not asset:
        return None
    p = Path(asset.server_path)
    if not p.exists():
        return None
    try:
        return p.read_bytes()
    except Exception:
        return None


def _extract_image_bytes(ref: Any, *, db: Any | None = None) -> bytes | None:
    if ref is None:
        return None
    if isinstance(ref, dict):
        if isinstance(ref.get("data_uri"), str):
            ref = ref["data_uri"]
        elif isinstance(ref.get("asset_id"), str):
            ref = ref["asset_id"]
        elif isinstance(ref.get("url"), str):
            ref = ref["url"]
        else:
            return None

    if not isinstance(ref, str):
        return None
    s = ref.strip()
    if not s:
        return None

    m = _DATA_URI_RE.match(s)
    if m:
        encoded = m.group(3) or ""
        if ";base64" in (m.group(2) or "").lower():
            try:
                return base64.b64decode(encoded.encode("ascii"), validate=False)
            except Exception:
                return None
        return encoded.encode("utf-8")

    asset_id = _asset_id_from_ref(s)
    if asset_id:
        raw = _load_input_asset_bytes(asset_id, db=db)
        if raw:
            return raw

    if s.startswith("http://") or s.startswith("https://"):
        # Public hosts only (anti-SSRF: loopback, private network, metadata).
        try:
            data, _ctype = fetch_public_url(s, timeout=20.0, max_bytes=50 * 1024 * 1024)
            return data
        except Exception:
            return None

    # Local path: only inside the server data root (anti arbitrary read).
    try:
        p = resolve_under(Path(get_settings().server_data_root), s)
    except Exception:
        return None
    if p.is_file():
        try:
            return p.read_bytes()
        except Exception:
            return None
    return None


def _pick_font(*, family: str | None, style: str | None, postscript: str | None, size: float) -> ImageFont.ImageFont:
    sz = max(1, int(round(size)))
    candidates: list[Path] = []
    fam = str(family or "").strip()
    sty = str(style or "").strip()
    weight, italic = _style_to_weight_italic(sty, postscript)

    # 1) Bundled OFL families (deterministic, same files the browser loads).
    if fam:
        bundled = _load_bundled_font(fam, weight, italic, sz)
        if bundled is not None:
            return bundled

    # 2) Fonts installed in $PINSELA_FONT_DIRS / system dirs, matched by file name.
    def _with_ext(name: str) -> list[Path]:
        out: list[Path] = []
        for d in _font_dirs():
            out.append(d / f"{name}.otf")
            out.append(d / f"{name}.ttf")
        return out

    if postscript:
        candidates += _with_ext(str(postscript).strip())
    if fam:
        if sty:
            candidates += _with_ext(f"{fam}-{sty}")
            candidates += _with_ext(f"{fam} {sty}")
        candidates += _with_ext(fam)

    style_hint = (sty or "").lower()
    seen: set[str] = set()
    for p in candidates:
        sp = str(p)
        if sp in seen:
            continue
        seen.add(sp)
        if not p.exists():
            continue
        try:
            return ImageFont.truetype(sp, sz)
        except Exception:
            continue

    # 3) Default family (Inter), at the requested weight.
    default = _load_bundled_font(DEFAULT_FONT_FAMILY, weight, italic, sz)
    if default is not None:
        return default
    fallback_files: list[Path]
    if "bold" in style_hint or "semibold" in style_hint or "medium" in style_hint:
        fallback_files = [
            Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
            Path("/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"),
            Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
        ]
    else:
        fallback_files = [
            Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
            Path("/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"),
            Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
        ]
    for p in fallback_files:
        if not p.exists():
            continue
        try:
            return ImageFont.truetype(str(p), sz)
        except Exception:
            continue
    try:
        # Pillow's built-in fallback can be size-aware; keep requested text size.
        return ImageFont.load_default(size=sz)
    except TypeError:
        return ImageFont.load_default()


def _line_height(font: ImageFont.ImageFont, font_size: float, line_height: float | None, unit: str | None) -> float:
    if line_height is not None and line_height > 0:
        if str(unit or "").lower() == "percent":
            return max(1.0, float(font_size) * (float(line_height) / 100.0))
        return max(1.0, float(line_height))
    try:
        asc, desc = font.getmetrics()
        return max(1.0, float(asc + desc))
    except Exception:
        return max(1.0, float(font_size) * 1.2)


def _measure_text_width(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont, letter_spacing: float) -> float:
    if not text:
        return 0.0
    if abs(letter_spacing) < 1e-6:
        return float(draw.textlength(text, font=font))
    total = 0.0
    for i, ch in enumerate(text):
        total += float(draw.textlength(ch, font=font))
        if i < len(text) - 1:
            total += letter_spacing
    return total


def _wrap_lines(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont, max_width: float, letter_spacing: float) -> list[str]:
    parts = text.splitlines() if "\n" in text else [text]
    out: list[str] = []
    for part in parts:
        words = part.split()
        if not words:
            out.append("")
            continue
        cur = ""
        for w in words:
            candidate = (cur + " " + w).strip()
            width = _measure_text_width(draw, candidate, font, letter_spacing)
            if not cur or width <= max_width:
                cur = candidate
                continue
            out.append(cur)
            cur = w
        if cur:
            out.append(cur)
    return out


def _fit_text_lines(
    draw: ImageDraw.ImageDraw,
    text: str,
    *,
    width: float,
    height: float,
    font_family: str | None,
    font_style: str | None,
    font_postscript: str | None,
    start_size: float,
    min_size: float,
    max_lines: int | None,
    line_height: float | None,
    line_height_unit: str | None,
    letter_spacing: float,
) -> tuple[ImageFont.ImageFont, float, float, list[str]]:
    size = max(1.0, float(start_size))
    min_sz = max(1.0, float(min_size))
    text = str(text or "").strip()
    last_lines: list[str] = [text] if text else [""]
    last_font = _pick_font(family=font_family, style=font_style, postscript=font_postscript, size=size)
    last_lh = _line_height(last_font, size, line_height, line_height_unit)

    while size >= min_sz:
        font = _pick_font(family=font_family, style=font_style, postscript=font_postscript, size=size)
        lines = _wrap_lines(draw, text, font, width, letter_spacing)
        lh = _line_height(font, size, line_height, line_height_unit)
        needed_h = float(lh) * max(1, len(lines))
        lines_ok = True if max_lines is None else len(lines) <= max(1, max_lines)
        if lines_ok and needed_h <= max(1, height):
            return font, size, lh, lines
        last_lines, last_font, last_lh = lines, font, lh
        size -= 1.0

    return last_font, min_sz, last_lh, last_lines


def _draw_text_with_spacing(
    draw: ImageDraw.ImageDraw,
    text: str,
    *,
    x: float,
    y: float,
    font: ImageFont.ImageFont,
    fill: tuple[int, int, int, int],
    letter_spacing: float,
) -> None:
    if abs(letter_spacing) < 1e-6:
        draw.text((x, y), text, font=font, fill=fill)
        return
    cursor = x
    for i, ch in enumerate(text):
        draw.text((cursor, y), ch, font=font, fill=fill)
        cursor += float(draw.textlength(ch, font=font))
        if i < len(text) - 1:
            cursor += letter_spacing


def _draw_text_justified_line(
    draw: ImageDraw.ImageDraw,
    text: str,
    *,
    x: float,
    y: float,
    width: float,
    font: ImageFont.ImageFont,
    fill: tuple[int, int, int, int],
    letter_spacing: float,
) -> None:
    words = [w for w in str(text or "").split() if w]
    if len(words) < 2:
        _draw_text_with_spacing(draw, str(text or ""), x=x, y=y, font=font, fill=fill, letter_spacing=letter_spacing)
        return

    words_w = [_measure_text_width(draw, word, font, letter_spacing) for word in words]
    words_total = float(sum(words_w))
    gaps = len(words) - 1
    if gaps <= 0:
        _draw_text_with_spacing(draw, str(text or ""), x=x, y=y, font=font, fill=fill, letter_spacing=letter_spacing)
        return

    base_space = float(draw.textlength(" ", font=font))
    available = float(max(0.0, width))
    min_total = words_total + (base_space * gaps)
    if available <= min_total:
        _draw_text_with_spacing(draw, str(text or ""), x=x, y=y, font=font, fill=fill, letter_spacing=letter_spacing)
        return

    gap_w = (available - words_total) / float(gaps)
    cursor = float(x)
    for idx, word in enumerate(words):
        _draw_text_with_spacing(
            draw,
            word,
            x=cursor,
            y=y,
            font=font,
            fill=fill,
            letter_spacing=letter_spacing,
        )
        cursor += words_w[idx]
        if idx < gaps:
            cursor += gap_w


def _draw_text_arc(
    image: Image.Image,
    text: str,
    *,
    center_x: float,
    center_y: float,
    radius: float,
    start_angle: float,
    sweep_angle: float,
    clockwise: bool,
    font: ImageFont.ImageFont,
    fill: tuple[int, int, int, int],
) -> None:
    if not text:
        return
    draw = ImageDraw.Draw(image)
    step_sign = 1 if clockwise else -1
    if len(text) == 1:
        angle = start_angle
        x = center_x + radius * math.cos(math.radians(angle))
        y = center_y + radius * math.sin(math.radians(angle))
        draw.text((x, y), text, font=font, fill=fill, anchor="mm")
        return

    per = float(sweep_angle) / max(1, len(text) - 1)
    for i, ch in enumerate(text):
        angle = start_angle + (per * i * step_sign)
        rad = math.radians(angle)
        x = center_x + radius * math.cos(rad)
        y = center_y + radius * math.sin(rad)
        draw.text((x, y), ch, font=font, fill=fill, anchor="mm")


def _cubic_point(
    p0: tuple[float, float],
    p1: tuple[float, float],
    p2: tuple[float, float],
    p3: tuple[float, float],
    t: float,
) -> tuple[float, float]:
    mt = 1.0 - t
    mt2 = mt * mt
    t2 = t * t
    x = (mt2 * mt * p0[0]) + (3.0 * mt2 * t * p1[0]) + (3.0 * mt * t2 * p2[0]) + (t2 * t * p3[0])
    y = (mt2 * mt * p0[1]) + (3.0 * mt2 * t * p1[1]) + (3.0 * mt * t2 * p2[1]) + (t2 * t * p3[1])
    return (x, y)


def _draw_text_bezier(
    draw: ImageDraw.ImageDraw,
    text: str,
    *,
    base_x: float,
    base_y: float,
    points: list[dict[str, Any]],
    font: ImageFont.ImageFont,
    fill: tuple[int, int, int, int],
) -> None:
    if not text or len(points) < 4:
        return
    p0 = (float(points[0].get("x", 0.0)), float(points[0].get("y", 0.0)))
    p1 = (float(points[1].get("x", 0.0)), float(points[1].get("y", 0.0)))
    p2 = (float(points[2].get("x", 0.0)), float(points[2].get("y", 0.0)))
    p3 = (float(points[3].get("x", 0.0)), float(points[3].get("y", 0.0)))
    chars = list(text)
    n = max(1, len(chars) - 1)
    for i, ch in enumerate(chars):
        t = 0.0 if n == 0 else (i / n)
        px, py = _cubic_point(p0, p1, p2, p3, t)
        draw.text((base_x + px, base_y + py), ch, font=font, fill=fill)


def _align_offset(space: int, align: str) -> int:
    a = str(align or "").strip().lower()
    if a in {"left", "top", "start"}:
        return 0
    if a in {"right", "bottom", "end"}:
        return int(space)
    return int(round(space / 2.0))


def _compose_fitted_layer(
    resized: Image.Image,
    *,
    target_w: int,
    target_h: int,
    align_x: str = "center",
    align_y: str = "center",
) -> Image.Image:
    layer = Image.new("RGBA", (target_w, target_h), (0, 0, 0, 0))
    rw, rh = resized.size
    ox = _align_offset(target_w - rw, align_x)
    oy = _align_offset(target_h - rh, align_y)
    # alpha_composite accepts negative offsets and clips automatically.
    layer.alpha_composite(resized, (ox, oy))
    return layer


def _is_device_like_node(node: dict[str, Any]) -> bool:
    name = str(node.get("name") or "").strip().lower()
    nid = str(node.get("id") or "").strip().lower()
    return ("device" in name) or ("product" in name) or ("device" in nid)


def _is_logo_like_node(node: dict[str, Any]) -> bool:
    name = str(node.get("name") or "").strip().lower()
    return ("logo" in name) or ("icone" in name) or ("\u00edcone" in name)  # "icone" and its accented spelling (pt-BR layer names)


def _collect_node_map(doc: dict[str, Any]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for raw in doc.get("nodes") or []:
        if not isinstance(raw, dict):
            continue
        nid = str(raw.get("id") or "").strip()
        if not nid:
            continue
        out[nid] = raw
    return out


def _has_meaningful_value(v: Any) -> bool:
    if v is None:
        return False
    if isinstance(v, str):
        return bool(v.strip())
    if isinstance(v, list):
        return any(_has_meaningful_value(x) for x in v)
    if isinstance(v, dict):
        return bool(v)
    return True


def _product_field_index(name: str) -> int:
    m = re.match(
        r"^(?:title|titulo|body|descricao|description|subtitle|price|preco|installments|payment_note|product|nome)_?([0-9]+)$",
        str(name or ""),
        flags=re.IGNORECASE,
    )
    if not m:
        return 0
    try:
        n = int(m.group(1))
    except Exception:
        return 0
    return n if n > 0 else 0


def _infer_product_count(payload: dict[str, Any], bindings: dict[str, Any]) -> int:
    explicit = _safe_int(payload.get("product_count"), 0)
    if explicit > 0:
        return explicit

    n_from_fields = 0
    for k, v in payload.items():
        idx = _product_field_index(str(k))
        if idx > 0 and _has_meaningful_value(v):
            n_from_fields = max(n_from_fields, idx)
    if n_from_fields > 0:
        return n_from_fields

    images_array = bindings.get("images_array") if isinstance(bindings.get("images_array"), dict) else {}
    dev = images_array.get("device_images") if isinstance(images_array.get("device_images"), dict) else {}
    arr = payload.get("device_images")
    items = arr if isinstance(arr, list) else ([arr] if arr is not None else [])
    if not items:
        return 0
    slot_map = [int(x) for x in (dev.get("slot_product_index_map") or []) if str(x).strip().isdigit()]
    if bool(dev.get("per_product_input", False)) and slot_map:
        return min(len(items), max(slot_map))
    if slot_map:
        max_idx = 0
        for i, item in enumerate(items):
            if not _has_meaningful_value(item):
                continue
            if i < len(slot_map):
                max_idx = max(max_idx, slot_map[i])
        if max_idx > 0:
            return max_idx
    return len(items)


def _layout_pass(doc: dict[str, Any], payload: dict[str, Any]) -> tuple[dict[str, dict[str, Any]], int]:
    nodes_by_id = _collect_node_map(doc)
    bindings = doc.get("bindings") if isinstance(doc.get("bindings"), dict) else {}
    product_count = _infer_product_count(payload, bindings)

    text_bindings = bindings.get("text") if isinstance(bindings.get("text"), dict) else {}
    for field, rule in text_bindings.items():
        if not isinstance(rule, dict):
            continue
        node_id = str(rule.get("node_id") or "").strip()
        if not node_id or node_id not in nodes_by_id:
            continue
        value = payload.get(field)
        s = "" if value is None else str(value)
        max_len = rule.get("max_length")
        if isinstance(max_len, int) and max_len > 0 and len(s) > max_len:
            s = s[:max_len].rstrip()
        node = nodes_by_id[node_id]
        node["text"] = s
        fit = rule.get("fit") if isinstance(rule.get("fit"), dict) else {}
        if fit:
            node["fit"] = {
                "start_size": fit.get("start_size"),
                "min_size": fit.get("min_size"),
                "max_lines": fit.get("max_lines"),
                "min_lines": fit.get("min_lines"),
                "truncate_mode": fit.get("truncate_mode", "none"),
            }
        font = rule.get("font") if isinstance(rule.get("font"), dict) else {}
        if font:
            text_style = node.get("text_style") if isinstance(node.get("text_style"), dict) else {}
            for k in (
                "family",
                "postscript",
                "style",
                "size",
                "line_height",
                "line_height_unit",
                "letter_spacing",
                "text_align",
                "vertical_align",
            ):
                if k in font and font.get(k) is not None:
                    text_style[k] = font.get(k)
            node["text_style"] = text_style
        style = node.get("style") if isinstance(node.get("style"), dict) else {}
        # Preserve authored visibility even when binding value is empty.
        style["visible"] = bool(style.get("visible", True))
        node["style"] = style

    single_images = bindings.get("images_single") if isinstance(bindings.get("images_single"), dict) else {}
    for field, rule in single_images.items():
        if not isinstance(rule, dict):
            continue
        node_id = str(rule.get("node_id") or "").strip()
        if not node_id or node_id not in nodes_by_id:
            continue
        ref = payload.get(field)
        node = nodes_by_id[node_id]
        node["image_src"] = ref
        style = node.get("style") if isinstance(node.get("style"), dict) else {}
        # Preserve authored visibility even when binding value is empty.
        style["visible"] = bool(style.get("visible", True))
        node["style"] = style

    arrays = bindings.get("images_array") if isinstance(bindings.get("images_array"), dict) else {}
    for field, rule in arrays.items():
        if not isinstance(rule, dict):
            continue
        node_ids = [str(x).strip() for x in (rule.get("node_ids") or []) if str(x).strip()]
        if not node_ids:
            continue
        raw = payload.get(field)
        items = raw if isinstance(raw, list) else ([raw] if raw is not None else [])
        hide_empty = bool(rule.get("hide_empty", True))
        slot_map = [int(x) for x in (rule.get("slot_product_index_map") or []) if str(x).strip().isdigit()]
        use_per_product = bool(rule.get("per_product_input", False)) and bool(slot_map) and len(items) <= max(slot_map or [0])

        for i, node_id in enumerate(node_ids):
            node = nodes_by_id.get(node_id)
            if not node:
                continue
            mapped_product = slot_map[i] if i < len(slot_map) else 0
            if mapped_product > 0 and product_count > 0 and mapped_product > product_count:
                style = node.get("style") if isinstance(node.get("style"), dict) else {}
                # Keep node visible even when a mapped product slot is empty.
                style["visible"] = bool(style.get("visible", True))
                node["style"] = style
                node["image_src"] = None
                continue
            if use_per_product and mapped_product > 0:
                ref = items[mapped_product - 1] if (mapped_product - 1) < len(items) else None
            else:
                ref = items[i] if i < len(items) else None
            node["image_src"] = ref
            style = node.get("style") if isinstance(node.get("style"), dict) else {}
            # Preserve authored visibility even when binding value is empty.
            style["visible"] = bool(style.get("visible", True))
            node["style"] = style

    product_frames = bindings.get("product_frames") if isinstance(bindings.get("product_frames"), dict) else {}
    frame_ids = [str(x).strip() for x in (product_frames.get("node_ids") or []) if str(x).strip()]
    if frame_ids:
        for nid in frame_ids:
            node = nodes_by_id.get(nid)
            if not node:
                continue
            style = node.get("style") if isinstance(node.get("style"), dict) else {}
            # Preserve authored visibility even when product_count is lower/empty.
            style["visible"] = bool(style.get("visible", True))
            node["style"] = style

    rules = doc.get("dynamic_rules") if isinstance(doc.get("dynamic_rules"), list) else []
    for rule in rules:
        if not isinstance(rule, dict):
            continue
        rtype = str(rule.get("type") or "").strip().lower()

        if rtype == "hide_when_empty":
            binding_key = str(rule.get("binding_key") or "").strip()
            if not binding_key:
                continue
            should_hide = not _has_meaningful_value(payload.get(binding_key))
            item_ids = [str(x).strip() for x in (rule.get("item_ids") or []) if str(x).strip()]
            if not item_ids:
                container_id = str(rule.get("container_id") or "").strip()
                if container_id:
                    item_ids = [container_id]
            for nid in item_ids:
                node = nodes_by_id.get(nid)
                if not node:
                    continue
                style = node.get("style") if isinstance(node.get("style"), dict) else {}
                style["visible"] = not should_hide
                node["style"] = style
            continue

        if rtype not in {"product_visibility_reflow", "auto_layout_reflow", "collapse_spacing_when_hidden"}:
            continue
        item_ids = [str(x).strip() for x in (rule.get("item_ids") or []) if str(x).strip()]
        if not item_ids:
            continue

        direction = str(rule.get("reflow_direction") or "vertical").strip().lower()
        if direction not in {"vertical", "horizontal"}:
            direction = "vertical"
        collapse_spacing = bool(rule.get("collapse_spacing_when_hidden", True))
        recenter = bool(rule.get("recenter_on_children_visible", True))
        align = str(rule.get("align") or "center").strip().lower()
        gap = _safe_float(rule.get("gap"), 0)

        container_id = str(rule.get("container_id") or "").strip()
        container = nodes_by_id.get(container_id) if container_id else None
        cgeom = container.get("geometry") if isinstance(container and container.get("geometry"), dict) else {}
        cx = _safe_float(cgeom.get("x"), 0)
        cy = _safe_float(cgeom.get("y"), 0)
        cw = _safe_float(cgeom.get("width"), 0)
        ch = _safe_float(cgeom.get("height"), 0)

        all_items: list[dict[str, Any]] = []
        visible_items: list[dict[str, Any]] = []
        for nid in item_ids:
            node = nodes_by_id.get(nid)
            if not node:
                continue
            all_items.append(node)
            style = node.get("style") if isinstance(node.get("style"), dict) else {}
            if style.get("visible", True):
                visible_items.append(node)

        flow_items = visible_items if collapse_spacing else all_items
        if not flow_items:
            continue

        total_span = 0.0
        for i, node in enumerate(flow_items):
            geom = node.get("geometry") if isinstance(node.get("geometry"), dict) else {}
            total_span += _safe_float(geom.get("height"), 0) if direction == "vertical" else _safe_float(geom.get("width"), 0)
            if i < len(flow_items) - 1:
                total_span += gap

        if direction == "vertical":
            if container and ch > 0:
                if align == "start":
                    start = cy
                elif align == "end":
                    start = cy + max(0.0, ch - total_span)
                elif recenter:
                    start = cy + max(0.0, (ch - total_span) / 2.0)
                else:
                    first_geom = flow_items[0].get("geometry") if isinstance(flow_items[0].get("geometry"), dict) else {}
                    start = _safe_float(first_geom.get("y"), cy)
            else:
                first_geom = flow_items[0].get("geometry") if isinstance(flow_items[0].get("geometry"), dict) else {}
                start = _safe_float(first_geom.get("y"), 0)
                if align == "center" and recenter:
                    min_y = min(_safe_float((n.get("geometry") or {}).get("y"), 0) for n in flow_items)
                    max_y = max(_safe_float((n.get("geometry") or {}).get("y"), 0) + _safe_float((n.get("geometry") or {}).get("height"), 0) for n in flow_items)
                    start = min_y + max(0.0, ((max_y - min_y) - total_span) / 2.0)

            cursor = start
            for node in flow_items:
                geom = node.get("geometry") if isinstance(node.get("geometry"), dict) else {}
                geom["y"] = cursor
                node["geometry"] = geom
                cursor += _safe_float(geom.get("height"), 0) + gap
        else:
            if container and cw > 0:
                if align == "start":
                    start = cx
                elif align == "end":
                    start = cx + max(0.0, cw - total_span)
                elif recenter:
                    start = cx + max(0.0, (cw - total_span) / 2.0)
                else:
                    first_geom = flow_items[0].get("geometry") if isinstance(flow_items[0].get("geometry"), dict) else {}
                    start = _safe_float(first_geom.get("x"), cx)
            else:
                first_geom = flow_items[0].get("geometry") if isinstance(flow_items[0].get("geometry"), dict) else {}
                start = _safe_float(first_geom.get("x"), 0)
                if align == "center" and recenter:
                    min_x = min(_safe_float((n.get("geometry") or {}).get("x"), 0) for n in flow_items)
                    max_x = max(_safe_float((n.get("geometry") or {}).get("x"), 0) + _safe_float((n.get("geometry") or {}).get("width"), 0) for n in flow_items)
                    start = min_x + max(0.0, ((max_x - min_x) - total_span) / 2.0)

            cursor = start
            for node in flow_items:
                geom = node.get("geometry") if isinstance(node.get("geometry"), dict) else {}
                geom["x"] = cursor
                node["geometry"] = geom
                cursor += _safe_float(geom.get("width"), 0) + gap

    return nodes_by_id, product_count


def simulate_native_layout(doc: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(doc, dict):
        raise NativeRenderEngineError("Invalid engine_doc_json (object expected).")
    d = copy.deepcopy(doc)
    canvas = d.get("canvas") if isinstance(d.get("canvas"), dict) else {}
    width = _safe_int(canvas.get("width"), 0)
    height = _safe_int(canvas.get("height"), 0)
    if width <= 0 or height <= 0 or width > 20000 or height > 20000:
        raise NativeRenderEngineError("Invalid canvas in the native template.")
    nodes_by_id, _product_count = _layout_pass(d, payload if isinstance(payload, dict) else {})
    # Apply flex auto-layout to any node whose layout.direction is set.
    # This is additive: nodes with direction == "none" (the historical
    # default) are not touched, preserving every existing template.
    try:
        d["nodes"] = list(nodes_by_id.values())
        layout_engine.apply_flex_to_doc(d)
    except Exception:
        # Layout solver must never break rendering — fall back silently.
        pass
    nodes = list(nodes_by_id.values())
    nodes.sort(key=lambda n: _safe_int((n.get("geometry") or {}).get("z_index"), 0))
    d["nodes"] = nodes
    return d


def _node_needs_overhauled_path(node: dict[str, Any]) -> bool:
    """Detect whether a node uses any of the new features we now render
    via the auxiliary engines (gradient, shape_type, effects, rotation,
    blend_mode, text_runs).
    """
    style = node.get("style") if isinstance(node.get("style"), dict) else {}
    geom = node.get("geometry") if isinstance(node.get("geometry"), dict) else {}
    kind = str(node.get("kind") or "").strip().lower()

    fill = style.get("fill")
    if gradient_native.is_gradient_fill(fill):
        return True

    shape_type = str(style.get("shape_type") or "").strip().lower()
    if kind in {"rect", "frame", "group"} and shape_type in {"ellipse", "polygon", "star"}:
        return True

    effects = style.get("effects")
    if isinstance(effects, list) and any(isinstance(e, dict) and bool(e.get("enabled", e.get("visible", True))) for e in effects):
        return True

    blend_mode = str(style.get("blend_mode") or "").strip().lower()
    if blend_mode in _BLEND_MODES:
        return True

    rotation = _safe_float(geom.get("rotation"), 0.0)
    if abs(rotation) >= 0.01:
        return True

    text_runs = node.get("text_runs")
    if kind == "text" and isinstance(text_runs, list) and len(text_runs) >= 1:
        if any(isinstance(r, dict) and (r.get("text") or "").strip() for r in text_runs):
            return True

    image_duotone = style.get("image_duotone")
    if kind in {"image", "frame", "rect", "group"} and isinstance(image_duotone, dict) and image_duotone.get("enabled", True):
        return True

    fade_spec = style.get("image_fade")
    if kind in {"image", "frame", "rect", "group"} and isinstance(fade_spec, dict) and fade_spec.get("enabled", True):
        return True

    return False


def _apply_image_duotone(img: Image.Image, duotone: dict[str, Any]) -> Image.Image:
    """Re-map grayscale luminance to a two-color gradient.

    `duotone` shape: { "shadow": "#000", "highlight": "#fff", "intensity": 1.0 }
    """
    if not isinstance(duotone, dict):
        return img
    if not bool(duotone.get("enabled", True)):
        return img
    shadow = _coerce_rgba(duotone.get("shadow") or "#000000", default=(0, 0, 0, 255))
    highlight = _coerce_rgba(duotone.get("highlight") or "#ffffff", default=(255, 255, 255, 255))
    intensity = max(0.0, min(1.0, _safe_float(duotone.get("intensity"), 1.0)))
    if intensity <= 0:
        return img

    rgba = img.convert("RGBA")
    a = rgba.split()[-1]
    lum = rgba.convert("L")
    lut_r = bytearray(256)
    lut_g = bytearray(256)
    lut_b = bytearray(256)
    for i in range(256):
        t = i / 255.0
        lut_r[i] = int(round(shadow[0] + (highlight[0] - shadow[0]) * t))
        lut_g[i] = int(round(shadow[1] + (highlight[1] - shadow[1]) * t))
        lut_b[i] = int(round(shadow[2] + (highlight[2] - shadow[2]) * t))

    new_r = lum.point(lambda v: lut_r[v])
    new_g = lum.point(lambda v: lut_g[v])
    new_b = lum.point(lambda v: lut_b[v])
    duo = Image.merge("RGBA", (new_r, new_g, new_b, a))
    if intensity >= 1.0:
        return duo
    return Image.blend(rgba, duo, intensity)


def _draw_node_overhauled(
    base: Image.Image,
    node: dict[str, Any],
    *,
    db: Any | None = None,
) -> bool:
    style = node.get("style") if isinstance(node.get("style"), dict) else {}
    if not bool(style.get("visible", True)):
        return True
    geom = node.get("geometry") if isinstance(node.get("geometry"), dict) else {}
    x = _safe_float(geom.get("x"), 0)
    y = _safe_float(geom.get("y"), 0)
    w = max(1.0, _safe_float(geom.get("width"), 1))
    h = max(1.0, _safe_float(geom.get("height"), 1))
    rotation = _safe_float(geom.get("rotation"), 0.0)
    radius = max(0.0, _safe_float(geom.get("corner_radius"), 0))
    kind = str(node.get("kind") or "group").strip().lower()

    blend_mode = str(style.get("blend_mode") or "normal").strip().lower()
    node_opacity = _coerce_alpha_factor(style.get("opacity"), 1.0)

    shape_type = str(style.get("shape_type") or "").strip().lower()
    fill = style.get("fill")
    use_gradient = gradient_native.is_gradient_fill(fill)
    use_shape = kind in {"rect", "frame", "group"} and shape_type in {"ellipse", "polygon", "star"}

    iw = max(1, int(round(w)))
    ih = max(1, int(round(h)))
    layer = Image.new("RGBA", (iw, ih), (0, 0, 0, 0))

    handled = False

    if kind in {"rect", "frame", "group"} and (use_shape or use_gradient or shape_type in {"", "rect", "rectangle"}):
        fill_image: Image.Image | None = None
        fill_rgba_local: tuple[int, int, int, int] | None = None
        if use_gradient:
            fill_image = gradient_native.render_gradient_image(fill, (iw, ih))
        elif fill is not None:
            fill_rgba_local = _coerce_rgba(fill, default=(0, 0, 0, 0))
            if fill_rgba_local[3] <= 0:
                fill_rgba_local = None

        # Resolve the primary stroke so borders survive the overhauled path
        # (gradient/shape/effect/rotation/blend nodes used to lose their stroke).
        s_rgba: tuple[int, int, int, int] | None = None
        s_width = 0.0
        s_dash: Any = None
        _stroke_layers = _resolve_stroke_layers(style)
        if _stroke_layers:
            _st0 = _stroke_layers[0]
            s_rgba = _coerce_rgba(_st0.get("color"), default=(0, 0, 0, 0))
            s_rgba = _mul_alpha(s_rgba, _coerce_alpha_factor(_st0.get("opacity"), 1.0))
            s_width = _compute_stroke_width(_st0, _safe_float(_st0.get("width"), 0.0))
            s_dash = _st0.get("dash")

        shape_kind = shape_type if shape_type in {"ellipse", "polygon", "star"} else "rect"
        shape_layer = shape_native.render_shape(
            shape_kind,
            width=iw,
            height=ih,
            fill_rgba=fill_rgba_local,
            fill_image=fill_image,
            sides=_safe_int(style.get("shape_sides"), 6) if shape_kind == "polygon" else None,
            star_points=_safe_int(style.get("star_points"), 5) if shape_kind == "star" else None,
            star_inner_ratio=_safe_float(style.get("star_inner_ratio"), 0.5) if shape_kind == "star" else None,
            corner_radius=radius,
            stroke_rgba=s_rgba,
            stroke_width=s_width,
            stroke_dash=s_dash,
        )
        layer.alpha_composite(shape_layer)
        handled = True

    image_ref = node.get("image_src")
    if not _has_meaningful_value(image_ref):
        image_ref = node.get("image_asset_id")
    if kind in {"image", "frame", "rect", "group"} and _has_meaningful_value(image_ref):
        raw = _extract_image_bytes(image_ref, db=db)
        if not raw:
            fallback_ref = node.get("image_asset_id")
            if _has_meaningful_value(fallback_ref) and str(fallback_ref).strip() != str(image_ref).strip():
                raw = _extract_image_bytes(fallback_ref, db=db)
        if raw:
            try:
                src = Image.open(io.BytesIO(raw)).convert("RGBA")
                if bool(style.get("image_trim")):
                    bb = src.split()[-1].getbbox()
                    if bb:
                        try:
                            src = src.crop(bb)
                        except Exception:
                            pass
                target_w, target_h = iw, ih
                fit_mode = str(style.get("image_fit") or "fill").strip().lower()
                image_scale = max(0.01, _safe_float(style.get("image_scale"), 1.0))
                align_x = str(style.get("image_align_x") or "center").strip().lower()
                align_y = str(style.get("image_align_y") or "center").strip().lower()
                crop = style.get("image_crop") if isinstance(style.get("image_crop"), dict) else None
                if fit_mode == "crop" and crop:
                    sx = max(0, min(src.width - 1, _safe_int(crop.get("x"), 0)))
                    sy = max(0, min(src.height - 1, _safe_int(crop.get("y"), 0)))
                    sw = max(1, min(src.width - sx, _safe_int(crop.get("width"), src.width)))
                    sh = max(1, min(src.height - sy, _safe_int(crop.get("height"), src.height)))
                    cw = max(1, int(round(target_w * image_scale)))
                    ch = max(1, int(round(target_h * image_scale)))
                    resized = src.crop((sx, sy, sx + sw, sy + sh)).resize((cw, ch), Image.Resampling.LANCZOS)
                    img_layer = _compose_fitted_layer(resized, target_w=target_w, target_h=target_h, align_x=align_x, align_y=align_y)
                elif fit_mode == "fit":
                    ratio = min(target_w / src.width, target_h / src.height) * image_scale
                    rw, rh = max(1, int(round(src.width * ratio))), max(1, int(round(src.height * ratio)))
                    resized = src.resize((rw, rh), Image.Resampling.LANCZOS)
                    img_layer = _compose_fitted_layer(resized, target_w=target_w, target_h=target_h, align_x=align_x, align_y=align_y)
                else:
                    ratio = max(target_w / src.width, target_h / src.height) * image_scale
                    rw, rh = max(1, int(round(src.width * ratio))), max(1, int(round(src.height * ratio)))
                    resized = src.resize((rw, rh), Image.Resampling.LANCZOS)
                    img_layer = _compose_fitted_layer(resized, target_w=target_w, target_h=target_h, align_x=align_x, align_y=align_y)

                duotone = style.get("image_duotone")
                if isinstance(duotone, dict) and duotone.get("enabled", True):
                    img_layer = _apply_image_duotone(img_layer, duotone)

                fade_spec = style.get("image_fade")
                if image_fade.has_fade(fade_spec):
                    img_layer = image_fade.apply_image_fade(img_layer, fade_spec)

                shape_kind_for_image = shape_type if shape_type in {"ellipse", "polygon", "star"} else "rect"
                mask = shape_native.shape_mask(
                    shape_kind_for_image,
                    target_w,
                    target_h,
                    sides=_safe_int(style.get("shape_sides"), 6) if shape_kind_for_image == "polygon" else None,
                    star_points=_safe_int(style.get("star_points"), 5) if shape_kind_for_image == "star" else None,
                    star_inner_ratio=_safe_float(style.get("star_inner_ratio"), 0.5) if shape_kind_for_image == "star" else None,
                    corner_radius=radius,
                )
                alpha = img_layer.split()[-1]
                img_layer.putalpha(ImageChops.multiply(alpha, mask))

                layer.alpha_composite(img_layer)
                handled = True
            except Exception:
                pass

    if kind == "text":
        text_style = node.get("text_style") if isinstance(node.get("text_style"), dict) else {}
        text_runs = node.get("text_runs") if isinstance(node.get("text_runs"), list) else []
        has_runs = bool(text_runs and any(isinstance(r, dict) and (r.get("text") or "").strip() for r in text_runs))
        if has_runs:
            text_engine.render_text_with_runs(
                layer,
                text_runs,
                x=0,
                y=0,
                width=iw,
                height=ih,
                base_style=text_style,
                pick_font=_pick_font,
                coerce_rgba=_coerce_rgba,
            )
            handled = True
        else:
            tmp_geom = dict(geom)
            tmp_geom["x"] = 0
            tmp_geom["y"] = 0
            tmp_geom["rotation"] = 0
            tmp_style = dict(style)
            tmp_style["effects"] = []
            tmp_style["blend_mode"] = "normal"
            # Neutralize every overhauled-path trigger so the inner _draw_node
            # renders a plain glyph layer and cannot recurse back into the
            # overhauled path. Rotation/effects/gradient are applied here, after.
            tmp_style["shape_type"] = None
            tmp_style["image_duotone"] = None
            tmp_style["image_fade"] = None
            if gradient_native.is_gradient_fill(tmp_style.get("fill")):
                tmp_style["fill"] = None  # glyph alpha is all we need; recolored below
            tmp_node = {**node, "geometry": tmp_geom, "style": tmp_style}
            tmp_node.pop("text_runs", None)
            tmp_draw = ImageDraw.Draw(layer)
            _draw_node(layer, tmp_draw, tmp_node, db=db)
            handled = True

        # Gradient text fill: recolor the rasterized glyph alpha with the
        # gradient so titles/prices can carry a gradient (e.g. gold).
        if handled and gradient_native.is_gradient_fill(fill):
            grad = gradient_native.render_gradient_image(fill, (iw, ih)).convert("RGBA")
            grad.putalpha(layer.split()[-1])
            layer = grad

    if not handled:
        return False

    effects = style.get("effects") if isinstance(style.get("effects"), list) else []
    under_layers, work_layer, over_layers = effects_engine.render_effects(layer, effects)

    if node_opacity < 1.0:
        for idx in range(len(under_layers)):
            ul, dl = under_layers[idx]
            new_a = ul.split()[-1].point(lambda v: int(v * node_opacity))
            ul.putalpha(new_a)
            under_layers[idx] = (ul, dl)
        wa = work_layer.split()[-1].point(lambda v: int(v * node_opacity))
        work_layer.putalpha(wa)
        for idx in range(len(over_layers)):
            ol, dl = over_layers[idx]
            new_a = ol.split()[-1].point(lambda v: int(v * node_opacity))
            ol.putalpha(new_a)
            over_layers[idx] = (ol, dl)

    if abs(rotation) >= 0.01:
        def _rot(img: Image.Image) -> Image.Image:
            return img.rotate(-rotation, resample=Image.Resampling.BICUBIC, expand=True)

        rotated_under = [(_rot(u), d) for u, d in under_layers]
        work_rotated = _rot(work_layer)
        rotated_over = [(_rot(o), d) for o, d in over_layers]
        new_w, new_h = work_rotated.size
        dx = (new_w - iw) // 2
        dy = (new_h - ih) // 2
        under_layers = [(u, (d[0] - dx, d[1] - dy)) for u, d in rotated_under]
        over_layers = [(o, (d[0] - dx, d[1] - dy)) for o, d in rotated_over]
        anchor_x = int(round(x)) - dx
        anchor_y = int(round(y)) - dy
        work_layer = work_rotated
    else:
        anchor_x = int(round(x))
        anchor_y = int(round(y))

    for ul, delta in under_layers:
        base.alpha_composite(ul, (anchor_x + delta[0], anchor_y + delta[1]))
    _apply_blend(base, work_layer, blend_mode, (anchor_x, anchor_y))
    for ol, delta in over_layers:
        base.alpha_composite(ol, (anchor_x + delta[0], anchor_y + delta[1]))

    return True


def _draw_node(base: Image.Image, draw: ImageDraw.ImageDraw, node: dict[str, Any], *, db: Any | None = None) -> None:
    if _node_needs_overhauled_path(node):
        if _draw_node_overhauled(base, node, db=db):
            return

    style = node.get("style") if isinstance(node.get("style"), dict) else {}
    if not bool(style.get("visible", True)):
        return
    geom = node.get("geometry") if isinstance(node.get("geometry"), dict) else {}
    x = _safe_float(geom.get("x"), 0)
    y = _safe_float(geom.get("y"), 0)
    w = max(0.0, _safe_float(geom.get("width"), 0))
    h = max(0.0, _safe_float(geom.get("height"), 0))
    radius = max(0.0, _safe_float(geom.get("corner_radius"), 0))
    kind = str(node.get("kind") or "group").strip().lower()

    fill = style.get("fill")
    fill_rgba = _coerce_rgba(fill, default=(0, 0, 0, 0))
    stroke_layers = _resolve_stroke_layers(style)

    def _shape_mask(fill: int = 255) -> Image.Image:
        m = Image.new("L", base.size, 0)
        mdraw = ImageDraw.Draw(m)
        mdraw.rounded_rectangle((x, y, x + w, y + h), radius=max(0.0, radius), fill=int(fill))
        return m

    def _draw_rect_stroke(stroke: dict[str, Any]) -> None:
        stroke_color = stroke.get("color")
        stroke_rgba = _coerce_rgba(stroke_color, default=(0, 0, 0, 0))
        stroke_width_raw = _compute_stroke_width(stroke, _safe_float(stroke.get("width"), 0.0))
        stroke_opacity = _coerce_alpha_factor(stroke.get("opacity"), 1.0)
        stroke_rgba = _mul_alpha(stroke_rgba, stroke_opacity)
        stroke_width = max(0, int(round(stroke_width_raw)))
        stroke_align = str(stroke.get("align") or "center").strip().lower()
        if stroke_align not in {"inside", "outside", "center"}:
            stroke_align = "center"
        stroke_sides = stroke.get("sides") if isinstance(stroke.get("sides"), dict) else None
        if stroke_width <= 0 or stroke_rgba[3] <= 0:
            return
        if (x + w) <= x or (y + h) <= y:
            return
        lw = max(1, int(stroke_width))
        layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
        layer_draw = ImageDraw.Draw(layer)

        has_sides = isinstance(stroke_sides, dict)
        all_sides = has_sides and all(bool(stroke_sides.get(k, True)) for k in ("top", "right", "bottom", "left"))
        if has_sides and not all_sides:
            # Keep parity with canvas2dPainter.drawRectStrokeSides:
            # partial side-strokes are drawn as centered lines inset by half width.
            half = lw / 2.0
            top_y = y + half
            right_x = x + w - half
            bottom_y = y + h - half
            left_x = x + half
            if bool(stroke_sides.get("top", False)):
                layer_draw.line((left_x, top_y, right_x, top_y), fill=stroke_rgba, width=lw)
            if bool(stroke_sides.get("right", False)):
                layer_draw.line((right_x, top_y, right_x, bottom_y), fill=stroke_rgba, width=lw)
            if bool(stroke_sides.get("bottom", False)):
                layer_draw.line((right_x, bottom_y, left_x, bottom_y), fill=stroke_rgba, width=lw)
            if bool(stroke_sides.get("left", False)):
                layer_draw.line((left_x, bottom_y, left_x, top_y), fill=stroke_rgba, width=lw)
            base.alpha_composite(layer)
            return

        # Pillow draws outlines inside bounds. Expanding by half width recreates a centered stroke path.
        half = lw / 2.0
        layer_draw.rounded_rectangle(
            (x - half, y - half, x + w + half, y + h + half),
            radius=max(0.0, radius + half),
            outline=stroke_rgba,
            width=lw,
        )

        if stroke_align in {"inside", "outside"}:
            alpha = layer.split()[-1]
            mask_inside = _shape_mask(fill=255)
            if stroke_align == "inside":
                alpha = ImageChops.multiply(alpha, mask_inside)
            else:
                alpha = ImageChops.multiply(alpha, ImageChops.invert(mask_inside))
            layer.putalpha(alpha)
        base.alpha_composite(layer)

    if kind in {"rect", "frame", "group", "line"}:
        if kind == "line":
            stroke = stroke_layers[0] if stroke_layers else None
            stroke_color = stroke.get("color") if isinstance(stroke, dict) else None
            stroke_rgba = _coerce_rgba(stroke_color, default=(0, 0, 0, 0))
            stroke_width_raw = _compute_stroke_width(stroke, _safe_float(stroke.get("width"), 0.0)) if isinstance(stroke, dict) else 0.0
            stroke_opacity = _coerce_alpha_factor(stroke.get("opacity"), 1.0) if isinstance(stroke, dict) else 1.0
            stroke_rgba = _mul_alpha(stroke_rgba, stroke_opacity)
            stroke_width = max(1, int(round(stroke_width_raw))) if isinstance(stroke, dict) else 1
            x2 = x + w
            y2 = y + h
            draw.line((x, y, x2, y2), fill=fill_rgba if fill_rgba[3] > 0 else stroke_rgba, width=stroke_width)
        else:
            if fill_rgba[3] > 0:
                draw.rounded_rectangle((x, y, x + w, y + h), radius=radius, fill=fill_rgba)
            for stroke in stroke_layers:
                _draw_rect_stroke(stroke)

    if kind == "path":
        path = node.get("path_data") if isinstance(node.get("path_data"), dict) else {}
        raw_points = path.get("points") if isinstance(path.get("points"), list) else []
        points: list[tuple[float, float]] = []
        for raw in raw_points:
            if not isinstance(raw, dict):
                continue
            px = x + _safe_float(raw.get("x"), 0.0)
            py = y + _safe_float(raw.get("y"), 0.0)
            points.append((px, py))
        closed = bool(path.get("closed", False))
        if len(points) >= 2:
            if closed and fill_rgba[3] > 0:
                draw.polygon(points, fill=fill_rgba)
            for stroke in stroke_layers:
                stroke_color = stroke.get("color")
                stroke_rgba = _coerce_rgba(stroke_color, default=(0, 0, 0, 0))
                stroke_width_raw = _compute_stroke_width(stroke, _safe_float(stroke.get("width"), 0.0))
                stroke_opacity = _coerce_alpha_factor(stroke.get("opacity"), 1.0)
                stroke_rgba = _mul_alpha(stroke_rgba, stroke_opacity)
                stroke_width = max(0, int(round(stroke_width_raw)))
                if stroke_width <= 0 or stroke_rgba[3] <= 0:
                    continue
                line_points = points + [points[0]] if closed else points
                draw.line(line_points, fill=stroke_rgba, width=max(1, stroke_width))

    image_ref = node.get("image_src")
    if not _has_meaningful_value(image_ref):
        image_ref = node.get("image_asset_id")
    if kind in {"image", "frame", "rect", "group"} and _has_meaningful_value(image_ref):
        ref = image_ref
        raw = _extract_image_bytes(ref, db=db)
        if not raw:
            fallback_ref = node.get("image_asset_id")
            if _has_meaningful_value(fallback_ref) and str(fallback_ref).strip() != str(ref).strip():
                raw = _extract_image_bytes(fallback_ref, db=db)
        if raw:
            try:
                src = Image.open(io.BytesIO(raw)).convert("RGBA")
                # Keep backend deterministic and faithful to authored template styles.
                trim_alpha = style.get("image_trim")
                if trim_alpha is None:
                    trim_alpha = False
                if bool(trim_alpha):
                    alpha_bbox = src.split()[-1].getbbox()
                    if alpha_bbox:
                        try:
                            src = src.crop(alpha_bbox)
                        except Exception:
                            pass
                target_w = max(1, int(round(w)))
                target_h = max(1, int(round(h)))
                fit = str(style.get("image_fit") or "fill").strip().lower()
                image_scale = max(0.01, _safe_float(style.get("image_scale"), 1.0))
                align_x = str(style.get("image_align_x") or "center").strip().lower()
                align_y = str(style.get("image_align_y") or "center").strip().lower()
                crop = style.get("image_crop") if isinstance(style.get("image_crop"), dict) else None
                if fit == "crop" and crop:
                    sx = max(0, min(src.width - 1, _safe_int(crop.get("x"), 0)))
                    sy = max(0, min(src.height - 1, _safe_int(crop.get("y"), 0)))
                    sw = max(1, min(src.width - sx, _safe_int(crop.get("width"), src.width)))
                    sh = max(1, min(src.height - sy, _safe_int(crop.get("height"), src.height)))
                    cw = max(1, int(round(target_w * image_scale)))
                    ch = max(1, int(round(target_h * image_scale)))
                    resized = src.crop((sx, sy, sx + sw, sy + sh)).resize((cw, ch), Image.Resampling.LANCZOS)
                    layer = _compose_fitted_layer(
                        resized,
                        target_w=target_w,
                        target_h=target_h,
                        align_x=align_x,
                        align_y=align_y,
                    )
                elif fit == "fit":
                    ratio = min(target_w / src.width, target_h / src.height)
                    ratio *= image_scale
                    rw, rh = max(1, int(round(src.width * ratio))), max(1, int(round(src.height * ratio)))
                    resized = src.resize((rw, rh), Image.Resampling.LANCZOS)
                    layer = _compose_fitted_layer(
                        resized,
                        target_w=target_w,
                        target_h=target_h,
                        align_x=align_x,
                        align_y=align_y,
                    )
                else:
                    ratio = max(target_w / src.width, target_h / src.height)
                    ratio *= image_scale
                    rw, rh = max(1, int(round(src.width * ratio))), max(1, int(round(src.height * ratio)))
                    resized = src.resize((rw, rh), Image.Resampling.LANCZOS)
                    layer = _compose_fitted_layer(
                        resized,
                        target_w=target_w,
                        target_h=target_h,
                        align_x=align_x,
                        align_y=align_y,
                    )

                if radius > 0:
                    mask = Image.new("L", (target_w, target_h), 0)
                    mdraw = ImageDraw.Draw(mask)
                    mdraw.rounded_rectangle((0, 0, target_w, target_h), radius=int(round(radius)), fill=255)
                    # Preserve source transparency and only clip by rounded mask.
                    alpha = layer.split()[-1]
                    layer.putalpha(ImageChops.multiply(alpha, mask))

                base.alpha_composite(layer, (int(round(x)), int(round(y))))
                if kind in {"frame", "rect", "group"}:
                    for stroke in stroke_layers:
                        _draw_rect_stroke(stroke)
            except Exception:
                pass

    if kind == "text":
        text = str(node.get("text") or "")
        if not text.strip():
            return
        text_style = node.get("text_style") if isinstance(node.get("text_style"), dict) else {}
        font_family = str(text_style.get("family") or "").strip() or None
        font_style = str(text_style.get("style") or "").strip() or None
        font_postscript = str(text_style.get("postscript") or "").strip() or None
        size = _safe_float(text_style.get("size"), 18.0)
        lh = _safe_float(text_style.get("line_height"), 0.0) or None
        lh_unit = str(text_style.get("line_height_unit") or "percent")
        letter_spacing = _safe_float(text_style.get("letter_spacing"), 0.0)
        fit = node.get("fit") if isinstance(node.get("fit"), dict) else {}
        start_size = _safe_float(fit.get("start_size"), size)
        min_size = _safe_float(fit.get("min_size"), max(6.0, size * 0.65))
        max_lines = _safe_int(fit.get("max_lines"), 0) or None
        truncate_mode = str(fit.get("truncate_mode") or "none").strip().lower()
        font, chosen_size, line_h, lines = _fit_text_lines(
            draw,
            text,
            width=max(1, w),
            height=max(1, h),
            font_family=font_family,
            font_style=font_style,
            font_postscript=font_postscript,
            start_size=start_size,
            min_size=min_size,
            max_lines=max_lines,
            line_height=lh,
            line_height_unit=lh_unit,
            letter_spacing=letter_spacing,
        )
        if max_lines is not None and len(lines) > max_lines:
            if truncate_mode == "ellipsis":
                lines = lines[:max_lines]
                if lines:
                    lines[-1] = (lines[-1].rstrip() + "…")[: max(1, len(lines[-1]))]
            elif truncate_mode in {"cut", "none"}:
                lines = lines[:max_lines]

        text_align = str(text_style.get("text_align") or "left").strip().lower()
        v_align = str(text_style.get("vertical_align") or "top").strip().lower()
        underline = bool(text_style.get("underline", False))
        baseline_shift = _safe_float(text_style.get("baseline_shift"), 0.0)
        line_h_scale = max(0.1, _safe_float(text_style.get("line_height_scale"), 1.0))
        line_h = float(line_h) * float(line_h_scale)
        text_color = _coerce_rgba(text_style.get("color") or fill or "#000000", default=(0, 0, 0, 255))
        total_h = float(line_h) * max(1, len(lines))
        if v_align == "center":
            cur_y = y + max(0.0, (h - total_h) / 2.0)
        elif v_align == "bottom":
            cur_y = y + max(0.0, h - total_h)
        else:
            cur_y = y
        cur_y += baseline_shift

        text_path = node.get("text_path") if isinstance(node.get("text_path"), dict) else None
        if text_path:
            ptype = str(text_path.get("type") or "").strip().lower()
            if ptype == "arc":
                radius = _safe_float(text_path.get("radius"), max(1.0, min(w, h) / 2.0))
                start_angle = _safe_float(text_path.get("start_angle"), -90.0)
                sweep_angle = _safe_float(text_path.get("sweep_angle"), 180.0)
                clockwise = bool(text_path.get("clockwise", True))
                _draw_text_arc(
                    base,
                    text,
                    center_x=x + (w / 2.0),
                    center_y=y + (h / 2.0),
                    radius=radius,
                    start_angle=start_angle,
                    sweep_angle=sweep_angle,
                    clockwise=clockwise,
                    font=font,
                    fill=text_color,
                )
                return
            if ptype == "bezier":
                points = text_path.get("points") if isinstance(text_path.get("points"), list) else []
                _draw_text_bezier(
                    draw,
                    text,
                    base_x=x,
                    base_y=y,
                    points=[p for p in points if isinstance(p, dict)],
                    font=font,
                    fill=text_color,
                )
                return

        for idx, line in enumerate(lines):
            line_w = _measure_text_width(draw, line, font, letter_spacing)
            justify_line = (
                text_align == "justify"
                and idx < (len(lines) - 1)
                and len([part for part in line.split() if part]) > 1
            )

            if justify_line:
                tx = x
                line_w = float(max(0.0, w))
                _draw_text_justified_line(
                    draw,
                    line,
                    x=tx,
                    y=cur_y,
                    width=w,
                    font=font,
                    fill=text_color,
                    letter_spacing=letter_spacing,
                )
            else:
                if text_align == "center":
                    tx = x + max(0.0, (w - line_w) / 2.0)
                elif text_align == "right":
                    tx = x + max(0.0, w - line_w)
                else:
                    tx = x
                _draw_text_with_spacing(
                    draw,
                    line,
                    x=tx,
                    y=cur_y,
                    font=font,
                    fill=text_color,
                    letter_spacing=letter_spacing,
                )

            if underline and line_w > 0:
                underline_thickness = max(1, int(round(chosen_size * 0.06)))
                underline_y = cur_y + max(1.0, float(line_h) * 0.88)
                draw.line((tx, underline_y, tx + line_w, underline_y), fill=text_color, width=underline_thickness)
            cur_y += float(line_h)
        node["resolved_font_size"] = chosen_size


def render_native_template(
    doc: dict[str, Any],
    payload: dict[str, Any],
    *,
    db: Any | None = None,
    background_mode: str = "as-is",
) -> dict[str, tuple[bytes, dict[str, Any]]]:
    d = simulate_native_layout(doc, payload)
    canvas = d.get("canvas") if isinstance(d.get("canvas"), dict) else {}
    width = _safe_int(canvas.get("width"), 0)
    height = _safe_int(canvas.get("height"), 0)
    if width <= 0 or height <= 0 or width > 20000 or height > 20000:
        raise NativeRenderEngineError("Invalid canvas in the native template.")

    bg_mode = str(background_mode or "as-is").strip().lower()
    if bg_mode == "transparent":
        bg = (0, 0, 0, 0)
    elif bg_mode == "white":
        bg = (255, 255, 255, 255)
    else:
        bg = _coerce_rgba(canvas.get("background") or "#ffffff", default=(255, 255, 255, 255))

    base = Image.new("RGBA", (width, height), bg)
    draw = ImageDraw.Draw(base)

    nodes = [n for n in (d.get("nodes") or []) if isinstance(n, dict)]
    nodes.sort(key=lambda n: _safe_int((n.get("geometry") or {}).get("z_index"), 0))
    root_id = str(d.get("root_id") or "").strip()
    for node in nodes:
        if bg_mode in {"transparent", "white"} and str(node.get("id") or "").strip() == root_id:
            # Background modes override the root frame/page background.
            continue
        _draw_node(base, draw, node, db=db)

    png_buf = io.BytesIO()
    base.save(png_buf, format="PNG")
    png_bytes = png_buf.getvalue()

    jpg_img = Image.new("RGB", base.size, (255, 255, 255))
    jpg_img.paste(base, mask=base.split()[-1])
    jpg_buf = io.BytesIO()
    jpg_img.save(jpg_buf, format="JPEG", quality=92, optimize=True)
    jpg_bytes = jpg_buf.getvalue()

    png_meta = {
        "width": width,
        "height": height,
        "bytes": len(png_bytes),
        "sha256": hashlib.sha256(png_bytes).hexdigest(),
    }
    jpg_meta = {
        "width": width,
        "height": height,
        "bytes": len(jpg_bytes),
        "sha256": hashlib.sha256(jpg_bytes).hexdigest(),
    }
    return {"png": (png_bytes, png_meta), "jpg": (jpg_bytes, jpg_meta)}
