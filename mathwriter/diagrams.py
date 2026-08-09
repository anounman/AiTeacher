"""
Hand-drawn diagram primitives for mathwriter.

Provides procedural drawing functions that produce RGBA images in the same
hand-drawn style as the rest of the renderer — wobbly lines, slight jitter,
Apple Pencil blue ink. All functions return (PIL.Image, baseline_y).

Primitives:
  - hand_circle, hand_rect, hand_line, hand_arrow
  - draw_node (circle with label)
  - draw_tree (auto-layout binary tree)
  - draw_array (boxes with indices and values)
  - draw_dp_table (2D grid with values, optional arrows)
  - draw_linked_list (nodes with arrows)
  - draw_graph (positioned nodes with edges)
  - draw_stack, draw_queue
"""

import math, random
from PIL import Image, ImageDraw
import numpy as np

# Match the renderer's ink color
INK_RGB = (15, 70, 180)
AA_SS = 3  # super-sampling factor


def _ink():
    return (*INK_RGB, 255)


def aa_line(target_img, pts, fill=None, width=3, joint='curve'):
    """Anti-aliased polyline — same as render.py's aa_line."""
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
    if joint:
        td.line(ss_pts, fill=fill, width=max(1, width * AA_SS), joint=joint)
    else:
        td.line(ss_pts, fill=fill, width=max(1, width * AA_SS))
    small = temp.resize((bbox_w, bbox_h), Image.LANCZOS)
    target_img.alpha_composite(small, (int(min_x - pad), int(min_y - pad)))


def _hand_segment(p1, p2, segments=10, jitter=0.7, overshoot=(0.0, 2.5),
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


def hand_line(img, p1, p2, width=3, jitter=0.7):
    """Draw a single wobbly line on an image."""
    pts = _hand_segment(p1, p2, jitter=jitter)
    aa_line(img, pts, width=width)


def hand_arrow(img, p1, p2, width=3):
    """Draw a wobbly line with an arrowhead at p2."""
    pts = _hand_segment(p1, p2, jitter=0.6, overshoot=(0, 0), trim_end=True)
    aa_line(img, pts, width=width)
    # Arrowhead
    tip = pts[-1]
    head_len = max(8, int(math.hypot(p2[0]-p1[0], p2[1]-p1[1]) * 0.15))
    dx = p2[0] - p1[0]
    dy = p2[1] - p1[1]
    length = max(1.0, math.hypot(dx, dy))
    ux, uy = dx / length, dy / length
    px, py = -uy, ux
    head_ang = 0.45
    upper = (tip[0] - head_len * (ux * math.cos(head_ang) - px * math.sin(head_ang)),
             tip[1] - head_len * (uy * math.cos(head_ang) - py * math.sin(head_ang)))
    lower = (tip[0] - head_len * (ux * math.cos(head_ang) + px * math.sin(head_ang)),
             tip[1] - head_len * (uy * math.cos(head_ang) + py * math.sin(head_ang)))
    head_pts = [upper, tip, lower]
    aa_line(img, head_pts, width=width)


def hand_circle(center, radius, width=3, segments=32):
    """Create a standalone hand-drawn circle as an RGBA image. Returns (img, baseline_y)."""
    cx, cy = center
    pad = radius + width * 2 + 4
    size = 2 * pad
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    pts = []
    for k in range(segments + 1):
        angle = 2 * math.pi * k / segments
        r = radius + random.uniform(-1.5, 1.5)
        x = pad + r * math.cos(angle)
        y = pad + r * math.sin(angle)
        pts.append((x, y))
    # Close the loop
    pts.append(pts[0])
    aa_line(img, pts, width=width, joint='curve')
    return img, pad


def hand_rect(x, y, w, h, width=3):
    """Draw a hand-drawn rectangle. Returns (img, baseline_y)."""
    pad = width * 2 + 6
    img = Image.new('RGBA', (w + 2 * pad, h + 2 * pad), (0, 0, 0, 0))
    j = 1.5
    p_tl = (pad + random.uniform(-j, j), pad + random.uniform(-j, j))
    p_tr = (pad + w + random.uniform(-j, j), pad + random.uniform(-j, j))
    p_br = (pad + w + random.uniform(-j, j), pad + h + random.uniform(-j, j))
    p_bl = (pad + random.uniform(-j, j), pad + h + random.uniform(-j, j))
    close = (p_tl[0] + random.uniform(1, 4), p_tl[1] + random.uniform(-0.5, 1.5))
    rect_pts = [p_tl, p_tr, p_br, p_bl, p_tl, close]
    aa_line(img, rect_pts, width=width)
    return img, pad + h // 2


def draw_node(label_img, cx, cy, radius=22, width=3):
    """Draw a circle node with a label centered inside. Returns (img, baseline_y)."""
    # label_img is a pre-rendered RGBA image of the label text
    lw, lh = label_img.size
    # Make canvas big enough for circle + label
    pad = radius + width * 2 + 8
    size = 2 * pad
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    # Draw circle
    pts = []
    segments = 32
    for k in range(segments + 1):
        angle = 2 * math.pi * k / segments
        r = radius + random.uniform(-1.2, 1.2)
        x = pad + r * math.cos(angle)
        y = pad + r * math.sin(angle)
        pts.append((x, y))
    pts.append(pts[0])
    aa_line(img, pts, width=width)
    # Paste label centered
    lx = pad - lw // 2
    ly = pad - lh // 2
    img.alpha_composite(label_img, (lx, ly))
    return img, pad


def draw_tree(spec_text, glyphs, scale=0.75):
    """Auto-layout a binary tree from a simple spec.

    Spec format (one node per line):
        value:left_child:right_child
    Lines starting with # are comments.
    Root is the first node listed.

    Example:
        5:3:8
        3:1:4
        8:7:9
        1:_:_
        4:_:_
        7:_:_
        9:_:_
    """
    from render import render_text_chunk

    lines = [l.strip() for l in spec_text.strip().split('\n') if l.strip() and not l.strip().startswith('#')]
    if not lines:
        return Image.new('RGBA', (1, 1), (0, 0, 0, 0)), 0

    # Parse nodes
    nodes = {}
    children = {}  # parent -> [left, right]
    for line in lines:
        parts = line.split(':')
        val = parts[0].strip()
        left = parts[1].strip() if len(parts) > 1 else '_'
        right = parts[2].strip() if len(parts) > 2 else '_'
        nodes[val] = True
        children[val] = (left if left != '_' else None, right if right != '_' else None)

    root_val = lines[0].split(':')[0].strip()

    # Render all labels
    labels = {}
    for val in nodes:
        lbl, _ = render_text_chunk(val, glyphs, scale=scale, return_baseline=True)
        labels[val] = lbl

    # Compute positions using a simple recursive layout
    NODE_RADIUS = 20
    H_SPACING = 60
    V_SPACING = 80
    MARGIN = 30

    # First pass: compute subtree widths
    def subtree_width(val, depth=0):
        if val is None:
            return 0
        left, right = children.get(val, (None, None))
        lw = subtree_width(left, depth + 1)
        rw = subtree_width(right, depth + 1)
        return max(lw + rw, H_SPACING)

    # Second pass: assign positions
    positions = {}

    def assign_pos(val, x, y, depth=0):
        if val is None:
            return
        positions[val] = (x, y)
        left, right = children.get(val, (None, None))
        if left:
            lw = subtree_width(left, depth + 1)
            assign_pos(left, x - lw // 2, y + V_SPACING, depth + 1)
        if right:
            rw = subtree_width(right, depth + 1)
            assign_pos(right, x + rw // 2, y + V_SPACING, depth + 1)

    total_w = subtree_width(root_val)
    assign_pos(root_val, total_w // 2 + MARGIN, MARGIN + NODE_RADIUS)

    # Compute canvas size
    max_x = max(p[0] for p in positions.values()) + NODE_RADIUS + MARGIN
    max_y = max(p[1] for p in positions.values()) + NODE_RADIUS + MARGIN
    canvas_w = int(max_x + 20)
    canvas_h = int(max_y + 20)
    canvas = Image.new('RGBA', (canvas_w, canvas_h), (0, 0, 0, 0))

    # Draw edges first (behind nodes)
    for val, (left, right) in children.items():
        if val not in positions:
            continue
        px, py = positions[val]
        # Edge from bottom of parent
        edge_start = (px, py + NODE_RADIUS)
        for child in [left, right]:
            if child and child in positions:
                cx, cy = positions[child]
                edge_end = (cx, cy - NODE_RADIUS)
                hand_line(canvas, edge_start, edge_end, width=2, jitter=0.8)

    # Draw nodes
    for val, (px, py) in positions.items():
        node_img, _ = draw_node(labels[val], px, py, radius=NODE_RADIUS, width=2)
        # Composite node onto canvas
        nw, nh = node_img.size
        nx = px - nw // 2
        ny = py - nh // 2
        canvas.alpha_composite(node_img, (nx, ny))

    return canvas, canvas_h // 2


def draw_array(values, indices=None, glyphs=None, scale=0.75, highlight=None):
    """Draw an array as boxes with values and optional indices.

    values: list of strings (the values in each cell)
    indices: list of strings (index labels below each cell), optional
    highlight: set of indices to highlight (draw with different style)
    """
    from render import render_text_chunk

    CELL_W = 48
    CELL_H = 40
    GAP = 2
    MARGIN = 20

    n = len(values)
    total_w = n * (CELL_W + GAP) + MARGIN * 2
    idx_h = 24 if indices else 0
    total_h = CELL_H + idx_h + MARGIN * 2 + 10
    canvas = Image.new('RGBA', (total_w, total_h), (0, 0, 0, 0))

    for i, val in enumerate(values):
        x = MARGIN + i * (CELL_W + GAP)
        y = MARGIN

        # Draw cell rectangle
        rect_img, _ = hand_rect(0, 0, CELL_W, CELL_H, width=2)
        canvas.alpha_composite(rect_img, (x - 6, y - 6))

        # Draw value centered in cell
        if glyphs and val:
            lbl, lbl_bl = render_text_chunk(val, glyphs, scale=scale, return_baseline=True)
            lw, lh = lbl.size
            lx = x + (CELL_W - lw) // 2
            ly = y + (CELL_H - lh) // 2
            canvas.alpha_composite(lbl, (lx, ly))

        # Draw index below
        if indices and i < len(indices) and indices[i]:
            idx_lbl, _ = render_text_chunk(indices[i], glyphs, scale=scale * 0.7, return_baseline=True)
            iw, ih = idx_lbl.size
            ix = x + (CELL_W - iw) // 2
            iy = y + CELL_H + 4
            canvas.alpha_composite(idx_lbl, (ix, iy))

        # Highlight
        if highlight and i in highlight:
            # Draw a small star or underline
            star_y = y + CELL_H + idx_h + 2
            hand_line(canvas, (x + 4, star_y), (x + CELL_W - 4, star_y), width=2, jitter=0.5)

    return canvas, total_h // 2


def draw_dp_table(rows, row_labels=None, col_labels=None, glyphs=None, scale=0.7,
                  arrows=None):
    """Draw a DP table (2D grid) with optional row/col labels and dependency arrows.

    rows: list of lists of strings (cell values)
    row_labels: list of strings for row headers
    col_labels: list of strings for column headers
    arrows: list of (from_row, from_col, to_row, to_col) for dependency arrows
    """
    from render import render_text_chunk

    CELL_W = 52
    CELL_H = 38
    GAP = 2
    MARGIN = 24
    LABEL_W = 40 if row_labels else 0
    HEADER_H = 28 if col_labels else 0

    n_rows = len(rows)
    n_cols = max(len(r) for r in rows) if rows else 0

    total_w = LABEL_W + n_cols * (CELL_W + GAP) + MARGIN * 2
    total_h = HEADER_H + n_rows * (CELL_H + GAP) + MARGIN * 2 + 10
    canvas = Image.new('RGBA', (total_w, total_h), (0, 0, 0, 0))

    # Column headers
    if col_labels:
        for j, lbl in enumerate(col_labels):
            if j >= n_cols:
                break
            x = MARGIN + LABEL_W + j * (CELL_W + GAP)
            y = MARGIN
            cl, _ = render_text_chunk(lbl, glyphs, scale=scale * 0.7, return_baseline=True)
            cw, ch = cl.size
            canvas.alpha_composite(cl, (x + (CELL_W - cw) // 2, y + (HEADER_H - ch) // 2))

    # Row labels
    if row_labels:
        for i, lbl in enumerate(row_labels):
            if i >= n_rows:
                break
            x = MARGIN
            y = MARGIN + HEADER_H + i * (CELL_H + GAP)
            rl, _ = render_text_chunk(lbl, glyphs, scale=scale * 0.7, return_baseline=True)
            rw, rh = rl.size
            canvas.alpha_composite(rl, (x + (LABEL_W - rw) // 2, y + (CELL_H - rh) // 2))

    # Cells
    for i, row in enumerate(rows):
        for j, val in enumerate(row):
            if j >= n_cols:
                break
            x = MARGIN + LABEL_W + j * (CELL_W + GAP)
            y = MARGIN + HEADER_H + i * (CELL_H + GAP)

            rect_img, _ = hand_rect(0, 0, CELL_W, CELL_H, width=2)
            canvas.alpha_composite(rect_img, (x - 6, y - 6))

            if glyphs and val:
                vl, _ = render_text_chunk(val, glyphs, scale=scale, return_baseline=True)
                vw, vh = vl.size
                canvas.alpha_composite(vl, (x + (CELL_W - vw) // 2, y + (CELL_H - vh) // 2))

    # Arrows
    if arrows:
        for (fr, fc, tr, tc) in arrows:
            fx = MARGIN + LABEL_W + fc * (CELL_W + GAP) + CELL_W // 2
            fy = MARGIN + HEADER_H + fr * (CELL_H + GAP) + CELL_H // 2
            tx = MARGIN + LABEL_W + tc * (CELL_W + GAP) + CELL_W // 2
            ty = MARGIN + HEADER_H + tr * (CELL_H + GAP) + CELL_H // 2
            hand_arrow(canvas, (fx, fy), (tx, ty), width=2)

    return canvas, total_h // 2


def draw_linked_list(values, glyphs=None, scale=0.75, horizontal=True):
    """Draw a linked list: nodes with arrows between them.

    values: list of strings (node values). Last value can be 'null' or 'NULL'.
    """
    from render import render_text_chunk

    NODE_W = 56
    NODE_H = 36
    ARROW_GAP = 28
    MARGIN = 20

    n = len(values)
    if horizontal:
        total_w = n * NODE_W + (n - 1) * ARROW_GAP + MARGIN * 2
        total_h = NODE_H + MARGIN * 2 + 20
    else:
        total_w = NODE_W + MARGIN * 2 + 20
        total_h = n * NODE_H + (n - 1) * ARROW_GAP + MARGIN * 2

    canvas = Image.new('RGBA', (total_w, total_h), (0, 0, 0, 0))

    for i, val in enumerate(values):
        if horizontal:
            x = MARGIN + i * (NODE_W + ARROW_GAP)
            y = MARGIN + 10
        else:
            x = MARGIN + 10
            y = MARGIN + i * (NODE_H + ARROW_GAP)

        # Split box into value part and next-pointer part
        rect_img, _ = hand_rect(0, 0, NODE_W, NODE_H, width=2)
        canvas.alpha_composite(rect_img, (x - 6, y - 6))

        # Divider line inside node
        div_x = x + NODE_W - 16
        hand_line(canvas, (div_x, y), (div_x, y + NODE_H), width=1, jitter=0.3)

        # Value text
        if glyphs and val:
            display_val = val if val.upper() != 'NULL' else 'null'
            vl, _ = render_text_chunk(display_val, glyphs, scale=scale, return_baseline=True)
            vw, vh = vl.size
            canvas.alpha_composite(vl, (x + (NODE_W - 20 - vw) // 2, y + (NODE_H - vh) // 2))

        # Next pointer (small dot or cross for null)
        if val.upper() == 'NULL':
            # Draw X in the pointer box
            px = div_x + 8
            py = y + NODE_H // 2
            hand_line(canvas, (px - 4, py - 4), (px + 4, py + 4), width=1, jitter=0.2)
            hand_line(canvas, (px - 4, py + 4), (px + 4, py - 4), width=1, jitter=0.2)
        else:
            # Small dot
            dot_cx = div_x + 8
            dot_cy = y + NODE_H // 2
            dot_img, _ = hand_circle((dot_cx, dot_cy), 3, width=1, segments=12)
            canvas.alpha_composite(dot_img, (dot_cx - dot_img.size[0]//2, dot_cy - dot_img.size[1]//2))

        # Arrow to next
        if i < n - 1:
            if horizontal:
                arrow_start = (x + NODE_W, y + NODE_H // 2)
                arrow_end = (x + NODE_W + ARROW_GAP, y + NODE_H // 2)
            else:
                arrow_start = (x + NODE_W // 2, y + NODE_H)
                arrow_end = (x + NODE_W // 2, y + NODE_H + ARROW_GAP)
            hand_arrow(canvas, arrow_start, arrow_end, width=2)

    return canvas, total_h // 2


def draw_graph(nodes_spec, edges_spec, glyphs=None, scale=0.7):
    """Draw a graph with positioned nodes and edges.

    nodes_spec: list of (label, x, y) tuples
    edges_spec: list of (from_label, to_label, weight) tuples (weight optional)
    """
    from render import render_text_chunk

    NODE_RADIUS = 20
    MARGIN = 30

    # Build position map
    pos = {}
    for label, x, y in nodes_spec:
        pos[label] = (x, y)

    # Compute canvas size
    max_x = max(p[0] for p in pos.values()) + NODE_RADIUS + MARGIN
    max_y = max(p[1] for p in pos.values()) + NODE_RADIUS + MARGIN
    canvas_w = int(max_x + 20)
    canvas_h = int(max_y + 20)
    canvas = Image.new('RGBA', (canvas_w, canvas_h), (0, 0, 0, 0))

    # Render labels
    labels = {}
    for label in pos:
        lbl, _ = render_text_chunk(label, glyphs, scale=scale, return_baseline=True)
        labels[label] = lbl

    # Draw edges
    for edge in edges_spec:
        if len(edge) == 2:
            frm, to = edge
            weight = None
        else:
            frm, to, weight = edge
        if frm not in pos or to not in pos:
            continue
        fx, fy = pos[frm]
        tx, ty = pos[to]
        # Draw from edge of source circle to edge of target circle
        dx = tx - fx
        dy = ty - fy
        dist = max(1.0, math.hypot(dx, dy))
        ux, uy = dx / dist, dy / dist
        start = (fx + ux * NODE_RADIUS, fy + uy * NODE_RADIUS)
        end = (tx - ux * NODE_RADIUS, ty - uy * NODE_RADIUS)
        if weight:
            hand_arrow(canvas, start, end, width=2)
            # Draw weight label near midpoint
            mid_x = (start[0] + end[0]) / 2
            mid_y = (start[1] + end[1]) / 2 - 8
            wl, _ = render_text_chunk(str(weight), glyphs, scale=scale * 0.6, return_baseline=True)
            ww, wh = wl.size
            canvas.alpha_composite(wl, (int(mid_x - ww // 2), int(mid_y - wh // 2)))
        else:
            hand_arrow(canvas, start, end, width=2)

    # Draw nodes
    for label, (px, py) in pos.items():
        node_img, _ = draw_node(labels[label], px, py, radius=NODE_RADIUS, width=2)
        nw, nh = node_img.size
        canvas.alpha_composite(node_img, (px - nw // 2, py - nh // 2))

    return canvas, canvas_h // 2


def draw_stack(items, glyphs=None, scale=0.75, direction='vertical'):
    """Draw a stack (vertical or horizontal boxes with push/pop indicators)."""
    from render import render_text_chunk

    CELL_W = 60
    CELL_H = 34
    GAP = 3
    MARGIN = 24

    n = len(items)
    if direction == 'vertical':
        total_w = CELL_W + MARGIN * 2 + 20
        total_h = n * (CELL_H + GAP) + MARGIN * 2 + 30
    else:
        total_w = n * (CELL_W + GAP) + MARGIN * 2 + 20
        total_h = CELL_H + MARGIN * 2 + 30

    canvas = Image.new('RGBA', (total_w, total_h), (0, 0, 0, 0))

    for i, item in enumerate(items):
        if direction == 'vertical':
            x = MARGIN + 10
            y = MARGIN + 20 + (n - 1 - i) * (CELL_H + GAP)  # bottom-up
        else:
            x = MARGIN + 10 + i * (CELL_W + GAP)
            y = MARGIN + 20

        rect_img, _ = hand_rect(0, 0, CELL_W, CELL_H, width=2)
        canvas.alpha_composite(rect_img, (x - 6, y - 6))

        if glyphs and item:
            il, _ = render_text_chunk(item, glyphs, scale=scale, return_baseline=True)
            iw, ih = il.size
            canvas.alpha_composite(il, (x + (CELL_W - iw) // 2, y + (CELL_H - ih) // 2))

    # Draw "top" indicator arrow
    if direction == 'vertical' and n > 0:
        top_x = MARGIN + 10 + CELL_W + 8
        top_y = MARGIN + 20 + (n - 1) * (CELL_H + GAP) + CELL_H // 2
        hand_line(canvas, (top_x, top_y), (top_x + 20, top_y), width=2, jitter=0.5)
        # "top" label
        if glyphs:
            tl, _ = render_text_chunk("top", glyphs, scale=scale * 0.6, return_baseline=True)
            canvas.alpha_composite(tl, (top_x + 24, top_y - tl.size[1] // 2))

    return canvas, total_h // 2


def draw_queue(items, glyphs=None, scale=0.75):
    """Draw a queue (horizontal boxes with front/rear indicators)."""
    from render import render_text_chunk

    CELL_W = 56
    CELL_H = 34
    GAP = 3
    MARGIN = 24

    n = len(items)
    total_w = n * (CELL_W + GAP) + MARGIN * 2 + 60
    total_h = CELL_H + MARGIN * 2 + 40
    canvas = Image.new('RGBA', (total_w, total_h), (0, 0, 0, 0))

    for i, item in enumerate(items):
        x = MARGIN + 10 + i * (CELL_W + GAP)
        y = MARGIN + 20
        rect_img, _ = hand_rect(0, 0, CELL_W, CELL_H, width=2)
        canvas.alpha_composite(rect_img, (x - 6, y - 6))
        if glyphs and item:
            il, _ = render_text_chunk(item, glyphs, scale=scale, return_baseline=True)
            iw, ih = il.size
            canvas.alpha_composite(il, (x + (CELL_W - iw) // 2, y + (CELL_H - ih) // 2))

    # Front/Rear labels
    if n > 0 and glyphs:
        front_x = MARGIN + 10
        front_y = MARGIN + 20 + CELL_H + 8
        fl, _ = render_text_chunk("front", glyphs, scale=scale * 0.55, return_baseline=True)
        canvas.alpha_composite(fl, (front_x, front_y))

        rear_x = MARGIN + 10 + (n - 1) * (CELL_W + GAP)
        rl, _ = render_text_chunk("rear", glyphs, scale=scale * 0.55, return_baseline=True)
        canvas.alpha_composite(rl, (rear_x, front_y))

    return canvas, total_h // 2


def draw_memory_layout(variables, glyphs=None, scale=0.7):
    """Draw a memory layout diagram showing variables and their values/addresses.

    variables: list of (name, value, address) tuples
    """
    from render import render_text_chunk

    CELL_W = 140
    CELL_H = 32
    GAP = 4
    MARGIN = 20
    ADDR_W = 70

    n = len(variables)
    total_w = ADDR_W + CELL_W + MARGIN * 2 + 20
    total_h = n * (CELL_H + GAP) + MARGIN * 2 + 20
    canvas = Image.new('RGBA', (total_w, total_h), (0, 0, 0, 0))

    for i, (name, value, addr) in enumerate(variables):
        y = MARGIN + 10 + i * (CELL_H + GAP)

        # Address box
        addr_x = MARGIN
        addr_rect, _ = hand_rect(0, 0, ADDR_W, CELL_H, width=1)
        canvas.alpha_composite(addr_rect, (addr_x - 6, y - 6))
        if glyphs and addr:
            al, _ = render_text_chunk(addr, glyphs, scale=scale * 0.55, return_baseline=True)
            aw, ah = al.size
            canvas.alpha_composite(al, (addr_x + (ADDR_W - aw) // 2, y + (CELL_H - ah) // 2))

        # Variable box
        var_x = MARGIN + ADDR_W + 8
        var_rect, _ = hand_rect(0, 0, CELL_W, CELL_H, width=2)
        canvas.alpha_composite(var_rect, (var_x - 6, y - 6))
        if glyphs:
            display = f"{name} = {value}" if value else name
            vl, _ = render_text_chunk(display, glyphs, scale=scale, return_baseline=True)
            vw, vh = vl.size
            canvas.alpha_composite(vl, (var_x + (CELL_W - vw) // 2, y + (CELL_H - vh) // 2))

        # Arrow from address to variable
        arrow_start = (addr_x + ADDR_W, y + CELL_H // 2)
        arrow_end = (var_x, y + CELL_H // 2)
        hand_arrow(canvas, arrow_start, arrow_end, width=1)

    return canvas, total_h // 2


def draw_pointer_diagram(objects, pointers, glyphs=None, scale=0.7):
    """Draw objects in memory with pointers between them.

    objects: list of (label, x, y, width, height)
    pointers: list of (from_label, to_label) — arrows between objects
    """
    from render import render_text_chunk

    MARGIN = 20
    pos = {}
    sizes = {}
    for label, x, y, w, h in objects:
        pos[label] = (x, y)
        sizes[label] = (w, h)

    max_x = max(p[0] + sizes[l][0] for l, p in pos.items()) + MARGIN
    max_y = max(p[1] + sizes[l][1] for l, p in pos.items()) + MARGIN
    canvas_w = int(max_x + 20)
    canvas_h = int(max_y + 20)
    canvas = Image.new('RGBA', (canvas_w, canvas_h), (0, 0, 0, 0))

    # Draw objects
    for label, (px, py) in pos.items():
        w, h = sizes[label]
        rect_img, _ = hand_rect(0, 0, w, h, width=2)
        canvas.alpha_composite(rect_img, (px - 6, py - 6))
        if glyphs:
            lbl, _ = render_text_chunk(label, glyphs, scale=scale, return_baseline=True)
            lw, lh = lbl.size
            canvas.alpha_composite(lbl, (px + (w - lw) // 2, py + (h - lh) // 2))

    # Draw pointers
    for frm, to in pointers:
        if frm not in pos or to not in pos:
            continue
        fx, fy = pos[frm]
        fw, fh = sizes[frm]
        tx, ty = pos[to]
        tw, th = sizes[to]

        # Start from right edge of from, end at left edge of to
        start = (fx + fw, fy + fh // 2)
        end = (tx, ty + th // 2)
        hand_arrow(canvas, start, end, width=2)

    return canvas, canvas_h // 2


# ═══════════════════════════════════════════════════════════════════════
#  Ultra-visual algorithm teaching primitives
# ═══════════════════════════════════════════════════════════════════════

def draw_sack(capacity, items_inside=None, width=180, height=200, glyphs=None):
    """Draw a hand-drawn sack/bag with optional items inside.

    capacity: string label for capacity (e.g. "W=8")
    items_inside: list of strings describing items in the sack
    Returns (img, baseline_y)
    """
    from render import render_text_chunk

    MARGIN = 20
    SACK_W = width
    SACK_H = height
    total_w = SACK_W + MARGIN * 2
    total_h = SACK_H + MARGIN * 2 + 40
    canvas = Image.new('RGBA', (total_w, total_h), (0, 0, 0, 0))

    cx = total_w // 2
    top_y = MARGIN + 20
    bot_y = top_y + SACK_H

    # Draw sack body — a rounded bag shape
    opening_w = SACK_W * 0.55
    body_w = SACK_W * 0.7
    bottom_w = SACK_W * 0.45

    # Left side of sack
    left_pts = []
    n = 16
    for k in range(n + 1):
        u = k / n
        x = cx - opening_w / 2 + (opening_w / 2 - body_w / 2) * min(u * 3, 1.0)
        x = x + (body_w / 2 - bottom_w / 2) * max(0, (u - 0.3) / 0.7)
        x += random.uniform(-1.5, 1.5)
        y = top_y + u * (bot_y - top_y) + random.uniform(-1.0, 1.0)
        left_pts.append((x, y))

    # Right side of sack (bottom to top)
    right_pts = []
    for k in range(n, -1, -1):
        u = k / n
        x = cx + opening_w / 2 - (opening_w / 2 - body_w / 2) * min(u * 3, 1.0)
        x = x - (body_w / 2 - bottom_w / 2) * max(0, (u - 0.3) / 0.7)
        x += random.uniform(-1.5, 1.5)
        y = top_y + u * (bot_y - top_y) + random.uniform(-1.0, 1.0)
        right_pts.append((x, y))

    # Draw sack outline
    sack_pts = left_pts + right_pts
    aa_line(canvas, sack_pts, width=3)

    # Draw drawstring at top — cinched opening
    cinch_left = (cx - opening_w / 2 - 8, top_y)
    cinch_right = (cx + opening_w / 2 + 8, top_y)
    knot_x = int(cx + opening_w / 2 + 12)
    knot_y = top_y - 8
    hand_line(canvas, cinch_left, cinch_right, width=2, jitter=0.5)
    bow_pts = [
        (knot_x - 6, knot_y + 4),
        (knot_x, knot_y),
        (knot_x + 6, knot_y + 4),
    ]
    aa_line(canvas, bow_pts, width=2)
    hand_line(canvas, (knot_x, knot_y), (knot_x, knot_y - 10), width=2, jitter=0.3)

    # Capacity label
    cap_lbl = f"Capacity: {capacity}"
    cl, _ = render_text_chunk(cap_lbl, glyphs, scale=0.6, return_baseline=True)
    cw, ch = cl.size
    canvas.alpha_composite(cl, (cx - cw // 2, top_y - 30))

    # Items inside the sack
    if items_inside:
        item_y = top_y + 30
        for item in items_inside:
            il, _ = render_text_chunk(item, glyphs, scale=0.55, return_baseline=True)
            iw, ih = il.size
            canvas.alpha_composite(il, (cx - iw // 2, item_y))
            item_y += ih + 6

    return canvas, total_h // 2


def draw_items_row(items, glyphs=None, scale=0.7, highlight_idx=None):
    """Draw a row of items showing weight and value for Knapsack.

    items: list of (name, weight, value) tuples
    highlight_idx: index to highlight (the item being considered)
    Returns (img, baseline_y)
    """
    from render import render_text_chunk

    CELL_W = 90
    CELL_H = 60
    GAP = 12
    MARGIN = 16
    n = len(items)

    total_w = n * CELL_W + (n - 1) * GAP + MARGIN * 2
    total_h = CELL_H + MARGIN * 2 + 30
    canvas = Image.new('RGBA', (total_w, total_h), (0, 0, 0, 0))

    for i, (name, weight, value) in enumerate(items):
        x = MARGIN + i * (CELL_W + GAP)
        y = MARGIN + 10

        is_hl = (highlight_idx is not None and i == highlight_idx)

        rect_img, _ = hand_rect(0, 0, CELL_W, CELL_H, width=3 if is_hl else 2)
        canvas.alpha_composite(rect_img, (x - 6, y - 6))

        if is_hl:
            arrow_tip = (x + CELL_W // 2, y - 12)
            hand_line(canvas, (arrow_tip[0], arrow_tip[1] + 16), arrow_tip, width=2, jitter=0.4)
            cl, _ = render_text_chunk("considering...", glyphs, scale=0.45, return_baseline=True)
            cw, ch = cl.size
            canvas.alpha_composite(cl, (arrow_tip[0] - cw // 2, arrow_tip[1] - 20))

        nl, _ = render_text_chunk(name, glyphs, scale=scale, return_baseline=True)
        nw, nh = nl.size
        canvas.alpha_composite(nl, (x + (CELL_W - nw) // 2, y + 4))

        wv_text = f"w={weight} v={value}"
        wvl, _ = render_text_chunk(wv_text, glyphs, scale=scale * 0.6, return_baseline=True)
        wvw, wvh = wvl.size
        canvas.alpha_composite(wvl, (x + (CELL_W - wvw) // 2, y + CELL_H - wvh - 4))

    return canvas, total_h // 2


def draw_dp_table_highlighted(rows, row_labels=None, col_labels=None, glyphs=None,
                               scale=0.7, highlight_cell=None, arrows=None,
                               computed_cells=None):
    """Draw a DP table with cell highlighting for step-by-step walkthroughs.

    highlight_cell: (row, col) of the cell currently being computed
    computed_cells: set of (row, col) that have been filled in
    arrows: list of (from_row, from_col, to_row, to_col) for dependency arrows
    """
    from render import render_text_chunk

    CELL_W = 52
    CELL_H = 38
    GAP = 2
    MARGIN = 24
    LABEL_W = 40 if row_labels else 0
    HEADER_H = 28 if col_labels else 0

    n_rows = len(rows)
    n_cols = max(len(r) for r in rows) if rows else 0

    total_w = LABEL_W + n_cols * (CELL_W + GAP) + MARGIN * 2
    total_h = HEADER_H + n_rows * (CELL_H + GAP) + MARGIN * 2 + 10
    canvas = Image.new('RGBA', (total_w, total_h), (0, 0, 0, 0))

    if col_labels:
        for j, lbl in enumerate(col_labels):
            if j >= n_cols:
                break
            x = MARGIN + LABEL_W + j * (CELL_W + GAP)
            y = MARGIN
            cl, _ = render_text_chunk(lbl, glyphs, scale=scale * 0.7, return_baseline=True)
            cw, ch = cl.size
            canvas.alpha_composite(cl, (x + (CELL_W - cw) // 2, y + (HEADER_H - ch) // 2))

    if row_labels:
        for i, lbl in enumerate(row_labels):
            if i >= n_rows:
                break
            x = MARGIN
            y = MARGIN + HEADER_H + i * (CELL_H + GAP)
            rl, _ = render_text_chunk(lbl, glyphs, scale=scale * 0.7, return_baseline=True)
            rw, rh = rl.size
            canvas.alpha_composite(rl, (x + (LABEL_W - rw) // 2, y + (CELL_H - rh) // 2))

    for i, row in enumerate(rows):
        for j, val in enumerate(row):
            if j >= n_cols:
                break
            x = MARGIN + LABEL_W + j * (CELL_W + GAP)
            y = MARGIN + HEADER_H + i * (CELL_H + GAP)

            is_highlighted = (highlight_cell is not None and i == highlight_cell[0] and j == highlight_cell[1])
            is_computed = (computed_cells is not None and (i, j) in computed_cells)

            if is_highlighted:
                rect_img, _ = hand_rect(0, 0, CELL_W, CELL_H, width=3)
                canvas.alpha_composite(rect_img, (x - 6, y - 6))
                ql, _ = render_text_chunk("?", glyphs, scale=0.5, return_baseline=True)
                qw, qh = ql.size
                canvas.alpha_composite(ql, (x + CELL_W - qw - 4, y + 2))
            elif is_computed:
                rect_img, _ = hand_rect(0, 0, CELL_W, CELL_H, width=2)
                canvas.alpha_composite(rect_img, (x - 6, y - 6))
            else:
                rect_img, _ = hand_rect(0, 0, CELL_W, CELL_H, width=1)
                canvas.alpha_composite(rect_img, (x - 6, y - 6))

            if glyphs and val:
                vl, _ = render_text_chunk(val, glyphs, scale=scale, return_baseline=True)
                vw, vh = vl.size
                canvas.alpha_composite(vl, (x + (CELL_W - vw) // 2, y + (CELL_H - vh) // 2))

    if arrows:
        for (fr, fc, tr, tc) in arrows:
            fx = MARGIN + LABEL_W + fc * (CELL_W + GAP) + CELL_W // 2
            fy = MARGIN + HEADER_H + fr * (CELL_H + GAP) + CELL_H // 2
            tx = MARGIN + LABEL_W + tc * (CELL_W + GAP) + CELL_W // 2
            ty = MARGIN + HEADER_H + tr * (CELL_H + GAP) + CELL_H // 2
            hand_arrow(canvas, (fx, fy), (tx, ty), width=2)

    return canvas, total_h // 2


def draw_knapsack_state(sack_capacity, items_inside, total_weight, total_value, glyphs=None):
    """Draw a sack with items inside, showing current weight and value.

    items_inside: list of (name, weight, value) tuples
    """
    from render import render_text_chunk

    SACK_W = 200
    SACK_H = 220
    MARGIN = 20
    total_w = SACK_W + MARGIN * 2 + 100
    total_h = SACK_H + MARGIN * 2 + 60
    canvas = Image.new('RGBA', (total_w, total_h), (0, 0, 0, 0))

    cx = total_w // 2 - 30
    top_y = MARGIN + 40
    bot_y = top_y + SACK_H

    opening_w = SACK_W * 0.5
    body_w = SACK_W * 0.65
    bottom_w = SACK_W * 0.4

    left_pts = []
    n = 16
    for k in range(n + 1):
        u = k / n
        x = cx - opening_w / 2 + (opening_w / 2 - body_w / 2) * min(u * 3, 1.0)
        x = x + (body_w / 2 - bottom_w / 2) * max(0, (u - 0.3) / 0.7)
        x += random.uniform(-1.5, 1.5)
        y = top_y + u * (bot_y - top_y) + random.uniform(-1.0, 1.0)
        left_pts.append((x, y))

    right_pts = []
    for k in range(n, -1, -1):
        u = k / n
        x = cx + opening_w / 2 - (opening_w / 2 - body_w / 2) * min(u * 3, 1.0)
        x = x - (body_w / 2 - bottom_w / 2) * max(0, (u - 0.3) / 0.7)
        x += random.uniform(-1.5, 1.5)
        y = top_y + u * (bot_y - top_y) + random.uniform(-1.0, 1.0)
        right_pts.append((x, y))

    sack_pts = left_pts + right_pts
    aa_line(canvas, sack_pts, width=3)

    cinch_left = (cx - opening_w / 2 - 6, top_y)
    cinch_right = (cx + opening_w / 2 + 6, top_y)
    hand_line(canvas, cinch_left, cinch_right, width=2, jitter=0.5)

    if items_inside:
        item_y = top_y + 25
        for name, weight, value in items_inside:
            item_text = f"{name} (w={weight}, v={value})"
            il, _ = render_text_chunk(item_text, glyphs, scale=0.5, return_baseline=True)
            iw, ih = il.size
            canvas.alpha_composite(il, (cx - iw // 2, item_y))
            item_y += ih + 5

    stats_x = int(cx + body_w / 2 + 30)
    stats_y = top_y + 20

    cap_lbl = f"Sack: W={sack_capacity}"
    cl, _ = render_text_chunk(cap_lbl, glyphs, scale=0.6, return_baseline=True)
    canvas.alpha_composite(cl, (stats_x, stats_y))

    tw_lbl = f"Current wt: {total_weight}"
    twl, _ = render_text_chunk(tw_lbl, glyphs, scale=0.55, return_baseline=True)
    canvas.alpha_composite(twl, (stats_x, stats_y + 24))

    tv_lbl = f"Current val: {total_value}"
    tvl, _ = render_text_chunk(tv_lbl, glyphs, scale=0.55, return_baseline=True)
    canvas.alpha_composite(tvl, (stats_x, stats_y + 46))

    return canvas, total_h // 2


def draw_choice_diagram(item_name, item_weight, item_value, capacity_left,
                         include_value, exclude_value, decision, glyphs=None):
    """Draw a decision diagram: include vs exclude an item.

    decision: 'include', 'exclude', or 'undecided'
    """
    from render import render_text_chunk

    W = 400
    H = 180
    MARGIN = 20
    canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0))

    item_text = f"Item: {item_name} (w={item_weight}, v={item_value})"
    il, _ = render_text_chunk(item_text, glyphs, scale=0.65, return_baseline=True)
    iw, ih = il.size
    canvas.alpha_composite(il, (MARGIN + (W - 2 * MARGIN - iw) // 2, MARGIN))

    branch_y = MARGIN + ih + 20
    mid_x = W // 2

    inc_x = mid_x - 100
    inc_text = f"Include: {include_value}"
    incl, _ = render_text_chunk(inc_text, glyphs, scale=0.55, return_baseline=True)
    incw, inch = incl.size
    canvas.alpha_composite(incl, (inc_x - incw // 2, branch_y))

    exc_x = mid_x + 100
    exc_text = f"Exclude: {exclude_value}"
    excl, _ = render_text_chunk(exc_text, glyphs, scale=0.55, return_baseline=True)
    excw, exch = excl.size
    canvas.alpha_composite(excl, (exc_x - excw // 2, branch_y))

    item_bot = (mid_x, MARGIN + ih)
    hand_line(canvas, item_bot, (inc_x, branch_y - 5), width=1, jitter=0.4)
    hand_line(canvas, item_bot, (exc_x, branch_y - 5), width=1, jitter=0.4)

    dec_y = branch_y + inch + 20
    if decision == 'include':
        dec_text = f">> INCLUDE {item_name} <<"
        circle_img, _ = hand_circle((inc_x, branch_y + inch // 2), 50, width=2, segments=24)
        canvas.alpha_composite(circle_img, (inc_x - 50, branch_y + inch // 2 - 50))
    elif decision == 'exclude':
        dec_text = f">> EXCLUDE {item_name} <<"
        circle_img, _ = hand_circle((exc_x, branch_y + inch // 2), 50, width=2, segments=24)
        canvas.alpha_composite(circle_img, (exc_x - 50, branch_y + inch // 2 - 50))
    else:
        dec_text = "Which is better?"

    dl, _ = render_text_chunk(dec_text, glyphs, scale=0.6, return_baseline=True)
    dw, dh = dl.size
    canvas.alpha_composite(dl, (mid_x - dw // 2, dec_y))

    return canvas, H // 2


def draw_backtrack_chain(dp_table_data, path, glyphs=None, scale=0.65):
    """Draw the backtracking path through a DP table to find selected items.

    dp_table_data: 2D list of strings (the filled DP table)
    path: list of (row, col) tuples showing the backtracking path
    """
    from render import render_text_chunk

    CELL_W = 48
    CELL_H = 34
    GAP = 2
    MARGIN = 20
    LABEL_W = 36

    n_rows = len(dp_table_data)
    n_cols = max(len(r) for r in dp_table_data) if dp_table_data else 0

    total_w = LABEL_W + n_cols * (CELL_W + GAP) + MARGIN * 2
    total_h = n_rows * (CELL_H + GAP) + MARGIN * 2 + 10
    canvas = Image.new('RGBA', (total_w, total_h), (0, 0, 0, 0))

    for i, row in enumerate(dp_table_data):
        for j, val in enumerate(row):
            if j >= n_cols:
                break
            x = MARGIN + LABEL_W + j * (CELL_W + GAP)
            y = MARGIN + i * (CELL_H + GAP)

            on_path = (i, j) in path
            width = 3 if on_path else 1
            rect_img, _ = hand_rect(0, 0, CELL_W, CELL_H, width=width)
            canvas.alpha_composite(rect_img, (x - 6, y - 6))

            if glyphs and val:
                vl, _ = render_text_chunk(val, glyphs, scale=scale, return_baseline=True)
                vw, vh = vl.size
                canvas.alpha_composite(vl, (x + (CELL_W - vw) // 2, y + (CELL_H - vh) // 2))

    for k in range(len(path) - 1):
        fr, fc = path[k]
        tr, tc = path[k + 1]
        fx = MARGIN + LABEL_W + fc * (CELL_W + GAP) + CELL_W // 2
        fy = MARGIN + fr * (CELL_H + GAP) + CELL_H // 2
        tx = MARGIN + LABEL_W + tc * (CELL_W + GAP) + CELL_W // 2
        ty = MARGIN + tr * (CELL_H + GAP) + CELL_H // 2
        hand_arrow(canvas, (fx, fy), (tx, ty), width=2)

    return canvas, total_h // 2
