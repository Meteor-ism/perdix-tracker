from __future__ import annotations

import os
import uuid
from pathlib import Path

from fastapi import HTTPException, UploadFile

from app.config import Settings

ALLOWED_EXTENSIONS = {".mp4", ".mov", ".mkv"}
ALLOWED_CONTENT_TYPES = {"video/mp4", "video/quicktime", "video/x-matroska"}


async def save_validated_upload(file: UploadFile, settings: Settings) -> dict[str, object]:
    if not file.filename:
        raise HTTPException(status_code=400, detail="missing filename")

    suffix = Path(file.filename).suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=415, detail="unsupported file extension")

    content_type = (file.content_type or "").lower()
    if content_type and content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(status_code=415, detail="unsupported content type")

    upload_dir = Path(settings.upload_dir)
    upload_dir.mkdir(parents=True, exist_ok=True)

    safe_name = f"{uuid.uuid4().hex}{suffix}"
    output_path = upload_dir / safe_name
    max_bytes = settings.max_upload_mb * 1024 * 1024
    size = 0

    with output_path.open("wb") as handle:
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if size > max_bytes:
                handle.close()
                output_path.unlink(missing_ok=True)
                raise HTTPException(status_code=413, detail="file exceeds size limit")
            handle.write(chunk)

    await file.close()

    return {
        "ok": True,
        "filename": file.filename,
        "stored_as": safe_name,
        "bytes": size,
        "path": os.fspath(output_path),
    }
