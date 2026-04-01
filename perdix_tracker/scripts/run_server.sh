#!/usr/bin/env bash
set -euo pipefail

mkdir -p data

: "${VIDEO:=./data/perdix_swarm_demo.mp4}"
: "${DETECTOR:=blob}"
: "${REALTIME:=true}"

export VIDEO DETECTOR REALTIME

uvicorn app.main:app --reload --port 8000
