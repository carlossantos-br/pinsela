from __future__ import annotations

import hashlib

from fastapi import APIRouter, Depends, HTTPException, Response, status
import bcrypt

from pinsela.auth import (
    AdminPrincipal,
    auth_register_failure,
    auth_register_success,
    auth_retry_after_seconds,
    clear_session_cookie,
    get_allowed_auth_emails,
    normalize_auth_email,
    require_admin,
    set_session_cookie,
)
from pinsela.schemas import LoginRequest, LoginResponse, RegisterRequest, RegisterResponse
from pinsela.db import db_session
from sqlalchemy.orm import Session
from pinsela.models import UserAccount
from fastapi import Request
from pinsela.config import get_settings
from pinsela.security import is_trusted_local_request


router = APIRouter(prefix="/api/auth", tags=["auth"])

INVALID_LOGIN_DETAIL = "Invalid credentials."


def _request_is_local(request: Request) -> bool:
    """Loopback peer AND local Host. The Host alone is attacker-controlled."""
    return is_trusted_local_request(request)


def _resolve_local_bootstrap_email(settings) -> str:
    allowed_emails = sorted(get_allowed_auth_emails())
    if allowed_emails:
        return allowed_emails[0]
    raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Local account is not configured.")


def _set_request_session_cookie(request: Request, response: Response, *, username: str) -> None:
    settings = get_settings()
    if settings.pinsela_env != "prod" and _request_is_local(request):
        set_session_cookie(response, username=username, cookie_domain_override=None)
        return
    set_session_cookie(response, username=username)


@router.post("/local/bootstrap")
def local_bootstrap(request: Request, response: Response, db: Session = Depends(db_session)) -> dict:
    # 2026-05-27: removed acceptance via the x-local-sandbox-bootstrap-key header
    # (it was a contract of the IndexedDB sandbox feature, which was deleted). Bootstrap
    # now only works on loopback.
    settings = get_settings()
    allow_localhost_bootstrap = settings.pinsela_env != "prod" and _request_is_local(request)
    if not allow_localhost_bootstrap:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    username = _resolve_local_bootstrap_email(settings)
    user = db.query(UserAccount).filter_by(email=username).first()
    if user is None:
        # sha256 hex (64 chars) keeps the value under bcrypt's 72-byte limit for any secret length.
        bootstrap_secret = hashlib.sha256(
            f"{settings.session_secret}:local-bootstrap:{username}".encode("utf-8")
        ).hexdigest()
        salt = bcrypt.gensalt()
        password_hash = bcrypt.hashpw(bootstrap_secret.encode("utf-8"), salt).decode("utf-8")
        user = UserAccount(email=username, password_hash=password_hash)
        db.add(user)
        db.commit()

    _set_request_session_cookie(request, response, username=username)
    return {"ok": True, "username": username, "auth_via": "local-bootstrap"}


@router.post("/register", response_model=RegisterResponse)
def register(req: RegisterRequest, request: Request, db: Session = Depends(db_session)) -> RegisterResponse:
    settings = get_settings()
    if not settings.auth_registration_enabled:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Sign-up is disabled. Ask the administrator for access.",
        )

    username = normalize_auth_email(req.username)
    if len(str(req.password or "")) < settings.auth_min_password_length:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Weak password. Use at least {settings.auth_min_password_length} characters.",
        )

    retry_after = auth_retry_after_seconds("register", request, username)
    if retry_after > 0:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Too many sign-up attempts. Try again in {retry_after}s.",
        )

    allowed_emails = get_allowed_auth_emails()
    if username not in allowed_emails:
        auth_register_failure("register", request, username)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Email not authorized.")

    existing_user = db.query(UserAccount).filter_by(email=username).first()
    if existing_user:
        auth_register_failure("register", request, username)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User already registered. Please sign in.")

    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(req.password.encode("utf-8"), salt).decode("utf-8")

    new_user = UserAccount(email=username, password_hash=hashed)
    db.add(new_user)
    db.commit()
    auth_register_success("register", request, username)

    return RegisterResponse(ok=True, message="Account created successfully. You can sign in now.")


@router.post("/login", response_model=LoginResponse)
def login(req: LoginRequest, request: Request, response: Response, db: Session = Depends(db_session)) -> LoginResponse:
    username = normalize_auth_email(req.username)
    retry_after = auth_retry_after_seconds("login", request, username)
    if retry_after > 0:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Too many login attempts. Try again in {retry_after}s.",
        )

    allowed_emails = get_allowed_auth_emails()
    if username not in allowed_emails:
        auth_register_failure("login", request, username)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=INVALID_LOGIN_DETAIL)

    user = db.query(UserAccount).filter_by(email=username).first()
    if not user:
        auth_register_failure("login", request, username)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=INVALID_LOGIN_DETAIL)

    if not bcrypt.checkpw(req.password.encode("utf-8"), user.password_hash.encode("utf-8")):
        auth_register_failure("login", request, username)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=INVALID_LOGIN_DETAIL)

    auth_register_success("login", request, username)
    _set_request_session_cookie(request, response, username=username)
    return LoginResponse(ok=True, username=username)


@router.post("/logout")
def logout(response: Response, principal: AdminPrincipal = Depends(require_admin)) -> dict:
    clear_session_cookie(response)
    return {"ok": True, "username": principal.username}


@router.get("/me")
def me(principal: AdminPrincipal = Depends(require_admin)) -> dict:
    return {"ok": True, "username": principal.username, "auth_via": principal.auth_via}
