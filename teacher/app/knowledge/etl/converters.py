"""The two converters, and why there are two.

Docling runs a layout model: it recovers reading order in multi-column pages,
keeps table structure as real markdown tables, OCRs scans, and — the reason it
is here — can export **one page at a time** (`export_to_markdown(page_no=n)`),
which is what makes a page citation truthful.

MarkItDown covers the long tail (EPUB, CSV, JSON, XML, ZIP, YouTube, audio,
images) and is roughly an order of magnitude faster. It returns a document as
one flat markdown string with no page markers, so anything routed here cites at
document level. That is a deliberate trade, not an oversight: see
ARCHITECTURE_V2 §2.5.

Both are lazily imported. Docling pulls torch; a service that only ever ingests
markdown should not pay for that at boot.
"""
from __future__ import annotations

import os

from app.knowledge.etl.types import ConversionError, Page, ParsedDoc
from app.knowledge.models import DocumentType

# Formats where losing the page number, the table grid or the reading order
# would break a citation.
DOCLING_SUFFIXES = {".pdf", ".docx", ".pptx"}

_TYPE_BY_SUFFIX = {
    ".pdf": DocumentType.pdf,
    ".docx": DocumentType.office,
    ".pptx": DocumentType.office,
    ".xlsx": DocumentType.office,
    ".xls": DocumentType.office,
    ".epub": DocumentType.text,
    ".md": DocumentType.text,
    ".txt": DocumentType.text,
    ".csv": DocumentType.text,
    ".json": DocumentType.text,
    ".xml": DocumentType.text,
    ".html": DocumentType.web,
    ".htm": DocumentType.web,
    ".png": DocumentType.image,
    ".jpg": DocumentType.image,
    ".jpeg": DocumentType.image,
    ".mp3": DocumentType.audio,
    ".wav": DocumentType.audio,
    ".m4a": DocumentType.audio,
    ".mp4": DocumentType.video,
}


def document_type_for(suffix: str) -> DocumentType:
    return _TYPE_BY_SUFFIX.get(suffix.lower(), DocumentType.unknown)


class DoclingConverter:
    """Page-accurate conversion. Slow (~2 min per 100 pages on CPU) and worth
    it for anything a student will be asked to turn to."""

    name = "docling"

    def __init__(self) -> None:
        self._converter = None

    def supports(self, suffix: str, mime: str | None = None) -> bool:
        return suffix.lower() in DOCLING_SUFFIXES

    def _engine(self):
        if self._converter is None:
            from docling.document_converter import DocumentConverter

            self._converter = DocumentConverter()
        return self._converter

    def convert(self, path: str, mime: str | None = None) -> ParsedDoc:
        try:
            result = self._engine().convert(path)
            doc = result.document
        except Exception as exc:  # docling raises a zoo of format-specific errors
            raise ConversionError(f"docling failed on {os.path.basename(path)}: {exc}") from exc

        pages: list[Page] = []
        for page_no in range(1, (doc.num_pages() or 0) + 1):
            try:
                text = doc.export_to_markdown(page_no=page_no)
            except Exception:
                text = ""
            pages.append(Page(number=page_no, text=text))

        markdown = doc.export_to_markdown()
        suffix = os.path.splitext(path)[1]
        return ParsedDoc(
            markdown=markdown,
            # Deliberately not falling back to the path: converters run against
            # a temp file, so a path-derived title would name the temp file.
            title=(doc.name or ""),
            pages=[p for p in pages if p.text.strip()],
            document_type=document_type_for(suffix),
            meta={"page_count": doc.num_pages()},
            converter=self.name,
        )


class MarkItDownConverter:
    """Everything else. Fast, wide, no page provenance."""

    name = "markitdown"

    def __init__(self) -> None:
        self._md = None

    def supports(self, suffix: str, mime: str | None = None) -> bool:
        return True  # the fallback of last resort

    def _engine(self):
        if self._md is None:
            from markitdown import MarkItDown

            self._md = MarkItDown(enable_plugins=False)
        return self._md

    def convert(self, path: str, mime: str | None = None) -> ParsedDoc:
        try:
            result = self._engine().convert(path)
        except Exception as exc:
            raise ConversionError(
                f"markitdown failed on {os.path.basename(path)}: {exc}"
            ) from exc
        suffix = os.path.splitext(path)[1]
        return ParsedDoc(
            markdown=result.markdown or "",
            title=(result.title or ""),
            pages=[],
            document_type=document_type_for(suffix),
            converter=self.name,
        )
