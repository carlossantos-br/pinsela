from __future__ import annotations

import os
import secrets
from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

_API_DIR = Path(__file__).resolve().parents[1]  # apps/api
_REPO_ROOT = Path(__file__).resolve().parents[3]


def default_data_root() -> Path:
    """Data root: $PINSELA_SERVER_DATA_ROOT, else <repo>/apps/api/data (git-ignored)."""
    raw = str(os.environ.get("PINSELA_SERVER_DATA_ROOT") or "").strip()
    return Path(raw).expanduser() if raw else _API_DIR / "data"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env.v2", env_file_encoding="utf-8", extra="ignore")

    # App
    pinsela_env: Literal["dev", "prod"] = Field(default="dev", alias="PINSELA_ENV")
    log_level: str = Field(default="INFO", alias="PINSELA_LOG_LEVEL")
    database_url: str = Field(default="", alias="PINSELA_DATABASE_URL")

    # Feature flags / modes
    pipeline_v2_enabled: bool = Field(default=False, alias="PIPELINE_V2_ENABLED")

    # Auth
    session_secret: str = Field(default="", alias="PINSELA_SESSION_SECRET")
    session_max_age_seconds: int = Field(default=60 * 60 * 12, alias="PINSELA_SESSION_MAX_AGE_SECONDS")
    admin_username: str = Field(default="admin", alias="PINSELA_ADMIN_USERNAME")
    admin_password_hash: str | None = Field(default=None, alias="PINSELA_ADMIN_PASSWORD_HASH")
    admin_token: str | None = Field(default=None, alias="PINSELA_ADMIN_TOKEN")
    auth_allow_admin_token_header: bool = Field(default=False, alias="PINSELA_AUTH_ALLOW_ADMIN_TOKEN_HEADER")
    auth_cookie_domain: str = Field(default="", alias="PINSELA_AUTH_COOKIE_DOMAIN")
    auth_allowed_emails: str = Field(default="", alias="PINSELA_AUTH_ALLOWED_EMAILS")
    auth_registration_enabled: bool = Field(default=False, alias="PINSELA_AUTH_REGISTRATION_ENABLED")
    auth_min_password_length: int = Field(default=12, alias="PINSELA_AUTH_MIN_PASSWORD_LENGTH")
    auth_login_rate_window_seconds: int = Field(default=5 * 60, alias="PINSELA_AUTH_LOGIN_RATE_WINDOW_SECONDS")
    auth_login_rate_max_attempts: int = Field(default=8, alias="PINSELA_AUTH_LOGIN_RATE_MAX_ATTEMPTS")
    auth_login_lockout_seconds: int = Field(default=15 * 60, alias="PINSELA_AUTH_LOGIN_LOCKOUT_SECONDS")
    auth_register_rate_window_seconds: int = Field(default=10 * 60, alias="PINSELA_AUTH_REGISTER_RATE_WINDOW_SECONDS")
    auth_register_rate_max_attempts: int = Field(default=6, alias="PINSELA_AUTH_REGISTER_RATE_MAX_ATTEMPTS")
    auth_register_lockout_seconds: int = Field(default=20 * 60, alias="PINSELA_AUTH_REGISTER_LOCKOUT_SECONDS")

    # Only trust X-Forwarded-For / X-Real-IP (login rate limit) behind your own reverse proxy.
    trust_proxy_headers: bool = Field(default=False, alias="PINSELA_TRUST_PROXY_HEADERS")

    # CORS
    cors_origins: str = Field(default="", alias="PINSELA_CORS_ORIGINS")

    # Storage (server-side)
    server_data_root: str = Field(default=str(_API_DIR / "data"), alias="PINSELA_SERVER_DATA_ROOT")

    # UI dist (served by backend). In Docker, built into this directory.
    ui_dist_dir: str = Field(default=str(_REPO_ROOT / "ui" / "dist"), alias="PINSELA_UI_DIST_DIR")


    # Agent dry-run (local-only render loop)
    agent_token: str | None = Field(default=None, alias="PINSELA_AGENT_TOKEN")

    def apply_dev_defaults(self) -> None:
        """Zero-config local run: in dev, fill whatever is missing with safe local defaults.

        Production (PINSELA_ENV=prod) never gets defaults; validate_required() rejects it.
        """
        if self.pinsela_env != "dev":
            return
        data_root = Path(self.server_data_root).expanduser()
        if not str(self.database_url or "").strip():
            data_root.mkdir(parents=True, exist_ok=True)
            self.database_url = f"sqlite:///{(data_root / 'app.db').as_posix()}"
        if not str(self.session_secret or "").strip():
            # Persisted so sessions survive restarts; lives in the git-ignored data dir.
            secret_file = data_root / ".dev_session_secret"
            try:
                secret = secret_file.read_text(encoding="utf-8").strip()
            except OSError:
                secret = ""
            if not secret:
                data_root.mkdir(parents=True, exist_ok=True)
                secret = secrets.token_urlsafe(48)
                secret_file.write_text(secret, encoding="utf-8")
                try:
                    secret_file.chmod(0o600)
                except OSError:
                    pass
            self.session_secret = secret
        if not self.admin_password_hash and not self.admin_token:
            # Dev has no password login: access is via the loopback-only /api/auth/local/bootstrap.
            self.admin_token = secrets.token_urlsafe(32)
        if not self.auth_allowed_emails.strip():
            self.auth_allowed_emails = "local@pinsela.local"

    def validate_required(self) -> None:
        if not str(self.database_url or "").strip():
            raise ValueError("Missing PINSELA_DATABASE_URL.")
        if not str(self.session_secret or "").strip():
            raise ValueError("Missing PINSELA_SESSION_SECRET.")
        db_url = str(self.database_url or "").strip().lower()
        if self.pinsela_env == "prod" and len(self.session_secret.strip()) < 32:
            raise ValueError("PINSELA_SESSION_SECRET must have at least 32 characters in prod.")
        if self.pinsela_env == "prod" and db_url.startswith("sqlite"):
            raise ValueError("SQLite is not supported in production. Set PINSELA_DATABASE_URL to PostgreSQL.")

        # Auth hardening: require a managed hash or token, never plaintext password.
        if not self.admin_password_hash and not self.admin_token:
            raise ValueError(
                "Missing admin secret. Set PINSELA_ADMIN_PASSWORD_HASH or PINSELA_ADMIN_TOKEN."
            )
        if self.admin_password_hash and not self.admin_password_hash.startswith(("$2a$", "$2b$", "$2y$")):
            raise ValueError("PINSELA_ADMIN_PASSWORD_HASH must be a bcrypt hash.")
        if self.auth_allow_admin_token_header and not self.admin_token:
            raise ValueError("PINSELA_AUTH_ALLOW_ADMIN_TOKEN_HEADER=1 requires PINSELA_ADMIN_TOKEN.")
        cookie_domain = str(self.auth_cookie_domain or "").strip()
        if cookie_domain and "://" in cookie_domain:
            raise ValueError("PINSELA_AUTH_COOKIE_DOMAIN must be a domain only (no scheme).")
        if not self.auth_allowed_emails.strip():
            raise ValueError("Missing auth allowlist. Set PINSELA_AUTH_ALLOWED_EMAILS.")
        if self.auth_min_password_length < 8:
            raise ValueError("PINSELA_AUTH_MIN_PASSWORD_LENGTH must be >= 8.")
        if self.auth_login_rate_window_seconds <= 0 or self.auth_login_rate_max_attempts <= 0 or self.auth_login_lockout_seconds <= 0:
            raise ValueError("Invalid login rate-limit configuration.")
        if self.auth_register_rate_window_seconds <= 0 or self.auth_register_rate_max_attempts <= 0 or self.auth_register_lockout_seconds <= 0:
            raise ValueError("Invalid register rate-limit configuration.")



_settings: Settings | None = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        s = Settings()
        s.apply_dev_defaults()
        s.validate_required()
        _settings = s
    return _settings
