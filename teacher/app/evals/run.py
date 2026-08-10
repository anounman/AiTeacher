"""The scorecard.

Two passes, because they fail for different reasons and you want to know which:

  retrieval — did the right chunk come back, and how near the top. Runs against
              the knowledge plane directly. No model, no network beyond the
              embedder, so it is fast enough to run on every change.
  answers   — did the tutor cite something real, cite the right thing, and keep
              quiet when the corpus cannot answer. Runs against the live chat
              endpoint, so it measures the system a student actually talks to.

Answers are off by default (`--answers`), because a full pass is a few hundred
model calls.

    teacher/.venv/bin/python -m app.evals.run --gold teacher/evals/gold.jsonl
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import time

import httpx

from app.evals.dataset import GoldItem, load
from app.evals.metrics import (
    answers_from_general_knowledge,
    citation_score,
    looks_like_abstention,
    mean,
    recall_at_k,
    reciprocal_rank,
)
from app.knowledge.db import sessionmaker
from app.knowledge.indexing.embedder import embed_query
from app.knowledge.retrieval.hybrid import hybrid_search

WEB_URL = os.environ.get("WEB_URL", "http://localhost:3000")
TOP_K = 20


async def score_retrieval(items: list[GoldItem]) -> dict:
    answerable = [item for item in items if not item.is_trap]
    r1: list[float] = []
    r5: list[float] = []
    r20: list[float] = []
    rr: list[float] = []
    latencies: list[float] = []
    misses: list[dict] = []

    async with sessionmaker()() as session:
        for item in answerable:
            started = time.perf_counter()
            embedding = await embed_query(item.question)
            hits = await hybrid_search(
                session, item.question, embedding, item.workspace_id, top_k=TOP_K
            )
            latencies.append((time.perf_counter() - started) * 1000)
            retrieved = [hit.chunk_id for hit in hits]
            r1.append(recall_at_k(retrieved, item.gold_chunk_ids, 1))
            r5.append(recall_at_k(retrieved, item.gold_chunk_ids, 5))
            r20.append(recall_at_k(retrieved, item.gold_chunk_ids, 20))
            rank = reciprocal_rank(retrieved, item.gold_chunk_ids)
            rr.append(rank)
            if rank == 0.0:
                misses.append({"id": item.id, "question": item.question[:100]})

    return {
        "n": len(answerable),
        "recall@1": round(mean(r1), 3),
        "recall@5": round(mean(r5), 3),
        "recall@20": round(mean(r20), 3),
        "mrr": round(mean(rr), 3),
        "p50_ms": round(sorted(latencies)[len(latencies) // 2], 1) if latencies else 0,
        "misses": misses[:10],
        "miss_count": len(misses),
    }


async def _ask(client: httpx.AsyncClient, item: GoldItem) -> str:
    """One turn through the real chat endpoint, streamed and reassembled."""
    conversation = await client.post(
        f"{WEB_URL}/api/conversations",
        json={"projectId": item.workspace_id, "title": f"eval {item.id}"},
    )
    conversation_id = conversation.json().get("id")
    async with client.stream(
        "POST",
        f"{WEB_URL}/api/chat",
        json={
            "conversationId": conversation_id,
            "projectId": item.workspace_id,
            "messages": [{"role": "user", "content": item.question}],
        },
    ) as response:
        parts: list[str] = []
        async for line in response.aiter_lines():
            if not line.startswith("data: "):
                continue
            try:
                event = json.loads(line[6:])
            except ValueError:
                continue
            if event.get("type") == "text":
                parts.append(event.get("delta", ""))
    return "".join(parts)


async def score_answers(items: list[GoldItem], limit: int | None = None) -> dict:
    # `limit` caps the answerable questions only. Traps always all run: they
    # are the cheap half and the half that catches the worst failure, so
    # sampling them away would defeat the point of a quick pass.
    answerable = [i for i in items if not i.is_trap]
    if limit:
        answerable = answerable[:limit]
    traps = [i for i in items if i.is_trap]

    precision: list[float] = []
    recall: list[float] = []
    hallucinated_total = 0
    abstained_correctly = 0
    abstained_wrongly = 0
    labelled_general_knowledge = 0

    async with httpx.AsyncClient(timeout=300.0) as client:
        for item in answerable:
            answer = await _ask(client, item)
            if looks_like_abstention(answer):
                # Refusing a question the corpus can answer is its own failure,
                # and it is invisible if you only measure trap behaviour.
                abstained_wrongly += 1
                precision.append(0.0)
                recall.append(0.0)
                continue
            embedding = await embed_query(item.question)
            async with sessionmaker()() as session:
                hits = await hybrid_search(
                    session, item.question, embedding, item.workspace_id, top_k=10
                )
            offered = {f"src_doc_{h.document_id}c{h.chunk_id}" for h in hits}
            gold = {
                f"src_doc_{h.document_id}c{h.chunk_id}"
                for h in hits
                if h.chunk_id in item.gold_chunk_ids
            }
            score = citation_score(answer, offered, gold)
            precision.append(score.precision)
            recall.append(score.recall)
            hallucinated_total += len(score.hallucinated)

        for item in traps:
            answer = await _ask(client, item)
            if looks_like_abstention(answer):
                abstained_correctly += 1
                if answers_from_general_knowledge(answer):
                    labelled_general_knowledge += 1

    return {
        "n_answerable": len(answerable),
        "n_traps": len(traps),
        "citation_precision": round(mean(precision), 3),
        "citation_recall": round(mean(recall), 3),
        "hallucinated_markers": hallucinated_total,
        "abstention_accuracy": round(abstained_correctly / len(traps), 3) if traps else 0.0,
        "wrong_abstentions": abstained_wrongly,
        # Abstained, then answered anyway from its own memory. Allowed when
        # labelled, but worth watching rather than discovering in a lesson.
        "labelled_general_knowledge": labelled_general_knowledge,
    }


def print_card(retrieval: dict, answers: dict | None, items: list[GoldItem]) -> None:
    reviewed = len([i for i in items if i.reviewed])
    print("\n=== AiTeacher scorecard ===")
    print(f"gold items: {len(items)}  ({reviewed} human-reviewed, "
          f"{len(items) - reviewed} model-written)")
    print("\nRETRIEVAL")
    for key in ("n", "recall@1", "recall@5", "recall@20", "mrr", "p50_ms", "miss_count"):
        print(f"  {key:<14} {retrieval[key]}")
    if retrieval["misses"]:
        print("  worst misses (gold never retrieved):")
        for miss in retrieval["misses"][:5]:
            print(f"    {miss['id']}: {miss['question']}")
    if answers:
        print("\nANSWERS")
        for key, value in answers.items():
            print(f"  {key:<22} {value}")
    print()


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--gold", default="teacher/evals/gold.jsonl")
    parser.add_argument("--answers", action="store_true", help="also score live chat answers")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--json", dest="as_json", action="store_true")
    args = parser.parse_args()

    items = load(args.gold)
    retrieval = await score_retrieval(items)
    answers = await score_answers(items, args.limit) if args.answers else None

    if args.as_json:
        print(json.dumps({"retrieval": retrieval, "answers": answers}, indent=2))
    else:
        print_card(retrieval, answers, items)


if __name__ == "__main__":
    asyncio.run(main())
