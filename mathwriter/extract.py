"""Extract individual character glyphs from grid-paper handwriting sheets."""
import os, json
from PIL import Image
import numpy as np
import cv2

GRID0 = 46
CELL = 96  # 2 grid squares of 48px each per character

LAYOUT_P1 = [
    list("abcdefghijklmn"),
    list("opqrstuvwxyz"),
    list("ABCDEFGHIJKLM"),
    list("NOPQRSTUVWXYZ"),
    list("äöüßÄÖÜ"),
    list("0123456789"),
    [".", ",", "?", "!", "-", "–", ":", ";", '"', "'", "(", ")", "="],
    ["+", "−", "×", "÷", "√", "²", "³", "<", ">", "≤", "≥"],
]
LAYOUT_P2 = [
    list("abcdefghijklmn"),
    list("opqrstuvwxyz"),
    list("ABCDEFGHIJKLMN"),
    list("OPQRSTUVWXYZ"),
    list("äöüßÄÖÜ"),
    list("0123456789"),
    [".", ",", "?", "!", "-", "–", ":", ";", '"', "'", "(", ")", "="],
    ["+", "−", "*", "÷", "√", "²", "³", "<", ">", "≤", "≥"],
]

PAGES = [('pages/page_1.png', LAYOUT_P1), ('pages/page_2.png', LAYOUT_P2)]


def isolate_ink(rgb_img):
    arr = np.array(rgb_img.convert('RGB'))
    gray = arr.mean(axis=2)
    ink = (gray < 130).astype(np.uint8) * 255
    return ink


def extract_glyph(page_rgb, ink_mask, row, col, char):
    """Tight, robust per-cell extraction. Returns (RGBA PIL, baseline_in_glyph) or None."""
    cx = GRID0 + col * CELL
    cy = GRID0 + row * CELL
    cell_top, cell_bot = cy, cy + CELL
    # Vertical: allow ascenders 35px above cell top, descenders 35px below cell bottom.
    # Horizontal: tight to cell — exclude neighbouring characters strictly.
    pad_x, pad_top, pad_bot = 2, 38, 38
    x0 = max(0, cx - pad_x)
    y0 = max(0, cy - pad_top)
    x1 = min(ink_mask.shape[1], cx + CELL + pad_x)
    y1 = min(ink_mask.shape[0], cy + CELL + pad_bot)
    cell_mask = ink_mask[y0:y1, x0:x1].copy()

    # Light vertical-only dilation to merge a dot with its body (i, j, ä, ö, ü)
    # but NOT horizontal — prevents bridging to the neighbouring character.
    kernel = np.array([[0,1,0],[0,1,0],[0,1,0],[0,1,0],[0,1,0]], np.uint8)
    merged_mask = cv2.dilate(cell_mask, kernel, iterations=1)
    nlab, labels, stats, _ = cv2.connectedComponentsWithStats(merged_mask)
    cell_left = pad_x
    cell_right = pad_x + CELL
    cell_h_center = pad_x + CELL / 2
    cell_v_center = pad_top + CELL / 2
    keep = []
    for i in range(1, nlab):
        x, y, w, h, area = stats[i]
        if area < 30:
            continue
        cxi = x + w / 2
        cy_comp = y + h / 2
        # Component center must be inside the cell horizontally (strict)
        if abs(cxi - cell_h_center) > CELL * 0.45:
            continue
        # Vertical: the component's TOP must be within the upper portion of the cell
        # (allowing ascenders 25px above, but rejecting chars from the row below).
        top_in_cell = y - pad_top
        if top_in_cell > 0.6 * CELL:
            continue
        if top_in_cell < -25:
            continue
        # And the bottom should be inside the cell + descender region.
        bot_in_cell = y + h - pad_top
        if bot_in_cell > CELL + 25:
            continue
        keep.append(i)
    if not keep:
        return None

    # Build pixel-precise mask from kept components, using original (undilated) ink.
    out_mask = np.zeros_like(cell_mask)
    for i in keep:
        out_mask[(labels == i) & (cell_mask > 0)] = 255
    # Also include any original ink pixel that lies inside the dilated kept region
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

    # Baseline: cell bottom in original page coords = cy + CELL
    # In crop coords: cell_bottom_in_crop = pad_top + CELL
    # In glyph image (after tight crop, subtract miny):
    baseline_y = (pad_top + CELL) - miny
    top_off = miny - pad_top  # negative => extends above cell

    return Image.fromarray(rgba, 'RGBA'), baseline_y, top_off


def main():
    os.makedirs('glyphs', exist_ok=True)
    metadata = {}
    for page_idx, (page_path, layout) in enumerate(PAGES):
        page = Image.open(page_path)
        ink = isolate_ink(page)
        for row_idx, chars in enumerate(layout):
            for col_idx, ch in enumerate(chars):
                result = extract_glyph(page, ink, row_idx, col_idx, ch)
                if result is None:
                    print(f"  MISS  p{page_idx+1} {ch!r} (r{row_idx} c{col_idx})")
                    continue
                glyph_img, baseline_y, top_off = result
                fname = f"glyphs/U{ord(ch):04X}_p{page_idx+1}.png"
                glyph_img.save(fname)
                metadata.setdefault(ch, []).append({
                    'file': fname,
                    'top_off': int(top_off),
                    'baseline_y': int(baseline_y),
                    'w': glyph_img.size[0],
                    'h': glyph_img.size[1],
                })
    with open('glyphs/metadata.json', 'w') as f:
        json.dump(metadata, f, ensure_ascii=False, indent=2)
    total = sum(len(v) for v in metadata.values())
    print(f"\nExtracted {total} glyphs for {len(metadata)} characters.")
    expected = set()
    for _, layout in PAGES:
        for row in layout:
            for c in row:
                expected.add(c)
    missing = [(c, len(metadata.get(c, []))) for c in sorted(expected) if len(metadata.get(c, [])) < 2]
    if missing:
        print('Chars with <2 variants:', missing)


if __name__ == '__main__':
    main()
