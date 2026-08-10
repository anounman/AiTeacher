"""Storage schema for the knowledge plane.

Every row is workspace-scoped even though we ship single-user — retrofitting
tenancy is expensive, carrying it is free (ARCHITECTURE_V2 §8).

Provenance is the point of this schema. A chunk knows its document, its page,
and its line span, because a citation that cannot be resolved back to a
verbatim location is not a citation.
"""
from __future__ import annotations

import enum
from datetime import UTC, datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    JSON,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

# nomic-embed-text. Changing this is a migration, not a config tweak: the
# column type carries the dimension.
EMBEDDING_DIM = 768


class Base(DeclarativeBase):
    type_annotation_map = {dict: JSONB().with_variant(JSON, "sqlite")}


def _now() -> datetime:
    return datetime.now(UTC)


class DocumentStatus(str, enum.Enum):
    pending = "pending"
    parsing = "parsing"
    indexing = "indexing"
    ready = "ready"
    error = "error"
    deleting = "deleting"


class DocumentType(str, enum.Enum):
    pdf = "pdf"
    office = "office"       # docx, pptx, xlsx
    text = "text"           # md, txt, csv, json, code
    web = "web"
    image = "image"
    audio = "audio"
    video = "video"
    unknown = "unknown"


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[int] = mapped_column(primary_key=True)
    # The web app's project id. A string, so there is no mapping table
    # between "project" over there and "workspace" over here.
    workspace_id: Mapped[str] = mapped_column(String(64), index=True)
    title: Mapped[str] = mapped_column(String(1024), default="")
    document_type: Mapped[DocumentType] = mapped_column(
        Enum(DocumentType, native_enum=False), default=DocumentType.unknown
    )
    source_uri: Mapped[str | None] = mapped_column(String(2048), default=None)

    # Full converted markdown. Kept so re-chunking never needs the original
    # file — reparsing a scanned PDF costs minutes, rechunking costs nothing.
    content: Mapped[str] = mapped_column(Text, default="")
    # sha256 of the source bytes. Re-ingesting an unchanged file is a no-op.
    content_hash: Mapped[str] = mapped_column(String(64), index=True, default="")

    status: Mapped[DocumentStatus] = mapped_column(
        Enum(DocumentStatus, native_enum=False), default=DocumentStatus.pending, index=True
    )
    error: Mapped[str | None] = mapped_column(Text, default=None)
    doc_metadata: Mapped[dict] = mapped_column("metadata", default=dict)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )

    chunks: Mapped[list[Chunk]] = relationship(
        back_populates="document", cascade="all, delete-orphan", passive_deletes=True
    )

    __table_args__ = (
        UniqueConstraint("workspace_id", "content_hash", name="uq_document_hash"),
        Index("ix_documents_workspace_status", "workspace_id", "status"),
    )


class Chunk(Base):
    __tablename__ = "chunks"

    id: Mapped[int] = mapped_column(primary_key=True)
    document_id: Mapped[int] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), index=True
    )
    workspace_id: Mapped[str] = mapped_column(String(64), index=True)
    ordinal: Mapped[int] = mapped_column(Integer, default=0)

    content: Mapped[str] = mapped_column(Text)
    embedding: Mapped[list[float] | None] = mapped_column(Vector(EMBEDDING_DIM), default=None)

    # Where this text physically lives: {"page": 14, "lines": [3, 19]} for a
    # document, {"t": 872} for a transcript. This is what a citation resolves.
    loc: Mapped[dict] = mapped_column(default=dict)
    # sha256 of content — lets a re-index keep chunks whose text did not move.
    chunk_hash: Mapped[str] = mapped_column(String(64), index=True, default="")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    document: Mapped[Document] = relationship(back_populates="chunks")

    __table_args__ = (
        Index("ix_chunks_workspace_doc", "workspace_id", "document_id"),
        # Full-text search index. Expression must match the query side exactly
        # (retrieval/hybrid.py builds the same to_tsvector('english', content)),
        # or Postgres silently sequential-scans instead of using this.
        # Written as raw SQL because SQLAlchemy cannot render the 'english'
        # regconfig as a DDL literal through func.to_tsvector.
        Index(
            "ix_chunks_fts",
            text("to_tsvector('english', content)"),
            postgresql_using="gin",
        ),
    )
