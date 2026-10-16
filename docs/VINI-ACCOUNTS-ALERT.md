# VINI Accounts Alert

The sender that runs without this chat is GitHub Actions in this repo (`.github/workflows/daily-dm.yml`), not cron and not `central_analytics_report/`. Setup is [apps-script/SETUP.md](../apps-script/SETUP.md). The schedule is 5:30 PM IST, Monday through Saturday, and that run posts to `#vini-cs-team` (`C0BPY9U15U5`) using `SLACK_NOTIFY_VINI_CS_TEAM_CHANNEL_ID`. Sunday sends nothing. A date with no Alerts rows sends nothing. Tester and manual runs DM `SLACK_NOTIFY_USER_ID` (fallback `D0C40GC2CN8`). `SLACK_NOTIFY_CHANNEL_ID` is ignored. The 8:45 PM IST message that said the alert was in `#vini-cs-team` came from the old cron sender.

The notes below are the 16 Oct operating record. The clock section describes the old cron job and is not the install path.

Operating record for the **5:30 PM IST** VINI Accounts Alert. This is the dark table posted to Slack. It is not the 6:00 AM Central Daily report, and it is not the bullet-list preview.

Written 16 Oct 2026, after the 5:30 PM run.

## Where this lives

The Slack sender is in this git project. The sheet filler is not. The sheet filler is the Apps Script project **VINI-Code-COMPLETE** in the Google account that owns the tracker.

| What | Where |
| --- | --- |
| Slack sender code | `central_analytics_report/` |
| Alert rules and sheet reading | `central_analytics_report/alerts.py` |
| Dark table image | `central_analytics_report/alerts_render.py` |
| 5:30 PM job | `central_analytics_report/alerts_job.py` |
| Slack upload | `central_analytics_report/slack.py` |
| Clock installer | `scripts/install_cron.sh` |
| Run log | `logs/alerts-cron.log` |
| One-day markers | `logs/alerts-sent-YYYY-MM-DD`, `logs/alerts-notice-YYYY-MM-DD`, `logs/alerts-confirmed-YYYY-MM-DD` |
| Last image | `output/vini-accounts-alert.png` |
| Bot token and channel ids | `.env` (not committed) |
| Channel approval | `alerts_channel_approved` |
| Sheet filler | Apps Script project **VINI-Code-COMPLETE**, file `Code.gs`. Not stored in this git folder. |
| Log helper kept here | `scripts/vini-log.gs` |
| Unused second sender | `scripts/independent-slack-reports.gs`. Do not install it. The git job is the sender. |

The sheet-filler index (Apps Script, Daily / Alerts / Log, Metabase, rules) is `docs/VINI-ACCOUNTS-ALERT-MASTER.md`.

## What the alert is

Once a day the job reads the Alerts tab, keeps the rows for one date, draws them as a dark PNG, and posts that image.

The image title looks like:

`VINI Accounts Alert | Wed Oct 14 | 8 alerts`

Columns, left to right:

1. Agent
2. Rooftop
3. Metric
4. Issue
5. CSM

Under the title, two rule lines:

- Connects flagged when below absolute floor (IB 50%, OB 5%) over the 7-day / 3-day window.
- Qualified and Appt flagged when 50% / 5% below that rooftop’s 30-day history. Attempts IB when the 3-day average is under 50/day. Attempts OB when that day is under 5/day.

The Slack file name is `vini-accounts-alert.png`. The Slack file title is `Daily VINI Report`.

A blank CSM cell is drawn as `—`. The job does not invent a name.

## Sheet

Tracker: **VINI Accounts Alert Tracker**

- Spreadsheet id: `1Mgg5Xrrkza55VcsofSPOsKWdo1-zFO19luusZUt0-Ww`
- Tab name: `Alerts`
- gid: `818793773`

Columns A–I:

| Column | Field |
| --- | --- |
| A | Date |
| B | Agent |
| C | Rule |
| D | enterprise_id |
| E | rooftop_name |
| F | Value |
| G | Threshold |
| H | Notes |
| I | CSM |

Rows whose Notes start with `Metabase 4-file backfill` are left out. They are history loads, not the day’s alert.

If the same date, agent, rooftop, and rule appears twice, the copy that has a CSM is kept.

Agent names on the image:

| Sheet | Image |
| --- | --- |
| Sales Inbound | Sales IB |
| Sales Outbound | Sales OB |
| Service Inbound | Service IB |
| Service Outbound | Service OB |

Rule names on the image:

| Sheet | Image |
| --- | --- |
| attempts_low | Attempts |
| engaged_pct | Connects |
| qualified_pct | Qualified |
| appt_rate | Appt |

Sort order: Sales IB, Sales OB, Service IB, Service OB, then rooftop name, then Attempts, Connects, Qualified, Appt.

## Which day is sent

The clock is India time.

| Day the job runs | Date on the image |
| --- | --- |
| Tuesday–Saturday | Yesterday |
| Monday | Saturday |
| Sunday | Nothing. No image. No “not sent” note. |

16 Oct 2026 was a Friday, so the job required rows dated `2026-10-15`.

## Who receives it

The 5:30 PM schedule posts to `#vini-cs-team`. Tester and manual runs stay a DM. The table below is the old cron sender (`central_analytics_report`), which is not this repo.

Bot: `daily_vini_report` (`U0C40E9HANQ`), Slack workspace **Spyne Team**.

| Stop | Id | What the old cron did |
| --- | --- | --- |
| #vini-cs-team | `C0BPY9U15U5` | The 5:30 PM schedule posts the table here. |
| Your bot DM | `D0C40GC2CN8` | Fallback DM for this repo when `SLACK_NOTIFY_USER_ID` is empty. |
| Satchit | `D0BTPFZ3VB9` | Not used. |

If the rows for that day are not on the tab, the current job sends nothing: no image and no note. The old cron sent this note to the bot DM:

> The VINI Accounts Alert was not sent. The Alerts tab does not have the updated rows for YYYY-MM-DD yet. Latest processed day is YYYY-MM-DD.

That note is sent once. The job keeps checking every 5 minutes until 9:25 PM IST and posts the table if the rows appear later.

Satchit’s id still returns `channel_not_found`. The team post and the bot-DM note still go out. The bot DM is then told that Satchit’s chat could not be reached. Satchit has to open `daily_vini_report` and send it any message before Slack will accept `D0BTPFZ3VB9`.

## Clock

The sender is this computer’s cron, installed by `scripts/install_cron.sh`.

On this UTC machine the line is:

```cron
*/5 12,13,14,15 * * * cd /workspace && flock -n /workspace/logs/alerts.lock /workspace/.venv/bin/python -m central_analytics_report.alerts_job --scheduled >> /workspace/logs/alerts-cron.log 2>&1
```

That is every 5 minutes from 5:30 PM IST through 9:25 PM IST. The table is posted once. Later checks see `logs/alerts-sent-YYYY-MM-DD` and stop.

The job posts only when `alerts_channel_approved` exists. That file is present.

The laptop does not run this job. Closing the laptop does not by itself stop it. The job runs on the remote computer that holds this git project. If that computer is paused at 5:30, the minute is skipped. Cron does not replay a missed minute. The next 5-minute check after the computer wakes can still send, until 9:25 PM IST.

## How a day is supposed to flow

1. Metabase emails the rooftop file. The subject attachment starts `VINI Accounts Ale…`. The mail in the 16 Oct screenshot was under Gmail label `VINI-Alert-Processed`.
2. Apps Script `processLatestMetabaseEmail` in **VINI-Code-COMPLETE** reads a mail that does not already have that label.
3. It upserts Daily, appends Alerts, and appends one Log row.
4. At 5:30 PM IST this git job reads Alerts and posts the table.

`processLatestMetabaseEmail` will not open a mail that already wears `VINI-Alert-Processed`. The log line for that is `No unprocessed Metabase email found`.

The three Metabase items in Shivani Whachal’s collection are **OND PLAN**, **ROI_Calculation**, and **VINI Accounts Alert daily rooftop metrics**. Those are processed by Apps Script at 22:00 UTC (3:30 AM IST). The Slack table is still 5:30 PM IST. This git job does not read the email. It only reads the Alerts tab.

## 16 Oct 2026, what happened

At 5:17 PM IST, `processLatestMetabaseEmail` ran in VINI-Code-COMPLETE and logged `No unprocessed Metabase email found`.

The 15 Oct Metabase mail was already in Gmail with label `VINI-Alert-Processed`. The attachment was there. The script did not write it.

The Alerts tab at 6:06 PM IST:

- Newest real alert day: `2026-10-12` (39 rows).
- `2026-10-13` exists only as `Metabase 4-file backfill` (25 rows) and is excluded.
- `2026-10-15` rows: 0.

At 5:30 PM IST the git job ran. It did not post a table. It notified `D0C40GC2CN8`. Satchit’s chat returned `channel_not_found`. The same check repeated every 5 minutes after that and did not post, because the rows were still missing. The “not sent” note was not repeated.

The 10:55 AM Slack message that began `Preview only. Live would post this to #vini-cs-team` was a text list, not this table. This job does not send that text.

## Commands

Render only, no Slack post:

```bash
.venv/bin/python -m central_analytics_report.alerts_job --dry-run
```

Post the current table to the bot DM only:

```bash
.venv/bin/python -m central_analytics_report.alerts_job --test
```

The 5:30 PM path:

```bash
.venv/bin/python -m central_analytics_report.alerts_job --scheduled
```

## Related, but not this alert

The 6:00 AM Central post is a different job.

- Source: Daily report tab, columns B–H, rows 4–22. Hidden rows stay hidden.
- Channel: `#central-analytics-programs` (`C0AULQ5F2D6`).
- Code: `central_analytics_report/job.py` and `central_analytics_report/render.py`.
- Sheet: `1rNW65NGvWoNXxHI0pKM2kjgW8rZ6ZsoPqIlpa3CDMDc`, gid `1544274662`.
- Log path in the 16 Oct handoff was cut off at `logs/cro`. The remainder of that path was not in the note.
