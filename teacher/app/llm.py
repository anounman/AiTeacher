"""Model slots, resolved from the same config file the web app reads.

Code names a *slot* (`reason`, `parse`, `visual`, `read`, `embed`), never a
model. Swapping a model is then a config edit, not a code change — which is the
whole point of the slot indirection.

The config file currently lives at web/config/models.json because the web app
loads it at build time. Both processes read it rather than keeping two copies
that drift. When the teaching plane moves here (R3) the file moves with it and
`web` reads it over HTTP.
"""
from __future__ import annotations

import json
import os
import pathlib
from functools import lru_cache

import httpx

from app.config import settings

_DEFAULT_CONFIG = pathlib.Path(__file__).resolve().parents[2] / "web" / "config" / "models.json"

_FALLBACK_SLOTS = {
    "parse": {"model": "gemma4:e4b"},
    "dispatch": {"model": "nemotron-3-nano:30b-cloud"},
    "reason": {"model": "deepseek-v4-pro:cloud"},
    "visual": {"model": "nemotron-3-nano:30b-cloud"},
    "read": {"model": "minimax-m3:cloud"},
    "embed": {"model": "nomic-embed-text"},
}


@lru_cache
def _config() -> dict:
    path = pathlib.Path(os.environ.get("TEACHER_MODELS_CONFIG", str(_DEFAULT_CONFIG)))
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return {"slots": _FALLBACK_SLOTS}


def slot(name: str) -> str:
    """Resolution order: env override → config file → built-in default.

    Mirrors lib/llm/slots.ts so the two processes cannot disagree about which
    model a slot means.
    """
    env = os.environ.get(f"OLLAMA_{name.upper()}_MODEL")
    if env:
        return env
    slots = _config().get("slots", {})
    entry = slots.get(name) or _FALLBACK_SLOTS.get(name, {})
    return entry.get("model", "")


async def chat(
    messages: list[dict],
    *,
    slot_name: str = "reason",
    json_mode: bool = False,
    timeout: float = 180.0,
) -> str:
    """One completion. No streaming: every caller here wants the whole answer
    before doing anything with it."""
    payload: dict = {
        "model": slot(slot_name),
        "messages": messages,
        "stream": False,
    }
    if json_mode:
        payload["format"] = "json"
    async with httpx.AsyncClient(timeout=timeout) as client:
        res = await client.post(f"{settings().ollama_url}/api/chat", json=payload)
        res.raise_for_status()
        return (res.json().get("message") or {}).get("content", "")
