"""Clean extractor for the master handwriting sheet (WhatsApp 04.18.54).

Grid cells are 44x44, origin at (0, 42).
Layout audited cell-by-cell:

LEFT COLUMN A (cols 0-9):
  rows 0-25: a..z  (typically 10 wide, narrower for tall/wide letters)
  row 26: α(0..3) β(4..7)
  row 27: γ(0..3) θ(4..7)
  row 28: + (0..7)
  row 29: - (0..7)
  row 30: * (0..7)
  row 31: ÷ (0..6)
  row 32: = (0..7)
  row 33: < (0..7)
  row 34: > (0..7)

MIDDLE COLUMN B (cols 11-16):
  rows 0-25: A..Z (5-6 wide)
  row 28: ≤ (11..17)
  row 29: ≥ (11..17)
  row 30: ≠ (11..16)
  row 31: ( (11..16)
  row 32: ) (11..16)
  row 33: [ (11..16)
  row 34: ] (11..16)

RIGHT COLUMN C (cols 18-23):
  rows 0-9: 0..9 (6 wide)
  row 10: ∞ (18..23)
  row 11: | (18..23)
  row 12: / (18..23)
  row 13: ' (18..22)
  row 14: π (18..23)
  row 15: λ (18..23)
  rows 16-21: Ü Ö Ä ü ö ä (5 wide, sometimes 17-21)
  row 22: ← (6)
  row 23: → (6)
  row 24: Σ (5)
  row 25: " (6)
  row 26: " (6) — header quote row was 25, this might be skip
  row 27: ? (5)
  row 28: . (6)
  row 29: , (6)
  row 30: { (6)
  row 31: } (6)
  row 32: ; (6)
  row 33: : (6)
  row 34: ! (6)

FAR-RIGHT COLUMN D (cols 24-27):
  row 6: ^
  row 7: √
  row 8: ∃
  row 9: ∀
  row 10: ∪
  row 11: ∩
  row 12: ⊆
  row 13: ⊂
  row 14: ∈
  row 15: ∉
"""
import os, json, glob
from PIL import Image
import numpy as np
import cv2

SRC = 'pages/master_sheet.png'
GRID_X0 = 0
GRID_Y0 = 42
CELL = 44

LAYOUT = []

# --- COLUMN A — Lowercase a-z ---
for i, c in enumerate('abcdefghijklmnopqrstuvwxyz'):
    LAYOUT.append((c, i, 0, 10))

# Greek + ß-area
LAYOUT.extend([
    ('α', 26, 0, 4),
    ('β', 26, 4, 4),
    ('γ', 27, 0, 4),
    ('θ', 27, 4, 4),
    ('+', 28, 0, 8),
    ('-', 29, 0, 8),
    ('*', 30, 0, 8),
    ('÷', 31, 0, 7),
    ('=', 32, 0, 8),
    ('<', 33, 0, 8),
    ('>', 34, 0, 8),
])

# --- COLUMN B — Uppercase A-Z ---
for i, c in enumerate('ABCDEFGHIJKLMNOPQRSTUVWXYZ'):
    LAYOUT.append((c, i, 11, 6))

LAYOUT.extend([
    ('≤', 28, 11, 7),
    ('≥', 29, 11, 7),
    ('≠', 30, 11, 6),
    ('(', 31, 11, 6),
    (')', 32, 11, 6),
    ('[', 33, 11, 6),
    (']', 34, 11, 6),
])

# --- COLUMN C — Digits 0-9 then misc symbols ---
for i, c in enumerate('0123456789'):
    LAYOUT.append((c, i, 18, 6))

LAYOUT.extend([
    ('∞', 10, 18, 6),
    ('|', 11, 18, 6),
    ('/', 12, 18, 6),
    ("'", 13, 18, 5),
    ('π', 14, 18, 6),
    ('λ', 15, 18, 6),
    ('Ü', 17, 18, 5),
    ('Ö', 18, 18, 5),
    ('Ä', 19, 18, 5),
    ('ü', 20, 18, 5),
    ('ö', 21, 18, 5),
    ('ä', 22, 18, 5),
    ('←', 23, 18, 6),
    ('→', 24, 18, 6),
    ('Σ', 25, 18, 5),
    ('"', 26, 18, 6),
    ('?', 27, 18, 5),
    ('.', 28, 18, 6),
    (',', 29, 18, 6),
    ('{', 30, 18, 6),
    ('}', 31, 18, 6),
    (';', 32, 18, 6),
    (':', 33, 18, 6),
    ('!', 34, 18, 6),
])

# --- COLUMN D — Side symbols ---
LAYOUT.extend([
    ('^', 6, 24, 4),
    ('√', 7, 24, 4),
    ('∃', 8, 24, 4),
    ('∀', 9, 24, 4),
    ('∪', 10, 24, 4),
    ('∩', 11, 24, 4),
    ('⊆', 12, 24, 4),
    ('⊂', 13, 24, 4),
    ('∈', 14, 24, 4),
    ('∉', 15, 24, 4),
])


DESCENDERS = set('fgjpqyäöüß,;φλγηρξζψμβ')  # f and g hang below the baseline
MATH_CENTER = set('+−-*×÷=<>≤≥≠^∞∪∩⊆⊂∈∉∀∃√←→Σ∂∇∫')

# Per-character descender ratios: where baseline sits within the glyph image.
# Smaller value = glyph hangs LOWER (more pixels below baseline).
DESCENDER_RATIO = {
    'g': 0.62,   # was 0.72 → drop further
    'f': 0.65,   # f's tail clearly hangs below baseline
    'j': 0.55,   # j has a long descender
    'p': 0.65,
    'q': 0.65,
    'y': 0.65,
    'β': 0.65,
    'γ': 0.65,
}


def isolate_ink(arr_rgb):
    gray = arr_rgb.mean(axis=2)
    return (gray < 145).astype(np.uint8) * 255


def extract_one(arr, ink, row, col):
    cx = GRID_X0 + col * CELL
    cy = GRID_Y0 + row * CELL
    pad_x, pad_top, pad_bot = 2, 16, 18
    x0 = max(0, cx - pad_x)
    y0 = max(0, cy - pad_top)
    x1 = min(ink.shape[1], cx + CELL + pad_x)
    y1 = min(ink.shape[0], cy + CELL + pad_bot)
    cell_mask = ink[y0:y1, x0:x1].copy()
    if cell_mask.size == 0 or cell_mask.sum() < 80:
        return None

    kernel = np.array([[0, 1, 0]] * 5, np.uint8)
    merged = cv2.dilate(cell_mask, kernel, iterations=1)
    nlab, labels, stats, _ = cv2.connectedComponentsWithStats(merged)
    cell_h_center = pad_x + CELL / 2
    keep = []
    for i in range(1, nlab):
        x, y, w, h, area = stats[i]
        if area < 18:
            continue
        cxi = x + w / 2
        if abs(cxi - cell_h_center) > CELL * 0.5:
            continue
        top_in_cell = y - pad_top
        if top_in_cell > 0.7 * CELL:
            continue
        if top_in_cell < -14:
            continue
        bot_in_cell = y + h - pad_top
        if bot_in_cell > CELL + 18:
            continue
        keep.append(i)
    if not keep:
        return None
    keep_region = np.isin(labels, keep)
    out_mask = np.where(keep_region & (cell_mask > 0), 255, 0).astype(np.uint8)
    ys, xs = np.where(out_mask > 0)
    if len(xs) == 0:
        return None
    minx, maxx = xs.min(), xs.max() + 1
    miny, maxy = ys.min(), ys.max() + 1
    glyph_mask = out_mask[miny:maxy, minx:maxx]
    rgba = np.zeros((glyph_mask.shape[0], glyph_mask.shape[1], 4), dtype=np.uint8)
    rgba[..., 3] = glyph_mask
    return rgba, glyph_mask.shape[0], glyph_mask.shape[1]


def baseline_for(label, h):
    if label in DESCENDERS:
        ratio = DESCENDER_RATIO.get(label, 0.72)
        return int(h * ratio) + 48
    if label in MATH_CENTER:
        # Place math operators so their CENTER is at x-height middle.
        return 11 + h // 2 + 48
    return h + 48


def main():
    img = Image.open(SRC).convert('RGB')
    arr = np.array(img)
    ink = isolate_ink(arr)

    # Wipe glyphs/
    for f in glob.glob('glyphs/*.png'):
        os.remove(f)
    metadata = {}
    counts = {}
    miss = []
    for ch, row, col_start, n in LAYOUT:
        for col in range(col_start, col_start + n):
            res = extract_one(arr, ink, row, col)
            if res is None:
                miss.append((ch, row, col))
                continue
            rgba, h, w = res
            idx = counts.get(ch, 0)
            counts[ch] = idx + 1
            fname = f"glyphs/U{ord(ch):04X}_m{idx}.png"
            Image.fromarray(rgba, 'RGBA').save(fname)
            metadata.setdefault(ch, []).append({
                'file': fname,
                'top_off': 0,
                'baseline_y': baseline_for(ch, h),
                'w': w,
                'h': h,
            })

    with open('glyphs/metadata.json', 'w') as f:
        json.dump(metadata, f, ensure_ascii=False, indent=2)

    total = sum(len(v) for v in metadata.values())
    print(f'Extracted {total} glyphs across {len(metadata)} characters.\n')
    # Group by count
    from collections import Counter
    by_count = Counter(len(v) for v in metadata.values())
    for c in sorted(by_count.keys(), reverse=True):
        chars = [ch for ch, v in metadata.items() if len(v) == c]
        print(f"  {c} variants: {len(chars)} chars: {''.join(sorted(chars))}")
    if miss:
        print(f'\nMissed {len(miss)} cells:')
        for ch, r, c in miss[:50]:
            print(f'  {ch!r} at row {r}, col {c}')


if __name__ == '__main__':
    main()
