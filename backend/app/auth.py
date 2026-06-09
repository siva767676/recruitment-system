"""Authentication: candidate signup/login (DB-backed) + fixed admin login (JWT)."""
from __future__ import annotations

import hashlib
import hmac
import os
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from .config import (ADMIN_EMAIL, ADMIN_PASSWORD, JWT_ALGORITHM,
                     JWT_EXPIRE_HOURS, JWT_SECRET)
from .database import User, get_db

bearer = HTTPBearer(auto_error=False)


# ---------------------------------------------------------------- passwords
def hash_password(password: str) -> str:
    """Salted PBKDF2 hash. Stdlib only — no native build needed on Python 3.14."""
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 200_000)
    return f"{salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        salt_hex, dk_hex = stored.split("$", 1)
    except ValueError:
        return False
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), 200_000)
    return hmac.compare_digest(dk.hex(), dk_hex)


# ---------------------------------------------------------------- tokens
def create_token(subject: str, role: str, name: str = "") -> str:
    payload = {
        "sub": str(subject),
        "role": role,            # "candidate" | "admin"
        "name": name,
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRE_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.PyJWTError as exc:
        raise HTTPException(401, f"Invalid or expired token: {exc}") from exc


# ---------------------------------------------------------------- admin login
def admin_login(email: str, password: str) -> str:
    if email.strip().lower() == ADMIN_EMAIL.lower() and password == ADMIN_PASSWORD:
        return create_token(subject="admin", role="admin", name="Administrator")
    raise HTTPException(401, "Invalid admin credentials")


# ---------------------------------------------------------------- dependencies
def _claims(creds: HTTPAuthorizationCredentials | None) -> dict:
    if creds is None or not creds.credentials:
        raise HTTPException(401, "Missing authentication token")
    return decode_token(creds.credentials)


def current_claims(creds: HTTPAuthorizationCredentials | None = Depends(bearer)) -> dict:
    return _claims(creds)


def current_user(creds: HTTPAuthorizationCredentials | None = Depends(bearer),
                 db: Session = Depends(get_db)) -> User:
    claims = _claims(creds)
    if claims.get("role") != "candidate":
        raise HTTPException(403, "Candidate access required")
    user = db.query(User).get(int(claims["sub"]))
    if not user:
        raise HTTPException(401, "User no longer exists")
    return user


def require_admin(creds: HTTPAuthorizationCredentials | None = Depends(bearer)) -> dict:
    claims = _claims(creds)
    if claims.get("role") != "admin":
        raise HTTPException(403, "Admin access required")
    return claims
