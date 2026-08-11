"""Performance plane HTTP surface.

Just the cue plan for now. Playback stays in the browser — it needs the audio
element, the DOM and the pause state — but *when* each thing happens is decided
here, next to the agents that will soon be producing the lesson.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.performance.clips import ClipSpec, render_clip
from app.performance.safe_expr import UnsafeExpression
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


@router.post("/clip")
async def clip(spec: ClipSpec) -> dict:
    """Render an animated clip, or return the cached one.

    Content-addressed, so asking twice costs nothing. Measured warm in this
    process: ~0.3s for 5 seconds of 720p30 — fast enough to run while the
    lesson is still being written, which is the only reason this is viable at
    all in a live tutor.
    """
    try:
        result = await render_clip(spec)
    except UnsafeExpression as exc:
        # The expression came from a model. A rejection is a bad request, not
        # a server fault, and the message says exactly what was refused.
        raise HTTPException(status_code=400, detail=f"unsafe expression: {exc}") from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"clip render failed: {exc}") from exc
    return {
        "id": result["id"],
        "kind": result["kind"],
        "cached": result["cached"],
        "url": f"/clips/{result['id']}.mp4",
    }
