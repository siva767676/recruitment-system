# Backend image for the Recruitment Management System (FastAPI).
#
# The LLM runs out-of-process on a locally hosted, OpenAI-compatible vLLM server;
# this container only serves the API and calls that server over HTTP. Resume
# screening works without the LLM (keyword/embedding similarity).
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Install dependencies first so the layer caches across code changes.
COPY requirements.txt .
RUN pip install --upgrade pip && pip install -r requirements.txt

# Copy the backend source. The DB, uploads, venv, and .env are excluded via
# .dockerignore; the DB and uploads live on a mounted volume at runtime.
COPY . .

# Persisted at runtime via a named volume (see docker-compose.yml). Both the
# uploaded resumes and the SQLite DB live here so data survives restarts.
RUN mkdir -p /app/appdata/uploads
VOLUME ["/app/appdata"]

EXPOSE 8000

# Default LLM target. vLLM runs on a remote GPU host, reachable directly by IP
# from the container (no host.docker.internal indirection needed). Override
# VLLM_BASE_URL via the .env / compose if the GPU host address changes.
ENV VLLM_BASE_URL=http://172.20.7.22:8000 \
    VLLM_MODEL=gemma4-31b \
    VLLM_API_KEY=EMPTY \
    DATABASE_URL=sqlite:////app/appdata/recruitment.db \
    UPLOADS_DIR=/app/appdata/uploads

# Container-internal healthcheck against the app's own endpoint (not the LLM).
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=5 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health',timeout=3).status==200 else 1)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
