"""
middleware/auth.py
FastAPI dependency for Supabase JWT verification.

Supports BOTH old (HS256 / legacy secret) and new (ES256 / JWKS) Supabase tokens.
Supabase migrated projects to ES256 asymmetric signing in 2024-2025.
JWKS endpoint: https://<project>.supabase.co/auth/v1/.well-known/jwks.json
"""

import json
import base64
import logging
import time
from dataclasses import dataclass
from typing import Optional

import httpx
from fastapi import HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi import Depends, Request
from jose import jwt, JWTError

from ..config import get_settings

logger = logging.getLogger(__name__)
_bearer = HTTPBearer(auto_error=False)

# JWKS cache — refreshed at most once per hour
_jwks_cache: Optional[dict] = None
_jwks_loaded_at: float = 0


@dataclass
class AuthUser:
    """Authenticated user context extracted from JWT."""
    id:           str
    email:        str = ""
    display_name: str = ""


# ── Token header inspection ───────────────────────────────────────

def _get_token_alg(token: str) -> str:
    """Read the 'alg' field from JWT header without verification."""
    try:
        header_b64 = token.split(".")[0]
        header_b64 += "=" * (4 - len(header_b64) % 4)
        header = json.loads(base64.urlsafe_b64decode(header_b64))
        return header.get("alg", "HS256")
    except Exception:
        return "HS256"


# ── HS256 verification (legacy Supabase JWT secret) ───────────────

def _verify_hs256(token: str, secret: str) -> dict:
    """Verify a legacy HS256 Supabase JWT using the JWT secret."""
    return jwt.decode(
        token,
        secret,
        algorithms=["HS256"],
        audience="authenticated",
        options={"verify_at_hash": False},
    )


# ── ES256 / RS256 verification via JWKS ───────────────────────────

async def _fetch_jwks(supabase_url: str) -> dict:
    """Fetch and cache Supabase JWKS (refreshes every hour)."""
    global _jwks_cache, _jwks_loaded_at
    now = time.time()
    if _jwks_cache and (now - _jwks_loaded_at) < 3600:
        return _jwks_cache

    jwks_url = f"{supabase_url}/auth/v1/.well-known/jwks.json"
    logger.info("Fetching Supabase JWKS from %s", jwks_url)
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(jwks_url)
        resp.raise_for_status()
        _jwks_cache = resp.json()
        _jwks_loaded_at = now
        logger.info("JWKS loaded — %d key(s)", len(_jwks_cache.get("keys", [])))
        return _jwks_cache


async def _verify_jwks(token: str, supabase_url: str) -> dict:
    """Verify an ES256/RS256 Supabase JWT using the JWKS endpoint."""
    jwks = await _fetch_jwks(supabase_url)
    keys = jwks.get("keys", [])
    if not keys:
        raise JWTError("JWKS returned no keys")

    last_error: Exception = JWTError("No keys tried")
    for key_data in keys:
        try:
            return jwt.decode(
                token,
                key_data,
                algorithms=["ES256", "RS256"],
                audience="authenticated",
                options={"verify_at_hash": False},
            )
        except JWTError as exc:
            last_error = exc
            continue

    raise JWTError(f"Token invalid against all JWKS keys: {last_error}")


# ── Main verification dispatcher ──────────────────────────────────

async def _verify_token(token: str) -> dict:
    """
    Verify a Supabase JWT regardless of algorithm.
    - HS256 → legacy JWT secret
    - ES256 / RS256 → JWKS endpoint
    """
    settings  = get_settings()
    algorithm = _get_token_alg(token)

    if algorithm == "HS256":
        secret = settings.supabase_jwt_secret or ""
        if not secret or secret == "your-jwt-secret-here":
            raise JWTError("HS256 token but SUPABASE_JWT_SECRET is not configured")
        return _verify_hs256(token, secret)
    else:
        # ES256 / RS256 — use JWKS
        if not settings.supabase_url:
            raise JWTError("ES256 token but SUPABASE_URL is not configured for JWKS fetch")
        return await _verify_jwks(token, settings.supabase_url)


# ── Payload → AuthUser ────────────────────────────────────────────

def _payload_to_user(payload: dict) -> AuthUser:
    user_id = payload.get("sub", "")
    email   = payload.get("email", "")
    meta    = payload.get("user_metadata", {}) or {}
    display_name = (
        meta.get("display_name")
        or meta.get("full_name")
        or meta.get("name")
        or (email.split("@")[0] if email else "Student")
    )
    return AuthUser(id=user_id, email=email, display_name=display_name)


# ── FastAPI dependencies ──────────────────────────────────────────

async def get_current_user_full(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
) -> AuthUser:
    """
    FastAPI dependency — returns full AuthUser from JWT.

    Supports both legacy HS256 (JWT secret) and new ES256 (JWKS) Supabase tokens.
    Falls back to dev mode when SUPABASE_JWT_SECRET is unset/placeholder.
    """
    settings = get_settings()
    jwt_configured = (
        settings.supabase_jwt_secret
        and settings.supabase_jwt_secret != "your-jwt-secret-here"
    )

    # ── Auth mode: we have a token → verify it ────────────────────
    if credentials:
        try:
            payload = await _verify_token(credentials.credentials)
            user    = _payload_to_user(payload)
            if not user.id:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Token missing 'sub' claim",
                )
            logger.debug("Auth OK — user=%s alg=%s", user.id[:8], _get_token_alg(credentials.credentials))
            return user
        except (JWTError, Exception) as exc:
            logger.warning(
                "401: JWT verification FAILED (%s) — %s",
                _get_token_alg(credentials.credentials),
                exc,
            )
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=f"Token verification failed: {exc}",
                headers={"WWW-Authenticate": "Bearer"},
            )

    # ── No token provided ─────────────────────────────────────────
    if jwt_configured:
        # Auth is required — reject the request
        logger.warning("401: No Bearer token for %s %s", request.method, request.url.path)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated — please sign in",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # ── Dev mode: no JWT configured, no token ─────────────────────
    student_id = request.headers.get("X-Student-Id", "anonymous-dev")
    logger.debug("Dev mode — student_id: %s", student_id)
    return AuthUser(id=student_id, email="", display_name="Dev Student")


async def get_current_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
) -> str:
    """Returns just the user UUID string — backwards compatible."""
    user = await get_current_user_full(request, credentials)
    return user.id


async def get_optional_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
) -> Optional[str]:
    """Same as get_current_user but returns None instead of raising."""
    try:
        return await get_current_user(request, credentials)
    except HTTPException:
        return None
