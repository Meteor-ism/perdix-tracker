from __future__ import annotations

import asyncio
import json
import time
import cv2

from app.config import Settings
from app.frame_store import set_latest_frame
from app.utils.fps import RateLimiter
from .blob_detector import BlobDetector
from .kinematics import heading_from_velocity, speed_unit
from .mapping import PixelToRadarMapper
from .overlay_detector import OverlayDetector
from .tracker import SortTracker


def make_detector(settings: Settings):
    detector_name = settings.detector.lower()
    if detector_name == "overlay":
        return OverlayDetector()
    if detector_name == "yolo":
        from .yolo_detector import YoloDetector

        return YoloDetector()
    if detector_name == "yolo-2":
        from .yolo_2_detector import Yolo2Detector

        return Yolo2Detector()
    return BlobDetector()


async def stream_tracks_over_ws(websocket, settings: Settings, *, replay: bool = False):
    """Main loop: read frames -> detect -> track -> send to WS."""

    video_path = settings.video_path
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        await websocket.send_text(
            json.dumps({"type": "error", "message": f"Could not open video: {video_path}"})
        )
        return

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    dt_target = 1.0 / max(1.0, fps)

    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 1024)
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 576)

    mapper = PixelToRadarMapper(frame_w=w, frame_h=h)
    detector_name = settings.detector
    detector = make_detector(settings)
    tracker = SortTracker()
    limiter = RateLimiter(settings.max_send_hz)

    last_t = time.time()
    frame_idx = 0

    # Send a hello so the UI can confirm dimensions
    await websocket.send_text(
        json.dumps(
            {
                "type": "hello",
                "video": video_path,
                "frame_w": w,
                "frame_h": h,
                "fps": fps,
                "mode": "replay" if replay else "live",
            }
        )
    )

    while True:
        ok, frame = cap.read()
        if not ok:
            if replay:
                cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                frame_idx = 0
                last_t = time.time()
                await websocket.send_text(json.dumps({"type": "replay_reset"}))
                continue

            await websocket.send_text(json.dumps({"type": "eof"}))
            break

        now = time.time()
        dt = max(1e-3, now - last_t)
        last_t = now
        frame_idx += 1

        if settings.detector != detector_name:
            detector_name = settings.detector
            detector = make_detector(settings)
            tracker = SortTracker()
            await websocket.send_text(json.dumps({"type": "detector_changed", "detector": detector_name}))

        ok_jpeg, jpeg_buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
        if ok_jpeg:
            set_latest_frame(frame_idx, jpeg_buf.tobytes())

        should_detect = ((frame_idx - 1) % max(1, settings.detect_every_n_frames)) == 0
        dets = detector.detect(frame) if should_detect else []
        tracks, dropped_ids = tracker.update(dets, dt=dt)

        # Send drops immediately
        for tid in dropped_ids:
            await websocket.send_text(json.dumps({"type": "track_drop", "id": tid}))

        # Limit outgoing message rate
        if limiter.ok():
            payload = {
                "type": "tracks_snapshot",
                "t": time.time(),
                "frame_idx": frame_idx,
                "playback_position_s": max(0.0, (cap.get(cv2.CAP_PROP_POS_MSEC) or 0.0) / 1000.0),
                "mode": "replay" if replay else "live",
                "tracks": [],
            }

            for tr in tracks[: settings.max_tracks]:
                if tr.age < 2 or tr.conf < 0.4:
                    continue
                rp = mapper.map(tr.cx, tr.cy)
                heading = heading_from_velocity(tr.vx, tr.vy)
                sp_u = speed_unit(tr.vx, tr.vy)

                payload["tracks"].append(
                    {
                        "frame": frame_idx,
                        "track_id": tr.track_id,
                        "bbox": [
                            int(tr.bbox[0]),
                            int(tr.bbox[1]),
                            int(tr.bbox[2] - tr.bbox[0]),
                            int(tr.bbox[3] - tr.bbox[1]),
                        ],
                        "conf": round(float(tr.conf), 4),
                        "id": tr.track_id,
                        "bearing_deg": rp.bearing_deg,
                        "range_u": rp.range_u,
                        "heading_deg": heading,
                        "speed_u": sp_u,
                        "alt_band": "UNKNOWN",
                        "confidence": tr.conf,
                        "bbox_xyxy": list(tr.bbox),
                        "px": {"cx": tr.cx, "cy": tr.cy, "vx": tr.vx, "vy": tr.vy},
                        # Simple prediction: 1s ahead
                        "pred": [
                            {"dt": 0.5, "cx": tr.cx + tr.vx * 0.5, "cy": tr.cy + tr.vy * 0.5},
                            {"dt": 1.0, "cx": tr.cx + tr.vx * 1.0, "cy": tr.cy + tr.vy * 1.0},
                        ],
                    }
                )

            await websocket.send_text(json.dumps(payload))

        # Realtime pacing
        if settings.realtime:
            # Sleep just enough to approximate source FPS
            await asyncio.sleep(max(0.0, dt_target - (time.time() - now)))

    cap.release()
