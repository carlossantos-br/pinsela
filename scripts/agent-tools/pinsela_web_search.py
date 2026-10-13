#!/usr/bin/env python3
"""pinsela_web_search.py — search and fetch images from stock photo APIs.

Multi-source fallback chain: Pexels -> Pixabay -> Unsplash -> Lorem Picsum.

Sub-commands:
  search <query>          Search across one or all providers; prints a table.
  download <result_id>    Download a result from the most recent search cache.
  quick <query>           Search + download first result in one shot.
  keys                    Report which API keys are detected in env.

Designed to be safe with zero API keys: Lorem Picsum is always available
as a placeholder fallback for testing.

API keys (env):
  PEXELS_API_KEY        get at https://www.pexels.com/api/    (200 req/h)
  PIXABAY_API_KEY       get at https://pixabay.com/api/docs/  (5000 req/h)
  UNSPLASH_ACCESS_KEY   get at https://unsplash.com/developers (50 req/h)
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

try:
    import httpx  # type: ignore
except Exception as exc:  # pragma: no cover
    sys.stderr.write(
        "httpx is required. Install with: pip install httpx\n"
        f"(import error: {exc})\n"
    )
    raise SystemExit(2)


DEFAULT_DATA_DIR = (
    Path(os.environ.get("PINSELA_SERVER_DATA_ROOT") or Path(__file__).resolve().parents[2] / "apps" / "api" / "data")
    / "external_assets"
)
CACHE_PATH = Path("/tmp/pinsela_web_search_cache.json")
CACHE_TTL_SECONDS = 5 * 60  # 5 min as documented
USER_AGENT = "pinsela-web-search/0.1 (+local)"
HTTP_TIMEOUT = 30.0


# ---------------------------------------------------------------------------
# Utilities
# ---------------------------------------------------------------------------


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _redact(text: str) -> str:
    """Best-effort redaction for known API keys in error messages / logs."""
    redacted = text
    for var in ("PEXELS_API_KEY", "PIXABAY_API_KEY", "UNSPLASH_ACCESS_KEY"):
        v = os.environ.get(var)
        if v and len(v) >= 6:
            redacted = redacted.replace(v, f"***{var}***")
    return redacted


def _sha8(s: str) -> str:
    return hashlib.sha1(s.encode("utf-8")).hexdigest()[:8]


def _safe_ext_from_url(url: str, fallback: str = "jpg") -> str:
    m = re.search(r"\.([a-zA-Z0-9]{2,5})(?:\?|$)", url)
    if m:
        ext = m.group(1).lower()
        if ext in {"jpg", "jpeg", "png", "webp", "gif", "bmp", "tif", "tiff"}:
            return ext
    return fallback


def _human_dims(w: int | None, h: int | None) -> str:
    if not w or not h:
        return "?"
    return f"{w}x{h}"


def _aspect(w: int | None, h: int | None) -> str:
    if not w or not h:
        return "?"
    if w == h:
        return "square"
    return "landscape" if w > h else "portrait"


def _err(msg: str, code: int = 1) -> None:
    sys.stderr.write(_redact(msg) + "\n")
    raise SystemExit(code)


def _request_json(
    client: httpx.Client,
    url: str,
    *,
    params: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
    retries: int = 1,
) -> dict[str, Any]:
    for attempt in range(retries + 1):
        try:
            r = client.get(url, params=params, headers=headers, timeout=HTTP_TIMEOUT)
        except httpx.HTTPError as exc:
            if attempt >= retries:
                raise RuntimeError(f"network error: {exc}") from exc
            time.sleep(1.0)
            continue
        if r.status_code == 429:
            # respect rate limits: sleep and retry once
            wait = float(r.headers.get("Retry-After") or "2")
            time.sleep(min(wait, 10.0))
            if attempt >= retries:
                raise RuntimeError("rate_limited (429) after retry")
            continue
        if r.status_code >= 400:
            # Do NOT include response body verbatim (may echo key); status only.
            raise RuntimeError(f"http {r.status_code} from {url.split('?')[0]}")
        try:
            return r.json()
        except ValueError as exc:
            raise RuntimeError(f"invalid json from {url.split('?')[0]}: {exc}") from exc
    raise RuntimeError("unreachable")


# ---------------------------------------------------------------------------
# Cache
# ---------------------------------------------------------------------------


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


def _cache_key(query: str, source: str, per_page: int, orientation: str | None, color: str | None) -> str:
    raw = f"{source}|{query.lower().strip()}|{per_page}|{orientation or ''}|{color or ''}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]


# ---------------------------------------------------------------------------
# Normalised result schema
# ---------------------------------------------------------------------------
#
# Result dict:
#   {
#     "id": str (synthetic, "<source>:<native_id>"),
#     "source": str,
#     "native_id": str,
#     "width": int|None,
#     "height": int|None,
#     "url_thumb": str,
#     "url_full": str,
#     "urls": {"original": ..., "large": ..., "medium": ..., "small": ...},
#     "photographer": str|None,
#     "photographer_url": str|None,
#     "license": str,
#     "page_url": str|None,
#   }


def _provider_status() -> dict[str, dict[str, Any]]:
    return {
        "pexels": {
            "env": "PEXELS_API_KEY",
            "set": bool(os.environ.get("PEXELS_API_KEY")),
            "info": "https://www.pexels.com/api/",
            "rate_per_hour": 200,
        },
        "pixabay": {
            "env": "PIXABAY_API_KEY",
            "set": bool(os.environ.get("PIXABAY_API_KEY")),
            "info": "https://pixabay.com/api/docs/",
            "rate_per_hour": 5000,
        },
        "unsplash": {
            "env": "UNSPLASH_ACCESS_KEY",
            "set": bool(os.environ.get("UNSPLASH_ACCESS_KEY")),
            "info": "https://unsplash.com/developers",
            "rate_per_hour": 50,
        },
        "lorem": {
            "env": None,
            "set": True,
            "info": "https://picsum.photos",
            "rate_per_hour": None,
        },
    }


# ---------------------------------------------------------------------------
# Provider implementations
# ---------------------------------------------------------------------------


def _search_pexels(
    client: httpx.Client,
    query: str,
    per_page: int,
    orientation: str | None,
    color: str | None,
) -> list[dict[str, Any]]:
    key = os.environ.get("PEXELS_API_KEY")
    if not key:
        raise RuntimeError(
            "pexels: PEXELS_API_KEY not set. Get a free key at https://www.pexels.com/api/"
        )
    params: dict[str, Any] = {"query": query, "per_page": per_page}
    if orientation in {"portrait", "landscape", "square"}:
        params["orientation"] = orientation
    if color:
        params["color"] = color
    data = _request_json(
        client,
        "https://api.pexels.com/v1/search",
        params=params,
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
            "url_thumb": src.get("medium") or src.get("small") or src.get("tiny") or p.get("url"),
            "url_full": src.get("original") or src.get("large2x") or src.get("large"),
            "urls": {
                "original": src.get("original"),
                "large": src.get("large2x") or src.get("large"),
                "medium": src.get("medium"),
                "small": src.get("small") or src.get("tiny"),
            },
            "photographer": p.get("photographer"),
            "photographer_url": p.get("photographer_url"),
            "license": "Pexels License (royalty-free, attribution appreciated)",
            "page_url": p.get("url"),
        })
    return out


def _search_pixabay(
    client: httpx.Client,
    query: str,
    per_page: int,
    orientation: str | None,
    color: str | None,
) -> list[dict[str, Any]]:
    key = os.environ.get("PIXABAY_API_KEY")
    if not key:
        raise RuntimeError(
            "pixabay: PIXABAY_API_KEY not set. Get a free key at https://pixabay.com/api/docs/"
        )
    # pixabay requires per_page >= 3
    pp = max(3, min(int(per_page), 200))
    params: dict[str, Any] = {
        "key": key,
        "q": query,
        "image_type": "photo",
        "per_page": pp,
        "safesearch": "true",
    }
    if orientation == "portrait":
        params["orientation"] = "vertical"
    elif orientation == "landscape":
        params["orientation"] = "horizontal"
    if color:
        params["colors"] = color
    data = _request_json(
        client,
        "https://pixabay.com/api/",
        params=params,
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
            "photographer_url": f"https://pixabay.com/users/{h.get('user')}-{h.get('user_id')}/"
            if h.get("user") and h.get("user_id")
            else None,
            "license": "Pixabay Content License (royalty-free, no attribution required)",
            "page_url": h.get("pageURL"),
        })
    return out


def _search_unsplash(
    client: httpx.Client,
    query: str,
    per_page: int,
    orientation: str | None,
    color: str | None,
) -> list[dict[str, Any]]:
    key = os.environ.get("UNSPLASH_ACCESS_KEY")
    if not key:
        raise RuntimeError(
            "unsplash: UNSPLASH_ACCESS_KEY not set. Get a free key at https://unsplash.com/developers"
        )
    params: dict[str, Any] = {"query": query, "per_page": per_page}
    if orientation in {"portrait", "landscape", "squarish"}:
        params["orientation"] = orientation if orientation != "square" else "squarish"
    elif orientation == "square":
        params["orientation"] = "squarish"
    if color:
        params["color"] = color
    data = _request_json(
        client,
        "https://api.unsplash.com/search/photos",
        params=params,
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
            "license": "Unsplash License (free, attribution appreciated)",
            "page_url": (r.get("links") or {}).get("html"),
        })
    return out


def _search_lorem(
    query: str,
    per_page: int,
    orientation: str | None,
) -> list[dict[str, Any]]:
    # Lorem Picsum is random; we synthesize per_page random images
    # using ?random=N. Dimensions depend on orientation.
    if orientation == "portrait":
        w, h = 800, 1200
    elif orientation == "square":
        w, h = 1000, 1000
    else:
        # landscape default
        w, h = 1200, 800
    out: list[dict[str, Any]] = []
    base_seed = abs(hash(query)) % 100000
    for i in range(per_page):
        seed = base_seed + i
        nid = f"{seed}-{w}x{h}"
        # use ?random= so each is distinct; thumb uses smaller dims
        url_full = f"https://picsum.photos/{w}/{h}?random={seed}"
        url_thumb = f"https://picsum.photos/300/200?random={seed}"
        out.append({
            "id": f"lorem:{nid}",
            "source": "lorem",
            "native_id": nid,
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
            "license": "Lorem Picsum (placeholder; not for commercial use)",
            "page_url": "https://picsum.photos",
        })
    return out


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------


PROVIDER_ORDER = ("pexels", "pixabay", "unsplash", "lorem")


def _do_search(
    query: str,
    source: str,
    per_page: int,
    orientation: str | None,
    color: str | None,
    *,
    use_cache: bool = True,
) -> tuple[str, list[dict[str, Any]], list[str]]:
    """Return (effective_source, results, notes)."""
    notes: list[str] = []
    cache = _load_cache() if use_cache else {"queries": {}, "results": {}}

    def _cache_get(src: str) -> list[dict[str, Any]] | None:
        ck = _cache_key(query, src, per_page, orientation, color)
        entry = cache["queries"].get(ck)
        if not entry:
            return None
        if time.time() - float(entry.get("ts", 0)) > CACHE_TTL_SECONDS:
            return None
        ids: list[str] = entry.get("ids", [])
        results = [cache["results"].get(i) for i in ids]
        results = [r for r in results if isinstance(r, dict)]
        if not results:
            return None
        return results

    def _cache_put(src: str, results: list[dict[str, Any]]) -> None:
        ck = _cache_key(query, src, per_page, orientation, color)
        ids = []
        for r in results:
            cache["results"][r["id"]] = r
            ids.append(r["id"])
        cache["queries"][ck] = {"ts": time.time(), "ids": ids, "source": src, "query": query}

    def _run_one(src: str, client: httpx.Client) -> list[dict[str, Any]]:
        cached = _cache_get(src) if use_cache else None
        if cached is not None:
            notes.append(f"{src}: cache hit")
            return cached
        if src == "pexels":
            results = _search_pexels(client, query, per_page, orientation, color)
        elif src == "pixabay":
            results = _search_pixabay(client, query, per_page, orientation, color)
        elif src == "unsplash":
            results = _search_unsplash(client, query, per_page, orientation, color)
        elif src == "lorem":
            results = _search_lorem(query, per_page, orientation)
        else:
            raise RuntimeError(f"unknown source: {src}")
        _cache_put(src, results)
        return results

    source = (source or "auto").lower()

    with httpx.Client(timeout=HTTP_TIMEOUT, headers={"User-Agent": USER_AGENT}) as client:
        if source == "all":
            agg: list[dict[str, Any]] = []
            for src in PROVIDER_ORDER:
                try:
                    r = _run_one(src, client)
                    agg.extend(r)
                except Exception as exc:
                    notes.append(f"{src}: skipped ({_redact(str(exc))})")
            _save_cache(cache)
            return ("all", agg, notes)

        if source == "auto":
            for src in PROVIDER_ORDER:
                try:
                    r = _run_one(src, client)
                    if r:
                        _save_cache(cache)
                        return (src, r, notes)
                    notes.append(f"{src}: no results")
                except Exception as exc:
                    notes.append(f"{src}: skipped ({_redact(str(exc))})")
            _save_cache(cache)
            return ("none", [], notes)

        # single explicit source
        try:
            results = _run_one(source, client)
            _save_cache(cache)
            return (source, results, notes)
        except Exception as exc:
            _save_cache(cache)
            raise RuntimeError(_redact(str(exc))) from exc


def _download(
    url: str,
    out_path: Path,
    *,
    timeout: float = HTTP_TIMEOUT,
) -> tuple[int, str]:
    """Stream-download a URL to out_path. Returns (bytes_written, mime_guess)."""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    bytes_written = 0
    mime = "application/octet-stream"
    with httpx.Client(
        timeout=timeout,
        headers={"User-Agent": USER_AGENT},
        follow_redirects=True,
    ) as client:
        with client.stream("GET", url) as r:
            if r.status_code >= 400:
                raise RuntimeError(f"download failed: http {r.status_code}")
            mime = r.headers.get("Content-Type", mime).split(";")[0].strip()
            with out_path.open("wb") as fh:
                for chunk in r.iter_bytes():
                    if chunk:
                        fh.write(chunk)
                        bytes_written += len(chunk)
    return bytes_written, mime


def _resolve_size_url(result: dict[str, Any], size: str) -> str:
    urls = result.get("urls") or {}
    if size in {"original", "large", "medium", "small"} and urls.get(size):
        return urls[size]
    return result.get("url_full") or result.get("url_thumb")


def _resolve_id(cache: dict[str, Any], result_id: str) -> dict[str, Any] | None:
    """Resolve `<source>:<native_id>` OR a 1-based index from the latest query."""
    if ":" in result_id and result_id in cache.get("results", {}):
        return cache["results"][result_id]
    # try numeric index against the most recent query
    queries = cache.get("queries", {})
    if not queries:
        return None
    latest = max(queries.values(), key=lambda q: q.get("ts", 0))
    ids = latest.get("ids", [])
    try:
        idx = int(result_id)
    except ValueError:
        # maybe a bare native id; scan
        for r in cache.get("results", {}).values():
            if isinstance(r, dict) and str(r.get("native_id")) == result_id:
                return r
        return None
    if 1 <= idx <= len(ids):
        return cache["results"].get(ids[idx - 1])
    return None


def _build_out_path(
    explicit: str | None,
    *,
    query: str,
    url: str,
    source: str,
) -> Path:
    if explicit:
        return Path(explicit).expanduser().resolve()
    ext = _safe_ext_from_url(url, fallback="jpg")
    name = f"{_sha8(url)}.{ext}"
    return DEFAULT_DATA_DIR / name


def _write_sidecar(
    out_path: Path,
    *,
    source: str,
    query: str,
    original_url: str,
    photographer: str | None,
    license_str: str,
    extra: dict[str, Any] | None = None,
) -> Path:
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
        sidecar.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    except OSError as exc:
        sys.stderr.write(f"warning: could not write sidecar ({exc})\n")
    return sidecar


# ---------------------------------------------------------------------------
# Pretty printing
# ---------------------------------------------------------------------------


def _print_table(results: Iterable[dict[str, Any]]) -> None:
    rows = list(results)
    if not rows:
        print("(no results)")
        return
    header = ("#", "source", "id", "dims", "aspect", "photographer", "thumb_url")
    print(f"{'#':>3}  {'source':<9}  {'id':<28}  {'dims':<10}  {'aspect':<9}  {'photographer':<24}  thumb_url")
    print("-" * 130)
    for i, r in enumerate(rows, start=1):
        dims = _human_dims(r.get("width"), r.get("height"))
        asp = _aspect(r.get("width"), r.get("height"))
        photog = (r.get("photographer") or "-")[:24]
        rid = r.get("id", "")[:28]
        thumb = r.get("url_thumb") or ""
        print(f"{i:>3}  {r.get('source','?'):<9}  {rid:<28}  {dims:<10}  {asp:<9}  {photog:<24}  {thumb}")


# ---------------------------------------------------------------------------
# Sub-command handlers
# ---------------------------------------------------------------------------


def cmd_keys(_args: argparse.Namespace) -> int:
    status = _provider_status()
    print("Provider status:")
    print(f"{'provider':<10}  {'env_var':<22}  {'set':<5}  rate/h   info")
    print("-" * 90)
    for name in PROVIDER_ORDER:
        s = status[name]
        env_var = s["env"] or "(none)"
        set_flag = "yes" if s["set"] else "no"
        rate = str(s["rate_per_hour"]) if s["rate_per_hour"] else "unlimited"
        print(f"{name:<10}  {env_var:<22}  {set_flag:<5}  {rate:<7}  {s['info']}")
    print()
    print("Fallback chain (--source auto): pexels -> pixabay -> unsplash -> lorem")
    print("Tip: source scripts/agent-tools/.env.local "
          "after copying from .env.local.example")
    return 0


def cmd_search(args: argparse.Namespace) -> int:
    try:
        source, results, notes = _do_search(
            args.query,
            args.source,
            args.per_page,
            args.orientation,
            args.color,
        )
    except Exception as exc:
        _err(f"search failed: {exc}")
        return 1  # unreachable
    for n in notes:
        sys.stderr.write(f"note: {n}\n")
    if args.json:
        print(json.dumps({"source": source, "count": len(results), "results": results}, indent=2, ensure_ascii=False))
    else:
        sys.stderr.write(f"source={source}  count={len(results)}\n")
        _print_table(results)
    return 0


def cmd_download(args: argparse.Namespace) -> int:
    cache = _load_cache()
    result = _resolve_id(cache, args.result_id)
    if not result:
        _err(
            f"could not resolve result_id={args.result_id!r}. "
            "Run a `search` first; ids look like 'pexels:12345' or use the 1-based # from the table."
        )
        return 1  # unreachable
    url = _resolve_size_url(result, args.size)
    if not url:
        _err("no url for selected size")
        return 1
    out_path = _build_out_path(args.out, query=result.get("query", ""), url=url, source=result.get("source", "unknown"))
    try:
        n, mime = _download(url, out_path)
    except Exception as exc:
        _err(f"download failed: {exc}")
        return 1
    sidecar = _write_sidecar(
        out_path,
        source=result.get("source", "unknown"),
        query=result.get("query") or "",
        original_url=url,
        photographer=result.get("photographer"),
        license_str=result.get("license", ""),
        extra={
            "result_id": result.get("id"),
            "page_url": result.get("page_url"),
            "width": result.get("width"),
            "height": result.get("height"),
            "size": args.size,
            "mime": mime,
            "bytes": n,
        },
    )
    print(json.dumps({
        "ok": True,
        "local_path": str(out_path),
        "sidecar": str(sidecar),
        "mime": mime,
        "bytes": n,
        "source": result.get("source"),
    }, indent=2, ensure_ascii=False))
    return 0


def cmd_quick(args: argparse.Namespace) -> int:
    try:
        source, results, notes = _do_search(
            args.query,
            args.source or "auto",
            per_page=max(1, args.per_page),
            orientation=args.orientation,
            color=args.color,
        )
    except Exception as exc:
        _err(f"search failed: {exc}")
        return 1
    for n in notes:
        sys.stderr.write(f"note: {n}\n")
    if not results:
        _err("no results from any provider")
        return 1
    pick = results[0]
    url = _resolve_size_url(pick, args.size)
    if not url:
        _err("no url for first result")
        return 1
    out_path = _build_out_path(args.out, query=args.query, url=url, source=pick.get("source", source))
    try:
        n, mime = _download(url, out_path)
    except Exception as exc:
        _err(f"download failed: {exc}")
        return 1
    sidecar = _write_sidecar(
        out_path,
        source=pick.get("source", source),
        query=args.query,
        original_url=url,
        photographer=pick.get("photographer"),
        license_str=pick.get("license", ""),
        extra={
            "result_id": pick.get("id"),
            "page_url": pick.get("page_url"),
            "width": pick.get("width"),
            "height": pick.get("height"),
            "size": args.size,
            "mime": mime,
            "bytes": n,
        },
    )
    print(json.dumps({
        "ok": True,
        "source": pick.get("source", source),
        "local_path": str(out_path),
        "sidecar": str(sidecar),
        "mime": mime,
        "bytes": n,
        "result_id": pick.get("id"),
    }, indent=2, ensure_ascii=False))
    return 0


# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="pinsela_web_search.py",
        description="Search and fetch images from stock photo APIs (Pexels/Pixabay/Unsplash/Lorem Picsum).",
    )
    sub = p.add_subparsers(dest="cmd", required=True)

    # search
    s = sub.add_parser("search", help="Search across one or all providers.")
    s.add_argument("query", type=str)
    s.add_argument(
        "--source",
        type=str,
        default="auto",
        choices=["pexels", "pixabay", "unsplash", "lorem", "all", "auto"],
        help="Provider or 'all' for aggregation, 'auto' for first-available.",
    )
    s.add_argument("--per-page", type=int, default=10)
    s.add_argument(
        "--orientation",
        type=str,
        default=None,
        choices=["portrait", "landscape", "square"],
    )
    s.add_argument("--color", type=str, default=None)
    s.add_argument("--json", action="store_true", help="Print full JSON instead of table.")
    s.set_defaults(func=cmd_search)

    # download
    d = sub.add_parser("download", help="Download a previously-found result.")
    d.add_argument(
        "result_id",
        type=str,
        help="'<source>:<native_id>' or 1-based # from the most recent search.",
    )
    d.add_argument("--out", type=str, default=None, help="Output path (defaults to external_assets/).")
    d.add_argument(
        "--size",
        type=str,
        default="large",
        choices=["original", "large", "medium", "small"],
    )
    d.set_defaults(func=cmd_download)

    # quick
    q = sub.add_parser("quick", help="Search + download first result in one shot.")
    q.add_argument("query", type=str)
    q.add_argument("--out", type=str, default=None)
    q.add_argument(
        "--source",
        type=str,
        default="auto",
        choices=["pexels", "pixabay", "unsplash", "lorem", "auto"],
    )
    q.add_argument("--per-page", type=int, default=5)
    q.add_argument(
        "--orientation",
        type=str,
        default=None,
        choices=["portrait", "landscape", "square"],
    )
    q.add_argument("--color", type=str, default=None)
    q.add_argument(
        "--size",
        type=str,
        default="large",
        choices=["original", "large", "medium", "small"],
    )
    q.set_defaults(func=cmd_quick)

    # keys
    k = sub.add_parser("keys", help="Show which API keys are detected in env.")
    k.set_defaults(func=cmd_keys)

    return p


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    try:
        return int(args.func(args) or 0)
    except SystemExit:
        raise
    except Exception as exc:  # last-resort safety
        sys.stderr.write(_redact(f"unhandled error: {exc}\n"))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
