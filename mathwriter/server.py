"""HTTP sidecar for the mathwriter handwriting engine (by Jayansh —
github.com/JayanshJ/mathwriter). Renders markup (see MARKUP.md) into a
tightly-cropped transparent PNG of handwritten ink, recolored on request.

Run:  .venv/bin/python server.py   (port 8931)
POST /render  {"markup": "...", "scale": 1.3, "color": "#1f2020"}
  -> {"png": "<base64>", "w": int, "h": int}

The Next.js route /api/handwrite proxies here; the board falls back to plain
text when this server is down.
"""
import base64
import io
import json
import os
import re
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
from PIL import Image

# render.py loads glyphs via relative paths — run from this directory
os.chdir(os.path.dirname(os.path.abspath(__file__)))

import render as rd  # noqa: E402

PORT = 8931
_lock = threading.Lock()  # render.py uses module-level random/glyph state


def _encode_l(img) -> str:
    """8-bit map → base64 PNG, or "" when the render produced none."""
    if img is None:
        return ""
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def _crop_alpha(img: Image.Image, pad: int = 6) -> Image.Image:
    bbox = img.getbbox()
    if not bbox:
        return img
    x0, y0, x1, y1 = bbox
    box = (max(0, x0 - pad), max(0, y0 - pad),
           min(img.width, x1 + pad), min(img.height, y1 + pad))
    out = img.crop(box)
    # Keep named part boxes and stroke steps aligned with the cropped image.
    for key in ('parts', 'steps'):
        boxes = img.info.get(key)
        if boxes:
            out.info[key] = [
                {**b, 'x': b['x'] - box[0], 'y': b['y'] - box[1]} for b in boxes
            ]
    step_map = img.info.get('step_map')
    if step_map is not None:
        out.info['step_map'] = step_map.crop(box)
    return out


# Deliberate colors a diagram may use (see diagrams_extra.PALETTE). Recoloring
# used to flatten every non-yellow pixel to one ink color, so a red "this is
# the bug" arrow came out the same shade as everything else. Now each pixel is
# classified: nearest to DEFAULT_INK → it is ordinary ink and gets themed;
# nearest to a semantic color → that color was chosen on purpose, keep it.
DEFAULT_INK = np.array([15, 70, 180], dtype=np.int32)
SEMANTIC_INKS = np.array(
    [
        [196, 60, 50],    # red    — failure, violation, the anomaly
        [30, 140, 80],    # green  — correct, committed, safe
        [200, 140, 20],   # amber  — warning, waiting, blocked
        [140, 70, 180],   # violet — a second actor / alternative path
        [255, 255, 100],  # highlight fill
    ],
    dtype=np.int32,
)


def _recolor(img: Image.Image, hex_color: str) -> Image.Image:
    r = int(hex_color[1:3], 16)
    g = int(hex_color[3:5], 16)
    b = int(hex_color[5:7], 16)
    arr = np.ascontiguousarray(np.asarray(img.convert("RGBA"), dtype=np.uint8)).copy()
    rgb = arr[..., :3].astype(np.int32)
    d_ink = ((rgb - DEFAULT_INK) ** 2).sum(-1)
    d_sem = ((rgb[..., None, :] - SEMANTIC_INKS[None, None, :, :]) ** 2).sum(-1).min(-1)
    keep = (d_sem < d_ink) & (arr[..., 3] > 0)
    arr[~keep, 0] = r
    arr[~keep, 1] = g
    arr[~keep, 2] = b
    return Image.fromarray(arr)


def _has_semantic_color(img: Image.Image) -> bool:
    """True when the drawing deliberately uses palette colors — the client
    then skips its dark-mode invert, which would turn red into cyan."""
    arr = np.asarray(img.convert("RGBA"))
    rgb = arr[..., :3].astype(np.int32)
    d_ink = ((rgb - DEFAULT_INK) ** 2).sum(-1)
    # Highlight yellow is chrome, not a semantic ink — exclude it here.
    d_sem = ((rgb[..., None, :] - SEMANTIC_INKS[None, None, :4, :]) ** 2).sum(-1).min(-1)
    return bool(((d_sem < d_ink) & (arr[..., 3] > 40)).sum() > 24)


# A write action that is nothing but one [G] diagram renders through the
# diagram engine directly instead of the page layout engine: same pixels, but
# the engine's named part boxes survive (page layout would lose the offset),
# so the board can point at "erd#Doctor".
_SOLO_G = re.compile(r"^\s*\[G\]\s*(\{.*\})\s*\[/G\]\s*$", re.DOTALL)
# A write action that is nothing but one [DRAW] block — the common shape for a
# hand-drawn figure. Rendering it directly (instead of through the page
# layout) is what lets the per-command stroke steps survive to the client, so
# the board can draw the figure the way it was drawn rather than wiping the
# finished picture on in one pass.
_SOLO_DRAW = re.compile(r"^\s*\[DRAW\]\s*(.*?)\s*\[/DRAW\]\s*$", re.DOTALL)


def render_markup_svg(markup: str, scale: float) -> dict:
    """Vector render: the same layout, emitted as SVG instead of pixels.

    Returns the SVG plus EXACT line/word geometry straight from layout — the
    client used to recover that by scanning the raster's alpha channel, which
    was both slower and less accurate.

    Colour is deliberately absent: ink is `currentColor`, so theming happens
    in CSS and the render is colour-independent (one cache entry, instant
    theme switches).
    """
    from svg_canvas import SVGCanvas, vector_glyphs

    with _lock:
        glyphs = vector_glyphs(rd.load_glyphs())
        pages = rd.render_pages(
            markup,
            page_size=(1300, 6000),
            margin_top=30, margin_bottom=30, margin_left=20, margin_right_min=20,
            scale=scale,
            glyphs=glyphs,
            canvas_factory=SVGCanvas,
        )
    if not pages:
        return {"svg": "", "w": 0, "h": 0, "lines": []}
    page = pages[0]
    x0, y0, x1, y1 = page.bbox()
    # Shift content so the viewBox starts at the origin; the client then
    # positions overlays as plain percentages of width/height.
    svg = page.to_svg(
        viewbox=(0, 0, x1 - x0, y1 - y0), offset=(-x0, -y0), include_defs=False
    )

    def shift(box):
        return {
            "x": round(box["x"] - x0, 2),
            "y": round(box["y"] - y0, 2),
            "w": round(box["w"], 2),
            "h": round(box["h"], 2),
        }

    lines = []
    for line in page.lines():
        entry = shift(line)
        entry["words"] = [shift(word) for word in line["words"]]
        lines.append(entry)
    return {
        "svg": svg,
        "w": round(x1 - x0, 2),
        "h": round(y1 - y0, 2),
        "lines": lines,
        # Which shared glyph defs this render needs — the client can verify
        # its atlas covers them before injecting the markup.
        "gids": page.used_glyphs,
    }


def render_markup(markup: str, scale: float, color: str) -> Image.Image:
    solo_draw = _SOLO_DRAW.match(markup)
    if solo_draw:
        with _lock:
            # render_pages draws [DRAW] blocks at scale*0.75 — match it.
            img, _bl = rd.render_draw(
                solo_draw.group(1), rd.load_glyphs(), scale=scale * 0.75
            )
        img = _crop_alpha(img)
        colored = _has_semantic_color(img)
        if color:
            kept = {k: img.info.get(k) for k in ("steps", "step_map")}
            img = _recolor(img, color)
            img.info.update({k: v for k, v in kept.items() if v is not None})
        img.info["colored"] = colored
        return img

    solo = _SOLO_G.match(markup)
    if solo:
        try:
            spec = json.loads(solo.group(1))
        except (ValueError, TypeError):
            spec = None
        if isinstance(spec, dict) and spec.get("type"):
            with _lock:
                # render_pages draws [G] blocks at scale*0.75 — match it.
                img, _bl = rd.render_diagram(spec, rd.load_glyphs(), scale=scale * 0.75)
            img = _crop_alpha(img)
            colored = _has_semantic_color(img)
            if color:
                parts = img.info.get("parts")
                img = _recolor(img, color)
                if parts:
                    img.info["parts"] = parts
            img.info["colored"] = colored
            return img
    with _lock:
        # Ink only: swap the grid paper for a transparent sheet and skip scan
        # effects while we render (board supplies its own paper).
        orig_paper, orig_scan = rd.make_grid_paper, rd.apply_scan_effects
        rd.make_grid_paper = lambda size=(1654, 2339), **kw: Image.new("RGBA", size, (0, 0, 0, 0))
        rd.apply_scan_effects = lambda img: img
        try:
            pages = rd.render_pages(
                markup,
                page_size=(1300, 6000),
                margin_top=30, margin_bottom=30, margin_left=20, margin_right_min=20,
                scale=scale,
            )
        finally:
            rd.make_grid_paper, rd.apply_scan_effects = orig_paper, orig_scan
    if not pages:
        return Image.new("RGBA", (1, 1), (0, 0, 0, 0))
    img = pages[0]  # 6000px tall virtual page — board items never overflow it
    img = _crop_alpha(img)
    colored = _has_semantic_color(img)
    if color:
        img = _recolor(img, color)
    img.info["colored"] = colored
    return img


class Handler(BaseHTTPRequestHandler):
    def _json(self, code: int, payload: dict) -> None:
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):  # noqa: N802
        if self.path == "/health":
            self._json(200, {"ok": True})
        elif self.path == "/glyphs":
            # The shared glyph atlas: every traced outline, fetched once per
            # session. Generated on first call if it isn't on disk yet.
            from vectorize_glyphs import load_or_build

            self._json(200, load_or_build())
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self):  # noqa: N802
        if self.path == "/render_pdf":
            return self._render_pdf()
        if self.path != "/render":
            return self._json(404, {"error": "not found"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(length) or b"{}")
            markup = str(body.get("markup", "")).strip()
            if not markup:
                return self._json(400, {"error": "empty markup"})
            scale = float(body.get("scale", 1.3))
            color = str(body.get("color", "#1f2020"))
            # Opt-in vector path. The raster path stays the default until the
            # client migration lands, and stays forever for /render_pdf.
            if str(body.get("format", "png")).lower() == "svg":
                return self._json(200, render_markup_svg(markup, scale))
            img = render_markup(markup, scale, color)
            buf = io.BytesIO()
            img.save(buf, format="PNG")
            self._json(200, {
                "png": base64.b64encode(buf.getvalue()).decode(),
                "w": img.width,
                "h": img.height,
                # Named regions inside a diagram (entity boxes, relationship
                # diamonds) so the board can point at one part of it.
                "parts": img.info.get("parts") or [],
                # Per-command ink boxes in drawing order plus the pixel→stroke
                # map, so the board replays a figure stroke by stroke, cued to
                # what the tutor is saying.
                "steps": img.info.get("steps") or [],
                "stepMap": _encode_l(img.info.get("step_map")),
                # The drawing uses deliberate palette colors — the client must
                # not invert it for dark mode.
                "colored": bool(img.info.get("colored")),
            })
        except Exception as exc:  # surface render bugs to the client visibly
            self._json(500, {"error": str(exc)})

    def _render_pdf(self):
        """POST /render_pdf {"markup": "..."} -> application/pdf.

        Full notebook pages (the engine's grid paper) so the export drops into
        GoodNotes looking like real handwritten notes. Scan effects are skipped
        — they exist to fake a scanned worksheet, not a clean note.
        """
        try:
            length = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(length) or b"{}")
            markup = str(body.get("markup", "")).strip()
            if not markup:
                return self._json(400, {"error": "empty markup"})
            with _lock:
                orig_scan = rd.apply_scan_effects
                rd.apply_scan_effects = lambda img: img
                try:
                    pages = rd.render_pages(markup)
                finally:
                    rd.apply_scan_effects = orig_scan
            if not pages:
                return self._json(400, {"error": "nothing rendered"})
            buf = io.BytesIO()
            pages[0].convert("RGB").save(
                buf, "PDF", resolution=200.0, save_all=True,
                append_images=[p.convert("RGB") for p in pages[1:]],
            )
            data = buf.getvalue()
            self.send_response(200)
            self.send_header("Content-Type", "application/pdf")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except Exception as exc:
            self._json(500, {"error": str(exc)})

    def log_message(self, *args):  # quiet
        pass


if __name__ == "__main__":
    print(f"mathwriter sidecar on http://127.0.0.1:{PORT}")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
