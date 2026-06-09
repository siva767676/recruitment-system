# Running with Docker

The whole stack — React frontend + FastAPI backend — starts with one command.

## Quick start

```bash
cp backend/.env.example backend/.env  # optional: edit admin creds / LLM URL
docker compose up --build
```

Then open **http://localhost:3000**.

- Frontend: `http://localhost:3000` (nginx serving the built SPA)
- Backend API: `http://localhost:8000/api/health` (also proxied at `/api` via the frontend)
- Admin login: **/admin/login** with `ADMIN_EMAIL` / `ADMIN_PASSWORD` (default `admin@recruit.ai` / `Admin@123`)

Stop with `Ctrl+C`, or run detached with `docker compose up --build -d` and stop
with `docker compose down`.

## How it fits together

```
browser ─▶ frontend (nginx :80 ─▶ host :3000)
               │  static SPA
               └─ /api/* ─▶ backend (uvicorn :8000 ─▶ host :8000)
                                 │
                                 └─ vLLM ─▶ host.docker.internal:8001 ─▶ [Windows host
                                            netsh portproxy] ─▶ 172.20.7.22:8000/v1 (GPU)
```

- The SPA calls same-origin `/api/*`; nginx reverse-proxies those to the backend
  container, so **no API URL needs configuring** (it mirrors the Vite dev proxy).
- The backend persists its SQLite DB and uploaded resumes on the named volume
  `backend_data` (mounted at `/app/appdata`), so data survives `down`/`up`.
- The **LLM is not containerized** — it runs on a remote GPU host. The Docker
  (WSL2) network can't reach that LAN host directly, so the container reaches it
  **through the Windows host** via a portproxy (see below).

## The model server (LLM) — IMPORTANT for Docker

vLLM runs on a remote GPU host (`172.20.7.22:8000`). The Windows host can reach
it, but the **Docker/WSL2 bridge network cannot** (`No route to host`). So the
container is wired to reach the GPU *through the host*.

### Option A: user-mode relay, no admin

Open a PowerShell from the project root and keep it running:

```powershell
python .\scripts\vllm-relay.py
```

Then set this in `backend/.env` and restart the backend container:

```env
VLLM_BASE_URL=http://host.docker.internal:8001
VLLM_MODEL=gemma4-31b
```

```powershell
docker compose up -d --force-recreate backend
```

### Option B: Windows portproxy, admin once

Run this once in an elevated (Administrator) PowerShell:

```powershell
cd recruitment-system
.\scripts\setup-gpu-portproxy.ps1
```

It adds a `netsh` portproxy forwarding **host:8001 → 172.20.7.22:8000** and a
firewall rule. It survives reboot. Undo with
`.\scripts\setup-gpu-portproxy.ps1 -Remove`.

`host.docker.internal` resolves to the Windows host via the `extra_hosts`
mapping in `docker-compose.yml`.

If your GPU host or relay port differs, edit `scripts/setup-gpu-portproxy.ps1`
parameters and `VLLM_BASE_URL` in `backend/.env` to match.

- **Resume screening works without the LLM.**
- If the LLM is unreachable, the assessment uses a built-in fallback question
  bank and the AI interview returns a clear "unavailable" message — nothing
  crashes (you'll see a clean `502`, as designed).
- **Running the backend *without* Docker** needs no portproxy — a host process
  reaches `172.20.7.22:8000` directly (that's what `backend/.env` uses).

## Published ports

The backend publishes on host `:8000` and the frontend on `:3000` by default.
Because vLLM now runs on a **separate** machine, there's no local port clash. If
host `:8000` is otherwise occupied, change the published port in `.env` (this
only affects the host-published port; the frontend always reaches the backend on
the internal container port 8000):

```
BACKEND_PORT=8010
```

## Common commands

```bash
docker compose up --build          # build + run in the foreground
docker compose up --build -d       # run detached
docker compose logs -f backend     # tail backend logs
docker compose ps                  # service + health status
docker compose down                # stop and remove containers
docker compose down -v             # also delete the data volume (fresh DB)
docker compose build --no-cache    # rebuild from scratch
```

## Rebuilding after code changes

```bash
docker compose up --build          # rebuilds changed images, keeps the volume
```

The data volume persists across rebuilds. To reset to a clean database and wipe
uploaded resumes, run `docker compose down -v`.
