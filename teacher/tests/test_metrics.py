"""The scorer has to be right before any number it prints means anything."""
from app.evals.metrics import (
    cited_ids,
    citation_score,
    looks_like_abstention,
    recall_at_k,
    reciprocal_rank,
)


def test_recall_counts_only_the_top_k():
    assert recall_at_k([9, 4, 7], [7], 2) == 0.0
    assert recall_at_k([9, 4, 7], [7], 3) == 1.0
    assert recall_at_k([1, 2], [1, 2], 2) == 1.0
    assert recall_at_k([1, 3], [1, 2], 2) == 0.5


def test_reciprocal_rank_is_zero_when_gold_never_appears():
    assert reciprocal_rank([5, 6, 7], [1]) == 0.0
    assert reciprocal_rank([5, 1, 7], [1]) == 0.5
    assert reciprocal_rank([1], [1]) == 1.0


def test_invented_citation_markers_are_caught():
    answer = "Glucose [S:src_doc_1c2] and also [S:src_made_up]."
    score = citation_score(answer, offered_ids={"src_doc_1c2"}, gold_ids={"src_doc_1c2"})
    assert score.precision == 0.5
    assert score.recall == 1.0
    assert score.hallucinated == ["src_made_up"]


def test_an_uncited_answer_scores_zero_not_one():
    # The failure mode being guarded: a confident answer with no marker at all
    # must not read as "no wrong citations, therefore perfect".
    score = citation_score("Glucose.", offered_ids={"src_doc_1c2"}, gold_ids={"src_doc_1c2"})
    assert score.precision == 0.0
    assert score.recall == 0.0


def test_citing_a_real_but_wrong_source_keeps_precision_and_loses_recall():
    score = citation_score(
        "Something [S:src_doc_9c9].",
        offered_ids={"src_doc_9c9", "src_doc_1c2"},
        gold_ids={"src_doc_1c2"},
    )
    assert score.precision == 1.0
    assert score.recall == 0.0


def test_abstention_matches_the_phrasing_the_prompt_asks_for():
    assert looks_like_abstention("I can't find that in your uploaded materials.")
    assert looks_like_abstention("That is not in your materials — want to add a source?")
    assert not looks_like_abstention("The Calvin cycle produces glucose.")
    # Hedging is not abstention.
    assert not looks_like_abstention("I think it might be around 40 percent, roughly.")


def test_marker_extraction_ignores_prose_brackets():
    assert cited_ids("see [S:src_a] and [not a marker] and [S:src_b]") == {"src_a", "src_b"}
