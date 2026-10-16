# Paste this script and turn the hourly fill back on

The Slack table is sent by GitHub Actions in [shivaniwhachal/VINI-AGENT-ALERT](https://github.com/shivaniwhachal/VINI-AGENT-ALERT). It does not run from this chat, and it does not use cron. The Apps Script only fills the tracker. It does not post to Slack.

Spreadsheet: **VINI Accounts Alert Tracker**

`1Mgg5Xrrkza55VcsofSPOsKWdo1-zFO19luusZUt0-Ww`

Script file to paste: [Code.gs](Code.gs), version `2026-10-16-csm-no-sheet-write`.

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
| 1 | `verifyViniAlertCodeVersion` | Log: `OK — 2026-10-16-csm-no-sheet-write` |
| 2 | `setupCsmSheet` | A toast that the CSM tab is readable. Alerts column I is not changed. |
| 3 | `catchUpMetabaseEmails` | Log rows for the re-read mail and for `fillMissingAlertsFromDaily_`. This can take a few minutes. |
| 4 | `setupDailyTrigger` | Log: an hourly trigger on `processLatestMetabaseEmail`. |

If an older trigger is still listed under Triggers, run `removeAllTriggers`, then run `setupDailyTrigger` again.

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
| 15 Oct | Not on Daily. The mail opened at 2:10 AM IST on 16 Oct had no 15 Oct activity. | If a re-read attachment now has a full 15 Oct (at least 3 agents and 400 attempts), Daily and Alerts get that day. If it still does not, the Log says 15 Oct is still open. The hourly trigger fills it when a later mail brings a full day. |

Sunday still does not create Alerts. Monday uses Saturday. An hour with no new unlabeled mail does not add a “no email” row to the Log.

The image sends only rows that are actually on the Alerts tab for that date. Notes that start with `Metabase 4-file backfill` stay out. If the date has no real rows, the DM gets the not-sent note and no table.

## 6. Slack

Repo: `shivaniwhachal/VINI-AGENT-ALERT`.

These Actions secrets are already created:

- `SLACK_BOT_TOKEN`
- `SLACK_NOTIFY_USER_ID`
- `SLACK_NOTIFY_CHANNEL_ID` — present, and ignored

The hourly workflow posts only to the DM in `SLACK_NOTIFY_USER_ID`. If that secret is empty or starts with `C`, the fallback is `D0C40GC2CN8`. It never posts to a channel.

Cron `30 15-21 * * *` (UTC) is 9:00 PM through 3:00 AM IST on the night of 16 Oct 2026. The 3:00 AM IST run on 17 Oct 2026 still sends. At 3:45 AM IST a scheduled run no-ops. **Run workflow** can still DM one date. Type the date. It still goes to the DM.

Satchit’s DM `D0BTPFZ3VB9` is not used.

The uploaded file name is `vini-accounts-alert.png`. The Slack file title is `Daily VINI Report`.

On GitHub, open the repo → **Actions** → enable workflows if GitHub asks. The workflow file is `.github/workflows/hourly-dm-test.yml`. No cron job is required on any machine.
