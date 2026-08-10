"""Teaching plane HTTP surface.

Non-streaming on purpose. The board already waits for the whole lesson before
playing it — the performer pre-renders every handwriting line during
generation, then paces playback from the cache — so streaming tokens to a
client that cannot use them yet would add failure modes for no gain.
"""
from __future__ import annotations

from dataclasses import asdict

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.agents.teach import teach
from app.config import settings

router = APIRouter(prefix="/agents", tags=["agents"])


class TeachRequest(BaseModel):
    question: str
    workspace_id: str | None = Field(default=None, alias="workspaceId")
    history: list[dict] = Field(default_factory=list)

    model_config = {"populate_by_name": True}


@router.post("/teach")
async def teach_route(req: TeachRequest) -> dict:
    lesson = await teach(
        req.question,
        req.workspace_id or settings().default_workspace_id,
        req.history,
    )
    return {
        "markdown": lesson.markdown,
        "model": lesson.model,
        "evidence": lesson.evidence,
        # Surfaced, not hidden: the eval harness counts invented markers, and
        # a spike in them is the first sign a model swap went wrong.
        "grounding": asdict(lesson.grounding),
        "renderQa": lesson.render_qa,
    }
