"""Pre-render validator for handwriting markup.

Catches the recurring mistakes documented in MARKUP.md before they become
visual bugs in the PDF. Returns a list of (severity, message) tuples;
severity is 'error' (will render wrong) or 'warn' (probably unintended).
"""
import re
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))

from charset import PROCEDURAL, SUB_SUP, WHITESPACE, FALLBACKS

TAGS = ['M','F','S','B','T','X','V','H','R','D','U','I','G','DRAW']
OPEN_RE = re.compile(r'\[([A-Z]+)\]')
CLOSE_RE = re.compile(r'\[/([A-Z]+)\]')

BAD_PATTERNS = [
    (r'=/=',                'error', "'=/=' renders as literal chars — use '≠'"),
    (r'=!=',                'error', "'=!=' renders as literal chars — use '≠'"),
    (r'lim_\(',             'error', "'lim_(...)' renders literally — use 'lim[D]...[/D]'"),
    (r'∫\[D\]',             'error', "'∫[D]a[/D][U]b[/U]' misplaces limits — use '[I]a|b[/I]'"),
    (r'Σ\[D\]',             'error', "'Σ[D]..[/D]' misplaces limits — use '[S]lower|upper[/S]'"),
    (r'√[0-9a-zA-Zx(]',     'warn',  "bare '√' before content has no overbar — use '[R]content[/R]'"),
    (r'[a-zA-Z0-9)]\^',     'warn',  "caret '^' renders literally — use Unicode superscript or [U]...[/U]"),
    # note: '×' and '·' intentionally fall back to '*' — no warning needed
]


def _load_known_chars():
    try:
        with open(os.path.join(HERE, 'glyphs/metadata.json')) as f:
            return set(json.load(f).keys())
    except FileNotFoundError:
        return set()


def strip_tags(text):
    """Remove tag markers but keep tag bodies (they render as glyphs too)."""
    text = re.sub(r'\[/?[A-Z]\]', '', text)
    text = text.replace('~~', '')
    text = text.replace('\\|', '|')
    return text


def validate(text):
    issues = []

    # 1. Known bad patterns
    for pat, sev, msg in BAD_PATTERNS:
        for m in re.finditer(pat, text):
            line_no = text[:m.start()].count('\n') + 1
            issues.append((sev, f"line {line_no}: {msg}  [near: {text[max(0,m.start()-15):m.end()+10]!r}]"))

    # 2. Tag balance — handle both single-letter and multi-letter tags
    opens = [(m.group(1), m.start()) for m in OPEN_RE.finditer(text)]
    closes = [(m.group(1), m.start()) for m in CLOSE_RE.finditer(text)]
    open_counts = {}
    for t, pos in opens:
        if t in TAGS:
            open_counts[t] = open_counts.get(t, 0) + 1
    close_counts = {}
    for t, pos in closes:
        if t in TAGS:
            close_counts[t] = close_counts.get(t, 0) + 1
    for t in TAGS:
        o, c = open_counts.get(t, 0), close_counts.get(t, 0)
        if o != c:
            issues.append(('error', f"unbalanced [{t}] tags: {o} open vs {c} close"))

    # 3. [F]/[S]/[I] bodies must contain exactly one unescaped '|'
    for tag in 'FSI':
        for m in re.finditer(r'\[' + tag + r'\](.*?)\[/' + tag + r'\]', text, re.DOTALL):
            body = m.group(1)
            # Count unescaped pipes at the TOP level (ignore pipes inside nested tags)
            depth = 0
            unescaped = 0
            i = 0
            while i < len(body):
                if body[i] == '\\' and i + 1 < len(body):
                    i += 2
                    continue
                nested_open = OPEN_RE.match(body, i)
                nested_close = CLOSE_RE.match(body, i)
                if nested_open and nested_open.group(1) in TAGS:
                    depth += 1
                    i = nested_open.end()
                    continue
                if nested_close and nested_close.group(1) in TAGS:
                    depth -= 1
                    i = nested_close.end()
                    continue
                if body[i] == '|' and depth == 0:
                    unescaped += 1
                i += 1
            line_no = text[:m.start()].count('\n') + 1
            if unescaped == 0:
                issues.append(('error', f"line {line_no}: [{tag}] body has no '|' separator: {body[:40]!r}"))
            elif unescaped > 1:
                issues.append(('warn', f"line {line_no}: [{tag}] body has {unescaped} unescaped '|' — "
                                       f"only the first splits; escape literal bars as \\| : {body[:40]!r}"))

    # 4. Characters that will silently disappear
    known = _load_known_chars()
    plain = strip_tags(text)
    unknown = {}
    for ch in plain:
        if ch in WHITESPACE or ch in known or ch in PROCEDURAL or ch in SUB_SUP or ch in FALLBACKS:
            continue
        unknown[ch] = unknown.get(ch, 0) + 1
    for ch, count in sorted(unknown.items(), key=lambda x: -x[1]):
        issues.append(('error', f"char {ch!r} (U+{ord(ch):04X}) ×{count} has NO glyph and NO fallback — it will be silently dropped"))

    return issues


def report(text, print_fn=print):
    issues = validate(text)
    errors = [i for i in issues if i[0] == 'error']
    warns = [i for i in issues if i[0] == 'warn']
    if not issues:
        print_fn("validate: OK — no issues found")
        return True
    for sev, msg in errors:
        print_fn(f"  ERROR: {msg}")
    for sev, msg in warns:
        print_fn(f"  warn:  {msg}")
    print_fn(f"validate: {len(errors)} error(s), {len(warns)} warning(s)")
    return len(errors) == 0


if __name__ == '__main__':
    import sys
    if len(sys.argv) > 1:
        with open(sys.argv[1]) as f:
            text = f.read()
        ok = report(text)
        sys.exit(0 if ok else 1)
    print("usage: validate.py <solution.txt>")
