"""Harvest glyph variants from real handwritten PDFs using Apple Vision OCR.

Much faster than easyocr on macOS (uses on-device CoreML models).
Same pipeline: detect words → segment each word into characters via ink
connected-components → save labeled glyphs."""
import os, json
import numpy as np
import cv2
from PIL import Image
import pypdfium2 as pdfium

import Vision
import Quartz
from Foundation import NSURL
import objc

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
ALLOWED = set(
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789äöüßÄÖÜ"
)
MAX_VARIANTS = 30


def baseline_y_for(label, h):
    descenders = set('gjpqyäöüß,;')
    if label in descenders:
        return int(h * 0.72) + 48
    return h + 48


def pil_to_cgimage(pil_img):
    """Convert PIL RGBA image to CGImage for Vision."""
    pil = pil_img.convert('RGBA')
    w, h = pil.size
    raw = pil.tobytes('raw', 'RGBA')
    data_provider = Quartz.CGDataProviderCreateWithCFData(raw)
    cs = Quartz.CGColorSpaceCreateDeviceRGB()
    bmp_info = Quartz.kCGBitmapByteOrder32Big | Quartz.kCGImageAlphaPremultipliedLast
    cg = Quartz.CGImageCreate(
        w, h, 8, 32, w * 4, cs, bmp_info, data_provider, None, False, Quartz.kCGRenderingIntentDefault
    )
    return cg, w, h


def ocr_page(pil_img, languages=('de-DE', 'en-US')):
    """Run Apple Vision on a PIL image. Returns list of (text, bbox).
    bbox is (x, y, w, h) in image pixel coords (top-left origin)."""
    cg, W, H = pil_to_cgimage(pil_img)
    handler = Vision.VNImageRequestHandler.alloc().initWithCGImage_options_(cg, None)
    request = Vision.VNRecognizeTextRequest.alloc().init()
    request.setRecognitionLevel_(Vision.VNRequestTextRecognitionLevelAccurate)
    request.setUsesLanguageCorrection_(True)
    request.setRecognitionLanguages_(list(languages))
    error = None
    success = handler.performRequests_error_([request], error)
    out = []
    if not request.results():
        return out
    for obs in request.results():
        # Each obs may contain multiple words on a line. Use topCandidates(1).
        for candidate in obs.topCandidates_(1):
            text = candidate.string()
            if not text:
                continue
            # Iterate over each word's bounding box by splitting candidate range
            # Simpler: obs.boundingBox is the full line. We need per-word boxes.
            # Use boundingBoxForRange to get sub-ranges per word.
            words = text.split()
            cursor = 0
            for w in words:
                idx = text.find(w, cursor)
                if idx < 0:
                    cursor += len(w) + 1
                    continue
                # Build NSRange manually
                ns_range = (idx, len(w))
                try:
                    box_obs = candidate.boundingBoxForRange_error_(ns_range, None)
                    if box_obs is None:
                        cursor = idx + len(w) + 1
                        continue
                    bb = box_obs[0].boundingBox()
                except Exception:
                    cursor = idx + len(w) + 1
                    continue
                # bb is normalized (0..1), origin BOTTOM-LEFT
                x = int(bb.origin.x * W)
                y = int((1 - bb.origin.y - bb.size.height) * H)
                bw = int(bb.size.width * W)
                bh = int(bb.size.height * H)
                out.append((w, (x, y, bw, bh)))
                cursor = idx + len(w) + 1
    return out


def segment_word(word_rgb, text):
    n = len(text)
    if n == 0:
        return None
    gray = word_rgb.mean(axis=2)
    ink = (gray < 145).astype(np.uint8) * 255
    if ink.sum() < 50:
        return None
    # Vertical-only dilation to bridge dots with bodies
    closed = cv2.dilate(ink, np.ones((3, 1), np.uint8), iterations=1)
    nlab, labels, stats, _ = cv2.connectedComponentsWithStats(closed)
    comps = []
    for i in range(1, nlab):
        x, y, w, h, area = stats[i]
        if area < 20:
            continue
        comps.append((x, y, w, h))
    if not comps:
        return None
    comps.sort(key=lambda c: c[0])
    # Merge close components (likely accents / dots fused with body)
    merged = [comps[0]]
    for c in comps[1:]:
        last = merged[-1]
        lx1 = last[0] + last[2]
        gap = c[0] - lx1
        avg_h = max(last[3], c[3])
        if gap < avg_h * 0.10:
            nx = min(last[0], c[0])
            ny = min(last[1], c[1])
            nw = max(lx1, c[0] + c[2]) - nx
            nh = max(last[1] + last[3], c[1] + c[3]) - ny
            merged[-1] = (nx, ny, nw, nh)
        else:
            merged.append(c)
    if len(merged) != n:
        return None
    out = []
    for (x, y, w, h), ch in zip(merged, text):
        if ch not in ALLOWED:
            continue
        sub_ink = ink[y:y+h, x:x+w]
        rgba = np.zeros((h, w, 4), dtype=np.uint8)
        rgba[..., 3] = sub_ink
        out.append((ch, rgba))
    return out


def main():
    with open(os.path.join(OUT_DIR, 'metadata.json')) as f:
        metadata = json.load(f)
    current = {ch: len(metadata.get(ch, [])) for ch in ALLOWED}
    added = {ch: 0 for ch in ALLOWED}
    hid = 0

    for pdf_path in PDFS:
        if not os.path.exists(pdf_path):
            continue
        print(f'\n{os.path.basename(pdf_path)}')
        pdf = pdfium.PdfDocument(pdf_path)
        for pnum, page in enumerate(pdf):
            pil = page.render(scale=2.0).to_pil().convert('RGB')
            arr = np.array(pil)
            words = ocr_page(pil)
            chars_added = 0
            for text, (x, y, w, h) in words:
                if w < 10 or h < 8:
                    continue
                # Filter: only words made entirely of allowed chars
                if not all(c in ALLOWED for c in text):
                    continue
                if len(text) > 18:
                    continue
                pad = 4
                x0 = max(0, x - pad)
                y0 = max(0, y - pad)
                x1 = min(arr.shape[1], x + w + pad)
                y1 = min(arr.shape[0], y + h + pad)
                crop = arr[y0:y1, x0:x1]
                segged = segment_word(crop, text)
                if segged is None:
                    continue
                for ch, rgba in segged:
                    if current[ch] + added[ch] >= MAX_VARIANTS:
                        continue
                    hid += 1
                    fname = os.path.join(OUT_DIR, f"U{ord(ch):04X}_v{hid}.png")
                    Image.fromarray(rgba, 'RGBA').save(fname)
                    h_g = rgba.shape[0]
                    metadata.setdefault(ch, []).append({
                        'file': fname,
                        'top_off': 0,
                        'baseline_y': baseline_y_for(ch, h_g),
                        'w': rgba.shape[1],
                        'h': h_g,
                    })
                    added[ch] += 1
                    chars_added += 1
            print(f'  page {pnum+1}: {len(words)} words → {chars_added} chars added')

    with open(os.path.join(OUT_DIR, 'metadata.json'), 'w') as f:
        json.dump(metadata, f, ensure_ascii=False, indent=2)

    total = sum(added.values())
    print(f'\nTotal new variants: {total}')
    for ch, n in sorted(added.items(), key=lambda x: -x[1])[:30]:
        if n > 0:
            print(f'  {ch!r}: +{n} (total {current[ch]+n})')


if __name__ == '__main__':
    main()
