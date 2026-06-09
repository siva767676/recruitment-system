"""LLM client for the unified system.

Talks to a locally hosted, OpenAI-compatible vLLM server via langchain-openai's
ChatOpenAI (same backend the original interviewer module used). Every helper
returns a validated Pydantic model through `.with_structured_output(...)`, so
the rest of the app gets typed data instead of free text to parse.

If langchain-openai isn't installed or the server is unreachable, the helpers
raise LLMUnavailable; callers decide whether to degrade gracefully.
"""
from __future__ import annotations

import urllib.request

from .config import VLLM_API_KEY, VLLM_BASE_URL, VLLM_MODEL


class LLMUnavailable(RuntimeError):
    """Raised when the configured LLM backend cannot be reached or used."""


def base_url() -> str:
    url = VLLM_BASE_URL.rstrip("/")
    if not url.endswith("/v1"):
        url = f"{url}/v1"
    return url


def settings() -> dict:
    """Return non-secret LLM settings used by the application."""
    return {"base_url": base_url(), "model": VLLM_MODEL}


def check_server(timeout: int = 5) -> dict:
    """Verify the configured vLLM server is reachable; raise LLMUnavailable otherwise."""
    models_url = f"{base_url()}/models"
    try:
        with urllib.request.urlopen(models_url, timeout=timeout) as resp:
            body = resp.read().decode("utf-8", errors="replace")
    except Exception as exc:  # noqa: BLE001
        raise LLMUnavailable(f"vLLM not reachable at {base_url()}: {exc}") from exc
    return {"base_url": base_url(), "models_preview": body[:500]}


def chat(temperature: float = 0.4):
    """Build a ChatOpenAI bound to the local vLLM server."""
    try:
        from langchain_openai import ChatOpenAI
    except ImportError as exc:  # pragma: no cover
        raise LLMUnavailable(
            "langchain-openai is not installed; run `pip install -r requirements.txt`."
        ) from exc
    print(f"[vLLM called] model={VLLM_MODEL} base_url={base_url()} temperature={temperature}", flush=True)
    return ChatOpenAI(
        model=VLLM_MODEL,
        temperature=temperature,
        base_url=base_url(),
        api_key=VLLM_API_KEY,
        timeout=120,
        max_retries=2,
    )


def structured(schema, temperature: float = 0.4):
    """A ChatOpenAI that is forced to return the given Pydantic schema."""
    return chat(temperature).with_structured_output(schema, method="json_schema")


def invoke_structured(schema, prompt: str, temperature: float = 0.4):
    """Run a structured LLM call, translating any backend failure into LLMUnavailable.

    Without this, an unreachable/incompatible server surfaces as a raw
    openai.APIError deep inside a LangGraph node, which callers can't catch
    cleanly. Here every failure becomes one well-typed exception.
    """
    try:
        return structured(schema, temperature).invoke(prompt)
    except LLMUnavailable:
        raise
    except Exception as exc:  # noqa: BLE001
        raise LLMUnavailable(f"LLM call failed against {base_url()}: {exc}") from exc


def clip(text: str, max_chars: int = 12000) -> str:
    """Bound prompt size while keeping enough resume detail to stay specific."""
    cleaned = (text or "").strip()
    if not cleaned:
        return "(not provided)"
    if len(cleaned) <= max_chars:
        return cleaned
    return cleaned[:max_chars] + "\n\n[Content truncated because the input was very long.]"
