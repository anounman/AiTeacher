"""Tests for the markup validator (validate.py).

Run with:
    ./venv/bin/python -m unittest test_validate
or just:
    ./venv/bin python test_validate.py

These lock in the MARKUP.md contract so edits to render.py / charset.py
can't silently change what the validator accepts.
"""
import unittest

from validate import validate, report


def errors(text):
    return [msg for sev, msg in validate(text) if sev == 'error']


def warns(text):
    return [msg for sev, msg in validate(text) if sev == 'warn']


class GoodMarkup(unittest.TestCase):
    def test_clean_text_passes(self):
        self.assertEqual(validate("~~Aufgabe 1~~\n\nx² + y = [F]1|2[/F]  ✓"), [])

    def test_fraction_with_escaped_bar_passes(self):
        # |a| over x — the literal bars are escaped, only one real separator
        self.assertEqual(errors("[F]\\|a\\||x[/F]"), [])

    def test_nested_constructs_pass(self):
        self.assertEqual(errors("[B]c = ± [F]1|5[/F][/B]"), [])

    def test_integral_and_sum_pass(self):
        self.assertEqual(errors("[I]0|1[/I] x² dx   [S]k=0|n[/S] k"), [])

    def test_report_returns_true_for_clean(self):
        self.assertTrue(report("~~A~~\n\nx = 1", print_fn=lambda *a: None))


class BadPatterns(unittest.TestCase):
    def test_not_equal_slash(self):
        self.assertTrue(any("=/" in m for m in errors("a =/= 0")))

    def test_not_equal_bang(self):
        self.assertTrue(any("=!" in m for m in errors("a =!= 0")))

    def test_lim_paren(self):
        self.assertTrue(errors("lim_(h→0)"))

    def test_integral_with_D(self):
        self.assertTrue(errors("∫[D]a[/D][U]b[/U]"))

    def test_bare_sqrt_warns(self):
        self.assertTrue(warns("√7"))


class TagBalance(unittest.TestCase):
    def test_unbalanced_box(self):
        self.assertTrue(any("[B]" in m for m in errors("[B]answer")))

    def test_unbalanced_close(self):
        self.assertTrue(any("[F]" in m for m in errors("x[/F]")))

    def test_balanced_tags_no_balance_error(self):
        msgs = errors("[B]hi[/B] [F]1|2[/F] [M]1,2;3,4[/M]")
        self.assertFalse(any("unbalanced" in m for m in msgs))


class FractionSeparator(unittest.TestCase):
    def test_missing_pipe_is_error(self):
        self.assertTrue(any("no '|' separator" in m for m in errors("[F]12[/F]")))

    def test_two_unescaped_pipes_is_warn(self):
        # only the first | splits; the second is a likely-unescaped literal bar
        self.assertTrue(any("unescaped '|'" in m for m in warns("[F]1|2|3[/F]")))

    def test_escaped_pipe_does_not_count(self):
        self.assertEqual(errors("[F]\\|x\\||y[/F]"), [])


class UnknownChars(unittest.TestCase):
    def test_emoji_has_no_glyph(self):
        # an emoji is certainly not a harvested handwriting glyph and has no
        # fallback, so the validator must flag it as silently-dropped.
        msgs = errors("hi 😀 there")
        self.assertTrue(any("NO glyph" in m for m in msgs))

    def test_known_special_not_flagged(self):
        # ≈ is procedural, ∫ is procedural — neither should be "unknown"
        msgs = errors("≈ ∫ →")
        self.assertFalse(any("NO glyph" in m for m in msgs))


if __name__ == '__main__':
    unittest.main()