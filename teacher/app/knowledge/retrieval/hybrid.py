"""Two-tier hybrid retrieval.

Dense (pgvector cosine) and lexical (Postgres full-text) run as separate CTEs,
each ranked independently, then fused with Reciprocal Rank Fusion. RRF is used
rather than score blending because the two scores are not comparable — a
cosine distance and a ts_rank_cd share no scale — while their *ranks* are.

    score = 1/(k + rank_dense) + 1/(k + rank_lexical),  k = 60

k=60 is the constant from the original RRF paper and what the reference
implementation uses; it damps the top-1 of either retriever from dominating.

Derived from SurfSense's `retriever/chunks_hybrid_search.py` (Apache-2.0, see
NOTICE), adapted to our schema and evidence envelope.
"""
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.knowledge.models import Chunk, Document, DocumentStatus

RRF_K = 60
# Fetch wider than we return: fusion is only meaningful if each retriever
# contributed candidates the other missed.
CANDIDATE_MULTIPLIER = 5


@dataclass(slots=True)
class Hit:
    chunk_id: int
    document_id: int
    document_title: str
    text: str
    loc: dict
    score: float
    ordinal: int = 0
    # Identity in the system that produced the document. For anything migrated
    # from the old SQLite store this is its material id, which is how the web
    # app still resolves concepts and mastery for a chunk.
    external_id: str = ""

    def as_evidence(self) -> dict:
        """The envelope the teaching plane is allowed to cite from."""
        return {
            "verbatim_quote": self.text,
            "source_id": f"doc_{self.document_id}#c{self.chunk_id}",
            "document_title": self.document_title,
            "loc": self.loc,
            "ordinal": self.ordinal,
            "external_id": self.external_id,
            "score": round(self.score, 6),
        }


def _tsvector():
    return func.to_tsvector("english", Chunk.content)


async def hybrid_search(
    db: AsyncSession,
    query_text: str,
    query_embedding: list[float],
    workspace_id: str,
    top_k: int = 10,
    document_ids: list[int] | None = None,
) -> list[Hit]:
    n = top_k * CANDIDATE_MULTIPLIER
    tsquery = func.plainto_tsquery("english", query_text)

    conditions = [
        Document.workspace_id == workspace_id,
        Document.status != DocumentStatus.deleting,
    ]
    if document_ids:
        conditions.append(Document.id.in_(document_ids))

    dense_cte = (
        select(
            Chunk.id.label("id"),
            func.rank().over(order_by=Chunk.embedding.cosine_distance(query_embedding)).label("rank"),
        )
        .join(Document, Chunk.document_id == Document.id)
        .where(*conditions)
        .where(Chunk.embedding.isnot(None))
        .order_by(Chunk.embedding.cosine_distance(query_embedding))
        .limit(n)
        .cte("dense")
    )

    lexical_cte = (
        select(
            Chunk.id.label("id"),
            func.rank().over(order_by=func.ts_rank_cd(_tsvector(), tsquery).desc()).label("rank"),
        )
        .join(Document, Chunk.document_id == Document.id)
        .where(*conditions)
        .where(_tsvector().op("@@")(tsquery))
        .order_by(func.ts_rank_cd(_tsvector(), tsquery).desc())
        .limit(n)
        .cte("lexical")
    )

    # FULL OUTER JOIN: a chunk found by only one retriever must still score.
    fused = (
        select(
            Chunk,
            (
                func.coalesce(1.0 / (RRF_K + dense_cte.c.rank), 0.0)
                + func.coalesce(1.0 / (RRF_K + lexical_cte.c.rank), 0.0)
            ).label("score"),
        )
        .select_from(
            dense_cte.outerjoin(lexical_cte, dense_cte.c.id == lexical_cte.c.id, full=True)
        )
        .join(Chunk, Chunk.id == func.coalesce(dense_cte.c.id, lexical_cte.c.id))
        .options(joinedload(Chunk.document))
        .order_by(text("score DESC"))
        .limit(top_k)
    )

    rows = (await db.execute(fused)).unique().all()
    return [
        Hit(
            chunk_id=chunk.id,
            document_id=chunk.document_id,
            document_title=chunk.document.title if chunk.document else "",
            text=chunk.content,
            loc=chunk.loc or {},
            score=float(score),
            ordinal=chunk.ordinal,
            external_id=(chunk.document.doc_metadata or {}).get("material_id", "")
            if chunk.document
            else "",
        )
        for chunk, score in rows
    ]


async def document_search(
    db: AsyncSession,
    query_text: str,
    query_embedding: list[float],
    workspace_id: str,
    top_k: int = 5,
) -> list[dict]:
    """The second tier: which *documents* are about this, regardless of whether
    any single chunk phrases it well. Answers "what should I read" and scopes a
    follow-up chunk search."""
    hits = await hybrid_search(
        db, query_text, query_embedding, workspace_id, top_k=top_k * 8
    )
    by_doc: dict[int, dict] = {}
    for hit in hits:
        entry = by_doc.setdefault(
            hit.document_id,
            {"document_id": hit.document_id, "title": hit.document_title, "score": 0.0, "hits": 0},
        )
        entry["score"] += hit.score
        entry["hits"] += 1
    return sorted(by_doc.values(), key=lambda d: d["score"], reverse=True)[:top_k]
