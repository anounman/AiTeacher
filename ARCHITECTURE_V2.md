# AiTeacher — Architecture v2 (restructure)

Supersedes ARCHITECTURE.md once Phase R1 lands. v1 assumed one Next.js process
owning everything. v2 splits the product into **two independently built
projects** and gives AI Teacher **three internal planes** with hard boundaries.

---

## 0. The shape

```
┌─────────────────────────────────────────────────────────────┐
│  PROJECT 1 — WRITER ENGINE            (built separately)    │
│  markup ──▶ strokes / SVG / timing                          │
│  Not our code. We consume it over a versioned HTTP contract │
│  and ship a mock so our tests never need it running.        │
└─────────────────────────────────────────────────────────────┘
                          ▲  §5 wire contract
                          │
┌─────────────────────────┴───────────────────────────────────┐
│  PROJECT 2 — AI TEACHER                        (our job)    │
│                                                             │
│   A. KNOWLEDGE PLANE   sources ─▶ cited evidence            │
│   B. TEACHING PLANE    evidence ─▶ a lesson (deepagents)    │
│   C. PERFORMANCE PLANE lesson ─▶ synchronized board + voice │
└─────────────────────────────────────────────────────────────┘
```

The planes are sequential in a turn and independently testable. A plane may
only talk to its neighbours through a typed envelope, never by reaching into
the other's internals.

## 1. Process topology

Three processes. The language split is forced by the tools, not by taste:
`deepagents` and `markitdown` are Python, and the knowledge pipeline we are
porting is Python.

| Process | Stack | Owns |
|---|---|---|
| `web/` | Next.js 16, React 19 | UI, canvas, ink, camera, playback, auth session. Thin BFF that proxies to `teacher/`. |
| `teacher/` | Python 3.12, FastAPI, LangGraph/deepagents | Knowledge plane + Teaching plane. All agents. All model calls. |
| Writer Engine | friend's | Handwriting only. |

Postgres + pgvector runs beside them (docker compose). Ollama stays as-is.

**Why the Next.js app does not keep the agents:** every library that makes this
production-grade — deepagents, markitdown, docling, pgvector's SQLAlchemy
bindings — is Python. Re-implementing them in TypeScript is the failure mode
this restructure exists to avoid.

**What `web/` keeps** (already good, do not port): the infinite canvas,
perfect-freehand ink, the GoodNotes gesture router, spatial/BVH index, mark
overlays, the cue timeline, TTS playback, the pen-wipe performer.

---

## 2. Plane A — Knowledge (the NotebookLM-alternative part)

### 2.1 Verdict on what we have

Current implementation is a prototype, not a knowledge system.
`lib/ingest/index.ts` is 162 lines: `unpdf` text extraction → paragraph split
at 800 chars with 100 char overlap → embed → insert.

| Capability | Ours today | Needed |
|---|---|---|
| Formats | PDF, HTML, plain text | 50+ (Office, EPUB, audio, video, images) |
| Layout/tables | none — flat text | table structure, reading order, multi-column |
| Images in docs | dropped | described by a vision model, indexed |
| Audio/video | none | transcript + timestamp provenance |
| Chunking | fixed-size paragraphs | structure-aware, hierarchical (doc + chunk) |
| Re-ingest | full re-embed | content-hashed, incremental reconcile |
| Retrieval | cosine + FTS5 + RRF (fine) | + document-level tier, + reranker |
| Citations | chunk id + page | verbatim span offsets |
| Failure mode | material stuck `error` | per-stage retry, observable |

Retrieval is the one part that is already the right idea — hybrid cosine +
BM25 fused with RRF is exactly what the reference systems do. Keep the design,
move the storage.

### 2.2 Reference implementation: SurfSense

Surveyed the field ([sources](#sources)). Candidates: SurfSense, Open Notebook,
AnythingLLM, Khoj, insights-lm.

**Pick: SurfSense** (`MODSetter/SurfSense`, 15.9k★, actively pushed).
Decisive reasons:

1. Same stack we are moving to — FastAPI backend + Next.js frontend.
2. **Already built on LangChain Deep Agents** — the exact agent harness we
   chose independently. Its agent boundaries are ones we can reuse.
3. Its retrieval is the architecture we already committed to: hybrid semantic +
   full-text, hierarchical indices, reciprocal rank fusion, pluggable rerankers.
4. Its ETL is factored the way we need: classifier → converter → chunker →
   embedder → persistence, each replaceable.

Open Notebook (36.6k★, MIT) is the better-licensed runner-up and has the
stronger multi-speaker podcast pipeline; it is worth raiding for that alone if
we ever want spoken summaries. It is not the primary because its retrieval is
less explicitly hierarchical and it is built on SurrealDB.

### 2.3 ⚠ License — read before copying a single file

SurfSense is **not uniformly open source**:

- Everything **outside** `surfsense_backend/app/proprietary/` — **Apache 2.0**.
  Copyable, including modified, if we keep the copyright notice, state our
  changes, and ship a `NOTICE` file.
- Everything **inside** `surfsense_backend/app/proprietary/` (`platforms/`,
  `web_crawler/`) — **Business Source License 1.1**. Not open source. **Do not
  copy.** We need our own crawler; ours already exists (`lib/ingest/ssrf.ts`).

This matters more than it did yesterday: `anounman/AiTeacher` is now a **public**
repo, so attribution obligations are real and visible.

### 2.4 What we take, module by module

Port these (Apache-2.0 region), adapting names to ours:

| SurfSense module | What it gives us |
|---|---|
| `etl_pipeline/file_classifier.py` | route a file to the right converter by sniffing, not by extension |
| `etl_pipeline/etl_pipeline_service.py` | the convert → normalize → persist orchestration |
| `etl_pipeline/picture_describer.py` | figures/diagrams in a PDF get described by a vision model and become searchable — directly feeds our board |
| `indexing_pipeline/document_chunker.py` | structure-aware chunking |
| `indexing_pipeline/document_hashing.py` + `chunk_reconciler.py` | incremental re-index; editing one page does not re-embed a book |
| `retriever/chunks_hybrid_search.py` + `documents_hybrid_search.py` | two-tier hybrid retrieval with RRF |
| `knowledge_store/` | the storage abstraction the above sits on |

Skip: `connectors/`, `automations/`, `podcasts/`, `notifications/`,
`proprietary/`. Not our product, and the last one is not licensed to us.

### 2.5 ⚠ Parsing: markitdown alone breaks our citation contract

You asked for `markitdown`. Verified against its source
(`packages/markitdown/src/markitdown/converters/_pdf_converter.py`): it iterates
PDF pages internally, then returns **one flat markdown string with no page
markers** — `DocumentConverterResult(markdown=...)`. It also has no table
structure model and loses multi-column reading order.

Our first principle is that every claim cites a page. A parser that cannot say
which page a sentence came from cannot serve it.

**Decision — both, split by job:**

```
file ──▶ file_classifier
          ├── PDF, scanned PDF, DOCX, PPTX ──▶ Docling   (MIT, 64.5k★)
          │      layout model, table structure, page provenance
          └── everything else ──────────────▶ MarkItDown (MIT, 172k★)
                 EPUB, CSV, JSON, XML, ZIP, YouTube, audio, images
```

MarkItDown is ~10× faster and covers a far wider tail; Docling is the one that
preserves what we cite. One `Converter` interface, two implementations, chosen
by the classifier — which is precisely how SurfSense already structures it.

If you want markitdown-only for v1 simplicity, say so and I will build it that
way — but page citations degrade to document-level citations until Docling
lands, and the grounding evals will show it.

### 2.6 Evidence envelope (unchanged contract, richer payload)

```jsonc
{
  "verbatim_quote": "…",
  "source_id": "mat_7f3…#c12",
  "loc": { "page": 14, "bbox": [72, 310, 520, 366] },   // or { "t": 872 }
  "distilled_note": "…",
  "score": { "dense": 0.81, "bm25": 0.44, "rrf": 0.031, "rerank": 0.92 }
}
```

The reasoning model may cite only `source_id`s present in its envelope;
anything else is dropped before render. That rule does not change — it moves
from `lib/grounding.ts` into the teaching plane's output validator.

### 2.7 Storage

SQLite + `better-sqlite3` + FTS5 → **Postgres 16 + pgvector**, SQLAlchemy async,
Alembic migrations. This is what makes the retriever port a copy rather than a
rewrite, and it is still local-first: one container, no cloud.

FSRS flashcards, mastery, and the concept graph migrate with it; their logic is
ours and stays as-is.

---

## 3. Plane B — Teaching (deepagents)

One deep agent, several subagents, each with an isolated context.

```python
teacher = create_deep_agent(
    model=slot("reason"),
    system_prompt=TEACH_SYSTEM_PROMPT,
    tools=[search_materials, board_inventory, write_board, mark, ask_student],
    subagents=[researcher, board_director, examiner, reflector],
)
```

| Agent | Job | Slot |
|---|---|---|
| **teacher** (root) | plan the lesson, hold the arc, decide when to write vs speak vs ask | `reason` |
| **researcher** | fan out over the knowledge plane, return the evidence envelope only | `reason` |
| **board_director** | evidence + lesson beat → board actions (writes, marks, diagram specs) | `visual` |
| **examiner** | set the exercise, read the student's ink, judge the math not the penmanship | `read` + `reason` |
| **reflector** | post-turn: update the learner profile (already built, `lib/learner/profile.ts`) | `dispatch` |

Why deepagents rather than our hand-rolled loop: planning, subagent context
isolation, a virtual filesystem for long lesson state, and human-in-the-loop
middleware — all things we would otherwise write ourselves. The lesson plan
becomes a file the agent edits, which is also how a lesson survives a reload.

The board_director being a **subagent** rather than a second top-level model
call is the real change: it inherits the lesson's context instead of receiving
a flattened event stream.

**Grounding stays enforced outside the agent.** A validator between the
teaching plane and the performance plane drops any claim whose citation is not
in the envelope. Agents are not trusted to police themselves.

---

## 4. Plane C — Performance (writing + speaking, synchronized)

This plane owns the thing that makes it feel like a teacher: **the pen and the
voice are one clock.**

Input: a validated lesson (ordered beats: speech, write, mark, diagram, pause,
question). Output: a driven timeline.

```
lesson ─▶ timeline builder ─▶ cue stream ─▶ ┬─ TTS  (speech is the clock)
                                            ├─ Writer Engine (strokes)
                                            ├─ camera (follows the pen)
                                            └─ transcript highlight
```

Rules, kept from what already works (`lib/teach/timeline.ts`):

- **Speech is the master clock.** Handwriting gets a bounded settle window; if
  the engine is slow the voice waits briefly, then continues — the lesson never
  deadlocks on the pen.
- Every wait is pause-aware and monotonic; one shared event cursor drives
  transcript, board and camera so they cannot drift apart.
- A write that fails renders as text. A cold visual slot renders a
  deterministic fallback. **No plane may gate the lesson.**

Sub-agents may be added here later (a pacing critic, a layout repairer — the
geometry repairer in `lib/teach/repair.ts` is the first one already). They run
beside playback, never in front of it.

---

## 5. Writer Engine contract

Your friend builds this. The contract is the only thing we both need to agree
on, and it must be versioned so neither side blocks the other.

```
POST /v1/render
  { markup, scale, role: "heading"|"equation"|"annotation", format: "svg"|"png" }
→ { svg | png, w, h,
    lines: [{ x, y, w, h, words:[{x,y,w,h}] }],   // exact, from layout
    parts: [{ id, x, y, w, h }],                  // named diagram regions
    strokes?: [...],                              // optional, for live pen
    warnings: [{ char, count }] }                 // characters it could not draw

GET /v1/glyphs   → shared outline atlas, content-fingerprinted
GET /v1/health   → { version, atlas, glyph_count, p50_ms, p95_ms }
```

Non-negotiables to hand him, from the defects measured in
[`mathwriter/ENGINE_PLAN.md`](mathwriter/ENGINE_PLAN.md):

1. **Deterministic.** Same markup + scale ⇒ byte-identical output. Ours varies
   12% in width between calls, which breaks caching, layout and export.
2. **Never silently substitute a character.** `±` must not become `+`.
   Unrenderable characters come back in `warnings`, they do not come back wrong.
3. **Exact line/word geometry from layout**, so we never scan pixels for it.
4. **Resolution-independent output** (vector), because the canvas zooms to 250%.

On our side: one adapter module, one mock implementing the same contract, and
`writer_engine.contract.test.ts` running against both. We keep `mathwriter/` as
the reference implementation and fallback until his engine passes that suite.

---

## 6. Repository layout after the restructure

```
AiTeacher/
├── web/                      # Next.js — UI, canvas, playback (moved from root)
├── teacher/                  # NEW Python service
│   ├── knowledge/            # plane A — etl, indexing, retrieval, store
│   ├── agents/               # plane B — deepagents graph + subagents
│   ├── performance/          # plane C — timeline, cue stream (server half)
│   ├── writer/               # writer-engine client + mock
│   └── evals/                # grounding, retrieval, latency harnesses
├── mathwriter/               # reference writer engine + ENGINE_PLAN.md
├── docker-compose.yml        # postgres+pgvector, ollama, teacher, web
├── NOTICE                    # Apache-2.0 attribution (SurfSense et al.)
└── ARCHITECTURE_V2.md
```

---

## 7. Migration phases

Each phase leaves the app working.

- **R0 — Decide + scaffold. ✅ 2026-08-10.** Next.js in `web/`, `teacher/`
  FastAPI service, Postgres+pgvector on 5433, `/api/health` spanning both
  processes plus ollama and the writer engine.
- **R1 — Knowledge plane. ✅ 2026-08-10.** Classifier → Docling (PDF/DOCX/PPTX,
  page-accurate) / MarkItDown (the tail) → table-aware chunker with page + line
  provenance → Ollama embeddings → Postgres. Hybrid dense + full-text retrieval
  fused with RRF at k=60, 190 ms end to end over the migrated corpus. All 46
  materials and 953 chunks migrated with their embeddings; chat retrieval and
  material upload both run through the plane, with the SQLite path as fallback.
  *Still open:* the image/figure describer, and a reranker on top of RRF.
- **R2 — Eval harness first.** 100–200 gold QA pairs + 30 unanswerable traps;
  citation precision/recall, abstention accuracy, retrieval recall@k/MRR. This
  phase exists before R3 on purpose — you cannot tune agents you cannot score.
  *Done when: one command prints the scorecard.*
- **R3 — Teaching plane.** Move the teach loop onto deepagents with the five
  agents above; the grounding validator sits outside them. *Done when: the
  scorecard from R2 does not regress and lesson quality on a held-out set
  improves.*
- **R4 — Performance plane split. ◐ 2026-08-10.** The cue planner now lives in
  `teacher/app/performance/timeline.py`; `web/` asks for the plan and rehydrates
  cue indices into events, falling back to its local planner when the service is
  unreachable. The two implementations are held byte-identical by a generated
  fixture set (`teacher/tests/test_timeline_parity.py`, 10 cases). *Still open:*
  persisting the cue stream so a lesson replays from storage rather than being
  re-planned.
- **R5 — Writer Engine swap.** Point the adapter at your friend's service, keep
  `mathwriter` as fallback. *Done when: the contract suite passes against both.*

## 8. Decisions (all settled, 2026-08-10)

- SurfSense is the reference to copy, Apache-2.0 region only; Open Notebook
  raided later for multi-speaker podcasts.
- **Docling + MarkItDown**, split by whether the job needs page provenance.
  Docling: PDF/DOCX/PPTX. MarkItDown: the long tail.
- **Postgres 16 + pgvector**, replacing SQLite.
- **Next.js moves to `web/`** in R0, before anything else lands on top of it.
- **Workspace-scoped schema kept** (`workspace_id` on every row) even though we
  ship single-user — retrofitting tenancy is expensive, carrying it is free.
- Board director becomes a deepagents subagent, not a separate model call.
- Grounding validation lives outside the agents, between plane B and plane C.

---

## Sources

- [SurfSense](https://github.com/MODSetter/SurfSense) — Apache-2.0 except `proprietary/` (BSL 1.1)
- [Open Notebook](https://github.com/lfnovo/open-notebook) — MIT
- [deepagents](https://github.com/langchain-ai/deepagents) — MIT
- [MarkItDown](https://github.com/microsoft/markitdown) — MIT
- [Docling](https://github.com/docling-project/docling) — MIT
- [Open-source NotebookLM alternatives, 2026 survey](https://openalternative.co/alternatives/notebooklm)
- [Docling vs MarkItDown comparison](https://www.file2markdown.ai/blog/docling-vs-markitdown)
