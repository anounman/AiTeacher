"""HTTP surface of the knowledge plane.

Deliberately small: upload a document, list them, search. The teaching plane
calls `search` through Python, not HTTP — this API exists for `web` and for
debugging what the retriever actually returns.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.knowledge import service
from app.knowledge.db import session
from app.knowledge.indexing.embedder import embed_query
from app.knowledge.models import Chunk, Document
from app.knowledge.retrieval.hybrid import document_search, hybrid_search

router = APIRouter(prefix="/knowledge", tags=["knowledge"])


class SearchRequest(BaseModel):
    query: str
    top_k: int = 10
    document_ids: list[int] | None = None
    workspace_id: str | None = None


def _workspace(explicit: str | None) -> str:
    return explicit if explicit is not None else settings().default_workspace_id


@router.post("/documents")
async def upload(
    file: UploadFile = File(...),
    workspace_id: str | None = Form(default=None),
    external_id: str | None = Form(default=None),
    source_uri: str | None = Form(default=None),
    db: AsyncSession = Depends(session),
) -> dict:
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="empty file")
    document = await service.ingest_bytes(
        db,
        workspace_id=_workspace(workspace_id),
        filename=file.filename or "upload",
        data=data,
        source_uri=source_uri,
        external_id=external_id,
    )
    count = (
        await db.execute(
            select(func.count(Chunk.id)).where(Chunk.document_id == document.id)
        )
    ).scalar_one()
    return {
        "id": document.id,
        "title": document.title,
        "status": document.status.value,
        "error": document.error,
        "chunks": count,
        "chars": len(document.content or ""),
        "metadata": document.doc_metadata,
    }


@router.get("/documents")
async def list_documents(
    workspace_id: str | None = None, db: AsyncSession = Depends(session)
) -> list[dict]:
    rows = (
        await db.execute(
            select(Document)
            .where(Document.workspace_id == _workspace(workspace_id))
            .order_by(Document.created_at.desc())
        )
    ).scalars()
    return [
        {
            "id": d.id,
            "title": d.title,
            "type": d.document_type.value,
            "status": d.status.value,
            "error": d.error,
            "metadata": d.doc_metadata,
        }
        for d in rows
    ]


@router.post("/search")
async def search(req: SearchRequest, db: AsyncSession = Depends(session)) -> dict:
    """Returns evidence, not prose. Whatever cites these may cite only these."""
    embedding = await embed_query(req.query)
    workspace_id = _workspace(req.workspace_id)
    hits = await hybrid_search(
        db,
        req.query,
        embedding,
        workspace_id,
        top_k=req.top_k,
        document_ids=req.document_ids,
    )
    documents = await document_search(db, req.query, embedding, workspace_id)
    return {
        "query": req.query,
        "evidence": [hit.as_evidence() for hit in hits],
        "documents": documents,
    }
