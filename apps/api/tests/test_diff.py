from pinsela.diff import diff


def test_diff_nested():
    before = {"a": 1, "b": {"c": 2, "d": [1, 2]}, "e": "x"}
    after = {"a": 1, "b": {"c": 3, "d": [1, 2]}, "f": True}

    d = diff(before, after)
    changed_paths = {x["path"] for x in d["changed"]}
    added_paths = {x["path"] for x in d["added"]}
    removed_paths = {x["path"] for x in d["removed"]}

    assert "b.c" in changed_paths
    assert "e" in removed_paths
    assert "f" in added_paths

