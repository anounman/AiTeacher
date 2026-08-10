"""The citation gate.

Runs OUTSIDE the agents, between the teaching plane and the performance plane.
An agent is not trusted to police its own citations: the whole point of the
product is that a claim is either traceable to the student's material or
explicitly labelled as not being in it, and "the model promised to behave" is
not a mechanism.

Two things happen here:

  1. Any [S:marker] the model invented — one not present in the evidence it was
     given — is removed. A fabricated citation is worse than no citation,
     because it reads as verified.
  2. If every marker in a sentence was fabricated, the sentence keeps its text
     but loses its authority; we do not delete it, because silently dropping a
     sentence mid-lesson leaves the voice and the board out of step. The report
     records it so the eval harness can count it.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

MARKER = re.compile(r"\s*\[S:([A-Za-z0-9_-]+)\]")


@dataclass(slots=True)
class GroundingReport:
    kept: list[str] = field(default_factory=list)
    stripped: list[str] = field(default_factory=list)

    @property
    def clean(self) -> bool:
        return not self.stripped


def enforce(lesson: str, allowed_ids: set[str]) -> tuple[str, GroundingReport]:
    """Return the lesson with invented markers removed, plus what was removed."""
    report = GroundingReport()

    def replace(match: re.Match[str]) -> str:
        marker_id = match.group(1)
        if marker_id in allowed_ids:
            report.kept.append(marker_id)
            return match.group(0)
        report.stripped.append(marker_id)
        return ""

    return MARKER.sub(replace, lesson), report
