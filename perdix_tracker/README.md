# Perdix / Drone Swarm Video-to-Radar Tracker (JROTC)

This project is a **starter backend** that:
1) reads a video file (Phase 1) or stream (Phase 2),
2) detects drone markers with a green-overlay detector, blob detector, YOLO adapter, or tiled `YOLO-2` small-object adapter,
3) tracks them over time with a SORT-style tracker (stable IDs),
4) estimates heading/speed (relative), and
5) streams **track updates** to your radar UI over **WebSocket**.

It is designed so you can start with **simple blob detection** (no ML model) and later upgrade to **YOLO**.

---

## Quick start

### 1) Create a virtual environment
```bash
python -m venv .venv
source .venv/bin/activate   # macOS/Linux
# .venv\\Scripts\\activate  # Windows PowerShell
```

### 2) Install dependencies
```bash
pip install -r requirements.txt
```

Copy env defaults and set secrets outside the repo:
```bash
cp .env.example .env
```

### 3) Get the video
DVIDS pages sometimes require login for direct download. A public mirror often exists for the 1024x576 MP4.

If you have the direct MP4 URL, run:
```bash
bash scripts/download_video.sh
```
Or just place the video at:
```
./data/perdix_swarm_demo.mp4
```

### 4) Run the server
```bash
VIDEO=./data/perdix_swarm_demo.mp4 \
DETECTOR=overlay \
uvicorn app.main:app --reload --port 8000
```

Or run it as a container:
```bash
docker build -t perdix-cv-service .
docker run --rm -p 8000:8000 -e VIDEO=./data/a.mp4 perdix-cv-service
```

### 5) Consume in the radar UI
WebSocket endpoint:
```
ws://localhost:8000/ws/tracks
```

Replay endpoint:
```
ws://localhost:8000/ws/replay
```

Messages are JSON objects with `type`:
- `tracks_snapshot` (full state)
- `track_update` (incremental)
- `track_drop` (when a track disappears)
- `replay_reset` (replay loop restarted)

Each item in `tracks_snapshot.tracks` includes the Week 3 contract:
```json
{ "frame": 123, "track_id": 7, "bbox": [x, y, w, h], "conf": 0.81 }
```

The service also exposes:
- `GET /health`
- `GET /api/tracks/schema`
- `POST /api/uploads/video`
- `GET /api/audit/recent`

Upload hardening:
- extension and MIME checks for `.mp4`, `.mov`, `.mkv`
- max upload size from `MAX_UPLOAD_MB`
- optional `CV_API_KEY` gate on privileged endpoints
- JSONL audit log at `AUDIT_LOG_PATH`

---

## Notes on real-world altitude/speed
With a single camera view, **true altitude and true speed** are not reliable unless you add:
- camera calibration (intrinsics) + known scale OR
- stereo / multi-camera OR
- telemetry.

This starter uses:
- `speed_u` = relative units (normalized)
- `alt_band` = LOW/MED/HIGH heuristic (optional)

---

## Project layout
- `app/main.py` — FastAPI app + WebSocket streaming
- `app/security.py` — upload validation and size enforcement
- `app/audit.py` — audit log writer
- `app/vision/pipeline.py` — frame loop: detect → track → kinematics → message
- `app/vision/blob_detector.py` — baseline detector (no ML)
- `app/vision/overlay_detector.py` — green overlay detector for annotated map footage
- `app/vision/yolo_detector.py` — optional YOLO detector adapter
- `app/vision/yolo_2_detector.py` — tiled YOLO detector for small dense drone symbols
- `app/vision/tracker.py` — simple multi-object tracker (IoU + velocity)
- `app/vision/mapping.py` — pixel→bearing/range mapping (relative)
- `docs/threat-model.md` — 1-page threat model for demo day
- `docs/sast-triage.md` — basic SAST findings triage

---

## License
Educational use for your JROTC class.
