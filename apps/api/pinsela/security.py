"""Shared security helpers: local origin, path confinement and SSRF.

Threat model: the API runs on 127.0.0.1 and the user's browser visits arbitrary
sites ("simple" cross-site requests, DNS rebinding, reverse proxy).
"""
from __future__ import annotations

import ipaddress
import socket
from pathlib import Path
from urllib.parse import urljoin, urlparse

from fastapi import HTTPException, Request

LOOPBACK_CLIENTS = frozenset({"127.0.0.1", "::1"})
LOCAL_HOSTNAMES = frozenset({"localhost", "127.0.0.1", "::1"})
_FORWARD_HEADERS = ("x-forwarded-for", "x-forwarded-host", "x-real-ip", "forwarded")


def request_host_name(request: Request) -> str:
    """Hostname from the Host header (no port, no brackets, lowercase)."""
    raw = str(request.headers.get("host") or "").strip().lower()
    if not raw:
        return ""
    if raw.startswith("["):
        end = raw.find("]")
        return raw[1:end] if end != -1 else ""
    if raw.count(":") == 1:
        return raw.split(":", 1)[0]
    return raw


def is_trusted_local_request(request: Request) -> bool:
    """True only if the peer is loopback AND the Host is localhost/127.0.0.1/::1.

    The Host is attacker-controlled, so it proves nothing alone; client.host
    alone is defeated by DNS rebinding and by a reverse proxy on the same host. Requiring
    both, and no proxy header, covers all three cases.
    """
    client_host = str(getattr(getattr(request, "client", None), "host", "") or "").strip().lower()
    if client_host not in LOOPBACK_CLIENTS:
        return False
    if request_host_name(request) not in LOCAL_HOSTNAMES:
        return False
    return not any(request.headers.get(h) for h in _FORWARD_HEADERS)


def resolve_under(root: Path, candidate: str | Path, *, must_exist: bool = False) -> Path:
    """Resolves `candidate` (relative to root, or absolute) and ensures it stays inside `root`.

    resolve() follows symlinks, so a link pointing outside is rejected.
    Raises ValueError if it escapes.
    """
    root_resolved = Path(root).expanduser().resolve()
    p = Path(candidate).expanduser()
    if not p.is_absolute():
        p = root_resolved / p
    p = p.resolve()
    if p != root_resolved and not p.is_relative_to(root_resolved):
        raise ValueError("path_outside_data_root")
    if must_exist and not p.exists():
        raise FileNotFoundError(str(p))
    return p


# --------------------------------------------------------------------------- #
# SSRF
# --------------------------------------------------------------------------- #

def _ip_is_public(ip: ipaddress._BaseAddress) -> bool:
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return ip.is_global and not ip.is_multicast


def assert_public_http_url(url: str) -> ipaddress._BaseAddress:
    """Rejects URLs that are not http(s) to a public host (blocks loopback,
    private network, link-local/metadata 169.254.x, etc.). Raises ValueError.
    Returns the validated IP so the connection uses exactly it (no new DNS lookup)."""
    parsed = urlparse(str(url or "").strip())
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise ValueError("url_scheme_not_allowed")
    if parsed.username or parsed.password:
        raise ValueError("url_credentials_not_allowed")
    host = parsed.hostname
    try:
        literal = ipaddress.ip_address(host)
        addrs = [literal]
    except ValueError:
        try:
            infos = socket.getaddrinfo(host, parsed.port or (443 if parsed.scheme == "https" else 80), proto=socket.IPPROTO_TCP)
        except OSError as exc:
            raise ValueError("url_host_unresolvable") from exc
        addrs = [ipaddress.ip_address(i[4][0].split("%")[0]) for i in infos]
    if not addrs or not all(_ip_is_public(a) for a in addrs):
        raise ValueError("url_host_not_public")
    # IPv4 first: many home networks resolve AAAA but do not route IPv6.
    return next((a for a in addrs if isinstance(a, ipaddress.IPv4Address)), addrs[0])


def _pinned_request_args(url: str, ip: ipaddress._BaseAddress) -> tuple[str, dict[str, str], dict]:
    """Rewrites the URL to the already-validated IP (closes the DNS rebinding window),
    keeping Host and SNI/TLS verification on the original name."""
    parsed = urlparse(url)
    host = parsed.hostname or ""
    ip_text = f"[{ip}]" if isinstance(ip, ipaddress.IPv6Address) else str(ip)
    netloc = f"{ip_text}:{parsed.port}" if parsed.port else ip_text
    pinned = parsed._replace(netloc=netloc).geturl()
    host_header = f"{host}:{parsed.port}" if parsed.port else host
    if ":" in host and not host.startswith("["):
        host_header = f"[{host}]:{parsed.port}" if parsed.port else f"[{host}]"
    extensions = {"sni_hostname": host} if parsed.scheme == "https" else {}
    return pinned, {"Host": host_header}, extensions


def fetch_public_url(url: str, *, timeout: float = 30.0, max_bytes: int = 25 * 1024 * 1024,
                     max_redirects: int = 5, headers: dict[str, str] | None = None):
    """GET with manual redirects; each hop is revalidated against `assert_public_http_url`.

    Returns (bytes, content_type). Raises ValueError (URL blocked / too large)
    ou httpx.HTTPError.
    """
    import httpx

    current = url
    # trust_env=False: an HTTP(S)_PROXY from the environment must not divert the connection
    # do IP validado.
    with httpx.Client(timeout=timeout, headers=headers or {}, follow_redirects=False, trust_env=False) as client:
        for _ in range(max_redirects + 1):
            ip = assert_public_http_url(current)
            pinned, host_headers, extensions = _pinned_request_args(current, ip)
            with client.stream("GET", pinned, headers=host_headers, extensions=extensions) as r:
                if r.status_code in (301, 302, 303, 307, 308) and r.headers.get("location"):
                    current = urljoin(current, r.headers["location"])
                    continue
                if r.status_code >= 400:
                    raise httpx.HTTPStatusError("bad_status", request=r.request, response=r)
                buf = bytearray()
                for chunk in r.iter_bytes():
                    buf.extend(chunk)
                    if len(buf) > max_bytes:
                        raise ValueError("response_too_large")
                ctype = r.headers.get("Content-Type", "application/octet-stream").split(";")[0].strip()
                return bytes(buf), ctype
    raise ValueError("too_many_redirects")


def require_trusted_local(request: Request) -> None:
    if not is_trusted_local_request(request):
        raise HTTPException(status_code=404, detail="Not found")


# --------------------------------------------------------------------------- #
# CSRF cross-site (Origin / Sec-Fetch-Site)
# --------------------------------------------------------------------------- #

UNSAFE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})


def is_cross_site_unsafe_request(request: Request, allowed_origins: set[str]) -> bool:
    """True if it is an unsafe method coming from a disallowed foreign origin.

    Browsers always send Origin (and Sec-Fetch-Site) on cross-origin POSTs,
    including the "simple" ones (form/multipart/text-plain) that skip preflight.
    Non-browser clients (curl, agent scripts) send neither and pass.
    """
    if request.method.upper() not in UNSAFE_METHODS:
        return False
    origin = str(request.headers.get("origin") or "").strip().lower()
    fetch_site = str(request.headers.get("sec-fetch-site") or "").strip().lower()
    if not origin:
        return fetch_site == "cross-site"
    if origin in allowed_origins:
        return False
    if origin == "null":
        return True
    parsed = urlparse(origin)
    origin_netloc = parsed.netloc
    if origin_netloc and origin_netloc == str(request.headers.get("host") or "").strip().lower():
        return False  # same-origin
    # Dev: UI on another local port (vite) talking to the local API.
    if (parsed.hostname or "") in LOCAL_HOSTNAMES and is_trusted_local_request(request):
        return False
    return True
