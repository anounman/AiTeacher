"""The two properties that make a chunk citable: tables survive whole, and
every chunk reports where it came from."""
from app.knowledge.etl.types import Page
from app.knowledge.indexing.chunker import chunk_document, split_table_aware

TABLE_DOC = """Intro prose about the experiment and what it measured.

| Stage | Location | Output |
| --- | --- | --- |
| Light | Thylakoid | ATP |
| Calvin | Stroma | Glucose |

Closing prose that follows the table and explains it.
"""


def test_table_is_never_split():
    chunks = split_table_aware(TABLE_DOC)
    tables = [c for c in chunks if c.lstrip().startswith("|")]
    assert len(tables) == 1, chunks
    # header, separator, and both data rows travel together
    assert tables[0].count("\n") == 3
    assert "Calvin" in tables[0] and "Stage" in tables[0]


def test_line_spans_are_1_based_and_ordered():
    chunks = chunk_document(TABLE_DOC)
    assert chunks[0].loc["lines"][0] == 1
    starts = [c.loc["lines"][0] for c in chunks]
    assert starts == sorted(starts)


def test_page_chunks_never_straddle_a_page():
    pages = [Page(1, "Kinematics.\n\nVelocity is displacement over time."),
             Page(2, "Momentum.\n\nMomentum is mass times velocity.")]
    chunks = chunk_document("", pages)
    assert {c.loc["page"] for c in chunks} == {1, 2}
    for chunk in chunks:
        # A chunk claiming page 2 must not contain page 1's text.
        other = "Velocity" if chunk.loc["page"] == 2 else "Momentum"
        assert other not in chunk.text


def test_ordinals_are_dense_and_document_ordered():
    chunks = chunk_document(TABLE_DOC)
    assert [c.ordinal for c in chunks] == list(range(len(chunks)))


def test_repeated_line_does_not_confuse_spans():
    text = "same line\n\nfiller paragraph here\n\nsame line\n"
    chunks = chunk_document(text)
    starts = [c.loc["lines"][0] for c in chunks]
    assert len(set(starts)) == len(starts), starts
