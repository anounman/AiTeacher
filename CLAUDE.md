# AiTeacher

AI teacher that teaches by writing/drawing on a canvas (GoodNotes-style), grounded in the user's own study resources. Zero tolerance for uncited claims.

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
