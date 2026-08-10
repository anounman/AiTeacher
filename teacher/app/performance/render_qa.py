"""Look at what the pen actually drew, and fix it if it came out wrong.

The board can be wrong in ways no amount of geometry checking will catch: a
label struck through by the ellipse it sits in, a tree whose edges miss their
nodes, a table with a column sheared off, a diagram that renders as a grey
blob. Overlap *between* board items is exact arithmetic and stays with the
deterministic repairer (web/lib/teach/repair.ts). This is for the other half —
whether a single item is composed and legible at all — which is a judgement
about pixels, so a vision model makes it.

The loop, per item:

    markup -> render -> vision verdict -> (if bad) reason model rewrites the
    markup -> render again -> keep whichever is better

Bounded on purpose. One repair attempt, a hard timeout, and any failure keeps
the original: a lesson must never wait on, or be lost to, quality control.

Only diagram markup goes through it. Handwritten prose does not have a
composition failure mode worth two model calls, and running this on every line
would cost more than the lesson.
"""
from __future__ import annotations

import base64
import json
import logging
import re
from dataclasses import dataclass

import httpx

from app.config import settings
from app.llm import chat, look

log = logging.getLogger(__name__)

# Only these can be structurally malformed. Plain handwriting cannot.
DIAGRAM_MARKUP = re.compile(r"\[(?:G|DRAW|T)\]")

INSPECT_PROMPT = """You are inspecting ONE image: a hand-drawn diagram a tutor
just drew on a whiteboard for a student. Judge only what you can see.

Report a problem ONLY if it would actually confuse or mislead the student:
- text overlapping other text, or a label struck through by the shape it sits in
- a label that spills outside its box, circle or cell
- connector lines or arrows that miss the thing they should touch, or cross
  through a node or label
- a shape cut off at the edge of the image
- table columns or rows that do not line up, or cells whose text collides
- anything unreadable, smeared, or drawn on top of something else

Do NOT report: hand-drawn wobble, uneven letter spacing, slight slant, ink
texture, or a style you would have drawn differently. This is deliberately
handwritten and imperfect — imperfection is not a defect.

Reply as JSON only:
{"ok": true|false,
 "severity": "none"|"minor"|"serious",
 "problems": ["one short concrete sentence each, naming what overlaps what"],
 "reads_as": "the text you can actually read, in order"}

"ok" is false only when severity is "serious" — something a student would
misread. Prefer "ok": true when unsure."""

REPAIR_PROMPT = """A hand-drawn diagram rendered badly. Rewrite its markup so
it renders correctly.

WHAT WENT WRONG (from looking at the rendered image):
%s

CURRENT MARKUP:
%s

Rules:
- Reply with ONLY the corrected markup. No explanation, no code fence.
- Keep the SAME content and meaning — same nodes, same labels, same rows. You
  are fixing composition, not rewriting the lesson.
- Shorten labels that do not fit rather than deleting them. Split one crowded
  diagram into two only if nothing else can work.
- Markup reference: [G]{json}[/G] auto-laid-out structures (tree/array/
  dp_table/linked_list/graph/stack/queue), [DRAW]...[/DRAW] freeform
  primitives, [T]a|b\\nc|d[/T] tables. A tree's nodes are "value:left:right"
  lines, one per node, with null for a missing child."""


@dataclass(slots=True)
class Verdict:
    ok: bool
    severity: str
    problems: list[str]
    reads_as: str = ""

    @classmethod
    def unknown(cls) -> Verdict:
        # Cannot see it → assume fine. A quality check that fails closed would
        # block lessons every time the vision model hiccups.
        return cls(ok=True, severity="none", problems=[])


@dataclass(slots=True)
class RepairResult:
    markup: str
    changed: bool
    verdict: Verdict
    attempts: int = 0


def _flatten_on_white(png_b64: str) -> tuple[str, int, int, float]:
    """Composite onto white and report size and ink coverage.

    The engine renders ink on a transparent sheet because the board supplies
    its own paper. A transparent PNG reaches a vision model as black-on-black,
    which is where "unreadable" answers — and confident hallucinations — come
    from. Coverage comes back too: a nearly-empty image is a defect we can
    detect arithmetically, and asking a model to describe a blank picture is
    how you get a story about a star constellation.
    """
    from io import BytesIO

    from PIL import Image

    raw = Image.open(BytesIO(base64.b64decode(png_b64))).convert("RGBA")
    white = Image.new("RGBA", raw.size, (255, 255, 255, 255))
    white.alpha_composite(raw)
    flat = white.convert("RGB")

    alpha = raw.getchannel("A")
    inked = sum(count for value, count in enumerate(alpha.histogram()) if value > 40)
    coverage = inked / max(1, raw.width * raw.height)

    buffer = BytesIO()
    flat.save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode(), raw.width, raw.height, coverage


async def render_png_b64(markup: str, scale: float = 1.0) -> str | None:
    """Ask the writer engine for the pixels a student would actually see."""
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            res = await client.post(
                f"{settings().writer_url}/render",
                json={"markup": markup, "scale": scale, "color": "#1f2020"},
            )
            res.raise_for_status()
            return res.json().get("png")
    except Exception as exc:
        log.warning("render for QA failed: %s", exc)
        return None


def _strip_fence(text: str) -> str:
    text = text.strip()
    fence = re.match(r"^```[a-zA-Z]*\n([\s\S]*?)\n?```$", text)
    return fence.group(1).strip() if fence else text


# Below this, there is nothing on the sheet worth showing a model. A diagram
# that renders to a handful of inked pixels has already failed.
MIN_COVERAGE = 0.004
MIN_PIXELS = 60 * 40


def expected_labels(markup: str) -> list[str]:
    """Every human-readable string the markup asks the board to draw.

    Used to catch the failure a picture cannot show: content the engine
    silently dropped. An ER entity with two attributes that renders as a bare
    box labelled "Doctor" is a *correct-looking* image — the vision model
    rightly says it is fine — and the student never learns the two attributes
    existed. Only comparing intent against result finds that.
    """
    labels: list[str] = []

    for block in re.findall(r"\[G\]\s*(\{[\s\S]*?\})\s*\[/G\]", markup):
        try:
            spec = json.loads(block)
        except ValueError:
            continue

        def walk(node) -> None:
            if isinstance(node, str):
                # Tree specs pack a whole structure into one string.
                for token in re.split(r"[:\n,]", node):
                    token = token.strip()
                    if token and token.lower() not in {"null", "none", "_", "-", "nil"}:
                        labels.append(token)
            elif isinstance(node, dict):
                for key, value in node.items():
                    if key == "type":
                        continue
                    walk(value)
            elif isinstance(node, list):
                for item in node:
                    walk(item)

        walk(spec)

    for block in re.findall(r"\[T\]([\s\S]*?)\[/T\]", markup):
        # Rows are separated by a literal backslash-n inside the markup string
        # (the model writes "\\n" in JSON), not by a real newline. Splitting on
        # only the real one glued each row's last cell to the next row's first.
        for cell in re.split(r"\||\\n|\n", block):
            cell = cell.strip()
            if cell:
                labels.append(cell)

    # Dedupe, keep order, drop the very short ones (a "0" or "x" is too easy to
    # match by accident in a transcription).
    seen: set[str] = set()
    out: list[str] = []
    for label in labels:
        key = label.lower()
        if len(label) >= 3 and key not in seen:
            seen.add(key)
            out.append(label)
    return out


def missing_from_render(markup: str, reads_as: str) -> list[str]:
    """Labels the markup asked for that are nowhere in what the model read."""
    if not reads_as:
        return []
    haystack = re.sub(r"[^a-z0-9]+", " ", reads_as.lower())
    missing = []
    for label in expected_labels(markup):
        needle = re.sub(r"[^a-z0-9]+", " ", label.lower()).strip()
        if needle and needle not in haystack:
            missing.append(label)
    return missing


async def inspect(png_b64: str) -> Verdict:
    try:
        flattened, width, height, coverage = _flatten_on_white(png_b64)
    except Exception as exc:
        log.warning("flatten failed: %s", exc)
        return Verdict.unknown()

    if width * height < MIN_PIXELS or coverage < MIN_COVERAGE:
        # Decided here, not by a model: an almost-blank image is exactly the
        # input that produces invented descriptions.
        return Verdict(
            ok=False,
            severity="serious",
            problems=[
                f"the diagram rendered almost empty ({width}x{height}px, "
                f"{coverage * 100:.1f}% ink) — most of its content was dropped"
            ],
        )

    try:
        raw = await look(INSPECT_PROMPT, [flattened], slot_name="read")
        data = json.loads(_strip_fence(raw))
    except Exception as exc:
        log.warning("vision inspect failed: %s", exc)
        return Verdict.unknown()
    severity = str(data.get("severity", "none")).lower()
    problems = [str(p) for p in (data.get("problems") or [])][:6]
    # Trust `severity` over `ok`: models set ok=false while listing only
    # cosmetic nits far more often than the reverse.
    return Verdict(
        ok=severity != "serious",
        severity=severity,
        problems=problems,
        reads_as=str(data.get("reads_as", ""))[:400],
    )


async def judge(markup: str, png_b64: str) -> Verdict:
    """The full verdict: is the picture well composed AND does it contain what
    was asked for.

    Both halves apply to the original render and to any repaired one. Judging
    a repair more leniently than the original is how a repair loop "fixes"
    something by changing nothing — the first version of this accepted a
    rewrite whose render was byte-for-byte as broken as the input.
    """
    verdict = await inspect(png_b64)
    dropped = missing_from_render(markup, verdict.reads_as)
    if not dropped:
        return verdict
    return Verdict(
        ok=False,
        severity="serious",
        problems=verdict.problems
        + ["the render is missing content the markup asked for: " + ", ".join(dropped[:8])],
        reads_as=verdict.reads_as,
    )


async def repair(markup: str, scale: float = 1.0, max_attempts: int = 1) -> RepairResult:
    """Render, look, and rewrite once if the render is genuinely broken."""
    if not DIAGRAM_MARKUP.search(markup):
        return RepairResult(markup=markup, changed=False, verdict=Verdict.unknown())

    png = await render_png_b64(markup, scale)
    if not png:
        # It did not even render. The markup is broken in a way a picture
        # cannot diagnose, so leave it: the board's own text fallback is a
        # better outcome than a guess.
        return RepairResult(markup=markup, changed=False, verdict=Verdict.unknown())

    verdict = await judge(markup, png)
    if verdict.ok:
        return RepairResult(markup=markup, changed=False, verdict=verdict)

    current = markup
    for attempt in range(1, max_attempts + 1):
        problems = "\n".join(f"- {p}" for p in verdict.problems) or "- the diagram is unreadable"
        try:
            rewritten = _strip_fence(
                await chat(
                    [{"role": "user", "content": REPAIR_PROMPT % (problems, current)}],
                    slot_name="reason",
                )
            )
        except Exception as exc:
            log.warning("repair rewrite failed: %s", exc)
            break
        if not rewritten or rewritten == current:
            break

        new_png = await render_png_b64(rewritten, scale)
        if not new_png:
            # The rewrite does not render at all — strictly worse than a badly
            # composed diagram that does.
            break
        new_verdict = await judge(rewritten, new_png)
        if new_verdict.ok:
            return RepairResult(
                markup=rewritten, changed=True, verdict=new_verdict, attempts=attempt
            )
        current, verdict = rewritten, new_verdict

    return RepairResult(markup=markup, changed=False, verdict=verdict, attempts=max_attempts)
