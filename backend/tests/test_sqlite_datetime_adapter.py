"""CF-0092: the sqlite3 adapters registered in conftest keep the stored text
the same as Python's old built-in adapters, and send no DeprecationWarning."""

import warnings
from datetime import UTC, date, datetime

from sqlalchemy import create_engine, text


def test_plain_sql_dates_keep_the_old_text_form_without_warning() -> None:
    engine = create_engine("sqlite://")
    when = datetime(2026, 11, 20, 9, 30, 15, 123456, tzinfo=UTC)
    with warnings.catch_warnings():
        warnings.simplefilter("error", DeprecationWarning)
        with engine.connect() as conn:
            row = conn.execute(
                text("SELECT CAST(:when AS TEXT), CAST(:day AS TEXT)"),
                {"when": when, "day": date(2026, 11, 20)},
            ).one()

    assert row == ("2026-11-20 09:30:15.123456+00:00", "2026-11-20")
