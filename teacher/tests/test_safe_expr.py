"""A clip spec carries an expression a model wrote. This is the gate that
stops that from being code execution."""
import math

import pytest

from app.performance.safe_expr import UnsafeExpression, compile_expression


def test_ordinary_maths_evaluates():
    assert compile_expression("x**2")(3) == 9
    assert compile_expression("2*x + 1")(4) == 9
    assert compile_expression("sqrt(x)")(9) == 3
    assert compile_expression("sin(x)")(0) == 0
    assert abs(compile_expression("exp(x)")(1) - math.e) < 1e-9
    assert abs(compile_expression("pi")(0) - math.pi) < 1e-9


@pytest.mark.parametrize(
    "source",
    [
        "__import__('os').system('rm -rf /')",
        "().__class__.__bases__[0].__subclasses__()",
        "open('/etc/passwd').read()",
        "eval('1+1')",
        "x.__class__",
        "[i for i in range(10)]",
        "lambda: 1",
        "os.getcwd()",
        "globals()",
        "print(1)",
    ],
)
def test_code_execution_attempts_are_rejected(source):
    with pytest.raises(UnsafeExpression):
        compile_expression(source)


def test_unknown_names_are_rejected_even_if_harmless():
    # `y` is not the plotted variable; accepting it would mean evaluating with
    # a name we never bound, which is a NameError at render time at best.
    with pytest.raises(UnsafeExpression):
        compile_expression("y + 1")


def test_a_very_long_expression_is_refused():
    with pytest.raises(UnsafeExpression):
        compile_expression("x+" * 200 + "1")


def test_syntax_errors_surface_as_unsafe_not_crashes():
    with pytest.raises(UnsafeExpression):
        compile_expression("x**")


def test_builtins_are_not_reachable_from_the_evaluation_environment():
    # Belt and braces: even with a clean AST, the environment must be bare.
    f = compile_expression("x+1")
    assert f(1) == 2
    with pytest.raises(UnsafeExpression):
        compile_expression("abs(x).real")
