"""The Python cue planner must match the browser's, cue for cue.

`fixtures/timeline_cases.json` is generated from lib/teach/timeline.ts
(`node --import tsx web/scripts/dump-timeline-fixtures.mts`). If either
implementation drifts, this fails — instead of a lesson whose pacing depends
on whether the teacher service happened to be reachable.
"""
import json
import pathlib

import pytest

from app.performance.timeline import build_lesson_timeline, timeline_to_json

FIXTURES = pathlib.Path(__file__).parent / "fixtures" / "timeline_cases.json"
CASES = json.loads(FIXTURES.read_text())


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_matches_typescript(case):
    produced = timeline_to_json(
        build_lesson_timeline(case["events"], case.get("startAt", 0))
    )
    assert produced == case["beats"]


def test_fixture_set_actually_covers_the_branches():
    names = {c["name"] for c in CASES}
    assert {"empty", "draw only cadence", "dense visuals batch", "interruption cursor"} <= names
