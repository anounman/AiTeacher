"""The gold set: questions whose correct source we already know.

Two kinds of item, and the second is the one that catches the failure people
actually notice:

  answerable   — a question written *from* a specific chunk, so that chunk is
                 the gold source by construction. Scores retrieval and whether
                 the answer cites the thing it was taken from.
  unanswerable — a question about something the corpus does not contain. The
                 only correct behaviour is to say so. A tutor that invents an
                 answer here is worse than one that stays quiet, and nothing
                 else in the scorecard would notice.

Stored as JSONL so a human can open it, fix a bad question, and delete a line
without a migration. Generated items are marked `generated: true` until
someone reviews them — a scorecard that grades itself against its own
inventions should say so out loud.
"""
from __future__ import annotations

import json
import pathlib
from dataclasses import asdict, dataclass, field


@dataclass(slots=True)
class GoldItem:
    id: str
    question: str
    workspace_id: str
    # Empty for unanswerable items — that is what makes them unanswerable.
    gold_chunk_ids: list[int] = field(default_factory=list)
    gold_document_id: int | None = None
    # What a correct answer should contain, for eyeballing. Not auto-scored:
    # string overlap with a reference answer measures paraphrase, not truth.
    reference_answer: str = ""
    kind: str = "answerable"  # answerable | unanswerable
    generated: bool = True
    reviewed: bool = False

    @property
    def is_trap(self) -> bool:
        return self.kind == "unanswerable"


def load(path: str | pathlib.Path) -> list[GoldItem]:
    items: list[GoldItem] = []
    for line in pathlib.Path(path).read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("//"):
            continue
        items.append(GoldItem(**json.loads(line)))
    return items


def save(items: list[GoldItem], path: str | pathlib.Path) -> None:
    target = pathlib.Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("\n".join(json.dumps(asdict(item)) for item in items) + "\n")
