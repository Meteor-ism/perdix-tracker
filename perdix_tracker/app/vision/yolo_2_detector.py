from __future__ import annotations

from typing import List

from .detector_base import Detection, Detector


class Yolo2Detector(Detector):
    """Lightweight YOLO variant using a slightly smaller inference size.

    This intentionally mirrors the standard YOLO adapter instead of doing tiled
    inference. The smaller `imgsz` reduces load a bit without shrinking so far
    that it becomes unusable on typical class/demo hardware.
    """

    def __init__(self, model_name: str = "yolov8n.pt", conf: float = 0.25, imgsz: int = 512):
        from ultralytics import YOLO  # type: ignore

        self.model = YOLO(model_name)
        self.conf = conf
        self.imgsz = imgsz

    def detect(self, frame_bgr) -> List[Detection]:
        results = self.model.predict(frame_bgr, conf=self.conf, imgsz=self.imgsz, verbose=False)
        r0 = results[0]
        dets: List[Detection] = []

        if r0.boxes is None:
            return dets

        for box in r0.boxes:
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            conf = float(box.conf[0].item())
            dets.append(Detection(bbox=(int(x1), int(y1), int(x2), int(y2)), conf=conf))

        return dets
