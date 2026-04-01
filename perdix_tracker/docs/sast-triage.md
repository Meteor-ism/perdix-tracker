# Basic SAST Triage

## Reviewed Areas
- File upload handling
- Secret management
- Logging behavior
- Error exposure

## Findings
- `Medium`: upload endpoints were previously absent, which left ingestion controls undefined. Week 4 adds explicit validation and a size cap.
- `Low`: privileged endpoints can run without an API key if `CV_API_KEY` is unset. This is acceptable for local demo mode, but production should require a non-empty key.
- `Low`: audit log entries are appended as raw JSON lines and may grow indefinitely. Add rotation before multi-user deployment.
- `Info`: WebSocket error messages return exception text to the client. Keep this for demo mode only; sanitize in a deployed environment.

## Follow-up
- Add automated dependency scanning
- Add authenticated WebSocket access
- Add log rotation and retention limits
