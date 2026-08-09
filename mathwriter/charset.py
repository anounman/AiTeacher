"""Single source of truth for the renderer's character set.

Shared by render.py (glyph selection) and validate.py (pre-render checks) so
the two never drift out of sync — adding a fallback or sub/superscript here
automatically updates both the renderer and the validator. See MARKUP.md for
the markup contract.
"""

# Characters with no dedicated glyph that map to another real glyph.
FALLBACKS = {
    '×': '*', '—': '-', '–': '-', '−': '-',  # all dash-likes → hyphen glyph
    '’': "'", '‘': "'", '“': '"', '”': '"',
    '·': '*', '±': '+',
    '_': '-', '\t': ' ',
    '%': '/', '#': '+', '\\': '/', '@': 'a', '&': '+',
    # Bullet and other common symbols
    '•': '*', '≲': '<', '✓': 'v',
    # Arrow variants
    '↖': '/', '↑': '|', '←': '-', '↓': '|', '↗': '/', '↘': '/', '↙': '/',
    # Backtick
    '`': "'",
    # Greek capitals that have no glyph — map to similar Latin shapes
    'Π': 'π',  # Greek capital Pi → lowercase π
    'Φ': 'F', 'Δ': 'D', 'Λ': 'A', 'Γ': 'T', 'Ω': 'O',
    'Θ': 'θ', 'Ξ': 'E', 'Ψ': 'Y', 'Σ': 'S',
}

SUPERSCRIPT_MAP = {
    '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5',
    '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
    '⁺': '+', '⁻': '-', '⁼': '=', '⁽': '(', '⁾': ')',
    'ⁱ': 'i', 'ⁿ': 'n', 'ᵃ': 'a', 'ᵇ': 'b', 'ᵏ': 'k', 'ᵐ': 'm',
    'ᵀ': 'T',
}

SUBSCRIPT_MAP = {
    '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5',
    '₆': '6', '₇': '7', '₈': '8', '₉': '9',
    '₊': '+', '₋': '−', '₌': '=', '₍': '(', '₎': ')',
    'ᵢ': 'i', 'ⱼ': 'j', 'ₖ': 'k', 'ₙ': 'n', 'ₘ': 'm', 'ₐ': 'a',
}

# Characters drawn procedurally (not from a glyph image).
PROCEDURAL = set('→≈∫✓')

WHITESPACE = set(' \n\t\x01')

# Derived sets — convenience for membership checks and validation.
SUPERSCRIPTS = set(SUPERSCRIPT_MAP.keys())
SUBSCRIPTS = set(SUBSCRIPT_MAP.keys())
SUB_SUP = SUPERSCRIPTS | SUBSCRIPTS