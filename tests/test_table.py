import os
import unittest
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from vini_alert.csm_lookup import apply_csm, parse_csm_table
from vini_alert.job import choose, destinations
from vini_alert.render import render_png
from vini_alert.slack_client import SlackError, dm_destination, post_image, post_text
from vini_alert.table import (
    hourly_test_date,
    latest_real_day,
    missing_day_note,
    prepare_rows,
    production_date,
    schedule_is_open,
    title_for,
)

IST = ZoneInfo("Asia/Kolkata")


def row(day, agent, rule, rooftop, value, threshold, notes="", csm=""):
    return {
        "Date": day,
        "Agent": agent,
        "Rule": rule,
        "enterprise_id": "ent",
        "rooftop_name": rooftop,
        "Value": value,
        "Threshold": threshold,
        "Notes": notes,
        "CSM": csm,
    }


class PrepareTests(unittest.TestCase):
    def test_drops_backfill_blank_rows_and_other_dates(self):
        raw = [
            row("2026-10-12", "Sales Outbound", "attempts_low", "Covina Kia", "0", "<5/day", csm=""),
            row("2026-10-12", "Sales Outbound", "attempts_low", "Covina Kia", "0", "<5/day", csm="prabha.kumari"),
            row("2026-10-12", "Sales Inbound", "engaged_pct", "Stillwell Ford", "40%", "<50%", notes="Metabase 4-file backfill; old"),
            row("2026-10-14", "Sales OB", "qualified_pct", "Landers CDJR", "1%", "baseline 4%"),
            row("", "", "", "", "", ""),
        ]
        out = prepare_rows(raw, "2026-10-12")
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["agent"], "Sales OB")
        self.assertEqual(out[0]["metric"], "Attempts")
        self.assertEqual(out[0]["issue"], "0 (<5/day)")
        self.assertEqual(out[0]["csm"], "prabha.kumari")

    def test_sort_and_blank_csm(self):
        raw = [
            row("2026-10-12", "Service Outbound", "appt_rate", "World Car", "28%", "baseline 31%", csm=""),
            row("2026-10-12", "Sales IB", "qualified_pct", "Alpha Honda", "2%", "baseline 8%", csm="unassigned"),
            row("2026-10-12", "Sales IB", "attempts_low", "Alpha Honda", "12", "<50/day", csm="ada@spyne.ai"),
        ]
        out = prepare_rows(raw, "2026-10-12")
        self.assertEqual([r["agent"] for r in out], ["Sales IB", "Sales IB", "Service OB"])
        self.assertEqual([r["metric"] for r in out[:2]], ["Attempts", "Qualified"])
        self.assertEqual(out[0]["csm"], "ada@spyne.ai")
        self.assertEqual(out[1]["csm"], "—")
        self.assertEqual(out[2]["csm"], "—")

    def test_latest_and_title_and_note(self):
        raw = [
            row("2026-10-12", "Sales OB", "attempts_low", "Covina Kia", "0", "<5/day", csm="a"),
            row("2026-10-13", "Sales OB", "attempts_low", "Covina Kia", "0", "<5/day", notes="Metabase 4-file backfill"),
        ]
        self.assertEqual(latest_real_day(raw), "2026-10-12")
        self.assertEqual(title_for("2026-10-12", 13), "VINI Accounts Alert | Mon Oct 12 | 13 alerts")
        self.assertEqual(title_for("2026-10-08", 1), "VINI Accounts Alert | Thu Oct 8 | 1 alert")
        self.assertIn("2026-10-15", missing_day_note("2026-10-15", "2026-10-12"))
        self.assertIn("2026-10-12", missing_day_note("2026-10-15", "2026-10-12"))

    def test_clock(self):
        friday = datetime(2026, 10, 16, 17, 30, tzinfo=IST)
        monday = datetime(2026, 10, 12, 17, 30, tzinfo=IST)
        sunday = datetime(2026, 10, 11, 17, 30, tzinfo=IST)
        self.assertEqual(production_date(friday), "2026-10-15")
        self.assertEqual(production_date(monday), "2026-10-10")
        self.assertIsNone(production_date(sunday))

        inside = datetime(2026, 10, 16, 19, 10, tzinfo=IST)
        three_am = datetime(2026, 10, 17, 3, 0, tzinfo=IST)
        after = datetime(2026, 10, 17, 3, 45, tzinfo=IST)
        self.assertIn(hourly_test_date(inside), {
            "2026-10-12", "2026-10-08", "2026-10-07", "2026-10-06", "2026-10-05",
            "2026-10-03", "2026-10-14", "2026-10-15", "2026-10-02", "2026-10-13",
        })
        self.assertEqual(hourly_test_date(three_am), "2026-10-15")
        self.assertIsNone(hourly_test_date(after))
        self.assertNotEqual(hourly_test_date(inside), hourly_test_date(inside.replace(hour=20)))
        self.assertTrue(schedule_is_open(datetime(2026, 10, 16, 21, 0, tzinfo=IST)))
        self.assertTrue(schedule_is_open(datetime(2026, 10, 17, 2, 0, tzinfo=IST)))
        self.assertTrue(schedule_is_open(three_am))
        self.assertFalse(schedule_is_open(datetime(2026, 10, 16, 20, 59, tzinfo=IST)))
        self.assertFalse(schedule_is_open(after))

        # Cron fires at :00 IST. 9:00 PM already passed. Remaining hours stay on these days.
        ist_hours = {
            (2026, 10, 16, 21): "2026-10-08",
            (2026, 10, 16, 22): "2026-10-07",
            (2026, 10, 16, 23): "2026-10-06",
            (2026, 10, 17, 0): "2026-10-05",
            (2026, 10, 17, 1): "2026-10-03",
            (2026, 10, 17, 2): "2026-10-14",
            (2026, 10, 17, 3): "2026-10-15",
        }
        seen = set()
        for (year, month, day, hour), expected in ist_hours.items():
            moment = datetime(year, month, day, hour, 30, tzinfo=IST)
            self.assertEqual(hourly_test_date(moment), expected)
            self.assertTrue(schedule_is_open(moment))
            seen.add(expected)
        self.assertEqual(len(seen), len(ist_hours))
        self.assertEqual(hourly_test_date(three_am), "2026-10-15")
        self.assertIsNone(hourly_test_date(after))

        previous = os.environ.get("GITHUB_EVENT_NAME")
        try:
            os.environ["GITHUB_EVENT_NAME"] = "schedule"
            self.assertEqual(choose(three_am, "2099-01-01", "hourly-test"), ("2026-10-15", "hourly-test"))
            self.assertEqual(choose(after, "2026-10-15", "hourly-test"), (None, "hourly-test"))
            opened = datetime(2026, 10, 16, 21, 30, tzinfo=IST)
            scheduled_day, _mode = choose(opened, "2099-01-01", "hourly-test")
            self.assertNotEqual(scheduled_day, "2099-01-01")
            self.assertIsNotNone(scheduled_day)
            os.environ["GITHUB_EVENT_NAME"] = "workflow_dispatch"
            self.assertEqual(choose(after, "2026-10-12", "hourly-test")[0], "2026-10-12")
        finally:
            if previous is None:
                os.environ.pop("GITHUB_EVENT_NAME", None)
            else:
                os.environ["GITHUB_EVENT_NAME"] = previous


class CsmLookupTests(unittest.TestCase):
    def test_vlookup_skips_totals_row_and_uses_enterprise_id(self):
        text = (
            "721,,,,,,,,,manpreet.kaur@spyne.ai\n"
            "Enterprise ID,Customer,Product,Stage,ChurnFutureChurnDate,Plan_type,Customer Type,Customer Subtype,Customer Segment,CSM Name\n"
            "730dc677a,Energetic Exotics,Studio,Live,,,,,SMB,manpreet.kaur@spyne.ai\n"
            "5b81be4b1,Dream Nissan,Studio,Live,,,,,SMB,#N/A\n"
        )
        lookup = parse_csm_table(text)
        self.assertEqual(lookup["by_id"]["730dc677a"], "manpreet.kaur@spyne.ai")
        self.assertNotIn("5b81be4b1", lookup["by_id"])
        self.assertEqual(lookup["by_name"]["energetic exotics"], "manpreet.kaur@spyne.ai")
        alerts = [
            row("2026-10-12", "Sales OB", "attempts_low", "Covina Kia", "0", "<5/day", csm=""),
        ]
        alerts[0]["enterprise_id"] = "730dc677a"
        apply_csm(alerts, lookup)
        prepared = prepare_rows(alerts, "2026-10-12")
        self.assertEqual(prepared[0]["csm"], "manpreet.kaur@spyne.ai")

    def test_vini_row_wins_over_a_later_studio_row(self):
        lookup = parse_csm_table(
            "Enterprise ID,Customer,Product,CSM Name\n"
            "ent1,Alpha Store,Studio,old.person@spyne.ai\n"
            "ent1,Alpha Store,Vini,new.person@spyne.ai\n"
            "ent2,Beta Store,Vini,keep.me@spyne.ai\n"
            "ent2,Beta Store,Studio,later.studio@spyne.ai\n"
        )
        self.assertEqual(lookup["by_id"]["ent1"], "new.person@spyne.ai")
        self.assertEqual(lookup["by_id"]["ent2"], "keep.me@spyne.ai")
        self.assertEqual(lookup["by_name"]["alpha store"], "new.person@spyne.ai")
        self.assertEqual(lookup["by_name"]["beta store"], "keep.me@spyne.ai")

    def test_email_csm_name_is_not_stripped_and_match_is_exact(self):
        lookup = parse_csm_table(
            "totals row\n"
            "Enterprise ID,Customer,Product,CSM Name\n"
            "ent9,Alpha Store,Studio,studio.person@spyne.ai\n"
            "ent9,Alpha Store,Vini,vini.person@spyne.ai\n"
            "aa323b917,Car Revolution Avenel,Studio,aditya.kaul@spyne.ai\n"
        )
        self.assertEqual(lookup["by_id"]["ent9"], "vini.person@spyne.ai")
        alerts = [row("2026-10-12", "Sales OB", "attempts_low", "Alpha Store", "0", "<5/day", csm="someone.else")]
        alerts[0]["enterprise_id"] = "ent9"
        apply_csm(alerts, lookup)
        self.assertEqual(prepare_rows(alerts, "2026-10-12")[0]["csm"], "vini.person@spyne.ai")

        unmatched = [row("2026-10-12", "Sales OB", "attempts_low", "Car Revolution Avenel", "0", "<5/day", csm="deepanshu.agarwal")]
        unmatched[0]["enterprise_id"] = "missing"
        apply_csm(unmatched, lookup)
        self.assertEqual(prepare_rows(unmatched, "2026-10-12")[0]["csm"], "—")

        matched = [row("2026-10-12", "Sales OB", "attempts_low", "Other Name", "0", "<5/day", csm="")]
        matched[0]["enterprise_id"] = "aa323b917"
        apply_csm(matched, lookup)
        self.assertEqual(prepare_rows(matched, "2026-10-12")[0]["csm"], "aditya.kaul@spyne.ai")


class SlackDestinationTests(unittest.TestCase):
    def test_channel_id_is_never_a_destination(self):
        hostile = {
            "SLACK_NOTIFY_CHANNEL_ID": "C0BPY9U15U5",
            "SLACK_NOTIFY_USER_ID": "U0C40E9HANQ",
            "SLACK_TEAM_CHANNEL": "C0BPY9U15U5",
            "SLACK_DM_CHANNEL": "C0ABCDEF",
            "POST_TO_CHANNEL": "true",
        }
        self.assertEqual(dm_destination(hostile), "U0C40E9HANQ")
        for mode in ("hourly-test", "production", "manual", ""):
            found = destinations(mode, hostile)
            self.assertEqual(found, ["U0C40E9HANQ"])
            for dest in found:
                self.assertFalse(dest.startswith("C"))

        channel_as_user = dict(hostile)
        channel_as_user["SLACK_NOTIFY_USER_ID"] = "C0BPY9U15U5"
        self.assertEqual(dm_destination(channel_as_user), "D0C40GC2CN8")
        self.assertEqual(destinations("production", channel_as_user), ["D0C40GC2CN8"])

        ignored = {"SLACK_NOTIFY_CHANNEL_ID": "C0BPY9U15U5"}
        self.assertEqual(dm_destination(ignored), "D0C40GC2CN8")
        self.assertFalse(dm_destination(ignored).startswith("C"))

        for channel_id in ("C0BPY9U15U5", "c0bpy9u15u5", "  C0BPY9U15U5  ", "C"):
            with self.assertRaises(SlackError):
                post_text("xoxb-test", channel_id, "nope")
            with self.assertRaises(SlackError):
                post_image("xoxb-test", channel_id, Path("/tmp/does-not-need-to-exist.png"), "nope")

        root = Path(__file__).resolve().parents[1]
        self.assertFalse((root / ".github/workflows/daily-channel.yml").exists())
        workflow = (root / ".github/workflows/hourly-dm-test.yml").read_text()
        self.assertNotIn("C0BPY9U15U5", workflow)
        self.assertNotIn("SLACK_NOTIFY_CHANNEL_ID", workflow)
        self.assertIn('cron: "30 15-21 * * *"', workflow)
        self.assertIn('TEST_WINDOW_END: "2026-10-17T03:45:00+05:30"', workflow)
        for path in (root / "vini_alert").glob("*.py"):
            self.assertNotIn("C0BPY9U15U5", path.read_text())

    def test_channel_secret_name_is_unused_and_c_ids_are_rejected(self):
        """The #vini-cs-team secret is never read. Any C… id is not a destination."""
        channel_secret = "SLACK_NOTIFY_" + "VINI_CS_TEAM_CHANNEL_ID"
        packed = {
            channel_secret: "C0BPY9U15U5",
            "SLACK_NOTIFY_CHANNEL_ID": "C0BPY9U15U5",
            "SLACK_NOTIFY_USER_ID": "U0C40E9HANQ",
            "SOME_OTHER_CHANNEL": "C0ABCDEF123",
            "COLOR": "C0FFEE",
        }
        self.assertEqual(dm_destination(packed), "U0C40E9HANQ")
        self.assertEqual(destinations("hourly-test", packed), ["U0C40E9HANQ"])
        for dest in destinations("hourly-test", packed):
            self.assertFalse(dest[:1].upper() == "C")

        only_channel_secret = {channel_secret: "C0BPY9U15U5"}
        self.assertEqual(dm_destination(only_channel_secret), "D0C40GC2CN8")
        self.assertEqual(destinations("", only_channel_secret), ["D0C40GC2CN8"])
        self.assertNotEqual(dm_destination(only_channel_secret), "D0BTPFZ3VB9")

        user_is_channel = {channel_secret: "C0BPY9U15U5", "SLACK_NOTIFY_USER_ID": "c0bpy9u15u5"}
        self.assertEqual(dm_destination(user_is_channel), "D0C40GC2CN8")
        self.assertFalse(dm_destination(user_is_channel).startswith("C"))

        root = Path(__file__).resolve().parents[1]
        workflow = (root / ".github/workflows/hourly-dm-test.yml").read_text()
        self.assertNotIn(channel_secret, workflow)
        self.assertNotIn("secrets." + channel_secret, workflow)
        for path in (root / "vini_alert").rglob("*.py"):
            text = path.read_text()
            self.assertNotIn(channel_secret, text)
            self.assertNotIn("environ.items", text)
            self.assertNotIn("environ.keys", text)
            self.assertNotIn("environ.values", text)


class RenderTests(unittest.TestCase):
    def test_png_written(self):
        rows = prepare_rows([
            row("2026-10-12", "Sales Outbound", "engaged_pct", "Beaver County Dodge Chrysler Jeep RAM", "4.7%", "<5%", csm="zeeshana.aijaz"),
            row("2026-10-12", "Service IB", "qualified_pct", "Inver Grove Ford", "1.3%", "baseline 2.4%"),
        ], "2026-10-12")
        path = render_png(rows, "2026-10-12", "/tmp/vini-test-table.png")
        data = path.read_bytes()
        self.assertTrue(data.startswith(b"\x89PNG"))
        self.assertGreater(len(data), 5000)


if __name__ == "__main__":
    unittest.main()
