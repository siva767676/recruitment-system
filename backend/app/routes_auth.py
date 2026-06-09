"""Authentication endpoints: candidate signup/login + fixed admin login."""
from __future__ import annotations

import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from . import auth
from .database import User, get_db

router = APIRouter(prefix="/api/auth", tags=["auth"])

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _valid_email(v: str) -> str:
    v = (v or "").strip().lower()
    if not _EMAIL_RE.match(v):
        raise ValueError("Enter a valid email address.")
    return v


class SignupRequest(BaseModel):
    name: str = Field(min_length=1)
    email: str
    password: str = Field(min_length=6)
    phone: str | None = None

    @field_validator("email")
    @classmethod
    def _email(cls, v):
        return _valid_email(v)


class LoginRequest(BaseModel):
    email: str
    password: str

    @field_validator("email")
    @classmethod
    def _email(cls, v):
        return _valid_email(v)


class AdminLoginRequest(BaseModel):
    email: str
    password: str


def _token_response(token: str, user: User | None, role: str):
    payload = {"token": token, "role": role}
    if user:
        payload["user"] = {"id": user.id, "name": user.name, "email": user.email}
    else:
        payload["user"] = {"name": "Administrator", "email": "admin"}
    return payload


@router.post("/signup")
def signup(req: SignupRequest, db: Session = Depends(get_db)):
    if db.query(User).filter(User.email == req.email).first():
        raise HTTPException(409, "An account with that email already exists.")
    user = User(name=req.name.strip(), email=req.email,
                password_hash=auth.hash_password(req.password), phone=req.phone)
    db.add(user)
    db.commit()
    db.refresh(user)
    token = auth.create_token(subject=user.id, role="candidate", name=user.name)
    return _token_response(token, user, "candidate")


@router.post("/login")
def login(req: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == req.email).first()
    if not user or not auth.verify_password(req.password, user.password_hash):
        raise HTTPException(401, "Invalid email or password.")
    token = auth.create_token(subject=user.id, role="candidate", name=user.name)
    return _token_response(token, user, "candidate")


@router.post("/admin/login")
def admin_login(req: AdminLoginRequest):
    token = auth.admin_login(req.email, req.password)
    return _token_response(token, None, "admin")


@router.get("/me")
def me(claims: dict = Depends(auth.current_claims)):
    return {"role": claims.get("role"), "name": claims.get("name"),
            "id": claims.get("sub")}
