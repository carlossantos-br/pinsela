from __future__ import annotations

import base64
import binascii
from collections import deque
from dataclasses import dataclass, field
import hmac
import hashlib
import json
import math
import secrets
import threading
import time
from typing import Any

import bcrypt
from fastapi import Depends, HTTPException, Request, Response, status
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from pinsela.config import get_settings


COOKIE_NAME = "pinsela_session"
CSRF_COOKIE_NAME = "pinsela_csrf"
CSRF_HEADER_NAME = "x-csrf-token"
_UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
_COOKIE_DOMAIN_DEFAULT = object()


def normalize_auth_email(value: str) -> str:
    return str(value or "").strip().lower()


def get_allowed_auth_emails() -> set[str]:
    settings = get_settings()
    parts = str(settings.auth_allowed_emails or "").replace(";", ",").split(",")
    return {normalize_auth_email(part) for part in parts if normalize_auth_email(part)}


def get_admin_username() -> str:
    settings = get_settings()
    return settings.admin_username


def verify_password(password: str) -> bool:
    """
    Verify admin password hash.
    """
    settings = get_settings()
    if not settings.admin_password_hash:
        return False
    try:
        return bcrypt.checkpw(
            password.encode("utf-8"),
            settings.admin_password_hash.encode("utf-8"),
        )
    except ValueError:
        # Invalid hash format, invalid salt, or password too long for bcrypt.
        return False


@dataclass
class _RateBucket:
    attempts: deque[float] = field(default_factory=deque)
    lock_until: float = 0.0
    last_seen: float = 0.0


class _SlidingWindowLockout:
    def __init__(self, *, window_seconds: int, max_attempts: int, lockout_seconds: int) -> None:
        self.window_seconds = max(1, int(window_seconds))
        self.max_attempts = max(1, int(max_attempts))
        self.lockout_seconds = max(1, int(lockout_seconds))
        self._buckets: dict[str, _RateBucket] = {}
        self._lock = threading.Lock()

    def _prune(self, bucket: _RateBucket, now: float) -> None:
        cutoff = now - self.window_seconds
        while bucket.attempts and bucket.attempts[0] < cutoff:
            bucket.attempts.popleft()

    def _gc(self, now: float) -> None:
        stale_after = max(self.window_seconds, self.lockout_seconds) * 3
        stale_keys = [
            key
            for key, bucket in self._buckets.items()
            if bucket.lock_until <= now
            and not bucket.attempts
            and (now - bucket.last_seen) >= stale_after
        ]
        for key in stale_keys:
            self._buckets.pop(key, None)

    def retry_after_seconds(self, key: str) -> int:
        now = time.monotonic()
        with self._lock:
            bucket = self._buckets.get(key)
            if not bucket:
                return 0
            bucket.last_seen = now
            self._prune(bucket, now)
            if bucket.lock_until > now:
                return int(max(1, math.ceil(bucket.lock_until - now)))
            self._gc(now)
            return 0

    def register_failure(self, key: str) -> None:
        now = time.monotonic()
        with self._lock:
            bucket = self._buckets.setdefault(key, _RateBucket())
            bucket.last_seen = now
            if bucket.lock_until > now:
                return
            self._prune(bucket, now)
            bucket.attempts.append(now)
            if len(bucket.attempts) >= self.max_attempts:
                bucket.attempts.clear()
                bucket.lock_until = now + self.lockout_seconds
            self._gc(now)

    def clear(self, key: str) -> None:
        with self._lock:
            self._buckets.pop(key, None)


@dataclass(frozen=True)
class _AuthRateGuard:
    login: _SlidingWindowLockout
    register: _SlidingWindowLockout


_AUTH_RATE_GUARD: _AuthRateGuard | None = None
_AUTH_RATE_GUARD_LOCK = threading.Lock()


def _get_auth_rate_guard() -> _AuthRateGuard:
    global _AUTH_RATE_GUARD
    if _AUTH_RATE_GUARD is not None:
        return _AUTH_RATE_GUARD
    with _AUTH_RATE_GUARD_LOCK:
        if _AUTH_RATE_GUARD is not None:
            return _AUTH_RATE_GUARD
        settings = get_settings()
        _AUTH_RATE_GUARD = _AuthRateGuard(
            login=_SlidingWindowLockout(
                window_seconds=settings.auth_login_rate_window_seconds,
                max_attempts=settings.auth_login_rate_max_attempts,
                lockout_seconds=settings.auth_login_lockout_seconds,
            ),
            register=_SlidingWindowLockout(
                window_seconds=settings.auth_register_rate_window_seconds,
                max_attempts=settings.auth_register_rate_max_attempts,
                lockout_seconds=settings.auth_register_lockout_seconds,
            ),
        )
        return _AUTH_RATE_GUARD


def _request_client_ip(request: Request) -> str:
    # Proxy headers are client-controlled: only honored with PINSELA_TRUST_PROXY_HEADERS=1,
    # otherwise an attacker rotates X-Forwarded-For on every attempt and escapes the per-IP rate limit.
    if get_settings().trust_proxy_headers:
        forwarded = request.headers.get("x-forwarded-for", "")
        if forwarded:
            return forwarded.split(",")[0].strip() or "unknown"
        real_ip = request.headers.get("x-real-ip", "").strip()
        if real_ip:
            return real_ip
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def _auth_rate_keys(flow: str, request: Request, email: str) -> list[str]:
    ip = _request_client_ip(request)
    normalized_email = normalize_auth_email(email)
    keys = [f"{flow}:ip:{ip}"]
    if normalized_email:
        keys.append(f"{flow}:email:{normalized_email}")
    return keys


def _flow_limiter(flow: str) -> _SlidingWindowLockout:
    guard = _get_auth_rate_guard()
    if flow == "register":
        return guard.register
    return guard.login


def auth_retry_after_seconds(flow: str, request: Request, email: str) -> int:
    limiter = _flow_limiter(flow)
    keys = _auth_rate_keys(flow, request, email)
    return max((limiter.retry_after_seconds(key) for key in keys), default=0)


def auth_register_failure(flow: str, request: Request, email: str) -> None:
    limiter = _flow_limiter(flow)
    for key in _auth_rate_keys(flow, request, email):
        limiter.register_failure(key)


def auth_register_success(flow: str, request: Request, email: str) -> None:
    limiter = _flow_limiter(flow)
    for key in _auth_rate_keys(flow, request, email):
        limiter.clear(key)


def _serializer() -> URLSafeTimedSerializer:
    settings = get_settings()
    return URLSafeTimedSerializer(settings.session_secret, salt="pinsela-session")


def set_session_cookie(
    response: Response,
    *,
    username: str,
    cookie_domain_override: object | str | None = _COOKIE_DOMAIN_DEFAULT,
) -> None:
    settings = get_settings()
    if cookie_domain_override is _COOKIE_DOMAIN_DEFAULT:
        cookie_domain = str(settings.auth_cookie_domain or "").strip() or None
    else:
        cookie_domain = str(cookie_domain_override or "").strip() or None
    csrf_token = secrets.token_urlsafe(32)
    token = _serializer().dumps({"u": normalize_auth_email(username), "v": 1, "csrf": csrf_token})
    response.set_cookie(
        COOKIE_NAME,
        token,
        max_age=settings.session_max_age_seconds,
        httponly=True,
        samesite="strict",
        secure=settings.pinsela_env == "prod",
        domain=cookie_domain,
        path="/",
    )
    response.set_cookie(
        CSRF_COOKIE_NAME,
        csrf_token,
        max_age=settings.session_max_age_seconds,
        httponly=False,
        samesite="strict",
        secure=settings.pinsela_env == "prod",
        domain=cookie_domain,
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    settings = get_settings()
    cookie_domain = str(settings.auth_cookie_domain or "").strip() or None
    response.delete_cookie(COOKIE_NAME, path="/")
    response.delete_cookie(CSRF_COOKIE_NAME, path="/")
    if cookie_domain:
        response.delete_cookie(COOKIE_NAME, path="/", domain=cookie_domain)
        response.delete_cookie(CSRF_COOKIE_NAME, path="/", domain=cookie_domain)


@dataclass(frozen=True)
class AdminPrincipal:
    username: str = "admin"
    auth_via: str = "session"  # session|token


def get_admin_principal(request: Request) -> AdminPrincipal:
    settings = get_settings()
    username = get_admin_username()

    # Token fallback (useful for plugin and automated calls).
    token = request.headers.get("X-Admin-Token") or request.headers.get("x-admin-token")
    if settings.auth_allow_admin_token_header and settings.admin_token and token and hmac.compare_digest(token, settings.admin_token):
        return AdminPrincipal(username=username, auth_via="token")

    cookie = request.cookies.get(COOKIE_NAME)
    if not cookie:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    try:
        data: Any = _serializer().loads(cookie, max_age=settings.session_max_age_seconds)
    except SignatureExpired:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired")
    except BadSignature:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session")

    allowed_emails = get_allowed_auth_emails()
    session_username = normalize_auth_email(data.get("u")) if isinstance(data, dict) else ""
    if not session_username or session_username not in allowed_emails:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session")

    if request.method.upper() in _UNSAFE_METHODS:
        session_csrf = str(data.get("csrf") or "") if isinstance(data, dict) else ""
        cookie_csrf = str(request.cookies.get(CSRF_COOKIE_NAME) or "")
        header_csrf = str(request.headers.get(CSRF_HEADER_NAME) or "")
        if not session_csrf or not cookie_csrf or not header_csrf:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="CSRF validation failed")
        if not hmac.compare_digest(session_csrf, cookie_csrf) or not hmac.compare_digest(session_csrf, header_csrf):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="CSRF validation failed")

    return AdminPrincipal(username=session_username, auth_via="session")


def require_admin(principal: AdminPrincipal = Depends(get_admin_principal)) -> AdminPrincipal:
    return principal
