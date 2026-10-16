"""Post the PNG with Slack's external upload API. No Slack SDK."""

from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request
from pathlib import Path


class SlackError(RuntimeError):
    pass


FALLBACK_DM = "D0C40GC2CN8"
# 5:30 PM production report. #vini-cs-team.
TEAM_CHANNEL = "C0BPY9U15U5"
CHANNEL_SECRET = "SLACK_NOTIFY_VINI_CS_TEAM_CHANNEL_ID"


def is_channel_id(value: str) -> bool:
    """Public Slack channel ids start with C."""
    return str(value or "").strip()[:1].upper() == "C"


def dm_destination(env: dict | None = None) -> str:
    """SLACK_NOTIFY_USER_ID, or the fallback DM. Tester runs use this."""
    source = os.environ if env is None else env
    raw = str(source.get("SLACK_NOTIFY_USER_ID") or "").strip()
    if raw and not is_channel_id(raw):
        return raw
    return FALLBACK_DM


def channel_destination(env: dict | None = None) -> str:
    """The 5:30 PM channel. Reads only SLACK_NOTIFY_VINI_CS_TEAM_CHANNEL_ID."""
    source = os.environ if env is None else env
    raw = str(source.get(CHANNEL_SECRET) or "").strip()
    if is_channel_id(raw):
        return raw
    return TEAM_CHANNEL


def destinations_from_env(env: dict | None = None, mode: str = "") -> list[str]:
    """Production goes to the channel. Every other mode stays a DM."""
    if mode == "production":
        dest = channel_destination(env)
        if not is_channel_id(dest):
            return []
        return [dest]
    dest = dm_destination(env)
    if is_channel_id(dest):
        return []
    return [dest]


def _api(token: str, method: str, payload: dict) -> dict:
    data = urllib.parse.urlencode(payload).encode()
    request = urllib.request.Request(
        f"https://slack.com/api/{method}",
        data=data,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/x-www-form-urlencoded",
        },
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        body = json.loads(response.read().decode())
    if not body.get("ok"):
        raise SlackError(f"{method} failed: {body.get('error') or body}")
    return body


def _dm_channel(token: str, destination: str) -> str:
    """Return a DM id (D…). Never return a channel id that starts with C."""
    dest = str(destination or "").strip()
    if not dest or is_channel_id(dest):
        raise SlackError("Refusing to call Slack with a channel id.")
    if dest.startswith("D"):
        return dest
    if not dest.startswith("U"):
        raise SlackError("Slack destination must be a DM or a user id.")
    body = _api(token, "conversations.open", {"users": dest})
    opened = str((body.get("channel") or {}).get("id") or "")
    if not opened.startswith("D") or is_channel_id(opened):
        raise SlackError("Refusing to call Slack with a channel id.")
    return opened


def _destination(token: str, destination: str, allow_channel: bool) -> str:
    dest = str(destination or "").strip()
    if allow_channel and is_channel_id(dest):
        return dest
    return _dm_channel(token, dest)


def post_text(token: str, destination: str, text: str, allow_channel: bool = False) -> None:
    channel = _destination(token, destination, allow_channel)
    _api(token, "chat.postMessage", {"channel": channel, "text": text})


def post_image(token: str, destination: str, path: Path, comment: str, allow_channel: bool = False) -> None:
    """Upload vini-accounts-alert.png with the Slack file title Daily VINI Report."""
    dm = _destination(token, destination, allow_channel)
    file_bytes = path.read_bytes()
    opened = _api(
        token,
        "files.getUploadURLExternal",
        {"filename": "vini-accounts-alert.png", "length": str(len(file_bytes))},
    )
    upload = urllib.request.Request(opened["upload_url"], data=file_bytes, method="POST")
    with urllib.request.urlopen(upload, timeout=60) as response:
        response.read()
    files = json.dumps([{"id": opened["file_id"], "title": "Daily VINI Report"}])
    _api(
        token,
        "files.completeUploadExternal",
        {"files": files, "channel_id": dm, "initial_comment": comment},
    )


def token_from_env() -> str:
    token = os.environ.get("SLACK_BOT_TOKEN", "").strip()
    if not token:
        raise SlackError("SLACK_BOT_TOKEN is not set.")
    return token
