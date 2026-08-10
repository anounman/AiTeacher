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

# Phrases that count as a refusal. Kept short and literal: a fuzzy matcher here
# would quietly award points for hedging.
ABSTENTION_PATTERNS = [
    "can't find that in your uploaded materials",
    "cannot find that in your uploaded materials",
    "not in your materials",
    "isn't in your materials",
    "is not in your materials",
    "don't have that in your materials",
]


def cited_ids(answer: str) -> set[str]:
    return set(CITATION.findall(answer))


def looks_like_abstention(answer: str) -> bool:
    lowered = answer.lower()
    return any(pattern in lowered for pattern in ABSTENTION_PATTERNS)


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
