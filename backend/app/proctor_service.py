"""Proctoring engine: violation scoring and stage termination.

The browser reports raw events (tab switch, no face, paste, ...). This module
owns the rules: how many points each event is worth, when the accumulated
score crosses the threshold, and what happens then ("terminate" the stage or
"flag" the application for manual review). Admin manual termination funnels
through the same `terminate_stage` so both paths behave identically.
"""
from __future__ import annotations

from datetime import datetime, timezone

from .config import (PROCTOR_ACTION, PROCTOR_DEFAULT_POINTS,
                     PROCTOR_MAX_SNAPSHOTS, PROCTOR_POINTS,
                     PROCTOR_TERMINATE_THRESHOLD, UPLOADS_DIR)
from .database import Application, ProctorEvent

STAGES = ("exam", "interview")


def _now():
    return datetime.now(timezone.utc)


def points_for(event_type: str) -> float:
    return float(PROCTOR_POINTS.get(event_type, PROCTOR_DEFAULT_POINTS))


def snapshots_dir(app_id: int):
    d = UPLOADS_DIR / "proctor" / str(app_id)
    d.mkdir(parents=True, exist_ok=True)
    return d


def save_snapshot(app_id: int, stage: str, data: bytes) -> str:
    """Store a webcam frame; keep only the newest PROCTOR_MAX_SNAPSHOTS."""
    d = snapshots_dir(app_id)
    name = f"{stage}_{_now().strftime('%Y%m%d_%H%M%S_%f')}.jpg"
    (d / name).write_bytes(data)
    shots = sorted(d.glob("*.jpg"))
    for old in shots[:-PROCTOR_MAX_SNAPSHOTS]:
        old.unlink(missing_ok=True)
    return name


def list_snapshots(app_id: int) -> list[str]:
    d = UPLOADS_DIR / "proctor" / str(app_id)
    if not d.exists():
        return []
    return sorted((p.name for p in d.glob("*.jpg")), reverse=True)


def record_event(db, app: Application, stage: str, event_type: str,
                 detail: str = "", client_ip: str = "") -> dict:
    """Log one violation, update the stage score, and apply the threshold rule.

    Returns {points, total_score, threshold, action, terminated, message} for
    the client to show a warning or lock the stage.
    """
    pts = points_for(event_type)

    # Server-side network-identity check: if this event's IP differs from the
    # previous event's IP for the same stage, that's a violation of its own.
    extra = []
    if client_ip:
        prev = (db.query(ProctorEvent)
                .filter(ProctorEvent.application_id == app.id,
                        ProctorEvent.stage == stage,
                        ProctorEvent.client_ip != "")
                .order_by(ProctorEvent.id.desc()).first())
        if prev and prev.client_ip and prev.client_ip != client_ip:
            extra.append(ProctorEvent(
                application_id=app.id, stage=stage, type="ip_change",
                detail=f"{prev.client_ip} -> {client_ip}",
                points=points_for("ip_change"), client_ip=client_ip))

    db.add(ProctorEvent(application_id=app.id, stage=stage, type=event_type,
                        detail=detail[:500], points=pts, client_ip=client_ip))
    for e in extra:
        db.add(e)
    db.flush()

    total = stage_score(db, app.id, stage)
    target = app.exam if stage == "exam" else app.interview
    if target is not None:
        target.violation_score = total

    terminated = False
    message = ""
    if total >= PROCTOR_TERMINATE_THRESHOLD and pts > 0:
        if PROCTOR_ACTION == "terminate":
            terminated = terminate_stage(
                db, app, stage,
                reason=f"Violation score {total:.0f} reached the threshold "
                       f"({PROCTOR_TERMINATE_THRESHOLD}). Last event: {event_type}.")
            message = "The session was terminated due to repeated violations."
        else:
            flag(app, f"Violation score {total:.0f} >= threshold "
                      f"({PROCTOR_TERMINATE_THRESHOLD}) during {stage}.")
            message = "Your session has been flagged for manual review."

    db.commit()
    return {
        "points": pts, "total_score": total,
        "threshold": PROCTOR_TERMINATE_THRESHOLD,
        "action": PROCTOR_ACTION, "terminated": terminated, "message": message,
    }


def stage_score(db, app_id: int, stage: str) -> float:
    from sqlalchemy import func
    val = (db.query(func.coalesce(func.sum(ProctorEvent.points), 0.0))
           .filter(ProctorEvent.application_id == app_id,
                   ProctorEvent.stage == stage).scalar())
    return float(val or 0.0)


def flag(app: Application, reason: str):
    app.flagged = True
    app.flag_reason = reason


def terminate_stage(db, app: Application, stage: str, reason: str,
                    by: str = "proctoring") -> bool:
    """End the exam or interview now. Returns True if anything was terminated.

    The candidate's work is preserved (draft answers / transcript) but no score
    is granted automatically: the application is flagged so an admin makes the
    final call. Idempotent — re-terminating an ended stage is a no-op.
    """
    if stage == "exam":
        exam = app.exam
        if not exam or exam.submitted_at or exam.terminated_at:
            return False
        exam.terminated_at = _now()
        # Preserve whatever the candidate had saved for admin review.
        if exam.draft_answers and not (exam.answers and exam.answers != "{}"):
            exam.answers = exam.draft_answers
        app.status = "exam_failed"
    elif stage == "interview":
        iv = app.interview
        if not iv or iv.completed or iv.terminated_at:
            return False
        iv.terminated_at = _now()
        app.status = "interview_completed"
    else:
        return False

    flag(app, reason)
    note = f"[{by}] {stage} terminated: {reason}"
    app.admin_note = f"{app.admin_note}\n{note}".strip() if app.admin_note else note
    return True


def summary(db, app: Application) -> dict:
    events = (db.query(ProctorEvent)
              .filter(ProctorEvent.application_id == app.id)
              .order_by(ProctorEvent.id.desc()).all())
    return {
        "threshold": PROCTOR_TERMINATE_THRESHOLD,
        "action": PROCTOR_ACTION,
        "exam_score": stage_score(db, app.id, "exam"),
        "interview_score": stage_score(db, app.id, "interview"),
        "flagged": bool(app.flagged),
        "flag_reason": app.flag_reason,
        "exam_terminated": bool(app.exam and app.exam.terminated_at),
        "interview_terminated": bool(app.interview and app.interview.terminated_at),
        "events": [e.to_dict() for e in events],
        "snapshots": list_snapshots(app.id),
    }
