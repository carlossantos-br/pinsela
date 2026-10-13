from __future__ import annotations

import base64
import io

from PIL import Image, ImageDraw

import pinsela.services.background_removal as background_removal


def _png_bytes(image: Image.Image) -> bytes:
    out = io.BytesIO()
    image.save(out, format="PNG")
    return out.getvalue()


def test_derive_background_removed_name_suffix_only_once() -> None:
    assert background_removal.derive_background_removed_name("Product") == "Product (no background)"
    assert background_removal.derive_background_removed_name("Product (no background)") == "Product (no background)"


def test_merge_background_removed_tags_deduplicates_and_marks_output() -> None:
    merged = background_removal.merge_background_removed_tags(["Hero", "hero"], ("catalog",), ["bg-removed"])
    assert merged == ["Hero", "catalog", "bg-removed"]


def test_resolve_image_source_accepts_data_uri() -> None:
    image = Image.new("RGBA", (4, 4), (255, 0, 0, 255))
    payload = base64.b64encode(_png_bytes(image)).decode("ascii")
    resolved = background_removal.resolve_image_source(f"data:image/png;base64,{payload}", db=None)  # type: ignore[arg-type]
    assert resolved.source_kind == "data_uri"
    assert resolved.mime_type == "image/png"
    assert resolved.data.startswith(b"\x89PNG")


def test_remove_background_image_preserves_size_with_stubbed_rembg(monkeypatch) -> None:
    source = Image.new("RGBA", (24, 24), (255, 255, 255, 255))
    draw = ImageDraw.Draw(source)
    draw.ellipse((5, 4, 19, 20), fill=(220, 20, 60, 255))

    cutout = Image.new("RGBA", (24, 24), (0, 0, 0, 0))
    cutout_draw = ImageDraw.Draw(cutout)
    cutout_draw.ellipse((6, 5, 18, 19), fill=(220, 20, 60, 255))

    monkeypatch.setattr(
        background_removal,
        "_run_rembg_pipeline",
        lambda prepared_png, *, model_name, alpha_matting=False: _png_bytes(cutout),
    )

    result = background_removal.remove_background_image(
        background_removal.ResolvedImageSource(data=_png_bytes(source), source_kind="data_uri"),
        model_name="stub-model",
    )

    output = Image.open(io.BytesIO(result.png_bytes)).convert("RGBA")
    assert output.size == (24, 24)
    assert result.model_name == "stub-model"
    assert output.getchannel("A").getbbox() is not None
    assert output.getchannel("A").getpixel((0, 0)) == 0
