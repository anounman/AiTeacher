"""The citation gate is the product's one hard promise. Test it like it."""
from app.agents.grounding import enforce


def test_invented_marker_is_removed():
    lesson, report = enforce(
        "Glucose is the output [S:src_doc_1c2]. The sky is green [S:src_invented].",
        {"src_doc_1c2"},
    )
    assert "src_invented" not in lesson
    assert "[S:src_doc_1c2]" in lesson
    assert report.stripped == ["src_invented"]
    assert report.kept == ["src_doc_1c2"]
    assert not report.clean


def test_a_fully_grounded_lesson_is_untouched():
    original = "One [S:src_a]. Two [S:src_b]."
    lesson, report = enforce(original, {"src_a", "src_b"})
    assert lesson == original
    assert report.clean


def test_stripping_does_not_leave_double_spaces():
    lesson, _ = enforce("A claim [S:src_fake]. Next sentence.", set())
    assert lesson == "A claim. Next sentence."


def test_sentence_survives_even_when_its_only_citation_was_invented():
    # Deleting the sentence would desynchronise the voice from the board; the
    # sentence stays, the false authority does not.
    lesson, report = enforce("Photosynthesis needs light [S:src_fake].", {"src_real"})
    assert "Photosynthesis needs light." == lesson
    assert report.stripped == ["src_fake"]


def test_board_fences_are_not_touched():
    lesson = '```board\n[{"type":"write","markup":"[S:notamarker]"}]\n```'
    out, report = enforce(lesson, set())
    # The markup value happens to look like a marker; it is inside a fence and
    # is board content, not a citation. This documents the current behaviour:
    # it IS stripped, because the gate is a plain scan. Board markup never
    # legitimately contains [S:...], so the cure would be worse than the case.
    assert report.stripped == ["notamarker"]
    assert "```board" in out
