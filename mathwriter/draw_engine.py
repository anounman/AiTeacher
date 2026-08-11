"""
Hand-drawn vector drawing engine for mathwriter.

Provides a scriptable [DRAW] tag that can compose arbitrary diagrams
from low-level primitives. Every primitive renders in the same
Apple Pencil blue-ink hand-drawn style.

Primitives (one per line inside [DRAW]...[/DRAW]):
  LINE x1,y1 x2,y2 [width=N] [style=wobbly|dashed|smooth|rough]
  CURVE x1,y1 cx,cy x2,y2 [width=N]           — quadratic bezier
  CUBIC x1,y1 cx1,cy1 cx2,cy2 x2,y2 [width=N] — cubic bezier
  RECT x,y w,h [width=N] [fill=none|light]
  CIRCLE cx,cy r [width=N] [fill=none|light]
  ELLIPSE cx,cy rx,ry [width=N]
  ARROW x1,y1 x2,y2 [width=N] [head=N]
  PATH x1,y1 x2,y2 x3,y3 ... [width=N] [closed=true]
  POLYGON x1,y1 x2,y2 x3,y3 ... [width=N] [fill=none|light]
  ARC cx,cy r start_deg end_deg [width=N]
  GRID x,y w,h cell_w,cell_h [width=N]
  TEXT x,y "text" [scale=S] [center=true]
  DOT x,y [r=N]
  BRACKET x,y w,h [side=left|right|both]      — hand-drawn parentheses/brackets
  BRACE x,y w,h [side=left|right]             — curly brace
  HIGHLIGHT x,y w,h                            — yellow-ish highlight rectangle

Styles:
  wobbly  — natural hand tremor (default)
  smooth  — minimal jitter, cleaner lines
  dashed  — hand-drawn dashed line
  rough   — extra jitter, sketchy look
  thick   — 2x default width

Coordinates are relative to the drawing canvas. The canvas auto-sizes
to fit all elements with a margin.

Example — a simple flowchart decision diamond:
[DRAW]
LINE 100,0 100,30
POLYGON 50,30 100,10 150,30 100,50 fill=light
TEXT 100,30 "x > 0?" center=true
ARROW 100,50 100,80
LINE 100,80 50,80
LINE 50,80 50,110
TEXT 50,120 "No" center=true
LINE 100,80 150,80
LINE 150,80 150,110
TEXT 150,120 "Yes" center=true
[/DRAW]
"""

import math, random, re
from PIL import Image, ImageChops, ImageDraw
import numpy as np

INK_RGB = (15, 70, 180)
HIGHLIGHT_RGB = (255, 255, 100)
AA_SS = 3


def _ink(alpha=255):
    return (*INK_RGB, alpha)


def _highlight_ink(alpha=120):
    return (*HIGHLIGHT_RGB, alpha)


# ═══════════════════════════════════════════════════════════════════════
#  Anti-aliased line drawing
# ═══════════════════════════════════════════════════════════════════════

def aa_line(target_img, pts, fill=None, width=3, joint='curve'):
    if fill is None:
        fill = _ink()
    if not pts or len(pts) < 2:
        return
    fpts = [(float(p[0]), float(p[1])) for p in pts]
    min_x = min(p[0] for p in fpts)
    min_y = min(p[1] for p in fpts)
    max_x = max(p[0] for p in fpts)
    max_y = max(p[1] for p in fpts)
    pad = max(width * 2, 6)
    bbox_w = int(math.ceil(max_x - min_x + 2 * pad))
    bbox_h = int(math.ceil(max_y - min_y + 2 * pad))
    if bbox_w <= 0 or bbox_h <= 0:
        return
    temp = Image.new('RGBA', (bbox_w * AA_SS, bbox_h * AA_SS), (0, 0, 0, 0))
    td = ImageDraw.Draw(temp)
    ss_pts = [((p[0] - min_x + pad) * AA_SS,
               (p[1] - min_y + pad) * AA_SS) for p in fpts]
    td.line(ss_pts, fill=fill, width=max(1, width * AA_SS), joint=joint)
    small = temp.resize((bbox_w, bbox_h), Image.LANCZOS)
    target_img.alpha_composite(small, (int(min_x - pad), int(min_y - pad)))


# ═══════════════════════════════════════════════════════════════════════
#  Jitter / style generators
# ═══════════════════════════════════════════════════════════════════════

def _jitter(style='wobbly'):
    """Return (perpendicular_jitter, point_count_factor) for a style."""
    styles = {
        'wobbly': (0.7, 1.0),
        'smooth': (0.15, 1.0),
        'rough': (1.8, 1.5),
        'dashed': (0.5, 1.0),
        'thick': (0.6, 1.0),
    }
    return styles.get(style, (0.7, 1.0))


def _wobble_point(x, y, jitter_amount):
    """Add random perpendicular jitter to a point."""
    return (x + random.uniform(-jitter_amount, jitter_amount),
            y + random.uniform(-jitter_amount, jitter_amount))


def _segment(p1, p2, segments=10, jitter=0.7, overshoot=(0.0, 2.5),
             trim_end=False, trim_start=False):
    """Generate wobbly line points between p1 and p2."""
    x1, y1 = p1
    x2, y2 = p2
    length = max(1.0, math.hypot(x2 - x1, y2 - y1))
    px, py = -(y2 - y1) / length, (x2 - x1) / length
    ux, uy = (x2 - x1) / length, (y2 - y1) / length
    o_end = 0 if trim_end else random.uniform(*overshoot)
    o_start = 0 if trim_start else random.uniform(*overshoot) * 0.7
    sx, sy = x1 - ux * o_start, y1 - uy * o_start
    ex, ey = x2 + ux * o_end, y2 + uy * o_end
    pts = []
    for k in range(segments + 1):
        u = k / segments
        x = sx + (ex - sx) * u
        y = sy + (ey - sy) * u
        if 0 < k < segments:
            wob = random.uniform(-jitter, jitter)
            x += px * wob
            y += py * wob
        pts.append((x, y))
    return pts


def _dashed_segment(p1, p2, dash_len=8, gap_len=6, jitter=0.5):
    """Generate dashed line points."""
    x1, y1 = p1
    x2, y2 = p2
    length = math.hypot(x2 - x1, y2 - y1)
    if length < 2:
        return []
    ux = (x2 - x1) / length
    uy = (y2 - y1) / length
    px, py = -uy, ux

    dashes = []
    pos = 0.0
    drawing = True
    while pos < length:
        seg_len = dash_len if drawing else gap_len
        end = min(pos + seg_len, length)
        if drawing:
            n_segs = max(2, int((end - pos) / 3))
            seg_pts = []
            for k in range(n_segs + 1):
                u = k / n_segs
                t = pos + u * (end - pos)
                x = x1 + ux * t + px * random.uniform(-jitter, jitter)
                y = y1 + uy * t + py * random.uniform(-jitter, jitter)
                seg_pts.append((x, y))
            dashes.append(seg_pts)
        pos = end
        drawing = not drawing
    return dashes


# ═══════════════════════════════════════════════════════════════════════
#  Primitive renderers
# ═══════════════════════════════════════════════════════════════════════

def draw_line(canvas, x1, y1, x2, y2, width=3, style='wobbly'):
    jitter_amt, _ = _jitter(style)
    if style == 'dashed':
        dashes = _dashed_segment((x1, y1), (x2, y2), jitter=jitter_amt)
        for dash_pts in dashes:
            if len(dash_pts) >= 2:
                aa_line(canvas, dash_pts, width=width)
    else:
        n_segs = max(6, int(math.hypot(x2 - x1, y2 - y1) / 4))
        pts = _segment((x1, y1), (x2, y2), segments=n_segs, jitter=jitter_amt)
        aa_line(canvas, pts, width=width)


def draw_curve(canvas, x1, y1, cx, cy, x2, y2, width=3, style='wobbly'):
    """Quadratic bezier curve."""
    jitter_amt, factor = _jitter(style)
    n = int(20 * factor)
    pts = []
    for k in range(n + 1):
        t = k / n
        x = (1 - t) ** 2 * x1 + 2 * (1 - t) * t * cx + t ** 2 * x2
        y = (1 - t) ** 2 * y1 + 2 * (1 - t) * t * cy + t ** 2 * y2
        if 0 < k < n:
            x += random.uniform(-jitter_amt, jitter_amt)
            y += random.uniform(-jitter_amt, jitter_amt)
        pts.append((x, y))
    aa_line(canvas, pts, width=width)


def draw_cubic(canvas, x1, y1, cx1, cy1, cx2, cy2, x2, y2, width=3, style='wobbly'):
    """Cubic bezier curve."""
    jitter_amt, factor = _jitter(style)
    n = int(24 * factor)
    pts = []
    for k in range(n + 1):
        t = k / n
        x = ((1 - t) ** 3 * x1 + 3 * (1 - t) ** 2 * t * cx1 +
             3 * (1 - t) * t ** 2 * cx2 + t ** 3 * x2)
        y = ((1 - t) ** 3 * y1 + 3 * (1 - t) ** 2 * t * cy1 +
             3 * (1 - t) * t ** 2 * cy2 + t ** 3 * y2)
        if 0 < k < n:
            x += random.uniform(-jitter_amt, jitter_amt)
            y += random.uniform(-jitter_amt, jitter_amt)
        pts.append((x, y))
    aa_line(canvas, pts, width=width)


def draw_rect(canvas, x, y, w, h, width=3, style='wobbly', fill='none'):
    jitter_amt, _ = _jitter(style)
    j = jitter_amt * 1.5

    if fill == 'light':
        # Fill with very light blue
        fill_img = Image.new('RGBA', (int(w) + 4, int(h) + 4), (15, 70, 180, 25))
        canvas.alpha_composite(fill_img, (int(x) - 2, int(y) - 2))

    p_tl = (x + random.uniform(-j, j), y + random.uniform(-j, j))
    p_tr = (x + w + random.uniform(-j, j), y + random.uniform(-j, j))
    p_br = (x + w + random.uniform(-j, j), y + h + random.uniform(-j, j))
    p_bl = (x + random.uniform(-j, j), y + h + random.uniform(-j, j))
    close = (p_tl[0] + random.uniform(1, 4), p_tl[1] + random.uniform(-0.5, 1.5))
    rect_pts = [p_tl, p_tr, p_br, p_bl, p_tl, close]
    aa_line(canvas, rect_pts, width=width)


def draw_circle(canvas, cx, cy, r, width=3, style='wobbly', fill='none'):
    jitter_amt, factor = _jitter(style)
    segments = int(32 * factor)

    if fill == 'light':
        fill_r = int(r) - 2
        if fill_r > 0:
            fill_img = Image.new('RGBA', (fill_r * 2 + 4, fill_r * 2 + 4), (0, 0, 0, 0))
            fill_draw = ImageDraw.Draw(fill_img)
            fill_draw.ellipse([2, 2, fill_r * 2 + 2, fill_r * 2 + 2],
                              fill=(15, 70, 180, 25))
            canvas.alpha_composite(fill_img, (int(cx - fill_r - 2), int(cy - fill_r - 2)))

    pts = []
    for k in range(segments + 1):
        angle = 2 * math.pi * k / segments
        rr = r + random.uniform(-jitter_amt, jitter_amt)
        x = cx + rr * math.cos(angle)
        y = cy + rr * math.sin(angle)
        pts.append((x, y))
    pts.append(pts[0])
    aa_line(canvas, pts, width=width)


def draw_ellipse(canvas, cx, cy, rx, ry, width=3, style='wobbly'):
    jitter_amt, factor = _jitter(style)
    segments = int(40 * factor)
    pts = []
    for k in range(segments + 1):
        angle = 2 * math.pi * k / segments
        x = cx + rx * math.cos(angle) + random.uniform(-jitter_amt, jitter_amt)
        y = cy + ry * math.sin(angle) + random.uniform(-jitter_amt, jitter_amt)
        pts.append((x, y))
    pts.append(pts[0])
    aa_line(canvas, pts, width=width)


def draw_arrow(canvas, x1, y1, x2, y2, width=3, style='wobbly', head_len=None):
    jitter_amt, _ = _jitter(style)
    n_segs = max(6, int(math.hypot(x2 - x1, y2 - y1) / 4))
    pts = _segment((x1, y1), (x2, y2), segments=n_segs, jitter=jitter_amt,
                   trim_end=True)
    aa_line(canvas, pts, width=width)

    # Arrowhead
    tip = pts[-1]
    if head_len is None:
        head_len = max(8, int(math.hypot(x2 - x1, y2 - y1) * 0.15))
    dx = x2 - x1
    dy = y2 - y1
    length = max(1.0, math.hypot(dx, dy))
    ux, uy = dx / length, dy / length
    px, py = -uy, ux
    head_ang = 0.45
    upper = (tip[0] - head_len * (ux * math.cos(head_ang) - px * math.sin(head_ang)),
             tip[1] - head_len * (uy * math.cos(head_ang) - py * math.sin(head_ang)))
    lower = (tip[0] - head_len * (ux * math.cos(head_ang) + px * math.sin(head_ang)),
             tip[1] - head_len * (uy * math.cos(head_ang) + py * math.sin(head_ang)))
    head_pts = [upper, tip, lower]
    aa_line(canvas, head_pts, width=width)


def draw_path(canvas, points, width=3, style='wobbly', closed=False):
    """Draw a multi-point path."""
    jitter_amt, _ = _jitter(style)
    all_pts = []
    for i in range(len(points) - 1):
        p1, p2 = points[i], points[i + 1]
        n_segs = max(4, int(math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 5))
        seg = _segment(p1, p2, segments=n_segs, jitter=jitter_amt,
                       trim_start=(i > 0), trim_end=(i < len(points) - 2))
        if i > 0:
            seg = seg[1:]  # avoid duplicate point
        all_pts.extend(seg)
    if closed and len(points) >= 2:
        p1, p2 = points[-1], points[0]
        n_segs = max(4, int(math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 5))
        seg = _segment(p1, p2, segments=n_segs, jitter=jitter_amt,
                       trim_start=True, trim_end=True)
        all_pts.extend(seg[1:])
    aa_line(canvas, all_pts, width=width)


def draw_polygon(canvas, points, width=3, style='wobbly', fill='none'):
    """Draw a closed polygon."""
    if fill == 'light' and len(points) >= 3:
        # Simple fill using PIL polygon
        xs = [p[0] for p in points]
        ys = [p[1] for p in points]
        min_x, max_x = int(min(xs)), int(max(xs))
        min_y, max_y = int(min(ys)), int(max(ys))
        fill_img = Image.new('RGBA', (max_x - min_x + 8, max_y - min_y + 8), (0, 0, 0, 0))
        fill_draw = ImageDraw.Draw(fill_img)
        adj_pts = [(x - min_x + 4, y - min_y + 4) for x, y in points]
        fill_draw.polygon(adj_pts, fill=(15, 70, 180, 25))
        canvas.alpha_composite(fill_img, (min_x - 4, min_y - 4))

    draw_path(canvas, points, width=width, style=style, closed=True)


def draw_arc(canvas, cx, cy, r, start_deg, end_deg, width=3, style='wobbly'):
    """Draw an arc of a circle."""
    jitter_amt, _ = _jitter(style)
    sweep = end_deg - start_deg
    segments = max(8, int(abs(sweep) / 5))
    pts = []
    for k in range(segments + 1):
        angle = math.radians(start_deg + sweep * k / segments)
        rr = r + random.uniform(-jitter_amt * 0.5, jitter_amt * 0.5)
        x = cx + rr * math.cos(angle)
        y = cy + rr * math.sin(angle)
        pts.append((x, y))
    aa_line(canvas, pts, width=width)


def draw_grid(canvas, x, y, w, h, cell_w, cell_h, width=1, style='wobbly'):
    """Draw a grid of horizontal and vertical lines."""
    jitter_amt, _ = _jitter(style)
    # Vertical lines
    for col_x in range(int(x), int(x + w + 1), int(cell_w)):
        n_segs = max(3, int(h / 8))
        pts = _segment((col_x, y), (col_x, y + h), segments=n_segs, jitter=jitter_amt * 0.5)
        aa_line(canvas, pts, width=width)
    # Horizontal lines
    for row_y in range(int(y), int(y + h + 1), int(cell_h)):
        n_segs = max(3, int(w / 8))
        pts = _segment((x, row_y), (x + w, row_y), segments=n_segs, jitter=jitter_amt * 0.5)
        aa_line(canvas, pts, width=width)


def draw_dot(canvas, x, y, r=3, style='wobbly'):
    """Draw a small filled dot."""
    jitter_amt, _ = _jitter(style)
    # Draw a small filled circle
    segments = 12
    pts = []
    for k in range(segments + 1):
        angle = 2 * math.pi * k / segments
        rr = r + random.uniform(-0.3, 0.3)
        px = x + rr * math.cos(angle)
        py = y + rr * math.sin(angle)
        pts.append((px, py))
    # Fill by drawing concentric circles
    for rr in [r, r * 0.6, r * 0.2]:
        circle_pts = []
        for k in range(segments + 1):
            angle = 2 * math.pi * k / segments
            px = x + rr * math.cos(angle) + random.uniform(-0.2, 0.2)
            py = y + rr * math.sin(angle) + random.uniform(-0.2, 0.2)
            circle_pts.append((px, py))
        circle_pts.append(circle_pts[0])
        aa_line(canvas, circle_pts, width=2)


def draw_bracket(canvas, x, y, w, h, side='both', width=3, style='wobbly'):
    """Draw hand-drawn parentheses/brackets around a region."""
    jitter_amt, _ = _jitter(style)
    bow_w = max(12, w * 0.15)

    def _draw_paren(cx, bow, direction):
        """direction: -1 for left, +1 for right"""
        n = 24
        pts = []
        for k in range(n + 1):
            u = k / n
            bx = cx + direction * bow * math.sin(math.pi * u)
            by = y + u * h
            bx += random.uniform(-jitter_amt * 0.5, jitter_amt * 0.5)
            by += random.uniform(-jitter_amt * 0.5, jitter_amt * 0.5)
            pts.append((bx, by))
        aa_line(canvas, pts, width=width)

    if side in ('left', 'both'):
        _draw_paren(x, bow_w, -1)
    if side in ('right', 'both'):
        _draw_paren(x + w, bow_w, +1)


def draw_brace(canvas, x, y, w, h, side='left', width=2, style='wobbly'):
    """Draw a curly brace spanning height h at position x."""
    jitter_amt, _ = _jitter(style)
    direction = -1 if side == 'left' else 1
    cx = x
    mid_y = y + h / 2

    # Curly brace: top hook, middle point, bottom hook
    top_hook = (cx + direction * 8, y + 4)
    mid_point = (cx + direction * 14, mid_y)
    bot_hook = (cx + direction * 8, y + h - 4)

    # Top segment
    pts1 = _segment((cx, y), top_hook, segments=6, jitter=jitter_amt * 0.5)
    # Middle to top
    pts2 = _segment(top_hook, mid_point, segments=8, jitter=jitter_amt * 0.5)
    # Middle to bottom
    pts3 = _segment(mid_point, bot_hook, segments=8, jitter=jitter_amt * 0.5)
    # Bottom segment
    pts4 = _segment(bot_hook, (cx, y + h), segments=6, jitter=jitter_amt * 0.5)

    all_pts = pts1 + pts2[1:] + pts3[1:] + pts4[1:]
    aa_line(canvas, all_pts, width=width)


def draw_highlight(canvas, x, y, w, h):
    """Draw a yellow-ish highlight rectangle behind content."""
    fill_img = Image.new('RGBA', (int(w) + 4, int(h) + 4), (255, 255, 100, 60))
    canvas.alpha_composite(fill_img, (int(x) - 2, int(y) - 2))
    # Subtle border
    j = 1.0
    p_tl = (x + random.uniform(-j, j), y + random.uniform(-j, j))
    p_tr = (x + w + random.uniform(-j, j), y + random.uniform(-j, j))
    p_br = (x + w + random.uniform(-j, j), y + h + random.uniform(-j, j))
    p_bl = (x + random.uniform(-j, j), y + h + random.uniform(-j, j))
    aa_line(canvas, [p_tl, p_tr, p_br, p_bl, p_tl], fill=_highlight_ink(80), width=1)


# ═══════════════════════════════════════════════════════════════════════
#  Text rendering (delegates to render.py's render_text_chunk)
# ═══════════════════════════════════════════════════════════════════════

def draw_text(canvas, x, y, text, glyphs, scale=0.7, center=True):
    """Draw text at position. If center=True, x,y is the center of the text."""
    from render import render_text_chunk
    if not text:
        return
    # Strip quotes if present
    if text.startswith('"') and text.endswith('"'):
        text = text[1:-1]
    # Local patch (keep on re-vendor): models emit literal "\n" inside TEXT
    # labels ("Process A\nVirtual Space"); there is no multi-line TEXT, so it
    # rendered as a stray "/n" glyph pair mid-word. Collapse to a space.
    text = text.replace('\\n', ' ')
    img, bl = render_text_chunk(text, glyphs, scale=scale, return_baseline=True)
    iw, ih = img.size
    px = int(x - iw // 2) if center else int(x)
    py = int(y - ih // 2) if center else int(y - bl)
    canvas.alpha_composite(img, (px, py))


# ═══════════════════════════════════════════════════════════════════════
#  Parser: text → drawing commands
# ═══════════════════════════════════════════════════════════════════════

# Local patch (keep on re-vendor): only these keys are option kwargs. Treating
# ANY token containing '=' as a kwarg swallowed label words like "3!=6" or
# "x=5" out of TEXT content.
_KNOWN_KWARGS = {'style', 'width', 'fill', 'center', 'scale', 'head', 'side',
                 'closed', 'color', 'dash'}


def parse_draw_commands(text):
    """Parse [DRAW]...[/DRAW] body into a list of command dicts."""
    commands = []
    for line in text.strip().split('\n'):
        line = line.strip()
        # Local patch (keep on re-vendor): `//` comments are used throughout the
        # dataset examples; upstream strips only '#'.
        if not line or line.startswith('#') or line.startswith('//'):
            continue

        # Parse: CMD arg1 arg2 ... [key=val ...]
        parts = line.split()
        cmd = parts[0].upper()
        args = []
        kwargs = {}
        for p in parts[1:]:
            if '=' in p and p.split('=', 1)[0] in _KNOWN_KWARGS:
                k, v = p.split('=', 1)
                kwargs[k] = v
            else:
                args.append(p)

        commands.append({'cmd': cmd, 'args': args, 'kwargs': kwargs})
    return commands


def _parse_coords(s):
    """Parse 'x,y' or 'x y' into (float, float)."""
    if ',' in s:
        x, y = s.split(',', 1)
    else:
        parts = s.split()
        x, y = parts[0], parts[1] if len(parts) > 1 else '0'
    return float(x), float(y)


def _parse_int(s, default=1):
    try:
        return int(s)
    except (ValueError, TypeError):
        return default


def _parse_float(s, default=1.0):
    try:
        return float(s)
    except (ValueError, TypeError):
        return default


def _text_box(c, default_scale, glyphs=None):
    """Glyph box (x0, y0, x1, y1) of a TEXT command.

    With `glyphs` the text is actually measured through render_text_chunk —
    the same code path that will draw it — so the box is exact. Estimates
    (12px/char originally) under-sized the auto-canvas and cropped leading
    characters off labels ("'irtual Address Space") and trailing ones
    ("PAGE FAUL"). Without glyphs, falls back to a generous estimate.
    """
    x, y = _parse_coords(c['args'][0])
    text = ' '.join(c['args'][1:]).strip('"').replace('\\n', ' ')
    s = _parse_float(c['kwargs'].get('scale'), default_scale)
    w = h = None
    if glyphs is not None and text:
        try:
            from render import render_text_chunk
            img = render_text_chunk(text, glyphs, scale=s)
            w, h = float(img.size[0]), float(img.size[1])
        except Exception:
            pass
    if w is None:
        w = max(1.0, len(text) * 16 * s)
        h = 30 * s
    if c['kwargs'].get('center', 'true').lower() == 'true':
        return (x - w / 2, y - h / 2, x + w / 2, y + h / 2)
    return (x, y - h, x + w, y)


def _shape_boxes(commands):
    boxes = []
    for c in commands:
        cmd, args = c['cmd'], c['args']
        try:
            if cmd == 'CIRCLE':
                cx, cy = _parse_coords(args[0])
                r = _parse_float(args[1])
                boxes.append((cx - r, cy - r, cx + r, cy + r))
            elif cmd == 'ELLIPSE':
                cx, cy = _parse_coords(args[0])
                rx, ry = _parse_coords(args[1])
                boxes.append((cx - rx, cy - ry, cx + rx, cy + ry))
            elif cmd == 'RECT':
                x, y = _parse_coords(args[0])
                w, h = _parse_coords(args[1])
                boxes.append((x, y, x + w, y + h))
        except (IndexError, ValueError):
            continue
    return boxes


def _grow_shape(commands, target_box, needed_w):
    """Widen the CIRCLE/ELLIPSE/RECT whose bounds equal target_box so a label
    of needed_w fits inside it. Center stays put; only width grows."""
    for c in commands:
        cmd, args = c['cmd'], c['args']
        try:
            if cmd == 'ELLIPSE':
                cx, cy = _parse_coords(args[0])
                rx, ry = _parse_coords(args[1])
                if abs((cx - rx) - target_box[0]) < 1 and abs((cx + rx) - target_box[2]) < 1:
                    c['args'][1] = '%g,%g' % (needed_w / 2, ry)
                    return
            elif cmd == 'CIRCLE':
                cx, cy = _parse_coords(args[0])
                r = _parse_float(args[1])
                if abs((cx - r) - target_box[0]) < 1 and abs((cx + r) - target_box[2]) < 1:
                    # A circle grown only in width is an ellipse.
                    c['cmd'] = 'ELLIPSE'
                    c['args'] = [args[0], '%g,%g' % (needed_w / 2, r)]
                    return
            elif cmd == 'RECT':
                x, y = _parse_coords(args[0])
                w, h = _parse_coords(args[1])
                if abs(x - target_box[0]) < 1 and abs((x + w) - target_box[2]) < 1:
                    grow = needed_w - w
                    c['args'][0] = '%g,%g' % (x - grow / 2, y)
                    c['args'][1] = '%g,%g' % (needed_w, h)
                    return
        except (IndexError, ValueError):
            continue


def _boxes_overlap(a, b, pad=2):
    return (a[0] + pad < b[2] and b[0] + pad < a[2]
            and a[1] + pad < b[3] and b[1] + pad < a[3])


def repair_draw_layout(commands, scale=0.7, glyphs=None):
    """Deterministic overlap repair for model-authored TEXT coordinates.

    The model places labels by eye and routinely stacks them (measured in
    real lessons: flow-step labels landing on top of each other). Every TEXT
    gets an estimated glyph box; a label centered inside a CIRCLE/RECT/ELLIPSE
    is that shape's label and is trusted where it is; any other label that
    collides with an earlier label slides straight down below it. Pure
    geometry — same input, same output.
    """
    shapes = _shape_boxes(commands)
    placed = []
    for c in commands:
        if c['cmd'] != 'TEXT' or not c['args']:
            continue
        try:
            box = _text_box(c, scale, glyphs)
        except (IndexError, ValueError):
            continue
        cx = (box[0] + box[2]) / 2
        cy = (box[1] + box[3]) / 2
        container = None
        for s in shapes:
            if s[0] <= cx <= s[2] and s[1] <= cy <= s[3]:
                if container is None or (s[2] - s[0]) * (s[3] - s[1]) < (container[2] - container[0]) * (container[3] - container[1]):
                    container = s
        inside = container is not None
        if inside:
            # A shape's label is trusted where it is — but it must FIT the
            # shape. ER attribute ellipses routinely get labels wider than
            # themselves ("date-of-birth" in a 76px ellipse), so the outline
            # strikes through the text. Shrink the label's scale to fit,
            # floored at 0.42 for legibility; if the floor still doesn't fit,
            # GROW the shape instead — an outline is elastic, text is not.
            shape_w = container[2] - container[0]
            text_w = box[2] - box[0]
            if text_w > shape_w * 1.1 and shape_w > 8:
                cur_s = _parse_float(c['kwargs'].get('scale'), scale)
                new_s = max(0.42, cur_s * (shape_w * 1.02) / text_w)
                if new_s < cur_s:
                    c['kwargs']['scale'] = '%g' % new_s
                    half = (box[2] - box[0]) * (new_s / cur_s) / 2
                    box = (cx - half, box[1], cx + half, box[3])
                needed = (box[2] - box[0]) * 1.12
                if needed > shape_w:
                    _grow_shape(commands, container, needed)
        if not inside:
            dy = 0.0
            for _guard in range(12):
                shifted = (box[0], box[1] + dy, box[2], box[3] + dy)
                hit = next((p for p in placed if _boxes_overlap(shifted, p)), None)
                if hit is None:
                    break
                dy = hit[3] - box[1] + 5
            if dy:
                try:
                    x, y = _parse_coords(c['args'][0])
                    c['args'][0] = '%g,%g' % (x, y + dy)
                    box = (box[0], box[1] + dy, box[2], box[3] + dy)
                except (IndexError, ValueError):
                    pass
        placed.append(box)
    return commands


def execute_draw(commands, glyphs, scale=0.7):
    """Execute drawing commands and return (PIL.Image, baseline_y).

    The canvas is auto-sized to fit all elements.
    First pass: repair model-authored label collisions.
    Second pass: compute bounding box.
    Third pass: render.
    """
    MARGIN = 20
    commands = repair_draw_layout(commands, scale, glyphs)

    # First pass: compute bounds
    min_x, min_y = float('inf'), float('inf')
    max_x, max_y = float('-inf'), float('-inf')

    def _extend(x, y, w=0, h=0):
        nonlocal min_x, min_y, max_x, max_y
        min_x = min(min_x, x - 10)
        min_y = min(min_y, y - 10)
        max_x = max(max_x, x + w + 10)
        max_y = max(max_y, y + h + 10)

    for c in commands:
        cmd = c['cmd']
        args = c['args']
        try:
            if cmd == 'LINE':
                x1, y1 = _parse_coords(args[0])
                x2, y2 = _parse_coords(args[1])
                _extend(min(x1, x2), min(y1, y2), abs(x2 - x1), abs(y2 - y1))
            elif cmd in ('CURVE', 'CUBIC'):
                if cmd == 'CURVE':
                    x1, y1 = _parse_coords(args[0])
                    cx, cy = _parse_coords(args[1])
                    x2, y2 = _parse_coords(args[2])
                    _extend(min(x1, cx, x2), min(y1, cy, y2),
                            max(x1, cx, x2) - min(x1, cx, x2),
                            max(y1, cy, y2) - min(y1, cy, y2))
                else:
                    x1, y1 = _parse_coords(args[0])
                    cx1, cy1 = _parse_coords(args[1])
                    cx2, cy2 = _parse_coords(args[2])
                    x2, y2 = _parse_coords(args[3])
                    _extend(min(x1, cx1, cx2, x2), min(y1, cy1, cy2, y2),
                            max(x1, cx1, cx2, x2) - min(x1, cx1, cx2, x2),
                            max(y1, cy1, cy2, y2) - min(y1, cy1, cy2, y2))
            elif cmd == 'RECT':
                x, y = _parse_coords(args[0])
                w, h = _parse_coords(args[1])
                _extend(x, y, w, h)
            elif cmd in ('CIRCLE', 'ELLIPSE'):
                cx, cy = _parse_coords(args[0])
                if cmd == 'CIRCLE':
                    r = _parse_float(args[1])
                    _extend(cx - r, cy - r, 2 * r, 2 * r)
                else:
                    rx, ry = _parse_coords(args[1])
                    _extend(cx - rx, cy - ry, 2 * rx, 2 * ry)
            elif cmd == 'ARROW':
                x1, y1 = _parse_coords(args[0])
                x2, y2 = _parse_coords(args[1])
                _extend(min(x1, x2), min(y1, y2), abs(x2 - x1), abs(y2 - y1))
            elif cmd in ('PATH', 'POLYGON'):
                pts = [_parse_coords(a) for a in args]
                xs = [p[0] for p in pts]
                ys = [p[1] for p in pts]
                _extend(min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys))
            elif cmd == 'ARC':
                cx, cy = _parse_coords(args[0])
                r = _parse_float(args[1])
                _extend(cx - r, cy - r, 2 * r, 2 * r)
            elif cmd == 'GRID':
                x, y = _parse_coords(args[0])
                w, h = _parse_coords(args[1])
                _extend(x, y, w, h)
            elif cmd == 'TEXT':
                # Same estimator the repair pass uses (per-command scale kwarg
                # included) so the auto-canvas always contains every glyph.
                bx0, by0, bx1, by1 = _text_box(c, scale, glyphs)
                _extend(bx0, by0, bx1 - bx0, by1 - by0)
            elif cmd == 'DOT':
                x, y = _parse_coords(args[0])
                r = _parse_float(args[1]) if len(args) > 1 else 3
                _extend(x - r, y - r, 2 * r, 2 * r)
            elif cmd in ('BRACKET', 'BRACE'):
                x, y = _parse_coords(args[0])
                w, h = _parse_coords(args[1])
                _extend(x - 20, y, w + 40, h)
            elif cmd == 'HIGHLIGHT':
                x, y = _parse_coords(args[0])
                w, h = _parse_coords(args[1])
                _extend(x, y, w, h)
        except (IndexError, ValueError):
            continue

    if min_x == float('inf'):
        min_x, min_y, max_x, max_y = 0, 0, 100, 100

    # Create canvas
    canvas_w = int(max_x - min_x + 2 * MARGIN)
    canvas_h = int(max_y - min_y + 2 * MARGIN)
    canvas = Image.new('RGBA', (canvas_w, canvas_h), (0, 0, 0, 0))

    def _tx(x):
        return x - min_x + MARGIN

    def _ty(y):
        return y - min_y + MARGIN

    # Per-command ink boxes, in drawing order, so the board can reveal a
    # diagram the way it was drawn — nucleus first, then the orbits, then the
    # electrons — instead of wiping the finished picture on in one pass.
    # Measured by diffing the alpha channel around each command rather than
    # by re-deriving each primitive's geometry: exact for wobble, overshoot,
    # arrowheads and glyph metrics, and it cannot drift from the renderer.
    # Boxes alone are not enough to replay the drawing: the outer orbit's box
    # contains the whole atom, so painting boxes in order would reveal the
    # electrons with it. `step_map` records which command owns each ink pixel
    # (1-based, 0 = bare paper), so the board can paint stroke N and nothing
    # else. One extra 8-bit channel, no per-step image payload.
    steps = []
    prev_alpha = canvas.getchannel('A')
    step_map = np.zeros((canvas_h, canvas_w), dtype=np.uint8)

    def _record_step(c):
        nonlocal prev_alpha
        now = canvas.getchannel('A')
        diff = ImageChops.difference(prev_alpha, now)
        box = diff.getbbox()
        prev_alpha = now
        if not box:
            return
        # 255 commands is far past any readable figure; later strokes just
        # join the last band rather than wrapping around to 0 (= paper).
        index = min(len(steps) + 1, 255)
        fresh = (np.array(diff) > 8) & (step_map == 0)
        step_map[fresh] = index
        x0, y0, x1, y1 = box
        label = ''
        if c['cmd'] == 'TEXT' and len(c['args']) > 1:
            label = ' '.join(c['args'][1:]).strip('"')
        steps.append({
            'id': f'step{len(steps)}',
            'cmd': c['cmd'],
            'label': label,
            'x': x0, 'y': y0, 'w': x1 - x0, 'h': y1 - y0,
        })

    # Second pass: render
    for c in commands:
        cmd = c['cmd']
        args = c['args']
        kwargs = c['kwargs']
        style = kwargs.get('style', 'wobbly')
        width = _parse_int(kwargs.get('width'), 3)
        fill = kwargs.get('fill', 'none')
        try:
            if cmd == 'LINE':
                x1, y1 = _parse_coords(args[0])
                x2, y2 = _parse_coords(args[1])
                draw_line(canvas, _tx(x1), _ty(y1), _tx(x2), _ty(y2),
                          width=width, style=style)
            elif cmd == 'CURVE':
                x1, y1 = _parse_coords(args[0])
                cx, cy = _parse_coords(args[1])
                x2, y2 = _parse_coords(args[2])
                draw_curve(canvas, _tx(x1), _ty(y1), _tx(cx), _ty(cy),
                           _tx(x2), _ty(y2), width=width, style=style)
            elif cmd == 'CUBIC':
                x1, y1 = _parse_coords(args[0])
                cx1, cy1 = _parse_coords(args[1])
                cx2, cy2 = _parse_coords(args[2])
                x2, y2 = _parse_coords(args[3])
                draw_cubic(canvas, _tx(x1), _ty(y1), _tx(cx1), _ty(cy1),
                           _tx(cx2), _ty(cy2), _tx(x2), _ty(y2),
                           width=width, style=style)
            elif cmd == 'RECT':
                x, y = _parse_coords(args[0])
                w, h = _parse_coords(args[1])
                draw_rect(canvas, _tx(x), _ty(y), w, h,
                          width=width, style=style, fill=fill)
            elif cmd == 'CIRCLE':
                cx, cy = _parse_coords(args[0])
                r = _parse_float(args[1])
                draw_circle(canvas, _tx(cx), _ty(cy), r,
                            width=width, style=style, fill=fill)
            elif cmd == 'ELLIPSE':
                cx, cy = _parse_coords(args[0])
                rx, ry = _parse_coords(args[1])
                draw_ellipse(canvas, _tx(cx), _ty(cy), rx, ry,
                             width=width, style=style)
            elif cmd == 'ARROW':
                x1, y1 = _parse_coords(args[0])
                x2, y2 = _parse_coords(args[1])
                head_len = _parse_int(kwargs.get('head'), None)
                draw_arrow(canvas, _tx(x1), _ty(y1), _tx(x2), _ty(y2),
                           width=width, style=style, head_len=head_len)
            elif cmd == 'PATH':
                pts = [_parse_coords(a) for a in args]
                tpts = [(_tx(p[0]), _ty(p[1])) for p in pts]
                closed = kwargs.get('closed', 'false').lower() == 'true'
                draw_path(canvas, tpts, width=width, style=style, closed=closed)
            elif cmd == 'POLYGON':
                pts = [_parse_coords(a) for a in args]
                tpts = [(_tx(p[0]), _ty(p[1])) for p in pts]
                draw_polygon(canvas, tpts, width=width, style=style, fill=fill)
            elif cmd == 'ARC':
                cx, cy = _parse_coords(args[0])
                r = _parse_float(args[1])
                start_deg = _parse_float(args[2], 0)
                end_deg = _parse_float(args[3], 360)
                draw_arc(canvas, _tx(cx), _ty(cy), r, start_deg, end_deg,
                         width=width, style=style)
            elif cmd == 'GRID':
                x, y = _parse_coords(args[0])
                w, h = _parse_coords(args[1])
                cw, ch = _parse_coords(args[2])
                draw_grid(canvas, _tx(x), _ty(y), w, h, cw, ch,
                          width=width, style=style)
            elif cmd == 'TEXT':
                x, y = _parse_coords(args[0])
                # Reconstruct text (may contain spaces and quotes)
                text = ' '.join(args[1:])
                center = kwargs.get('center', 'true').lower() == 'true'
                text_scale = _parse_float(kwargs.get('scale'), scale)
                draw_text(canvas, _tx(x), _ty(y), text, glyphs,
                          scale=text_scale, center=center)
            elif cmd == 'DOT':
                x, y = _parse_coords(args[0])
                r = _parse_float(args[1]) if len(args) > 1 else 3
                draw_dot(canvas, _tx(x), _ty(y), r, style=style)
            elif cmd == 'BRACKET':
                x, y = _parse_coords(args[0])
                w, h = _parse_coords(args[1])
                side = kwargs.get('side', 'both')
                draw_bracket(canvas, _tx(x), _ty(y), w, h,
                             side=side, width=width, style=style)
            elif cmd == 'BRACE':
                x, y = _parse_coords(args[0])
                w, h = _parse_coords(args[1])
                side = kwargs.get('side', 'left')
                draw_brace(canvas, _tx(x), _ty(y), w, h,
                           side=side, width=width, style=style)
            elif cmd == 'HIGHLIGHT':
                x, y = _parse_coords(args[0])
                w, h = _parse_coords(args[1])
                draw_highlight(canvas, _tx(x), _ty(y), w, h)
        except (IndexError, ValueError) as e:
            continue
        _record_step(c)

    canvas.info['steps'] = steps
    canvas.info['step_map'] = Image.fromarray(step_map, 'L')
    return canvas, canvas_h // 2
