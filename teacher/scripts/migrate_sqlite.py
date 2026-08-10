"""One-shot migration: the old SQLite corpus into Postgres.

Embeddings are carried across rather than recomputed — the old store used the
same model and dimension (nomic-embed-text, 768), so re-embedding 953 chunks
would cost minutes and change nothing. If the dimension ever disagrees the
chunk is re-embedded instead of silently corrupting the index.

    teacher/.venv/bin/python teacher/scripts/migrate_sqlite.py web/data/studygpt.db
"""
from __future__ import annotations

import asyncio
import json
import os
import sqlite3
import struct
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from app.knowledge.db import create_schema, sessionmaker  # noqa: E402
from app.knowledge.indexing.embedder import embed_texts  # noqa: E402
from app.knowledge.text_hygiene import clean  # noqa: E402
from app.knowledge.models import (  # noqa: E402
    EMBEDDING_DIM,
    Chunk,
    Document,
    DocumentStatus,
    DocumentType,
)

_TYPE = {"pdf": DocumentType.pdf, "url": DocumentType.web}


def decode_embedding(blob: bytes) -> list[float] | None:
    """The old store wrote raw little-endian float32."""
    if not blob or len(blob) % 4:
        return None
    values = list(struct.unpack(f"<{len(blob) // 4}f", blob))
    return values if len(values) == EMBEDDING_DIM else None


async def migrate(db_path: str) -> None:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    await create_schema()
    materials = conn.execute("SELECT * FROM materials").fetchall()
    print(f"{len(materials)} materials")

    async with sessionmaker()() as session:
        for material in materials:
            rows = conn.execute(
                "SELECT * FROM chunks WHERE material_id = ? ORDER BY ordinal",
                (material["id"],),
            ).fetchall()
            if not rows:
                continue

            document = Document(
                workspace_id=material["project_id"],
                title=clean(material["title"]),
                document_type=_TYPE.get(material["source_type"], DocumentType.unknown),
                source_uri=material["source_ref"],
                content=clean(material["text"]),
                # Namespaced so a real re-upload of the same file still
                # deduplicates against its own sha256 rather than this marker.
                content_hash=f"sqlite:{material['id']}",
                status=DocumentStatus.ready,
                doc_metadata={"migrated_from": "sqlite", "material_id": material["id"]},
            )
            session.add(document)
            await session.flush()

            missing: list[tuple[int, str]] = []
            chunks: list[Chunk] = []
            for index, row in enumerate(rows):
                vector = decode_embedding(row["embedding"])
                loc = {}
                if row["loc"]:
                    try:
                        loc = json.loads(row["loc"]) or {}
                    except ValueError:
                        loc = {}
                chunk = Chunk(
                    document_id=document.id,
                    workspace_id=material["project_id"],
                    ordinal=row["ordinal"],
                    content=clean(row["text"]),
                    embedding=vector,
                    loc=loc,
                )
                if vector is None:
                    missing.append((index, row["text"]))
                chunks.append(chunk)

            # A dimension mismatch means that chunk is unsearchable by dense
            # retrieval, so pay to recompute it rather than store a hole.
            if missing:
                vectors = await embed_texts([clean(text) for _, text in missing])
                for (index, _), vector in zip(missing, vectors, strict=True):
                    chunks[index].embedding = vector

            session.add_all(chunks)
            await session.commit()
            print(f"  {material['title'][:60]}: {len(chunks)} chunks"
                  + (f" ({len(missing)} re-embedded)" if missing else ""))

    conn.close()


if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else "web/data/studygpt.db"
    asyncio.run(migrate(path))
