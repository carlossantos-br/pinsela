from types import SimpleNamespace

from pinsela.api.routers.templates import _canvas_size_of


def test_canvas_size_of_reads_doc_canvas():
    row = SimpleNamespace(engine_doc_json={"canvas": {"width": 1080.0, "height": 1920}})
    assert _canvas_size_of(row) == (1080, 1920)


def test_canvas_size_of_handles_missing_or_invalid():
    assert _canvas_size_of(SimpleNamespace(engine_doc_json=None)) == (None, None)
    assert _canvas_size_of(SimpleNamespace(engine_doc_json={"canvas": {"width": "x"}})) == (None, None)
    assert _canvas_size_of(SimpleNamespace(engine_doc_json={"canvas": {"width": 0, "height": 10}})) == (None, None)


def test_canvas_size_of_rejects_non_finite_and_out_of_range():
    for bad in ("inf", "nan", 1e309, float("inf"), -5, 0, 99999):
        row = SimpleNamespace(engine_doc_json={"canvas": {"width": bad, "height": 100}})
        assert _canvas_size_of(row) == (None, None), bad
