"""Scoring, kept deliberately dumb.

Every number here is computable without a model. An LLM judge is a second
system that can be wrong in correlated ways with the system under test, so the
scorecard stays mechanical: did the right chunk come back, was it near the top,
did the answer cite something real, did the tutor keep quiet when it should.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

# The marker the reasoning model is told to emit: [S:src_doc_7c100]
CITATION = re.compile(r"\[S:([A-Za-z0-9_-]+)\]")

# What counts as a refusal.
#
# The first version of this matched exact sentences and scored a perfectly
# well-behaved tutor at 0.0, because real refusals are phrased freely: "I can't
# find anything about the 1932 Belfast strike in your uploaded materials",
# "This question isn't related to your uploaded course materials, so I can't
# pull an answer from them". The metric was wrong, not the model — which is
# the failure a scorecard can do the most damage with, so these patterns are
# shape-matched and every one of them comes from an answer actually observed.
#
# Still deliberately strict about one thing: the sentence must reference the
# learner's materials. "I'm not sure" is hedging, not abstention.
_MATERIALS = r"your [a-z ]{0,20}materials"
ABSTENTION_PATTERNS = [
    rf"(can'?t|cannot|could ?n'?t|couldn'?t|don'?t|do not) find [^.]{{0,60}}(in|from) {_MATERIALS}",
    rf"(is ?n'?t|is not|not) (in|related to|covered (in|by)|part of) {_MATERIALS}",
    rf"(no|nothing) [^.]{{0,40}} in {_MATERIALS}",
    rf"{_MATERIALS} (do ?n'?t|do not|does ?n'?t|does not) (contain|cover|mention|include)",
    r"can'?t pull [^.]{0,40} from (them|your materials|your uploaded sources|your sources)",
    r"(can'?t|cannot) find that in your uploaded materials",
    # Second round of real phrasings. Every one of these was a correct refusal
    # that the previous patterns scored as a fabrication.
    rf"(falls |is |sits )?outside (the |your )?(scope of )?(the )?({_MATERIALS}|course materials[a-z ]{{0,20}}|your (uploaded )?sources)",
    r"can'?t ground (this|that|it)[^.]{0,40} in your (uploaded )?sources",
    r"none of your [a-z ]{0,30}(notes|materials|sources) (cover|mention|contain|include)",
    r"can'?t find any (mention|record|reference|trace) of",
    r"(do ?n'?t|do not) have a reliable (figure|number|source|answer)",
]

# A refusal that then answers anyway, from the model's own memory. Allowed by
# the prompt when it is labelled as such — but it must be labelled, and we want
# to know how often it happens rather than discovering it in a lesson.
GENERAL_KNOWLEDGE_MARKERS = [
    "from general knowledge",
    "from my general knowledge",
    "outside your materials",
    "not from your materials",
    "general knowledge:",
]


def cited_ids(answer: str) -> set[str]:
    return set(CITATION.findall(answer))


def looks_like_abstention(answer: str) -> bool:
    lowered = answer.lower()
    return any(re.search(pattern, lowered) for pattern in ABSTENTION_PATTERNS)


def answers_from_general_knowledge(answer: str) -> bool:
    """Did it label an out-of-corpus answer as its own knowledge? Only
    meaningful alongside `looks_like_abstention`."""
    lowered = answer.lower()
    return any(marker in lowered for marker in GENERAL_KNOWLEDGE_MARKERS)


def recall_at_k(retrieved: list[int], gold: list[int], k: int) -> float:
    """Fraction of gold chunks present in the top k."""
    if not gold:
        return 0.0
    top = set(retrieved[:k])
    return len([g for g in gold if g in top]) / len(gold)


def reciprocal_rank(retrieved: list[int], gold: list[int]) -> float:
    """1/rank of the first gold chunk, 0 if it never appears."""
    gold_set = set(gold)
    for position, chunk_id in enumerate(retrieved, start=1):
        if chunk_id in gold_set:
            return 1.0 / position
    return 0.0


@dataclass(slots=True)
class CitationScore:
    precision: float
    recall: float
    hallucinated: list[str]


def citation_score(answer: str, offered_ids: set[str], gold_ids: set[str]) -> CitationScore:
    """Precision = of the markers cited, how many were actually offered to the
    model. A marker it invented is a hallucinated source, which is the exact
    failure this project exists to prevent.

    Recall = did it cite the source the question was written from.
    """
    cited = cited_ids(answer)
    if not cited:
        return CitationScore(precision=0.0, recall=0.0, hallucinated=[])
    real = cited & offered_ids
    hallucinated = sorted(cited - offered_ids)
    precision = len(real) / len(cited)
    recall = 1.0 if (gold_ids & cited) else 0.0
    return CitationScore(precision=precision, recall=recall, hallucinated=hallucinated)


def mean(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0
