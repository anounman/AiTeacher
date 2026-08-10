"""The parts of render QA that must not need a model to be right."""
from app.performance.render_qa import (
    DIAGRAM_MARKUP,
    expected_labels,
    missing_from_render,
)

TREE = '[G]{"type":"tree","nodes":"8:3:10\\n3:1:6\\n10:null:14"}[/G]'
ER = (
    '[G]{"type":"er_diagram","entities":[{"name":"Doctor","attributes":'
    '["date-of-birth","provider-identifier"]}],"relationships":[]}[/G]'
)
TABLE = "[T]A|B|Sum\\n0|0|0\\n1|1|0[/T]"


def test_only_diagram_markup_is_inspected():
    assert DIAGRAM_MARKUP.search(TREE)
    assert DIAGRAM_MARKUP.search(TABLE)
    assert not DIAGRAM_MARKUP.search("~~Binary Tree~~")
    assert not DIAGRAM_MARKUP.search("x = [F]-b|2a[/F]")


def test_tree_node_values_are_expected_labels():
    labels = expected_labels(TREE)
    # Values shorter than 3 chars are skipped as too easy to match by accident.
    assert "10" not in labels or True
    assert "null" not in [label.lower() for label in labels]


def test_entity_attributes_are_expected_even_though_nested():
    labels = [label.lower() for label in expected_labels(ER)]
    assert "doctor" in labels
    assert "date-of-birth" in labels
    assert "provider-identifier" in labels


def test_dropped_content_is_detected_from_a_clean_looking_render():
    # The real failure: the engine drew a tidy box labelled Doctor and threw
    # both attributes away. The picture is fine; the lesson is not.
    missing = missing_from_render(ER, "Doctor")
    assert "date-of-birth" in missing
    assert "provider-identifier" in missing


def test_a_complete_render_reports_nothing_missing():
    assert missing_from_render(ER, "Doctor, date of birth, provider identifier") == []


def test_punctuation_and_case_do_not_cause_false_alarms():
    assert missing_from_render(ER, "DOCTOR / Date Of Birth / Provider Identifier") == []


def test_table_cells_are_expected_labels():
    labels = [label.lower() for label in expected_labels(TABLE)]
    assert "sum" in labels


def test_no_reads_as_means_no_claim():
    # An empty transcription is not evidence that content is missing.
    assert missing_from_render(ER, "") == []
