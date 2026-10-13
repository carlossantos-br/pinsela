from __future__ import annotations

import io
import json
import os
from pathlib import Path

import pytest
from PIL import Image, ImageChops

os.environ.setdefault("PINSELA_DATABASE_URL", "postgresql+psycopg://pinsela_test:pinsela_test@127.0.0.1:55432/pinsela_test")
os.environ.setdefault("PINSELA_SESSION_SECRET", "test-secret")
os.environ.setdefault("PINSELA_ADMIN_PASSWORD_HASH", "$2b$12$WFgjZ4B/lQ2f1PPSV.ZcC.ILUQkICwfzn2xH9vME0273wU4S718Ue")
os.environ.setdefault("FIGMA_MODE", "mock")

from pinsela.services.render_engine_native import render_native_template


_FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures" / "native_golden"
_GOLDEN_DIR = Path(__file__).resolve().parent / "golden" / "native"
_PIXEL_THRESHOLD = 4
# The goldens were generated on macOS; on Linux (CI) FreeType/Pillow rasterizes
# text antialiasing slightly differently (observed: 0.00397 on
# master1ofc). 0.006 absorbs this cross-platform difference and still catches
# real regressions (wrong layout/color/font change >1% of pixels).
_MAX_DIFF_RATIO = 0.006


def _update_mode() -> bool:
    raw = str(os.getenv("UPDATE_NATIVE_GOLDEN", "")).strip().lower()
    return raw in {"1", "true", "yes", "on"}


def _load_doc(name: str) -> dict:
    p = _FIXTURES_DIR / f"{name}.doc.json"
    return json.loads(p.read_text(encoding="utf-8"))


def _diff_ratio(actual: Image.Image, expected: Image.Image) -> float:
    if actual.size != expected.size:
        return 1.0
    diff = ImageChops.difference(actual.convert("RGBA"), expected.convert("RGBA")).convert("L")
    hist = diff.histogram()
    changed = sum(hist[_PIXEL_THRESHOLD + 1 :])
    total = max(1, diff.width * diff.height)
    return changed / total


@pytest.mark.parametrize(
    "case_name,payload",
    [
        ("folder", {"title1": "Folder Golden", "product_count": 2}),
        ("master1ofc", {"title1": "Master Golden", "body1": "Pixel diff baseline"}),
    ],
)
def test_native_renderer_golden_png(case_name: str, payload: dict) -> None:
    doc = _load_doc(case_name)
    png_bytes, _meta = render_native_template(doc, payload)["png"]
    actual = Image.open(io.BytesIO(png_bytes)).convert("RGBA")

    baseline = _GOLDEN_DIR / f"{case_name}.png"
    update = _update_mode()
    if update or not baseline.exists():
        baseline.parent.mkdir(parents=True, exist_ok=True)
        actual.save(baseline, format="PNG")
        if not update:
            pytest.fail(f"Golden baseline missing for {case_name}. Generated at {baseline}. Run again to validate.")
        return

    expected = Image.open(baseline).convert("RGBA")
    ratio = _diff_ratio(actual, expected)
    assert ratio <= _MAX_DIFF_RATIO, f"Golden diff above tolerance for {case_name}: ratio={ratio:.6f}"
