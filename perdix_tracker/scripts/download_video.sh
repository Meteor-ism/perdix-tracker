#!/usr/bin/env bash
set -euo pipefail

mkdir -p data

# Public mirror URL found in an article referencing the DVIDS clip.
# If this URL ever stops working, replace it with another direct MP4 or download via DVIDS.
URL="https://d2feh2mec89yza.cloudfront.net/media/video/1701/DOD_103983712/DOD_103983712-1024x576-1769k.mp4"
OUT="data/perdix_swarm_demo.mp4"

echo "Downloading to $OUT"

# Use curl if present; fallback to python.
if command -v curl >/dev/null 2>&1; then
  curl -L -o "$OUT" "$URL"
elif command -v python >/dev/null 2>&1; then
  python - <<PY
import urllib.request
url = "$URL"
out = "$OUT"
urllib.request.urlretrieve(url, out)
print("saved", out)
PY
else
  echo "Need curl or python to download." >&2
  exit 1
fi

ls -lh "$OUT"
