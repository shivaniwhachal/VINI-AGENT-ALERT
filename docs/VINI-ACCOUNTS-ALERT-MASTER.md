# VINI Accounts Alert — master reference

The script to paste is [apps-script/Code.gs](../apps-script/Code.gs) (`2026-10-17-mail-once-daily`). Steps are [apps-script/SETUP.md](../apps-script/SETUP.md). The daily trigger writes the sheet after the 22:00 UTC Metabase mail. A day under 400 attempts is not alerted. The 5:30 PM GitHub run posts to `#vini-cs-team`. Apps Script does not post to Slack. `setupCsmSheet` does not write Alerts column I.

Last updated: 2026-10-16

Audience: Shivani, CSM ops, anyone wiring automation or Slack.

This is the sheet-filler index: rooftop metrics → Daily → rule engine → Alerts → Log. It is not the Live accounts RAG sheet (that workstream is `docs/vini-daily-report/`). It is not the 5:30 PM Slack table. The Slack sender’s operating record is `docs/VINI-ACCOUNTS-ALERT.md`.

The original index lived in the project store at `/cursor/stores/bc-cd2aee1a-ada6-4c4c-be69-2c28d949ca2c/` (shown in Cursor as Context). That store was not mounted when this copy was written on 16 Oct 2026. Paths below are the store’s own paths. They are not files in this git tree unless a later handoff puts them here.

## 1. What this product is

Goal: each working day, after Metabase emails rooftop funnel metrics, update a Google Sheet tracker and append new rule breaches so CSMs can act. Historical alerts stay on the sheet.

In scope (Apps Script on the tracker workbook):

- Read the Metabase email attachment (CSV/XLSX).
- Upsert Daily (last 3 calendar days of activity).
- Append Alerts (new breaches only vs prior working day).
- Append Log (one audit row per run).

Out of scope (owned elsewhere):

- Slack posts (table to #vini-cs-team, #central-analytics-programs, DMs, n8n, GitHub `accounts-alert.yml`). The current sender is the git job in `docs/VINI-ACCOUNTS-ALERT.md`. The legacy bot path is in the store’s `README.md`.
- Time trigger. `setupDailyTrigger()` is optional. The team may use another scheduler that calls `processLatestMetabaseEmail`.

## 2. Production artifact

| Item | Location in the project store |
| --- | --- |
| Apps Script (paste entire file) | `FINAL/VINI-Accounts-Alert-Code.gs` |
| Version string | `2026-10-15-metabase-sheets-log-v1` |
| Setup steps | `FINAL/VINI-Alert-Setup.md` |
| Team-facing “how it works” | `FINAL/VINI-Alert-Tracker-How-It-Works.md` |
| Paste checklist | `FINAL/APPS-SCRIPT-PASTE.md` |

Optional workspace mirror named by the index: `/workspace/vini-accounts-alert/VINI-Accounts-Alert-Code.gs`, same content as `FINAL`. Context/FINAL is source of truth. That mirror was not in this git tree on 16 Oct 2026.

Advanced Google service: Drive API v2 as **Drive** (for `.xlsx` attachments).

The Apps Script project that owns the live tracker is **VINI-Code-COMPLETE**, file `Code.gs`. A log helper kept with the git sender is `scripts/vini-log.gs`.

### Entry points

| Function | Purpose |
| --- | --- |
| `setupViniLogSheet` | Once. Creates the Log tab. |
| `verifyViniAlertCodeVersion` | Confirms the correct paste. |
| `installViniAlertScriptProperties` | Gmail search properties. |
| `testWithLatestEmail` | Test. Ignores the processed label. Writes Daily + Alerts + Log. |
| `processLatestMetabaseEmail` | Production. Skips mail that already has `VINI-Alert-Processed`. |
| `setupDailyTrigger` | Optional ~5:15 PM IST timer. Automation owner. |
| `removeAllTriggers` | Clear all triggers. |

## 3. Google Sheet tabs

| Tab | Role |
| --- | --- |
| Daily | One row per `activity_day` × `enterprise_id` × `rooftop_name` × agent. Columns include `call_attempts`, `engaged`, `qualified`, `appointments`, `engaged_pct`, `qualified_pct`, `appt_rate`. |
| Alerts | Append-only: Date, Agent, Rule, enterprise_id, rooftop_name, Value, Threshold, Notes, CSM. |
| Log | Append-only run audit: IST timestamp, run name, as-of, daily count, alert count, status, notes. |

Tracker used by the Slack job: **VINI Accounts Alert Tracker**, spreadsheet id `1Mgg5Xrrkza55VcsofSPOsKWdo1-zFO19luusZUt0-Ww`, Alerts tab gid `818793773`. Column layout is in `docs/VINI-ACCOUNTS-ALERT.md`.

Alert Analytics (month filter, week-over-week, ≥2 alerts/week) is a separate analysis template. The main job does not write it.

- `FINAL/VINI-Alert-Analytics-Template.xlsx`
- `FINAL/VINI-Alert-Analytics-Sheet.md`

## 4. Data source (Metabase)

- Email from: `metabase@spyne.ai`
- Subject: `VINI Accounts Alert daily rooftop metrics`
- Attachment: CSV or XLSX with at least `activity_day`, enterprise/rooftop ids, rooftop name, agent type, `call_attempts`, `engaged`, `qualified`, `appointments`.
- Metabase questions (historical refs in the store docs): daily rooftop metrics ~13172 / 13173. Setup details in `metabase-setup.md` and `metabase-daily-append-query.md`.
- Processed tracking: Gmail label `VINI-Alert-Processed` plus a script-property list of message IDs.

`processLatestMetabaseEmail` will not open a mail that already has `VINI-Alert-Processed`. The log line is `No unprocessed Metabase email found`.

Shivani Whachal’s Metabase collection has three items processed by Apps Script at 22:00 UTC (3:30 AM IST): **OND PLAN**, **ROI_Calculation**, and **VINI Accounts Alert daily rooftop metrics**. The Slack table remains 5:30 PM IST and only reads the Alerts tab.

## 5. Calendar / as-of logic (IST)

| Run day (IST) | Alerts evaluated for |
| --- | --- |
| Tuesday–Saturday | Yesterday |
| Monday | Saturday |
| Sunday | Daily upsert only. No new Alerts. |

US holidays are not skipped for alert logic.

The Slack job uses the same date rule and, on Sunday, posts nothing: no image and no “not sent” note.

## 6. Alert rules (production code)

Four rule IDs per live rooftop × agent (Sales IB/OB, Service IB/OB):

| Rule | Idea |
| --- | --- |
| `attempts_low` | Call attempts below floor for consecutive day(s) after prior volume. |
| `engaged_pct` | Connect rate below absolute floor (IB 50%, OB 5% in current code). |
| `qualified_pct` | Qualified rate drop vs that rooftop’s 30 working-day baseline. |
| `appt_rate` | Appointment rate drop vs the same baseline. |

Live gate: the rooftop must have `live_date` (from the Metabase row or the Live Accounts RAG lookup). A row is a new breach only versus the previous working day (`CONFIG_NEW_BREACH_ONLY`).

The two lines drawn on the Slack image (wording owned by the git job):

- Connects flagged when below absolute floor (IB 50%, OB 5%) over the 7-day / 3-day window.
- Qualified and Appt flagged when 50% / 5% below that rooftop’s 30-day history. Attempts IB when the 3-day average is under 50/day. Attempts OB when that day is under 5/day.

Authoritative rule write-ups in the store:

- `alert-rules.md`
- `project-4-complete-logic.md`

Satchit meeting (7 Oct 2026) proposed different thresholds (90% attempts drop, absolute qual/appt by agent). Those were not fully merged into production code. Comparison: `satchit-meeting-2026-10-07-thresholds.md`.

Image labels used by the Slack job: `attempts_low` → Attempts, `engaged_pct` → Connects, `qualified_pct` → Qualified, `appt_rate` → Appt. Agent labels: Sales Inbound → Sales IB, Sales Outbound → Sales OB, Service Inbound → Service IB, Service Outbound → Service OB.

## 7. Live Accounts RAG integration

The script reads the Live accounts tab for:

- `live_date` — eligibility for alerts
- CSM (`cs_poc_email`) — fills Alerts when the email lacks a CSM

Spreadsheet id in the script: `1KNSk0pdZIvv40N4dlIvtWcakXapcPS1Vhlo9E8S8wbI`, gid `699048576`.

RAG ROI and the daily refresh are not part of this alert script.

On the Slack image, a blank CSM cell is drawn as `—`. The git job does not invent a name. If the same date, agent, rooftop, and rule appears twice, the copy that has a CSM is kept.

## 8. Backfill and workbooks

| Asset | Path in the project store |
| --- | --- |
| Backfilled workbook (5424 Daily / 598 Alerts from Sep–Oct CSVs) | `VINI-Daily-Alerts-workbook.xlsx` |
| Summary | `VINI-Daily-Alerts-workbook-summary.md` |
| Source CSVs | `backfill-export/Daily.csv`, `backfill-export/Alerts.csv` |
| Tracker template xlsx | `VINI-Accounts-Alert-Tracker-TEMPLATE.xlsx` |

Rows whose Notes start with `Metabase 4-file backfill` are history loads. The Slack job leaves them out.

## 9. Where everything is stored

Primary folder in the project store: `docs/vini-accounts-alert-agent-wise/`

| Subfolder / file | Contents |
| --- | --- |
| `FINAL/` | Current script, setup, how-it-works, analytics template |
| `backfill-export/` | `Daily.csv`, `Alerts.csv` used for backfill |
| Root `.md` files | Rules, Metabase, go-live history, verification, column reference |
| Root `.gs` files | Legacy snapshots (`VINI-Code-COMPLETE.gs`, `workbook-apps-script.gs`, and others). Do not paste unless an old version is required. |
| Root `.xlsx` | Workbooks and templates |

Duplicate / archive tree (same material, older layout): `docs/vini-reports/3-Accounts-Alert/`. Prefer `vini-accounts-alert-agent-wise` for edits.

Internal (agent audits and scripts, not for handoff):

- `internal/vini-accounts-alert-agent-wise/` — backtests, validation JSON, build scripts, worker reports.
- `internal/vini-accounts-alert-script-changes-2026-10-07.md` — change log.

Downloads: `downloads/VINI-Accounts-Alert-Tracker.xlsx`

Related but separate products in the same project:

| Product | Folder |
| --- | --- |
| Live accounts RAG + ROI | `docs/vini-daily-report/` |
| Daily Sankey Slack bot | `docs/vini-daily-report/README.md`, repo `vini-arr-daily-bot` |
| OND Metabase import | `docs/vini-reports/4-OND-Live-Target/` |

## 10. Slack path

Current sender: GitHub Actions in this repo. It reads the Alerts tab and posts a dark PNG. The 5:30 PM IST schedule posts to `#vini-cs-team`. Tester and manual runs stay a DM. It does not call Apps Script, and it does not read the Metabase email.

Early design used GitHub Actions and `accounts-alert/` in `vini-arr-daily-bot` to DM or post Slack from a Metabase URL (`README.md` in the store). The sheet script does not post to Slack.

An unused second sender, `scripts/independent-slack-reports.gs`, must not be installed. The git job is the sender.

Slack table columns: Agent, Rooftop, Metric, Issue, CSM.

The 5:30 PM stop is `#vini-cs-team` (`SLACK_NOTIFY_VINI_CS_TEAM_CHANNEL_ID`, fallback `C0BPY9U15U5`). Tester and manual runs use `SLACK_NOTIFY_USER_ID`, or `D0C40GC2CN8` when that secret is empty or starts with `C`. Satchit’s DM is not used.

The 6:00 AM Central Daily report is a different job: `#central-analytics-programs` (`C0AULQ5F2D6`), code `central_analytics_report/job.py` and `central_analytics_report/render.py`, sheet `1rNW65NGvWoNXxHI0pKM2kjgW8rZ6ZsoPqIlpa3CDMDc`, gid `1544274662`.

## 11. Verification and ops

| Doc in the store | Use |
| --- | --- |
| `alert-verification.md` | Manual checks |
| `data-validation-report.md` | Data quality |
| `daily-5pm-process.md` | Timing narrative |
| `tracker-workbook-how-to-use.md` | Workbook usage |

Healthy run example from the index: Daily upsert ~178 rows; Alerts appended 13 for as-of `2026-10-12`; Log row status `Done`.

16 Oct 2026, after the 5:30 PM IST run:

- 5:17 PM IST: `processLatestMetabaseEmail` logged `No unprocessed Metabase email found`. The 15 Oct mail already had `VINI-Alert-Processed`, so the attachment was not written.
- Alerts tab at 6:06 PM IST: newest real day `2026-10-12` (39 rows). `2026-10-13` is only `Metabase 4-file backfill` (25 rows) and is excluded. `2026-10-15` rows: 0.
- The git job did not post a table. It sent the one-time “not sent” note to `D0C40GC2CN8` and kept checking every 5 minutes. Satchit’s chat returned `channel_not_found`.

## 12. Handoff

Sheet side:

1. After the Metabase email lands, run `processLatestMetabaseEmail` (or wait for the trigger).
2. Confirm the latest Log row: status `Done` or `Partial`, and the counts in the note.
3. Read new rows on Alerts, filtered by the latest Date.

Slack side:

1. The git job reads those Alerts rows. Apps Script does not post.
2. Render only: `.venv/bin/python -m central_analytics_report.alerts_job --dry-run`
3. Bot DM only: `.venv/bin/python -m central_analytics_report.alerts_job --test`
4. The 5:30 PM path: `.venv/bin/python -m central_analytics_report.alerts_job --scheduled`

Clock on the UTC machine that holds the git project, from 5:30 PM IST through 9:25 PM IST:

```cron
*/5 12,13,14,15 * * * cd /workspace && flock -n /workspace/logs/alerts.lock /workspace/.venv/bin/python -m central_analytics_report.alerts_job --scheduled >> /workspace/logs/alerts-cron.log 2>&1
```

The table posts once, and only when `alerts_channel_approved` exists. Later checks stop on `logs/alerts-sent-YYYY-MM-DD`.

## 13. Document index

Markdown named in the agent-wise folder:

- `README.md` — GitHub/Slack legacy and links
- `how-it-works.md`
- `email-workflow.md`
- `automation-setup.md`
- `go-live-checklist.md`
- `oct-8-go-live.md`
- `apply-updated-logic.md`
- `meeting-explainer.md`
- `column-reference.md`

The FINAL-only list is section 2.
