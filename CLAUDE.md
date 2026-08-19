# AiTeacher

AI teacher that teaches by writing/drawing on a canvas (GoodNotes-style), grounded in the user's own study resources. Zero tolerance for uncited claims.

---

# ⚠ CURRENT FOCUS — read this before anything else

**Temporary orientation block (added 2026-08-19).** Where it contradicts the
rest of this file, it wins: everything below it describes the whole product,
this describes what is actually being built right now. Delete it once the
writer question below is settled.

## Who is building what

Two people, split by engine rather than by feature:

- **Jayansh** (`github.com/JayanshJ`) owns the **writing and drawing engines**:
  mathwriter (`JayanshJ/mathwriter`, vendored at `mathwriter/`, Python sidecar)
  and the visual engine (`JayanshJ/study-visual-engine`, vendored *verbatim* at
  `web/lib/visual-engine/`). **Do not hand-edit `web/lib/visual-engine/`** — it
  is a copy, re-synced by `npm run sync:visual-engine`; see its `package.json`
  note. Fixes to those engines go upstream, not into this repo.
- **Ankush** (this repo, `anounman/AiTeacher`) owns **AI Teacher**: the board,
  the lesson loop, the pen loop, and every consumer of those engines.
- [ARCHITECTURE_V2.md](ARCHITECTURE_V2.md) §5 is the versioned HTTP contract
  between the two halves, so neither side blocks the other.

## The only thing being worked on right now

**The AI-teacher visualization loop.** Nothing else. End to end:

> teacher writes on the board and speaks it aloud → teacher writes a question
> on the board and asks it directly → student answers **on the board** with the
> Apple Pencil → the ink is read back → the teacher judges the answer and
> carries on.

Where that lives: `web/components/teach/TeachStage.tsx` (board + gestures +
"check my work"), `web/lib/teach/` (canvas, timeline, performer, protocol,
ink-capture, voice-clock), `web/app/api/teach/*`, `prompts/teach.md`,
`mathwriter/`, `web/lib/visual-engine/`, `teacher/app/performance/`.

**Out of scope right now** — built or not, leave alone unless asked: ingest /
knowledge plane, grounding + citations, evals, Conscious co-watch, chat,
flashcards / FSRS / mastery.

## The board's three visual tracks

One board, three engines. Knowing which owns what is the single most useful
fact in this codebase:

| Track | Engine | Lives in | Status |
|---|---|---|---|
| **Handwriting** (prose, equations, tables) | mathwriter — harvested real glyphs, PNG raster | `mathwriter/`, `web/components/teach/HandWrite.tsx` | default, incumbent |
| **Static diagrams** (trees, stacks, state machines, pipelines) | visual engine — model names a *concept in words*, deterministic TS layout + roughjs render | `web/lib/visual-engine/`, `web/app/api/teach/diagram/` | default on (`VISUAL_ENGINE !== "0"`) |
| **Animated clips** (a process that *changes*) | Manim, template-driven | `teacher/app/performance/clips.py`, `web/components/teach/ClipScene.tsx` | on, capped at 1 per lesson |

Rules that hold across all three:

- **The model never emits coordinates.** It names a concept (`diagram`) or a
  template plus parameters (`clip`); layout is deterministic code. `[G]` and
  `[DRAW]` markup are *forbidden by name* in `prompts/teach.md` — that is what
  killed the overlapping labels and crude hand-placed axes. `[T]` tables stay,
  because a table is handwriting.
- **The model never writes code.** Not Manim, not Python, not TeX beyond a
  formula body — `check_tex()` in `clips.py` rejects `\input`, `\def`,
  `\write`, `\catcode` and friends; `safe_expr.py` whitelists expressions.
- **No track may gate the lesson.** Speech is the master clock. A failed write
  renders as text, a refused layout degrades to the spoken explanation, a clip
  that will not render disappears. Nothing deadlocks on the pen.

## The writer bake-off — Manim vs p5.js vs mathwriter (OPEN)

The question we set out to answer: **can Manim or p5.js replace the writing
engine entirely?** Built so it could be answered by looking, not by arguing.
Commit `8bb573c`.

**Verdict: not yet reached.** Nobody has looked at `/writer-lab` on the iPad.
That judgement is the next action on this workstream.

**Manim — works, but cannot cover the board.**
Two clip kinds carry it: `write_math` (real `MathTex` drawn stroke-by-stroke by
`Write()`) and `write_text` (headings/prose). Getting there was toolchain, not
code: brew's `dvisvgm` looks for kpathsea data under its own Cellar prefix and
finds nothing, costing ~5s of brute-force font processing per formula and
making every PS special fatal. `teacher/bin/dvisvgm` shims in `TEXMFCNF`
(pointing at brew texlive) and `--no-specials` — 5s became 3ms. A new formula
renders in 0.5–2s and is cached forever by spec hash.
Its limits, by construction: it is **typeset, not handwritten** (trades the
board's whole look for correctness), and `web/lib/teach/markup-to-tex.ts`
deliberately returns `null` — falling back to mathwriter — for tables,
multi-line items, `[G]/[DRAW]/[T]/[X]/[V]/[H]`, unbalanced tags, and any
unmapped non-ASCII. **A wrong formula drawn beautifully is the worst outcome on
a teaching board**, so the converter stays conservative; widen it only with a
test per case.

**p5.js — an honest spike, not adopted.**
`web/components/visual/P5Write.tsx`. Its one genuine advantage over a rendered
clip: writing **speed is adjustable live**, so it could chase the voice clock
frame by frame; a video's pace is fixed at render time. Its ceiling is equally
plain: no typesetting at all. A fraction would mean rebuilding exactly the
layout engine this experiment exists to retire. Keep it as the reference for
the live-speed idea; do not put math on it.

**How to test it** (this is the whole point of the experiment):

1. `/writer-lab` renders four samples — quadratic formula, heading, sum, prose
   note — through **all three writers side by side, with timings**.
2. The toggle at the bottom of that page flips **real lessons** to the Manim
   writer: `localStorage["aiteacher.writer"] = "manim"` (default
   `"mathwriter"`). Per device, no redeploy — so it can be flipped on the iPad
   mid-session.
3. Anything Manim cannot express, and any render failure, falls back to
   mathwriter silently. So a bad toggle degrades, it does not break.
4. Manim clips need the teacher service running (`npm run teacher`) plus a
   LaTeX install; mathwriter needs `npm run writer`.

**Why we went looking in the first place** — measured mathwriter defects, all
still open. See [`mathwriter/ENGINE_PLAN.md`](mathwriter/ENGINE_PLAN.md) §2:

- **D1 silent math corruption.** `±` has no glyph and falls back to `+`
  (`mathwriter/charset.py`), so the quadratic formula renders *wrong*. Same for
  `×`, `·`, `%`, and every Greek capital.
- **D2 nondeterminism.** `render.py` still calls unseeded `random.*`; the same
  markup renders 12% wider on a second call. No content-addressed cache and no
  visual regression test are possible until this is fixed.
- **D4 resolution.** Vector path is ~80% done server-side (`svg_canvas.py`,
  `/glyphs`, `format:"svg"`) and **0% client-side** — `HandWrite.tsx` still
  fetches PNG and still alpha-scans the raster to recover line bands.

The fork, when the bake-off is judged: fix mathwriter's W0+W1 (seed the RNG,
draw the missing symbols, add goldens — keeps the handwritten look), or commit
to Manim for math and accept typeset output, or hold both behind the toggle.

## The pen-answer half of the loop

Built and verified once live (TODO 2c.26): pen strokes rasterized
(`web/lib/teach/ink-capture.ts`) → `POST /api/teach/read-ink` → the `read`
slot's cloud vision model transcribes them → the transcription is folded into a
normal teach **interruption**, where the reason model — which holds the lesson —
judges the answer. Triggered by "check my work" in the pen controls.

Known gap: there is **no typed `exercise` action** yet (TODO 4.4). Today the
teacher sets an exercise by prompt instruction only (`prompts/teach.md`) — it
writes the question as an ordinary `write` action and says "write your answer on
the board". So the board does not know an answer is expected, cannot wait for
one, and cannot mark the region it belongs in. That is the next structural gap
in this loop after the writer question.

## Working in this repo

Processes: `npm run dev` (Next.js in `web/`) + `npm run writer` (mathwriter
sidecar) + `npm run teacher` (FastAPI — needed for Manim clips, the cue planner
and render QA) + Ollama. `npm run db` for Postgres if touching the knowledge
plane, which right now you are not.

Tests for this workstream: `npm run test:teach` (67) and `npm run test:visual`
(68) — both green as of 2026-08-19. `npm test` at the root runs everything but
needs both Python venvs.

⚠ **The rest of this file and [TODO.md](TODO.md) predate the `web/` + `teacher/`
split** (ARCHITECTURE_V2 R0) and still say "SQLite" and give paths like
`lib/teach/…` that are now `web/lib/teach/…`. Trust
[ARCHITECTURE_V2.md](ARCHITECTURE_V2.md) §7 for live status and the paths in
this block over anything stale below.

---

Read [ARCHITECTURE.md](ARCHITECTURE.md) before implementing anything — it locks stack, schemas, loops, and wire contracts. Tasks with acceptance criteria live in [TODO.md](TODO.md). Deviations require updating ARCHITECTURE.md in the same change.

Built on StudyGPT (github.com/JayanshJ/chat, by Jayansh): Next.js 16 chat UI, ingest, retrieval, concept graph, FSRS flashcards, mastery. Board handwriting by mathwriter (github.com/JayanshJ/mathwriter, upgraded with the diagram engine from github.com/anounman/mathwriter-diagrams — `[G]`/`[DRAW]` hand-drawn diagrams; vendored at `mathwriter/` — Python sidecar, `npm run writer`). AiTeacher layers on: model slots, page provenance, teach mode (voice + handwriting on an infinite canvas), a visual director, a Hermes-style post-turn self-improvement loop (`lib/learner/profile.ts` — background reflection on the dispatch slot learns the student's style into a capped profile injected into every turn), and — still to build — enforced grounding claims, the eval harness, and Conscious co-watch. **Next.js 16 has breaking changes — read `node_modules/next/dist/docs/` before writing Next-specific code.**

Dev: `npm run dev` (app) + `npm run writer` (mathwriter handwriting sidecar) + Ollama. Teach mode also speaks through Kokoro TTS at the host in `config/models.json` (`KOKORO_URL` overrides); if it is unreachable the lesson still runs on the browser's built-in voice.
Tests: `npm run test:teach` (teach + TTS route) plus `test:fsrs`, `test:mastery`, `test:retrieval`. **Not yet wired to a script:** `lib/grounding.test.ts`, `lib/persona.test.ts`, `lib/ingest/index.test.ts` — run them with `node --import tsx --test <file>` until TODO M.4 lands.

## Core principles

- **Grounding is the product.** Every claim cites an uploaded resource chunk, a Conscious episode (timestamp), or is explicitly labeled "not in your materials." No parametric-memory answers unlabeled.
- **Summaries inform, quotes ground.** Citations always point at verbatim quotes with provenance, never at paraphrases.
- **Local-first.** Ollama, SQLite. No cloud dependency for core loop.

## Architecture

Model slots (`lib/llm/slots.ts`, defaults in `config/models.json`). Resolution: call-site → env `OLLAMA_<SLOT>_MODEL` → Settings → *Capability models* → config file. Teach mode always uses the `reason` slot, not the chat model picker. Code names slots, never models:

| Slot | Model (current pick) | Runs |
|---|---|---|
| `parse` — PDF pages as images, equation extraction, chunk distillation | `gemma4:e4b` (multimodal) | Ingest time, offline |
| `dispatch` — intent → exact tool JSON, decides nothing | `nemotron-3-nano:30b-cloud` | Per turn, only when tools are needed |
| `reason` — teaching/chat output | `deepseek-v4-pro:cloud` | Per turn |
| `visual` — lesson visual direction (`draw_architecture` tool call) | `nemotron-3-nano:30b-cloud` | After a teach lesson generates, beside playback |
| `read` — vision: student pen strokes, future board QA | `minimax-m3:cloud` | When the student taps "check my work" |
| `embed` — retrieval vectors | `nomic-embed-text` (768d) | Ingest + query |

**Not serial per turn.** Parsing happens at ingest. Chat turn = retrieval (no LLM) → reason → dispatch only if tools needed. The visual slot never gates speech: if it is cold, slow, or wrong, the lesson plays with a deterministic fallback diagram.

**Layer handoffs are typed JSON envelopes**, never prose. Evidence unit:

```
{ verbatim_quote, source_id, location (page|timestamp), distilled_note }
```

Reasoning model may only cite `source_id`s present in its envelope; anything else is dropped before render.

## Subsystems

1. **Data layer** — hybrid retrieval (cosine over Float32 BLOBs + FTS5 BM25, fused with RRF) over per-page chunks carrying `loc` provenance. Storage: SQLite (`better-sqlite3`); **no sqlite-vec** — brute-force cosine is fine at course-corpus scale. Concept graph uses StudyGPT's taxonomy (`prerequisite_of, part_of, example_of, …` + EXTRACTED/INFERRED/AMBIGUOUS), which supersedes the originally planned `covers`/`requires` pair. Full GraphRAG only if benchmarks demand it.
2. **Conscious integration** — MCP client of https://github.com/anounman/Conscious. **Client layer built** (`lib/mcp/client.ts`, config in Settings → Connected apps): any MCP server's tools are offered to the reason model each turn; Conscious preset ships in the UI. Co-watch lectures: session binding (Conscious timerange ↔ resource node), pause-and-ask (context = transcript window + `ocr_at(t)` + linked chunks), citations like `video@14:32` seek the player.
3. **Canvas — built, and not with tldraw.** The board is our own infinite pan/zoom canvas (`lib/teach/canvas.ts` + `components/teach/TeachStage.tsx`); tldraw was evaluated and dropped. The teacher writes real handwriting via mathwriter `write` actions (plus `code`, `mark`, `visual_scene`), performed against a cue timeline so voice and pen move together, with a camera that follows the pen. Student input: GoodNotes gesture model (Apple Pencil always writes; in pen mode one finger writes, a second finger cancels the young stroke and pans/pinches; perfect-freehand ink, eraser in pen controls), marquee selection via BVH spatial index, and the ask-pen loop — pen strokes rasterized (`lib/teach/ink-capture.ts`), read by the `read` slot's cloud vision model (`/api/teach/read-ink`), judged by the reason model through the normal interruption flow ("check my work" in the pen controls). Lessons export as handwritten-note PDFs (`/api/teach/export`, sidecar `/render_pdf`) for GoodNotes.

## Benchmarks (build harness before features)

- **Grounding (primary):** 100–200 gold QA pairs with source spans + ~30 unanswerable trap questions. Metrics: citation precision/recall, answer correctness, abstention accuracy. RAGAS-style.
- **Retrieval:** recall@k, MRR on gold spans — decides flat-RAG vs graph with data.
- **Per-layer:** parsing = LaTeX extraction match on ~50 hand-checked pages; dispatch = tool-call exactness (fully automated); reasoning = grounding evals, which also catch handoff leaks.
- **Co-watch:** pause at t, ask about [t−60s, t]; timestamp citation within ±10s.
- **Latency:** pause-question <2s to first token, drawing starts <3s, voice roundtrip <1.5s. Instrument from day one.

## Build order (each phase usable alone)

Reordered 2026-08-08 (teach mode pulled ahead of co-watch); see TODO.md for live status.

1. Ingest + grounded chat with citations + eval harness — ingest/retrieval done, **claim enforcement and eval harness still open**
2. Teach mode: voice + handwriting canvas, visual director — **built**
3. Conscious co-watch via MCP — not started
4. Canvas input (pen annotations via vision, then voice)
5. Graph upgrades only where benchmarks show flat retrieval failing

Deliberately skipped until evals demand: custom stroke synthesis, iPad-native app, full GraphRAG.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
