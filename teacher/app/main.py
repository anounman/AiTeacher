"""AI Teacher service.

Owns the knowledge plane (sources → cited evidence) and the teaching plane
(evidence → a lesson). The Next.js app in ../web is a client of this service,
never a peer: it holds the canvas, the ink and the playback clock, and calls
here for everything that needs a model or the corpus.

See ../../ARCHITECTURE_V2.md.
"""
import asyncio

import httpx
from fastapi import FastAPI

from app.config import settings
from app.knowledge.db import create_schema
from app.knowledge.routes import router as knowledge_router

app = FastAPI(title="AI Teacher", version="0.1.0")
app.include_router(knowledge_router)


@app.on_event("startup")
async def _startup() -> None:
    # Idempotent; see the ponytail note in knowledge/db.py about Alembic.
    await create_schema()


async def _probe(name: str, url: str) -> dict:
    """One dependency's reachability. Never raises — a health check that can
    fail to answer is not a health check."""
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            res = await client.get(url)
        return {"name": name, "ok": res.status_code < 500, "status": res.status_code}
    except Exception as exc:
        return {"name": name, "ok": False, "error": type(exc).__name__}


async def _probe_db() -> dict:
    try:
        from sqlalchemy.ext.asyncio import create_async_engine
        from sqlalchemy import text

        engine = create_async_engine(settings().database_url)
        try:
            async with engine.connect() as conn:
                await conn.execute(text("select 1"))
        finally:
            await engine.dispose()
        return {"name": "postgres", "ok": True}
    except Exception as exc:
        return {"name": "postgres", "ok": False, "error": type(exc).__name__}


@app.get("/health")
async def health() -> dict:
    """Reports this process AND everything it depends on, so `web` can render
    one honest status instead of discovering a dead dependency mid-lesson."""
    cfg = settings()
    checks = await asyncio.gather(
        _probe_db(),
        _probe("ollama", f"{cfg.ollama_url}/api/tags"),
        _probe("writer", f"{cfg.writer_url}/health"),
    )
    return {
        "service": "teacher",
        "ok": all(c["ok"] for c in checks),
        "checks": checks,
    }
