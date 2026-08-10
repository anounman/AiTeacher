"""Chunking must not lose text. A sentence that exists in the document and in
no chunk is a fact the tutor can never cite."""
from app.knowledge.indexing.chunker import split_table_aware

SHORT_TAIL = """A reasonably long opening paragraph that comfortably exceeds the
minimum chunk size on its own, describing the experiment in enough words.

Q.E.D.
"""


def test_short_trailing_paragraph_is_merged_not_dropped():
    chunks = split_table_aware(SHORT_TAIL)
    assert any("Q.E.D." in c for c in chunks), chunks


def test_every_sentence_survives_chunking():
    doc = "\n\n".join(f"Sentence number {i} explains one separate idea." for i in range(40))
    chunks = split_table_aware(doc)
    joined = " ".join(chunks)
    for i in range(40):
        assert f"Sentence number {i} " in joined
