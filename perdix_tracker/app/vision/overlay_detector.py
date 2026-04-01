from __future__ import annotations

from typing import List

import cv2
import numpy as np

from .detector_base import Detection, Detector


class OverlayDetector(Detector):
    """Detect green tactical overlay markers instead of physical airborne objects.

    The source video appears to contain rendered green drone symbols on a map-like
    background, so a color/shape detector is a better baseline than motion blobs.
    """

    def __init__(self):
        self.min_area = 6
        self.max_area = 160
        self.max_detections = 40
        self.top_crop_ratio = 0.08
        self.bottom_crop_ratio = 0.12
        self._prev_gray = None

    def detect(self, frame_bgr) -> List[Detection]:
        b = frame_bgr[:, :, 0].astype(np.int16)
        g = frame_bgr[:, :, 1].astype(np.int16)
        r = frame_bgr[:, :, 2].astype(np.int16)

        # The source is mostly grayscale map imagery. Drone markers stand out
        # because they are small colored components, with green stronger than
        # both red and blue.
        colorfulness = np.maximum.reduce([np.abs(g - r), np.abs(g - b), np.abs(r - b)])
        excess_green = (2 * g) - r - b

        color_mask = ((colorfulness > 18) & (excess_green > 28) & (g > 45)).astype(np.uint8) * 255

        gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
        if self._prev_gray is None:
            self._prev_gray = gray
            return []

        motion = cv2.absdiff(gray, self._prev_gray)
        self._prev_gray = gray
        motion_mask = (motion > 14).astype(np.uint8) * 255

        mask = cv2.bitwise_and(color_mask, motion_mask)

        kernel = np.ones((3, 3), np.uint8)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel, iterations=1)
        mask = cv2.dilate(mask, kernel, iterations=1)

        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        dets: List[Detection] = []
        h, w = frame_bgr.shape[:2]
        top_crop = int(h * self.top_crop_ratio)
        bottom_crop = int(h * (1.0 - self.bottom_crop_ratio))

        for contour in contours:
            area = cv2.contourArea(contour)
            if area < self.min_area or area > self.max_area:
                continue

            x, y, bw, bh = cv2.boundingRect(contour)
            if bw <= 2 or bh <= 2:
                continue

            aspect = bw / max(1.0, bh)
            if aspect < 0.35 or aspect > 3.2:
                continue
            if y < top_crop or (y + bh) > bottom_crop:
                continue

            x1 = max(0, x)
            y1 = max(0, y)
            x2 = min(w - 1, x + bw)
            y2 = min(h - 1, y + bh)

            roi_color = color_mask[y1:y2, x1:x2]
            roi_motion = motion[y1:y2, x1:x2]
            if roi_color.size == 0 or roi_motion.size == 0:
                continue

            fill_ratio = area / max(1.0, bw * bh)
            green_ratio = float((roi_color > 0).mean())
            motion_level = float(roi_motion.mean()) / 255.0
            conf = float(np.clip(0.18 + fill_ratio * 0.24 + green_ratio * 0.28 + motion_level * 0.34, 0.25, 0.94))

            dets.append(Detection(bbox=(x1, y1, x2, y2), conf=conf))

        dets.sort(key=lambda det: det.conf, reverse=True)
        return dets[: self.max_detections]
