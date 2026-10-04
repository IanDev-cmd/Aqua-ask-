"""Voice-agent command bridge. ElevenLabs posts an action; the open page polls and runs it."""
from __future__ import annotations

import os
import threading
import time
from typing import Any, Optional

from fastapi import APIRouter, Header, HTTPException, Request

router = APIRouter()
_lock = threading.Lock()
_state = {
    "id": 0,
    "action": "",
    "detail": "",
    "at": 0.0,
}
_logs: list[dict[str, Any]] = []
_log_id = 0
_warned_open = False

ACTIONS = {
    "open_home": "Opening the home screen.",
    "open_globe": "Opening the 3D globe.",
    "open_maps": "Opening the 2D maps.",
    "close_maps": "Closing the map.",
    "open_ask": "Opening Ask.",
    "open_mobile": "Opening phone access.",
    "search_city": "Searching that coastal city.",
    "open_card": "Opening that card.",
    "zoom_in": "Zooming the globe in.",
    "zoom_out": "Zooming the globe out.",
    "set_layer": "Switching the globe layer.",
    "open_compass": "Opening the GPS compass.",
    "open_wallet": "Opening Wallet.",
    "open_milestone": "Opening Milestone.",
}


def _log(level: str, message: str) -> None:
    global _log_id
    with _lock:
        _log_id += 1
        _logs.append({"id": _log_id, "t": time.time(), "level": level, "message": message})
        if len(_logs) > 200:
            del _logs[:-200]


def _secret() -> str:
    return os.getenv("AGENT_WEBHOOK_SECRET", "").strip()


def _authorized(header_secret: Optional[str], authorization: Optional[str]) -> bool:
    expected = _secret()
    if not expected:
        return True
    provided = (header_secret or "").strip()
    if not provided and authorization:
        token = authorization.strip()
        if token.lower().startswith("bearer "):
            token = token[7:].strip()
        provided = token
    if len(provided) != len(expected):
        return False
    import hmac
    return hmac.compare_digest(provided, expected)


@router.post("/api/agent/command")
async def post_command(
    request: Request,
    x_agent_secret: Optional[str] = Header(default=None),
    authorization: Optional[str] = Header(default=None),
):
    global _warned_open
    if not _secret() and not _warned_open:
        _warned_open = True
        _log("warn", "AGENT_WEBHOOK_SECRET is empty, so the webhook is unlocked")
    if not _authorized(x_agent_secret, authorization):
        present = bool((x_agent_secret or "").strip() or (authorization or "").strip())
        _log("error", "webhook rejected 401: " + ("secret does not match" if present else "X-Agent-Secret header missing"))
        raise HTTPException(status_code=401, detail="Invalid agent secret.")
    try:
        raw = await request.json()
    except Exception:
        _log("error", "webhook rejected 400: body was not JSON")
        raise HTTPException(status_code=400, detail="Body must be JSON with action.")
    if not isinstance(raw, dict):
        _log("error", "webhook rejected 400: body was not an object")
        raise HTTPException(status_code=400, detail="Body must be a JSON object.")
    action = str(raw.get("action") or "").strip().lower().replace(" ", "_").replace("-", "_")
    detail_raw = raw.get("detail")
    detail = "" if detail_raw is None else str(detail_raw).strip()
    if action not in ACTIONS:
        _log("error", "webhook rejected 400: unknown action " + (action or "(empty)"))
        raise HTTPException(status_code=400, detail="Unknown action. Use one of: " + ", ".join(ACTIONS))
    with _lock:
        _state["id"] += 1
        _state["action"] = action
        _state["detail"] = detail
        _state["at"] = time.time()
        command_id = _state["id"]
    said = ACTIONS[action]
    if detail and action in ("open_maps", "search_city", "open_card", "open_ask", "set_layer"):
        said = said[:-1] + ": " + detail + "."
    _log("ok", "webhook stored #" + str(command_id) + " " + action + ((" " + detail) if detail else ""))
    return {
        "ok": True,
        "id": command_id,
        "action": action,
        "detail": detail,
        "said": said,
    }


@router.get("/api/agent/command")
def get_command(since: int = 0):
    with _lock:
        if _state["id"] <= since:
            return {"ok": True, "command": None}
        command = {
            "id": _state["id"],
            "action": _state["action"],
            "detail": _state["detail"],
            "at": _state["at"],
        }
    return {"ok": True, "command": command}


@router.get("/api/agent/logs")
def get_logs(since: int = 0):
    with _lock:
        rows = [row for row in _logs if row["id"] > since]
    return {"ok": True, "logs": rows}
