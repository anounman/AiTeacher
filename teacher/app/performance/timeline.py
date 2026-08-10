"""The cue plan: when each sentence is spoken and each stroke starts.

Ported from web/lib/teach/timeline.ts, which stays as the browser's fallback.
The two must agree exactly — `tests/fixtures/timeline_cases.json` is generated
from the TypeScript implementation and asserted against this one, so a drift in
either is a failing test rather than a lesson that plays differently depending
on whether the service was up.

Why it moved here: the teaching plane (deepagents) produces the lesson in this
process. Planning its pacing in the browser meant shipping the whole event
stream out just to have the timing sent back.

Nothing in here touches a clock. It is a pure function from events to a plan;
the browser still owns playback, pausing and rendering, because those need the
audio element and the DOM.
"""
from __future__ import annotations

import math
import re
from dataclasses import asdict, dataclass, field

MIN_SPEECH_MS = 850
MAX_SPEECH_MS = 12_000
MS_PER_WORD = 335
DRAW_ONLY_CADENCE_MS = 650
MIN_CAMERA_CUE_GAP_MS = 520

_PUNCTUATION = re.compile(r"[,;:—]")
_WHITESPACE = re.compile(r"\s+")


@dataclass(slots=True)
class SpeechCue:
    event_index: int
    text: str
    at_ms: float
    estimated_duration_ms: float


@dataclass(slots=True)
class DrawCue:
    event_index: int
    at_ms: float


@dataclass(slots=True)
class LessonBeat:
    from_index: int
    to_index: int
    estimated_duration_ms: float
    speech: list[SpeechCue] = field(default_factory=list)
    draws: list[DrawCue] = field(default_factory=list)


def estimate_speech_duration_ms(text: str) -> float:
    words = len([w for w in _WHITESPACE.split(text.strip()) if w])
    # A small punctuation allowance stops short explanatory sentences from
    # feeling rushed without making long paragraphs increasingly inaccurate.
    punctuation_pauses = len(_PUNCTUATION.findall(text)) * 90
    return max(
        MIN_SPEECH_MS,
        min(MAX_SPEECH_MS, words * MS_PER_WORD + punctuation_pauses + 180),
    )


def _js_round(value: float) -> int:
    """JavaScript's Math.round: halves go up, not to even. Python's round()
    would disagree on exactly the .5 cases the cue spacing produces."""
    return math.floor(value + 0.5)


def _plan_beat(events: list[dict], start: int, end: int) -> LessonBeat:
    speech: list[SpeechCue] = []
    draw_indices: list[int] = []
    speech_at_ms = 0.0

    for index in range(start, end):
        event = events[index]
        if event.get("kind") == "speak":
            duration = estimate_speech_duration_ms(event.get("text", ""))
            speech.append(
                SpeechCue(
                    event_index=index,
                    text=event.get("text", ""),
                    at_ms=speech_at_ms,
                    estimated_duration_ms=duration,
                )
            )
            speech_at_ms += duration
        else:
            draw_indices.append(index)

    if not draw_indices:
        return LessonBeat(start, end, speech_at_ms, speech, [])

    if not speech:
        draws = [
            DrawCue(event_index=index, at_ms=position * DRAW_ONLY_CADENCE_MS)
            for position, index in enumerate(draw_indices)
        ]
        return LessonBeat(
            start,
            end,
            max(MIN_SPEECH_MS, draws[-1].at_ms + DRAW_ONLY_CADENCE_MS),
            speech,
            draws,
        )

    # Spread visuals through the narration rather than starting every drawing
    # at once. The pen starts almost immediately with the voice — a teacher
    # talks WHILE drawing, not before it — with a short tail for the last
    # stroke before the next beat.
    cue_window_start = min(120.0, speech_at_ms * 0.08)
    cue_window_end = max(cue_window_start, speech_at_ms - 360)
    cue_window_ms = cue_window_end - cue_window_start
    # When a model emits many tiny board actions, batch them into a bounded
    # number of cue moments, so the camera performs one move per batch instead
    # of a chain of interrupted tweens.
    cue_moments = min(
        len(draw_indices),
        max(1, math.floor(cue_window_ms / MIN_CAMERA_CUE_GAP_MS) + 1),
    )

    draws: list[DrawCue] = []
    for position, index in enumerate(draw_indices):
        if cue_moments == 1:
            at_ms = cue_window_start
        else:
            moment = _js_round(position * (cue_moments - 1) / (len(draw_indices) - 1))
            at_ms = cue_window_start + (cue_window_ms * moment) / (cue_moments - 1)
        draws.append(DrawCue(event_index=index, at_ms=at_ms))

    return LessonBeat(start, end, speech_at_ms, speech, draws)


def build_lesson_timeline(events: list[dict], start_at: int = 0) -> list[LessonBeat]:
    """Document-order events → narration/visual beats.

    A beat is a run of speech plus the run of board actions that follows it.
    Starting from an interruption cursor produces exactly the same suffix, so
    resuming a paused lesson cannot re-time what is already on the board.
    """
    beats: list[LessonBeat] = []
    cursor = max(0, min(len(events), start_at))

    while cursor < len(events):
        start = cursor
        while cursor < len(events) and events[cursor].get("kind") == "speak":
            cursor += 1
        while cursor < len(events) and events[cursor].get("kind") == "draw":
            cursor += 1
        # Only two kinds exist today; the guard keeps a future protocol
        # extension from wedging the performer in an infinite loop.
        if cursor == start:
            cursor += 1
        beats.append(_plan_beat(events, start, cursor))

    return beats


def timeline_to_json(beats: list[LessonBeat]) -> list[dict]:
    """Wire shape. Keys are camelCase because the consumer is TypeScript."""
    out = []
    for beat in beats:
        data = asdict(beat)
        out.append(
            {
                "from": data["from_index"],
                "to": data["to_index"],
                "estimatedDurationMs": data["estimated_duration_ms"],
                "speech": [
                    {
                        "eventIndex": cue["event_index"],
                        "atMs": cue["at_ms"],
                        "estimatedDurationMs": cue["estimated_duration_ms"],
                    }
                    for cue in data["speech"]
                ],
                "draws": [
                    {"eventIndex": cue["event_index"], "atMs": cue["at_ms"]}
                    for cue in data["draws"]
                ],
            }
        )
    return out
