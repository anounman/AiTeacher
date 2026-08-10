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


# Verbatim from real trap answers. The first version of the detector matched
# fixed sentences and scored both of these as failures to abstain, which would
# have sent us hunting a model bug that did not exist.
REAL_ABSTENTIONS = [
    "I can't find anything about the 1932 Belfast harbour workers' strike in your "
    "uploaded materials — those are all about computer system architecture.",
    "This question isn't related to your uploaded course materials — those cover "
    "computer architecture, digital circuits, adders, and similar topics. So I "
    "can't pull an answer from them.",
    "I can't find that in your uploaded materials.",
    "That is not in your materials — want to add a source?",
    "There's nothing about axolotls in your uploaded materials.",
    "Your materials don't cover medieval falconry.",
    # Second round, also verbatim. The detector matched none of these at first
    # and reported a tutor that was refusing correctly as a fabricator.
    "That's a great question, but it falls outside the course materials I have "
    "available. So I can't pull this from your uploaded sources.",
    "This is a great historical question, but it falls outside the scope of your "
    "uploaded course materials. So I can't ground this answer in your sources.",
    "I don't have a reliable figure for the average annual rainfall on Bouvet Island.",
    "None of your lecture notes cover the mating rituals of the axolotl.",
    "I've searched through your uploaded course materials and I can't find any "
    "mention of the price of tin in 1873.",
    "I can't find any record of an assignment about medieval falconry.",
]

NOT_ABSTENTIONS = [
    "The Calvin cycle produces glucose.",
    "I think it might be around 40 percent, roughly.",
    "I'm not certain about the exact figure.",
    "Your materials describe three register flavors in Chisel.",
]


def test_real_refusal_phrasings_are_recognised():
    for answer in REAL_ABSTENTIONS:
        assert looks_like_abstention(answer), answer


def test_hedging_and_normal_answers_are_not_abstentions():
    for answer in NOT_ABSTENTIONS:
        assert not looks_like_abstention(answer), answer


def test_labelled_general_knowledge_is_detected_separately():
    from app.evals.metrics import answers_from_general_knowledge

    answer = (
        "This isn't in your materials. From general knowledge, a Sumatran rhino "
        "calf weighs around 25-30 kg at birth."
    )
    assert looks_like_abstention(answer)
    assert answers_from_general_knowledge(answer)
    assert not answers_from_general_knowledge("It weighs about 25 kg.")


def test_marker_extraction_ignores_prose_brackets():
    assert cited_ids("see [S:src_a] and [not a marker] and [S:src_b]") == {"src_a", "src_b"}
