"""Seed initial published jobs from the markdown JD library on first run."""
from __future__ import annotations

import json

from .config import JDS_DIR
from .database import Job, SessionLocal
from .parser import extract_experience_years, parse_jd


def _title_from_md(text: str, fallback: str) -> str:
    for line in text.splitlines():
        t = line.strip().lstrip("#").strip()
        if t:
            return t
    return fallback


def seed_jobs() -> int:
    """Create one published Job per JD file if the jobs table is empty."""
    db = SessionLocal()
    try:
        if db.query(Job).count() > 0:
            return 0
        created = 0
        if not JDS_DIR.exists():
            return 0
        for path in sorted(JDS_DIR.iterdir()):
            if path.suffix.lower() not in (".md", ".txt", ".markdown"):
                continue
            text = path.read_text(encoding="utf-8", errors="ignore").strip()
            if not text:
                continue
            title = _title_from_md(text, path.stem.replace("_", " ").title())
            parsed = parse_jd(text)
            job = Job(
                title=title,
                department="Engineering",
                location="Remote / Hybrid",
                description=text,
                required_skills=json.dumps(parsed["required_skills"]),
                experience_required=extract_experience_years(text),
                published=True,
            )
            db.add(job)
            created += 1
        db.commit()
        return created
    finally:
        db.close()
