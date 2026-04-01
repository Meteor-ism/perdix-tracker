from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any


def audit_event(log_path: str, action: str, outcome: str, details: dict[str, Any]) -> None:
    os.makedirs(os.path.dirname(log_path), exist_ok=True)
    payload = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "action": action,
        "outcome": outcome,
        "details": details,
    }
    with open(log_path, "a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload) + "\n")
