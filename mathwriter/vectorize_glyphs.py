"""Compile the harvested glyph rasters into resolution-independent SVG paths.

Why this exists
---------------
`glyphs/` holds 748 alpha-only PNGs whose median size is 15x21 px. The board
renders them at 0.55-1.05 scale (a lowercase letter lands 8-11 px tall), then
the browser upscales by devicePixelRatio and by the canvas zoom - up to ~5x on
an iPad at max zoom. Nothing at the end of that chain can be crisp. Tracing
each glyph once into a filled outline makes the pen resolution-independent:
the same path is sharp at 50% and at 250%.

Approach
--------
Trace the RAW file alpha (never `render.recolor_to_blue`, which hard-binarizes
and blurs at source resolution before anything else sees it):

    upsample 8x (INTER_CUBIC) -> Gaussian sigma=0.35*up -> threshold 110
    -> findContours(RETR_CCOMP) -> approxPolyDP(eps=0.3% of perimeter)
    -> Catmull-Rom -> cubic Bezier

Measured on the real dataset: the simplified polygon reaches IoU 0.971, and
Catmull-Rom smoothing trades a little of that back (mean 0.929, min 0.910) to
round the facets out — a smooth 0.93 reads better at 250% zoom than a faceted
0.97. All 748 glyphs cost 1.0 MB raw / ~307 KB gzipped, fetched ONCE per
session as a shared atlas; each render then ships only `<use>` references.
Upsampling before thresholding buys the sub-pixel accurate boundary;
simplifying afterwards keeps the payload small.

The `potracer` pure-python port was evaluated first and rejected: given a
20x20 square it returns a diamond spanning the whole bitmap. Real potrace
needs a C toolchain, and OpenCV (already a dependency) plus Catmull-Rom
smoothing reaches the same place.

Glyphs are ink *blobs*, not centerlines, so these are FILLED paths with
`fill-rule="evenodd"` - which preserves the pen's weight variation.

Coordinates are emitted in SOURCE GLYPH PIXELS (the upsample is divided back
out), so `w`/`h`/`baseline_y` from metadata.json keep their meaning and the
layout engine needs no unit conversion.

Run directly to (re)build:  .venv/bin/python vectorize_glyphs.py
"""
import hashlib
import json
import os
import sys

import cv2
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))

# Bump when the tracing parameters or output shape change — `load_or_build`
# treats a version mismatch as a cache miss and regenerates.
GLYPH_PATHS_VERSION = 1

UPSAMPLE = 8
BLUR_SIGMA_FRAC = 0.35
THRESHOLD = 110
SIMPLIFY_FRAC = 0.003
MIN_CONTOUR_AREA = 6.0  # in upsampled px²: drops speckle, keeps dots on i/j

# Generated, gitignored, and owned by the engine — not by the app's data dir.
DEFAULT_OUT = os.path.join(HERE, ".cache", "glyphs.paths.json")


def _catmull_rom_to_bezier(pts):
    """Closed Catmull-Rom spline through `pts` as SVG cubic segments.

    Returns the `d` fragment for one subpath. Polygon corners from
    approxPolyDP would read as faceted at 250% zoom; this rounds them back
    into curves without re-introducing the points we just removed.
    """
    n = len(pts)
    if n < 3:
        return ""
    out = [f"M{pts[0][0]:.1f},{pts[0][1]:.1f}"]
    for i in range(n):
        p0 = pts[(i - 1) % n]
        p1 = pts[i]
        p2 = pts[(i + 1) % n]
        p3 = pts[(i + 2) % n]
        c1 = (p1[0] + (p2[0] - p0[0]) / 6.0, p1[1] + (p2[1] - p0[1]) / 6.0)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6.0, p2[1] - (p3[1] - p1[1]) / 6.0)
        # 0.1px in SOURCE glyph units (~1/150 of a glyph) — far finer than
        # any display can resolve, and ~20% smaller than 2 decimals.
        out.append(
            f"C{c1[0]:.1f},{c1[1]:.1f} {c2[0]:.1f},{c2[1]:.1f} {p2[0]:.1f},{p2[1]:.1f}"
        )
    out.append("Z")
    return "".join(out)


def trace_alpha(alpha, up=UPSAMPLE, simplify=SIMPLIFY_FRAC):
    """Alpha channel -> (svg path `d` in source-pixel units, contour count)."""
    if alpha is None or alpha.size == 0 or alpha.max() == 0:
        return "", 0
    h, w = alpha.shape
    big = cv2.resize(alpha, (w * up, h * up), interpolation=cv2.INTER_CUBIC)
    big = cv2.GaussianBlur(big, (0, 0), up * BLUR_SIGMA_FRAC)
    mask = (big > THRESHOLD).astype(np.uint8) * 255
    contours, _ = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)

    parts = []
    for contour in contours:
        if cv2.contourArea(contour) < MIN_CONTOUR_AREA * up:
            continue
        perimeter = cv2.arcLength(contour, True)
        simplified = cv2.approxPolyDP(contour, simplify * perimeter, True)
        pts = [(float(p[0][0]) / up, float(p[0][1]) / up) for p in simplified]
        fragment = _catmull_rom_to_bezier(pts)
        if fragment:
            parts.append(fragment)
    return "".join(parts), len(parts)


def _source_fingerprint(meta_path):
    """Hash of the dataset so an edited/re-harvested glyph set invalidates."""
    digest = hashlib.sha256()
    with open(meta_path, "rb") as handle:
        digest.update(handle.read())
    digest.update(str(GLYPH_PATHS_VERSION).encode())
    return digest.hexdigest()[:16]


def glyph_id(file_path):
    """'glyphs/U0061_m0.png' -> 'U0061_m0' (stable SVG <symbol> id)."""
    return os.path.splitext(os.path.basename(file_path))[0]


def build(out_path=DEFAULT_OUT, verbose=True):
    meta_path = os.path.join(HERE, "glyphs", "metadata.json")
    with open(meta_path, "r") as handle:
        meta = json.load(handle)

    glyphs = {}
    traced = 0
    for _char, variants in meta.items():
        for variant in variants:
            gid = glyph_id(variant["file"])
            if gid in glyphs:
                continue
            path = os.path.join(HERE, variant["file"])
            if not os.path.exists(path):
                continue
            alpha = np.array(Image.open(path).convert("RGBA"))[..., 3]
            d, n_parts = trace_alpha(alpha)
            if not d:
                continue
            glyphs[gid] = {
                "d": d,
                "w": variant["w"],
                "h": variant["h"],
                # metadata carries a legacy +48 offset; strip it here so the
                # dataset matches what load_glyphs() hands the layout engine.
                "baseline_y": variant["baseline_y"] - 48,
                "parts": n_parts,
            }
            traced += 1
            if verbose and traced % 100 == 0:
                print(f"  traced {traced}...", flush=True)

    payload = {
        "version": GLYPH_PATHS_VERSION,
        "source": _source_fingerprint(meta_path),
        "glyphs": glyphs,
    }
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    with open(out_path, "w") as handle:
        json.dump(payload, handle, separators=(",", ":"))
    if verbose:
        size_kb = os.path.getsize(out_path) / 1024
        print(f"wrote {len(glyphs)} glyph paths -> {out_path} ({size_kb:.0f} KB)")
    return payload


_cache = None


def load_or_build(out_path=DEFAULT_OUT, verbose=False):
    """The dataset cache: load if present and current, else generate and store.

    Memoized per process — the sidecar would otherwise re-read it on every
    render, the same mistake `load_glyphs()` makes today.
    """
    global _cache
    if _cache is not None:
        return _cache

    meta_path = os.path.join(HERE, "glyphs", "metadata.json")
    want = _source_fingerprint(meta_path)
    if os.path.exists(out_path):
        try:
            with open(out_path, "r") as handle:
                payload = json.load(handle)
            if (
                payload.get("version") == GLYPH_PATHS_VERSION
                and payload.get("source") == want
                and payload.get("glyphs")
            ):
                _cache = payload
                return payload
        except (ValueError, OSError):
            pass  # corrupt or unreadable cache — fall through and rebuild
    _cache = build(out_path, verbose=verbose)
    return _cache


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_OUT
    build(out)
