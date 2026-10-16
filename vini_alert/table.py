"""Turn Alerts-tab rows into the dark-table rows for one date."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

IST = ZoneInfo("Asia/Kolkata")

BACKFILL_PREFIX = "Metabase 4-file backfill"

AGENT_ORDER = ["Sales IB", "Sales OB", "Service IB", "Service OB"]
METRIC_ORDER = ["Attempts", "Connects", "Qualified", "Appt"]

AGENT_LABELS = {
    "sales inbound": "Sales IB",
    "sales ib": "Sales IB",
    "sales outbound": "Sales OB",
    "sales ob": "Sales OB",
    "service inbound": "Service IB",
    "service ib": "Service IB",
    "service outbound": "Service OB",
    "service ob": "Service OB",
}

RULE_LABELS = {
    "attempts_low": "Attempts",
    "engaged_pct": "Connects",
    "qualified_pct": "Qualified",
    "appt_rate": "Appt",
    "attempts": "Attempts",
    "connects": "Connects",
    "qualified": "Qualified",
    "appt": "Appt",
}

# One date per Asia/Kolkata hour. Hour 3 on 17 Oct 2026 is 2026-10-15,
# the next date after 2026-10-14, and not reused from hours 21–2.
HOURLY_TEST_DATES = [
    "2026-10-12",
    "2026-10-08",
    "2026-10-07",
    "2026-10-06",
    "2026-10-05",
    "2026-10-03",
    "2026-10-14",
    "2026-10-15",
    "2026-10-02",
    "2026-10-13",
]

# 9:00 PM IST on 16 Oct 2026 through 3:00 AM IST. Closed at 3:45 AM IST on 17 Oct.
DM_WINDOW_START = datetime(2026, 10, 16, 21, 0, tzinfo=IST)
TEST_WINDOW_END = datetime(2026, 10, 17, 3, 45, tzinfo=IST)

BLANK_CSM = "—"
EMPTY_CSM = {"", "—", "-", "unassigned", "n/a", "na"}


def agent_label(raw: str) -> str:
    key = " ".join(str(raw or "").strip().lower().split())
    return AGENT_LABELS.get(key, str(raw or "").strip())


def metric_label(rule: str) -> str:
    key = str(rule or "").strip().lower()
    return RULE_LABELS.get(key, str(rule or "").strip())


def csm_label(raw: str) -> str:
    """Show the CSM Name cell as stored. Do not strip an email domain."""
    text = " ".join(str(raw or "").split())
    if text.lower() in EMPTY_CSM:
        return BLANK_CSM
    return text or BLANK_CSM


def issue_text(value: str, threshold: str, notes: str) -> str:
    value = str(value or "").strip()
    threshold = str(threshold or "").strip()
    notes = str(notes or "").strip()
    if value and threshold:
        if threshold.startswith("(") and threshold.endswith(")"):
            return f"{value} {threshold}"
        return f"{value} ({threshold})"
    if value:
        return value
    return notes


def _day(value: str) -> str:
    text = str(value or "").strip()
    return text[:10]


def prepare_rows(raw_rows: list[dict], report_date: str) -> list[dict]:
    """Keep one date, drop backfill, and keep the copy that has a CSM."""
    wanted = _day(report_date)
    chosen: dict[tuple, dict] = {}
    for row in raw_rows:
        day = _day(row.get("Date") or row.get("date") or "")
        if day != wanted:
            continue
        notes = str(row.get("Notes") or row.get("notes") or "")
        if notes.startswith(BACKFILL_PREFIX):
            continue
        agent = agent_label(row.get("Agent") or row.get("agent") or "")
        rooftop = " ".join(str(row.get("rooftop_name") or row.get("Rooftop") or "").split())
        rule = str(row.get("Rule") or row.get("rule") or "").strip()
        if not agent or not rooftop or not rule:
            continue
        metric = metric_label(rule)
        csm = csm_label(row.get("CSM") or row.get("csm") or "")
        item = {
            "agent": agent,
            "rooftop": rooftop,
            "metric": metric,
            "issue": issue_text(row.get("Value") or "", row.get("Threshold") or "", notes),
            "csm": csm,
        }
        key = (agent, rooftop.lower(), rule.lower())
        prev = chosen.get(key)
        if prev is None or (csm != BLANK_CSM and prev["csm"] == BLANK_CSM):
            chosen[key] = item

    def sort_key(item: dict) -> tuple:
        agent_idx = AGENT_ORDER.index(item["agent"]) if item["agent"] in AGENT_ORDER else len(AGENT_ORDER)
        metric_idx = METRIC_ORDER.index(item["metric"]) if item["metric"] in METRIC_ORDER else len(METRIC_ORDER)
        return (agent_idx, item["rooftop"].lower(), metric_idx, item["issue"])

    return sorted(chosen.values(), key=sort_key)


def latest_real_day(raw_rows: list[dict]) -> str:
    days = []
    for row in raw_rows:
        day = _day(row.get("Date") or "")
        notes = str(row.get("Notes") or "")
        if not day or notes.startswith(BACKFILL_PREFIX):
            continue
        if not str(row.get("Agent") or "").strip():
            continue
        days.append(day)
    return max(days) if days else ""


def title_for(report_date: str, count: int) -> str:
    day = date.fromisoformat(_day(report_date))
    label = f"{day.strftime('%a')} {day.strftime('%b')} {day.day}"
    noun = "alert" if count == 1 else "alerts"
    return f"VINI Accounts Alert | {label} | {count} {noun}"


RULE_LINES = (
    "Connects flagged when below absolute floor (IB 50%, OB 5%) over the 7-day / 3-day window.",
    "Qualified and Appt flagged when 50% / 5% below that rooftop’s 30-day history. Attempts IB when the 3-day average is under 50/day. Attempts OB when that day is under 5/day.",
)


def production_date(now: datetime) -> str | None:
    """Tuesday–Saturday → yesterday. Monday → Saturday. Sunday → nothing."""
    local = now.astimezone(IST)
    weekday = local.weekday()
    if weekday == 6:
        return None
    if weekday == 0:
        return (local.date() - timedelta(days=2)).isoformat()
    return (local.date() - timedelta(days=1)).isoformat()


def schedule_is_open(now: datetime, window_end: datetime = TEST_WINDOW_END) -> bool:
    """True from 9:00 PM IST on 16 Oct 2026 until 3:45 AM IST on 17 Oct 2026."""
    local = now.astimezone(IST)
    start = DM_WINDOW_START.astimezone(IST)
    end = window_end.astimezone(IST)
    return start <= local < end


def hourly_test_date(now: datetime, window_end: datetime = TEST_WINDOW_END) -> str | None:
    local = now.astimezone(IST)
    end = window_end.astimezone(IST)
    if local >= end:
        return None
    idx = ((local.date().toordinal() * 24) + local.hour) % len(HOURLY_TEST_DATES)
    return HOURLY_TEST_DATES[idx]


def missing_day_note(report_date: str, latest: str) -> str:
    latest_text = latest or "none"
    return (
        "The VINI Accounts Alert was not sent. The Alerts tab does not have the "
        f"updated rows for {report_date} yet. Latest processed day is {latest_text}."
    )
