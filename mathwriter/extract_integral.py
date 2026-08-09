"""Extract the 10 hand-drawn ∫ glyphs from int.png and add them to metadata."""
import os, json, glob
from PIL import Image
import numpy as np
import cv2

PAGE_PATH = 'pages/int_page.png'


def main():
    img_pil = Image.open(PAGE_PATH).convert('RGB')
    arr = np.array(img_pil)
    gray = arr.mean(axis=2)
    ink = (gray < 130).astype(np.uint8) * 255

    # Find connected components — the 10 ∫ glyphs should be the largest ones
    # Vertical dilation to keep separate strokes as one component
    kernel = np.ones((3, 1), np.uint8)
    dil = cv2.dilate(ink, kernel, iterations=1)
    nlab, labels, stats, _ = cv2.connectedComponentsWithStats(dil)

    # Keep components with area > 1000 pixels (∫ glyphs are big)
    comps = []
    for i in range(1, nlab):
        x, y, w, h, area = stats[i]
        if area < 800:
            continue
        # Filter out horizontal bars / spurious ink at the top edge
        if h < 60:
            continue
        # ∫ is taller than wide
        if w > h:
            continue
        comps.append((x, y, w, h, i))
    # Sort by row (approx) then column
    comps.sort(key=lambda c: (c[1] // 200, c[0]))
    print(f'Found {len(comps)} candidate glyphs')
    for x, y, w, h, _ in comps:
        print(f'  bbox: x={x}, y={y}, w={w}, h={h}')

    # Remove existing ∫ glyphs
    for f in glob.glob('glyphs/U222B_*.png'):
        os.remove(f)
    with open('glyphs/metadata.json') as f:
        metadata = json.load(f)
    metadata.pop('∫', None)

    for idx, (x, y, w, h, label_id) in enumerate(comps):
        # Extract using the ORIGINAL ink mask so we get clean pixels
        sub = labels[y:y+h, x:x+w] == label_id
        clean = np.where(sub, ink[y:y+h, x:x+w], 0).astype(np.uint8)
        # Tight bounding box based on original ink (undilated)
        ys, xs = np.where(clean > 0)
        if len(xs) == 0:
            continue
        minx, maxx = xs.min(), xs.max() + 1
        miny, maxy = ys.min(), ys.max() + 1
        tight = clean[miny:maxy, minx:maxx]

        rgba = np.zeros((tight.shape[0], tight.shape[1], 4), dtype=np.uint8)
        rgba[..., 3] = tight
        fname = f"glyphs/U222B_i{idx}.png"
        Image.fromarray(rgba, 'RGBA').save(fname)

        # Baseline: at the bottom of the ∫ so it sits on the line like a normal char
        # but with baseline slightly ABOVE bottom (∫ has a descender-like tail)
        gh = tight.shape[0]
        gw = tight.shape[1]
        # Place ∫ so its center sits on the line baseline (integral spans above + below)
        # baseline_y in the glyph image (before renderer's -48 shift):
        # We want py = line_baseline - baseline_y (which is bl_in_glyph + 48)
        # For ∫ to be centered on line_baseline: py = line_baseline - gh/2, so bl_in_glyph = gh/2
        baseline_y = gh // 2 + 48
        metadata.setdefault('∫', []).append({
            'file': fname,
            'top_off': 0,
            'baseline_y': baseline_y,
            'w': gw,
            'h': gh,
        })

    with open('glyphs/metadata.json', 'w') as f:
        json.dump(metadata, f, ensure_ascii=False, indent=2)
    print(f"\nSaved {len(metadata.get('∫', []))} ∫ variants to metadata.")


if __name__ == '__main__':
    main()
