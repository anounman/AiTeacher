"""
Extra fixed diagram types for logic gates, relational models, and big data.

These return (PIL.Image, baseline_y) just like the functions in diagrams.py.
"""

import math, random
from PIL import Image
from diagrams import aa_line, hand_line, hand_arrow, hand_circle, hand_rect, _ink


def _render_text(text, glyphs, scale=0.7):
    from render import render_text_chunk
    if not text:
        return Image.new('RGBA', (1, 1), (0, 0, 0, 0)), 0
    return render_text_chunk(text, glyphs, scale=scale, return_baseline=True)


def _centered_text(canvas, text, x, y, glyphs, scale=0.7):
    img, _ = _render_text(text, glyphs, scale)
    w, h = img.size
    canvas.alpha_composite(img, (int(x - w // 2), int(y - h // 2)))
    return w, h


def _box_with_text(canvas, text, x, y, w, h, glyphs, scale=0.65, fill=False):
    rect, _ = hand_rect(0, 0, w, h, width=2)
    canvas.alpha_composite(rect, (int(x - 6), int(y - 6)))
    tw, th = _centered_text(canvas, text, x + w // 2, y + h // 2, glyphs, scale)
    return tw, th


# ═══════════════════════════════════════════════════════════════════════
#  Logic gates
# ═══════════════════════════════════════════════════════════════════════

GATE_COLORS = {
    'AND':  'AND',
    'OR':   'OR',
    'NOT':  'NOT',
    'XOR':  'XOR',
    'NAND': 'NAND',
    'NOR':  'NOR',
}


def _and_shape(canvas, x, y, w, h, width=2):
    """D-shaped AND gate body on a canvas."""
    pts = [(x, y), (x, y + h)]
    n = 32
    for k in range(n + 1):
        t = k / n
        angle = -math.pi / 2 + math.pi * t
        cx = x + w * 0.45
        cy = y + h / 2
        r = h / 2
        pts.append((cx + r * math.cos(angle), cy + r * math.sin(angle)))
    aa_line(canvas, pts, width=width, joint=None)


def _or_shape(canvas, x, y, w, h, width=2):
    """Curved OR gate body."""
    n = 24
    pts = []
    for k in range(n // 2 + 1):
        t = k / (n // 2)
        px = x + w * 0.15 * (1 - math.cos(math.pi * t))
        py = y + h * t
        pts.append((px, py))
    for k in range(n // 2, n + 1):
        t = (k - n // 2) / (n // 2)
        angle = -math.pi / 2 + math.pi * t
        cx = x + w * 0.35
        cy = y + h / 2
        r = h / 2
        pts.append((cx + r * math.cos(angle), cy + r * math.sin(angle)))
    aa_line(canvas, pts, width=width, joint=None)


def _not_triangle(canvas, x, y, w, h, width=2):
    pts = [(x, y), (x + w * 0.7, y + h / 2), (x, y + h), (x, y)]
    aa_line(canvas, pts, width=width, joint=None)
    # bubble
    circ, _ = hand_circle((x + w * 0.85, y + h / 2), 6, width=2, segments=16)
    canvas.alpha_composite(circ, (int(x + w * 0.85 - circ.size[0] // 2), int(y + h / 2 - circ.size[1] // 2)))


def _xor_shape(canvas, x, y, w, h, width=2):
    _or_shape(canvas, x + 10, y, w - 10, h, width=width)
    n = 12
    pts = []
    for k in range(n + 1):
        t = k / n
        px = x + 8 + 6 * (1 - math.cos(math.pi * t))
        py = y + h * t
        pts.append((px, py))
    aa_line(canvas, pts, width=width, joint=None)


def _nand_shape(canvas, x, y, w, h, width=2):
    _and_shape(canvas, x, y, w - 15, h, width=width)
    circ, _ = hand_circle((x + w - 8, y + h / 2), 7, width=2, segments=16)
    canvas.alpha_composite(circ, (int(x + w - 8 - circ.size[0] // 2), int(y + h / 2 - circ.size[1] // 2)))


def _nor_shape(canvas, x, y, w, h, width=2):
    _or_shape(canvas, x, y, w - 15, h, width=width)
    circ, _ = hand_circle((x + w - 8, y + h / 2), 7, width=2, segments=16)
    canvas.alpha_composite(circ, (int(x + w - 8 - circ.size[0] // 2), int(y + h / 2 - circ.size[1] // 2)))


def draw_logic_gate(gate, inputs, output, truth_table=None, glyphs=None, scale=0.75):
    """Draw a single logic gate with inputs, output, and optional truth table.

    gate: 'AND' | 'OR' | 'NOT' | 'XOR' | 'NAND' | 'NOR'
    inputs: list of input labels (e.g. ['A','B'])
    output: output label (e.g. 'Y')
    truth_table: list of (input_tuple, output_value) rows
    """
    W, H = 420, 240
    if truth_table:
        H += 110
    canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0))

    body_x, body_y, body_w, body_h = 140, 50, 140, 90

    if gate == 'AND':
        _and_shape(canvas, body_x, body_y, body_w, body_h)
    elif gate == 'OR':
        _or_shape(canvas, body_x, body_y, body_w, body_h)
    elif gate == 'NOT':
        _not_triangle(canvas, body_x, body_y + 20, body_w, body_h - 40)
    elif gate == 'XOR':
        _xor_shape(canvas, body_x, body_y, body_w, body_h)
    elif gate == 'NAND':
        _nand_shape(canvas, body_x, body_y, body_w, body_h)
    elif gate == 'NOR':
        _nor_shape(canvas, body_x, body_y, body_w, body_h)
    else:
        _and_shape(canvas, body_x, body_y, body_w, body_h)

    # gate label
    _centered_text(canvas, gate, body_x + body_w / 2, body_y + body_h / 2, glyphs, scale=0.85)

    # input lines and labels
    n_in = max(1, len(inputs))
    for i, inp in enumerate(inputs):
        y = body_y + (i + 1) * body_h / (n_in + 1)
        hand_line(canvas, (body_x - 50, y), (body_x, y), width=2)
        _centered_text(canvas, inp, body_x - 70, y, glyphs, scale=0.7)

    # output line and label
    out_y = body_y + body_h / 2
    hand_arrow(canvas, (body_x + body_w, out_y), (body_x + body_w + 50, out_y), width=2)
    _centered_text(canvas, output, body_x + body_w + 70, out_y, glyphs, scale=0.7)

    # truth table
    if truth_table:
        table_y = body_y + body_h + 30
        cell_w = 40
        cell_h = 28
        start_x = W // 2 - (len(inputs) + 1) * cell_w // 2
        for r, row in enumerate(truth_table[:5]):
            for c, val in enumerate(row):
                xx = start_x + c * cell_w
                yy = table_y + r * cell_h
                _box_with_text(canvas, str(val), xx + 4, yy + 2, cell_w - 8, cell_h - 4, glyphs, scale=0.6)

    return canvas, H // 2


def draw_logic_circuit(gates, wires, inputs, outputs, glyphs=None, scale=0.7):
    """Draw a combinational logic circuit with proper gate symbols.

    gates: list of dicts: {'type': 'AND', 'x': 200, 'y': 100, 'label': 'G1'}
    wires: list of (from_label, to_label) or (from_label, to_label, (x,y) anchor)
    inputs: list of input node dicts {'label': 'A', 'x': 50, 'y': 80}
    outputs: list of output labels with gate labels
    """
    W, H = 640, 380
    canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0))

    # input labels
    for inp in inputs:
        _centered_text(canvas, inp['label'], inp['x'], inp['y'], glyphs, scale=0.7)

    # draw each gate with its proper symbol
    gate_meta = {}
    for g in gates:
        gt = g['type']
        gx, gy = g['x'], g['y']
        gw, gh = 80, 60
        gate_meta[g.get('label', '')] = {'x': gx, 'y': gy, 'w': gw, 'h': gh}
        if gt == 'AND':
            _and_shape(canvas, gx, gy, gw, gh)
        elif gt == 'OR':
            _or_shape(canvas, gx, gy, gw, gh)
        elif gt == 'XOR':
            _xor_shape(canvas, gx, gy, gw, gh)
        elif gt == 'NOT':
            _not_triangle(canvas, gx, gy + 10, gw, gh - 20)
        elif gt == 'NAND':
            _nand_shape(canvas, gx, gy, gw, gh)
        elif gt == 'NOR':
            _nor_shape(canvas, gx, gy, gw, gh)
        else:
            _and_shape(canvas, gx, gy, gw, gh)
        _centered_text(canvas, g.get('label', ''), gx + gw // 2, gy + gh + 12, glyphs, scale=0.5)

    # wires
    for w in wires:
        if len(w) == 3:
            frm, to, anchor = w
        else:
            frm, to = w
            anchor = None
        fx, fy = _find_port(inputs, gates, outputs, frm, side='out', meta=gate_meta)
        tx, ty = _find_port(inputs, gates, outputs, to, side='in', meta=gate_meta)
        if anchor:
            aa_line(canvas, [(fx, fy), anchor, (tx, ty)], width=2)
        else:
            # route with one bend to stay tidy
            mid_x = (fx + tx) / 2
            aa_line(canvas, [(fx, fy), (mid_x, fy), (mid_x, ty), (tx, ty)], width=2)

    # outputs
    for out in outputs:
        x, y = out['x'], out['y']
        hand_arrow(canvas, (x - 25, y), (x, y), width=2)
        _centered_text(canvas, out['label'], x + 25, y, glyphs, scale=0.7)

    return canvas, H // 2


# alias
# draw_logic_circuit is the primary name used by render.py


def _find_port(inputs, gates, outputs, label, side='in', meta=None):
    for inp in inputs:
        if inp['label'] == label:
            return (inp['x'] + (30 if side == 'out' else -10), inp['y'])
    for g in gates:
        if g.get('label') == label:
            x, y, w, h = g['x'], g['y'], 80, 60
            if meta and label in meta:
                m = meta[label]
                x, y, w, h = m['x'], m['y'], m['w'], m['h']
            return (x + w if side == 'out' else x, y + h // 2)
    for out in outputs:
        if out.get('label') == label:
            return (out['x'] - 30, out['y'])
    return (300, 180)


# ═══════════════════════════════════════════════════════════════════════
#  Relational models / databases
# ═══════════════════════════════════════════════════════════════════════

# Semantic palette shared by every auto-layout diagram. server.py preserves
# these through theme recoloring (see SEMANTIC_INKS there), so a diagram can
# use meaning-bearing color instead of one flat ink.
PALETTE = {
    'red': (196, 60, 50),
    'green': (30, 140, 80),
    'amber': (200, 140, 20),
    'violet': (140, 70, 180),
}


def _color_of(spec, default=None):
    """Resolve a spec's color name (or alert shorthand) to RGB."""
    if isinstance(spec, dict):
        if spec.get('alert') and not spec.get('color'):
            return PALETTE['red']
        name = spec.get('color')
    else:
        name = spec
    if isinstance(name, str):
        return PALETTE.get(name.strip().lower(), default)
    return default


def draw_sequence(actors, steps, glyphs=None, scale=0.7):
    """Sequence diagram with FULLY AUTOMATIC layout — the visual for anything
    happening over time between actors: transactions racing on shared data,
    protocols, syscalls, two friends in one Google Doc. The missing picture
    that used to come out as prose lines.

    actors: ["T1", "Database", "T2"] (list of names; dicts with 'name' ok)
    steps: ordered list of
      {'from': 'T1', 'to': 'Database', 'label': 'write X=100'}   arrow
      {'actor': 'T2', 'label': 'sees 100'}                       note on lane
      {'label': 'DIRTY READ — value never existed'}              banner row
      Any step may add 'alert': true → drawn red with an X marker.
    """
    names = [a['name'] if isinstance(a, dict) else str(a) for a in actors if a]
    names = [n for n in names if n]
    if not names:
        return Image.new('RGBA', (200, 60), (0, 0, 0, 0)), 30
    # Per-actor colors: {"name": "Bob", "color": "violet"} tints that lane.
    actor_color = {}
    for a in actors:
        if isinstance(a, dict) and a.get('name'):
            c = _color_of(a)
            if c:
                actor_color[str(a['name'])] = c

    ALERT = PALETTE['red']
    LABEL_S, ACTOR_S = 0.48, 0.58
    STEP_H, TOP_H, PAD = 52, 46, 16

    # Actor head boxes, sized to their names; lanes evenly spaced but never
    # closer than the widest label between adjacent lanes demands.
    heads = []
    for n in names:
        w = _render_text(n, glyphs, ACTOR_S)[0].size[0] + 24
        heads.append({'name': n, 'w': w})
    min_gap = 150
    for s in steps or []:
        lbl = str(s.get('label', ''))
        if s.get('from') and s.get('to') and lbl:
            lw = _render_text(lbl, glyphs, LABEL_S)[0].size[0]
            span = abs(names.index(str(s['from'])) - names.index(str(s['to']))) \
                if str(s.get('from')) in names and str(s.get('to')) in names else 1
            if span:
                min_gap = max(min_gap, lw // span + 40)
    x = PAD
    for h in heads:
        h['cx'] = x + max(h['w'], 40) // 2
        x = h['cx'] + max(min_gap // 2, h['w'] // 2 + 20)
    # Recompute evenly: centers at fixed pitch keeps arrows measurable.
    pitch = max(min_gap, max(h['w'] for h in heads) + 40)
    for i, h in enumerate(heads):
        h['cx'] = PAD + h['w'] // 2 if i == 0 else max(
            heads[i - 1]['cx'] + pitch, PAD + h['w'] // 2)
    by_name = {h['name']: h for h in heads}

    rows = [s for s in (steps or []) if s.get('label') or (s.get('from') and s.get('to'))]
    W = heads[-1]['cx'] + heads[-1]['w'] // 2 + PAD + 40
    # Banner rows and lane notes must fit: measure them into the width.
    for s in rows:
        if s.get('from') and s.get('to'):
            continue
        lw = _render_text(str(s.get('label', '')), glyphs, LABEL_S)[0].size[0]
        W = max(W, lw + PAD * 2 + 30)
    H = TOP_H + 18 + len(rows) * STEP_H + 24
    canvas = Image.new('RGBA', (int(W), int(H)), (0, 0, 0, 0))

    # Heads + lifelines.
    bottom = H - 12
    for h in heads:
        bw, bh = h['w'], 34
        tint = actor_color.get(h['name'])
        rect, _ = hand_rect(0, 0, bw, bh, width=2)
        if tint:
            rect = _tint(rect, tint)
        canvas.alpha_composite(rect, (int(h['cx'] - bw // 2 - 6), 6 - 6))
        head_img, _ = _render_text(h['name'], glyphs, ACTOR_S)
        if tint:
            head_img = _tint(head_img, tint)
        canvas.alpha_composite(
            head_img,
            (int(h['cx'] - head_img.size[0] // 2), int(6 + bh // 2 - head_img.size[1] // 2)),
        )
        if tint:
            _seq_arrow(canvas, (h['cx'], 6 + bh + 2), (h['cx'], bottom), width=1, rgb=tint,
                       head=False)
        else:
            hand_line(canvas, (h['cx'], 6 + bh + 2), (h['cx'], bottom), width=1)

    parts = [{'id': h['name'], 'x': h['cx'] - h['w'] // 2 - 6, 'y': 0,
              'w': h['w'] + 12, 'h': 46} for h in heads]

    # Steps, top to bottom. Numbered so the voice can reference them.
    y = TOP_H + 24
    n_step = 0
    for s in rows:
        alert = bool(s.get('alert'))
        # Explicit "color" wins; "alert" is shorthand for red; otherwise a step
        # INHERITS the acting actor's color, so a colored cast automatically
        # yields a followable colored story without the model repeating itself.
        inherited = actor_color.get(str(s.get('from') or s.get('actor') or ''))
        ink = _color_of(s, ALERT if alert else inherited)
        frm = by_name.get(str(s.get('from', '')))
        to = by_name.get(str(s.get('to', '')))
        lbl = str(s.get('label', ''))
        n_step += 1
        _centered_text(canvas, f"{n_step}.", PAD // 2 + 6, y, glyphs, 0.4)
        if frm and to and frm is not to:
            x1, x2 = frm['cx'], to['cx']
            _seq_arrow(canvas, (x1, y), (x2, y), rgb=ink)
            if lbl:
                img, _ = _render_text(lbl, glyphs, LABEL_S)
                if ink:
                    img = _tint(img, ink)
                canvas.alpha_composite(
                    img, (int((x1 + x2) / 2 - img.size[0] / 2), int(y - img.size[1] - 3)))
            if alert:
                _alert_x(canvas, max(x1, x2) + 16, y, rgb=ink or ALERT)
            parts.append({'id': f'step{n_step}',
                          'x': min(x1, x2), 'y': y - 26, 'w': abs(x2 - x1), 'h': 34})
        else:
            anchor = by_name.get(str(s.get('actor', ''))) or frm or to
            img, _ = _render_text(lbl, glyphs, LABEL_S)
            if ink:
                img = _tint(img, ink)
            if anchor:
                px = int(anchor['cx'] + 14)
                # A note on the rightmost lane goes on the LEFT of the
                # lifeline, so it can never run off the canvas.
                if px + img.size[0] > W - PAD:
                    px = int(anchor['cx'] - 14 - img.size[0])
            else:
                px = int(W / 2 - img.size[0] / 2)  # banner row, centered
            canvas.alpha_composite(img, (px, int(y - img.size[1] // 2)))
            if alert:
                _alert_x(canvas, px - 16, y, rgb=ink or ALERT)
            parts.append({'id': f'step{n_step}', 'x': px - 20, 'y': y - 20,
                          'w': img.size[0] + 40, 'h': 34})
        y += STEP_H

    canvas.info['parts'] = parts
    return canvas, int(H) // 2


def _seq_arrow(canvas, p1, p2, width=2, rgb=None, head=True):
    """Wobbly arrow, optionally colored. head=False draws a plain line
    (used for tinted lifelines)."""
    fill = (*rgb, 255) if rgb else None
    x1, y1 = p1
    x2, y2 = p2
    span = max(abs(x2 - x1), abs(y2 - y1))
    n = max(6, int(span / 24))
    pts = [(x1 + (x2 - x1) * k / n,
            y1 + (y2 - y1) * k / n + (random.uniform(-1.1, 1.1) if 0 < k < n else 0))
           for k in range(n + 1)]
    aa_line(canvas, pts, fill=fill, width=width)
    if not head:
        return
    sgn = 1 if x2 >= x1 else -1
    aa_line(canvas, [(x2 - sgn * 12, y2 - 6), (x2, y2), (x2 - sgn * 12, y2 + 6)],
            fill=fill, width=width)


def _tint(img, rgb):
    """Recolor an ink raster to rgb, preserving alpha."""
    px = img.load()
    out = img.copy()
    po = out.load()
    for yy in range(img.size[1]):
        for xx in range(img.size[0]):
            a = px[xx, yy][3]
            if a:
                po[xx, yy] = (rgb[0], rgb[1], rgb[2], a)
    return out


def _alert_x(canvas, x, y, r=8, rgb=None):
    """Small X marker in the step's color (red by default)."""
    fill = (*(rgb or PALETTE['red']), 255)
    aa_line(canvas, [(x - r, y - r), (x + r, y + r)], fill=fill, width=3)
    aa_line(canvas, [(x - r, y + r), (x + r, y - r)], fill=fill, width=3)


def draw_er_diagram(entities, relationships, glyphs=None, scale=0.7):
    """Draw an Entity-Relationship diagram with FULLY AUTOMATIC layout.

    Rewritten (local, keep on re-vendor): the original trusted model-supplied
    x/y and fixed 110px boxes — real lessons produced edges slicing through
    entities and labels wider than their shapes. Now any x/y in the spec is
    ignored; boxes are measured from their text, entities sit on one row, and
    each relationship gets its own routing band below, with elbow (vertical +
    horizontal) edges that cannot cross a box.

    entities: list of {'name': 'Student', 'attrs': ['student_id PK', 'name']}
    relationships: list of {'name': 'Enrolls', 'from': 'Student',
                            'to': 'Course', 'card': 'M:N', 'attrs': ['grade']}
    """
    entities = [e for e in entities if e.get('name')]
    if not entities:
        return Image.new('RGBA', (200, 60), (0, 0, 0, 0)), 30

    NAME_S, ATTR_S = 0.6, 0.48
    ROW_H, PAD_X, GAP_X = 19, 14, 70

    # Measure each entity box from its own text.
    boxes = []  # {name, x, y, w, h, cx}
    for e in entities:
        name = str(e['name'])
        attrs = [str(a) for a in e.get('attrs', [])]
        widths = [_render_text(name, glyphs, NAME_S)[0].size[0]]
        widths += [_render_text(a, glyphs, ATTR_S)[0].size[0] for a in attrs]
        w = max(widths) + PAD_X * 2
        h = 30 + (ROW_H * len(attrs) + 8 if attrs else 0)
        boxes.append({'name': name, 'attrs': attrs, 'w': w, 'h': h,
                      'color': _color_of(e)})

    # One row of entities, measured gaps; tops aligned.
    x = 16
    top = 12
    for b in boxes:
        b['x'] = x
        b['y'] = top
        b['cx'] = x + b['w'] // 2
        x += b['w'] + GAP_X
    row_bottom = top + max(b['h'] for b in boxes)
    by_name = {b['name']: b for b in boxes}

    # Each relationship routes in its own horizontal band below the row, so
    # no two relationship runs can collide and no edge enters a box.
    BAND_GAP, BAND_H = 46, 64
    rels = []
    drops = {b['name']: 0 for b in boxes}  # per-entity drop count → fan out
    for i, r in enumerate([r for r in relationships or [] if r.get('name')]):
        a = by_name.get(str(r.get('from', '')))
        b = by_name.get(str(r.get('to', '')))
        if a is None or b is None or a is b:
            continue
        name = str(r['name'])
        nw = _render_text(name, glyphs, 0.52)[0].size[0]
        dw = max(84, nw + 34)
        band_y = row_bottom + BAND_GAP + len(rels) * BAND_H
        ax = a['cx'] + (drops[a['name']] - 1) * 14
        bx = b['cx'] + (drops[b['name']] - 1) * 14
        drops[a['name']] += 1
        drops[b['name']] += 1
        rels.append({
            'name': name, 'a': a, 'b': b, 'ax': ax, 'bx': bx,
            'dx': (ax + bx) // 2, 'dy': band_y, 'dw': dw, 'dh': 40,
            'card': str(r.get('card', '') or ''),
            'attrs': [str(t) for t in r.get('attrs', [])],
            'color': _color_of(r),
        })

    W = max(x - GAP_X + 16, 240)
    H = (rels[-1]['dy'] + 70 if rels else row_bottom + 20)
    canvas = Image.new('RGBA', (int(W), int(H)), (0, 0, 0, 0))

    # Named part boxes so the board can point AT a piece of this diagram
    # (mark target "erd#Doctor"). Layout is ours, so these are exact.
    canvas.info['parts'] = (
        [{'id': b['name'], 'x': b['x'] - 6, 'y': b['y'] - 6,
          'w': b['w'] + 12, 'h': b['h'] + 12} for b in boxes]
        + [{'id': r['name'], 'x': r['dx'] - r['dw'] // 2, 'y': r['dy'] - r['dh'] // 2,
            'w': r['dw'], 'h': r['dh']} for r in rels]
    )

    # Entities: name row, separator, attribute rows (attribute text lives
    # INSIDE the box — measured above, so it always fits).
    for b in boxes:
        rect, _ = hand_rect(0, 0, b['w'], b['h'], width=2)
        if b['color']:
            rect = _tint(rect, b['color'])
        canvas.alpha_composite(rect, (int(b['x'] - 6), int(b['y'] - 6)))
        name_img, _ = _render_text(b['name'], glyphs, NAME_S)
        if b['color']:
            name_img = _tint(name_img, b['color'])
        canvas.alpha_composite(
            name_img,
            (int(b['cx'] - name_img.size[0] // 2), int(b['y'] + 14 - name_img.size[1] // 2)),
        )
        if b['attrs']:
            hand_line(canvas, (b['x'], b['y'] + 27), (b['x'] + b['w'], b['y'] + 27), width=1)
            for i, a in enumerate(b['attrs']):
                _centered_text(canvas, a, b['cx'], b['y'] + 38 + i * ROW_H, glyphs, ATTR_S)

    # Relationships: elbow edges down into the band, diamond at the middle.
    for r in rels:
        fill = (*r['color'], 255) if r['color'] else None
        left_tip = (r['dx'] - r['dw'] // 2, r['dy'])
        right_tip = (r['dx'] + r['dw'] // 2, r['dy'])
        for (ex, box, tip) in ((r['ax'], r['a'], left_tip), (r['bx'], r['b'], right_tip)):
            start = (ex, box['y'] + box['h'] + 2)
            if fill:
                _seq_arrow(canvas, start, (ex, r['dy']), width=2, rgb=r['color'], head=False)
                _seq_arrow(canvas, (ex, r['dy']), tip, width=2, rgb=r['color'], head=False)
            else:
                hand_line(canvas, start, (ex, r['dy']), width=2)
                hand_line(canvas, (ex, r['dy']), tip, width=2)
        d = [(r['dx'], r['dy'] - r['dh'] // 2), right_tip,
             (r['dx'], r['dy'] + r['dh'] // 2), left_tip,
             (r['dx'], r['dy'] - r['dh'] // 2)]
        aa_line(canvas, d, fill=fill, width=2)
        rel_img, _ = _render_text(r['name'], glyphs, 0.52)
        if r['color']:
            rel_img = _tint(rel_img, r['color'])
        canvas.alpha_composite(
            rel_img,
            (int(r['dx'] - rel_img.size[0] // 2), int(r['dy'] - rel_img.size[1] // 2)),
        )
        if r['card']:
            _centered_text(canvas, r['card'], r['dx'], r['dy'] + r['dh'] // 2 + 12, glyphs, 0.46)
        for i, t in enumerate(r['attrs']):
            _centered_text(canvas, '(' + t + ')', r['dx'] + r['dw'] // 2 + 30 + i * 60,
                           r['dy'] + r['dh'] // 2 + 12, glyphs, 0.46)

    return canvas, int(H) // 2


def draw_relational_schema(tables, relationships=None, glyphs=None, scale=0.7):
    """Draw relational schema tables.

    tables: list of {'name': 'Customers', 'cols': ['customer_id PK', 'name'], 'x': 30, 'y': 30}
    relationships: list of {'from': ('Customers','customer_id'), 'to': ('Orders','customer_id'), 'card': '1:N'}
    """
    W, H = 700, 320
    canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0))

    table_boxes = {}
    for t in tables:
        x, y = t['x'], t['y']
        name = t['name']
        cols = t.get('cols', [])
        row_h = 18
        h = 24 + len(cols) * row_h
        w = 130
        rect, _ = hand_rect(0, 0, w, h, width=2)
        canvas.alpha_composite(rect, (x - 6, y - 6))
        _centered_text(canvas, name, x + w // 2, y + 12, glyphs, scale=0.65)
        for i, c in enumerate(cols):
            _centered_text(canvas, c, x + w // 2, y + 28 + i * row_h, glyphs, scale=0.5)
        table_boxes[name] = (x, y, w, h)

    for rel in (relationships or []):
        ftab, fcol = rel['from']
        ttab, tcol = rel['to']
        if ftab in table_boxes and ttab in table_boxes:
            x1, y1, w1, h1 = table_boxes[ftab]
            x2, y2, w2, h2 = table_boxes[ttab]
            sx, sy = x1 + w1, y1 + h1 // 2
            ex, ey = x2, y2 + h2 // 2
            hand_line(canvas, (sx, sy), (ex, ey), width=2)
            mx, my = (sx + ex) // 2, (sy + ey) // 2
            _centered_text(canvas, rel.get('card', ''), mx, my - 10, glyphs, scale=0.5)

    return canvas, H // 2


def draw_sql_join_venn(join_type, labels, glyphs=None, scale=0.7):
    """Draw a Venn diagram for SQL joins.

    join_type: 'INNER' | 'LEFT' | 'RIGHT' | 'FULL' | 'EXCEPT'
    labels: [left_table, right_table]
    """
    W, H = 420, 280
    canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0))

    cx1, cx2, cy, r = 170, 250, 120, 70
    # two overlapping circles
    c1, _ = hand_circle((cx1, cy), r, width=2, segments=32)
    c2, _ = hand_circle((cx2, cy), r, width=2, segments=32)
    canvas.alpha_composite(c1, (cx1 - c1.size[0] // 2, cy - c1.size[1] // 2))
    canvas.alpha_composite(c2, (cx2 - c2.size[0] // 2, cy - c2.size[1] // 2))

    _centered_text(canvas, labels[0], cx1 - r // 2, cy, glyphs, scale=0.7)
    _centered_text(canvas, labels[1], cx2 + r // 2, cy, glyphs, scale=0.7)

    # label overlap
    if join_type in ('INNER', 'FULL', 'LEFT', 'RIGHT'):
        overlap_text = join_type
    else:
        overlap_text = ''
    _centered_text(canvas, overlap_text, (cx1 + cx2) // 2, cy, glyphs, scale=0.6)

    _centered_text(canvas, f"{join_type} JOIN", W // 2, 30, glyphs, scale=0.8)
    return canvas, H // 2


# ═══════════════════════════════════════════════════════════════════════
#  Big data / distributed systems
# ═══════════════════════════════════════════════════════════════════════

def draw_mapreduce(input_splits, map_output, reduce_output, glyphs=None, scale=0.65):
    """Draw MapReduce data flow.

    input_splits: list of input text strings
    map_output: list of lists of (key,value) strings per mapper
    reduce_output: list of (key, count) strings
    """
    W, H = 640, 360
    canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0))

    n = len(input_splits)
    col_w = W // (n + 1)
    box_w, box_h = 70, 30

    # inputs
    for i, inp in enumerate(input_splits):
        x = 40 + i * col_w
        y = 30
        _box_with_text(canvas, f"Input {i+1}", x, y, box_w, box_h, glyphs, scale=0.55)
        _centered_text(canvas, inp[:20], x + box_w // 2, y + box_h + 10, glyphs, scale=0.45)
        hand_line(canvas, (x + box_w // 2, y + box_h), (x + box_w // 2, y + box_h + 30), width=2)

    # mappers
    for i in range(n):
        x = 40 + i * col_w
        y = 100
        _box_with_text(canvas, f"Map", x, y, box_w, box_h, glyphs, scale=0.6)
        if i < len(map_output):
            txt = ' '.join(map_output[i][:3])
            _centered_text(canvas, txt, x + box_w // 2, y + box_h + 12, glyphs, scale=0.4)
        hand_line(canvas, (x + box_w // 2, y + box_h), (W // 2, 170), width=2)

    # shuffle/sort
    _box_with_text(canvas, "Shuffle & Sort", W // 2 - 55, 170, 110, 30, glyphs, scale=0.6)
    hand_line(canvas, (W // 2, 200), (W // 2, 230), width=2)

    # reducers
    red_x = [W // 2 - 90, W // 2 + 20]
    for i, rx in enumerate(red_x):
        _box_with_text(canvas, f"Reduce", rx, 230, box_w, box_h, glyphs, scale=0.6)
        if i < len(reduce_output):
            _centered_text(canvas, reduce_output[i], rx + box_w // 2, 230 + box_h + 12, glyphs, scale=0.5)

    return canvas, H // 2


def draw_cap_theorem(corners, examples, glyphs=None, scale=0.75):
    """Draw CAP theorem triangle.

    corners: dict {'C': (x,y), 'A': (x,y), 'P': (x,y)}
    examples: list of {'name': 'HBase', 'x': x, 'y': y, 'type': 'CP'}
    """
    W, H = 420, 300
    canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0))

    C = corners.get('C', (210, 50))
    A = corners.get('A', (80, 230))
    P = corners.get('P', (340, 230))

    aa_line(canvas, [C, A, P, C], width=2)
    for name, pt in [('Consistency', C), ('Availability', A), ('Partition Tolerance', P)]:
        circ, _ = hand_circle(pt, 22, width=2, segments=24)
        canvas.alpha_composite(circ, (pt[0] - circ.size[0] // 2, pt[1] - circ.size[1] // 2))
        _centered_text(canvas, name[0], pt[0], pt[1], glyphs, scale=0.85)
        _centered_text(canvas, name, pt[0], pt[1] + 34, glyphs, scale=0.55)

    for ex in examples:
        _centered_text(canvas, ex['name'], ex['x'], ex['y'], glyphs, scale=0.55)
        dot, _ = hand_circle((ex['x'], ex['y']), 3, width=1, segments=8)
        canvas.alpha_composite(dot, (ex['x'] - dot.size[0] // 2, ex['y'] - 8 - dot.size[1] // 2))

    _centered_text(canvas, "CAP Theorem", W // 2, 20, glyphs, scale=0.8)
    return canvas, H // 2


def draw_database_sharding(shards, routing_key, glyphs=None, scale=0.65):
    """Draw database sharding architecture.

    shards: list of {'name': 'Shard 1', 'range': '0-249'}
    routing_key: string
    """
    W, H = 560, 240
    canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0))

    _box_with_text(canvas, "Monolithic DB", W // 2 - 60, 20, 120, 30, glyphs, scale=0.6)
    hand_line(canvas, (W // 2, 50), (W // 2, 80), width=2)
    _box_with_text(canvas, "Router", W // 2 - 40, 80, 80, 28, glyphs, scale=0.6)

    n = len(shards)
    shard_w = (W - 80) // n
    for i, sh in enumerate(shards):
        x = 40 + i * shard_w
        y = 140
        _box_with_text(canvas, sh['name'], x + 10, y, shard_w - 20, 40, glyphs, scale=0.6)
        _centered_text(canvas, sh['range'], x + shard_w // 2, y + 52, glyphs, scale=0.5)
        hand_line(canvas, (W // 2, 108), (x + shard_w // 2, y), width=2)

    _centered_text(canvas, f"WHERE {routing_key}=?", W // 2, 120, glyphs, scale=0.55)
    return canvas, H // 2


def draw_consistent_hashing(nodes, keys, new_node=None, glyphs=None, scale=0.65):
    """Draw consistent hashing ring.

    nodes: list of {'name': 'A', 'pos': 0.2}
    keys: list of {'name': 'k1', 'pos': 0.15}
    new_node: dict or None
    """
    W, H = 420, 300
    canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    cx, cy, r = W // 2, H // 2 + 10, 90

    circ, _ = hand_circle((cx, cy), r, width=2, segments=48)
    canvas.alpha_composite(circ, (cx - circ.size[0] // 2, cy - circ.size[1] // 2))

    def place(pos):
        ang = -math.pi / 2 + 2 * math.pi * pos
        return (cx + r * math.cos(ang), cy + r * math.sin(ang))

    for n in nodes:
        x, y = place(n['pos'])
        _centered_text(canvas, n['name'], int(x), int(y), glyphs, scale=0.7)

    for k in keys:
        x, y = place(k['pos'])
        dot, _ = hand_circle((int(x), int(y)), 3, width=1, segments=8)
        canvas.alpha_composite(dot, (int(x) - dot.size[0] // 2, int(y) - dot.size[1] // 2))

    if new_node:
        x, y = place(new_node['pos'])
        circ2, _ = hand_circle((int(x), int(y)), 12, width=2, segments=16)
        canvas.alpha_composite(circ2, (int(x) - circ2.size[0] // 2, int(y) - circ2.size[1] // 2))
        _centered_text(canvas, new_node['name'], int(x), int(y) - 20, glyphs, scale=0.65)

    _centered_text(canvas, "Consistent Hashing", W // 2, 30, glyphs, scale=0.75)
    return canvas, H // 2


def draw_hdfs_architecture(name_node, data_nodes, glyphs=None, scale=0.65):
    """Draw HDFS architecture: NameNode + DataNodes.

    name_node: dict {'name': 'NameNode'}
    data_nodes: list of {'name': 'DataNode 1', 'blocks': ['b1','b2']}
    """
    W, H = 560, 260
    canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0))

    _box_with_text(canvas, name_node['name'], 40, 30, 110, 40, glyphs, scale=0.7)

    n = len(data_nodes)
    col_w = (W - 80) // n
    for i, dn in enumerate(data_nodes):
        x = 40 + i * col_w
        y = 130
        _box_with_text(canvas, dn['name'], x + 5, y, col_w - 10, 40, glyphs, scale=0.6)
        blocks = dn.get('blocks', [])
        bx = x + 5
        for j, b in enumerate(blocks[:4]):
            _box_with_text(canvas, b, bx + j * 28, y + 50, 24, 20, glyphs, scale=0.45)
        hand_line(canvas, (95, 70), (x + col_w // 2, y), width=2)

    return canvas, H // 2


def draw_kafka_pipeline(producers, topic, consumers, glyphs=None, scale=0.65):
    """Draw Kafka streaming pipeline.

    producers: list of strings
    topic: string
    consumers: list of strings
    """
    W, H = 560, 220
    canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0))

    n = len(producers)
    col_w = (W - 100) // max(n, len(consumers), 3)

    for i, p in enumerate(producers):
        x = 40 + i * col_w
        _box_with_text(canvas, p, x, 30, col_w - 10, 30, glyphs, scale=0.55)
        hand_arrow(canvas, (x + col_w // 2, 60), (W // 2, 100), width=2)

    _box_with_text(canvas, topic, W // 2 - 60, 90, 120, 40, glyphs, scale=0.7)

    for i, c in enumerate(consumers):
        x = 40 + i * col_w
        _box_with_text(canvas, c, x, 160, col_w - 10, 30, glyphs, scale=0.55)
        hand_arrow(canvas, (W // 2, 130), (x + col_w // 2, 160), width=2)

    return canvas, H // 2


def draw_spark_lineage(rdds, stages, glyphs=None, scale=0.65):
    """Draw Spark RDD lineage graph.

    rdds: list of {'name': 'RDD1', 'x': 50, 'y': 80}
    stages: list of {'name': 'Stage 1', 'rdds': ['RDD1','RDD2']}
    """
    W, H = 560, 260
    canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0))

    pos = {}
    for r in rdds:
        x, y = r['x'], r['y']
        _box_with_text(canvas, r['name'], x, y, 80, 30, glyphs, scale=0.6)
        pos[r['name']] = (x + 40, y + 30)

    for s in stages:
        rdd_names = s['rdds']
        if rdd_names:
            first = rdd_names[0]
            last = rdd_names[-1]
            if first in pos and last in pos:
                sx, sy = pos[first]
                ex, ey = pos[last]
                mx = (sx + ex) // 2
                _box_with_text(canvas, s['name'], mx - 40, (sy + ey) // 2 - 15, 80, 24, glyphs, scale=0.55)

    for i in range(len(rdds) - 1):
        x1, y1 = pos[rdds[i]['name']]
        x2, y2 = pos[rdds[i+1]['name']]
        hand_arrow(canvas, (x1 + 40, y1 - 15), (x2 - 40, y2 - 15), width=2)

    return canvas, H // 2
