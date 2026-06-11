"""Admin dashboard endpoints: full control over the recruitment process."""
from __future__ import annotations

import json
from collections import Counter

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, PlainTextResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from . import pipeline, proctor_service
from .auth import require_admin
from .config import UPLOADS_DIR
from .database import (STATUSES, Application, InterviewSession, Job, User,
                       get_db)

router = APIRouter(prefix="/api/admin", tags=["admin"],
                   dependencies=[Depends(require_admin)])


# ----------------------------------------------------------------- jobs / JD CRUD
class JobInput(BaseModel):
    title: str
    department: str | None = None
    location: str | None = None
    description: str
    required_skills: list[str] = []
    experience_required: float = 0.0
    published: bool = False
    screening_cutoff: float | None = None
    exam_cutoff: float | None = None
    interview_cutoff: float | None = None


@router.get("/jobs")
def list_jobs(db: Session = Depends(get_db)):
    return [j.to_dict(with_counts=True)
            for j in db.query(Job).order_by(Job.id.desc()).all()]


@router.post("/jobs")
def create_job(body: JobInput, db: Session = Depends(get_db)):
    job = Job(title=body.title, department=body.department, location=body.location,
              description=body.description,
              required_skills=json.dumps([s.lower() for s in body.required_skills]),
              experience_required=body.experience_required, published=body.published,
              screening_cutoff=body.screening_cutoff, exam_cutoff=body.exam_cutoff,
              interview_cutoff=body.interview_cutoff)
    db.add(job)
    db.commit()
    db.refresh(job)
    return job.to_dict(with_counts=True)


@router.put("/jobs/{job_id}")
def update_job(job_id: int, body: JobInput, db: Session = Depends(get_db)):
    job = db.query(Job).get(job_id)
    if not job:
        raise HTTPException(404, "Job not found.")
    job.title = body.title
    job.department = body.department
    job.location = body.location
    job.description = body.description
    job.required_skills = json.dumps([s.lower() for s in body.required_skills])
    job.experience_required = body.experience_required
    job.published = body.published
    job.screening_cutoff = body.screening_cutoff
    job.exam_cutoff = body.exam_cutoff
    job.interview_cutoff = body.interview_cutoff
    db.commit()
    db.refresh(job)
    return job.to_dict(with_counts=True)


@router.post("/jobs/{job_id}/publish")
def toggle_publish(job_id: int, db: Session = Depends(get_db)):
    job = db.query(Job).get(job_id)
    if not job:
        raise HTTPException(404, "Job not found.")
    job.published = not job.published
    db.commit()
    return {"id": job.id, "published": job.published}


@router.delete("/jobs/{job_id}")
def delete_job(job_id: int, db: Session = Depends(get_db)):
    job = db.query(Job).get(job_id)
    if not job:
        raise HTTPException(404, "Job not found.")
    db.delete(job)
    db.commit()
    return {"deleted": job_id}


# ----------------------------------------------------------------- candidates
@router.get("/candidates")
def list_candidates(db: Session = Depends(get_db)):
    return [u.to_dict() for u in db.query(User).order_by(User.id.desc()).all()]


# ----------------------------------------------------------------- applications
@router.get("/applications")
def list_applications(job_id: int | None = None, status: str | None = None,
                      db: Session = Depends(get_db)):
    q = db.query(Application)
    if job_id is not None:
        q = q.filter(Application.job_id == job_id)
    if status:
        q = q.filter(Application.status == status)
    apps = q.order_by(Application.id.desc()).all()
    return [a.to_dict() for a in apps]


@router.get("/applications/{app_id}")
def application_detail(app_id: int, db: Session = Depends(get_db)):
    app = db.query(Application).get(app_id)
    if not app:
        raise HTTPException(404, "Application not found.")
    d = app.to_dict(deep=True)
    if app.exam:
        d["exam"] = app.exam.to_dict(with_questions=True, with_answers_key=True)
    return d


@router.get("/applications/{app_id}/resume", response_class=PlainTextResponse)
def view_resume(app_id: int, db: Session = Depends(get_db)):
    app = db.query(Application).get(app_id)
    if not app:
        raise HTTPException(404, "Application not found.")
    return app.resume_text or "(no resume text extracted)"


@router.post("/applications/{app_id}/rescreen")
def rescreen(app_id: int, db: Session = Depends(get_db)):
    app = db.query(Application).get(app_id)
    if not app:
        raise HTTPException(404, "Application not found.")
    result = pipeline.run_screening(app, app.job)
    db.commit()
    db.refresh(app)
    return {"screening": result, "application": app.to_dict()}


class StatusOverride(BaseModel):
    status: str
    note: str | None = None


@router.post("/applications/{app_id}/status")
def override_status(app_id: int, body: StatusOverride, db: Session = Depends(get_db)):
    app = db.query(Application).get(app_id)
    if not app:
        raise HTTPException(404, "Application not found.")
    if body.status not in STATUSES:
        raise HTTPException(400, f"Invalid status. Allowed: {', '.join(STATUSES)}")
    app.status = body.status
    app.manual_override = True
    if body.note is not None:
        app.admin_note = body.note
    db.commit()
    db.refresh(app)
    return app.to_dict()


# ----------------------------------------------------------------- proctoring
@router.get("/applications/{app_id}/proctor")
def proctor_report(app_id: int, db: Session = Depends(get_db)):
    """Violation score, full event timeline, and snapshot list for one candidate."""
    app = db.query(Application).get(app_id)
    if not app:
        raise HTTPException(404, "Application not found.")
    return proctor_service.summary(db, app)


@router.get("/applications/{app_id}/proctor/snapshots/{name}")
def proctor_snapshot(app_id: int, name: str):
    # No path traversal: the name must be exactly a file inside this app's dir.
    if "/" in name or "\\" in name or ".." in name:
        raise HTTPException(400, "Invalid snapshot name.")
    path = UPLOADS_DIR / "proctor" / str(app_id) / name
    if not path.is_file():
        raise HTTPException(404, "Snapshot not found.")
    return FileResponse(path, media_type="image/jpeg")


class TerminateRequest(BaseModel):
    stage: str            # "exam" | "interview"
    reason: str = "Terminated manually by admin."


@router.post("/applications/{app_id}/terminate")
def terminate(app_id: int, body: TerminateRequest, db: Session = Depends(get_db)):
    """Manual termination control — same effect as a threshold breach."""
    app = db.query(Application).get(app_id)
    if not app:
        raise HTTPException(404, "Application not found.")
    if body.stage not in proctor_service.STAGES:
        raise HTTPException(400, "Invalid stage.")
    done = proctor_service.terminate_stage(db, app, body.stage, body.reason, by="admin")
    if not done:
        raise HTTPException(409, f"No active {body.stage} to terminate.")
    db.commit()
    db.refresh(app)
    return {"terminated": body.stage, "application": app.to_dict()}


@router.get("/interviews/{app_id}")
def interview_report(app_id: int, db: Session = Depends(get_db)):
    session = (db.query(InterviewSession)
               .filter(InterviewSession.application_id == app_id).first())
    if not session:
        raise HTTPException(404, "No interview session for this application.")
    return session.to_dict()


# ----------------------------------------------------------------- analytics
@router.get("/analytics")
def analytics(db: Session = Depends(get_db)):
    apps = db.query(Application).all()
    status_counts = Counter(a.status for a in apps)
    jobs = db.query(Job).all()
    per_job = []
    for j in jobs:
        japps = [a for a in apps if a.job_id == j.id]
        per_job.append({
            "job_id": j.id, "title": j.title, "applicants": len(japps),
            "shortlisted": sum(1 for a in japps if a.status not in
                               ("applied", "screening", "screen_rejected")),
            "selected": sum(1 for a in japps if a.status == "selected"),
        })
    scored = [a.screening_score for a in apps if a.screening_score is not None]
    exam_scored = [a.exam_score for a in apps if a.exam_score is not None]
    return {
        "total_candidates": db.query(User).count(),
        "total_jobs": len(jobs),
        "published_jobs": sum(1 for j in jobs if j.published),
        "total_applications": len(apps),
        "status_breakdown": dict(status_counts),
        "avg_screening_score": round(sum(scored) / len(scored), 1) if scored else 0,
        "avg_exam_score": round(sum(exam_scored) / len(exam_scored), 1) if exam_scored else 0,
        "selected": status_counts.get("selected", 0),
        "per_job": per_job,
    }
