# Scorecard baseline — 2026-08-10

First measured numbers. Everything after this is measured against them.

Corpus: 46 documents / 953 chunks. Gold set: 120 answerable + 10 traps,
**model-written, not yet human-reviewed** (`teacher/evals/gold.jsonl`).

## Retrieval — `npm run eval`

| metric | value |
|---|---|
| recall@1 | 0.517 |
| recall@5 | 0.808 |
| recall@20 | 0.908 |
| MRR | 0.641 |
| p50 latency | 116 ms |
| never retrieved | 11 / 120 |

Reading: the right chunk is in the top 5 four times out of five, but it is
first only half the time. A reranker over the RRF output is the obvious next
lever. The 11 hard misses are mostly questions phrased about a *position* in a
document ("what happens during step 2", "the opcode for sw") where the wording
in the slides does not repeat the question's terms.

## Answers — `npm run eval:answers` (12 answerable + all 10 traps)

| metric | value |
|---|---|
| citation precision | 0.986 |
| citation recall | 0.833 |
| invented markers | 1 |
| abstention accuracy | 1.000 |
| wrong abstentions | 0 |
| labelled general knowledge | 2 |

## Two things the first version of this scorecard got wrong

Both worth remembering, because both would have sent us fixing a model that
was behaving correctly.

1. **Abstention read 0.0 when the true value was 1.0.** The detector matched
   fixed sentences; real refusals are phrased freely ("that falls outside the
   scope of your uploaded course materials", "none of your lecture notes cover
   …"). Every trap was being refused properly and scored as a fabrication.
2. **Fixing the detector was the wrong fix.** Chasing phrasings with regexes is
   unbounded. The real fix was making the behaviour deterministic: the prompts
   now require the refusal to *begin* with one exact sentence. Detection became
   a substring check, and a miss is now a genuine violation rather than a
   phrasing the detector had not seen. That moved the measured value from 0.7
   to 1.0 and, more importantly, made the guarantee checkable at all.

## Not yet measured

- Answer correctness against the reference answer. String overlap measures
  paraphrase, not truth, and an LLM judge can be wrong in the same direction as
  the system it grades.
- The full 120-item answer pass (each item is a live model turn).
- Anything about the teaching agent's lessons — it is not on the student path
  yet, by design.
