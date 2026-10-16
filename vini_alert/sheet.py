"""Read the Alerts tab. The link-viewable CSV needs no Google login."""

from __future__ import annotations

import csv
import io
import os
import urllib.request

SPREADSHEET_ID = "1Mgg5Xrrkza55VcsofSPOsKWdo1-zFO19luusZUt0-Ww"
ALERTS_GID = "818793773"

PUBLIC_CSV = (
    "https://docs.google.com/spreadsheets/d/"
    f"{SPREADSHEET_ID}/export?format=csv&gid={ALERTS_GID}"
)


def fetch_alert_rows(url: str | None = None) -> list[dict]:
    target = url or os.environ.get("ALERTS_CSV_URL") or PUBLIC_CSV
    request = urllib.request.Request(target, headers={"User-Agent": "vini-accounts-alert/2026-10-16"})
    with urllib.request.urlopen(request, timeout=60) as response:
        raw = response.read()
    text = raw.decode("utf-8-sig", errors="replace")
    stripped = text.lstrip()
    if stripped.startswith("<") or stripped.startswith("{"):
        raise RuntimeError(
            "The Alerts tab did not come back as CSV. The tracker must stay "
            "viewable by anyone with the link, or set a service-account reader later."
        )
    rows = list(csv.DictReader(io.StringIO(text)))
    if rows and "Date" not in rows[0]:
        raise RuntimeError("Alerts CSV is missing the Date column.")
    return rows
