"""An SVG backend for the layout engine.

The layout engine is already vector — it computes every glyph position,
baseline, advance and control point in continuous coordinates. Only the last
step is raster: `canvas.alpha_composite(glyph_image, (x, y))`. This module
supplies a *canvas that records placements instead of compositing pixels*, so
the same 4,700 lines of layout code produce SVG without being rewritten.

There are 103 `alpha_composite` and 60 `aa_line` call sites across render.py,
diagrams.py, diagrams_extra.py and draw_engine.py. Satisfying the two methods
they already call is tractable; rewriting them is not.

Two pieces:

  GlyphRef   quacks like the PIL image the glyph loop manipulates
             (`.resize()`, `.rotate()`, `.size`, and pixel reads for
             `find_pen_point`) but records the transform chain rather than
             resampling. It keeps the real PIL image inside, so any code that
             actually inspects pixels still works.

  SVGCanvas  collects `<use>` references (for glyphs) and `<path>` strokes,
             and can serialize them with a `<defs>` block holding only the
             glyph outlines this render actually used.

Anything that is *not* a GlyphRef — highlight fills, grid paper, an
already-rasterized block — is embedded as a base64 `<image>`, so the
migration is incremental and never renders the wrong thing.

Ink uses `currentColor`, which means theming and the semantic palette are a
CSS concern on the client: no server-side recolor pass, and no cache key
dimension for colour.
"""
import base64
import io
import math

from PIL import Image

from vectorize_glyphs import load_or_build, glyph_id

# The engine's built-in ink (render.INK_RGB / diagrams.INK_RGB). Strokes in
# this colour are "ordinary ink" and become currentColor; anything else was
# chosen deliberately and keeps its value.
DEFAULT_INK = (15, 70, 180)


class GlyphRef:
    """A stand-in for a glyph's PIL image that remembers how it was transformed.

    `base` is the glyph's size in the units its SVG path is expressed in
    (source glyph pixels). `size` is the current scaled size before rotation;
    the wrapped image carries the post-rotation expanded size.
    """

    __slots__ = ("gid", "_img", "base", "scaled", "angle")

    def __init__(self, gid, img, base=None, scaled=None, angle=0.0):
        self.gid = gid
        self._img = img
        self.base = base or img.size
        self.scaled = scaled or img.size
        self.angle = angle

    @property
    def char(self):
        """The Unicode character this glyph represents, decoded from the gid
        ('U0061_m0' → 'a'). Used by the Caveat-font rendering path."""
        try:
            code = int(self.gid.split("_")[0][1:], 16)
            return chr(code)
        except (ValueError, IndexError):
            return ""

    # --- the slice of the PIL API the glyph loop uses -------------------
    def resize(self, size, resample=None):
        img = self._img.resize(size, resample if resample is not None else Image.LANCZOS)
        return GlyphRef(self.gid, img, self.base, size, self.angle)

    def rotate(self, angle, resample=None, expand=False):
        img = self._img.rotate(
            angle,
            resample=resample if resample is not None else Image.BICUBIC,
            expand=expand,
        )
        return GlyphRef(self.gid, img, self.base, self.scaled, self.angle + angle)

    @property
    def size(self):
        return self._img.size

    @property
    def width(self):
        return self._img.width

    @property
    def height(self):
        return self._img.height

    def __array__(self, dtype=None):
        import numpy as np

        arr = np.asarray(self._img)
        return arr.astype(dtype) if dtype else arr

    def __getattr__(self, name):
        # Anything else (load, getdata, convert, split, getbbox…) goes to the
        # real image — `find_pen_point` scans it for connector join points.
        return getattr(self._img, name)

    def svg_transform(self, x, y):
        """SVG transform placing this glyph's path so it matches where PIL
        would have composited the bitmap at (x, y).

        PIL's `rotate(a, expand=True)` turns the image counter-clockwise about
        its centre and grows the box; the original centre lands on the new
        centre. SVG's rotate is clockwise-positive in a y-down space, hence
        the sign flip.
        """
        ew, eh = self._img.size
        gw, gh = self.scaled
        bw, bh = self.base
        cx, cy = x + ew / 2.0, y + eh / 2.0
        sx = gw / float(bw or 1)
        sy = gh / float(bh or 1)
        parts = [f"translate({cx:.2f},{cy:.2f})"]
        if abs(self.angle) > 1e-3:
            parts.append(f"rotate({-self.angle:.2f})")
        parts.append(f"translate({-gw / 2.0:.2f},{-gh / 2.0:.2f})")
        if abs(sx - 1) > 1e-4 or abs(sy - 1) > 1e-4:
            parts.append(f"scale({sx:.4f},{sy:.4f})")
        return " ".join(parts)


def vector_glyphs(raster_glyphs):
    """Wrap `load_glyphs()` output so every glyph image is a GlyphRef.

    Falls back to the plain PIL image for any glyph missing from the traced
    atlas — that one renders as an embedded bitmap instead of a path.
    """
    atlas = load_or_build()["glyphs"]
    out = {}
    for char, variants in raster_glyphs.items():
        wrapped = []
        for variant in variants:
            gid = glyph_id(variant["file"])
            if gid in atlas:
                variant = {**variant, "img": GlyphRef(gid, variant["img"])}
            wrapped.append(variant)
        out[char] = wrapped
    return out


def _esc(text):
    return (
        str(text)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


class SVGCanvas:
    """Duck-type of the PIL canvas the layout engine draws onto.

    `font_mode` (default False) switches glyph rendering from traced-path
    `<use>` references to `<text>` elements in a web handwriting font
    (Caveat). The layout engine's glyph placement, sizing and transforms are
    reused unchanged; only the final draw call differs. This gives a clean,
    consistent, legible handwriting look without the harvested-glyph
    variability (D2/D3) — at the cost of losing the "real pen" stroke texture.
    """

    # The web handwriting font. Loaded by the client from Google Fonts; the
    # server just emits font-family in the SVG so no font file is needed here.
    HANDWRITING_FONT = "'Caveat', cursive"

    def __init__(self, size, color=(0, 0, 0, 0), font_mode=False):
        self.size = size
        self.width, self.height = size
        self._nodes = []
        self._used = set()
        self._font_mode = font_mode
        # Exact geometry, straight from layout — this replaces the client's
        # alpha-channel scanning for line/word boxes.
        self.glyph_boxes = []

    # --- canvas API used by the layout engine ---------------------------
    def alpha_composite(self, img, xy=(0, 0), *_args, **_kwargs):
        x, y = xy
        if isinstance(img, GlyphRef):
            if self._font_mode and img.char:
                self._emit_font_glyph(img, x, y)
            else:
                self._used.add(img.gid)
                self._nodes.append(
                    f'<use href="#g{img.gid}" transform="{img.svg_transform(x, y)}"/>'
                )
            w, h = img.size
            self.glyph_boxes.append((float(x), float(y), float(w), float(h)))
            return
        self._embed(img, x, y)

    def _emit_font_glyph(self, img: "GlyphRef", x: float, y: float):
        """Render a single glyph as a <text> element in the handwriting font,
        positioned to match where the layout engine placed the glyph image."""
        ch = _esc(img.char)
        ew, eh = img.size
        bw, bh = img.base
        # The glyph image's height ≈ the font size. The baseline sits near the
        # bottom of the glyph box. SVG <text> y= is the baseline, so offset by
        # ~85% of the glyph height (empirically where the baseline falls in the
        # harvested glyphs).
        font_size = max(eh, 8)
        baseline_y = y + eh * 0.82
        parts = [f"translate({x + ew / 2.0:.2f},{baseline_y:.2f})"]
        if abs(img.angle) > 1e-3:
            parts.append(f"rotate({-img.angle:.2f})")
        transform = " ".join(parts)
        self._nodes.append(
            f'<text transform="{transform}" '
            f'font-family="{self.HANDWRITING_FONT}" '
            f'font-size="{font_size:.1f}" '
            f'font-weight="600" '
            f'text-anchor="middle" '
            f'dominant-baseline="alphabetic" '
            f'fill="currentColor">{ch}</text>'
        )

    def paste(self, img, xy=(0, 0), mask=None, *_args, **_kwargs):
        self.alpha_composite(img, xy)

    def stroke(self, points, fill=None, width=3):
        """Polyline stroke — the SVG counterpart of `aa_line`."""
        pts = [(float(p[0]), float(p[1])) for p in points]
        if len(pts) < 2:
            return
        d = "M" + " L".join(f"{x:.2f},{y:.2f}" for x, y in pts)
        color = "currentColor"
        if fill is not None and not isinstance(fill, str):
            r, g, b = int(fill[0]), int(fill[1]), int(fill[2])
            # The engine's default ink is a literal blue; on the board it is
            # whatever the theme says, so it must become currentColor. Only a
            # deliberate palette colour (red = the failure, green = committed…)
            # is emitted as a fixed rgb().
            if (r - DEFAULT_INK[0]) ** 2 + (g - DEFAULT_INK[1]) ** 2 + (b - DEFAULT_INK[2]) ** 2 > 3000:
                color = f"rgb({r},{g},{b})"
        self._nodes.append(
            f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{width}" '
            'stroke-linecap="round" stroke-linejoin="round"/>'
        )

    def _embed(self, img, x, y):
        """Fallback for anything not yet vectorized: inline the bitmap."""
        try:
            pil = img if isinstance(img, Image.Image) else Image.fromarray(img)
            buf = io.BytesIO()
            pil.save(buf, format="PNG")
            b64 = base64.b64encode(buf.getvalue()).decode()
            self._nodes.append(
                f'<image x="{x:.2f}" y="{y:.2f}" width="{pil.width}" '
                f'height="{pil.height}" href="data:image/png;base64,{b64}"/>'
            )
        except Exception:
            pass  # never let a decorative bitmap break a lesson

    # --- output ---------------------------------------------------------
    def bbox(self, pad=6):
        if not self.glyph_boxes:
            return (0, 0, self.width, self.height)
        x0 = min(b[0] for b in self.glyph_boxes) - pad
        y0 = min(b[1] for b in self.glyph_boxes) - pad
        x1 = max(b[0] + b[2] for b in self.glyph_boxes) + pad
        y1 = max(b[1] + b[3] for b in self.glyph_boxes) + pad
        return (max(0, x0), max(0, y0), x1, y1)

    def lines(self, gap=8):
        """Glyph boxes grouped into text lines, then words — exact, from
        layout, replacing the client's pixel scan. Returns
        [{x,y,w,h, words:[{x,y,w,h}]}] in canvas coordinates."""
        if not self.glyph_boxes:
            return []
        boxes = sorted(self.glyph_boxes, key=lambda b: (b[1], b[0]))
        rows = []
        for bx, by, bw, bh in boxes:
            placed = False
            for row in rows:
                # same line when the vertical spans overlap at all
                if by < row["y1"] and row["y0"] < by + bh:
                    row["y0"] = min(row["y0"], by)
                    row["y1"] = max(row["y1"], by + bh)
                    row["boxes"].append((bx, by, bw, bh))
                    placed = True
                    break
            if not placed:
                rows.append({"y0": by, "y1": by + bh, "boxes": [(bx, by, bw, bh)]})
        rows.sort(key=lambda r: r["y0"])

        out = []
        for row in rows:
            row["boxes"].sort(key=lambda b: b[0])
            words = []
            cur = None
            for bx, by, bw, bh in row["boxes"]:
                if cur and bx - (cur["x"] + cur["w"]) <= gap:
                    cur["w"] = max(cur["x"] + cur["w"], bx + bw) - cur["x"]
                    cur["y"] = min(cur["y"], by)
                    cur["h"] = max(cur["y"] + cur["h"], by + bh) - cur["y"]
                else:
                    cur = {"x": bx, "y": by, "w": bw, "h": bh}
                    words.append(cur)
            x0 = min(w["x"] for w in words)
            x1 = max(w["x"] + w["w"] for w in words)
            out.append(
                {
                    "x": x0,
                    "y": row["y0"],
                    "w": x1 - x0,
                    "h": row["y1"] - row["y0"],
                    "words": words,
                }
            )
        return out

    @property
    def used_glyphs(self):
        return sorted(self._used)

    def to_svg(self, viewbox=None, offset=(0, 0), include_defs=True):
        """Serialize.

        `include_defs=False` omits the glyph outlines: the client fetches the
        atlas once per session and `<use href="#g…">` resolves against those
        shared defs, so a render's payload is just its `<use>` transforms
        (~2 KB instead of ~39 KB).

        In font_mode there are no `<use>` refs — glyphs are `<text>` elements —
        so defs are always empty and the atlas is never needed.
        """
        defs = []
        if include_defs and not self._font_mode:
            atlas = load_or_build()["glyphs"]
            for gid in sorted(self._used):
                glyph = atlas.get(gid)
                if not glyph:
                    continue
                defs.append(
                    f'<path id="g{gid}" d="{glyph["d"]}" fill-rule="evenodd"/>'
                )
        ox, oy = offset
        x0, y0, x1, y1 = viewbox or self.bbox()
        w = max(1.0, x1 - x0)
        h = max(1.0, y1 - y0)
        body = "".join(self._nodes)
        return (
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x0:.2f} {y0:.2f} {w:.2f} {h:.2f}" '
            f'width="{w:.0f}" height="{h:.0f}" fill="currentColor">'
            f"<defs>{''.join(defs)}</defs>"
            f'<g transform="translate({ox:.2f},{oy:.2f})">{body}</g>'
            "</svg>"
        )
