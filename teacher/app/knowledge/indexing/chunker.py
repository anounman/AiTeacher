"""Chunking that keeps provenance.

Two properties matter more than chunk quality metrics:

1. A markdown table is never split. A half table is worse than no table — the
   header row is what makes the numbers mean anything.
2. Every chunk knows the page and line range it came from, so a citation can
   point at a location a student can actually turn to.

Derived from SurfSense's `document_chunker.py` (Apache-2.0, see NOTICE); the
page-provenance half is ours.
"""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass

from app.knowledge.etl.types import Page

# A markdown table block: consecutive lines that start with an optional indent
# then a pipe. Ends at the first line that does not.
_TABLE_BLOCK = re.compile(r"(?:(?:^|\n)(?=[ \t]*\|)(?:[ \t]*\|[^\n]*\n?)+)", re.MULTILINE)

TARGET_CHARS = 1200
OVERLAP_CHARS = 150
MIN_CHARS = 80


@dataclass(slots=True)
class TextChunk:
    text: str
    ordinal: int
    loc: dict

    @property
    def hash(self) -> str:
        return hashlib.sha256(self.text.encode("utf-8")).hexdigest()


def _split_prose(text: str) -> list[str]:
    """Paragraph-first, sentence-second, greedy-merge to TARGET_CHARS with a
    tail overlap so a fact spanning a boundary survives in both chunks."""
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]

    pieces: list[str] = []
    for para in paragraphs:
        if len(para) <= TARGET_CHARS * 1.5:
            pieces.append(para)
            continue
        buf = ""
        for sentence in re.split(r"(?<=[.!?])\s+", para):
            if buf and len(buf) + len(sentence) + 1 > TARGET_CHARS:
                pieces.append(buf.strip())
                buf = sentence
            else:
                buf = f"{buf} {sentence}".strip() if buf else sentence
        if buf.strip():
            pieces.append(buf.strip())

    chunks: list[str] = []
    cur = ""
    for piece in pieces:
        if cur and len(cur) + len(piece) + 2 > TARGET_CHARS:
            chunks.append(cur)
            tail = cur[-OVERLAP_CHARS:]
            cur = f"{tail}\n\n{piece}" if tail else piece
        else:
            cur = f"{cur}\n\n{piece}" if cur else piece
    if cur.strip():
        chunks.append(cur.strip())

    # A chunk too short to retrieve well is merged backwards, never dropped —
    # dropping it would lose the only copy of that sentence from the corpus.
    merged: list[str] = []
    for chunk in chunks:
        if merged and len(chunk) < MIN_CHARS:
            merged[-1] = f"{merged[-1]}\n\n{chunk}"
        else:
            merged.append(chunk)
    return merged


def split_table_aware(text: str) -> list[str]:
    """Prose is chunked; every markdown table is emitted whole, in order."""
    out: list[str] = []
    cursor = 0
    for match in _TABLE_BLOCK.finditer(text):
        prose = text[cursor : match.start()].strip()
        if prose:
            out.extend(_split_prose(prose))
        table = match.group(0).strip()
        if table:
            out.append(table)
        cursor = match.end()
    trailing = text[cursor:].strip()
    if trailing:
        out.extend(_split_prose(trailing))
    return out


def _line_spans(text: str, chunks: list[str]) -> list[tuple[int, int]]:
    """1-based inclusive line range for each chunk.

    Chunks arrive in document order, so a left-to-right cursor resolves each
    one unambiguously even in a document that repeats a line.
    """
    spans: list[tuple[int, int]] = []
    cursor = 0
    cursor_line = 1
    for chunk in chunks:
        found = text.find(chunk, cursor)
        start = found if found >= 0 else cursor
        start_line = cursor_line + text.count("\n", cursor, start)
        end = start + len(chunk)
        end_line = start_line + text.count("\n", start, max(end - 1, start))
        spans.append((start_line, end_line))
        cursor_line = start_line + text.count("\n", start, end)
        cursor = end
    return spans


def chunk_document(markdown: str, pages: list[Page] | None = None) -> list[TextChunk]:
    """Chunk a converted document.

    With pages, each page is chunked separately so a chunk can never straddle
    a page boundary and claim two locations at once. Without pages (a web page,
    a CSV), chunks carry line spans only and citations resolve to the document.
    """
    out: list[TextChunk] = []
    ordinal = 0

    if pages:
        for page in pages:
            text = page.text.strip()
            if not text:
                continue
            texts = split_table_aware(text)
            for chunk_text, (start, end) in zip(texts, _line_spans(text, texts), strict=True):
                out.append(
                    TextChunk(
                        text=chunk_text,
                        ordinal=ordinal,
                        loc={"page": page.number, "lines": [start, end]},
                    )
                )
                ordinal += 1
        return out

    texts = split_table_aware(markdown)
    for chunk_text, (start, end) in zip(texts, _line_spans(markdown, texts), strict=True):
        out.append(TextChunk(text=chunk_text, ordinal=ordinal, loc={"lines": [start, end]}))
        ordinal += 1
    return out
