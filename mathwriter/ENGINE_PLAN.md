# Writing Engine v2 — plan

The board's pen is its own project. This file owns it: state, defects, phases,
acceptance. Scope = `mathwriter/` (sidecar) + `components/teach/HandWrite.tsx`
+ `app/api/handwrite/*` (client). Everything else in AiTeacher is a consumer.

Definition of production-grade, in one line: **the same markup always renders
the same, renders what it says, stays sharp at any zoom, and is legible to a
student who did not write it.**

---

## 1. Where we left off (2026-08-09/10, uncommitted)

A **vector migration, ~80% server-side, 0% client-side.**

| Piece | State |
|---|---|
| `vectorize_glyphs.py` | Done. Traces 748 glyph PNGs → filled SVG paths (upsample 8x → blur → threshold → contours → approxPolyDP → Catmull-Rom → cubic). Atlas at `data/writer/glyphs.paths.json`, 1.0 MB (~307 KB gz), content-fingerprinted, memoized. |
| `svg_canvas.py` | Done. `SVGCanvas` duck-types the PIL canvas (`alpha_composite`/`paste`/`stroke`); `GlyphRef` duck-types a glyph image and records its transform chain instead of resampling. Non-glyph bitmaps embed as base64 `<image>` so migration is incremental. Exposes exact `lines()`/`words` geometry from layout. |
| `render.py` patches | Done. `render_pages(glyphs=…, canvas_factory=…)`; `aa_line` forwards to `canvas.stroke` when present; `load_glyphs()` memoized (was 44 ms of every render, ~60%); header underline follows line slope; connector width scales with `s`. |
| `server.py` | Done. `format:"svg"` opt-in on `/render`, `GET /glyphs` atlas, solo-`[G]` direct path preserving named `parts`, palette-aware recolor (`_has_semantic_color`). |
| `app/api/handwrite/glyphs/route.ts` | Done, immutable-cached proxy. |
| `test_svg_canvas.py` | 10 tests, green (`.venv/bin/python test_svg_canvas.py`). |
| **Client** | **Not started.** `HandWrite.tsx` still fetches PNG, still recovers line/word bands by scanning the raster's alpha channel, still pen-wipes with `drawImage`. |

Also landed yesterday, unrelated to vector: diagram `parts` → mark targets and
spatial index; `draw_engine.repair_draw_layout` shrinks-then-grows shapes so a
label fits inside its ellipse; `sequence` diagram type.

Measured now, live: SVG render 65 ms / 11 KB for a 3-line lesson (63 glyph
refs). Raster equivalent 63 ms / ~40 KB and blurry above 100% zoom.

---

## 2. What is actually wrong (evidence, not opinion)

Ranked by how much it hurts a student.

**D1 — Silent math corruption.** `±` has **no glyph** and falls back to `+`
(`charset.FALLBACKS`). The quadratic formula renders as `x = (-b + √…)/2a`.
Same class: `×`→`*`, `·`→`*`, `%`→`/`, `#`→`+`, `&`→`+`, `\`→`/`, and every
Greek capital → a Latin lookalike. Dropped characters are counted in
`render._DROPPED_CHARS` and **never surfaced to anyone**.

**D2 — Nondeterminism.** `pick_glyph` calls `random.choice` per character with
an unseeded global RNG, and jitter is random per render. Same markup twice →
different pixels *and different width*: measured 306 px vs 272 px for
`"how many roots"`, a 12% swing. Consequences: no content-addressed cache, no
visual regression test possible, layout/camera shifts on re-render, export PDF
never matches the board.

**D3 — Legibility.** Random variant selection picks confusable shapes: `h`
renders as an `n`, so "how" reads "now"; `n`/`m`, `l`/`e` likewise. A tutor
whose board says "now many roots" is a broken tutor.

**D4 — Resolution.** Glyph sources are 15×21 px median, drawn at 0.55–1.05
scale, then upscaled by DPR × canvas zoom (~5× on iPad). Everything above 100%
is mush. This is the defect the vector work exists to fix.

**D5 — Typography.** Word gaps are wide and irregular; a blank line costs a
full empty line (3 short items = 405 px tall); sqrt overbar does not meet the
`√`; sum/integral limits are near-illegible at annotation scale.

**D6 — Diagram specs are brittle.** `[G]{"type":"tree","nodes":[{…}]}` →
**HTTP 500** `'list' object has no attribute 'strip'`: `draw_tree` wants a
newline-delimited *string* (`5:3:8`), while every other `[G]` type takes
structured JSON. A model that guesses the natural shape gets a blank board.
No schema, no validation, no graceful degradation.

**D6b — `[G]` types silently drop content.** `er_diagram` renders an entity's
`attributes` nowhere: `{"name":"Doctor","attributes":[...]}` comes back as a
123x48 box labelled "Doctor" and the two attributes are gone. No error, no
warning — the lesson simply teaches less than it said. Found by the render-QA
loop comparing markup against what is legible in the output; a vision check
alone passes it, because the picture is a perfectly clean box.

**D6c — FIXED 2026-08-10: `tree` rejected the syntax our own prompt teaches.**
The prompt documents `10:null:14`; `draw_tree` accepted only `_`, so `null`
became an undeclared child node and raised `KeyError` deep in layout. The
sidecar 500'd and the board fell back to printing the raw `[G]{...}[/G]` spec
as literal text on screen. The parser now treats `_ null none nil - x` and
empty as "no child", and a child that never gets its own line is a leaf.

**D7 — No QA loop.** No golden images, no per-render diagnostics, no perf
budget. Every regression is found by a human looking at a lesson.

**D8 — Throughput.** `server.py` holds one global `_lock` across every render
because `render.py` keeps module-level RNG/caches. Renders serialize; a lesson
prefetching 20 items pays for it.

---

## 3. Phases

Each phase is independently shippable and ends with a check that fails if the
phase regresses.

### W0 — Determinism + a test harness *(foundation, do first)*

Nothing else is verifiable until renders repeat.

- Seed the RNG per render from `hash(markup, scale, role)`; restore global
  state after. Same input → byte-identical output.
- Golden harness: ~15 markup samples (heading, prose, fraction, root, sum,
  integral, matrix, boxed, table, strike, sub/sup, one `[DRAW]`, one `[G]`)
  → committed SVG snapshots + PNG hashes; `test_golden.py` diffs them.
- Wire mathwriter's tests into npm (`test:writer`) so they run with the rest.

**Done when:** two renders of every sample are byte-identical, and the golden
suite fails loudly when a layout constant changes.

### W1 — Correctness: no silent lies *(highest student impact)*

- Draw the missing symbols procedurally, the way `→ ≈ ∫ ✓` already are:
  `±`, `×`, `·`, `%`, `≡`, `∓`. Remove them from `FALLBACKS`.
- Any character still without a glyph: server returns
  `warnings: [{char, count}]` (from `_DROPPED_CHARS`) alongside the render, and
  `validate.py` fails the markup in tests. Client logs it; the teach prompt gets
  the true unsupported set, not a stale hand-written list.
- Variant selection: deterministic (from W0's seed) **and** filtered — audit the
  748 variants once, blacklist the ones that read as another letter, prefer the
  variant that follows the previous glyph's exit point.

**Done when:** the quadratic formula renders `±`; a golden test asserts no
character silently substitutes; `"how many roots"` transcribes correctly through
the `read` slot's vision model (we already have that model — use it as the
legibility oracle).

### W2 — Finish the vector path *(the visible quality jump)*

- `HandWrite.tsx` fetches `format:"svg"` and injects `<use>` markup; the atlas
  loads once per session from `/api/handwrite/glyphs` into a hidden `<svg><defs>`.
- Delete the alpha-channel band scan — use the server's exact `lines`/`words`
  boxes for spatial registration and marks.
- Pen-wipe becomes an animated `clipPath` rect per line (GPU, pausable) instead
  of `drawImage` per frame.
- Ink is `currentColor` → theme switches instantly, no server recolor for text,
  one cache entry per markup regardless of colour. Diagrams keep their semantic
  palette (already handled by `_has_semantic_color`).
- Keep the raster path for `/render_pdf` and as a fallback when the atlas 503s.

**Done when:** a lesson at 250% zoom is sharp; theme toggle recolours with no
re-fetch; payload per write drops from ~10 KB PNG to ~2 KB; marks still land on
the right line and word.

### W3 — Typography calibration

- Space width, inter-word gap variance, paragraph leading, line height — tuned
  against a real notebook reference, not by feel.
- Fix sqrt overbar join, fraction bar weight, sub/superscript scale, `[S]`/`[I]`
  limit sizes.
- Re-check the role scales (heading 1.45 / equation 1.0 / annotation 0.72) once
  the vector path is live — they were calibrated to compensate for raster blur.

**Done when:** golden snapshots updated deliberately; a 3-item lesson occupies
≤60% of today's vertical space; side-by-side screenshot review passes.

### W4 — Diagram specs that cannot 500

- One normalization layer in front of `render_diagram`: accept both the string
  spec and the structured JSON for every type (starting with `tree`), coerce,
  and validate against a per-type schema.
- Invalid or unknown spec → render the content as a plain list/table and attach
  a warning. Never a 500, never a blank board.
- Golden coverage for every `[G]` type, including the 12 in `diagrams_extra.py`.

**Done when:** every `[G]` type in `DRAW_REFERENCE.md` renders from both spec
shapes; the fuzz set (malformed specs) produces zero 500s.

### W5 — Production hardening

- Drop the global `_lock` once module state is per-render; measure concurrency.
- `/health` reports engine version, atlas fingerprint, glyph count, p50/p95
  render ms.
- Perf budget, enforced in the golden suite: p95 < 150 ms per write, atlas cold
  build < 30 s, warm start < 2 s.
- LRU render cache keyed by `hash(markup, scale)` — legal only because of W0.

**Done when:** 20 concurrent writes complete within budget; restarting the
sidecar mid-lesson does not stall the board.

---

## 4. Order and rationale

W0 → W1 → W2 → W3 → W4 → W5.

W0 is first because determinism is what makes every later claim testable and
what makes caching correct. W1 before W2 because a crisp render of the wrong
symbol is still wrong. W2 before W3 because tuning typography against a blurry
raster tunes the wrong thing.

Explicitly **not** in scope (parking lot): training a LaTeX→strokes model,
harvesting a new glyph dataset, per-writer style transfer. The existing 748
glyphs are good enough once they are chosen deterministically and drawn as
vectors.
