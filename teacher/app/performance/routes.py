"""Performance plane HTTP surface.

Just the cue plan for now. Playback stays in the browser — it needs the audio
element, the DOM and the pause state — but *when* each thing happens is decided
here, next to the agents that will soon be producing the lesson.
"""
from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.performance.render_qa import repair
from app.performance.timeline import build_lesson_timeline, timeline_to_json

router = APIRouter(prefix="/performance", tags=["performance"])


class TimelineRequest(BaseModel):
    # Events arrive as the browser parsed them. Only `kind` is read today;
    # the whole action is accepted so pacing can become action-aware (a
    # diagram deserves a longer settle than a one-line write) without a
    # wire change.
    events: list[dict]
    start_at: int = Field(default=0, alias="startAt")

    model_config = {"populate_by_name": True}


@router.post("/timeline")
def timeline(req: TimelineRequest) -> dict:
    beats = build_lesson_timeline(req.events, req.start_at)
    return {"beats": timeline_to_json(beats)}


class RepairRequest(BaseModel):
    markup: str
    scale: float = 1.0


@router.post("/repair-markup")
async def repair_markup(req: RepairRequest) -> dict:
    """Render it, look at it, rewrite it if it came out broken.

    Never fails the caller: an unreachable vision model, a failed render or a
    rewrite that renders worse all return the original markup unchanged.
    """
    result = await repair(req.markup, req.scale)
    return {
        "markup": result.markup,
        "changed": result.changed,
        "attempts": result.attempts,
        "verdict": {
            "ok": result.verdict.ok,
            "severity": result.verdict.severity,
            "problems": result.verdict.problems,
            "reads_as": result.verdict.reads_as,
        },
    }
