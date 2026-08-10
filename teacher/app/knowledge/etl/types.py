"""The parser boundary.

One shape comes out of every converter, whatever went in. Everything
downstream — chunking, indexing, citation — depends on this and on nothing
about the file it came from.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol, runtime_checkable

from app.knowledge.models import DocumentType


@dataclass(slots=True)
class Page:
    """One physical page. `number` is 1-based, matching what a student sees
    printed on the paper — an off-by-one here is a wrong citation."""

    number: int
    text: str


@dataclass(slots=True)
class ParsedDoc:
    markdown: str
    title: str = ""
    # Empty when the format has no page concept (a web page, a CSV). Citations
    # then resolve to the document, not a page — which the evidence envelope
    # must state rather than fake.
    pages: list[Page] = field(default_factory=list)
    document_type: DocumentType = DocumentType.unknown
    meta: dict = field(default_factory=dict)
    # Which converter produced this, for debugging a bad citation later.
    converter: str = ""

    @property
    def has_page_provenance(self) -> bool:
        return len(self.pages) > 0


@runtime_checkable
class Converter(Protocol):
    """Two implementations today: Docling where page provenance and table
    structure matter, MarkItDown for the long tail of formats."""

    name: str

    def supports(self, suffix: str, mime: str | None) -> bool: ...

    def convert(self, path: str, mime: str | None = None) -> ParsedDoc: ...


class ConversionError(RuntimeError):
    pass
