"""Run render QA over a whole lesson before the student sees it.

Timing is the point. This happens while the lesson is being produced, not while
it is being performed — the same window the board already uses to pre-render
handwriting. By playback time every diagram has either been checked, repaired,
or left alone; nothing pauses mid-sentence to think about composition.

Bounded hard, because quality control that delays a lesson is a worse defect
than the ones it catches:
  - only diagram markup is inspected
  - at most MAX_ITEMS diagrams per lesson, checked concurrently
  - a per-lesson deadline; whatever has not finished keeps its original markup
"""
from __future__ import annotations

import asyncio
import json
import logging
import re

from app.performance.render_qa import DIAGRAM_MARKUP, repair

log = logging.getLogger(__name__)

MAX_ITEMS = 4
DEADLINE_S = 90.0

BOARD_FENCE = re.compile(r"```board\s*\n([\s\S]*?)\n?```", re.MULTILINE)


async def repair_lesson(lesson_md: str) -> tuple[str, list[dict]]:
    """Return the lesson with broken diagrams repaired, plus a QA report.

    The report is kept even when nothing changed: "we looked and it was fine"
    and "we never looked" are different facts, and only one of them means the
    board is trustworthy.
    """
    fences = list(BOARD_FENCE.finditer(lesson_md))
    if not fences:
        return lesson_md, []

    # (fence index, action index, markup) for every diagram in the lesson.
    targets: list[tuple[int, int, str]] = []
    parsed: dict[int, list] = {}
    for fence_index, fence in enumerate(fences):
        try:
            actions = json.loads(fence.group(1))
        except ValueError:
            continue
        if not isinstance(actions, list):
            continue
        parsed[fence_index] = actions
        for action_index, action in enumerate(actions):
            if not isinstance(action, dict) or action.get("type") != "write":
                continue
            markup = action.get("markup", "")
            if isinstance(markup, str) and DIAGRAM_MARKUP.search(markup):
                targets.append((fence_index, action_index, markup))

    if not targets:
        return lesson_md, []

    dropped = max(0, len(targets) - MAX_ITEMS)
    if dropped:
        # Say so rather than silently checking the first four: a partial pass
        # reported as a full one is how "we have QA" becomes false.
        log.info("render QA: %d diagrams over the cap, left unchecked", dropped)
    targets = targets[:MAX_ITEMS]

    async def one(target: tuple[int, int, str]):
        _, _, markup = target
        return await repair(markup)

    try:
        results = await asyncio.wait_for(
            asyncio.gather(*(one(t) for t in targets), return_exceptions=True),
            timeout=DEADLINE_S,
        )
    except TimeoutError:
        log.warning("render QA hit the %.0fs deadline; lesson unchanged", DEADLINE_S)
        return lesson_md, [{"status": "timeout", "checked": 0, "unchecked": len(targets)}]

    report: list[dict] = []
    for (fence_index, action_index, markup), result in zip(targets, results, strict=True):
        if isinstance(result, BaseException):
            report.append({"markup": markup[:80], "status": "error", "detail": str(result)[:200]})
            continue
        report.append(
            {
                "markup": markup[:80],
                "status": "repaired" if result.changed else ("ok" if result.verdict.ok else "broken"),
                "severity": result.verdict.severity,
                "problems": result.verdict.problems,
            }
        )
        if result.changed:
            parsed[fence_index][action_index]["markup"] = result.markup

    if dropped:
        report.append({"status": "skipped", "unchecked": dropped, "reason": f"cap of {MAX_ITEMS}"})

    # Rebuild only the fences that actually changed, back to front so earlier
    # spans stay valid.
    changed_fences = {
        fence_index
        for (fence_index, _, _), result in zip(targets, results, strict=True)
        if not isinstance(result, BaseException) and result.changed
    }
    out = lesson_md
    for fence_index in sorted(changed_fences, reverse=True):
        fence = fences[fence_index]
        body = json.dumps(parsed[fence_index], ensure_ascii=False, indent=2)
        out = out[: fence.start()] + f"```board\n{body}\n```" + out[fence.end() :]

    return out, report
