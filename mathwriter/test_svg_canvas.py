"""Tests for the vector writing path: glyph tracing + the SVG backend.

Run: .venv/bin/python -m unittest test_svg_canvas -v
"""
import json
import os
import re
import unittest

import cv2
import numpy as np
from PIL import Image

import render as rd
from svg_canvas import SVGCanvas, GlyphRef, vector_glyphs
from vectorize_glyphs import load_or_build, glyph_id, trace_alpha

HERE = os.path.dirname(os.path.abspath(__file__))


def _bezier_points(d, scale=1.0):
    """Sample an SVG path's cubics back into polygons, for fidelity checks."""
    subpaths, cur = [], []
    for cmd in re.findall(r"[MCZ][^MCZ]*", d):
        head, nums = cmd[0], [float(v) for v in re.findall(r"-?\d+\.?\d*", cmd[1:])]
        if head == "M":
            cur = [(nums[0] * scale, nums[1] * scale)]
        elif head == "C":
            for i in range(0, len(nums), 6):
                p0 = cur[-1]
                c1 = (nums[i] * scale, nums[i + 1] * scale)
                c2 = (nums[i + 2] * scale, nums[i + 3] * scale)
                p3 = (nums[i + 4] * scale, nums[i + 5] * scale)
                for t in np.linspace(0, 1, 8)[1:]:
                    cur.append(
                        (
                            (1 - t) ** 3 * p0[0] + 3 * (1 - t) ** 2 * t * c1[0]
                            + 3 * (1 - t) * t ** 2 * c2[0] + t ** 3 * p3[0],
                            (1 - t) ** 3 * p0[1] + 3 * (1 - t) ** 2 * t * c1[1]
                            + 3 * (1 - t) * t ** 2 * c2[1] + t ** 3 * p3[1],
                        )
                    )
        elif head == "Z":
            if len(cur) > 2:
                subpaths.append(cur)
            cur = []
    if len(cur) > 2:
        subpaths.append(cur)
    return subpaths


class TestGlyphTracing(unittest.TestCase):
    def test_atlas_covers_the_dataset(self):
        atlas = load_or_build()["glyphs"]
        meta = json.load(open(os.path.join(HERE, "glyphs", "metadata.json")))
        expected = {glyph_id(v["file"]) for vs in meta.values() for v in vs}
        missing = expected - set(atlas)
        self.assertEqual(missing, set(), f"{len(missing)} glyphs failed to trace")

    def test_traced_outlines_match_their_source(self):
        """Every traced glyph must still be the same shape. The floor is the
        real guard: a tracer regression shows up here, not in a lesson."""
        atlas = load_or_build()["glyphs"]
        meta = json.load(open(os.path.join(HERE, "glyphs", "metadata.json")))
        up = 8
        scores = []
        for char in ["a", "e", "A", "0", "8", "g", "=", "S", "x", "m", "w", "B"]:
            variant = meta[char][0]
            glyph = atlas[glyph_id(variant["file"])]
            alpha = np.array(
                Image.open(os.path.join(HERE, variant["file"])).convert("RGBA")
            )[..., 3]
            h, w = alpha.shape
            mask = (
                cv2.GaussianBlur(
                    cv2.resize(alpha, (w * up, h * up), interpolation=cv2.INTER_CUBIC),
                    (0, 0), up * 0.35,
                )
                > 110
            )
            # even-odd fill: XOR each subpath so counters stay holes
            acc = np.zeros(mask.shape, bool)
            for sub in _bezier_points(glyph["d"], up):
                one = np.zeros(mask.shape, np.uint8)
                cv2.fillPoly(one, [np.array(sub, np.int32).reshape(-1, 1, 2)], 1)
                acc ^= one.astype(bool)
            inter = np.logical_and(acc, mask).sum()
            union = np.logical_or(acc, mask).sum()
            scores.append(inter / max(union, 1))
        self.assertGreater(min(scores), 0.85, f"worst glyph IoU {min(scores):.3f}")
        self.assertGreater(sum(scores) / len(scores), 0.90)

    def test_blank_input_is_not_a_path(self):
        d, n = trace_alpha(np.zeros((10, 10), np.uint8))
        self.assertEqual((d, n), ("", 0))


class TestSVGCanvas(unittest.TestCase):
    def _render(self, markup, scale=0.72):
        glyphs = vector_glyphs(rd.load_glyphs())
        return rd.render_pages(
            markup, page_size=(1300, 6000),
            margin_top=30, margin_bottom=30, margin_left=20, margin_right_min=20,
            scale=scale, glyphs=glyphs, canvas_factory=SVGCanvas,
        )[0]

    def test_emits_glyph_references_not_bitmaps(self):
        page = self._render("hello")
        svg = page.to_svg()
        self.assertIn("<use ", svg)
        self.assertNotIn("<image", svg, "text fell back to an embedded bitmap")
        self.assertTrue(svg.startswith("<svg"))
        self.assertIn("</svg>", svg)

    def test_ink_is_themeable(self):
        """Ordinary ink must be currentColor so dark mode is a CSS concern —
        the engine's literal blue must never reach the client."""
        svg = self._render("linking letters").to_svg()
        self.assertNotIn("rgb(15,70,180)", svg)
        self.assertIn("currentColor", svg)

    def test_geometry_comes_from_layout(self):
        page = self._render("alpha beta gamma")
        lines = page.lines()
        self.assertEqual(len(lines), 1)
        self.assertEqual(len(lines[0]["words"]), 3)
        for word in lines[0]["words"]:
            self.assertGreater(word["w"], 0)
            self.assertGreater(word["h"], 0)
        xs = [w["x"] for w in lines[0]["words"]]
        self.assertEqual(xs, sorted(xs), "words must be in reading order")

    def test_defs_can_be_shared(self):
        page = self._render("shared atlas")
        with_defs = page.to_svg(include_defs=True)
        without = page.to_svg(include_defs=False)
        self.assertLess(len(without), len(with_defs) / 2)
        self.assertTrue(page.used_glyphs)

    def test_unknown_images_still_render(self):
        """The incremental-migration guarantee: anything not vectorized is
        embedded rather than dropped."""
        canvas = SVGCanvas((100, 100))
        canvas.alpha_composite(Image.new("RGBA", (8, 8), (255, 0, 0, 255)), (3, 4))
        self.assertIn("<image", canvas.to_svg())


class TestGlyphRef(unittest.TestCase):
    def test_transform_matches_pil_placement(self):
        """A rotated+scaled GlyphRef must land where PIL would have put the
        bitmap: same centre, same box."""
        img = Image.new("RGBA", (10, 20), (0, 0, 0, 255))
        ref = GlyphRef("X", img).resize((20, 40)).rotate(10, expand=True)
        ew, eh = ref.size
        transform = ref.svg_transform(100, 200)
        cx, cy = (float(v) for v in re.search(
            r"translate\(([-\d.]+),([-\d.]+)\)", transform).groups())
        self.assertAlmostEqual(cx, 100 + ew / 2, places=1)
        self.assertAlmostEqual(cy, 200 + eh / 2, places=1)
        # PIL rotates counter-clockwise; SVG's rotate is clockwise-positive.
        self.assertIn("rotate(-10", transform)

    def test_pixels_remain_readable(self):
        """find_pen_point scans the transformed glyph — the real image has to
        survive the wrapper."""
        img = Image.new("RGBA", (10, 20), (0, 0, 0, 255))
        ref = GlyphRef("X", img).resize((20, 40))
        self.assertEqual(np.asarray(ref).shape[:2], (40, 20))
        self.assertEqual(ref.size, (20, 40))


if __name__ == "__main__":
    unittest.main()
