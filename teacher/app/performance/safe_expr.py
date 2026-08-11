"""Evaluate a mathematical expression a model wrote, without running its code.

A clip spec carries things like "x**2" or "sin(x)/x". `eval()` on that is
remote code execution in a process holding the database, so the expression is
parsed to an AST and walked against a whitelist: numbers, the variable, the
arithmetic operators, and a fixed set of functions. Anything else — a name we
do not know, an attribute access, a call to something that is not in the table,
a comprehension — is rejected before evaluation, not sandboxed during it.

Same principle as everything else that has worked here: the model supplies
meaning, our code supplies execution.
"""
from __future__ import annotations

import ast
import math
from collections.abc import Callable

import numpy as np

# Functions a maths lesson legitimately needs. Vectorised, because Manim
# evaluates a plot over an array of x values.
FUNCTIONS: dict[str, Callable] = {
    "sin": np.sin, "cos": np.cos, "tan": np.tan,
    "asin": np.arcsin, "acos": np.arccos, "atan": np.arctan,
    "sinh": np.sinh, "cosh": np.cosh, "tanh": np.tanh,
    "exp": np.exp, "log": np.log, "log10": np.log10, "log2": np.log2,
    "sqrt": np.sqrt, "abs": np.abs, "floor": np.floor, "ceil": np.ceil,
    "min": np.minimum, "max": np.maximum, "sign": np.sign,
}
CONSTANTS = {"pi": math.pi, "e": math.e, "tau": math.tau}

_BIN_OPS = (ast.Add, ast.Sub, ast.Mult, ast.Div, ast.Pow, ast.Mod, ast.FloorDiv)
_UNARY_OPS = (ast.UAdd, ast.USub)


class UnsafeExpression(ValueError):
    pass


def _check(node: ast.AST, variable: str) -> None:
    if isinstance(node, ast.Expression):
        return _check(node.body, variable)
    if isinstance(node, ast.Constant):
        if isinstance(node.value, (int, float)):
            return
        raise UnsafeExpression(f"only numbers are allowed, got {node.value!r}")
    if isinstance(node, ast.Name):
        if node.id == variable or node.id in CONSTANTS:
            return
        raise UnsafeExpression(f"unknown name {node.id!r}")
    if isinstance(node, ast.BinOp):
        if not isinstance(node.op, _BIN_OPS):
            raise UnsafeExpression(f"operator {type(node.op).__name__} not allowed")
        _check(node.left, variable)
        _check(node.right, variable)
        return
    if isinstance(node, ast.UnaryOp):
        if not isinstance(node.op, _UNARY_OPS):
            raise UnsafeExpression(f"operator {type(node.op).__name__} not allowed")
        return _check(node.operand, variable)
    if isinstance(node, ast.Call):
        if not isinstance(node.func, ast.Name) or node.func.id not in FUNCTIONS:
            raise UnsafeExpression("only whitelisted functions may be called")
        if node.keywords:
            raise UnsafeExpression("keyword arguments are not allowed")
        for arg in node.args:
            _check(arg, variable)
        return
    raise UnsafeExpression(f"{type(node).__name__} is not allowed in an expression")


def compile_expression(source: str, variable: str = "x") -> Callable[[float], float]:
    """Return f(x) for a whitelisted expression, or raise UnsafeExpression."""
    if len(source) > 200:
        raise UnsafeExpression("expression too long")
    try:
        tree = ast.parse(source, mode="eval")
    except SyntaxError as exc:
        raise UnsafeExpression(f"not a valid expression: {exc.msg}") from exc
    _check(tree, variable)
    code = compile(tree, filename="<expr>", mode="eval")
    # __builtins__ emptied: even with a clean AST, leaving builtins reachable
    # would be one missed node away from being a problem.
    env = {"__builtins__": {}, **FUNCTIONS, **CONSTANTS}

    def evaluate(value):
        return eval(code, env, {variable: value})  # noqa: S307 - AST verified above

    return evaluate
