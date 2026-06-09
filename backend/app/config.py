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
