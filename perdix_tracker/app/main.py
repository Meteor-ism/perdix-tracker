from __future__ import annotations

import os

from fastapi import FastAPI, File, Header, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.audit import audit_event
from app.config import Settings
from app.frame_store import get_latest_frame
from app.security import save_validated_upload
from app.vision.pipeline import make_detector, stream_tracks_over_ws

app = FastAPI(title="Perdix Video-to-Radar Tracker")


def load_settings() -> Settings:
    # Environment overrides
    s = Settings()
    s.video_path = os.getenv("VIDEO", s.video_path)
    s.detector = os.getenv("DETECTOR", s.detector)
    s.realtime = os.getenv("REALTIME", "true").lower() in ("1", "true", "yes", "y")
    s.allowed_origin = os.getenv("ALLOWED_ORIGIN", s.allowed_origin)
    s.upload_dir = os.getenv("UPLOAD_DIR", s.upload_dir)
    s.max_upload_mb = int(os.getenv("MAX_UPLOAD_MB", str(s.max_upload_mb)))
    s.audit_log_path = os.getenv("AUDIT_LOG_PATH", s.audit_log_path)
    s.api_key = os.getenv("CV_API_KEY", s.api_key)
    s.detect_every_n_frames = int(os.getenv("DETECT_EVERY_N_FRAMES", str(s.detect_every_n_frames)))
    return s


settings = load_settings()
SUPPORTED_DETECTORS = {"overlay", "yolo"}


class DetectorSelection(BaseModel):
    detector: str


def validate_detector(detector: str) -> str:
    normalized = detector.strip().lower()
    if normalized not in SUPPORTED_DETECTORS:
        raise HTTPException(
            status_code=400,
            detail=f"unsupported detector '{detector}'. allowed: {sorted(SUPPORTED_DETECTORS)}",
        )
    return normalized


def activate_detector(detector: str) -> str:
    normalized = validate_detector(detector)
    previous = settings.detector
    settings.detector = normalized
    try:
        make_detector(settings)
    except Exception as exc:
        settings.detector = previous
        raise HTTPException(status_code=400, detail=f"failed to load detector '{normalized}': {exc}")
    return normalized

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.allowed_origin, "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {
        "ok": True,
        "detector": settings.detector,
        "allowed_detectors": sorted(SUPPORTED_DETECTORS),
        "video": settings.video_path,
        "max_upload_mb": settings.max_upload_mb,
        "api_key_configured": bool(settings.api_key),
    }


@app.get("/api/detector")
def get_detector():
    return {"detector": settings.detector, "allowed_detectors": sorted(SUPPORTED_DETECTORS)}


@app.post("/api/detector")
def set_detector(selection: DetectorSelection, x_api_key: str | None = Header(default=None)):
    require_api_key(x_api_key)
    detector = activate_detector(selection.detector)
    audit_event(
        settings.audit_log_path,
        action="detector_changed",
        outcome="ok",
        details={"detector": detector},
    )
    return {"ok": True, "detector": detector, "allowed_detectors": sorted(SUPPORTED_DETECTORS)}


@app.get("/api/tracks/schema")
def track_schema():
    return {
        "item_schema": {
            "frame": 123,
            "track_id": 7,
            "bbox": [120, 64, 42, 18],
            "conf": 0.81,
        },
        "notes": "bbox is [x, y, w, h] in source-frame pixels",
    }


@app.get("/api/video/current")
def current_video():
    if not os.path.exists(settings.video_path):
        raise HTTPException(status_code=404, detail="video not found")
    return FileResponse(settings.video_path, media_type="video/mp4")


@app.get("/api/video/frame/latest")
def latest_video_frame():
    latest = get_latest_frame()
    if not latest.jpeg_bytes:
        raise HTTPException(status_code=404, detail="no processed frame available yet")

    return Response(
        content=latest.jpeg_bytes,
        media_type="image/jpeg",
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "X-Frame-Index": str(latest.frame_idx),
        },
    )


def require_api_key(x_api_key: str | None):
    if not settings.api_key:
        return
    if x_api_key != settings.api_key:
        raise HTTPException(status_code=401, detail="invalid api key")


@app.post("/api/uploads/video")
async def upload_video(
    file: UploadFile = File(...),
    x_api_key: str | None = Header(default=None),
):
    require_api_key(x_api_key)

    try:
        upload_info = await save_validated_upload(file, settings)
    except HTTPException as exc:
        audit_event(
            settings.audit_log_path,
            action="upload_rejected",
            outcome="blocked",
            details={"filename": file.filename, "reason": exc.detail},
        )
        raise

    audit_event(
        settings.audit_log_path,
        action="upload_accepted",
        outcome="ok",
        details=upload_info,
    )
    return upload_info


@app.get("/api/audit/recent")
def recent_audit(x_api_key: str | None = Header(default=None)):
    require_api_key(x_api_key)

    log_path = settings.audit_log_path
    if not os.path.exists(log_path):
        return {"events": []}

    with open(log_path, "r", encoding="utf-8") as handle:
        lines = handle.readlines()[-20:]

    return {"events": [line.strip() for line in lines if line.strip()]}


@app.websocket("/ws/tracks")
async def ws_tracks(ws: WebSocket):
    await ws.accept()
    try:
        await stream_tracks_over_ws(ws, settings, replay=False)
    except WebSocketDisconnect:
        # Client closed
        return
    except Exception as e:
        await ws.send_json({"type": "error", "message": str(e)})
        return


@app.websocket("/ws/replay")
async def ws_replay(ws: WebSocket):
    await ws.accept()
    try:
        await stream_tracks_over_ws(ws, settings, replay=True)
    except WebSocketDisconnect:
        # Client closed
        return
    except Exception as e:
        await ws.send_json({"type": "error", "message": str(e)})
        return
