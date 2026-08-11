"""Animated clips: the third visual track.

The board has handwriting (mathwriter) and static hand-drawn diagrams (the
visual engine). Neither can show a process *changing over time* — a secant
sliding into a tangent, rectangles converging on an area, a pointer walking an
array. That is what a student asks for when they say "show me what happens
as h gets small", and it is what the derivative lesson could not do.

Manim renders those, and it is fast enough to do it per lesson: measured in
this process, 5 seconds of 720p30 takes ~0.3s warm (0.5s once for the import).
Sixteen times faster than realtime, so a clip is ready long before the voice
reaches it.

THE MODEL DOES NOT WRITE MANIM CODE. It picks a template and fills in semantic
parameters; the scene is built by the functions below. This is the same rule
that made the visual engine work, and here it also keeps us from executing
model-authored Python in a process that holds the database.

Clips are content-addressed: the same spec is rendered once, ever.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import pathlib
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.performance.safe_expr import UnsafeExpression, compile_expression

log = logging.getLogger(__name__)

CLIP_DIR = pathlib.Path(
    os.environ.get("TEACHER_CLIP_DIR", pathlib.Path(__file__).resolve().parents[2] / "media" / "clips")
)
QUALITY = os.environ.get("TEACHER_CLIP_QUALITY", "medium_quality")

# Bump when a scene builder or the palette changes. The cache key covers the
# RECIPE as well as the spec: without this, restyling the clips silently kept
# serving the old renders, because the spec had not changed.
RENDER_VERSION = 2

# The board's palette (web/app/globals.css). Manim's defaults are white-on-
# black, which reads as a video embedded in the lesson rather than part of it.
# Rendered light because the clip sits on paper; dark mode inverts it in CSS
# the same way handwriting already does.
PAPER = "#f2f0e7"
INK = "#1f2020"
ACCENT = "#2e5c8a"      # chalk blue, the board's own curve colour
EMPHASIS = "#b3402f"    # the moving secant — red means "watch this"
HIGHLIGHT = "#c8892a"

# One render at a time. Manim mutates global config, and two scenes rendering
# concurrently in one process would interleave into each other's frames.
_render_lock = asyncio.Lock()


class TangentClip(BaseModel):
    """A secant sliding into the tangent at a point — the geometric meaning of
    a derivative, which is the one thing a static picture cannot convey."""

    kind: Literal["function_tangent"] = "function_tangent"
    expression: str = Field(description="f(x), e.g. 'x**2'")
    at: float = Field(default=1.0, description="the x where the tangent is taken")
    x_min: float = -1.0
    x_max: float = 4.0
    start_dx: float = 1.5
    label: str = ""


class RiemannClip(BaseModel):
    """Rectangles refining under a curve — the integral as accumulated area."""

    kind: Literal["function_area"] = "function_area"
    expression: str
    x_min: float = 0.0
    x_max: float = 3.0
    start_bars: int = 4
    end_bars: int = 40
    label: str = ""


ClipSpec = TangentClip | RiemannClip


def spec_hash(spec: ClipSpec) -> str:
    payload = json.dumps(spec.model_dump(), sort_keys=True) + f"|{QUALITY}|v{RENDER_VERSION}"
    return hashlib.sha256(payload.encode()).hexdigest()[:16]


_SUPERSCRIPT = str.maketrans("0123456789", "\u2070\u00b9\u00b2\u00b3\u2074\u2075\u2076\u2077\u2078\u2079")


def prettify(expression: str) -> str:
    """`x**2` is Python; a student reads `x²`. Without a LaTeX install we
    cannot typeset properly, so at minimum stop showing them source code."""
    import re as _re

    out = _re.sub(r"\*\*\s*(\d+)", lambda m: m.group(1).translate(_SUPERSCRIPT), expression)
    out = out.replace("*", "\u00b7").replace("sqrt", "\u221a")
    return out.replace("  ", " ").strip()


def _axes_range(values: list[float]) -> tuple[float, float]:
    low = min(values)
    high = max(values)
    if high - low < 1e-6:
        high = low + 1
    pad = (high - low) * 0.15
    return low - pad, high + pad


def _build_scene(spec: ClipSpec):
    """Construct the Manim Scene class for a spec. Imported lazily: manim pulls
    in numpy, cairo, pango and ffmpeg bindings, and a service that never
    renders a clip should not pay for that at boot."""
    from manim import (  # noqa: PLC0415
        UL, Axes, Create, Dot, FadeIn, Scene, Text, ValueTracker, always_redraw,
    )

    f = compile_expression(spec.expression)
    samples = [float(f(spec.x_min + (spec.x_max - spec.x_min) * i / 40)) for i in range(41)]
    y_min, y_max = _axes_range([s for s in samples if s == s])  # drop NaN
    label_text = spec.label or f"f(x) = {prettify(spec.expression)}"

    if isinstance(spec, TangentClip):
        at = spec.at
        start_dx = spec.start_dx

        class TangentScene(Scene):
            def construct(self) -> None:
                axes = Axes(
                    x_range=[spec.x_min, spec.x_max],
                    y_range=[y_min, y_max],
                    x_length=7,
                    y_length=4.2,
                    tips=False,
                    axis_config={"color": INK, "stroke_width": 2},
                )
                graph = axes.plot(f, color=ACCENT)
                self.play(Create(axes), Create(graph), run_time=1.2)
                self.play(FadeIn(Text(label_text, font_size=28, color=INK).to_corner(UL)), run_time=0.4)
                self.play(FadeIn(Dot(axes.c2p(at, float(f(at))), color=HIGHLIGHT)), run_time=0.3)
                dx = ValueTracker(start_dx)
                self.add(
                    always_redraw(
                        lambda: axes.get_secant_slope_group(
                            x=at,
                            graph=graph,
                            dx=max(1e-3, dx.get_value()),
                            secant_line_color=EMPHASIS,
                            secant_line_length=6,
                            # No dx_label: Manim types it with MathTex, which
                            # needs a full LaTeX install (standalone.cls +
                            # dvisvgm). Requiring TeX to draw a tangent line
                            # would make the whole track undeployable on a
                            # machine with BasicTeX. The moving secant is the
                            # explanation; the letter h is decoration.
                        )
                    )
                )
                self.wait(0.4)
                # The whole point: watch the secant become the tangent.
                self.play(dx.animate.set_value(0.02), run_time=2.6)
                self.wait(0.8)

        return TangentScene

    class AreaScene(Scene):
        def construct(self) -> None:
            axes = Axes(
                x_range=[spec.x_min, spec.x_max],
                y_range=[min(0.0, y_min), y_max],
                x_length=7,
                y_length=4.2,
                tips=False,
                axis_config={"color": INK, "stroke_width": 2},
            )
            graph = axes.plot(f, color=ACCENT)
            self.play(Create(axes), Create(graph), run_time=1.2)
            self.play(FadeIn(Text(label_text, font_size=28, color=INK).to_corner(UL)), run_time=0.4)
            bars = axes.get_riemann_rectangles(
                graph, x_range=[spec.x_min, spec.x_max], dx=(spec.x_max - spec.x_min) / spec.start_bars
            )
            self.play(Create(bars), run_time=0.8)
            for count in (spec.start_bars * 2, spec.start_bars * 5, spec.end_bars):
                finer = axes.get_riemann_rectangles(
                    graph, x_range=[spec.x_min, spec.x_max], dx=(spec.x_max - spec.x_min) / count
                )
                self.play(bars.animate.become(finer), run_time=0.7)
            self.wait(0.8)

    return AreaScene


def _render_sync(spec: ClipSpec, out_dir: pathlib.Path, name: str) -> pathlib.Path:
    from manim import config, tempconfig  # noqa: PLC0415

    scene_class = _build_scene(spec)
    with tempconfig(
        {
            "quality": QUALITY,
            "disable_caching": True,
            "verbosity": "ERROR",
            "progress_bar": "none",
            "media_dir": str(out_dir),
            "output_file": name,
            "background_color": PAPER,
        }
    ):
        scene_class().render()
        produced = pathlib.Path(config.output_file)
    if not produced.exists():
        raise RuntimeError(f"manim reported success but produced no file at {produced}")
    return produced


async def render_clip(spec: ClipSpec) -> dict[str, Any]:
    """Render (or reuse) a clip. Returns its id, path and whether it was cached."""
    digest = spec_hash(spec)
    CLIP_DIR.mkdir(parents=True, exist_ok=True)
    final = CLIP_DIR / f"{digest}.mp4"
    if final.exists():
        return {"id": digest, "path": str(final), "cached": True, "kind": spec.kind}

    # Validate before taking the lock: a bad expression should fail instantly,
    # not behind another render.
    compile_expression(spec.expression)

    work = CLIP_DIR / f"work-{digest}"
    async with _render_lock:
        if final.exists():
            return {"id": digest, "path": str(final), "cached": True, "kind": spec.kind}
        produced = await asyncio.to_thread(_render_sync, spec, work, digest)
        produced.replace(final)

    try:
        import shutil  # noqa: PLC0415

        shutil.rmtree(work, ignore_errors=True)
    except OSError:
        pass
    return {"id": digest, "path": str(final), "cached": False, "kind": spec.kind}


__all__ = ["ClipSpec", "TangentClip", "RiemannClip", "render_clip", "spec_hash", "UnsafeExpression"]
