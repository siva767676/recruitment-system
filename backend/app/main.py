"""Unified Recruitment Management System — FastAPI application entrypoint.

One backend serves the whole pipeline:
  auth  ->  candidate workflow (apply / screen / exam / interview)  ->  admin dashboard
"""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import llm
from .database import init_db
from .routes_admin import router as admin_router
from .routes_auth import router as auth_router
from .routes_candidate import router as candidate_router
from .scoring import embeddings_available
from .seed import seed_jobs

app = FastAPI(title="Recruitment Management System", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(candidate_router)
app.include_router(admin_router)


@app.on_event("startup")
def _startup():
    init_db()
    created = seed_jobs()
    if created:
        print(f"[seed] created {created} starter job postings from the JD library")


@app.get("/api/health")
def health():
    """Liveness + a quick view of optional-subsystem availability."""
    llm_detail = llm.settings()
    try:
        llm.check_server(timeout=2)
        llm_ok = True
    except Exception as exc:  # noqa: BLE001
        llm_ok = False
        llm_detail = {**llm_detail, "error": str(exc)}
    return {
        "status": "ok",
        "llm_reachable": llm_ok,
        "llm": llm_detail,
        "embeddings": embeddings_available(),
    }
