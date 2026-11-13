"""Create every backend table from the current models on an EMPTY database.

The Alembic history starts from tables that already existed, so
`alembic upgrade head` fails on a fresh database. Run this instead, then
`alembic stamp head` so future migrations apply normally.

Does not drop anything and leaves BetterAuth's tables alone.
"""

import importlib
import pkgutil
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))

import app.models as models_pkg  # noqa: E402
from sqlalchemy import text  # noqa: E402

for mod in pkgutil.iter_modules(models_pkg.__path__):
    importlib.import_module(f"app.models.{mod.name}")

from app.core.database import Base, engine  # noqa: E402

Base.metadata.create_all(engine)
with engine.begin() as conn:
    # Added by a migration (case-insensitive email), not declared on the model.
    conn.execute(text(
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_backend_users_email_lower "
        "ON backend_users (lower(email))"
    ))
print(f"Created/verified {len(Base.metadata.tables)} tables.")
