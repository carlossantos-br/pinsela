"""Agent web-image search router.

Exposes `/api/agent/web/*` endpoints so the local agent loop can search
stock photo APIs (Pexels / Pixabay / Unsplash) and fall back to Lorem
Picsum when no API key is configured.

Isolated from main.py so it can be removed cleanly. Auth uses the
existing `require_agent_principal` dependency.

Keys are read from environment variables and NEVER returned in error
payloads.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from pinsela.config import get_settings
from pinsela.security import fetch_public_url, resolve_under

from .agent import require_agent_principal


router = APIRouter(
    prefix="/api/agent/web",
    tags=["agent-web"],
    dependencies=[Depends(require_agent_principal)],
)


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------


USER_AGENT = "pinsela-web-search/0.1 (+router)"
HTTP_TIMEOUT = 30.0
CACHE_TTL_SECONDS = 5 * 60
PROVIDER_ORDER = ("pexels", "pixabay", "unsplash", "lorem")


_KEY_ENVS = {
    "pexels": "PEXELS_API_KEY",
    "pixabay": "PIXABAY_API_KEY",
    "unsplash": "UNSPLASH_ACCESS_KEY",
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _redact(text: str) -> str:
    """Strip any known API key value from a string before returning it."""
    out = text
    for env in _KEY_ENVS.values():
        v = os.environ.get(env)
        if v and len(v) >= 6:
            out = out.replace(v, f"***{env}***")
    return out


def _sha8(s: str) -> str:
    return hashlib.sha1(s.encode("utf-8")).hexdigest()[:8]


def _ext_from_url(url: str, fallback: str = "jpg") -> str:
    m = re.search(r"\.([a-zA-Z0-9]{2,5})(?:\?|$)", url)
    if m:
        ext = m.group(1).lower()
        if ext in {"jpg", "jpeg", "png", "webp", "gif", "bmp", "tif", "tiff"}:
            return ext
    return fallback


def _external_assets_dir() -> Path:
    settings = get_settings()
    base = Path(settings.server_data_root) / "external_assets"
    base.mkdir(parents=True, exist_ok=True)
    return base


# ---------------------------------------------------------------------------
# Shared search cache (same file as CLI for parity)
# ---------------------------------------------------------------------------


CACHE_PATH = Path("/tmp/pinsela_web_search_cache.json")


def _load_cache() -> dict[str, Any]:
    if not CACHE_PATH.exists():
        return {"queries": {}, "results": {}}
    try:
        data = json.loads(CACHE_PATH.read_text("utf-8"))
        if not isinstance(data, dict):
            return {"queries": {}, "results": {}}
        data.setdefault("queries", {})
        data.setdefault("results", {})
        return data
    except (OSError, json.JSONDecodeError):
        return {"queries": {}, "results": {}}


def _save_cache(cache: dict[str, Any]) -> None:
    try:
        CACHE_PATH.write_text(json.dumps(cache, indent=2), encoding="utf-8")
    except OSError:
        pass


def _cache_key(query: str, source: str, per_page: int) -> str:
    raw = f"{source}|{query.lower().strip()}|{per_page}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]


# ---------------------------------------------------------------------------
# Provider implementations (mirror the CLI; kept inline so router stays
# self-contained and removable).
# ---------------------------------------------------------------------------


def _req_json(
    client: httpx.Client,
    url: str,
    *,
    params: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
) -> dict[str, Any]:
    try:
        r = client.get(url, params=params, headers=headers, timeout=HTTP_TIMEOUT)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"upstream_network_error: {_redact(str(exc))}")
    if r.status_code == 429:
        wait = float(r.headers.get("Retry-After") or "2")
        time.sleep(min(wait, 5.0))
        try:
            r = client.get(url, params=params, headers=headers, timeout=HTTP_TIMEOUT)
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=502, detail=f"upstream_network_error: {_redact(str(exc))}")
    if r.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"upstream_http_{r.status_code}")
    try:
        return r.json()
    except ValueError:
        raise HTTPException(status_code=502, detail="upstream_invalid_json")


def _search_pexels(client: httpx.Client, query: str, per_page: int) -> list[dict[str, Any]]:
    key = os.environ.get("PEXELS_API_KEY")
    if not key:
        raise HTTPException(status_code=400, detail="pexels_key_missing")
    data = _req_json(
        client,
        "https://api.pexels.com/v1/search",
        params={"query": query, "per_page": per_page},
        headers={"Authorization": key, "User-Agent": USER_AGENT},
    )
    out: list[dict[str, Any]] = []
    for p in data.get("photos", []) or []:
        src = p.get("src", {}) or {}
        nid = str(p.get("id"))
        out.append({
            "id": f"pexels:{nid}",
            "source": "pexels",
            "native_id": nid,
            "width": p.get("width"),
            "height": p.get("height"),
            "url_thumb": src.get("medium") or src.get("small"),
            "url_full": src.get("original") or src.get("large2x") or src.get("large"),
            "urls": {
                "original": src.get("original"),
                "large": src.get("large2x") or src.get("large"),
                "medium": src.get("medium"),
                "small": src.get("small") or src.get("tiny"),
            },
            "photographer": p.get("photographer"),
            "photographer_url": p.get("photographer_url"),
            "license": "Pexels License (royalty-free)",
            "page_url": p.get("url"),
        })
    return out


def _search_pixabay(client: httpx.Client, query: str, per_page: int) -> list[dict[str, Any]]:
    key = os.environ.get("PIXABAY_API_KEY")
    if not key:
        raise HTTPException(status_code=400, detail="pixabay_key_missing")
    pp = max(3, min(int(per_page), 200))
    data = _req_json(
        client,
        "https://pixabay.com/api/",
        params={
            "key": key,
            "q": query,
            "image_type": "photo",
            "per_page": pp,
            "safesearch": "true",
        },
        headers={"User-Agent": USER_AGENT},
    )
    out: list[dict[str, Any]] = []
    for h in data.get("hits", []) or []:
        nid = str(h.get("id"))
        out.append({
            "id": f"pixabay:{nid}",
            "source": "pixabay",
            "native_id": nid,
            "width": h.get("imageWidth"),
            "height": h.get("imageHeight"),
            "url_thumb": h.get("previewURL") or h.get("webformatURL"),
            "url_full": h.get("largeImageURL") or h.get("webformatURL"),
            "urls": {
                "original": h.get("largeImageURL") or h.get("webformatURL"),
                "large": h.get("largeImageURL"),
                "medium": h.get("webformatURL"),
                "small": h.get("previewURL"),
            },
            "photographer": h.get("user"),
            "photographer_url": None,
            "license": "Pixabay Content License (royalty-free)",
            "page_url": h.get("pageURL"),
        })
    return out


def _search_unsplash(client: httpx.Client, query: str, per_page: int) -> list[dict[str, Any]]:
    key = os.environ.get("UNSPLASH_ACCESS_KEY")
    if not key:
        raise HTTPException(status_code=400, detail="unsplash_key_missing")
    data = _req_json(
        client,
        "https://api.unsplash.com/search/photos",
        params={"query": query, "per_page": per_page},
        headers={"Authorization": f"Client-ID {key}", "User-Agent": USER_AGENT},
    )
    out: list[dict[str, Any]] = []
    for r in data.get("results", []) or []:
        nid = str(r.get("id"))
        urls = r.get("urls", {}) or {}
        user = r.get("user", {}) or {}
        out.append({
            "id": f"unsplash:{nid}",
            "source": "unsplash",
            "native_id": nid,
            "width": r.get("width"),
            "height": r.get("height"),
            "url_thumb": urls.get("small") or urls.get("thumb"),
            "url_full": urls.get("raw") or urls.get("full") or urls.get("regular"),
            "urls": {
                "original": urls.get("raw") or urls.get("full"),
                "large": urls.get("full") or urls.get("regular"),
                "medium": urls.get("regular") or urls.get("small"),
                "small": urls.get("small") or urls.get("thumb"),
            },
            "photographer": user.get("name") or user.get("username"),
            "photographer_url": (user.get("links") or {}).get("html"),
            "license": "Unsplash License",
            "page_url": (r.get("links") or {}).get("html"),
        })
    return out


def _search_lorem(query: str, per_page: int) -> list[dict[str, Any]]:
    w, h = 1200, 800
    base_seed = abs(hash(query)) % 100000
    out: list[dict[str, Any]] = []
    for i in range(per_page):
        seed = base_seed + i
        url_full = f"https://picsum.photos/{w}/{h}?random={seed}"
        url_thumb = f"https://picsum.photos/300/200?random={seed}"
        out.append({
            "id": f"lorem:{seed}-{w}x{h}",
            "source": "lorem",
            "native_id": f"{seed}",
            "width": w,
            "height": h,
            "url_thumb": url_thumb,
            "url_full": url_full,
            "urls": {
                "original": url_full,
                "large": url_full,
                "medium": f"https://picsum.photos/600/400?random={seed}",
                "small": url_thumb,
            },
            "photographer": "Lorem Picsum",
            "photographer_url": "https://picsum.photos",
            "license": "Lorem Picsum (placeholder)",
            "page_url": "https://picsum.photos",
        })
    return out


def _do_search(
    query: str,
    source: str,
    per_page: int,
) -> tuple[str, list[dict[str, Any]]]:
    cache = _load_cache()

    def _cache_get(src: str) -> list[dict[str, Any]] | None:
        ck = _cache_key(query, src, per_page)
        entry = cache["queries"].get(ck)
        if not entry:
            return None
        if time.time() - float(entry.get("ts", 0)) > CACHE_TTL_SECONDS:
            return None
        ids: list[str] = entry.get("ids", [])
        results = [cache["results"].get(i) for i in ids]
        results = [r for r in results if isinstance(r, dict)]
        return results or None

    def _cache_put(src: str, results: list[dict[str, Any]]) -> None:
        ck = _cache_key(query, src, per_page)
        ids = []
        for r in results:
            cache["results"][r["id"]] = r
            ids.append(r["id"])
        cache["queries"][ck] = {"ts": time.time(), "ids": ids, "source": src, "query": query}

    def _run(src: str, client: httpx.Client) -> list[dict[str, Any]]:
        cached = _cache_get(src)
        if cached is not None:
            return cached
        if src == "pexels":
            r = _search_pexels(client, query, per_page)
        elif src == "pixabay":
            r = _search_pixabay(client, query, per_page)
        elif src == "unsplash":
            r = _search_unsplash(client, query, per_page)
        elif src == "lorem":
            r = _search_lorem(query, per_page)
        else:
            raise HTTPException(status_code=400, detail=f"unknown_source: {src}")
        _cache_put(src, r)
        return r

    source = (source or "auto").lower()

    with httpx.Client(timeout=HTTP_TIMEOUT, headers={"User-Agent": USER_AGENT}) as client:
        if source == "auto":
            last_error: HTTPException | None = None
            for src in PROVIDER_ORDER:
                try:
                    res = _run(src, client)
                    if res:
                        _save_cache(cache)
                        return src, res
                except HTTPException as exc:
                    last_error = exc
                    continue
            _save_cache(cache)
            # if we got here, no provider returned results — surface friendlier
            if last_error and last_error.status_code != 400:
                raise last_error
            return "none", []

        results = _run(source, client)
        _save_cache(cache)
        return source, results


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------


class SearchResultModel(BaseModel):
    id: str
    source: str
    width: int | None = None
    height: int | None = None
    url_thumb: str | None = None
    url_full: str | None = None
    photographer: str | None = None
    license: str | None = None
    page_url: str | None = None


class SearchResponse(BaseModel):
    ok: bool
    source: str
    count: int
    results: list[dict[str, Any]]


class DownloadRequest(BaseModel):
    url: str = Field(..., description="Full image URL to download.")
    save_to: str | None = Field(
        default=None,
        description="Optional absolute path. Defaults to external_assets/<sha8>.<ext>.",
    )


class DownloadResponse(BaseModel):
    ok: bool
    local_path: str
    mime: str
    bytes: int


class QuickRequest(BaseModel):
    query: str
    save_to: str | None = None
    source: str | None = "auto"
    per_page: int = 5


class QuickResponse(BaseModel):
    ok: bool
    source: str
    local_path: str
    mime: str
    bytes: int
    result_id: str | None = None


class ProvidersResponse(BaseModel):
    ok: bool
    providers: list[dict[str, Any]]
    fallback_chain: list[str]


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


_SourceLiteral = Literal["pexels", "pixabay", "unsplash", "lorem", "auto"]


def _validate_save_path(save_to: str | None, url: str) -> Path:
    root = _external_assets_dir().resolve()
    if save_to:
        # Only inside <data root>/external_assets (resolve() defeats escaping symlinks).
        try:
            p = resolve_under(root, save_to)
        except ValueError:
            raise HTTPException(status_code=400, detail="save_to_outside_allowed_roots (use external_assets/)")
        if p == root or p.suffix.lower() not in _IMAGE_EXTS:
            raise HTTPException(status_code=400, detail="save_to_must_be_an_image_file")
        p.parent.mkdir(parents=True, exist_ok=True)
        return p
    ext = _ext_from_url(url, fallback="jpg")
    return root / f"{_sha8(url)}.{ext}"


_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tif", ".tiff"}
MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024


def _download_to(url: str, out_path: Path) -> tuple[int, str]:
    """Downloads `url` (public hosts only; redirects revalidated hop by hop)."""
    try:
        data, mime = fetch_public_url(
            url,
            timeout=HTTP_TIMEOUT,
            max_bytes=MAX_DOWNLOAD_BYTES,
            headers={"User-Agent": USER_AGENT},
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"download_blocked:{exc}")
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=502, detail=f"download_http_{exc.response.status_code}")
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"download_network_error: {_redact(str(exc))}")
    out_path.write_bytes(data)
    return len(data), mime


def _write_sidecar(
    out_path: Path,
    *,
    source: str,
    query: str | None,
    original_url: str,
    photographer: str | None,
    license_str: str | None,
    extra: dict[str, Any] | None = None,
) -> None:
    sidecar = out_path.with_suffix(out_path.suffix + ".json")
    payload: dict[str, Any] = {
        "source": source,
        "query": query,
        "original_url": original_url,
        "photographer": photographer,
        "license": license_str,
        "downloaded_at": _now_iso(),
    }
    if extra:
        payload.update(extra)
    try:
        sidecar.write_text(
            json.dumps(payload, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
    except OSError:
        pass


@router.get("/providers", response_model=ProvidersResponse)
def providers() -> ProvidersResponse:
    items = []
    for name in PROVIDER_ORDER:
        env = _KEY_ENVS.get(name)
        items.append({
            "name": name,
            "env": env,
            "set": bool(os.environ.get(env)) if env else True,
            "rate_per_hour": {
                "pexels": 200,
                "pixabay": 5000,
                "unsplash": 50,
                "lorem": None,
            }[name],
            "info": {
                "pexels": "https://www.pexels.com/api/",
                "pixabay": "https://pixabay.com/api/docs/",
                "unsplash": "https://unsplash.com/developers",
                "lorem": "https://picsum.photos",
            }[name],
        })
    return ProvidersResponse(ok=True, providers=items, fallback_chain=list(PROVIDER_ORDER))


@router.get("/search", response_model=SearchResponse)
def search(
    query: str,
    source: _SourceLiteral = "auto",
    per_page: int = 10,
) -> SearchResponse:
    if not query.strip():
        raise HTTPException(status_code=400, detail="empty_query")
    per_page = max(1, min(int(per_page), 50))
    try:
        src, results = _do_search(query, source, per_page)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=_redact(f"search_failed: {exc}"))
    return SearchResponse(ok=True, source=src, count=len(results), results=results)


@router.post("/download", response_model=DownloadResponse)
def download(req: DownloadRequest) -> DownloadResponse:
    if not req.url or not req.url.lower().startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="invalid_url")
    out_path = _validate_save_path(req.save_to, req.url)
    n, mime = _download_to(req.url, out_path)
    # Try to resolve source from cache so the sidecar carries attribution.
    cache = _load_cache()
    matched: dict[str, Any] | None = None
    for r in cache.get("results", {}).values():
        if isinstance(r, dict) and req.url in (
            r.get("url_full"),
            r.get("url_thumb"),
            *(r.get("urls") or {}).values(),
        ):
            matched = r
            break
    _write_sidecar(
        out_path,
        source=(matched or {}).get("source", "unknown"),
        query=(matched or {}).get("query"),
        original_url=req.url,
        photographer=(matched or {}).get("photographer"),
        license_str=(matched or {}).get("license"),
        extra={
            "mime": mime,
            "bytes": n,
            "result_id": (matched or {}).get("id"),
        },
    )
    return DownloadResponse(ok=True, local_path=str(out_path), mime=mime, bytes=n)


@router.post("/quick", response_model=QuickResponse)
def quick(req: QuickRequest) -> QuickResponse:
    if not req.query.strip():
        raise HTTPException(status_code=400, detail="empty_query")
    per_page = max(1, min(int(req.per_page), 20))
    src, results = _do_search(req.query, req.source or "auto", per_page)
    if not results:
        raise HTTPException(status_code=404, detail="no_results")
    pick = results[0]
    url = pick.get("url_full") or pick.get("url_thumb")
    if not url:
        raise HTTPException(status_code=502, detail="result_missing_url")
    out_path = _validate_save_path(req.save_to, url)
    n, mime = _download_to(url, out_path)
    _write_sidecar(
        out_path,
        source=pick.get("source", src),
        query=req.query,
        original_url=url,
        photographer=pick.get("photographer"),
        license_str=pick.get("license"),
        extra={
            "result_id": pick.get("id"),
            "page_url": pick.get("page_url"),
            "width": pick.get("width"),
            "height": pick.get("height"),
            "mime": mime,
            "bytes": n,
        },
    )
    return QuickResponse(
        ok=True,
        source=pick.get("source", src),
        local_path=str(out_path),
        mime=mime,
        bytes=n,
        result_id=pick.get("id"),
    )
