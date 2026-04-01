from __future__ import annotations

from typing import List

from .detector_base import Detection, Detector


class YoloDetector(Detector):
    """YOLO detector adapter (optional).

    Install:
      pip install ultralytics

    Then set:
      DETECTOR=yolo

    NOTE: For drones-in-sky you will likely need custom training or at least fine-tuning.
    """

    def __init__(self, model_name: str = "yolov8n.pt", conf: float = 0.25):
        from ultralytics import YOLO  # type: ignore

        self.model = YOLO(model_name)
        self.conf = conf

    def detect(self, frame_bgr) -> List[Detection]:
        results = self.model.predict(frame_bgr, conf=self.conf, verbose=False)
        r0 = results[0]
        dets: List[Detection] = []

        if r0.boxes is None:
            return dets

        for b in r0.boxes:
            x1, y1, x2, y2 = b.xyxy[0].tolist()
            conf = float(b.conf[0].item())
            dets.append(Detection(bbox=(int(x1), int(y1), int(x2), int(y2)), conf=conf))

        return dets
