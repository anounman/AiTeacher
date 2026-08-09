"""Extract glyphs from the second handwriting sample (Handwriting-3.jpg).
Adds variants to the existing glyph library (no overwrite of pages 1-2)."""
import os, json
from PIL import Image
import numpy as np
import cv2

# Page-3 grid: starts at (57, 57), 58.5 px per square, 2x2 cells per character (117 px).
# Page-4 grid: starts at (57, 28).
PAGES = [
    {
        'path': 'pages/page_3.png',
        'grid_x0': 57, 'grid_y0': 57, 'cell': 117,
        'page_id': 'p3',
        'layout': [
            list("abcdefghijklmn"),
            list("opqrstuvwxyz"),
            list("ABCDEFGHIJKL"),
            list("OPQRSTUVWXYZ"),
            list("äöüßÄÖÜ"),
            list("0123456789"),
        ],
    },
    {
        'path': 'pages/page_4.png',
        'grid_x0': 57, 'grid_y0': 86, 'cell': 117,
        'page_id': 'p4',
        'layout': [
            list("abcdefghijklmn"),
            list("opqrstuvwxyz"),
            list("ABCDEFGHIJKLMN"),
            list("OPQRSTUVWXYZ"),
            list("äöüßÄÖÜ"),
            list("0123456789"),
        ],
    },
]


def isolate_ink(rgb_img):
    arr = np.array(rgb_img.convert('RGB'))
    gray = arr.mean(axis=2)
    return (gray < 130).astype(np.uint8) * 255


def extract_glyph(page_rgb, ink_mask, row, col, cell, grid_x0, grid_y0):
    cx = grid_x0 + col * cell
    cy = grid_y0 + row * cell
    pad_x, pad_top, pad_bot = 2, int(cell * 0.4), int(cell * 0.4)
    x0 = max(0, cx - pad_x)
    y0 = max(0, cy - pad_top)
    x1 = min(ink_mask.shape[1], cx + cell + pad_x)
    y1 = min(ink_mask.shape[0], cy + cell + pad_bot)
    cell_mask = ink_mask[y0:y1, x0:x1].copy()

    kernel = np.array([[0, 1, 0]] * 5, np.uint8)
    merged_mask = cv2.dilate(cell_mask, kernel, iterations=1)
    nlab, labels, stats, _ = cv2.connectedComponentsWithStats(merged_mask)

    cell_h_center = pad_x + cell / 2
    keep = []
    for i in range(1, nlab):
        x, y, w, h, area = stats[i]
        if area < 30:
            continue
        cxi = x + w / 2
        if abs(cxi - cell_h_center) > cell * 0.45:
            continue
        top_in_cell = y - pad_top
        if top_in_cell > 0.6 * cell:
            continue
        if top_in_cell < -25:
            continue
        bot_in_cell = y + h - pad_top
        if bot_in_cell > cell + 30:
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

    # Baseline reference: middle of cell (one grid down from cell top)
    baseline_y = (pad_top + cell // 2) - miny
    top_off = miny - pad_top
    return Image.fromarray(rgba, 'RGBA'), int(baseline_y), int(top_off)


def main():
    with open('glyphs/metadata.json') as f:
        metadata = json.load(f)
    new_count = 0
    for page in PAGES:
        img = Image.open(page['path'])
        ink = isolate_ink(img)
        for row_idx, chars in enumerate(page['layout']):
            for col_idx, ch in enumerate(chars):
                result = extract_glyph(img, ink, row_idx, col_idx,
                                       page['cell'], page['grid_x0'], page['grid_y0'])
                if result is None:
                    print(f"  MISS  {page['page_id']} {ch!r} (r{row_idx} c{col_idx})")
                    continue
                glyph_img, baseline_y, top_off = result
                fname = f"glyphs/U{ord(ch):04X}_{page['page_id']}.png"
                glyph_img.save(fname)
                # The baseline math here uses cell/2 (middle of cell), but the existing
                # render.py loader subtracts 48 (the OLD cell/2). So we need to store
                # the equivalent legacy baseline_y = baseline_y + 48.
                stored_bl = baseline_y + 48
                metadata.setdefault(ch, []).append({
                    'file': fname,
                    'top_off': top_off,
                    'baseline_y': stored_bl,
                    'w': glyph_img.size[0],
                    'h': glyph_img.size[1],
                })
                new_count += 1
    with open('glyphs/metadata.json', 'w') as f:
        json.dump(metadata, f, ensure_ascii=False, indent=2)
    print(f"\nAdded {new_count} new glyph variants.")
    # Variant counts now
    counts = {ch: len(v) for ch, v in metadata.items()}
    by_count = {}
    for ch, n in counts.items():
        by_count.setdefault(n, []).append(ch)
    for n in sorted(by_count):
        print(f"  {n} variants: {len(by_count[n])} chars  e.g. {''.join(by_count[n][:10])}")


if __name__ == '__main__':
    main()
