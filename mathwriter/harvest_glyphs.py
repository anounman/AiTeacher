"""Harvest glyph variants from real handwritten PDFs using easyocr.

Pipeline:
1. Render each PDF page to a high-res image.
2. easyocr finds word-level bounding boxes + transcriptions.
3. For each word, segment characters by ink-column analysis (connected components
   in the word's bbox).
4. If the segmented component count matches the transcription length, map them
   1-to-1 and save each as a new glyph variant.
5. Skip any word where confidence < threshold or segmentation count mismatches.

Output: hundreds of new variants merged into glyphs/metadata.json.
"""
import os, json, glob, sys, re
import numpy as np
import cv2
from PIL import Image
import pypdfium2 as pdfium
import easyocr

PDFS = [
    '/Users/jayansh/Downloads/Physik.pdf',
    '/Users/jayansh/Downloads/9.pdf',
    '/Users/jayansh/Downloads/Submission 5 Jayansh Jain.pdf',
    '/Users/jayansh/Downloads/Personal Status Page Jayansh Jain.pdf',
    '/Users/jayansh/Downloads/Personal Status Page Jayansh Jain (1).pdf',
    '/Users/jayansh/Downloads/Personal Status Submission Jayansh Jain.pdf',
    '/Users/jayansh/Downloads/Text.pdf',
]

OUT_DIR = 'glyphs'
PAGE_DIR = 'pages/harvested'
os.makedirs(PAGE_DIR, exist_ok=True)

# Only harvest these characters (Latin letters, digits, German specials)
ALLOWED_CHARS = set(
    "abcdefghijklmnopqrstuvwxyz"
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    "0123456789"
    "äöüßÄÖÜ"
)

CONF_MIN = 0.50
MAX_VARIANTS_PER_CHAR = 25  # cap to keep memory + render time reasonable


def isolate_ink(rgb_arr):
    gray = rgb_arr.mean(axis=2)
    return (gray < 145).astype(np.uint8) * 255


def baseline_y_for(label, glyph_h):
    """Place baseline at bottom of glyph for non-descender letters,
    leave room for descenders. +48 legacy offset."""
    descenders = set('gjpqyäöüß,;')
    if label in descenders:
        return int(glyph_h * 0.72) + 48
    return glyph_h + 48


def segment_word(word_img_gray, text):
    """Split a word's grayscale crop into character images, one per char in text.
    Returns list of (char, np.uint8 RGBA glyph) or None if segmentation fails."""
    n = len(text)
    if n == 0:
        return None
    # Threshold ink
    ink = (word_img_gray < 145).astype(np.uint8) * 255
    if ink.sum() < 100:
        return None
    # Connected components — prefer to merge close ones for letters like i, j
    # Slight horizontal dilation to bridge gaps WITHIN a letter (like dot of i)
    h_kernel = np.array([[0]*1 + [1] + [0]*1] * 3, dtype=np.uint8)
    closed = cv2.dilate(ink, np.ones((3, 1), np.uint8), iterations=1)
    nlab, labels, stats, _ = cv2.connectedComponentsWithStats(closed)
    if nlab <= 1:
        return None
    # Collect components with min area
    comps = []
    for i in range(1, nlab):
        x, y, w, h, area = stats[i]
        if area < 20:
            continue
        comps.append((x, y, w, h, i))
    if not comps:
        return None
    # Sort left-to-right by x
    comps.sort(key=lambda c: c[0])

    # Try to merge close components (vertically aligned, gap < ~25% letter width)
    # so that, e.g., 'i' = body + dot become one component.
    merged = [comps[0]]
    for c in comps[1:]:
        last = merged[-1]
        lx1 = last[0] + last[2]
        cx0 = c[0]
        gap = cx0 - lx1
        # If horizontal overlap or tiny gap and component vertical centers within range
        cy_last = last[1] + last[3] / 2
        cy_c = c[1] + c[3] / 2
        avg_h = max(last[3], c[3])
        if gap < avg_h * 0.10 and abs(cy_last - cy_c) < avg_h * 0.9:
            # Merge
            nx = min(last[0], c[0])
            ny = min(last[1], c[1])
            nw = max(lx1, cx0 + c[2]) - nx
            nh = max(last[1] + last[3], c[1] + c[3]) - ny
            merged[-1] = (nx, ny, nw, nh, last[4])
        else:
            merged.append(c)

    # If component count doesn't match text length, give up.
    if len(merged) != n:
        return None

    rgba_glyphs = []
    for (x, y, w, h, _), ch in zip(merged, text):
        if ch not in ALLOWED_CHARS:
            continue
        # Extract the character region
        sub_ink = ink[y:y+h, x:x+w]
        sub_rgb = np.zeros((h, w, 3), dtype=np.uint8)  # rgb unused (recolored anyway)
        # Build RGBA — opacity from ink mask
        rgba = np.zeros((h, w, 4), dtype=np.uint8)
        rgba[..., 3] = sub_ink
        rgba_glyphs.append((ch, rgba))
    return rgba_glyphs


def main():
    print('Loading easyocr (German + English)...')
    reader = easyocr.Reader(['de', 'en'], gpu=False, verbose=False)

    with open(os.path.join(OUT_DIR, 'metadata.json')) as f:
        metadata = json.load(f)

    # Track how many variants we add per character
    added_count = {ch: 0 for ch in ALLOWED_CHARS}
    current_count = {ch: len(metadata.get(ch, [])) for ch in ALLOWED_CHARS}

    harvest_id = 0  # unique counter for filenames

    for pdf_path in PDFS:
        if not os.path.exists(pdf_path):
            continue
        print(f'\n{os.path.basename(pdf_path)}')
        pdf = pdfium.PdfDocument(pdf_path)
        for pnum, page in enumerate(pdf):
            img_pil = page.render(scale=2.2).to_pil().convert('RGB')
            arr = np.array(img_pil)
            results = reader.readtext(arr, paragraph=False)
            words_used = 0
            chars_added = 0
            for box, text, conf in results:
                if conf < CONF_MIN:
                    continue
                # Only words consisting of pure allowed chars
                if not text or not all(c in ALLOWED_CHARS for c in text):
                    continue
                # Crop the word region
                xs = [int(p[0]) for p in box]
                ys = [int(p[1]) for p in box]
                x0, x1 = max(0, min(xs) - 2), min(arr.shape[1], max(xs) + 2)
                y0, y1 = max(0, min(ys) - 2), min(arr.shape[0], max(ys) + 2)
                if x1 - x0 < 5 or y1 - y0 < 5:
                    continue
                word_crop = arr[y0:y1, x0:x1]
                gray = word_crop.mean(axis=2)
                segged = segment_word(gray, text)
                if segged is None:
                    continue
                words_used += 1
                for ch, rgba in segged:
                    if current_count[ch] + added_count[ch] >= MAX_VARIANTS_PER_CHAR:
                        continue
                    harvest_id += 1
                    fname = os.path.join(OUT_DIR, f"U{ord(ch):04X}_h{harvest_id}.png")
                    Image.fromarray(rgba, 'RGBA').save(fname)
                    h = rgba.shape[0]
                    w = rgba.shape[1]
                    metadata.setdefault(ch, []).append({
                        'file': fname,
                        'top_off': 0,
                        'baseline_y': baseline_y_for(ch, h),
                        'w': w,
                        'h': h,
                    })
                    added_count[ch] += 1
                    chars_added += 1
            print(f'  page {pnum+1}: {words_used} words used → {chars_added} chars')

    # Save
    with open(os.path.join(OUT_DIR, 'metadata.json'), 'w') as f:
        json.dump(metadata, f, ensure_ascii=False, indent=2)

    # Summary
    print('\n--- Harvest summary ---')
    summary = sorted(added_count.items(), key=lambda x: -x[1])
    for ch, n in summary[:30]:
        if n > 0:
            print(f'  {ch!r}: +{n} (total now {current_count[ch]+n})')
    total_added = sum(added_count.values())
    print(f'\nTotal new variants harvested: {total_added}')


if __name__ == '__main__':
    main()
