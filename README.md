# Recruitment Management System (Unified AI Recruiter)

An end-to-end, AI-powered recruitment platform that takes a candidate from
**sign-up → resume screening → online assessment → AI voice interview → final
recommendation**, fully automated, with a complete **admin dashboard** for
oversight and manual control at every stage.

This unifies two earlier modules into one system:

| Source module | What it contributed |
|---------------|---------------------|
| **md1** (Resume Screening & Scoring) | resume/JD extraction, parsing, weighted semantic scoring |
| **interviewer** (Multi-Agent AI Interviewer) | LangGraph plan→ask→evaluate→report interview engine |

…plus everything new the unified system needed: authentication, a candidate
portal, a per-candidate application pipeline, a dynamic online assessment
engine, a voice-enabled interview UI, and the admin dashboard.

---

## Architecture

```
recruitment-system/
├── backend/                         FastAPI + SQLite (one DB for the whole pipeline)
│   ├── app/
│   │   ├── main.py                  app entrypoint, routers, startup seed
│   │   ├── config.py                paths, admin creds, LLM + scoring config
│   │   ├── database.py              User · Job · Application · Exam · InterviewSession
│   │   ├── auth.py                  PBKDF2 passwords + JWT; fixed admin login
│   │   ├── llm.py                   OpenAI-compatible vLLM client (structured outputs)
│   │   ├── extractor.py / parser.py / scoring.py   resume engine (ported from md1)
│   │   ├── exam_service.py          dynamic question generation + auto-grading
│   │   ├── interview_service.py     LangGraph interview engine (ported from interviewer)
│   │   ├── pipeline.py              screening + stage-transition rules (cutoffs)
│   │   ├── seed.py                  seeds starter jobs from data/jds/*.md
│   │   ├── routes_auth.py           /api/auth/*
│   │   ├── routes_candidate.py      /api/candidate/*
│   │   └── routes_admin.py          /api/admin/*
│   ├── data/jds/                    markdown JD library (starter jobs)
│   ├── uploads/                     candidate-uploaded resumes
│   ├── requirements.txt · .env.example · smoke_test.py
└── frontend/                        React + Vite + Tailwind + Recharts
    └── src/
        ├── main.jsx                 routes (react-router)
        ├── lib/  api.js · auth.jsx · voice.js (Web Speech API STT/TTS)
        ├── components/  Layout · ui (badges, cards)
        └── pages/  Login · Signup · AdminLogin · CandidateJobs ·
                    CandidateApplications · ApplicationDetail · ExamPage ·
                    InterviewPage · AdminDashboard · AdminJobs ·
                    AdminApplications · AdminApplicationDetail
```

---

## The workflow

1. **Sign up / log in** (candidate) — JWT auth, DB-backed accounts.
2. **Apply** — upload a resume to a published job. The system extracts the text,
   parses skills/experience/education, and **scores it against the JD**.
3. **Automatic shortlisting** — score ≥ the job's *screening cutoff* →
   `shortlisted` (assessment unlocked); otherwise `screen_rejected`.
4. **Online assessment** — a tailored exam is generated from the candidate's
   resume + the JD + standard aptitude questions (MCQ + short answer). MCQs are
   graded exactly; short answers are graded by the LLM. Score ≥ *exam cutoff* →
   `exam_passed` (interview unlocked).
5. **AI voice interview** — a LangGraph agent plans questions from the resume,
   JD, and assessment performance, then conducts a turn-by-turn interview. The
   browser speaks each question (TTS) and transcribes spoken answers (STT), with
   a text fallback. It scores technical skill, communication, confidence, and
   problem-solving, and writes a final report + recommendation.
6. **Decision** — score ≥ *interview cutoff* → `selected`, else `rejected`.
   Admins can override any decision at any stage.

Every stage writes its score onto the `Application`, whose `status` is the
single source of truth for the candidate's position in the funnel.

---

## Run with Docker (one command)

The fastest way to run the whole stack — frontend + backend together:

```bash
cp backend/.env.example backend/.env  # optional: edit admin creds / LLM URL
docker compose up --build
```

Open **http://localhost:3000**. nginx serves the SPA and reverse-proxies `/api`
to the backend; the SQLite DB and uploaded resumes persist on a named volume.
The vLLM model server runs on a remote GPU host, reached by IP via
`VLLM_BASE_URL` in `backend/.env`. See **[DOCKER.md](DOCKER.md)** for details
and common commands.
The manual setup below is for local development without Docker.

---

## Setup & Run (without Docker)

> Requires **Python 3.11+** and **Node 18+**.

### 1. Model server (for exam generation + AI interview)

The exam generator and interviewer talk to an **OpenAI-compatible vLLM server**
running on a remote GPU host. Point `VLLM_BASE_URL` at it (the `/v1` suffix is
appended automatically if you omit it):

```
VLLM_BASE_URL=http://172.20.7.22:8000      # your GPU host running vLLM
VLLM_MODEL=gemma4-31b
```

Resume screening works **without** the model server (it uses keyword/embedding
similarity). If the model server is down or unreachable, the assessment falls
back to a static aptitude bank and the AI interview returns a clear "unavailable"
message — the rest of the system keeps working.

> ℹ️ Because vLLM runs on a separate machine, the backend can safely use the
> default port 8000 locally — just make sure this machine can reach the GPU
> host's address.

### 2. Backend

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
copy .env.example .env        # then edit VLLM_BASE_URL / admin creds

.\.venv\Scripts\python.exe smoke_test.py          # offline sanity check
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

On first start it seeds one published job per JD in `data/jds/`.

### 3. Frontend (new terminal)

```powershell
cd frontend
npm install
npm run dev          # http://localhost:5173  (proxies /api -> :8000)
```

Open **http://localhost:5173**.

> If the backend isn't on `:8000`, update the proxy target in
> `frontend/vite.config.js`.

---

## Credentials

- **Candidates** create their own accounts via **Sign up**.
- **Admin** uses fixed, predefined credentials (set in `backend/.env`):
  - default (dev): `admin@recruit.ai` / `Admin@123`
  - log in at **/admin/login**.

Change these in production via `ADMIN_EMAIL` / `ADMIN_PASSWORD` and set a strong
`JWT_SECRET`.

---

## Admin dashboard

- Create / edit / publish / delete jobs and their JDs.
- Set per-job screening / exam / interview cutoffs.
- View all candidates and applications; filter by job and status.
- View extracted resume text and the screening breakdown.
- View assessment answers with the answer key and per-question grades.
- View the AI interview transcript, scores, and final report.
- Re-run screening, override any candidate's status, and add notes.
- Analytics: status funnel, applicants-per-job, averages, selected count.

---

## Optional: semantic embeddings

Resume screening blends keyword overlap with semantic similarity. To enable the
embedding model, uncomment `sentence-transformers` and `numpy` in
`backend/requirements.txt` and install them. Without them, scoring transparently
falls back to keyword overlap (handy where a torch wheel isn't available).

---

## API reference (summary)

| Group | Endpoint | Purpose |
|-------|----------|---------|
| auth | `POST /api/auth/signup` · `/login` · `/admin/login` | accounts + tokens |
| candidate | `GET /api/candidate/jobs` | published jobs |
| candidate | `POST /api/candidate/jobs/{id}/apply` | upload resume + auto-screen |
| candidate | `GET /api/candidate/applications[/{id}]` | track progress |
| candidate | `POST …/exam/start` · `…/exam/submit` | online assessment |
| candidate | `POST …/interview/start` · `…/interview/answer` | AI interview |
| admin | `GET/POST/PUT/DELETE /api/admin/jobs[...]` | job/JD CRUD + publish |
| admin | `GET /api/admin/candidates` · `/applications[...]` | review |
| admin | `POST …/rescreen` · `…/status` | re-screen + manual override |
| admin | `GET /api/admin/interviews/{app_id}` · `/analytics` | reports + stats |
