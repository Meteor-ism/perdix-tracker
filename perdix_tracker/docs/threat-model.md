# Threat Model

## System
- React radar UI consumes `ws://localhost:8000/ws/tracks`
- FastAPI CV service processes local video or uploaded video
- Uploads are stored in `uploads/`
- Audit events are written to `logs/audit.jsonl`

## Assets
- Uploaded video files
- Track output and commander notes
- API key in `CV_API_KEY`
- Audit trail integrity

## Trust Boundaries
- Browser to CV service
- File upload to server filesystem
- Environment variables to application runtime

## Primary Threats
- Malicious uploads causing resource exhaustion or unsupported parser behavior
- Unauthorized use of privileged endpoints
- Accidental secret disclosure in source control
- Loss of operational traceability after an upload or failure

## Mitigations
- Extension and MIME validation for accepted video formats
- Configurable file size cap with early rejection
- Optional API key check on upload and audit endpoints
- `.env` excluded from git and sample values kept in `.env.example`
- JSONL audit logging for accepted and rejected uploads

## Residual Risk
- No malware scanning or content disarm pipeline yet
- WebSocket stream is unauthenticated in local demo mode
- Uploaded files remain on local disk until manually rotated
