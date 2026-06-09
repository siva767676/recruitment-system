"""Recruitment pipeline orchestration: screening + stage transitions.

Centralizes the automated decisions (screen -> shortlist -> exam -> interview ->
select) so both the candidate routes and the admin routes apply identical rules.
Every transition respects per-job cutoffs with global defaults as the fallback.
"""
from __future__ import annotations

import json

from .config import (DEFAULT_EXAM_CUTOFF, DEFAULT_INTERVIEW_CUTOFF,
                     DEFAULT_SCREENING_CUTOFF)
from .database import Application, Job
from .extractor import clean_text
from .parser import parse_jd, parse_resume
from .scoring import score_resume


def screening_cutoff(job: Job) -> float:
    return job.screening_cutoff if job.screening_cutoff is not None else DEFAULT_SCREENING_CUTOFF


def exam_cutoff(job: Job) -> float:
    return job.exam_cutoff if job.exam_cutoff is not None else DEFAULT_EXAM_CUTOFF


def interview_cutoff(job: Job) -> float:
    return job.interview_cutoff if job.interview_cutoff is not None else DEFAULT_INTERVIEW_CUTOFF


def run_screening(app: Application, job: Job) -> dict:
    """Score the application's resume against the job JD and set the next status."""
    jd_text = clean_text(job.description)
    jd_parsed = parse_jd(
        jd_text,
        override_skills=json.loads(job.required_skills or "[]") or None,
        override_experience=job.experience_required or None,
    )
    resume_text = clean_text(app.resume_text or "")
    resume_parsed = parse_resume(resume_text)
    result = score_resume(resume_parsed, resume_text, jd_parsed, jd_text)

    app.screening_score = result["overall_score"]
    app.screening_details = json.dumps(result)

    if not app.manual_override:
        if result["overall_score"] >= screening_cutoff(job):
            app.status = "shortlisted"
        else:
            app.status = "screen_rejected"
    return result


def apply_exam_result(app: Application, job: Job, score: float) -> str:
    app.exam_score = score
    if not app.manual_override:
        app.status = "exam_passed" if score >= exam_cutoff(job) else "exam_failed"
    else:
        app.status = "exam_completed"
    return app.status


def apply_interview_result(app: Application, job: Job, score: float) -> str:
    app.interview_score = score
    if not app.manual_override:
        app.status = "selected" if score >= interview_cutoff(job) else "rejected"
    else:
        app.status = "interview_completed"
    return app.status
