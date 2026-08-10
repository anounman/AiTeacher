"""Draft a gold set from the corpus itself.

A question written *from* a chunk has that chunk as its correct source by
construction, which is what makes retrieval scoring possible without anyone
hand-labelling 200 items. The questions are still model-written, so every item
is marked `generated: true` until a human flips `reviewed`. The scorecard
reports both counts; a number computed entirely against machine-written
questions should never be mistaken for a number a person vouched for.

Traps are the other half and cannot be generated from the corpus — a question
the corpus can answer is not a trap. They come from a fixed out-of-domain list,
so "does it admit ignorance" is measured against material we know is absent.

    teacher/.venv/bin/python -m app.evals.generate --workspace <id> --n 120
"""
from __future__ import annotations

import argparse
import asyncio
import json
import random

from sqlalchemy import func, select

from app.evals.dataset import GoldItem, save
from app.knowledge.db import sessionmaker
from app.knowledge.models import Chunk
from app.llm import chat

PROMPT = """You are building an exam for a study tutor.

Below is one excerpt from a student's own course material. Write ONE question
that this excerpt answers completely, and the short correct answer.

Rules:
- The question must be answerable from THIS excerpt alone.
- Do not mention "the excerpt", "the text", or "the passage" — ask it the way a
  student would ask it out loud.
- If the excerpt is boilerplate (a title page, a table of contents, a header,
  page numbers, references), reply exactly: SKIP

Reply as JSON: {"question": "...", "answer": "..."}

EXCERPT:
```
%s
```"""

# Deliberately outside any plausible course corpus: a correct system says it
# cannot find these, no matter how confidently it could guess.
TRAPS = [
    "What was the attendance at the 1932 Belfast harbour workers' strike?",
    "How much does a Sumatran rhinoceros calf weigh at birth?",
    "Which chef invented the Wellington potato terrine in 1961?",
    "What is the boiling point of ununseptium at 3 atmospheres?",
    "How many bridges did Königsberg have after the 1945 reconstruction?",
    "What is the average annual rainfall on Bouvet Island in millimetres?",
    "Which of my lecture notes covers the mating rituals of the axolotl?",
    "What did my professor say about the price of tin in 1873?",
    "How does this course define the Krankheim-Rossi stability bound?",
    "What grade did I get on the assignment about medieval falconry?",
]


async def draft_from_chunk(chunk_id: int, text: str, workspace_id: str) -> GoldItem | None:
    raw = await chat(
        [{"role": "user", "content": PROMPT % text[:2500]}],
        slot_name="reason",
        json_mode=True,
    )
    if "SKIP" in raw[:80].upper():
        return None
    try:
        parsed = json.loads(raw)
    except ValueError:
        return None
    question = (parsed.get("question") or "").strip()
    answer = (parsed.get("answer") or "").strip()
    if len(question) < 12:
        return None
    return GoldItem(
        id=f"a{chunk_id}",
        question=question,
        workspace_id=workspace_id,
        gold_chunk_ids=[chunk_id],
        reference_answer=answer,
        kind="answerable",
    )


async def build(workspace_id: str, n: int, out_path: str, seed: int = 7) -> list[GoldItem]:
    async with sessionmaker()() as session:
        rows = (
            await session.execute(
                select(Chunk.id, Chunk.content)
                .where(Chunk.workspace_id == workspace_id)
                # Short chunks are page furniture, not teachable content.
                .where(func.length(Chunk.content) > 400)
            )
        ).all()

    if not rows:
        raise SystemExit(f"no chunks in workspace {workspace_id}")

    random.Random(seed).shuffle(rows)
    picked = rows[: n * 2]  # oversample: some come back SKIP

    items: list[GoldItem] = []
    # Bounded concurrency — a cloud reason model will happily rate-limit us.
    semaphore = asyncio.Semaphore(4)

    async def one(chunk_id: int, text: str) -> None:
        if len(items) >= n:
            return
        async with semaphore:
            try:
                item = await draft_from_chunk(chunk_id, text, workspace_id)
            except Exception as exc:
                print(f"  chunk {chunk_id}: {type(exc).__name__}")
                return
        if item and len(items) < n:
            items.append(item)
            if len(items) % 10 == 0:
                print(f"  {len(items)}/{n}")

    await asyncio.gather(*(one(cid, text) for cid, text in picked))

    items.extend(
        GoldItem(
            id=f"t{index}",
            question=question,
            workspace_id=workspace_id,
            kind="unanswerable",
            reference_answer="Not in the uploaded materials.",
        )
        for index, question in enumerate(TRAPS)
    )
    save(items, out_path)
    answerable = len([i for i in items if not i.is_trap])
    print(f"wrote {answerable} answerable + {len(TRAPS)} traps -> {out_path}")
    return items


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--n", type=int, default=120)
    parser.add_argument("--out", default="teacher/evals/gold.jsonl")
    args = parser.parse_args()
    asyncio.run(build(args.workspace, args.n, args.out))
