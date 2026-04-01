from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

import numpy as np

from .detector_base import Detection


def iou(a: Tuple[int, int, int, int], b: Tuple[int, int, int, int]) -> float:
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    inter_x1 = max(ax1, bx1)
    inter_y1 = max(ay1, by1)
    inter_x2 = min(ax2, bx2)
    inter_y2 = min(ay2, by2)

    iw = max(0, inter_x2 - inter_x1)
    ih = max(0, inter_y2 - inter_y1)
    inter = iw * ih

    area_a = max(0, ax2 - ax1) * max(0, ay2 - ay1)
    area_b = max(0, bx2 - bx1) * max(0, by2 - by1)
    union = area_a + area_b - inter

    return (inter / union) if union > 0 else 0.0


@dataclass
class Track:
    track_id: int
    bbox: Tuple[int, int, int, int]
    conf: float
    age: int = 0
    misses: int = 0

    # Center + velocity (pixels/sec)
    cx: float = 0.0
    cy: float = 0.0
    vx: float = 0.0
    vy: float = 0.0


class MultiObjectTracker:
    """A lightweight tracker:

    - matches detections to tracks by IoU
    - smooths center position
    - estimates velocity from delta-center / dt

    This is not as strong as ByteTrack/DeepSORT but is perfect for a class starter.
    """

    def __init__(
        self,
        iou_threshold: float = 0.1,
        max_misses: int = 12,
        ema_alpha: float = 0.6,
    ):
        self.iou_threshold = iou_threshold
        self.max_misses = max_misses
        self.ema_alpha = ema_alpha
        self._next_id = 1
        self.tracks: Dict[int, Track] = {}

    def _bbox_center(self, bb: Tuple[int, int, int, int]) -> Tuple[float, float]:
        x1, y1, x2, y2 = bb
        return (x1 + x2) / 2.0, (y1 + y2) / 2.0

    def update(self, detections: List[Detection], dt: float) -> Tuple[List[Track], List[int]]:
        """Returns (active_tracks, dropped_track_ids)."""

        dt = max(dt, 1e-6)
        track_ids = list(self.tracks.keys())

        # Greedy matching
        unmatched_dets = set(range(len(detections)))
        unmatched_tracks = set(track_ids)

        matches: List[Tuple[int, int]] = []  # (track_id, det_index)

        for tid in track_ids:
            best = None
            best_iou = 0.0
            for di in list(unmatched_dets):
                val = iou(self.tracks[tid].bbox, detections[di].bbox)
                if val > best_iou:
                    best_iou = val
                    best = di
            if best is not None and best_iou >= self.iou_threshold:
                matches.append((tid, best))
                unmatched_dets.discard(best)
                unmatched_tracks.discard(tid)

        # Update matched tracks
        for tid, di in matches:
            det = detections[di]
            tr = self.tracks[tid]
            new_cx, new_cy = self._bbox_center(det.bbox)

            # EMA smoothing on center
            sm_cx = self.ema_alpha * new_cx + (1 - self.ema_alpha) * tr.cx
            sm_cy = self.ema_alpha * new_cy + (1 - self.ema_alpha) * tr.cy

            # Velocity estimate
            vx = (sm_cx - tr.cx) / dt
            vy = (sm_cy - tr.cy) / dt

            tr.bbox = det.bbox
            tr.conf = det.conf
            tr.age += 1
            tr.misses = 0
            tr.vx = 0.7 * vx + 0.3 * tr.vx
            tr.vy = 0.7 * vy + 0.3 * tr.vy
            tr.cx = sm_cx
            tr.cy = sm_cy

        # Unmatched tracks: increment misses
        dropped: List[int] = []
        for tid in list(unmatched_tracks):
            tr = self.tracks[tid]
            tr.age += 1
            tr.misses += 1
            # Predict forward (constant velocity)
            tr.cx = tr.cx + tr.vx * dt
            tr.cy = tr.cy + tr.vy * dt

            if tr.misses > self.max_misses:
                dropped.append(tid)
                del self.tracks[tid]

        # New tracks from unmatched detections
        for di in unmatched_dets:
            det = detections[di]
            cx, cy = self._bbox_center(det.bbox)
            tid = self._next_id
            self._next_id += 1
            self.tracks[tid] = Track(
                track_id=tid,
                bbox=det.bbox,
                conf=det.conf,
                cx=cx,
                cy=cy,
            )

        return list(self.tracks.values()), dropped


class SortTracker(MultiObjectTracker):
    """SORT-style tracker alias for clearer API naming."""
