"""A small thread-safe LRU cache with an expiry, for answers from paid APIs."""

from __future__ import annotations

import time
from collections import OrderedDict
from collections.abc import Hashable
from threading import Lock
from typing import Generic, TypeVar

V = TypeVar("V")

_MISSING = object()


class TTLCache(Generic[V]):
    """At most ``maxsize`` entries, each kept for ``ttl_seconds``.

    Per process: each API worker has its own copy. That is enough to stop one
    page (or one script) from paying Mapbox again for the same question.
    """

    def __init__(self, maxsize: int, ttl_seconds: float) -> None:
        self._maxsize = maxsize
        self._ttl = ttl_seconds
        self._data: OrderedDict[Hashable, tuple[float, V]] = OrderedDict()
        self._lock = Lock()

    def get(self, key: Hashable, default: object = _MISSING) -> V | object:
        now = time.monotonic()
        with self._lock:
            entry = self._data.get(key)
            if entry is None:
                return default
            stored_at, value = entry
            if now - stored_at > self._ttl:
                del self._data[key]
                return default
            self._data.move_to_end(key)
            return value

    def put(self, key: Hashable, value: V) -> None:
        with self._lock:
            self._data[key] = (time.monotonic(), value)
            self._data.move_to_end(key)
            while len(self._data) > self._maxsize:
                self._data.popitem(last=False)

    def clear(self) -> None:
        with self._lock:
            self._data.clear()

    @staticmethod
    def missing() -> object:
        return _MISSING
