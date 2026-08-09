#!/usr/bin/env python
"""One-stop renderer for handwritten solutions.

Usage:
    ./venv/bin/python solve.py solution.txt [--name "Uebungsblatt14_Loesung"]

Pipeline:
    1. validate markup (MARKUP.md rules) — hard-stops on errors
    2. render to PDF
    3. gap report: any character that was silently dropped
    4. save per-page preview PNGs to output/previews/<name>/
    5. copy PDF to ~/Downloads/<name>.pdf

The solution text file uses the markup documented in MARKUP.md.
"""
import argparse
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

from validate import report as validate_report
import render as R


def main():
    os.chdir(HERE)  # renderer reads glyphs/ and writes output/ relative to HERE
    ap = argparse.ArgumentParser()
    ap.add_argument('textfile', help='solution text file (markup per MARKUP.md)')
    ap.add_argument('--name', default=None,
                    help='output base name (default: textfile stem)')
    ap.add_argument('--force', action='store_true',
                    help='render even if validation reports errors')
    ap.add_argument('--no-copy', action='store_true',
                    help='do not copy the PDF to ~/Downloads')
    args = ap.parse_args()

    with open(args.textfile) as f:
        text = f.read()

    name = args.name or os.path.splitext(os.path.basename(args.textfile))[0]

    # ---- 1. validate ----
    print('── validate ──')
    ok = validate_report(text)
    if not ok and not args.force:
        print('\nAborting (use --force to render anyway).')
        sys.exit(1)

    # ---- 2. render ----
    print('\n── render ──')
    R.clear_dropped_chars()
    out_pdf = os.path.join('output', f'{name}.pdf')
    pages = R.render_pages(text)
    os.makedirs('output', exist_ok=True)
    pages[0].save(out_pdf, 'PDF', resolution=200.0,
                  save_all=True, append_images=pages[1:])
    print(f'{len(pages)} pages → {out_pdf}')

    # ---- 3. gap report ----
    dropped = R.get_dropped_chars()
    if dropped:
        print('\n── gap report — characters silently DROPPED ──')
        for ch, n in sorted(dropped.items(), key=lambda x: -x[1]):
            print(f"  {ch!r} (U+{ord(ch):04X})  ~{n}×")
        print('Add glyphs for these or fix the source text!')
    else:
        print('\ngap report: no dropped characters ✓')

    # ---- 4. previews ----
    prev_dir = os.path.join('output', 'previews', name)
    os.makedirs(prev_dir, exist_ok=True)
    for i, p in enumerate(pages):
        p.save(os.path.join(prev_dir, f'p{i+1}.png'))
    print(f'previews → {prev_dir}/p1..p{len(pages)}.png')

    # ---- 5. copy to Downloads ----
    if not args.no_copy:
        dest = os.path.expanduser(f'~/Downloads/{name}.pdf')
        shutil.copy(out_pdf, dest)
        print(f'copied → {dest}')


if __name__ == '__main__':
    main()
