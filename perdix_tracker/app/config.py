from pydantic import BaseModel


class Settings(BaseModel):
    # Video path for Phase 1
    video_path: str = "./data/a.mp4"

    # Detector choice: 'overlay' (default), 'blob', 'yolo', or 'yolo-2'
    detector: str = "overlay"

    # Stream timing: if True, sleeps to match source FPS (more "real-time")
    realtime: bool = True

    # Max tracks sent per frame (safety)
    max_tracks: int = 200

    # WebSocket send frequency limit (Hz). Helps avoid overwhelming the UI.
    max_send_hz: float = 15.0

    # Detector throttling for heavier models like YOLO-2.
    detect_every_n_frames: int = 1

    # Frontend origin for local development.
    allowed_origin: str = "http://localhost:5173"

    # Upload hardening.
    upload_dir: str = "./uploads"
    max_upload_mb: int = 150
    audit_log_path: str = "./logs/audit.jsonl"

    # Optional API key for privileged endpoints.
    api_key: str = ""


settings = Settings()
