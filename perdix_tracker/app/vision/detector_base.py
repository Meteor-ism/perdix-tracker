from dataclasses import dataclass
from typing import List, Tuple


@dataclass
class Detection:
    # Bounding box: x1, y1, x2, y2
    bbox: Tuple[int, int, int, int]
    conf: float


class Detector:
    def detect(self, frame_bgr) -> List[Detection]:
        raise NotImplementedError
