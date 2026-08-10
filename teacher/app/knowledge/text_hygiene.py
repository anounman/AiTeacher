"""Text that Postgres will actually accept.

PDF text layers routinely carry NUL bytes and other C0 control characters.
Postgres `text` rejects 0x00 outright (`invalid byte sequence for encoding
"UTF8": 0x00`), and the rest are invisible noise that survives into a citation
quote. Strip them once, at the boundary, so no caller has to remember.
"""
import re

# Everything in C0 except tab, newline, carriage return.
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def clean(text: str | None) -> str:
    if not text:
        return ""
    return _CONTROL.sub("", text)
