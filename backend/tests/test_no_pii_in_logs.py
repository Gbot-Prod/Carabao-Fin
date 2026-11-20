"""CF-0087: no phone numbers, emails or addresses in log lines.

Logs go to Railway and to anyone who can read them; a buyer's number in an
info line is personal data kept for no reason (CF-0039, CF-0071, CF-0074).
"""

import ast
import logging
import re
from collections.abc import Iterator
from pathlib import Path

import pytest

from app.services import sms_service

APP_DIR = Path(__file__).resolve().parents[1] / "app"
LOG_METHODS = {"debug", "info", "warning", "error", "exception", "critical"}
LOGGER_NAMES = {"logger", "log", "logging"}
# Names that hold personal data. ``x[-4:]`` (the last 4 digits) is allowed.
PII_NAME = re.compile(r"phone|number|email|address|recipient", re.IGNORECASE)


def _pii_names(node: ast.AST) -> list[str]:
    """Names and attributes in ``node`` that look like personal data."""
    found: list[str] = []

    def visit(n: ast.AST) -> None:
        if isinstance(n, ast.Subscript) and isinstance(n.slice, ast.Slice):
            return  # a masked tail such as number[-4:]
        if isinstance(n, ast.Name) and PII_NAME.search(n.id):
            found.append(n.id)
        elif isinstance(n, ast.Attribute) and PII_NAME.search(n.attr):
            found.append(ast.unparse(n))
            return
        for child in ast.iter_child_nodes(n):
            visit(child)

    visit(node)
    return found


def _log_calls(tree: ast.AST) -> Iterator[ast.Call]:
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr in LOG_METHODS
            and isinstance(node.func.value, ast.Name)
            and node.func.value.id in LOGGER_NAMES
        ):
            yield node


def test_no_log_call_in_app_passes_personal_data() -> None:
    offenders: list[str] = []
    for path in sorted(APP_DIR.rglob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for call in _log_calls(tree):
            values = list(call.args) + [kw.value for kw in call.keywords]
            for value in values:
                if isinstance(value, ast.Constant):
                    continue
                for name in _pii_names(value):
                    rel = path.relative_to(APP_DIR.parent)
                    offenders.append(f"{rel}:{call.lineno} {name}")
    assert offenders == []


def test_guard_finds_a_number_but_allows_the_last_four() -> None:
    bad = ast.parse('logger.info("to %s", phone_number)')
    masked = ast.parse('logger.info("to ...%s", number[-4:])')
    fstring = ast.parse('logger.warning(f"to {user.verified_email}")')

    assert [_pii_names(a) for c in _log_calls(bad) for a in c.args[1:]] == [
        ["phone_number"]
    ]
    assert [_pii_names(a) for c in _log_calls(masked) for a in c.args[1:]] == [[]]
    assert [_pii_names(a) for c in _log_calls(fstring) for a in c.args] == [
        ["user.verified_email"]
    ]


def test_ship_sms_log_has_the_order_not_the_number(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    sent: list[dict[str, str]] = []
    monkeypatch.setattr(sms_service, "send_sms", lambda **kw: sent.append(kw))

    with caplog.at_level(logging.INFO, logger=sms_service.logger.name):
        sms_service.notify_order_shipped(
            phone_number="+639171234567",
            merchant_name="Farm",
            order_ref="CB-42",
            status="shipped",
        )

    assert sent and sent[0]["number"] == "+639171234567"
    assert "CB-42" in caplog.text
    assert "9171234567" not in caplog.text
