from __future__ import annotations

import base64
import shutil

import pytest

from pinsela.services.render_engine import apply_payload_to_svg, render_svg_to_png_jpg


_ONE_BY_ONE_PNG = base64.b64decode(
    # 1x1 transparent PNG
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+W8bYAAAAASUVORK5CYII="
)


def test_apply_payload_to_svg_sets_text_and_images_data_uri() -> None:
    svg = """
    <svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
      <text id="TITLE">old</text>
      <image id="HERO" x="0" y="0" width="10" height="10" href=""/>
      <image id="DEVICE_1" x="0" y="0" width="10" height="10" href=""/>
      <image id="DEVICE_2" x="0" y="0" width="10" height="10" href=""/>
    </svg>
    """.strip().encode("utf-8")

    manifest = {
        "version": 1,
        "text": {"title": {"id": "TITLE", "required": True, "max_length": 48}},
        "images": {
            "hero_image": {"id": "HERO", "required": False},
            "device_images": {"ids": ["DEVICE_1", "DEVICE_2"], "hide_empty": True},
        },
    }
    payload = {
        "title": "Hello",
        "hero_image": "data:image/png;base64," + base64.b64encode(_ONE_BY_ONE_PNG).decode("ascii"),
        "device_images": [
            "data:image/png;base64," + base64.b64encode(_ONE_BY_ONE_PNG).decode("ascii"),
        ],
    }

    out = apply_payload_to_svg(svg, payload, manifest)
    s = out.decode("utf-8")
    assert ">Hello<" in s
    assert "data:image/png;base64," in s
    # second device slot missing => hidden
    assert 'id="DEVICE_2"' in s and 'display="none"' in s


@pytest.mark.skipif(shutil.which("rsvg-convert") is None, reason="rsvg-convert not installed")
def test_render_svg_to_png_jpg_smoke() -> None:
    svg = """
    <svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
      <rect x="0" y="0" width="256" height="256" fill="#ffffff"/>
      <text x="10" y="40" font-size="20">ok</text>
    </svg>
    """.strip().encode("utf-8")

    out = render_svg_to_png_jpg(svg)
    assert "png" in out and "jpg" in out
    png, png_meta = out["png"]
    jpg, jpg_meta = out["jpg"]
    assert png_meta["width"] == 256 and png_meta["height"] == 256
    assert jpg_meta["width"] == 256 and jpg_meta["height"] == 256
    assert len(png) > 100 and len(jpg) > 100

