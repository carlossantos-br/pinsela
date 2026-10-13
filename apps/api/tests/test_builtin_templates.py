import json
from pathlib import Path

from pinsela.services.template_native import validate_native_doc

BUILTIN = Path(__file__).resolve().parents[3] / "ui" / "src" / "pinsela" / "templates" / "builtin"
FONTS = {"Inter", "Playfair Display"}


def test_builtin_templates_are_valid_and_self_contained():
    files = sorted(BUILTIN.glob("*.json"))
    assert len(files) == 6
    for f in files:
        data = json.loads(f.read_text(encoding="utf-8"))
        doc = validate_native_doc(dict(data["doc_json"]))
        pages = doc["metadata"]["project_pages_v1"]["pages"]
        assert pages
        for page in pages:
            validate_native_doc(dict(page["doc"]))
            for node in page["doc"]["nodes"]:
                assert not node.get("image_src"), f"{f.name}: no external images"
                if node.get("kind") == "text":
                    assert node["text_style"]["family"] in FONTS
