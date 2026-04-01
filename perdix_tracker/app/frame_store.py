from __future__ import annotations

from dataclasses import dataclass
from threading import Lock


@dataclass
class LatestFrame:
    frame_idx: int = 0
    jpeg_bytes: bytes | None = None


_latest = LatestFrame()
_lock = Lock()


def set_latest_frame(frame_idx: int, jpeg_bytes: bytes) -> None:
    with _lock:
        _latest.frame_idx = frame_idx
        _latest.jpeg_bytes = jpeg_bytes


def get_latest_frame() -> LatestFrame:
    with _lock:
        return LatestFrame(frame_idx=_latest.frame_idx, jpeg_bytes=_latest.jpeg_bytes)
