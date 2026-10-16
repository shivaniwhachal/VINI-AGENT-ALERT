# Paste this script and run it once a day, after the Metabase mail

The Slack table is sent by GitHub Actions in [shivaniwhachal/VINI-AGENT-ALERT](https://github.com/shivaniwhachal/VINI-AGENT-ALERT). It does not run from this chat, and it does not use cron. The Apps Script only fills the tracker. It does not post to Slack.

Spreadsheet: **VINI Accounts Alert Tracker**

`1Mgg5Xrrkza55VcsofSPOsKWdo1-zFO19luusZUt0-Ww`

Script file to paste: [Code.gs](Code.gs), version `2026-10-17-mail-once-daily`.

## 1. Keep the sheet viewable by link

GitHub Actions reads the Alerts tab and the CSM tab with no Google login.

1. Open the tracker.
2. Share → General access → **Anyone with the link** → **Viewer**.
3. Leave these tabs in place: Daily, Alerts (gid `818793773`), Log, CSM (gid `376341429`).

The CSM tab may show as `CSM ` with a trailing space. That is the real tab. Do not add a second one.

## 2. Paste the script

1. In the tracker: Extensions → Apps Script.
2. Select everything in `Code.gs` and replace it with the full file from this repo.
3. Save.
4. Services (the plus next to Services) → **Drive API**.
5. Set the identifier to `Drive` and the version to **v2**. The `.xlsx` mail attachments need this. The built-in Drive service is not enough.
6. Confirm the spreadsheet timezone is **(GMT+05:30) India Time** (File → Settings in the sheet).

## 3. Run these four functions, in this order

Select each function in the toolbar and press Run. Approve the Gmail, Sheets, and Drive prompts on the first run.

| Order | Function | What you should see |
| --- | --- | --- |
| 1 | `verifyViniAlertCodeVersion` | Log: `OK — 2026-10-17-mail-once-daily` |
| 2 | `setupCsmSheet` | A toast that the CSM tab is readable. Alerts column I is not changed. |
| 3 | `catchUpMetabaseEmails` | Log rows for the re-read mail and for `fillMissingAlertsFromDaily_`. This can take a few minutes. |
| 4 | `setupDailyTrigger` | Log: one daily trigger at 4:00 AM IST, after the 22:00 UTC mail. |

Run `removeAllTriggers` first if an hourly `processLatestMetabaseEmail` trigger is still listed. Then run `setupDailyTrigger` once. Leave that one daily trigger. Do not put the hourly trigger back.

## 4. CSM names

Do not type CSM names onto the Alerts tab. `setupCsmSheet` and `fillBlankCsmOnAlerts_` do not write column I. New alert rows leave column I blank.

The Slack image reads the CSM tab (gid `376341429`):

- Match is exact: Alerts `enterprise_id` → **Enterprise ID** → **CSM Name**.
- The header is not row 1.
- If an account has both a Studio row and a Vini row, the Vini CSM Name wins.
- The cell is shown as stored. `@spyne.ai` is not removed.
- A blank cell, `Unassigned`, or `#N/A` has no match. The image draws `—`.
- Do not type a guessed name.

## 5. What 13, 14, and 15 Oct do after `catchUpMetabaseEmails`

`catchUpMetabaseEmails` opens Metabase mail again, including mail already labeled `VINI-Alert-Processed`, from 13 Oct onward (`after:2026/10/11`). It writes Daily, then fills any missing working day that is complete.

| Day | What is on Daily now | What catch-up does |
| --- | --- | --- |
| 13 Oct | Thin. About 141 attempts, and Service Outbound is missing. | Left open. A day under 400 attempts is not alerted. |
| 14 Oct | Complete. All 4 agents, about 2352 attempts. | Alerts are written for 14 Oct from Daily, even if the mail has no 15 Oct rows. Rules, new-breach-only, and the live-date gate are unchanged. One agent with zero attempts does not cancel the others. |
| 15 Oct | Not on Daily. The mail opened at 2:10 AM IST on 16 Oct had no 15 Oct activity. | A later 22:00 UTC mail that contains a full 15 Oct writes that day. A day under 400 attempts stays open. |

Sunday still does not create Alerts. Monday uses Saturday. A run with no new Metabase mail does not write Daily, Alerts, or Log.

The image sends only rows that are actually on the Alerts tab for that date. Notes that start with `Metabase 4-file backfill` stay out. If the date has no real rows, nothing is sent: no image and no note.

## 6. Slack

Repo: `shivaniwhachal/VINI-AGENT-ALERT`.

These Actions secrets are already created:

- `SLACK_BOT_TOKEN`
- `SLACK_NOTIFY_USER_ID` — tester and manual DMs
- `SLACK_NOTIFY_VINI_CS_TEAM_CHANNEL_ID` — `#vini-cs-team` for the 5:30 PM run
- `SLACK_NOTIFY_CHANNEL_ID` — present, and ignored

`.github/workflows/daily-dm.yml` runs at 5:30 PM IST, Monday through Saturday, and posts the image to `#vini-cs-team`. Sunday sends nothing. Monday’s image is Saturday. Tuesday through Saturday use yesterday. If that date is not on the Alerts tab, the run sends nothing.

**Run workflow** and `.github/workflows/hourly-dm-test.yml` stay on the bot DM. If `SLACK_NOTIFY_USER_ID` is empty or starts with `C`, the fallback is `D0C40GC2CN8`.

Satchit’s DM `D0BTPFZ3VB9` is not used.

The uploaded file name is `vini-accounts-alert.png`. The Slack file title is `Daily VINI Report`.

On GitHub, open the repo → **Actions** → enable workflows if GitHub asks. No cron job is required on any machine.
