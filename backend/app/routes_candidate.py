"""Candidate workflow endpoints: browse jobs, apply (upload + auto-screen),
take the assessment, and conduct the AI interview."""
from __future__ import annotations

import json
from datetime import datetime, timezone

from fastapi import (APIRouter, Depends, File, Form, HTTPException, UploadFile)
from pydantic import BaseModel
from sqlalchemy.orm import Session

from . import exam_service, interview_service, pipeline
from .auth import current_user
from .config import UPLOADS_DIR
from .database import (Application, Exam, InterviewSession, Job, User, get_db)
from .extractor import clean_text, extract_text_from_bytes
from .llm import LLMUnavailable, check_server as check_model

router = APIRouter(prefix="/api/candidate", tags=["candidate"])


def _now():
    return datetime.now(timezone.utc)


# ----------------------------------------------------------------- jobs
@router.get("/jobs")
def list_jobs(db: Session = Depends(get_db), user: User = Depends(current_user)):
    jobs = db.query(Job).filter(Job.published == True).order_by(Job.id.desc()).all()  # noqa: E712
    applied = {a.job_id: a.status for a in
               db.query(Application).filter(Application.user_id == user.id).all()}
    out = []
    for j in jobs:
        d = j.to_dict()
        d["applied"] = j.id in applied
        d["application_status"] = applied.get(j.id)
        out.append(d)
    return out


@router.get("/applications")
def my_applications(db: Session = Depends(get_db), user: User = Depends(current_user)):
    apps = (db.query(Application).filter(Application.user_id == user.id)
            .order_by(Application.id.desc()).all())
    return [a.to_dict(deep=True) for a in apps]


@router.get("/applications/{app_id}")
def get_application(app_id: int, db: Session = Depends(get_db),
                    user: User = Depends(current_user)):
    app = _owned_app(db, app_id, user)
    return app.to_dict(deep=True)


def _owned_app(db: Session, app_id: int, user: User) -> Application:
    app = db.query(Application).get(app_id)
    if not app or app.user_id != user.id:
        raise HTTPException(404, "Application not found.")
    return app


# ----------------------------------------------------------------- apply
@router.post("/jobs/{job_id}/apply")
async def apply(job_id: int, resume: UploadFile = File(...),
                db: Session = Depends(get_db), user: User = Depends(current_user)):
    job = db.query(Job).get(job_id)
    if not job or not job.published:
        raise HTTPException(404, "Job not found or not open.")
    if db.query(Application).filter(Application.user_id == user.id,
                                    Application.job_id == job_id).first():
        raise HTTPException(409, "You have already applied to this job.")

    raw = await resume.read()
    fname = resume.filename or "resume"
    try:
        text = clean_text(extract_text_from_bytes(fname, raw))
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(400, f"Could not read resume: {exc}") from exc
    if not text.strip():
        raise HTTPException(400, "No readable text found in the resume.")

    safe = f"{user.id}_{job_id}_{fname}".replace("/", "_").replace("\\", "_")
    (UPLOADS_DIR / safe).write_bytes(raw)

    app = Application(user_id=user.id, job_id=job_id, status="screening",
                      resume_filename=fname, resume_path=safe, resume_text=text)
    db.add(app)
    db.flush()

    # Automatic resume screening + shortlisting.
    result = pipeline.run_screening(app, job)
    db.commit()
    db.refresh(app)
    return {"application": app.to_dict(deep=True), "screening": result}


# ----------------------------------------------------------------- exam
@router.post("/applications/{app_id}/exam/start")
def start_exam(app_id: int, db: Session = Depends(get_db),
               user: User = Depends(current_user)):
    app = _owned_app(db, app_id, user)
    if app.status not in ("shortlisted", "exam_in_progress"):
        raise HTTPException(400, "Assessment is not available at your current stage.")
    if app.exam and app.exam.submitted_at:
        raise HTTPException(409, "You have already submitted this assessment.")

    if app.exam is None:
        exam_model = exam_service.generate_exam(
            resume_text=app.resume_text or "", job_title=app.job.title,
            job_description=app.job.description)
        questions = exam_service.exam_to_question_list(exam_model)
        exam = Exam(application_id=app.id, questions=json.dumps(questions))
        db.add(exam)
        app.status = "exam_in_progress"
        db.commit()
        db.refresh(exam)
    else:
        exam = app.exam
    return exam.to_dict(with_questions=True)


class ExamSubmission(BaseModel):
    answers: dict  # {"0": 2, "1": "free text", ...}


@router.post("/applications/{app_id}/exam/submit")
def submit_exam(app_id: int, payload: ExamSubmission,
                db: Session = Depends(get_db), user: User = Depends(current_user)):
    app = _owned_app(db, app_id, user)
    if not app.exam:
        raise HTTPException(400, "No assessment has been started.")
    if app.exam.submitted_at:
        raise HTTPException(409, "Assessment already submitted.")

    questions = json.loads(app.exam.questions or "[]")
    result = exam_service.evaluate_exam(questions, payload.answers or {})
    app.exam.answers = json.dumps(payload.answers or {})
    app.exam.score = result["score"]
    app.exam.max_score = result["max_score"]
    app.exam.evaluation = json.dumps(result["per_question"])
    app.exam.submitted_at = _now()
    app.status = "exam_completed"
    pipeline.apply_exam_result(app, app.job, result["score"])
    db.commit()
    db.refresh(app)
    return {"score": result["score"], "status": app.status,
            "passed": app.status == "exam_passed",
            "application": app.to_dict(deep=True)}


# ----------------------------------------------------------------- interview
def _assessment_summary(app: Application) -> str:
    if not app.exam or app.exam.score is None:
        return ""
    return (f"Assessment score: {app.exam.score}/100. "
            f"Resume screening score: {app.screening_score}/100.")


def _restart_interview(db: Session, app: Application, user: User) -> dict:
    """Plan a fresh interview for the application and persist a new session.

    Drops any prior (orphaned) session first — its in-memory checkpoint either
    never existed or died with the last backend restart. Shared by the start
    route and the answer route's lost-checkpoint recovery.
    """
    if app.interview and app.interview.thread_id:
        db.delete(app.interview)
        db.flush()
    started = interview_service.start_interview(
        candidate_name=user.name, role=app.job.title,
        experience_level="mid", resume_text=app.resume_text or "",
        job_description=app.job.description,
        assessment_summary=_assessment_summary(app), max_questions=5)
    session = InterviewSession(application_id=app.id,
                               thread_id=started["thread_id"], transcript="[]")
    db.add(session)
    app.status = "interview_in_progress"
    db.commit()
    return started


@router.post("/applications/{app_id}/interview/start")
def start_interview(app_id: int, db: Session = Depends(get_db),
                    user: User = Depends(current_user)):
    app = _owned_app(db, app_id, user)
    if app.status not in ("exam_passed", "interview_in_progress"):
        raise HTTPException(400, "The interview is not available at your current stage.")
    if app.interview and app.interview.completed:
        raise HTTPException(409, "Your interview is already complete.")

    # Pre-flight: fail fast and clearly if the model server is down, rather than
    # letting a raw provider error surface from inside the LangGraph node.
    try:
        check_model()
    except LLMUnavailable as exc:
        raise HTTPException(502, f"AI interviewer is unavailable: {exc}") from exc

    try:
        started = _restart_interview(db, app, user)
    except Exception as exc:  # noqa: BLE001 -> any planning failure is a 502
        raise HTTPException(502, f"AI interviewer is unavailable: {exc}") from exc

    return {"thread_id": started["thread_id"], "question": started["question"],
            "role": app.job.title, "candidate_name": user.name}


class AnswerRequest(BaseModel):
    thread_id: str
    answer: str = ""


@router.post("/applications/{app_id}/interview/answer")
def interview_answer(app_id: int, payload: AnswerRequest,
                     db: Session = Depends(get_db), user: User = Depends(current_user)):
    app = _owned_app(db, app_id, user)
    if not app.interview:
        raise HTTPException(404, "Interview session not found.")
    # The client's thread_id can lag the DB if the interview was (re)started
    # concurrently — e.g. a double-mounted start effect. The application owns at
    # most one live session, so drive the answer through the current row's
    # thread rather than rejecting a stale-but-honest request.
    thread_id = app.interview.thread_id

    try:
        result = interview_service.submit_answer(thread_id, payload.answer)
    except interview_service.InterviewExpired:
        # The in-memory checkpoint for this thread is gone (backend restarted).
        # Rebuild a fresh interview so the candidate can carry on instead of
        # getting stuck — and tell the client to reload with the new question.
        restarted = _restart_interview(db, app, user)
        return {"last_turn": None, "question": restarted["question"],
                "done": False, "report": None, "status": app.status,
                "restarted": True, "thread_id": restarted["thread_id"]}
    except Exception as exc:  # noqa: BLE001 -> any evaluation failure is a 502
        raise HTTPException(502, f"AI interviewer is unavailable: {exc}") from exc

    app.interview.transcript = json.dumps(result["transcript"])
    if result["done"] and result["report"]:
        report = result["report"]
        app.interview.report = json.dumps(report)
        app.interview.completed = True
        app.interview.completed_at = _now()
        pipeline.apply_interview_result(app, app.job, report.get("overall_score", 0))
    db.commit()
    return {"last_turn": result["last_turn"], "question": result["question"],
            "done": result["done"],
            "report": result["report"] if result["done"] else None,
            "status": app.status}
