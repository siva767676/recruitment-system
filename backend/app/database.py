"""SQLite persistence for the unified Recruitment Management System.

One DB models the whole pipeline:

    User ──< Application >── Job
                  │
                  ├── Exam (questions + answers + score)
                  └── InterviewSession (transcript + report)

`Application.status` is the single source of truth for where a candidate sits in
the workflow; every stage writes its score back onto the Application.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

from sqlalchemy import (Boolean, Column, DateTime, Float, ForeignKey, Integer,
                        String, Text, create_engine, text)
from sqlalchemy.orm import declarative_base, relationship, sessionmaker

from .config import DB_URL

engine = create_engine(DB_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
Base = declarative_base()


def _now():
    return datetime.now(timezone.utc)


# Canonical pipeline stages stored in Application.status
STATUSES = [
    "applied",            # resume uploaded, not yet screened
    "screening",          # being screened
    "screen_rejected",    # below screening cutoff
    "shortlisted",        # passed screening -> exam unlocked
    "exam_in_progress",
    "exam_completed",
    "exam_passed",        # passed exam cutoff -> interview unlocked
    "exam_failed",
    "interview_in_progress",
    "interview_completed",
    "selected",           # final recommendation: hire
    "rejected",           # final / manual reject
]


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    email = Column(String, unique=True, nullable=False, index=True)
    password_hash = Column(String, nullable=False)
    phone = Column(String)
    created_at = Column(DateTime, default=_now)

    applications = relationship("Application", back_populates="user",
                                cascade="all, delete-orphan")

    def to_dict(self):
        return {"id": self.id, "name": self.name, "email": self.email,
                "phone": self.phone,
                "created_at": self.created_at.isoformat() if self.created_at else None,
                "applications": len(self.applications)}


class Job(Base):
    __tablename__ = "jobs"

    id = Column(Integer, primary_key=True)
    title = Column(String, nullable=False)
    department = Column(String)
    location = Column(String)
    description = Column(Text, nullable=False)          # the full JD text
    required_skills = Column(Text, default="[]")        # JSON list (admin-editable)
    experience_required = Column(Float, default=0.0)
    published = Column(Boolean, default=False)
    screening_cutoff = Column(Float)
    exam_cutoff = Column(Float)
    interview_cutoff = Column(Float)
    created_at = Column(DateTime, default=_now)

    applications = relationship("Application", back_populates="job",
                                cascade="all, delete-orphan")

    def to_dict(self, with_counts=False):
        d = {
            "id": self.id, "title": self.title, "department": self.department,
            "location": self.location, "description": self.description,
            "required_skills": json.loads(self.required_skills or "[]"),
            "experience_required": self.experience_required,
            "published": self.published,
            "screening_cutoff": self.screening_cutoff,
            "exam_cutoff": self.exam_cutoff,
            "interview_cutoff": self.interview_cutoff,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
        if with_counts:
            d["applicant_count"] = len(self.applications)
        return d


class Application(Base):
    __tablename__ = "applications"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    job_id = Column(Integer, ForeignKey("jobs.id"), nullable=False)
    status = Column(String, default="applied")

    resume_filename = Column(String)
    resume_path = Column(String)
    resume_text = Column(Text)

    # Stage scores (0-100)
    screening_score = Column(Float)
    screening_details = Column(Text)     # JSON breakdown from the scoring engine
    exam_score = Column(Float)
    interview_score = Column(Float)

    admin_note = Column(Text)
    manual_override = Column(Boolean, default=False)
    # Proctoring outcome: flagged applications passed a violation threshold (or
    # were flagged by an admin) and need manual review before any final decision.
    flagged = Column(Boolean, default=False)
    flag_reason = Column(Text)
    created_at = Column(DateTime, default=_now)
    updated_at = Column(DateTime, default=_now, onupdate=_now)

    user = relationship("User", back_populates="applications")
    job = relationship("Job", back_populates="applications")
    exam = relationship("Exam", back_populates="application", uselist=False,
                        cascade="all, delete-orphan")
    interview = relationship("InterviewSession", back_populates="application",
                             uselist=False, cascade="all, delete-orphan")

    def to_dict(self, deep=False):
        d = {
            "id": self.id, "user_id": self.user_id, "job_id": self.job_id,
            "status": self.status,
            "resume_filename": self.resume_filename,
            "screening_score": self.screening_score,
            "screening_details": json.loads(self.screening_details or "{}"),
            "exam_score": self.exam_score,
            "interview_score": self.interview_score,
            "admin_note": self.admin_note,
            "manual_override": self.manual_override,
            "flagged": bool(self.flagged),
            "flag_reason": self.flag_reason,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
        if self.user:
            d["candidate_name"] = self.user.name
            d["candidate_email"] = self.user.email
        if self.job:
            d["job_title"] = self.job.title
        if deep:
            d["exam"] = self.exam.to_dict(with_questions=True) if self.exam else None
            d["interview"] = self.interview.to_dict() if self.interview else None
        return d


class Exam(Base):
    __tablename__ = "exams"

    id = Column(Integer, primary_key=True)
    application_id = Column(Integer, ForeignKey("applications.id"), nullable=False)
    questions = Column(Text, default="[]")    # JSON list of question objects
    answers = Column(Text, default="{}")       # JSON {question_index: answer}
    draft_answers = Column(Text)               # JSON autosave; recovers after reload
    duration_seconds = Column(Integer)         # exam time limit; server-enforced
    violation_score = Column(Float, default=0.0)
    terminated_at = Column(DateTime)           # set when proctoring ends the exam
    score = Column(Float)
    max_score = Column(Float)
    evaluation = Column(Text)                  # JSON per-question evaluation
    started_at = Column(DateTime, default=_now)
    submitted_at = Column(DateTime)

    application = relationship("Application", back_populates="exam")

    def to_dict(self, with_questions=False, with_answers_key=False):
        d = {
            "id": self.id, "application_id": self.application_id,
            "score": self.score, "max_score": self.max_score,
            "submitted": self.submitted_at is not None,
            "duration_seconds": self.duration_seconds,
            "violation_score": self.violation_score or 0,
            "terminated": self.terminated_at is not None,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "submitted_at": self.submitted_at.isoformat() if self.submitted_at else None,
        }
        qs = json.loads(self.questions or "[]")
        if with_questions:
            # Candidate-facing: strip correct answers / explanations.
            if not with_answers_key:
                d["questions"] = [
                    {k: v for k, v in q.items()
                     if k not in ("correct_answer", "correct_index", "explanation",
                                  "expected_points")}
                    for q in qs
                ]
            else:
                d["questions"] = qs
                d["answers"] = json.loads(self.answers or "{}")
                d["evaluation"] = json.loads(self.evaluation or "[]")
        d["question_count"] = len(qs)
        return d


class InterviewSession(Base):
    __tablename__ = "interview_sessions"

    id = Column(Integer, primary_key=True)
    application_id = Column(Integer, ForeignKey("applications.id"), nullable=False)
    thread_id = Column(String, index=True)     # LangGraph checkpoint thread
    transcript = Column(Text, default="[]")    # JSON list of Q/A/eval turns
    report = Column(Text)                       # JSON FinalReport
    completed = Column(Boolean, default=False)
    violation_score = Column(Float, default=0.0)
    terminated_at = Column(DateTime)           # set when proctoring ends the interview
    started_at = Column(DateTime, default=_now)
    completed_at = Column(DateTime)

    application = relationship("Application", back_populates="interview")

    def to_dict(self):
        return {
            "id": self.id, "application_id": self.application_id,
            "thread_id": self.thread_id,
            "transcript": json.loads(self.transcript or "[]"),
            "report": json.loads(self.report) if self.report else None,
            "completed": self.completed,
            "violation_score": self.violation_score or 0,
            "terminated": self.terminated_at is not None,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
        }


class ProctorEvent(Base):
    """One proctoring violation/observation during an exam or interview.

    The browser reports raw events; the server assigns points from
    config.PROCTOR_POINTS so scoring can't be tampered with client-side.
    """
    __tablename__ = "proctor_events"

    id = Column(Integer, primary_key=True)
    application_id = Column(Integer, ForeignKey("applications.id"),
                            nullable=False, index=True)
    stage = Column(String, nullable=False)     # "exam" | "interview"
    type = Column(String, nullable=False)      # tab_switch, no_face, ...
    detail = Column(Text)
    points = Column(Float, default=0.0)
    client_ip = Column(String)
    created_at = Column(DateTime, default=_now)

    def to_dict(self):
        return {
            "id": self.id, "application_id": self.application_id,
            "stage": self.stage, "type": self.type, "detail": self.detail,
            "points": self.points, "client_ip": self.client_ip,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


# Columns added after the first release. create_all() doesn't alter existing
# tables, and the SQLite file persists on a Docker volume, so new columns are
# applied with ALTER TABLE when missing.
_SCHEMA_UPGRADES = {
    "applications": {
        "flagged": "BOOLEAN DEFAULT 0",
        "flag_reason": "TEXT",
    },
    "exams": {
        "draft_answers": "TEXT",
        "duration_seconds": "INTEGER",
        "violation_score": "FLOAT DEFAULT 0",
        "terminated_at": "DATETIME",
    },
    "interview_sessions": {
        "violation_score": "FLOAT DEFAULT 0",
        "terminated_at": "DATETIME",
    },
}


def _migrate():
    with engine.connect() as conn:
        for table, cols in _SCHEMA_UPGRADES.items():
            rows = conn.execute(text(f"PRAGMA table_info({table})")).fetchall()
            if not rows:
                continue  # table doesn't exist yet; create_all will build it complete
            existing = {r[1] for r in rows}
            for col, ddl in cols.items():
                if col not in existing:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {ddl}"))
        conn.commit()


def init_db():
    Base.metadata.create_all(engine)
    _migrate()


def get_db():
    """FastAPI dependency that yields a session and always closes it."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
