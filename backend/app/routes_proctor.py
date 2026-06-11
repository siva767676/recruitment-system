"""Candidate-side proctoring endpoints.

The exam and interview pages report violations and periodic webcam snapshots
here. Scoring/termination rules live in proctor_service; this layer only
authenticates, validates ownership, and relays.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from . import proctor_service
from .auth import current_user
from .database import Application, User, get_db

router = APIRouter(prefix="/api/candidate/applications/{app_id}/proctor",
                   tags=["proctor"])

MAX_SNAPSHOT_BYTES = 500_000  # ~0.5 MB; frames are small JPEGs


def _owned_app(db: Session, app_id: int, user: User) -> Application:
    app = db.query(Application).get(app_id)
    if not app or app.user_id != user.id:
        raise HTTPException(404, "Application not found.")
    return app


class EventIn(BaseModel):
    stage: str           # "exam" | "interview"
    type: str            # tab_switch, no_face, paste, ...
    detail: str = ""


@router.post("/event")
def log_event(app_id: int, payload: EventIn, request: Request,
              db: Session = Depends(get_db), user: User = Depends(current_user)):
    app = _owned_app(db, app_id, user)
    if payload.stage not in proctor_service.STAGES:
        raise HTTPException(400, "Invalid stage.")
    client_ip = request.client.host if request.client else ""
    return proctor_service.record_event(
        db, app, payload.stage, payload.type, payload.detail, client_ip)


@router.post("/snapshot")
async def upload_snapshot(app_id: int, stage: str = Form(...),
                          frame: UploadFile = File(...),
                          db: Session = Depends(get_db),
                          user: User = Depends(current_user)):
    app = _owned_app(db, app_id, user)
    if stage not in proctor_service.STAGES:
        raise HTTPException(400, "Invalid stage.")
    data = await frame.read()
    if not data:
        raise HTTPException(400, "Empty snapshot.")
    if len(data) > MAX_SNAPSHOT_BYTES:
        raise HTTPException(413, "Snapshot too large.")
    name = proctor_service.save_snapshot(app.id, stage, data)
    return {"saved": name}
