"""Offline smoke test for the recruitment pipeline (no running server, no LLM).

Verifies the engine pieces that don't require the model server:
  resume parsing -> JD parsing -> screening score -> fallback exam -> grading.

Run:  .venv/Scripts/python.exe smoke_test.py
"""
from __future__ import annotations

from app.exam_service import (evaluate_exam, exam_to_question_list,
                              _fallback_exam)
from app.parser import parse_jd, parse_resume
from app.scoring import embeddings_available, score_resume

JD = """Backend Python Engineer.
Required skills: Python, FastAPI, SQL, Docker, AWS. 3 years experience.
Good to have: Kubernetes, Redis."""

RESUME = """Senior Backend Engineer, 5 years experience.
Skilled in Python, FastAPI, PostgreSQL, Docker, AWS, Redis, REST API, CI/CD.
B.Tech in Computer Science."""


def main() -> None:
    print(f"embeddings available: {embeddings_available()} "
          f"(False -> keyword-overlap fallback in use)")

    jd = parse_jd(JD)
    resume = parse_resume(RESUME)
    result = score_resume(resume, RESUME, jd, JD)
    print(f"screening overall score: {result['overall_score']}")
    print(f"  matched skills: {result['matched_skills']}")
    print(f"  missing skills: {result['missing_skills']}")
    assert 0 <= result["overall_score"] <= 100

    exam = _fallback_exam(resume["skills"])
    questions = exam_to_question_list(exam)
    print(f"generated exam questions: {len(questions)}")
    assert questions, "exam generation produced no questions"

    # Answer every MCQ correctly; give a real short answer.
    answers = {}
    for i, q in enumerate(questions):
        if q["type"] == "mcq":
            answers[str(i)] = q["correct_index"]
        else:
            answers[str(i)] = "I built a production service using this skill with measurable impact."
    graded = evaluate_exam(questions, answers)
    print(f"exam score (all-correct answers): {graded['score']}/100")
    assert graded["score"] > 0

    print("\nSMOKE TEST PASSED")


if __name__ == "__main__":
    main()
