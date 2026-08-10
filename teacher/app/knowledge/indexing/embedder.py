"""Embeddings via Ollama.

One model, one dimension, batched. The dimension is asserted rather than
trusted: a silently shorter vector fails at insert time with a Postgres type
error that says nothing useful, so it is caught here where the message can.
"""
from __future__ import annotations

import asyncio

import httpx

from app.config import settings
from app.knowledge.models import EMBEDDING_DIM

MODEL = "nomic-embed-text"
BATCH = 32


class EmbeddingError(RuntimeError):
    pass


async def embed_texts(texts: list[str], model: str = MODEL) -> list[list[float]]:
    if not texts:
        return []
    out: list[list[float]] = []
    url = f"{settings().ollama_url}/api/embed"
    async with httpx.AsyncClient(timeout=120.0) as client:
        for start in range(0, len(texts), BATCH):
            batch = texts[start : start + BATCH]
            try:
                res = await client.post(url, json={"model": model, "input": batch})
                res.raise_for_status()
                vectors = res.json().get("embeddings") or []
            except Exception as exc:
                raise EmbeddingError(f"{model}: {exc}") from exc
            if len(vectors) != len(batch):
                raise EmbeddingError(
                    f"{model} returned {len(vectors)} vectors for {len(batch)} inputs"
                )
            for vector in vectors:
                if len(vector) != EMBEDDING_DIM:
                    raise EmbeddingError(
                        f"{model} returned dim {len(vector)}, schema expects {EMBEDDING_DIM}"
                    )
            out.extend(vectors)
    return out


async def embed_query(text: str, model: str = MODEL) -> list[float]:
    vectors = await embed_texts([text], model=model)
    return vectors[0]


def embed_texts_sync(texts: list[str]) -> list[list[float]]:
    return asyncio.run(embed_texts(texts))
