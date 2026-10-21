"""Clock for the public repo. This process does not depend on a Cursor chat.

Tester runs DM SLACK_NOTIFY_USER_ID, otherwise D0C40GC2CN8.
The 5:30 PM production run posts to #vini-cs-team.
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime

from vini_alert.csm_lookup import apply_csm, fetch_csm_lookup
from vini_alert.render import render_png
from vini_alert.sheet import fetch_alert_rows
from vini_alert.slack_client import SlackError, destinations_from_env, post_image, post_text, token_from_env
from vini_alert.table import (
    IST,
    TEST_WINDOW_END,
    hourly_test_date,
    latest_real_day,
    prepare_rows,
    production_date,
    schedule_is_open,
    title_for,
)


def window_end() -> datetime:
    raw = os.environ.get("TEST_WINDOW_END", "").strip()
    if not raw:
        return TEST_WINDOW_END
    return datetime.fromisoformat(raw)


# 21 Oct 2026 is the CSM presentation. That 5:30 PM run sends nothing.
# 22 Oct 2026 resumes: Thursday's image is Wednesday.
PRODUCTION_PAUSE_DATES = {"2026-10-21"}


def destinations(mode: str = "", env: dict | None = None) -> list[str]:
    """Production posts to the channel. Tester runs stay a DM."""
    return destinations_from_env(env, mode)


def production_paused(now: datetime) -> bool:
    return now.astimezone(IST).date().isoformat() in PRODUCTION_PAUSE_DATES


def choose(now: datetime, explicit: str, mode: str) -> tuple[str | None, str]:
    event = os.environ.get("GITHUB_EVENT_NAME", "").strip()
    resolved = mode or ("manual" if explicit else "")
    # The 5:30 PM job uses the India calendar. Sunday sends nothing.
    # Monday sends Saturday. Tuesday–Saturday send yesterday.
    # 21 Oct 2026 is paused for the CSM presentation. 22 Oct resumes.
    if event == "schedule" and resolved == "production":
        if production_paused(now):
            return None, "production"
        return production_date(now), "production"
    # The night tester stops at 3:45 AM IST. A schedule never uses a typed date.
    if event == "schedule":
        if not schedule_is_open(now, window_end()):
            return None, resolved or "hourly-test"
        return hourly_test_date(now, window_end()), resolved or "hourly-test"
    if explicit:
        return explicit, resolved or "manual"
    if resolved == "hourly-test":
        if not schedule_is_open(now, window_end()):
            return None, resolved
        return hourly_test_date(now, window_end()), resolved
    if resolved == "production":
        if production_paused(now):
            return None, "production"
        return production_date(now), resolved
    return production_date(now), "manual"


def comment_for(report_date: str, count: int) -> str:
    return title_for(report_date, count)


def run(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Render or post the VINI Accounts Alert table.")
    parser.add_argument("--date", help="YYYY-MM-DD to render. Overrides the clock.")
    parser.add_argument("--dry-run", action="store_true", help="Write the PNG only. Do not call Slack.")
    parser.add_argument("--output", default="output/vini-accounts-alert.png")
    parser.add_argument("--mode", default=os.environ.get("MODE", ""))
    args = parser.parse_args(argv)

    now = datetime.now(IST)
    mode = args.mode or ("manual" if args.date or args.dry_run else "")
    report_date, mode = choose(now, args.date or os.environ.get("REPORT_DATE", "").strip(), mode)

    if report_date is None:
        if mode == "production" and production_paused(now):
            paused = now.astimezone(IST).date().isoformat()
            print(f"Paused on {paused}. No image and no note. The next send is the following scheduled day.")
            return 0
        if mode == "hourly-test" or os.environ.get("GITHUB_EVENT_NAME", "").strip() == "schedule":
            print(
                f"Schedule no-op at {now.isoformat()}. "
                "DMs run from 9:00 PM IST on 16 Oct 2026 through 3:00 AM IST "
                f"and stop at {window_end().isoformat()}. No Slack post."
            )
            return 0
        print("Sunday in India. No image and no note.")
        return 0

    rows_raw = fetch_alert_rows()
    try:
        lookup = fetch_csm_lookup()
        print(f"CSM tab: {len(lookup['by_id'])} enterprise ids.")
    except Exception as exc:  # noqa: BLE001 — a missing CSM tab draws an em dash
        print(f"CSM tab lookup skipped: {exc}")
        lookup = {"by_id": {}}
    rows_raw = apply_csm(rows_raw, lookup)
    rows = prepare_rows(rows_raw, report_date)
    latest = latest_real_day(rows_raw)
    print(f"{report_date}: {len(rows)} alerts. Latest real day on the tab: {latest or 'none'}.")

    if not rows:
        print(
            f"No alerts for {report_date}. Nothing sent. "
            f"Latest real day on the tab: {latest or 'none'}."
        )
        return 0

    path = render_png(rows, report_date, args.output)
    print(f"Wrote {path}.")
    if args.dry_run:
        return 0
    return _send_image(path, comment_for(report_date, len(rows)), mode)


def _one_dm() -> str:
    found = destinations()
    if len(found) != 1:
        raise SlackError("Refusing to call Slack with a channel id.")
    return found[0]


def _send_text(text: str) -> int:
    try:
        token = token_from_env()
        dest = _one_dm()
        post_text(token, dest, text)
        print(f"Posted the note to {dest}.")
    except SlackError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    return 0


def _send_image(path, comment: str, mode: str = "") -> int:
    try:
        token = token_from_env()
        found = destinations(mode)
        if len(found) != 1:
            raise SlackError("Refusing to post without one destination.")
        dest = found[0]
        post_image(token, dest, path, comment, allow_channel=(mode == "production"))
        print(f"Posted the table to {dest}.")
    except SlackError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    return 0


def main(argv: list[str] | None = None) -> int:
    try:
        return run(argv)
    except Exception as exc:  # noqa: BLE001 — top-level job boundary
        print(f"VINI Accounts Alert failed: {exc}", file=sys.stderr)
        return 1
