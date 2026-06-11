"""Central configuration for the unified Recruitment Management System."""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

# backend/ root  =>  .../recruitment-system/backend
BACKEND_DIR = Path(__file__).resolve().parents[1]
PROJECT_DIR = BACKEND_DIR.parent

load_dotenv(BACKEND_DIR / ".env")

# ---------------------------------------------------------------- paths
DATA_DIR = BACKEND_DIR / "data"
JDS_DIR = DATA_DIR / "jds"               # markdown JD library (used as fallback seed)

# Candidate-uploaded resumes. Overridable so Docker can point it at a volume.
UPLOADS_DIR = Path(os.getenv("UPLOADS_DIR", str(BACKEND_DIR / "uploads"))).expanduser()
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

DB_PATH = BACKEND_DIR / "recruitment.db"
DB_URL = os.getenv("DATABASE_URL", f"sqlite:///{DB_PATH}")

SUPPORTED_EXTENSIONS = {".pdf", ".docx", ".txt", ".md"}

# ---------------------------------------------------------------- auth
# Fixed, predefined admin credentials (overridable via env).
ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "admin@recruit.ai")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "Admin@123")
JWT_SECRET = os.getenv("JWT_SECRET", "change-me-in-production-please")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_HOURS = int(os.getenv("JWT_EXPIRE_HOURS", "12"))

# ---------------------------------------------------------------- LLM (vLLM, OpenAI-compatible)
# vLLM runs on a remote GPU host. The /v1 suffix is appended by llm.base_url().
VLLM_BASE_URL = os.getenv("VLLM_BASE_URL", "http://172.20.7.22:8000")
VLLM_MODEL = os.getenv("VLLM_MODEL", "gemma4-31b")
VLLM_API_KEY = os.getenv("VLLM_API_KEY", "EMPTY")

# ---------------------------------------------------------------- scoring
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "all-MiniLM-L6-v2")

# Resume-vs-JD scoring weights (must sum to 1.0)
WEIGHTS = {
    "skill": 0.40,
    "experience": 0.20,
    "education": 0.15,
    "keyword": 0.25,
}

# Stage cutoffs (0-100). Adjustable per-job in the admin dashboard.
DEFAULT_SCREENING_CUTOFF = 60     # resume score needed to be shortlisted for the exam
DEFAULT_EXAM_CUTOFF = 50          # exam score needed to advance to the interview
DEFAULT_INTERVIEW_CUTOFF = 60     # interview score for a final "recommended" flag

REVIEW_THRESHOLD = 50

# ---------------------------------------------------------------- proctoring
# Violation points per event type. The client reports events; the server owns
# the scoring so it can't be tampered with from the browser console.
PROCTOR_POINTS = {
    "tab_switch": 10,        # visibilitychange -> hidden
    "focus_loss": 5,         # window blur without tab switch
    "fullscreen_exit": 10,
    "copy": 5,
    "cut": 5,
    "paste": 10,
    "context_menu": 2,
    "devtools": 15,          # blocked devtools shortcut attempted
    "no_face": 15,
    "multiple_faces": 30,
    "audio_activity": 8,     # sustained speech/voices during a written exam
    "multi_monitor": 15,
    "ip_change": 20,         # network identity changed mid-stage (server-detected)
    "phone": 40,             # reserved for a future object-detection upgrade
    "face_detection_unsupported": 0,  # informational only
}
PROCTOR_DEFAULT_POINTS = 5
# When a stage's accumulated score reaches the threshold, the configured action
# fires: "terminate" ends the stage immediately; "flag" only marks the
# application for manual review and lets the candidate continue.
PROCTOR_TERMINATE_THRESHOLD = int(os.getenv("PROCTOR_TERMINATE_THRESHOLD", "60"))
PROCTOR_ACTION = os.getenv("PROCTOR_ACTION", "terminate")  # terminate | flag
PROCTOR_MAX_SNAPSHOTS = int(os.getenv("PROCTOR_MAX_SNAPSHOTS", "60"))  # per application

# Exam timing
EXAM_DURATION_SECONDS = int(os.getenv("EXAM_DURATION_SECONDS", "1800"))  # 30 min
