"""Feature switches for features that are built but turned off for now.

Read from the environment on each call so tests (and a restart with a new env)
pick them up. Every switch defaults to off.
"""

import os

_TRUE = {"1", "true", "yes", "on"}


def two_factor_enabled() -> bool:
    """E8 two-step verification. Off unless TWO_FACTOR_ENABLED=true.

    Must match NEXT_PUBLIC_FEATURE_TWO_FACTOR on the web. When off, admins are
    not required to have it.
    """
    return os.getenv("TWO_FACTOR_ENABLED", "false").strip().lower() in _TRUE
