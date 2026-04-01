from __future__ import annotations

from typing import List

import cv2
import numpy as np

from .detector_base import Detection, Detector


class BlobDetector(Detector):
    """Baseline detector using background subtraction + contour filtering.

    This is intentionally simple so a class can iterate quickly.
    It works best when the camera is stable and drones are small dark blobs.
    """

    def __init__(self):
        self.bg = cv2.createBackgroundSubtractorMOG2(history=300, varThreshold=32, detectShadows=False)

        # Tunables
        self.min_area = 20
        self.max_area = 140
        self.warmup_frames = 45
        self.max_detections = 12
        self._seen_frames = 0

    def detect(self, frame_bgr) -> List[Detection]:
        self._seen_frames += 1
        mask = self.bg.apply(frame_bgr)

        if self._seen_frames <= self.warmup_frames:
            return []

        # Clean noise
        mask = cv2.medianBlur(mask, 5)
        kernel = np.ones((3, 3), np.uint8)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel, iterations=1)
        mask = cv2.erode(mask, kernel, iterations=1)
        mask = cv2.morphologyEx(mask, cv2.MORPH_DILATE, kernel, iterations=1)

        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        dets: List[Detection] = []
        gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)

        h, w = frame_bgr.shape[:2]
        roi_top = int(h * 0.04)
        roi_bottom = int(h * 0.72)
        for c in contours:
            area = cv2.contourArea(c)
            if area < self.min_area or area > self.max_area:
                continue
            x, y, bw, bh = cv2.boundingRect(c)

            # Filter out huge elongated regions and border noise.
            if bw <= 2 or bh <= 2:
                continue
            aspect = bw / max(1.0, bh)
            if aspect < 0.45 or aspect > 2.8:
                continue
            if y < roi_top or y > roi_bottom:
                continue
            if x <= 2 or y <= 2 or (x + bw) >= (w - 2) or (y + bh) >= (h - 2):
                continue
            patch = gray[y : y + bh, x : x + bw]
            if patch.size == 0:
                continue
            if float(patch.mean()) > 150:
                continue

            # Clip to frame
            x1 = max(0, x)
            y1 = max(0, y)
            x2 = min(w - 1, x + bw)
            y2 = min(h - 1, y + bh)

            # Confidence heuristic: prefer compact mid-sized blobs.
            fill_ratio = area / max(1.0, bw * bh)
            conf = float(np.clip(0.55 + fill_ratio * 0.4 - (area / self.max_area) * 0.15, 0.4, 0.94))
            dets.append(Detection(bbox=(x1, y1, x2, y2), conf=conf))

        dets.sort(key=lambda det: det.conf, reverse=True)
        return dets[: self.max_detections]
