"""Mixed-style text rendering (text_runs[]) for the native renderer.

A `text_runs` entry has the shape::

    {
        "text": "...",
        "font_family": "Inter",
        "font_style": "Bold",
        "font_postscript": "Inter-Bold",
        "size": 32,
        "color": "#ff0000",
        "letter_spacing": 0,
        "underline": false,
        "weight": "Bold",  # alias for style
    }

This module implements a minimal layout engine that:
  - splits each run by newlines and intermediate spaces,
  - measures each token,
  - greedy-wraps into the available width,
  - paints each line honoring the base style's text_align/vertical_align.

We do NOT support per-run baseline shifts or vertical mixing beyond the
common case (a few bold/colored substrings within a paragraph).
"""

from __future__ import annotations

from typing import Any, Callable

from PIL import Image, ImageDraw, ImageFont


def _f(v: Any, default: float = 0.0) -> float:
    try:
        return float(v)
    except Exception:
        return default


def _measure_run_text(
    draw: ImageDraw.ImageDraw,
    text: str,
    font: ImageFont.ImageFont,
    letter_spacing: float,
) -> float:
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


def _draw_run_text(
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


def render_text_with_runs(
    base: Image.Image,
    runs: list[dict[str, Any]],
    *,
    x: float,
    y: float,
    width: float,
    height: float,
    base_style: dict[str, Any],
    pick_font: Callable[..., ImageFont.ImageFont],
    coerce_rgba: Callable[..., tuple[int, int, int, int]],
) -> None:
    """Paint mixed-style text onto `base` within (x, y, w, h).

    `pick_font` and `coerce_rgba` are injected to avoid circular imports
    with render_engine_native.
    """
    if not runs:
        return

    text_align = str(base_style.get("text_align") or "left").strip().lower()
    v_align = str(base_style.get("vertical_align") or "top").strip().lower()
    base_color = coerce_rgba(base_style.get("color") or "#000000", default=(0, 0, 0, 255))
    base_size = _f(base_style.get("size"), 18.0)
    base_lh = _f(base_style.get("line_height"), 0.0)
    base_lh_unit = str(base_style.get("line_height_unit") or "percent")
    base_ls = _f(base_style.get("letter_spacing"), 0.0)

    draw = ImageDraw.Draw(base)

    # Step 1: flatten runs into tokens. A token is a fragment of text
    # that does NOT contain whitespace (a "word"). Whitespace boundaries
    # let us wrap. Newlines force a wrap.
    tokens: list[dict[str, Any]] = []  # each: { text, run_idx, leading_newline }
    leading_newline = False
    for run_idx, run in enumerate(runs):
        if not isinstance(run, dict):
            continue
        text = str(run.get("text") or "")
        # split keeping spaces/newlines as their own tokens
        segs: list[str] = []
        buf = ""
        for ch in text:
            if ch == "\n":
                if buf:
                    segs.append(buf)
                    buf = ""
                segs.append("\n")
            elif ch == " ":
                if buf:
                    segs.append(buf)
                    buf = ""
                segs.append(" ")
            else:
                buf += ch
        if buf:
            segs.append(buf)

        for seg in segs:
            if seg == "\n":
                tokens.append({"text": "", "run_idx": run_idx, "leading_newline": True, "space": False})
            elif seg == " ":
                if tokens:
                    tokens[-1]["trailing_space"] = True
            else:
                tokens.append({"text": seg, "run_idx": run_idx, "leading_newline": leading_newline, "space": False, "trailing_space": False})
                leading_newline = False

    # Step 2: resolve a font/color/etc per run.
    fonts: list[ImageFont.ImageFont] = []
    colors: list[tuple[int, int, int, int]] = []
    sizes: list[float] = []
    spacings: list[float] = []
    underlines: list[bool] = []
    for run in runs:
        if not isinstance(run, dict):
            fonts.append(pick_font(family=None, style=None, postscript=None, size=base_size))
            colors.append(base_color)
            sizes.append(base_size)
            spacings.append(base_ls)
            underlines.append(False)
            continue
        family = run.get("font_family") or run.get("family") or base_style.get("family")
        style = run.get("font_style") or run.get("style") or run.get("weight") or base_style.get("style")
        postscript = run.get("font_postscript") or run.get("postscript") or base_style.get("postscript")
        size = _f(run.get("size"), base_size)
        color = coerce_rgba(run.get("color") or base_color, default=base_color)
        ls = _f(run.get("letter_spacing"), base_ls)
        underline = bool(run.get("underline", False))
        fonts.append(pick_font(family=family, style=style, postscript=postscript, size=size))
        colors.append(color)
        sizes.append(size)
        spacings.append(ls)
        underlines.append(underline)

    # Step 3: greedy-wrap tokens into lines.
    lines: list[list[dict[str, Any]]] = []
    current: list[dict[str, Any]] = []
    current_width = 0.0
    space_widths_cache: dict[int, float] = {}

    def _space_width(run_idx: int) -> float:
        if run_idx in space_widths_cache:
            return space_widths_cache[run_idx]
        sw = float(draw.textlength(" ", font=fonts[run_idx]))
        space_widths_cache[run_idx] = sw
        return sw

    for tok in tokens:
        run_idx = tok["run_idx"]
        font = fonts[run_idx]
        ls = spacings[run_idx]

        if tok.get("leading_newline"):
            lines.append(current)
            current = []
            current_width = 0.0
            if not tok["text"]:
                continue

        tw = _measure_run_text(draw, tok["text"], font, ls)
        if not current:
            current.append(tok)
            current_width = tw
            continue
        sep = _space_width(run_idx)
        proposed = current_width + sep + tw
        if proposed <= width:
            current.append(tok)
            current_width = proposed
        else:
            lines.append(current)
            current = [tok]
            current_width = tw
    if current:
        lines.append(current)

    if not lines:
        return

    # Step 4: compute line height per line (max of run line-heights in that line)
    def _lh_for(run_idx: int) -> float:
        size = sizes[run_idx]
        if base_lh > 0:
            if base_lh_unit == "percent":
                return max(1.0, size * (base_lh / 100.0))
            return max(1.0, base_lh)
        try:
            asc, desc = fonts[run_idx].getmetrics()
            return max(1.0, float(asc + desc))
        except Exception:
            return max(1.0, size * 1.2)

    line_heights: list[float] = []
    for line in lines:
        if not line:
            line_heights.append(_lh_for(0) if fonts else base_size)
            continue
        line_heights.append(max(_lh_for(t["run_idx"]) for t in line))
    total_h = sum(line_heights)

    if v_align == "center":
        cur_y = y + max(0.0, (height - total_h) / 2.0)
    elif v_align == "bottom":
        cur_y = y + max(0.0, height - total_h)
    else:
        cur_y = y

    # Step 5: paint each line with the configured horizontal align.
    for line, lh in zip(lines, line_heights):
        if not line:
            cur_y += lh
            continue
        # compute line width (sum of token widths + inter-token spaces)
        line_w = 0.0
        for i, tok in enumerate(line):
            tw = _measure_run_text(draw, tok["text"], fonts[tok["run_idx"]], spacings[tok["run_idx"]])
            line_w += tw
            if i < len(line) - 1:
                line_w += _space_width(tok["run_idx"])

        if text_align == "center":
            cur_x = x + max(0.0, (width - line_w) / 2.0)
        elif text_align == "right":
            cur_x = x + max(0.0, width - line_w)
        else:
            cur_x = x

        for i, tok in enumerate(line):
            ridx = tok["run_idx"]
            font = fonts[ridx]
            color = colors[ridx]
            ls = spacings[ridx]
            tw = _measure_run_text(draw, tok["text"], font, ls)
            # vertically align this run to the line's baseline
            run_lh = _lh_for(ridx)
            y_off = lh - run_lh  # taller runs share top; shorter ones drop to baseline
            _draw_run_text(
                draw,
                tok["text"],
                x=cur_x,
                y=cur_y + y_off,
                font=font,
                fill=color,
                letter_spacing=ls,
            )
            if underlines[ridx] and tw > 0:
                thick = max(1, int(round(sizes[ridx] * 0.06)))
                uy = cur_y + y_off + max(1.0, run_lh * 0.88)
                draw.line((cur_x, uy, cur_x + tw, uy), fill=color, width=thick)
            cur_x += tw
            if i < len(line) - 1:
                cur_x += _space_width(ridx)

        cur_y += lh
