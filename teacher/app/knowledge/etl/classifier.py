"""Route a file to the converter that can serve its citations.

Extension first, magic bytes second: a `.txt` that is really a PDF must not be
chunked as prose, and a PDF is exactly the case where we care most.
"""
from __future__ import annotations

import os

from app.knowledge.etl.converters import DoclingConverter, MarkItDownConverter
from app.knowledge.etl.types import ConversionError, Converter, ParsedDoc

_MAGIC = {
    b"%PDF": ".pdf",
    b"PK\x03\x04": ".zip",  # docx/pptx/xlsx/epub are all zips — extension decides
}


def sniff_suffix(path: str) -> str:
    suffix = os.path.splitext(path)[1].lower()
    try:
        with open(path, "rb") as handle:
            head = handle.read(8)
    except OSError:
        return suffix
    for magic, real in _MAGIC.items():
        if head.startswith(magic) and real == ".pdf":
            return ".pdf"
    return suffix


class ConverterRegistry:
    """Ordered: the first converter that claims the file wins, MarkItDown
    catches everything nobody claimed."""

    def __init__(self, converters: list[Converter] | None = None) -> None:
        self.converters: list[Converter] = converters or [
            DoclingConverter(),
            MarkItDownConverter(),
        ]

    def pick(self, path: str) -> Converter:
        suffix = sniff_suffix(path)
        for converter in self.converters:
            if converter.supports(suffix):
                return converter
        raise ConversionError(f"no converter for {suffix or path}")

    def convert(self, path: str) -> ParsedDoc:
        """Convert, and fall back to the next converter if the chosen one dies.

        A student who uploads a malformed PDF should get degraded text, not an
        error — docling failing is not a reason to have no document at all.
        """
        chosen = self.pick(path)
        try:
            return chosen.convert(path)
        except ConversionError:
            for converter in self.converters:
                if converter is chosen:
                    continue
                try:
                    parsed = converter.convert(path)
                    parsed.meta = {**parsed.meta, "fallback_from": chosen.name}
                    return parsed
                except ConversionError:
                    continue
            raise


registry = ConverterRegistry()
