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
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
from PIL import Image

# render.py loads glyphs via relative paths — run from this directory
os.chdir(os.path.dirname(os.path.abspath(__file__)))

import render as rd  # noqa: E402

PORT = 8931
_lock = threading.Lock()  # render.py uses module-level random/glyph state


def _crop_alpha(img: Image.Image, pad: int = 6) -> Image.Image:
    bbox = img.getbbox()
    if not bbox:
        return img
    x0, y0, x1, y1 = bbox
    return img.crop((max(0, x0 - pad), max(0, y0 - pad),
                     min(img.width, x1 + pad), min(img.height, y1 + pad)))


def _recolor(img: Image.Image, hex_color: str) -> Image.Image:
    r = int(hex_color[1:3], 16)
    g = int(hex_color[3:5], 16)
    b = int(hex_color[5:7], 16)
    arr = np.ascontiguousarray(np.asarray(img.convert("RGBA"), dtype=np.uint8)).copy()
    # Keep [DRAW] HIGHLIGHT rectangles yellow; recolor all ink (incl. light
    # fills, which become a subtle theme-colored tint).
    keep = (arr[..., 0] > 200) & (arr[..., 1] > 200) & (arr[..., 2] < 160)
    arr[~keep, 0] = r
    arr[~keep, 1] = g
    arr[~keep, 2] = b
    return Image.fromarray(arr)


def render_markup(markup: str, scale: float, color: str) -> Image.Image:
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
    if color:
        img = _recolor(img, color)
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
            img = render_markup(markup, scale, color)
            buf = io.BytesIO()
            img.save(buf, format="PNG")
            self._json(200, {
                "png": base64.b64encode(buf.getvalue()).decode(),
                "w": img.width,
                "h": img.height,
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
