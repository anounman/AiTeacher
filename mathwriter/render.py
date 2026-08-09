"""Render German text into a handwritten-looking page using extracted glyphs.

Supports markup for math notation:
  ~~text~~        — underlined header
  [M]a,b;c,d[/M]  — 2x2 matrix (cells by `,`, rows by `;`)
  [F]num|den[/F]  — fraction
  [S]lo|up[/S]    — sum with lower/upper limits (Σ)
  [B]text[/B]     — box around content
  Unicode subscripts ₀₁₂₃₄₅₆₇₈₉₊₋₌ᵢⱼₖₙₘ — rendered small below baseline
"""
import json, os, random, math, re
from PIL import Image, ImageDraw, ImageFilter
import numpy as np
import cv2

from charset import (
    FALLBACKS, SUPERSCRIPT_MAP, SUBSCRIPT_MAP,
)


def elastic_warp(img, magnitude=1.8, grid=10):
    """Apply a small smooth random displacement to make each glyph instance unique."""
    arr = np.array(img)
    h, w = arr.shape[:2]
    if h < 4 or w < 4:
        return img
    gh = max(2, h // grid)
    gw = max(2, w // grid)
    dx = np.random.uniform(-magnitude, magnitude, (gh, gw)).astype(np.float32)
    dy = np.random.uniform(-magnitude, magnitude, (gh, gw)).astype(np.float32)
    dx = cv2.resize(dx, (w, h), interpolation=cv2.INTER_CUBIC)
    dy = cv2.resize(dy, (w, h), interpolation=cv2.INTER_CUBIC)
    xx, yy = np.meshgrid(np.arange(w, dtype=np.float32),
                         np.arange(h, dtype=np.float32))
    map_x = (xx + dx).astype(np.float32)
    map_y = (yy + dy).astype(np.float32)
    warped = cv2.remap(arr, map_x, map_y, cv2.INTER_LINEAR,
                       borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))
    return Image.fromarray(warped)


def shear_warp(img, max_shear=0.06):
    """Apply small horizontal shear so the glyph leans slightly."""
    s = random.uniform(-max_shear, max_shear)
    w, h = img.size
    new_w = int(w + abs(s) * h) + 2
    return img.transform((new_w, h), Image.AFFINE,
                         (1, s, -s * h if s < 0 else 0, 0, 1, 0),
                         resample=Image.BICUBIC,
                         fillcolor=(0, 0, 0, 0))


INK_RGB = (15, 70, 180)  # iPad / Apple Pencil blue
RED_INK = (200, 30, 30)  # for signature in top-right corner
AA_SS = 3  # super-sampling factor for anti-aliased line drawing


def aa_line(target_img, pts, fill, width=3, joint='curve'):
    """Draw an anti-aliased polyline by rendering at AA_SS× resolution
    and downsampling with LANCZOS. Replaces every PIL draw.line call so that
    nothing looks pixelated."""
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


def recolor_to_blue(img):
    """iPad Apple-Pencil ink: uniform solid color, full alpha where there's ink,
    crisp anti-aliased edges (the supersampling in the renderer handles AA)."""
    arr = np.array(img).astype(np.int16)
    a = arr[..., 3].astype(np.float32)
    # Boost low-alpha pixels to full opacity — digital ink is solid
    new_a = np.where(a > 30, 255, a * 4).clip(0, 255)
    out = np.zeros_like(arr)
    out[..., 0] = INK_RGB[0]
    out[..., 1] = INK_RGB[1]
    out[..., 2] = INK_RGB[2]
    out[..., 3] = new_a
    out8 = out.astype(np.uint8)
    # Gentle smoothing for crisp-but-not-jagged edges
    alpha = out8[..., 3].astype(np.float32)
    blurred = cv2.GaussianBlur(alpha, (3, 3), 0.5)
    out8[..., 3] = blurred.clip(0, 255).astype(np.uint8)
    return Image.fromarray(out8, 'RGBA')


def load_glyphs():
    with open('glyphs/metadata.json', 'r') as f:
        meta = json.load(f)
    cache = {}
    for ch, variants in meta.items():
        cache[ch] = []
        for v in variants:
            img = Image.open(v['file']).convert('RGBA')
            img = recolor_to_blue(img)
            v2 = {**v, 'img': img, 'baseline_y': v['baseline_y'] - 48}
            cache[ch].append(v2)
    return cache


CONNECTABLE = set('abcdefghijklmnopqrstuvwxyzäöü')
# Letters whose pen lifts (closed shape or descender) — these usually don't connect to the next letter
NO_RIGHT_CONNECT = set('bdgjopqysz')
# Letters that don't naturally accept a connection from the left
NO_LEFT_CONNECT = set('iv')


def find_pen_point(img, baseline_y, side='right', band=14, threshold=80):
    """Find where the pen 'exits' (side='right') or 'enters' (side='left') a glyph.
    Searches a vertical band around the baseline. Returns (x_offset, y_offset)
    relative to the image, or None if no ink found near baseline."""
    arr = np.array(img)
    if arr.ndim < 3 or arr.shape[2] < 4:
        return None
    alpha = arr[..., 3]
    h, w = alpha.shape
    y0 = max(0, baseline_y - band // 2)
    y1 = min(h, baseline_y + band // 2 + 2)
    if y0 >= y1:
        return None
    band_mask = alpha[y0:y1] > threshold
    cols = np.where(band_mask.any(axis=0))[0]
    if len(cols) == 0:
        return None
    x = int(cols[-1] if side == 'right' else cols[0])
    col_strip = alpha[y0:y1, x]
    # weighted-center y of the ink in that column for natural pen position
    weights = col_strip.astype(np.float32)
    if weights.sum() <= 0:
        return None
    y_local = float((weights * np.arange(weights.size)).sum() / weights.sum())
    y = int(round(y0 + y_local))
    return (x, y)


def draw_connector(canvas, p1, p2, line_baseline_y, arc=None, width=3):
    """Smooth bezier connector arcing up over the baseline gap (pen lift+land)."""
    dx = p2[0] - p1[0]
    dy = p2[1] - p1[1]
    dist = math.hypot(dx, dy)
    if dist < 3:
        return
    if dist > 80:  # too far, skip — not really connected
        return
    if arc is None:
        # Arc up by a fraction of distance, bigger gaps arc more
        arc = max(2.5, min(8.0, dist * 0.22))
    mid_x = (p1[0] + p2[0]) / 2 + random.uniform(-0.8, 0.8)
    # control point arches UP (smaller y) toward the line baseline
    top_y = min(p1[1], p2[1])
    mid_y = top_y - arc + random.uniform(-0.6, 0.6)
    pts = []
    N = max(8, int(dist / 4))
    for k in range(N + 1):
        t = k / N
        x = (1 - t) ** 2 * p1[0] + 2 * (1 - t) * t * mid_x + t ** 2 * p2[0]
        y = (1 - t) ** 2 * p1[1] + 2 * (1 - t) * t * mid_y + t ** 2 * p2[1]
        # mild perpendicular wobble in the middle of the curve
        if 0 < k < N:
            wob = math.sin(math.pi * t) * random.uniform(-0.35, 0.35)
            x += wob
            y += wob * 0.5
        pts.append((x, y))
    aa_line(canvas, pts, _ink_jit(), width=width)


# Characters that pick_glyph failed to resolve during the current render.
# Inspect/clear via get_dropped_chars() / clear_dropped_chars().
_DROPPED_CHARS = {}


def get_dropped_chars():
    return dict(_DROPPED_CHARS)


def clear_dropped_chars():
    _DROPPED_CHARS.clear()


def pick_glyph(glyphs, ch, last_choices):
    is_sub = ch in SUBSCRIPT_MAP
    is_sup = ch in SUPERSCRIPT_MAP
    if is_sub:
        ch_lookup = SUBSCRIPT_MAP[ch]
    elif is_sup:
        ch_lookup = SUPERSCRIPT_MAP[ch]
    else:
        ch_lookup = ch
    if ch_lookup not in glyphs:
        ch_lookup = FALLBACKS.get(ch_lookup, ch_lookup)
        if ch_lookup not in glyphs:
            if ch not in (' ', '\n', '\t'):
                _DROPPED_CHARS[ch] = _DROPPED_CHARS.get(ch, 0) + 1
            return None, None
    variants = glyphs[ch_lookup]
    if len(variants) == 1:
        idx = 0
    else:
        last = last_choices.get(ch_lookup, -1)
        choices = [i for i in range(len(variants)) if i != last]
        idx = random.choice(choices)
    last_choices[ch_lookup] = idx
    v = variants[idx]

    def _shrink_and_boost(v, scale_factor, baseline_y):
        """Resize glyph and boost alpha back to full so it doesn't fade in print."""
        sw = max(1, int(v['w'] * scale_factor))
        sh = max(1, int(v['h'] * scale_factor))
        new_img = v['img'].resize((sw, sh), Image.LANCZOS)
        arr = np.array(new_img)
        arr[..., 3] = np.where(arr[..., 3] > 40, 255, arr[..., 3] * 4).clip(0, 255)
        return {**v, 'img': Image.fromarray(arr), 'w': sw, 'h': sh,
                'baseline_y': baseline_y}

    if is_sup:
        # Superscript: 80% size, positioned ABOVE baseline (near top of x-height)
        # Original glyph (e.g. '1' at h=27) → shrunk to ~22, placed high so
        # bottom of superscript sits at x-height top.
        v = _shrink_and_boost(v, 0.80, baseline_y=int(v['h'] * 0.80) + 20)
    elif is_sub:
        # Subscript: 80% size, positioned BELOW baseline
        v = _shrink_and_boost(v, 0.80, baseline_y=-8)
    return v, idx


# ---------- Tokenization ----------
TOKEN_RE = re.compile(r'\[(M|F|S|B|T|X|V|H|R|D|U|I|G|DRAW)\](.*?)\[/\1\]', re.DOTALL)


def _split_unescaped(s, sep):
    """Split on first un-backslash-escaped occurrence of sep. Returns (a, b).
    If sep doesn't occur, returns (s, '')."""
    i = 0
    while i < len(s):
        if s[i] == '\\' and i + 1 < len(s):
            i += 2
            continue
        if s[i] == sep:
            return s[:i], s[i+1:]
        i += 1
    return s, ''


def tokenize(paragraph):
    """Split a paragraph string into a list of tokens.
    Returns list of dicts with 'kind' in {'text','matrix','frac','sum','box'} or None for header markers.
    """
    tokens = []
    pos = 0
    for m in TOKEN_RE.finditer(paragraph):
        if m.start() > pos:
            tokens.append({'kind': 'text', 'content': paragraph[pos:m.start()]})
        tag, body = m.group(1), m.group(2)
        if tag == 'M':
            # Augmented-matrix support: a cell of '|' marks a vertical divider
            # in that column. e.g. "1,2,|,3 ; 4,5,|,6" → divider between cols 2 & 3.
            rows = []
            divider_cols = set()
            for row in body.split(';'):
                cells = [c.strip() for c in row.split(',')]
                clean = []
                for cell in cells:
                    if cell == '|':
                        divider_cols.add(len(clean))
                    else:
                        clean.append(cell)
                rows.append(clean)
            tokens.append({'kind': 'matrix', 'rows': rows,
                           'dividers': sorted(divider_cols)})
        elif tag == 'F':
            # Allow \| to mean a literal '|' inside the body (for absolute value
            # bars in numerator/denominator). Real separator is the first
            # unescaped '|'.
            num, den = _split_unescaped(body, '|')
            num = num.replace('\\|', '|')
            den = den.replace('\\|', '|')
            tokens.append({'kind': 'frac', 'num': num.strip(), 'den': den.strip()})
        elif tag == 'S':
            lo, up = _split_unescaped(body, '|')
            lo = lo.replace('\\|', '|')
            up = up.replace('\\|', '|')
            tokens.append({'kind': 'sum', 'lower': lo.strip(), 'upper': up.strip()})
        elif tag == 'I':
            lo, up = _split_unescaped(body, '|')
            lo = lo.replace('\\|', '|')
            up = up.replace('\\|', '|')
            tokens.append({'kind': 'integral_bounded',
                           'lower': lo.strip(), 'upper': up.strip()})
        elif tag == 'B':
            tokens.append({'kind': 'box', 'content': body.strip()})
        elif tag == 'T':
            rows = []
            # Body may use \x01 instead of \n (from preprocessing)
            for line in body.replace('\x01', '\n').strip().split('\n'):
                if not line.strip():
                    continue
                cells = [c.strip() for c in line.split('|')]
                rows.append(cells)
            tokens.append({'kind': 'table', 'rows': rows})
        elif tag == 'X':
            tokens.append({'kind': 'strike', 'content': body})
        elif tag == 'V':
            tokens.append({'kind': 'vec', 'content': body})
        elif tag == 'H':
            tokens.append({'kind': 'hat', 'content': body})
        elif tag == 'R':
            tokens.append({'kind': 'sqrt', 'content': body})
        elif tag == 'D':
            tokens.append({'kind': 'down', 'content': body})  # subscript-style group
        elif tag == 'U':
            tokens.append({'kind': 'up', 'content': body})    # superscript-style group
        elif tag == 'G':
            # Diagram block: body is a JSON spec
            import json as _json
            try:
                spec = _json.loads(body)
            except Exception:
                spec = {'type': 'text', 'text': body}
            tokens.append({'kind': 'diagram', 'spec': spec})
        elif tag == 'DRAW':
            tokens.append({'kind': 'draw', 'commands': body})
        pos = m.end()
    if pos < len(paragraph):
        tokens.append({'kind': 'text', 'content': paragraph[pos:]})
    # Expand text tokens to extract inline arrow / approx sequences
    expanded = []
    inline_re = re.compile(r'(->|=>|⇒|→|≈|∫)')
    for tok in tokens:
        if tok['kind'] == 'text':
            parts = inline_re.split(tok['content'])
            for part in parts:
                if not part:
                    continue
                if part == '≈':
                    expanded.append({'kind': 'approx'})
                elif part == '∫':
                    expanded.append({'kind': 'integral'})
                elif inline_re.fullmatch(part):
                    expanded.append({'kind': 'arrow'})
                else:
                    expanded.append({'kind': 'text', 'content': part})
        else:
            expanded.append(tok)
    return expanded


# ---------- Text-chunk rendering (used inside matrices/fractions/etc.) ----------
def render_text_chunk(text, glyphs, scale=0.85, *, color_jitter=3,
                      rotate_jitter=2.0, size_jitter=0.04, kerning=4,
                      space_width=14, return_baseline=False):
    """Render a single short string into a tight RGBA image. No wrapping."""
    if not text:
        empty = Image.new('RGBA', (1, 1), (0, 0, 0, 0))
        return (empty, 0) if return_baseline else empty
    # First measure
    last = {}
    glyph_specs = []
    for ch in text:
        if ch == ' ':
            glyph_specs.append(('space', None))
            continue
        g, _ = pick_glyph(glyphs, ch, last)
        if g is None:
            glyph_specs.append(('space', None))
            continue
        s = scale * (1 + random.uniform(-size_jitter, size_jitter))
        gw = max(1, int(g['w'] * s))
        gh = max(1, int(g['h'] * s))
        bl = int(g['baseline_y'] * s)
        glyph_specs.append(('glyph', (g, s, gw, gh, bl)))

    # Compute total width and baseline
    total_w = 0
    max_above = 0  # space above baseline
    max_below = 0  # space below baseline
    for kind, data in glyph_specs:
        if kind == 'space':
            total_w += space_width
            continue
        g, s, gw, gh, bl = data
        total_w += gw + kerning
        # glyph spans py = baseline - bl to py + gh; relative to baseline:
        above = bl  # baseline - py = bl
        below = gh - bl
        max_above = max(max_above, above)
        max_below = max(max_below, below)
    if total_w <= 0:
        empty = Image.new('RGBA', (1, 1), (0, 0, 0, 0))
        return (empty, 0) if return_baseline else empty

    H = max_above + max_below + 4
    W = total_w + 4
    canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    baseline_y = max_above + 2
    x = 2
    for kind, data in glyph_specs:
        if kind == 'space':
            x += space_width
            continue
        g, s, gw, gh, bl = data
        gimg = g['img'].resize((gw, gh), Image.LANCZOS)
        if rotate_jitter:
            angle = random.uniform(-rotate_jitter, rotate_jitter)
            gimg = gimg.rotate(angle, resample=Image.BICUBIC, expand=True)
        if color_jitter:
            arr = np.array(gimg).astype(np.int16)
            j = np.random.randint(-color_jitter, color_jitter + 1, size=3)
            arr[..., :3] = np.clip(arr[..., :3] + j, 0, 255)
            gimg = Image.fromarray(arr.astype(np.uint8), 'RGBA')
        py = baseline_y - bl
        canvas.alpha_composite(gimg, (x, py))
        x += gw + kerning
    if return_baseline:
        return canvas, baseline_y
    return canvas


def render_inline(content, glyphs, scale=0.85):
    """Render a string with inline tokens (text + matrix/frac/sum) into one image.
    Returns (image, baseline_y)."""
    tokens = tokenize(content)
    parts = []  # list of (img, baseline_in_img)
    for tok in tokens:
        if tok['kind'] == 'text':
            if tok['content']:
                img, bl = render_text_chunk(tok['content'], glyphs, scale=scale, return_baseline=True)
                parts.append((img, bl))
        elif tok['kind'] == 'matrix':
            img, bl = render_matrix(tok['rows'], glyphs, scale=scale * 0.9,
                                    dividers=tok.get('dividers', ()))
            parts.append((img, bl))
        elif tok['kind'] == 'frac':
            img, bl = render_fraction(tok['num'], tok['den'], glyphs, scale=scale * 0.9)
            parts.append((img, bl))
        elif tok['kind'] == 'sum':
            img, bl = render_sum(tok['lower'], tok['upper'], glyphs, scale=scale * 0.9)
            parts.append((img, bl))
        elif tok['kind'] == 'table':
            img, bl = render_table(tok['rows'], glyphs, scale=scale * 0.85)
            parts.append((img, bl))
        elif tok['kind'] == 'arrow':
            res = render_arrow_glyph(glyphs, scale=scale)
            if res is None:
                res = render_arrow(scale=scale)
            parts.append(res)
        elif tok['kind'] == 'approx':
            parts.append(render_approx(scale=scale))
        elif tok['kind'] == 'integral':
            # Prefer a real handwritten ∫ glyph; fall back to procedural if none exists
            res = render_integral_glyph(glyphs, scale=scale)
            if res is None:
                res = render_integral(scale=scale)
            parts.append(res)
        elif tok['kind'] == 'integral_bounded':
            parts.append(render_integral_bounded(
                tok['lower'], tok['upper'], glyphs, scale=scale))
        elif tok['kind'] == 'strike':
            img, bl = render_strike(tok['content'], glyphs, scale=scale)
            parts.append((img, bl))
        elif tok['kind'] == 'vec':
            img, bl = render_vec(tok['content'], glyphs, scale=scale)
            parts.append((img, bl))
        elif tok['kind'] == 'hat':
            img, bl = render_hat(tok['content'], glyphs, scale=scale)
            parts.append((img, bl))
        elif tok['kind'] == 'sqrt':
            img, bl = render_sqrt(tok['content'], glyphs, scale=scale)
            parts.append((img, bl))
        elif tok['kind'] == 'down':
            img, bl = render_down(tok['content'], glyphs, scale=scale)
            parts.append((img, bl))
        elif tok['kind'] == 'up':
            img, bl = render_up(tok['content'], glyphs, scale=scale)
            parts.append((img, bl))
        elif tok['kind'] == 'diagram':
            img, bl = render_diagram(tok['spec'], glyphs, scale=scale)
            parts.append((img, bl))
        elif tok['kind'] == 'draw':
            img, bl = render_draw(tok['commands'], glyphs, scale=scale)
            parts.append((img, bl))
    if not parts:
        return Image.new('RGBA', (1, 1), (0, 0, 0, 0)), 0
    # Align all on baseline
    max_above = max(bl for _, bl in parts)
    max_below = max(img.size[1] - bl for img, bl in parts)
    total_w = sum(img.size[0] for img, _ in parts) + 4 * (len(parts) - 1)
    H = max_above + max_below + 4
    canvas = Image.new('RGBA', (total_w + 4, H), (0, 0, 0, 0))
    x = 2
    for img, bl in parts:
        y = max_above + 2 - bl
        canvas.alpha_composite(img, (x, y))
        x += img.size[0] + 4
    return canvas, max_above + 2


# ---------- Block renderers (matrix, fraction, sum, box) ----------
INK = (*INK_RGB, 245)


def _ink_jit():
    # iPad ink is digitally consistent — no jitter
    r, g, b = INK_RGB
    return (r, g, b, 255)


def render_matrix(rows, glyphs, scale=0.85, dividers=()):
    """Render a matrix with hand-drawn parentheses. Returns RGBA image + baseline_y.
    `dividers` is a tuple of column indices where a vertical augmented-bar should be drawn."""
    # Render each cell (uses render_inline so nested markup like vec/sqrt/frac works)
    cell_imgs = []
    for row in rows:
        row_imgs = [render_inline(c, glyphs, scale=scale)[0] for c in row]
        cell_imgs.append(row_imgs)
    n_rows = len(cell_imgs)
    n_cols = max(len(r) for r in cell_imgs)
    col_w = [0] * n_cols
    row_h = [0] * n_rows
    for i, row in enumerate(cell_imgs):
        for j, img in enumerate(row):
            col_w[j] = max(col_w[j], img.size[0])
            row_h[i] = max(row_h[i], img.size[1])
    col_pad = int(28 * scale)
    row_pad = int(14 * scale)
    paren_w = int(20 * scale)
    inner_w = sum(col_w) + col_pad * (n_cols - 1)
    inner_h = sum(row_h) + row_pad * (n_rows - 1)
    total_w = inner_w + 2 * paren_w + 28
    total_h = inner_h + 16

    img = Image.new('RGBA', (total_w, total_h), (0, 0, 0, 0))
    # Paste cells
    cy = 6
    for i, row in enumerate(cell_imgs):
        cx = paren_w + 12
        for j in range(n_cols):
            if j < len(row):
                cell = row[j]
                cw, ch = cell.size
                # right-align numbers, center letters
                offx = (col_w[j] - cw) // 2
                offy = (row_h[i] - ch) // 2
                img.alpha_composite(cell, (cx + offx, cy + offy))
            cx += col_w[j] + col_pad
        cy += row_h[i] + row_pad

    draw = ImageDraw.Draw(img)
    L = 4
    R = total_w - 4
    T = 4
    B = total_h - 4
    cy = (T + B) / 2 + random.uniform(-1.5, 1.5)
    r_y = (B - T) / 2
    # Bow width: roughly equal to paren_w, with subtle variation
    r_x_left = paren_w * random.uniform(0.85, 1.05)
    r_x_right = paren_w * random.uniform(0.85, 1.05)
    # Slight lean
    lean_l = random.uniform(-2.0, 1.0)
    lean_r = random.uniform(-1.0, 2.0)
    N = 40

    def draw_paren(cx, r_x, side, lean):
        """side = -1 for '(' (bow left), +1 for ')' (bow right)."""
        pts = []
        for t in range(N + 1):
            u = t / N
            # Slight asymmetry: top half curves a bit differently than bottom
            bow = math.sin(math.pi * u)
            bow = bow * (0.92 + 0.08 * math.sin(math.pi * u))
            px = cx + side * r_x * bow
            py = cy + (-r_y) * math.cos(math.pi * u)
            px += lean * (py - cy) / r_y
            if 0 < t < N:
                px += random.uniform(-0.4, 0.4)
                py += random.uniform(-0.4, 0.4)
            pts.append((px, py))
        aa_line(img, pts, _ink_jit(), width=3)

    cx_l = L + paren_w
    cx_r = R - paren_w
    draw_paren(cx_l, r_x_left, side=-1, lean=lean_l)
    draw_paren(cx_r, r_x_right, side=+1, lean=lean_r)

    # Augmented bars: vertical divider lines between cells at divider column indices
    for div_col in dividers:
        if div_col <= 0 or div_col >= n_cols:
            continue
        # x position is BETWEEN cell[div_col-1] and cell[div_col]
        cx = paren_w + 12
        for j in range(div_col):
            cx += col_w[j] + col_pad
        bar_x = cx - col_pad // 2 + random.uniform(-1, 1)
        bar_pts = []
        n_segments = 12
        for k in range(n_segments + 1):
            u = k / n_segments
            y = T + (B - T) * u + random.uniform(-0.4, 0.4)
            x = bar_x + random.uniform(-0.3, 0.3)
            bar_pts.append((x, y))
        aa_line(img, bar_pts, _ink_jit(), width=2)

    baseline = total_h // 2
    return img, baseline


def render_fraction(num, den, glyphs, scale=0.85):
    """Render a fraction with horizontal bar. Returns RGBA image + baseline_y (the bar)."""
    n_img, _ = render_inline(num, glyphs, scale=scale)
    d_img, _ = render_inline(den, glyphs, scale=scale)
    nw, nh = n_img.size
    dw, dh = d_img.size
    W = max(nw, dw) + 16
    bar_y_gap = 6
    H = nh + dh + 2 * bar_y_gap + 2
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    img.alpha_composite(n_img, ((W - nw) // 2, 1))
    img.alpha_composite(d_img, ((W - dw) // 2, nh + 2 * bar_y_gap))
    draw = ImageDraw.Draw(img)
    bar_y = nh + bar_y_gap
    # Wavy hand-drawn bar
    pts = []
    for i in range(0, W, 6):
        pts.append((i, bar_y + random.randint(-1, 1)))
    pts.append((W - 2, bar_y))
    aa_line(img, pts, _ink_jit(), width=3)
    baseline = bar_y + 2
    return img, baseline


def render_sum(lower, upper, glyphs, scale=0.85):
    """Render Σ with limits, drawn as one continuous wavy path."""
    lo_img, _ = render_inline(lower, glyphs, scale=scale * 0.6)
    up_img, _ = render_inline(upper, glyphs, scale=scale * 0.6)
    sigma_h = int(54 * scale)
    sigma_w = int(44 * scale)
    pad = 2
    W = max(sigma_w + 8, lo_img.size[0], up_img.size[0]) + 8
    H = up_img.size[1] + pad + sigma_h + pad + lo_img.size[1]
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    img.alpha_composite(up_img, ((W - up_img.size[0]) // 2, 0))

    sx_left = (W - sigma_w) // 2
    sy_top = up_img.size[1] + pad
    sy_bot = sy_top + sigma_h
    mid_y = (sy_top + sy_bot) // 2
    apex_x = sx_left + int(sigma_w * 0.82)  # apex on RIGHT side
    slant = random.uniform(-1.5, 1.5)

    # Clean 5-point Σ: top-right, top-left, apex (middle-right), bottom-left, bottom-right.
    # No per-point jitter — that was creating dot artifacts at corners.
    p_top_r = (sx_left + sigma_w, sy_top)
    p_top_l = (sx_left, sy_top + slant * 0.3)
    p_apex = (apex_x, mid_y)
    p_bot_l = (sx_left, sy_bot - slant * 0.3)
    p_bot_r = (sx_left + sigma_w, sy_bot)
    full = [p_top_r, p_top_l, p_apex, p_bot_l, p_bot_r]
    aa_line(img, full, _ink_jit(), width=3)

    img.alpha_composite(lo_img, ((W - lo_img.size[0]) // 2, sy_bot + pad))
    baseline = mid_y + sigma_h // 5
    return img, baseline


def _hand_segment(p1, p2, segments=10, jitter=0.7, overshoot=(0.0, 2.5),
                  trim_end=False, trim_start=False):
    """Generate points for a slightly wobbly line. Optionally apply over/undershoot.
    Returns a list of (x, y) — does NOT draw."""
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


def _hand_line(target_img, p1, p2, width=3, segments=10, jitter=0.7, overshoot=(0.0, 2.5)):
    """Draw a single wobbly anti-aliased line."""
    pts = _hand_segment(p1, p2, segments, jitter, overshoot)
    aa_line(target_img, pts, _ink_jit(), width=width)


def render_table(rows, glyphs, scale=0.8, header_row=True):
    """Render a hand-drawn table. Returns (RGBA image, baseline_y)."""
    if not rows:
        return Image.new('RGBA', (1, 1), (0, 0, 0, 0)), 0
    n_cols = max(len(r) for r in rows)
    cell_imgs = []
    cell_baselines = []
    for row in rows:
        row_imgs = []
        row_bls = []
        for j in range(n_cols):
            txt = row[j] if j < len(row) else ''
            # Use render_inline so arrows / fractions / etc. render inside table cells
            cimg, cbl = render_inline(txt, glyphs, scale=scale)
            row_imgs.append(cimg)
            row_bls.append(cbl)
        cell_imgs.append(row_imgs)
        cell_baselines.append(row_bls)

    col_pad_h = int(14 * scale)
    row_pad_v = int(9 * scale)
    col_w = [0] * n_cols
    raw_row_h = []
    for row in cell_imgs:
        max_h = 0
        for j, ci in enumerate(row):
            col_w[j] = max(col_w[j], ci.size[0])
            max_h = max(max_h, ci.size[1])
        raw_row_h.append(max_h)
    # Uniform row height so the header doesn't look squished next to taller data rows
    uniform_h = max(raw_row_h) if raw_row_h else 20
    row_h = [uniform_h] * len(raw_row_h)

    cell_x = [3]
    for j in range(n_cols):
        cell_x.append(cell_x[-1] + col_w[j] + 2 * col_pad_h)
    cell_y = [3]
    for i in range(len(cell_imgs)):
        cell_y.append(cell_y[-1] + row_h[i] + 2 * row_pad_v)

    W = cell_x[-1] + 6
    H = cell_y[-1] + 6
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Place cell content (left-aligned with padding, vertically centered)
    for i, row in enumerate(cell_imgs):
        for j, ci in enumerate(row):
            cw, ch = ci.size
            x = cell_x[j] + col_pad_h
            y = cell_y[i] + row_pad_v + (row_h[i] - ch) // 2
            img.alpha_composite(ci, (x, y))

    # Hand-drawn borders. The outer rectangle is drawn as ONE continuous
    # polyline that traces around all four corners. Internal dividers
    # are each their own stroke.
    top = cell_y[0]
    bot = cell_y[-1]
    left = cell_x[0]
    right = cell_x[-1]

    # Continuous outer loop: TL -> TR -> BR -> BL -> back near TL
    seg_kwargs = dict(segments=14, jitter=0.55, overshoot=(0, 0))
    outer = []
    # Start with a tiny pen-down approach above-left of top-left corner
    start_x = left + random.uniform(-1, 2)
    start_y = top + random.uniform(-1, 2)
    outer.append((start_x, start_y))
    outer.extend(_hand_segment((left, top), (right, top),
                               trim_start=True, trim_end=True, **seg_kwargs))
    outer.extend(_hand_segment((right, top), (right, bot),
                               trim_start=True, trim_end=True, **seg_kwargs))
    outer.extend(_hand_segment((right, bot), (left, bot),
                               trim_start=True, trim_end=True, **seg_kwargs))
    outer.extend(_hand_segment((left, bot), (left, top),
                               trim_start=True, trim_end=True, **seg_kwargs))
    # Close past the start (real hand often overshoots the closing corner)
    closing = (left + random.uniform(2, 6), top + random.uniform(-0.5, 1.5))
    outer.append(closing)
    aa_line(img, outer, _ink_jit(), width=3)

    # Vertical dividers — each a single stroke
    for j in range(1, n_cols):
        x = cell_x[j]
        _hand_line(img, (x, top), (x, bot),
                   width=3, jitter=0.5, overshoot=(0.0, 1.4))

    # Horizontal row dividers (header underline + each subsequent row)
    if header_row and len(cell_imgs) > 1:
        y = cell_y[1]
        _hand_line(img, (left, y), (right, y), width=3, jitter=0.5)
        for i in range(2, len(cell_imgs)):
            y = cell_y[i]
            _hand_line(img, (left, y), (right, y),
                       width=3, jitter=0.6, overshoot=(0.0, 1.6))

    return img, H // 2


def render_arrow_glyph(glyphs, scale=1.0):
    """Render the '→' arrow by picking a real handwritten glyph variant if available."""
    if '→' not in glyphs:
        return None
    last = {}
    g, _ = pick_glyph(glyphs, '→', last)
    if g is None:
        return None
    s = scale * (1 + random.uniform(-0.04, 0.04))
    gw = max(1, int(g['w'] * s))
    gh = max(1, int(g['h'] * s))
    img = g['img'].resize((gw, gh), Image.LANCZOS)
    angle = random.uniform(-2.5, 2.5)
    img = img.rotate(angle, resample=Image.BICUBIC, expand=True)
    bl = max(1, int(g['baseline_y'] * s))
    return img, bl


def render_integral_bounded(lower, upper, glyphs, scale=1.0):
    """Render ∫ with lower limit at bottom-right corner and upper limit at
    top-right corner (like the standard math notation ∫_a^b)."""
    # Render the ∫ symbol
    int_res = render_integral_glyph(glyphs, scale=scale)
    if int_res is None:
        int_res = render_integral(scale=scale)
    int_img, int_bl = int_res
    IW, IH = int_img.size

    # Render limits at a smaller scale
    lo_img, _ = render_inline(lower, glyphs, scale=scale * 0.55)
    up_img, _ = render_inline(upper, glyphs, scale=scale * 0.55)
    # Boost alpha so the small text stays visible in print
    for img in (lo_img, up_img):
        arr = np.array(img)
        arr[..., 3] = np.where(arr[..., 3] > 40, 255, arr[..., 3] * 4).clip(0, 255)
        img.paste(Image.fromarray(arr), (0, 0))
    lw, lh = lo_img.size
    uw, uh = up_img.size

    # Layout: ∫ on left, upper at top-right (aligned with ∫ top),
    # lower at bottom-right (aligned with ∫ bottom).
    gap_x = int(2 * scale)
    total_w = IW + gap_x + max(lw, uw) + 4
    total_h = IH
    canvas = Image.new('RGBA', (total_w, total_h), (0, 0, 0, 0))
    canvas.alpha_composite(int_img, (0, 0))
    # Upper limit: place just to the right of the top of the ∫
    up_x = IW + gap_x
    up_y = int(IH * 0.08)   # near the top of the ∫
    canvas.alpha_composite(up_img, (up_x, up_y))
    # Lower limit: place just to the right of the bottom of the ∫
    lo_x = IW + gap_x
    lo_y = IH - lh - int(IH * 0.06)  # near the bottom of the ∫
    canvas.alpha_composite(lo_img, (lo_x, lo_y))

    # Baseline: keep the same as the plain ∫ (centered on line)
    return canvas, int_bl


def render_integral_glyph(glyphs, scale=1.0):
    """Render '∫' by picking a real handwritten glyph variant, scaled to a
    reasonable size (the raw sample is ~220 px tall — needs to be shrunk to
    about 1.4× the surrounding line height)."""
    if '∫' not in glyphs:
        return None
    last = {}
    g, _ = pick_glyph(glyphs, '∫', last)
    if g is None:
        return None
    # Extracted variants are ~220 px tall; target ~90-95 px on the page at scale=1.45
    # So we apply an extra 0.42× shrink relative to the base scale.
    s = scale * 0.42 * (1 + random.uniform(-0.05, 0.05))
    gw = max(1, int(g['w'] * s))
    gh = max(1, int(g['h'] * s))
    img = g['img'].resize((gw, gh), Image.LANCZOS)
    angle = random.uniform(-1.5, 1.5)
    img = img.rotate(angle, resample=Image.BICUBIC, expand=True)
    # baseline_y stored as gh_original/2 + 48 → after scale: gh_scaled/2 + 48
    # We want ∫ centred on the line baseline
    bl = int(g['h'] * 0.5 * s) + int(g['h'] * 0.15 * s)
    return img, bl


def render_arrow(scale=0.9):
    """Hand-drawn '->' arrow: a slightly wavy shaft + small V arrowhead."""
    W = int(54 * scale)
    H = int(28 * scale)
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    mid_y = H // 2
    # Shaft: slight tilt + wobble
    tilt = random.uniform(-1.0, 1.0)
    pts = []
    N = 10
    for k in range(N + 1):
        u = k / N
        x = 2 + u * (W - 6)
        y = mid_y + tilt * (u - 0.5) + random.uniform(-0.4, 0.4)
        pts.append((x, y))
    aa_line(img, pts, _ink_jit(), width=3)
    # Arrowhead: V from tip back-up and back-down, drawn as one continuous stroke
    tip = pts[-1]
    head_len = max(6, int(9 * scale))
    head_ang = math.radians(28 + random.uniform(-4, 4))
    upper = (tip[0] - head_len * math.cos(head_ang),
             tip[1] - head_len * math.sin(head_ang))
    lower = (tip[0] - head_len * math.cos(head_ang),
             tip[1] + head_len * math.sin(head_ang) + random.uniform(-0.5, 0.5))
    # Draw the V in one path (upper -> tip -> lower)
    head_pts = [
        (upper[0] + random.uniform(-0.4, 0.4), upper[1] + random.uniform(-0.4, 0.4)),
        tip,
        (lower[0] + random.uniform(-0.4, 0.4), lower[1] + random.uniform(-0.4, 0.4)),
    ]
    aa_line(img, head_pts, _ink_jit(), width=3)
    # Place the arrow at x-height level (centered on the lowercase letters next to it),
    # not on the typographic baseline — return a baseline_y near the image bottom.
    return img, int(H * 0.85)


def render_approx(scale=0.9):
    """Hand-drawn ≈ (approximately equal): two stacked wavy lines."""
    W = int(36 * scale)
    H = int(26 * scale)
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    # Two wavy lines, stacked vertically
    for line_idx, y_center in enumerate([H * 0.40, H * 0.65]):
        pts = []
        n = 14
        for k in range(n + 1):
            u = k / n
            x = 2 + u * (W - 4)
            # sinusoidal wave with small jitter
            y = y_center + math.sin(u * math.pi * 2) * 1.4 + random.uniform(-0.4, 0.4)
            pts.append((x, y))
        aa_line(img, pts, _ink_jit(), width=2)
    return img, int(H * 0.78)


def render_integral(scale=0.9):
    """Hand-drawn ∫ (integral sign): tall elongated S with hooks at top and bottom."""
    W = int(26 * scale)
    H = int(96 * scale)
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    # Parametrize a stylized integral shape.
    # Uses a cubic-ish curve from top-right (with left hook) down through the
    # centre to bottom-left (with right hook).
    n = 40
    pts = []
    cx = W / 2
    for k in range(n + 1):
        u = k / n  # 0 → 1
        # y goes from small (top) to large (bottom)
        y = 4 + u * (H - 8)
        # x traces an S-curve: bows right in upper third, crosses at middle, bows left in lower third
        # Use sin(π u) for a single bow, but with sign flip for S-shape
        bow = math.sin(math.pi * u)  # 0 at ends, 1 at middle
        # main body slightly tilted
        s_bend = math.sin(math.pi * (u - 0.5)) * (W * 0.28)  # negative at top, positive at bottom
        x = cx + s_bend
        # Add slight jitter for hand feel — but not at the endpoints (avoids stray dots)
        if 0 < k < n:
            x += random.uniform(-0.35, 0.35)
            y += random.uniform(-0.35, 0.35)
        pts.append((x, y))
    # Top hook (curls left) — small stroke branching from the top point
    top = pts[0]
    top_hook_end = (top[0] - W * 0.35, top[1] + 3)
    top_hook_pts = [top_hook_end, top]
    # Bottom hook (curls right) — small stroke branching from the bottom point
    bot = pts[-1]
    bot_hook_end = (bot[0] + W * 0.35, bot[1] - 3)
    bot_hook_pts = [bot, bot_hook_end]
    # Draw as one continuous path so the endpoints don't create AA dots
    full = top_hook_pts[:-1] + pts + bot_hook_pts[1:]
    aa_line(img, full, _ink_jit(), width=3)
    # Baseline near the bottom hook (so ∫ hangs from the line like a normal char)
    return img, int(H * 0.78)


def render_vec(content, glyphs, scale=1.0):
    """Render text with a small arrow ('vector mark') drawn above it."""
    inner, inner_bl = render_inline(content, glyphs, scale=scale)
    W, H = inner.size
    bar_h = int(14 * scale)
    out_H = H + bar_h
    img = Image.new('RGBA', (W + 6, out_H), (0, 0, 0, 0))
    img.alpha_composite(inner, (3, bar_h))
    # Shaft (slightly wavy)
    bar_y = int(bar_h * 0.55) + random.randint(-1, 1)
    pts = []
    n = 10
    x0, x1 = 4, W + 2
    for k in range(n + 1):
        u = k / n
        pts.append((x0 + (x1 - x0) * u, bar_y + random.uniform(-0.5, 0.5)))
    aa_line(img, pts, _ink_jit(), width=2)
    # Tiny arrowhead at right
    tip = pts[-1]
    head_len = int(5 * scale)
    head_pts = [
        (tip[0] - head_len, tip[1] - head_len * 0.55),
        tip,
        (tip[0] - head_len, tip[1] + head_len * 0.55),
    ]
    aa_line(img, head_pts, _ink_jit(), width=2)
    return img, inner_bl + bar_h


def render_hat(content, glyphs, scale=1.0):
    """Render text with a caret '^' above it (unit vector)."""
    inner, inner_bl = render_inline(content, glyphs, scale=scale)
    W, H = inner.size
    bar_h = int(12 * scale)
    out_H = H + bar_h
    img = Image.new('RGBA', (W + 4, out_H), (0, 0, 0, 0))
    img.alpha_composite(inner, (2, bar_h))
    cx = (W + 4) // 2
    cy = int(bar_h * 0.55)
    half_w = max(4, int(W * 0.35))
    half_h = max(3, int(bar_h * 0.35))
    pts = [(cx - half_w + random.uniform(-0.5, 0.5),
            cy + half_h + random.uniform(-0.3, 0.3)),
           (cx + random.uniform(-0.5, 0.5), cy + random.uniform(-0.4, 0.4)),
           (cx + half_w + random.uniform(-0.5, 0.5),
            cy + half_h + random.uniform(-0.3, 0.3))]
    aa_line(img, pts, _ink_jit(), width=2)
    return img, inner_bl + bar_h


def render_sqrt(content, glyphs, scale=1.0):
    """Render content under a square-root sign with overbar extending across."""
    inner, inner_bl = render_inline(content, glyphs, scale=scale)
    W, H = inner.size
    overbar_gap = int(6 * scale)
    top_pad = overbar_gap + 3
    radical_w = int(14 * scale)
    # Image is just wide enough for radical + content (no trailing slack)
    out_W = W + radical_w + 4
    out_H = H + top_pad + 2
    img = Image.new('RGBA', (out_W, out_H), (0, 0, 0, 0))
    img.alpha_composite(inner, (radical_w + 2, top_pad))
    # Radical sign: small hook bottom-left, then diagonal up to the overbar start
    hook_bot = (3, top_pad + H - int(H * 0.35))
    hook_mid = (radical_w * 0.45 + 1, top_pad + H - 4)
    apex = (radical_w, 3)
    radical_pts = [hook_bot, hook_mid, apex]
    aa_line(img, radical_pts, _ink_jit(), width=3)
    # Overbar — two endpoints only, perfectly straight, ends at content right edge
    bar_y = 3
    bar_x0 = radical_w
    bar_x1 = radical_w + 2 + W
    aa_line(img, [(bar_x0, bar_y), (bar_x1, bar_y)], _ink_jit(), width=2)
    return img, inner_bl + top_pad


def render_down(content, glyphs, scale=1.0):
    """Render content as a SUBSCRIPT group — small text below the line baseline.
    Used for things like lim[D]h→0⁺[/D] (the 'h→0⁺' becomes a subscript under 'lim')."""
    inner, inner_bl = render_inline(content, glyphs, scale=scale * 0.62)
    iw, ih = inner.size
    # Build a small canvas where the inner sits with top NEAR our line baseline
    # so when pasted with effective baseline at the top of inner, it visually
    # appears as a subscript group below the surrounding text.
    # Boost alpha so the small text doesn't fade in print
    arr = np.array(inner)
    arr[..., 3] = np.where(arr[..., 3] > 40, 255, arr[..., 3] * 4).clip(0, 255)
    inner = Image.fromarray(arr)
    # The render_inline returned an image with its baseline at inner_bl;
    # for a subscript we want the TOP of the inner image to be at our outer baseline
    # i.e. the outer "baseline_y" of this whole block should be 0 (or slightly negative).
    return inner, -4  # baseline above the image → image hangs below


def render_up(content, glyphs, scale=1.0):
    """Render content as a SUPERSCRIPT group — small text above the line."""
    inner, inner_bl = render_inline(content, glyphs, scale=scale * 0.62)
    iw, ih = inner.size
    arr = np.array(inner)
    arr[..., 3] = np.where(arr[..., 3] > 40, 255, arr[..., 3] * 4).clip(0, 255)
    inner = Image.fromarray(arr)
    # Position the entire image well above baseline
    return inner, ih + 18


def render_strike(content, glyphs, scale=1.0):
    """Render text with a hand-drawn line through it (like a mistake correction)."""
    inner, inner_bl = render_inline(content, glyphs, scale=scale)
    W, H = inner.size
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    img.alpha_composite(inner, (0, 0))
    # Draw a wavy line through the x-height middle (slightly above baseline)
    y_strike = max(2, inner_bl - int(H * 0.18)) + random.randint(-1, 1)
    # 3–4 wobbly points
    pts = []
    n = 12
    for k in range(n + 1):
        u = k / n
        x = 1 + u * (W - 2)
        y = y_strike + math.sin(u * math.pi * 2) * 0.6 + random.uniform(-0.5, 0.5)
        pts.append((x, y))
    # slight overshoot at each end so it looks like a real pen drag
    aa_line(img, pts, _ink_jit(), width=3)
    return img, inner_bl


def render_box(content, glyphs, scale=1.0):
    """Render a boxed text chunk; supports inline markup (fractions, matrices)."""
    inner, inner_bl = render_inline(content, glyphs, scale=scale)
    pad = 10
    W = inner.size[0] + 2 * pad
    H = inner.size[1] + 2 * pad
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    img.alpha_composite(inner, (pad, pad))
    # One continuous rectangular stroke (hand-drawn)
    j = 1.2
    p_tl = (2 + random.uniform(-j, j), 2 + random.uniform(-j, j))
    p_tr = (W - 3 + random.uniform(-j, j), 2 + random.uniform(-j, j))
    p_br = (W - 3 + random.uniform(-j, j), H - 3 + random.uniform(-j, j))
    p_bl = (2 + random.uniform(-j, j), H - 3 + random.uniform(-j, j))
    close = (p_tl[0] + random.uniform(1, 4), p_tl[1] + random.uniform(-0.5, 1.5))
    rect = [p_tl, p_tr, p_br, p_bl, p_tl, close]
    aa_line(img, rect, _ink_jit(), width=3)
    return img, inner_bl + pad


def render_diagram(spec, glyphs, scale=0.75):
    """Render a diagram from a JSON spec. Returns (img, baseline_y).

    Spec types:
      - {"type": "tree", "nodes": "value:left:right\\n..."}
      - {"type": "array", "values": ["1","2","3"], "indices": ["0","1","2"]}
      - {"type": "dp_table", "rows": [["","A","B"],["","0","1"]], "row_labels": [...], "col_labels": [...]}
      - {"type": "linked_list", "values": ["A","B","C","null"]}
      - {"type": "graph", "nodes": [["A",100,100],["B",200,100]], "edges": [["A","B","5"]]}
      - {"type": "stack", "items": ["A","B","C"]}
      - {"type": "queue", "items": ["A","B","C"]}
      - {"type": "memory", "variables": [["x","5","0x100"],["p","0x200","0x108"]]}
      - {"type": "pointer", "objects": [["obj1",50,50,80,40],["obj2",200,50,80,40]], "pointers": [["obj1","obj2"]]}
    """
    from diagrams import (
        draw_tree, draw_array, draw_dp_table, draw_linked_list,
        draw_graph, draw_stack, draw_queue, draw_memory_layout,
        draw_pointer_diagram,
        draw_sack, draw_items_row, draw_dp_table_highlighted,
        draw_knapsack_state, draw_choice_diagram, draw_backtrack_chain
    )
    from diagrams_extra import (
        draw_logic_gate, draw_logic_circuit,
        draw_er_diagram, draw_relational_schema, draw_sql_join_venn,
        draw_mapreduce, draw_cap_theorem, draw_database_sharding,
        draw_consistent_hashing, draw_hdfs_architecture,
        draw_kafka_pipeline, draw_spark_lineage,
    )

    dtype = spec.get('type', 'text')

    if dtype == 'tree':
        return draw_tree(spec.get('nodes', ''), glyphs, scale=scale)
    elif dtype == 'array':
        return draw_array(
            spec.get('values', []),
            indices=spec.get('indices'),
            glyphs=glyphs,
            scale=scale,
            highlight=spec.get('highlight')
        )
    elif dtype == 'dp_table':
        return draw_dp_table(
            spec.get('rows', []),
            row_labels=spec.get('row_labels'),
            col_labels=spec.get('col_labels'),
            glyphs=glyphs,
            scale=scale,
            arrows=spec.get('arrows')
        )
    elif dtype == 'linked_list':
        return draw_linked_list(
            spec.get('values', []),
            glyphs=glyphs,
            scale=scale,
            horizontal=spec.get('horizontal', True)
        )
    elif dtype == 'graph':
        return draw_graph(
            spec.get('nodes', []),
            spec.get('edges', []),
            glyphs=glyphs,
            scale=scale
        )
    elif dtype == 'stack':
        return draw_stack(
            spec.get('items', []),
            glyphs=glyphs,
            scale=scale,
            direction=spec.get('direction', 'vertical')
        )
    elif dtype == 'queue':
        return draw_queue(
            spec.get('items', []),
            glyphs=glyphs,
            scale=scale
        )
    elif dtype == 'memory':
        return draw_memory_layout(
            spec.get('variables', []),
            glyphs=glyphs,
            scale=scale
        )
    elif dtype == 'pointer':
        return draw_pointer_diagram(
            spec.get('objects', []),
            spec.get('pointers', []),
            glyphs=glyphs,
            scale=scale
        )
    elif dtype == 'sack':
        return draw_sack(
            spec.get('capacity', ''),
            items_inside=spec.get('items_inside'),
            width=spec.get('width', 180),
            height=spec.get('height', 200),
            glyphs=glyphs
        )
    elif dtype == 'items_row':
        return draw_items_row(
            spec.get('items', []),
            glyphs=glyphs,
            scale=scale,
            highlight_idx=spec.get('highlight_idx')
        )
    elif dtype == 'dp_table_highlighted':
        return draw_dp_table_highlighted(
            spec.get('rows', []),
            row_labels=spec.get('row_labels'),
            col_labels=spec.get('col_labels'),
            glyphs=glyphs,
            scale=scale,
            highlight_cell=spec.get('highlight_cell'),
            arrows=spec.get('arrows'),
            computed_cells=spec.get('computed_cells')
        )
    elif dtype == 'knapsack_state':
        return draw_knapsack_state(
            spec.get('capacity', ''),
            spec.get('items_inside', []),
            spec.get('total_weight', '0'),
            spec.get('total_value', '0'),
            glyphs=glyphs
        )
    elif dtype == 'choice_diagram':
        return draw_choice_diagram(
            spec.get('item_name', ''),
            spec.get('item_weight', ''),
            spec.get('item_value', ''),
            spec.get('capacity_left', ''),
            spec.get('include_value', ''),
            spec.get('exclude_value', ''),
            spec.get('decision', 'undecided'),
            glyphs=glyphs
        )
    elif dtype == 'backtrack_chain':
        return draw_backtrack_chain(
            spec.get('dp_table_data', []),
            spec.get('path', []),
            glyphs=glyphs,
            scale=scale
        )

    # New fixed diagram types (image-mode, faster than [DRAW])
    if dtype == 'logic_gate':
        return draw_logic_gate(
            spec.get('gate', 'AND'),
            spec.get('inputs', ['A', 'B']),
            spec.get('output', 'Y'),
            truth_table=spec.get('truth_table'),
            glyphs=glyphs,
            scale=scale,
        )
    if dtype == 'logic_circuit':
        return draw_logic_circuit(
            spec.get('gates', []),
            spec.get('wires', []),
            spec.get('inputs', []),
            spec.get('outputs', []),
            glyphs=glyphs,
            scale=scale,
        )
    if dtype == 'er_diagram':
        return draw_er_diagram(
            spec.get('entities', []),
            spec.get('relationships', []),
            glyphs=glyphs,
            scale=scale,
        )
    if dtype == 'relational_schema':
        return draw_relational_schema(
            spec.get('tables', []),
            spec.get('relationships'),
            glyphs=glyphs,
            scale=scale,
        )
    if dtype == 'sql_join_venn':
        return draw_sql_join_venn(
            spec.get('join_type', 'INNER'),
            spec.get('labels', ['A', 'B']),
            glyphs=glyphs,
            scale=scale,
        )
    if dtype == 'mapreduce':
        return draw_mapreduce(
            spec.get('input_splits', []),
            spec.get('map_output', []),
            spec.get('reduce_output', []),
            glyphs=glyphs,
            scale=scale,
        )
    if dtype == 'cap_theorem':
        return draw_cap_theorem(
            spec.get('corners', {}),
            spec.get('examples', []),
            glyphs=glyphs,
            scale=scale,
        )
    if dtype == 'database_sharding':
        return draw_database_sharding(
            spec.get('shards', []),
            spec.get('routing_key', 'user_id'),
            glyphs=glyphs,
            scale=scale,
        )
    if dtype == 'consistent_hashing':
        return draw_consistent_hashing(
            spec.get('nodes', []),
            spec.get('keys', []),
            new_node=spec.get('new_node'),
            glyphs=glyphs,
            scale=scale,
        )
    if dtype == 'hdfs_architecture':
        return draw_hdfs_architecture(
            spec.get('name_node', {'name': 'NameNode'}),
            spec.get('data_nodes', []),
            glyphs=glyphs,
            scale=scale,
        )
    if dtype == 'kafka_pipeline':
        return draw_kafka_pipeline(
            spec.get('producers', []),
            spec.get('topic', 'Topic'),
            spec.get('consumers', []),
            glyphs=glyphs,
            scale=scale,
        )
    if dtype == 'spark_lineage':
        return draw_spark_lineage(
            spec.get('rdds', []),
            spec.get('stages', []),
            glyphs=glyphs,
            scale=scale,
        )

    # Fallback: render as text
    return render_text_chunk(str(spec), glyphs, scale=scale, return_baseline=True)


def render_draw(commands_text, glyphs, scale=0.7):
    """Render a [DRAW]...[/DRAW] block using the drawing engine."""
    from draw_engine import parse_draw_commands, execute_draw
    # Restore newlines that were replaced by the paragraph join step
    commands_text = commands_text.replace('\x01', '\n')
    commands = parse_draw_commands(commands_text)
    return execute_draw(commands, glyphs, scale=scale)


# ---------- Paper & scan ----------
def make_grid_paper(size=(1654, 2339), grid=40, line=(200, 210, 220, 255),
                    paper=(255, 255, 255, 255)):
    """iPad digital grid paper — pure white background, crisp blue-gray grid, no noise."""
    W, H = size
    img = Image.new('RGBA', size, paper)
    d = ImageDraw.Draw(img)
    for x in range(0, W + 1, grid):
        d.line([(x, 0), (x, H)], fill=line, width=1)
    for y in range(0, H + 1, grid):
        d.line([(0, y), (W, y)], fill=line, width=1)
    # No paper noise — digital paper is perfectly clean
    return img


def apply_scan_effects(img):
    """iPad output — no scan effects. The page is digitally pristine."""
    return img.convert('RGB')


# ---------- Main render ----------
def render_pages(text, *,
                 page_size=(1654, 2339),
                 margin_top=85, margin_bottom=90,
                 margin_left=80, margin_right_min=55,
                 line_height=64,
                 scale=1.45,
                 space_width=22,
                 color_jitter=0,
                 rotate_jitter=1.8,
                 baseline_jitter=2,
                 size_jitter=0.03,
                 spacing_jitter=3,
                 line_start_jitter=10,
                 line_slope_jitter=0.008,
                 line_height_jitter=3,
                 elastic_magnitude=0,
                 shear_max=0,
                 alpha_jitter=0):
    glyphs = load_glyphs()
    W, H = page_size
    max_x = W - margin_right_min
    max_y = H - margin_bottom
    pages = []
    canvas = None
    last = {}
    line_y = 0
    line_x_start = 0
    line_slope = 0.0

    state = {'canvas': None, 'x': 0, 'y': 0,
             'line_y': 0, 'line_x_start': 0, 'line_slope': 0.0}

    def new_page():
        state['canvas'] = Image.new('RGBA', page_size, (0, 0, 0, 0))
        state['line_y'] = margin_top + random.randint(-6, 12)
        state['line_x_start'] = margin_left + random.randint(-line_start_jitter, line_start_jitter)
        state['line_slope'] = random.uniform(-line_slope_jitter, line_slope_jitter)
        state['x'] = state['line_x_start']
        state['y'] = state['line_y']

    def finish_page():
        paper = make_grid_paper(size=page_size)
        combined = Image.alpha_composite(paper, state['canvas'])
        pages.append(apply_scan_effects(combined))

    def new_line(extra=0):
        state['line_y'] += line_height + random.randint(-line_height_jitter, line_height_jitter) + extra
        state['line_x_start'] = margin_left + random.randint(-line_start_jitter, line_start_jitter)
        state['line_slope'] = 0.6 * state['line_slope'] + 0.4 * random.uniform(-line_slope_jitter, line_slope_jitter)
        state['x'] = state['line_x_start']
        state['y'] = state['line_y']
        if state['y'] > max_y:
            finish_page()
            new_page()

    new_page()

    word_baseline_offset = [0]  # mutable per-word jitter, set on word start

    def get_baseline():
        dx = state['x'] - state['line_x_start']
        slope_dy = int(state['line_slope'] * dx)
        return state['y'] + int(line_height * 0.78) + slope_dy + word_baseline_offset[0]

    def paste_block(block_img, block_baseline_y, extra_advance=8):
        """Paste a complex block (matrix/frac/sum) at current position centered on baseline."""
        baseline = get_baseline()
        bw, bh = block_img.size
        # Local patch (keep on re-vendor): a block wider than the page (big
        # [DRAW]/[G]/[T] diagrams) was composited anyway and clipped at the
        # right margin ("OS loads page from dis|"). Scale it to fit instead —
        # a slightly smaller diagram beats a truncated one.
        usable = max_x - margin_left
        if bw > usable:
            ratio = usable / float(bw)
            block_img = block_img.resize(
                (usable, max(1, int(bh * ratio))), Image.LANCZOS)
            block_baseline_y = int(block_baseline_y * ratio)
            bw, bh = block_img.size
        py = baseline - block_baseline_y
        # Check page break
        if py < 10 or py + bh > max_y + 40:
            # Move to next "line" worth of space
            new_line(extra=int(bh * 0.4))
            baseline = get_baseline()
            py = baseline - block_baseline_y
        # If block won't fit horizontally, wrap
        if state['x'] + bw > max_x and state['x'] > state['line_x_start'] + 5:
            new_line(extra=int(bh * 0.4))
            baseline = get_baseline()
            py = baseline - block_baseline_y
        state['canvas'].alpha_composite(block_img, (state['x'], py))
        state['x'] += bw + extra_advance
        # Bump line_height if this block extends beyond current line
        bottom = py + bh
        line_bot = state['y'] + line_height
        if bottom > line_bot:
            state['line_y'] += bottom - line_bot

    # Pre-process: join multi-line tokens onto a single line so the paragraph
    # split below doesn't break them. We replace internal newlines with a marker.
    MARKER = '\x01'
    def _join_block(m):
        return m.group(0).replace('\n', MARKER)
    text_joined = re.sub(r'\[(M|F|S|B|T|G|DRAW)\].*?\[/\1\]',
                         _join_block, text, flags=re.DOTALL)
    text_joined = text_joined.replace(MARKER + MARKER, MARKER)  # collapse blanks
    # Restore newlines inside the token body in the tokenize step
    paragraphs = text_joined.split('\n')
    for para in paragraphs:
        if not para.strip():
            new_line(extra=int(line_height * 0.25))
            continue

        header_underline = False
        if para.startswith('~~') and para.rstrip().endswith('~~'):
            para = para[2:para.rstrip().rfind('~~')]
            header_underline = True
        header_start_x = None
        header_baseline_y = None

        tokens = tokenize(para)

        for tok in tokens:
            if tok['kind'] == 'text':
                # Render as plain text with word wrap
                content = tok['content']
                # Split into words preserving spaces structure
                words = re.split(r'( +)', content)
                for word in words:
                    if word == '':
                        continue
                    if word.isspace():
                        state['x'] += space_width * len(word) + random.randint(-3, 4)
                        continue
                    # Estimate width
                    est = 0
                    for ch in word:
                        g, _ = pick_glyph(glyphs, ch, {})
                        est += int((g['w'] if g else 14) * scale) + int(6 * scale)
                    if state['x'] + est > max_x and state['x'] > state['line_x_start'] + 5:
                        new_line()
                    if header_underline and header_start_x is None:
                        header_start_x = state['x']
                    # One baseline offset for the whole word — letters within a word stay aligned
                    word_baseline_offset[0] = random.randint(-baseline_jitter, baseline_jitter)
                    prev = None
                    for ch in word:
                        glyph, _ = pick_glyph(glyphs, ch, last)
                        if glyph is None:
                            state['x'] += 12
                            prev = None
                            continue
                        s = scale * (1 + random.uniform(-size_jitter, size_jitter))
                        gw = max(1, int(glyph['w'] * s))
                        gh = max(1, int(glyph['h'] * s))
                        gimg = glyph['img'].resize((gw, gh), Image.LANCZOS)
                        if rotate_jitter:
                            angle = random.uniform(-rotate_jitter, rotate_jitter)
                            gimg = gimg.rotate(angle, resample=Image.BICUBIC, expand=True)
                        bl = int(glyph['baseline_y'] * s)
                        baseline = get_baseline()
                        py = baseline - bl
                        if color_jitter:
                            arr = np.array(gimg).astype(np.int16)
                            j = np.random.randint(-color_jitter, color_jitter + 1, size=3)
                            arr[..., :3] = np.clip(arr[..., :3] + j, 0, 255)
                            gimg = Image.fromarray(arr.astype(np.uint8), 'RGBA')
                        # Draw connector only when natural: skip for letters that end with
                        # a closed shape/descender, skip for letters that don't accept a left-in,
                        # and only with ~30% probability even then. Real print-style writing
                        # connects occasionally, not at every pair.
                        if (prev is not None
                                and ch in CONNECTABLE
                                and prev[2] in CONNECTABLE
                                and prev[2] not in NO_RIGHT_CONNECT
                                and ch not in NO_LEFT_CONNECT
                                and random.random() < 0.32):
                            entry = find_pen_point(gimg, bl, side='left')
                            if entry is not None:
                                p_entry = (state['x'] + entry[0], py + entry[1])
                                p_exit = (prev[0], prev[1])
                                # Only draw if the gap is short — natural connection range
                                gap = math.hypot(p_entry[0] - p_exit[0],
                                                 p_entry[1] - p_exit[1])
                                if 3 < gap < 14:
                                    draw_connector(state['canvas'], p_exit, p_entry,
                                                   baseline, width=3)
                        state['canvas'].alpha_composite(gimg, (state['x'], py))
                        if header_underline:
                            header_baseline_y = baseline
                        # Compute exit point for next iteration
                        exit_pt = find_pen_point(gimg, bl, side='right')
                        if exit_pt is not None:
                            prev = (state['x'] + exit_pt[0], py + exit_pt[1], ch)
                        else:
                            prev = (state['x'] + gw, baseline - 3, ch)
                        kern = 4 if ch in CONNECTABLE else 6
                        advance = gw + int(kern * s) + random.randint(-spacing_jitter, spacing_jitter)
                        state['x'] += max(int(8 * s), advance)
            elif tok['kind'] == 'matrix':
                block, bl = render_matrix(tok['rows'], glyphs, scale=scale * 0.78,
                                          dividers=tok.get('dividers', ()))
                paste_block(block, bl, extra_advance=14)
            elif tok['kind'] == 'frac':
                block, bl = render_fraction(tok['num'], tok['den'], glyphs, scale=scale * 0.78)
                paste_block(block, bl, extra_advance=8)
            elif tok['kind'] == 'sum':
                block, bl = render_sum(tok['lower'], tok['upper'], glyphs, scale=scale * 0.78)
                paste_block(block, bl, extra_advance=10)
            elif tok['kind'] == 'box':
                block, bl = render_box(tok['content'], glyphs, scale=scale * 0.9)
                paste_block(block, bl, extra_advance=8)
            elif tok['kind'] == 'table':
                # Tables are paragraph-level blocks — place top at current line, not centered on baseline
                if state['x'] > state['line_x_start'] + 5:
                    new_line()
                block, _bl = render_table(tok['rows'], glyphs, scale=scale * 0.78)
                bw, bh = block.size
                # Page-break check
                if state['y'] + bh > max_y:
                    finish_page(); new_page()
                py = state['y'] + 4
                state['canvas'].alpha_composite(block, (state['x'], py))
                # Advance cursor so next text starts below the table
                state['line_y'] = py + bh - line_height + 8
                new_line()
            elif tok['kind'] == 'arrow':
                res = render_arrow_glyph(glyphs, scale=scale)
                if res is None:
                    res = render_arrow(scale=scale)
                block, bl = res
                paste_block(block, bl, extra_advance=4)
            elif tok['kind'] == 'approx':
                block, bl = render_approx(scale=scale)
                paste_block(block, bl, extra_advance=4)
            elif tok['kind'] == 'integral':
                res = render_integral_glyph(glyphs, scale=scale)
                if res is None:
                    res = render_integral(scale=scale)
                block, bl = res
                paste_block(block, bl, extra_advance=4)
            elif tok['kind'] == 'integral_bounded':
                block, bl = render_integral_bounded(
                    tok['lower'], tok['upper'], glyphs, scale=scale)
                paste_block(block, bl, extra_advance=4)
            elif tok['kind'] == 'strike':
                block, bl = render_strike(tok['content'], glyphs, scale=scale * 0.95)
                paste_block(block, bl, extra_advance=4)
            elif tok['kind'] == 'vec':
                block, bl = render_vec(tok['content'], glyphs, scale=scale)
                paste_block(block, bl, extra_advance=4)
            elif tok['kind'] == 'hat':
                block, bl = render_hat(tok['content'], glyphs, scale=scale)
                paste_block(block, bl, extra_advance=4)
            elif tok['kind'] == 'sqrt':
                block, bl = render_sqrt(tok['content'], glyphs, scale=scale)
                paste_block(block, bl, extra_advance=4)
            elif tok['kind'] == 'down':
                block, bl = render_down(tok['content'], glyphs, scale=scale)
                paste_block(block, bl, extra_advance=4)
            elif tok['kind'] == 'up':
                block, bl = render_up(tok['content'], glyphs, scale=scale)
                paste_block(block, bl, extra_advance=4)
            elif tok['kind'] == 'diagram':
                # Diagrams are block-level — start on a new line
                if state['x'] > state['line_x_start'] + 5:
                    new_line()
                block, bl = render_diagram(tok['spec'], glyphs, scale=scale * 0.75)
                bw, bh = block.size
                if state['y'] + bh > max_y:
                    finish_page(); new_page()
                py = state['y'] + 4
                state['canvas'].alpha_composite(block, (state['x'], py))
                state['line_y'] = py + bh - line_height + 8
                new_line()
            elif tok['kind'] == 'draw':
                # DRAW blocks are block-level
                if state['x'] > state['line_x_start'] + 5:
                    new_line()
                block, bl = render_draw(tok['commands'], glyphs, scale=scale * 0.75)
                bw, bh = block.size
                if state['y'] + bh > max_y:
                    finish_page(); new_page()
                py = state['y'] + 4
                state['canvas'].alpha_composite(block, (state['x'], py))
                state['line_y'] = py + bh - line_height + 8
                new_line()

        # Header underline
        if header_underline and header_start_x is not None and header_baseline_y is not None:
            ux1 = header_start_x - 4
            ux2 = state['x'] - space_width + 4
            uy = header_baseline_y + 6 + random.randint(-1, 2)
            mid = (ux1 + ux2) // 2
            pts = [(ux1, uy + random.uniform(-1, 1)),
                   (mid, uy + random.uniform(-1, 1)),
                   (ux2, uy + random.uniform(-1, 1))]
            aa_line(state['canvas'], pts, _ink_jit(), width=3)

        new_line()

    finish_page()
    return pages


def draw_signature(page_img, name_lines, scale=0.95):
    """Render a 1-3 line name in red ink at the top-right of a page.
    name_lines is a list of strings (one per line)."""
    glyphs = load_glyphs()
    W, H = page_img.size
    margin = 70
    cur_y = margin
    for line in name_lines:
        chunk, _bl = render_inline(line, glyphs, scale=scale)
        # Recolor to red (replace blue ink with red)
        arr = np.array(chunk).astype(np.int16)
        a = arr[..., 3]
        mask = a > 0
        arr[..., 0] = np.where(mask, RED_INK[0], arr[..., 0])
        arr[..., 1] = np.where(mask, RED_INK[1], arr[..., 1])
        arr[..., 2] = np.where(mask, RED_INK[2], arr[..., 2])
        red_chunk = Image.fromarray(arr.astype(np.uint8), 'RGBA')
        cw, ch = red_chunk.size
        x = W - cw - margin
        page_img_rgba = page_img.convert('RGBA')
        page_img_rgba.alpha_composite(red_chunk, (x, cur_y))
        page_img = page_img_rgba.convert('RGB')
        cur_y += ch + 6
    return page_img


def render_to_pdf(text, out_path='output/result.pdf', signature=None):
    """signature: list of strings to render in red at top-right of FIRST page only.
       e.g. signature=['Jayansh', 'Aryan', 'Jain']"""
    pages = render_pages(text)
    if signature:
        pages[0] = draw_signature(pages[0], signature)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    pages[0].save(out_path, 'PDF', resolution=200.0,
                  save_all=True, append_images=pages[1:])
    return out_path


if __name__ == '__main__':
    sample = ("Test ein paar Symbole:\n"
              "Matrix: A = [M]1,2,0;0,1,4;2,3,a[/M]\n"
              "Bruch: x₁ = [F]−24|3[/F] = −8\n"
              "Summe: [S]k=2|n[/S] bₖ cₖ\n"
              "Boxed: [B]d = 3[/B]\n")
    p = render_to_pdf(sample, 'output/sample.pdf')
    print('Wrote', p)
