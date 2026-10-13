"""Tests for the image fade-to-transparent mask (style.image_fade)."""
from __future__ import annotations

from PIL import Image

from pinsela.services import image_fade


def _alpha_at(mask: Image.Image, fx: float, fy: float) -> int:
    w, h = mask.size
    x = max(0, min(w - 1, int(round(fx * (w - 1)))))
    y = max(0, min(h - 1, int(round(fy * (h - 1)))))
    return mask.getpixel((x, y))


def test_has_fade_false_for_empty_or_disabled():
    assert not image_fade.has_fade(None)
    assert not image_fade.has_fade({})
    assert not image_fade.has_fade({"enabled": False, "edges": {"top": 0.5}})
    assert not image_fade.has_fade({"edges": {"top": 0, "left": 0}})


def test_linear_top_to_bottom_fades_bottom():
    # angle 90 = top->bottom; start 0 end 1 -> opaque at top, transparent at bottom
    spec = {"enabled": True, "linear": {"angle": 90, "start": 0.0, "end": 1.0}}
    m = image_fade.build_alpha_mask(spec, (40, 40))
    assert _alpha_at(m, 0.5, 0.0) >= 250  # top opaque
    assert _alpha_at(m, 0.5, 1.0) <= 5    # bottom transparent


def test_radial_sharp_center_transparent_edges():
    spec = {"enabled": True, "radial": {"cx": 0.5, "cy": 0.5, "inner": 0.1, "outer": 0.9}}
    m = image_fade.build_alpha_mask(spec, (60, 60))
    assert _alpha_at(m, 0.5, 0.5) >= 250  # center sharp
    assert _alpha_at(m, 0.0, 0.0) <= 5    # corner transparent


def test_edges_independent_top_and_right():
    spec = {"enabled": True, "edges": {"top": 0.4, "right": 0.4, "bottom": 0, "left": 0}}
    m = image_fade.build_alpha_mask(spec, (50, 50))
    assert _alpha_at(m, 0.5, 0.0) <= 5     # top edge faded
    assert _alpha_at(m, 1.0, 0.5) <= 5     # right edge faded
    assert _alpha_at(m, 0.0, 0.5) >= 250   # left edge intact
    assert _alpha_at(m, 0.5, 1.0) >= 250   # bottom edge intact


def test_apply_multiplies_existing_alpha():
    img = Image.new("RGBA", (30, 30), (255, 0, 0, 255))
    spec = {"enabled": True, "edges": {"left": 1.0}}
    out = image_fade.apply_image_fade(img, spec)
    assert out.split()[-1].getpixel((0, 15)) <= 5     # left fully faded
    assert out.split()[-1].getpixel((29, 15)) >= 250  # right intact


def test_disabled_returns_input_untouched():
    img = Image.new("RGBA", (10, 10), (0, 255, 0, 200))
    out = image_fade.apply_image_fade(img, {"enabled": False})
    assert out is img
