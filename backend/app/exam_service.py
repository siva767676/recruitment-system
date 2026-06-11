"""Dynamic online assessment: question generation + automatic evaluation.

Questions are generated from three sources, per the requirement:
  1. the candidate's resume,
  2. technical content from the Job Description,
  3. standard aptitude / domain questions.

MCQ questions are auto-graded deterministically. Short-answer questions are
graded by the LLM. If the LLM is unavailable, we fall back to a small static
aptitude bank so the assessment portal still functions end-to-end.
"""
from __future__ import annotations

from typing import List, Literal

from pydantic import BaseModel, Field

from . import llm
from .parser import parse_resume


class MCQ(BaseModel):
    type: Literal["mcq"] = "mcq"
    source: Literal["resume", "jd", "aptitude"]
    difficulty: Literal["easy", "medium", "hard"] = "medium"
    topic: str
    question: str
    options: List[str] = Field(min_length=2, max_length=6)
    correct_index: int = Field(ge=0, description="Index into options")
    explanation: str = ""


class ShortAnswer(BaseModel):
    type: Literal["short"] = "short"
    source: Literal["resume", "jd", "aptitude"]
    difficulty: Literal["easy", "medium", "hard"] = "medium"
    topic: str
    question: str
    expected_points: List[str] = Field(default_factory=list)


class GeneratedExam(BaseModel):
    mcqs: List[MCQ] = Field(default_factory=list)
    short_answers: List[ShortAnswer] = Field(default_factory=list)


class ShortAnswerGrade(BaseModel):
    score: int = Field(ge=0, le=10)
    feedback: str = ""


# ----------------------------------------------------------------- fallback bank
_FALLBACK_APTITUDE = [
    {"type": "mcq", "source": "aptitude", "topic": "Logical reasoning",
     "question": "If all Bloops are Razzies and all Razzies are Lazzies, then all Bloops are definitely:",
     "options": ["Lazzies", "Not Lazzies", "Sometimes Lazzies", "Cannot be determined"],
     "correct_index": 0, "explanation": "Transitive relation."},
    {"type": "mcq", "source": "aptitude", "topic": "Numerical ability",
     "question": "A train travels 60 km in 45 minutes. Its speed in km/h is:",
     "options": ["75", "80", "90", "60"], "correct_index": 1,
     "explanation": "60 km / 0.75 h = 80 km/h."},
    {"type": "mcq", "source": "aptitude", "topic": "Series",
     "question": "What comes next: 2, 6, 12, 20, 30, ?",
     "options": ["36", "40", "42", "44"], "correct_index": 2,
     "explanation": "Differences 4,6,8,10,12 -> 30+12=42."},
    {"type": "mcq", "source": "aptitude", "topic": "Verbal",
     "question": "Choose the word most similar to 'Diligent':",
     "options": ["Lazy", "Hardworking", "Careless", "Slow"], "correct_index": 1,
     "explanation": "Diligent means hardworking."},
]


def _fallback_exam(resume_skills: List[str]) -> GeneratedExam:
    mcqs = [MCQ(**q) for q in _FALLBACK_APTITUDE]
    shorts = []
    for sk in resume_skills[:2]:
        shorts.append(ShortAnswer(
            source="resume", topic=sk,
            question=f"Describe a project where you applied {sk}. What problem did it solve?",
            expected_points=[f"concrete use of {sk}", "impact/outcome"]))
    return GeneratedExam(mcqs=mcqs, short_answers=shorts)


# Fairness blueprint: every candidate gets DIFFERENT questions but the SAME
# structure — identical source mix, difficulty distribution, and grading
# rubric — so scores are comparable across candidates.
_MCQ_BLUEPRINT = "2 from 'resume', 2 from 'jd', 2 from 'aptitude'"
_DIFFICULTY_BLUEPRINT = "2 easy, 3 medium, 1 hard (spread across sources)"


def generate_exam(*, resume_text: str, job_title: str, job_description: str,
                  num_mcq: int = 6, num_short: int = 2) -> GeneratedExam:
    """Generate a tailored assessment. LLM-backed with a deterministic fallback."""
    resume_skills = parse_resume(resume_text)["skills"]
    try:
        model = llm.structured(GeneratedExam, temperature=0.5)
        prompt = f"""You are an assessment designer creating an online screening test.
All candidates for this role must receive an EQUIVALENT test: unique questions,
but the exact same structure, difficulty mix, and grading standard below.

Role: {job_title}
Job description:
{llm.clip(job_description, 4000)}

Candidate resume:
{llm.clip(resume_text, 6000)}

Create exactly {num_mcq} multiple-choice questions and {num_short} short-answer questions.

MCQ blueprint (mandatory):
- Sources: {_MCQ_BLUEPRINT}.
  - "resume": probe a skill/project the candidate actually claims.
  - "jd": test technical knowledge the job requires.
  - "aptitude": standard logical / numerical / verbal reasoning.
- Difficulty: {_DIFFICULTY_BLUEPRINT}. Label each question's difficulty honestly:
  easy = recall/definition, medium = application, hard = multi-step reasoning.
- Each MCQ must have exactly 4 plausible options and exactly one correct option
  (correct_index points to it). Make distractors realistic.

Short-answer blueprint (mandatory):
- {num_short} questions, both difficulty "medium": one grounded in the resume,
  one grounded in the JD.
- Answerable in a few sentences; list 2-3 expected_points capturing the facts a
  complete answer must mention. Graders score ONLY against expected_points, so
  make them objective and verifiable, not stylistic.

Keep every question unambiguous, self-contained, and free of trick wording."""
        exam = model.invoke(prompt)
        exam = _normalize_exam(exam, num_mcq, num_short)
        # Guard against an empty generation.
        if exam.mcqs:
            return exam
    except llm.LLMUnavailable:
        pass
    except Exception:  # noqa: BLE001 -> any LLM hiccup falls back
        pass
    return _fallback_exam(resume_skills)


def _normalize_exam(exam: GeneratedExam, num_mcq: int, num_short: int) -> GeneratedExam:
    """Enforce the blueprint server-side: drop malformed questions, clamp counts.

    The structured-output schema guarantees shape, but not semantics — a
    correct_index can still point outside the options list. Anything invalid is
    dropped rather than shown to a candidate.
    """
    mcqs = [q for q in exam.mcqs
            if len(q.options) >= 2 and 0 <= q.correct_index < len(q.options)]
    shorts = list(exam.short_answers)
    return GeneratedExam(mcqs=mcqs[:num_mcq], short_answers=shorts[:num_short])


def exam_to_question_list(exam: GeneratedExam) -> List[dict]:
    """Flatten into the storage/transport shape (one numbered list)."""
    out: List[dict] = []
    for q in exam.mcqs:
        out.append(q.model_dump())
    for q in exam.short_answers:
        out.append(q.model_dump())
    return out


def evaluate_exam(questions: List[dict], answers: dict) -> dict:
    """Auto-grade. MCQs are exact-match; short answers graded by the LLM (0-10).

    `answers` maps str(question_index) -> answer. For MCQs the answer is the
    chosen option index (as str or int); for short answers it's free text.
    Returns {score (0-100), max_score, per_question:[...]}.
    """
    per_question = []
    earned = 0.0
    total = 0.0

    for idx, q in enumerate(questions):
        ans = answers.get(str(idx), answers.get(idx))
        if q.get("type") == "mcq":
            total += 1.0
            try:
                chosen = int(ans)
            except (TypeError, ValueError):
                chosen = -1
            correct = chosen == q.get("correct_index")
            earned += 1.0 if correct else 0.0
            per_question.append({
                "index": idx, "type": "mcq", "topic": q.get("topic"),
                "correct": correct, "chosen_index": chosen,
                "correct_index": q.get("correct_index"),
                "points": 1.0 if correct else 0.0, "max_points": 1.0,
            })
        else:  # short answer, graded out of 10 (weight 1 question)
            total += 1.0
            text = (ans or "").strip() if isinstance(ans, str) else ""
            grade = _grade_short_answer(q, text)
            pts = grade["score"] / 10.0
            earned += pts
            per_question.append({
                "index": idx, "type": "short", "topic": q.get("topic"),
                "score_10": grade["score"], "feedback": grade["feedback"],
                "points": round(pts, 3), "max_points": 1.0,
            })

    score_pct = round((earned / total) * 100, 1) if total else 0.0
    return {"score": score_pct, "max_score": 100.0, "per_question": per_question}


def _grade_short_answer(q: dict, answer: str) -> dict:
    if not answer:
        return {"score": 0, "feedback": "No answer provided."}
    try:
        model = llm.structured(ShortAnswerGrade, temperature=0.1)
        expected = "; ".join(q.get("expected_points", [])) or "(none specified)"
        prompt = f"""Grade this short answer from 0 to 10 using ONLY this anchored scale,
so every candidate is graded to the same standard:
- 0-2: off-topic, empty, or factually wrong.
- 3-5: partially correct; misses most expected points.
- 6-8: covers most expected points with minor gaps or imprecision.
- 9-10: covers all expected points accurately and concretely.
Grade content against the expected points only — ignore grammar, length, and style.

Question: {q.get('question')}
Expected points: {expected}

Candidate answer:
{answer}"""
        g = model.invoke(prompt)
        return {"score": g.score, "feedback": g.feedback}
    except Exception:  # noqa: BLE001 -> length-based heuristic fallback
        words = len(answer.split())
        return {"score": min(10, 3 + words // 15),
                "feedback": "Auto-graded (LLM unavailable): partial credit by completeness."}
