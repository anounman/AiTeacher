"""Extract supplementary glyphs from Handwriting.png:
   * (4×), → (3×), θ (4×), n (3×), π (4×).
Replaces all existing 'n' variants with the new ones; merges others as additions."""
import os, json, glob
from PIL import Image
import numpy as np
import cv2

GRID_X0 = 25
GRID_Y0 = 31
CELL = 89  # one grid square per character horizontally; vertical = 2*89 between rows

# (char, row_index, col_index) — row_index is the character-row number (0,1,2),
# rows are 2 grid squares apart vertically.
LAYOUT = [
    ('*', 0, 0), ('*', 0, 2), ('*', 0, 4), ('*', 0, 6),
    ('→', 0, 8), ('→', 0, 10), ('→', 0, 12),
    ('θ', 1, 0), ('θ', 1, 2), ('θ', 1, 4), ('θ', 1, 6),
    ('n', 1, 8), ('n', 1, 10), ('n', 1, 12),
    ('π', 2, 0), ('π', 2, 2), ('π', 2, 4), ('π', 2, 6),
]

PAGE_PATH = 'pages/page_5.png'
PAGE_ID = 'p5'


def isolate_ink(rgb_img):
    arr = np.array(rgb_img.convert('RGB'))
    gray = arr.mean(axis=2)
    return (gray < 130).astype(np.uint8) * 255


def extract_glyph(page_rgb, ink_mask, row, col):
    cx = GRID_X0 + col * CELL
    cy = GRID_Y0 + row * 2 * CELL  # character rows are 2 grid squares apart
    pad_x, pad_top, pad_bot = 4, int(CELL * 0.35), int(CELL * 0.5)
    x0 = max(0, cx - pad_x)
    y0 = max(0, cy - pad_top)
    x1 = min(ink_mask.shape[1], cx + CELL + pad_x)
    y1 = min(ink_mask.shape[0], cy + CELL + pad_bot)
    cell_mask = ink_mask[y0:y1, x0:x1].copy()
    if cell_mask.size == 0:
        return None

    kernel = np.array([[0, 1, 0]] * 5, np.uint8)
    merged = cv2.dilate(cell_mask, kernel, iterations=1)
    nlab, labels, stats, _ = cv2.connectedComponentsWithStats(merged)

    cell_h_center = pad_x + CELL / 2
    keep = []
    for i in range(1, nlab):
        x, y, w, h, area = stats[i]
        if area < 30:
            continue
        cxi = x + w / 2
        if abs(cxi - cell_h_center) > CELL * 0.55:
            continue
        top_in_cell = y - pad_top
        if top_in_cell > 0.7 * CELL:
            continue
        if top_in_cell < -25:
            continue
        bot_in_cell = y + h - pad_top
        if bot_in_cell > CELL + 30:
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

    page_arr = np.array(page_rgb.convert('RGB'))
    rgb_crop = page_arr[y0 + miny:y0 + maxy, x0 + minx:x0 + maxx]
    glyph_mask = out_mask[miny:maxy, minx:maxx]

    rgba = np.zeros((glyph_mask.shape[0], glyph_mask.shape[1], 4), dtype=np.uint8)
    rgba[..., :3] = rgb_crop
    rgba[..., 3] = glyph_mask

    # Baseline ≈ middle of the character cell (CELL/2 below cell top).
    # Renderer subtracts 48 (legacy), so we store baseline + 48.
    baseline_y = (pad_top + CELL // 2) - miny + 48
    top_off = miny - pad_top
    return Image.fromarray(rgba, 'RGBA'), int(baseline_y), int(top_off)


def main():
    with open('glyphs/metadata.json') as f:
        metadata = json.load(f)

    # Remove ALL existing 'n' variants per user's request
    if 'n' in metadata:
        for v in metadata['n']:
            try:
                os.remove(v['file'])
            except FileNotFoundError:
                pass
        del metadata['n']
        print("Removed old 'n' variants.")

    # Also remove existing 'p5' supplementary glyphs if re-running
    for ch in ('*', '→', 'θ', 'n', 'π'):
        if ch in metadata:
            metadata[ch] = [v for v in metadata[ch]
                            if '_p5' not in v['file']]
            if not metadata[ch]:
                del metadata[ch]
    for f in glob.glob('glyphs/*_p5.png'):
        os.remove(f)

    page = Image.open(PAGE_PATH)
    ink = isolate_ink(page)

    added = 0
    for idx, (ch, row, col) in enumerate(LAYOUT):
        result = extract_glyph(page, ink, row, col)
        if result is None:
            print(f"  MISS  {ch!r} (r{row} c{col})")
            continue
        glyph_img, baseline_y, top_off = result
        # Suffix index so multiple variants of same char don't overwrite
        existing = sum(1 for v in metadata.get(ch, []) if '_p5' in v['file'])
        suffix = f"p5_{existing}" if existing else "p5"
        fname = f"glyphs/U{ord(ch):04X}_{suffix}.png"
        glyph_img.save(fname)
        metadata.setdefault(ch, []).append({
            'file': fname,
            'top_off': top_off,
            'baseline_y': baseline_y,
            'w': glyph_img.size[0],
            'h': glyph_img.size[1],
        })
        added += 1

    with open('glyphs/metadata.json', 'w') as f:
        json.dump(metadata, f, ensure_ascii=False, indent=2)
    print(f"\nAdded {added} glyph variants.")
    for ch in ('*', '→', 'θ', 'n', 'π'):
        print(f"  {ch!r}: {len(metadata.get(ch, []))} variants")


if __name__ == '__main__':
    main()
