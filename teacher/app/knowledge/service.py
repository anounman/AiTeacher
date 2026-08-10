"""Ingestion orchestration: bytes in, retrievable cited chunks out.

The stages are separate on purpose — convert, chunk, embed, persist — because
each fails differently and each is worth skipping when nothing changed. A
document whose bytes hash to what we already have is a no-op; a document whose
chunks hash to what we already have keeps its embeddings.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import tempfile

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.knowledge.etl.classifier import registry
from app.knowledge.etl.types import ConversionError
from app.knowledge.indexing.chunker import chunk_document
from app.knowledge.indexing.embedder import embed_texts
from app.knowledge.models import Chunk, Document, DocumentStatus
from app.knowledge.text_hygiene import clean

log = logging.getLogger(__name__)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


async def find_by_hash(db: AsyncSession, workspace_id: str, content_hash: str) -> Document | None:
    return (
        await db.execute(
            select(Document).where(
                Document.workspace_id == workspace_id,
                Document.content_hash == content_hash,
            )
        )
    ).scalar_one_or_none()


async def ingest_bytes(
    db: AsyncSession,
    *,
    workspace_id: str,
    filename: str,
    data: bytes,
    source_uri: str | None = None,
    external_id: str | None = None,
) -> Document:
    """Convert → chunk → embed → persist, transitioning status at each stage so
    a stuck document is always visibly stuck at a named stage."""
    content_hash = sha256_bytes(data)
    existing = await find_by_hash(db, workspace_id, content_hash)
    if existing and existing.status == DocumentStatus.ready:
        return existing

    document = existing or Document(
        workspace_id=workspace_id,
        title=filename,
        source_uri=source_uri,
        content_hash=content_hash,
    )
    document.status = DocumentStatus.parsing
    document.error = None
    db.add(document)
    await db.commit()

    suffix = os.path.splitext(filename)[1] or ""
    tmp_path = ""
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(data)
            tmp_path = tmp.name

        # Converters are sync and CPU-bound (docling runs a layout model);
        # off the event loop so one ingest cannot stall every request.
        parsed = await asyncio.to_thread(registry.convert, tmp_path)

        # The uploaded filename wins. Converters see a temp file, so their
        # notion of a title is that temp file's name — keep it as metadata for
        # debugging, never as the thing a student reads in a citation.
        document.title = filename
        document.document_type = parsed.document_type
        document.content = clean(parsed.markdown)
        document.doc_metadata = {
            **parsed.meta,
            "converter": parsed.converter,
            "converter_title": parsed.title,
            "has_page_provenance": parsed.has_page_provenance,
            # Identity in the calling system. Retrieval echoes this back so the
            # caller can rejoin a chunk to its own records (concepts, mastery).
            **({"material_id": external_id} if external_id else {}),
        }
        document.status = DocumentStatus.indexing
        await db.commit()

        chunks = chunk_document(parsed.markdown, parsed.pages)
        if not chunks:
            raise ConversionError("no text could be extracted")

        vectors = await embed_texts([c.text for c in chunks])

        await db.execute(delete(Chunk).where(Chunk.document_id == document.id))
        db.add_all(
            [
                Chunk(
                    document_id=document.id,
                    workspace_id=workspace_id,
                    ordinal=chunk.ordinal,
                    content=clean(chunk.text),
                    embedding=vector,
                    loc=chunk.loc,
                    chunk_hash=chunk.hash,
                )
                for chunk, vector in zip(chunks, vectors, strict=True)
            ]
        )
        document.status = DocumentStatus.ready
        await db.commit()
        log.info(
            "ingested %s (%s, %d chunks, page_provenance=%s)",
            document.title,
            parsed.converter,
            len(chunks),
            parsed.has_page_provenance,
        )
        return document

    except Exception as exc:
        await db.rollback()
        document.status = DocumentStatus.error
        document.error = str(exc)[:2000]
        db.add(document)
        await db.commit()
        log.exception("ingest failed for %s", filename)
        return document
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
