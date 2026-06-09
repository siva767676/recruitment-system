"""AI interview engine — LangGraph state machine ported from the interviewer module.

Topology (unchanged from the original module):

    plan -> ask -> [interrupt: wait for answer] -> evaluate -> route
      ^                                                          |
      +---------------- more questions remain -------------------+
                                                                 |
                                          no more -> wrap_up -> END

Adaptations for the unified system:
  * uses the shared `llm` client (vLLM) instead of a private ChatOpenAI,
  * the planner is additionally fed the candidate's assessment performance,
  * exposes a thin start()/answer() API that the FastAPI routes call, returning
    plain dicts the voice frontend can speak aloud.

If the LLM is unavailable the graph cannot run; callers surface a clear error.
"""
from __future__ import annotations

from typing import Annotated, List, Literal, Optional, TypedDict
from uuid import uuid4

from pydantic import BaseModel, Field

from . import llm


class InterviewExpired(RuntimeError):
    """The thread has no resumable checkpoint.

    LangGraph state lives in an in-memory MemorySaver, so a backend restart
    wipes every in-flight interview. Resuming a dead thread would re-run the
    graph from START against empty state and blow up with a cryptic KeyError;
    we detect that here and let callers restart the interview cleanly instead.
    """


# ----------------------------------------------------------------- schemas
class PlannedQuestion(BaseModel):
    topic: str = Field(description="Skill/area this probes")
    question: str = Field(description="The question text spoken to the candidate")
    difficulty: Literal["easy", "medium", "hard"]
    round: Literal["technical", "hr"]


class InterviewPlan(BaseModel):
    questions: List[PlannedQuestion]


class Evaluation(BaseModel):
    technical_score: int = Field(ge=0, le=10)
    communication_score: int = Field(ge=0, le=10)
    completeness_score: int = Field(ge=0, le=10)
    confidence_score: int = Field(ge=0, le=10, description="Apparent confidence 0-10")
    problem_solving_score: int = Field(ge=0, le=10)
    missing_points: List[str] = Field(default_factory=list)
    suggested_answer: str = ""
    follow_up_needed: bool = False


class FinalReport(BaseModel):
    overall_score: int = Field(ge=0, le=100)
    technical_skills: float = Field(ge=0, le=10)
    communication: float = Field(ge=0, le=10)
    confidence: float = Field(ge=0, le=10)
    problem_solving: float = Field(ge=0, le=10)
    strengths: List[str]
    weaknesses: List[str]
    recommendation: Literal["Strong Hire", "Hire", "Maybe", "No Hire"]
    summary: str


def _append(existing: list, new: list) -> list:
    return (existing or []) + (new or [])


class InterviewState(TypedDict, total=False):
    candidate_name: str
    role: str
    experience_level: str
    resume_text: str
    job_description: str
    assessment_summary: str
    max_questions: int
    plan: List[dict]
    cursor: int
    current_question: Optional[dict]
    pending_answer: Optional[str]
    transcript: Annotated[List[dict], _append]
    report: Optional[dict]


# ----------------------------------------------------------------- agents
def _plan_interview(state: InterviewState) -> InterviewPlan:
    prompt = f"""You are an expert interviewer planning a tailored interview.

Role: {state['role']}
Candidate experience level: {state.get('experience_level', 'mid')}

Candidate resume:
{llm.clip(state.get('resume_text', ''), 8000)}

Job description:
{llm.clip(state.get('job_description', ''), 3000)}

Assessment performance so far:
{state.get('assessment_summary') or '(not available)'}

Design exactly {state.get('max_questions', 5)} interview questions.
Rules:
- Order easiest to hardest.
- Anchor technical questions to specific resume evidence (skills, projects, tools).
- Use the assessment performance to probe weak areas and confirm strong ones.
- Include 1-2 HR/behavioural questions (round="hr"); the rest technical.
- Calibrate difficulty to a {state.get('experience_level', 'mid')} candidate.
- Each question must be answerable verbally in under 3 minutes.
- Phrase questions conversationally, as a human interviewer would speak them."""
    return llm.invoke_structured(InterviewPlan, prompt, temperature=0.5)


def _evaluate_answer(question: dict, answer: str, experience_level: str) -> Evaluation:
    prompt = f"""You are a strict but fair interviewer evaluating ONE answer.

Round: {question.get('round')}
Topic: {question.get('topic')}
Difficulty: {question.get('difficulty')}
Candidate level: {experience_level}

Question:
{question.get('question')}

Candidate answer:
{answer if answer.strip() else "(no answer given)"}

Score technical accuracy, communication clarity, completeness, apparent
confidence, and problem-solving. Be honest: a vague/empty answer scores low.
Calibrate to the candidate's stated level."""
    return llm.invoke_structured(Evaluation, prompt, temperature=0.2)


def _build_report(candidate_name: str, role: str, transcript: List[dict]) -> FinalReport:
    lines = []
    for i, turn in enumerate(transcript, 1):
        q = turn["question"]
        ev = turn.get("evaluation") or {}
        lines.append(
            f"Q{i} [{q['round']}/{q['difficulty']}] {q['question']}\n"
            f"  Answer: {turn['answer'] or '(none)'}\n"
            f"  Scores: tech={ev.get('technical_score')}, comm={ev.get('communication_score')}, "
            f"complete={ev.get('completeness_score')}, conf={ev.get('confidence_score')}, "
            f"problem={ev.get('problem_solving_score')}")
    prompt = f"""You are a hiring panel lead writing the final report.

Candidate: {candidate_name}
Role: {role}

Full interview transcript with per-answer scores:
{chr(10).join(lines)}

Produce an overall hiring report. overall_score (0-100) reflects a weighted view
of technical skill, communication, confidence, and problem solving. Be decisive
in the recommendation and concrete in strengths/weaknesses."""
    return llm.invoke_structured(FinalReport, prompt, temperature=0.3)


# ----------------------------------------------------------------- graph
_graph = None


def _build_graph():
    from langgraph.checkpoint.memory import MemorySaver
    from langgraph.graph import END, START, StateGraph
    from langgraph.types import interrupt

    def plan_node(state: InterviewState) -> dict:
        plan = _plan_interview(state)
        return {"plan": [q.model_dump() for q in plan.questions], "cursor": 0}

    def ask_node(state: InterviewState) -> dict:
        question = state["plan"][state["cursor"]]
        answer = interrupt({"type": "question", "question": question})
        return {"current_question": question, "pending_answer": answer}

    def evaluate_node(state: InterviewState) -> dict:
        question = state["current_question"]
        answer = state.get("pending_answer") or ""
        evaluation = _evaluate_answer(question, answer, state.get("experience_level", "mid"))
        turn = {"question": question, "answer": answer,
                "evaluation": evaluation.model_dump()}
        return {"transcript": [turn], "cursor": state["cursor"] + 1}

    def route_after_eval(state: InterviewState) -> str:
        return "wrap_up" if state["cursor"] >= len(state["plan"]) else "ask"

    def wrap_up_node(state: InterviewState) -> dict:
        report = _build_report(state.get("candidate_name", "Candidate"),
                               state["role"], state["transcript"])
        return {"report": report.model_dump()}

    g = StateGraph(InterviewState)
    g.add_node("plan", plan_node)
    g.add_node("ask", ask_node)
    g.add_node("evaluate", evaluate_node)
    g.add_node("wrap_up", wrap_up_node)
    g.add_edge(START, "plan")
    g.add_edge("plan", "ask")
    g.add_edge("ask", "evaluate")
    g.add_conditional_edges("evaluate", route_after_eval,
                            {"ask": "ask", "wrap_up": "wrap_up"})
    g.add_edge("wrap_up", END)
    return g.compile(checkpointer=MemorySaver())


def _get_graph():
    global _graph
    if _graph is None:
        _graph = _build_graph()
    return _graph


def _question_from_event(event: dict) -> Optional[dict]:
    interrupts = event.get("__interrupt__")
    if not interrupts:
        return None
    return interrupts[0].value["question"]


# ----------------------------------------------------------------- public API
def start_interview(*, candidate_name: str, role: str, experience_level: str,
                    resume_text: str, job_description: str,
                    assessment_summary: str = "", max_questions: int = 5) -> dict:
    """Begin an interview; returns {thread_id, question}."""
    graph = _get_graph()
    thread_id = str(uuid4())
    config = {"configurable": {"thread_id": thread_id}}
    initial = {
        "candidate_name": candidate_name or "Candidate",
        "role": role,
        "experience_level": experience_level or "mid",
        "resume_text": resume_text,
        "job_description": job_description,
        "assessment_summary": assessment_summary,
        "max_questions": max(1, min(max_questions, 12)),
    }
    event = graph.invoke(initial, config=config)
    return {"thread_id": thread_id, "question": _question_from_event(event)}


def submit_answer(thread_id: str, answer: str) -> dict:
    """Submit an answer; returns the next question or, when done, the report+transcript."""
    from langgraph.types import Command

    graph = _get_graph()
    config = {"configurable": {"thread_id": thread_id}}

    # A live interview is paused at the `ask` interrupt with its full state
    # checkpointed. If the thread has no state (backend restarted -> in-memory
    # checkpoints lost) or isn't actually waiting on an interrupt, resuming
    # would run the graph from scratch against empty state and KeyError on
    # 'role'. Bail out with a clear, recoverable signal instead.
    snapshot = graph.get_state(config)
    if not snapshot.values or not snapshot.next:
        raise InterviewExpired(
            "This interview session is no longer active (the server was "
            "restarted). Please start the interview again.")

    event = graph.invoke(Command(resume=answer), config=config)
    values = graph.get_state(config).values
    transcript = values.get("transcript") or []
    next_q = _question_from_event(event)
    return {
        "thread_id": thread_id,
        "last_turn": transcript[-1] if transcript else None,
        "question": next_q,
        "transcript": transcript,
        "report": None if next_q else values.get("report"),
        "done": next_q is None,
    }
