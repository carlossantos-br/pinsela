"""Security hardening: Host spoofing, DNS rebinding, cross-site CSRF,
path confinement, SSE auth and SSRF."""
from __future__ import annotations

import os
from pathlib import Path

import pytest

os.environ.setdefault("PINSELA_DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("PINSELA_SESSION_SECRET", "test-secret")
os.environ.setdefault("PINSELA_ADMIN_PASSWORD_HASH", "$2b$12$WFgjZ4B/lQ2f1PPSV.ZcC.ILUQkICwfzn2xH9vME0273wU4S718Ue")
os.environ.setdefault("PINSELA_AUTH_ALLOWED_EMAILS", "test@example.com")
os.environ.setdefault("FIGMA_MODE", "mock")

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from pinsela import config  # noqa: E402
from pinsela.api.routers import agent, agent_bg, agent_web, assets, auth, live_events  # noqa: E402
from pinsela.auth import COOKIE_NAME, set_session_cookie  # noqa: E402
from pinsela.security import (  # noqa: E402
    assert_public_http_url,
    is_cross_site_unsafe_request,
    resolve_under,
)

LOOPBACK = ("127.0.0.1", 50000)


@pytest.fixture()
def data_root(tmp_path: Path, monkeypatch):
    s = config.get_settings()
    monkeypatch.setattr(s, "server_data_root", str(tmp_path))
    monkeypatch.setattr(s, "agent_token", None)
    monkeypatch.setattr(s, "pinsela_env", "dev")
    return tmp_path


def _client(*routers, host: str = "localhost", client=LOOPBACK) -> TestClient:
    app = FastAPI()
    for r in routers:
        app.include_router(r.router)
    return TestClient(app, base_url=f"http://{host}", client=client)


# --- auth bypass: bootstrap / agent principal --------------------------------

@pytest.mark.parametrize("host", ["evil.example.com", "evil.example.com:8000", "0.0.0.0"])
def test_bootstrap_rejects_spoofed_or_rebound_host(data_root, host) -> None:
    # Loopback peer (DNS rebinding), attacker-controlled Host.
    c = _client(auth, host=host)
    assert c.post("/api/auth/local/bootstrap").status_code == 404


def test_bootstrap_rejects_remote_peer_even_with_localhost_host(data_root) -> None:
    c = _client(auth, host="localhost", client=("203.0.113.9", 4444))
    assert c.post("/api/auth/local/bootstrap").status_code == 404


def test_bootstrap_rejects_proxied_request(data_root) -> None:
    c = _client(auth)
    r = c.post("/api/auth/local/bootstrap", headers={"X-Forwarded-For": "198.51.100.7"})
    assert r.status_code == 404


def test_agent_principal_requires_local_host(data_root) -> None:
    ok = _client(agent).get("/api/agent/fonts")
    assert ok.status_code == 200
    rebound = _client(agent, host="evil.example.com").get("/api/agent/fonts")
    assert rebound.status_code == 401


def test_agent_token_mode_ignores_host(data_root, monkeypatch) -> None:
    monkeypatch.setattr(config.get_settings(), "agent_token", "tok-123")
    c = _client(agent, host="agent.example.com", client=("203.0.113.9", 1))
    assert c.get("/api/agent/fonts").status_code == 401
    assert c.get("/api/agent/fonts", headers={"X-Agent-Token": "tok-123"}).status_code == 200


# --- live events auth ---------------------------------------------------------

def test_presence_and_events_require_auth(data_root) -> None:
    c = _client(live_events, host="evil.example.com")
    assert c.get("/api/agent/events").status_code == 401
    assert c.post("/api/agent/presence", json={"key": "k", "state": "working"}).status_code == 401


def test_presence_allowed_for_local_agent(data_root) -> None:
    c = _client(live_events)
    r = c.post("/api/agent/presence", json={"key": "sec-k", "state": "idle"})
    assert r.status_code == 200


def test_presence_allowed_with_admin_session_from_non_agent_origin(data_root) -> None:
    # Editor browser: session cookie (+ CSRF), Host/peer that would not pass as the agent.
    from fastapi import Response
    resp = Response()
    set_session_cookie(resp, username="test@example.com")
    jar = {}
    for h in resp.headers.getlist("set-cookie"):
        k, v = h.split(";")[0].split("=", 1)
        jar[k] = v
    c = _client(live_events, host="editor.example.com", client=("203.0.113.9", 1))
    body = {"key": "sess-k", "state": "idle"}
    assert c.post("/api/agent/presence", json=body).status_code == 401
    c.cookies.set(COOKIE_NAME, jar[COOKIE_NAME])
    c.cookies.set("pinsela_csrf", jar["pinsela_csrf"])
    r = c.post("/api/agent/presence", json=body, headers={"x-csrf-token": jar["pinsela_csrf"]})
    assert r.status_code == 200, r.text


# --- arbitrary file read/write: agent bg --------------------------------------

def _png_bytes() -> bytes:
    import io
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (4, 4), (255, 0, 0)).save(buf, "PNG")
    return buf.getvalue()


def _fake_remover(monkeypatch):
    from types import SimpleNamespace
    png = _png_bytes()
    monkeypatch.setattr(agent_bg, "remove_background_detailed", lambda b, **k: SimpleNamespace(
        png_bytes=png, bbox=None, model_used="u2net", backend="fake", alpha_matting=False))


def test_bg_remove_file_rejects_input_outside_data_root(data_root, monkeypatch, tmp_path_factory) -> None:
    _fake_remover(monkeypatch)
    outside = tmp_path_factory.mktemp("outside") / "secret.png"
    outside.write_bytes(_png_bytes())
    r = _client(agent_bg).post("/api/agent/bg/remove-file", json={"image_path": str(outside)})
    assert r.status_code == 400
    assert r.json()["detail"] == "image_path_outside_data_root"


def test_bg_remove_file_rejects_output_outside_data_root(data_root, monkeypatch, tmp_path_factory) -> None:
    _fake_remover(monkeypatch)
    src = data_root / "in.png"
    src.write_bytes(_png_bytes())
    outside = tmp_path_factory.mktemp("outside2") / "pwn.png"
    c = _client(agent_bg)
    for bad in (str(outside), "../escape.png", str(data_root / "app.db"), str(data_root / "assets" / "x.png")):
        r = c.post("/api/agent/bg/remove-file", json={"image_path": str(src), "output_path": bad})
        assert r.status_code == 400, bad
    assert not outside.exists()


def test_bg_remove_file_rejects_symlink_escape(data_root, monkeypatch, tmp_path_factory) -> None:
    _fake_remover(monkeypatch)
    outside = tmp_path_factory.mktemp("outside3")
    (outside / "victim.png").write_bytes(_png_bytes())
    (data_root / "link.png").symlink_to(outside / "victim.png")
    c = _client(agent_bg)
    r = c.post("/api/agent/bg/remove-file", json={"image_path": str(data_root / "link.png")})
    assert r.status_code == 400
    out_root = data_root / "agent_bg"
    out_root.mkdir()
    (out_root / "trap.png").symlink_to(outside / "victim.png")
    (data_root / "ok.png").write_bytes(_png_bytes())
    r = c.post("/api/agent/bg/remove-file", json={"image_path": str(data_root / "ok.png"), "output_path": "trap.png"})
    assert r.status_code == 400


def test_bg_remove_file_happy_paths_stay_in_data_root(data_root, monkeypatch) -> None:
    _fake_remover(monkeypatch)
    src = data_root / "in.png"
    src.write_bytes(_png_bytes())
    c = _client(agent_bg)
    r = c.post("/api/agent/bg/remove-file", json={"image_path": str(src)})
    assert r.status_code == 200, r.text
    out = Path(r.json()["output_path"])
    assert out.is_file() and out.resolve().is_relative_to(data_root.resolve() / "agent_bg")
    assert Path(r.json()["sidecar_path"]).is_file()
    # multipart without output_path: nothing in /tmp
    r = c.post("/api/agent/bg/remove-file", files={"file": ("../../evil.png", _png_bytes(), "image/png")})
    assert r.status_code == 200, r.text
    assert Path(r.json()["output_path"]).resolve().parent == (data_root / "agent_bg").resolve()


# --- CSRF cross-site -----------------------------------------------------------

def _csrf_app(data_root, monkeypatch):
    from pinsela.main import create_app
    monkeypatch.setattr("pinsela.main.start_draft_pack_worker", lambda: None)
    app = create_app()
    return TestClient(app, base_url="http://localhost:8000", client=LOOPBACK)


def test_cross_site_simple_post_is_blocked(data_root, monkeypatch) -> None:
    c = _csrf_app(data_root, monkeypatch)
    # simple multipart/form from evil.com: never reaches the handler
    r = c.post("/api/agent/bg/remove-file", files={"file": ("a.png", b"x", "image/png")},
               headers={"Origin": "https://evil.example.com", "Sec-Fetch-Site": "cross-site"})
    assert r.status_code == 403 and r.json()["detail"] == "cross_site_request_blocked"
    r = c.post("/api/agent/presence", content="{}", headers={"Origin": "null", "Content-Type": "text/plain"})
    assert r.status_code == 403
    r = c.post("/api/agent/presence", content="{}", headers={"Sec-Fetch-Site": "cross-site"})
    assert r.status_code == 403


def test_same_origin_and_non_browser_posts_pass_csrf_guard(data_root, monkeypatch) -> None:
    c = _csrf_app(data_root, monkeypatch)
    ok = {"key": "csrf-k", "state": "idle"}
    assert c.post("/api/agent/presence", json=ok).status_code == 200  # curl: no Origin
    assert c.post("/api/agent/presence", json=ok, headers={"Origin": "http://localhost:8000"}).status_code == 200
    # vite on another local port (proxy with changeOrigin: Host 127.0.0.1)
    c2 = TestClient(c.app, base_url="http://127.0.0.1:8000", client=LOOPBACK)
    assert c2.post("/api/agent/presence", json=ok, headers={"Origin": "http://localhost:5173"}).status_code == 200


def test_csrf_guard_unit() -> None:
    from starlette.requests import Request

    def req(method, **h):
        hdrs = [(k.lower().replace("_", "-").encode(), v.encode()) for k, v in h.items()]
        return Request({"type": "http", "method": method, "headers": hdrs, "client": LOOPBACK,
                        "server": ("x", 80), "path": "/", "query_string": b""})

    assert not is_cross_site_unsafe_request(req("GET", origin="https://evil.com"), set())
    assert is_cross_site_unsafe_request(req("POST", origin="https://evil.com", host="localhost:8000"), set())
    assert not is_cross_site_unsafe_request(req("POST", origin="https://app.example", host="localhost:8000"), {"https://app.example"})


def test_cors_wildcard_is_not_used_with_credentials(monkeypatch) -> None:
    from pinsela.main import create_app
    monkeypatch.setattr(config.get_settings(), "cors_origins", "*")
    app = create_app()
    assert not any(m.cls.__name__ == "CORSMiddleware" for m in app.user_middleware)


# --- SSRF / path helpers ---------------------------------------------------------

@pytest.mark.parametrize("url", [
    "http://127.0.0.1:8000/api/auth/local/bootstrap",
    "http://localhost/x",
    "http://169.254.169.254/latest/meta-data/",
    "http://10.0.0.5/",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
    "file:///etc/passwd",
    "ftp://example.com/x",
    "http://user:pw@93.184.216.34/",
])
def test_assert_public_http_url_blocks(url) -> None:
    with pytest.raises(ValueError):
        assert_public_http_url(url)


def test_assert_public_http_url_allows_public_ip() -> None:
    assert_public_http_url("https://93.184.216.34/img.png")


def test_agent_web_download_blocks_internal_url_and_outside_save_to(data_root) -> None:
    c = _client(agent_web)
    r = c.post("/api/agent/web/download", json={"url": "http://169.254.169.254/latest/meta-data/"})
    assert r.status_code == 400 and r.json()["detail"].startswith("download_blocked")
    r = c.post("/api/agent/web/download", json={"url": "https://93.184.216.34/a.png", "save_to": "/tmp/pwn.png"})
    assert r.status_code == 400


def test_resolve_under_rejects_traversal_and_symlinks(tmp_path: Path) -> None:
    root = tmp_path / "root"
    root.mkdir()
    (tmp_path / "out.txt").write_text("x")
    (root / "l").symlink_to(tmp_path / "out.txt")
    with pytest.raises(ValueError):
        resolve_under(root, "../out.txt")
    with pytest.raises(ValueError):
        resolve_under(root, "l")
    assert resolve_under(root, "a/b.png") == root.resolve() / "a" / "b.png"


def test_render_native_local_path_ref_confined_to_data_root(data_root, tmp_path_factory) -> None:
    from pinsela.services.render_engine_native import _extract_image_bytes
    outside = tmp_path_factory.mktemp("o") / "x.png"
    outside.write_bytes(_png_bytes())
    inside = data_root / "assets" / "x.png"
    inside.parent.mkdir()
    inside.write_bytes(_png_bytes())
    assert _extract_image_bytes(str(outside)) is None
    assert _extract_image_bytes("http://127.0.0.1:1/x.png") is None
    assert _extract_image_bytes(str(inside)) is not None


def test_asset_upload_mime_comes_from_extension_not_client() -> None:
    import asyncio
    from io import BytesIO
    from types import SimpleNamespace
    from starlette.datastructures import Headers, UploadFile

    captured = {}
    monkey = assets._store_image_asset
    assets._store_image_asset = lambda db, **kw: captured.update(kw) or SimpleNamespace(
        id="00000000-0000-0000-0000-000000000000", kind="image", name=None, tags=[], mime_type=kw["mime_type"],
        ext=kw["ext"], bytes=1, width=1, height=1, sha256="0" * 64, created_at=None)
    try:
        up = UploadFile(file=BytesIO(_png_bytes()), filename="a.png", headers=Headers({"content-type": "text/html"}))
        asyncio.run(assets.upload_image(db=None, file=up, name=None, tags=None))
    finally:
        assets._store_image_asset = monkey
    assert captured["mime_type"] == "image/png"


def test_pinned_request_args_keep_host_and_sni() -> None:
    import ipaddress

    from pinsela.security import _pinned_request_args

    url, headers, ext = _pinned_request_args(
        "https://img.example.com:8443/a.png?x=1", ipaddress.ip_address("93.184.216.34")
    )
    assert url == "https://93.184.216.34:8443/a.png?x=1"
    assert headers == {"Host": "img.example.com:8443"}
    assert ext == {"sni_hostname": "img.example.com"}

    url6, _, ext6 = _pinned_request_args("http://h.example/a", ipaddress.ip_address("2606:4700::1"))
    assert url6 == "http://[2606:4700::1]/a"
    assert ext6 == {}


def test_fetch_public_url_connects_to_validated_ip(monkeypatch) -> None:
    """DNS rebinding: the 2nd lookup would return loopback; the connection must use the validated IP."""
    import socket

    import httpx

    from pinsela import security

    answers = iter(["93.184.216.34", "127.0.0.1"])

    def fake_getaddrinfo(host, port, *a, **k):
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (next(answers), port))]

    monkeypatch.setattr(security.socket, "getaddrinfo", fake_getaddrinfo)
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["host"] = request.url.host
        seen["header"] = request.headers["host"]
        return httpx.Response(200, content=b"ok", headers={"Content-Type": "image/png"})

    real_client = httpx.Client

    def client_factory(*a, **k):
        k["transport"] = httpx.MockTransport(handler)
        return real_client(*a, **k)

    monkeypatch.setattr(httpx, "Client", client_factory)
    data, ctype = security.fetch_public_url("http://rebind.example/a.png")
    assert data == b"ok" and ctype == "image/png"
    assert seen == {"host": "93.184.216.34", "header": "rebind.example"}


def test_token_resolver_caps_expansion() -> None:
    from pinsela.services.token_resolver import TokenBudgetExceeded, resolve_tokens

    big = {f"k{i}": i for i in range(1000)}
    doc = {"tokens": {"big": big}, "nodes": [{"style": "$tokens.big"} for _ in range(1000)]}
    with pytest.raises(TokenBudgetExceeded):
        resolve_tokens(doc)
    small = resolve_tokens({"tokens": {"c": {"p": "#fff"}}, "nodes": [{"fill": "$tokens.c.p"}]})
    assert small["nodes"][0]["fill"] == "#fff"


def test_component_expander_caps_fanout() -> None:
    from pinsela.services.component_expander import expand_components

    defs = []
    for lvl in range(6):
        if lvl == 5:
            nodes = [{"id": "leaf", "kind": "rect"}]
        else:
            nodes = [
                {"id": f"i{j}", "kind": "component_instance", "component_id": f"c{lvl + 1}"}
                for j in range(20)
            ]
        defs.append({"id": f"c{lvl}", "nodes": nodes})
    doc = {
        "metadata": {"components": {"definitions": defs}},
        "nodes": [{"id": "root", "kind": "component_instance", "component_id": "c0"}],
    }
    with pytest.raises(ValueError):
        expand_components(doc)


def test_diff_and_analyze_paths_confined(data_root, tmp_path_factory) -> None:
    from PIL import Image

    from pinsela.api.routers import agent_analyze, agent_diff

    outside = tmp_path_factory.mktemp("outside") / "outside.png"
    Image.new("RGB", (8, 8)).save(outside)
    client_local = _client(agent_diff, agent_analyze)
    r = client_local.post("/api/agent/diff/compare", json={"ref_path": str(outside), "cand_path": str(outside)})
    assert r.status_code == 400
    r = client_local.post("/api/agent/analyze/reference", json={"image_path": str(outside)})
    assert r.status_code == 422 and "outside" in r.text
    inside = data_root / "ref.png"
    Image.new("RGB", (8, 8)).save(inside)
    r = client_local.post("/api/agent/diff/compare", json={"ref_path": str(inside), "cand_path": "ref.png"})
    assert r.status_code == 200, r.text
    r = client_local.post("/api/agent/analyze/reference", json={"image_path": "ref.png"})
    assert r.status_code == 200, r.text
