import time


class RateLimiter:
    """Simple rate limiter for outgoing messages."""

    def __init__(self, max_hz: float):
        self.min_dt = 1.0 / max_hz if max_hz and max_hz > 0 else 0.0
        self._last = 0.0

    def ok(self) -> bool:
        if self.min_dt <= 0:
            return True
        now = time.time()
        if now - self._last >= self.min_dt:
            self._last = now
            return True
        return False
