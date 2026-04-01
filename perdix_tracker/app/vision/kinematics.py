import math
from dataclasses import dataclass


@dataclass
class Kinematics:
    heading_deg: float
    speed_u: float


def heading_from_velocity(vx: float, vy: float) -> float:
    # Screen coords: +x right, +y down. We'll convert so 0 deg = up.
    # angle = atan2(dx, -dy)
    ang = math.degrees(math.atan2(vx, -vy))
    return (ang + 360.0) % 360.0


def speed_unit(vx: float, vy: float, px_per_sec_norm: float = 250.0) -> float:
    # Relative speed in [0, 1.5] approximately.
    mag = math.sqrt(vx * vx + vy * vy)
    return float(min(1.5, mag / max(1e-6, px_per_sec_norm)))
