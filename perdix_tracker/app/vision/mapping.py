from __future__ import annotations

import math
from dataclasses import dataclass


@dataclass
class RadarPoint:
    bearing_deg: float
    range_u: float


class PixelToRadarMapper:
    """Maps pixel position to a **relative** radar bearing/range.

    For Phase 1 training, this treats the camera as the radar origin.

    bearing: derived from x offset using assumed horizontal FOV.
    range_u: derived from y (higher = "closer" or "farther" depending on choice).

    You can later replace this with calibrated geometry.
    """

    def __init__(self, frame_w: int, frame_h: int, h_fov_deg: float = 60.0):
        self.w = frame_w
        self.h = frame_h
        self.h_fov = math.radians(h_fov_deg)

    def map(self, cx: float, cy: float) -> RadarPoint:
        # Normalize x in [-0.5, 0.5]
        nx = (cx / max(1.0, self.w)) - 0.5

        # Convert to bearing offset in radians
        bearing_offset = nx * self.h_fov
        bearing_deg = (math.degrees(bearing_offset) + 360.0) % 360.0

        # range_u based on vertical position: top = far (0), bottom = near (1)
        ny = cy / max(1.0, self.h)
        range_u = float(max(0.0, min(1.0, ny)))

        return RadarPoint(bearing_deg=bearing_deg, range_u=range_u)
