# VINI Accounts Alert

GitHub Actions in this repo reads the Alerts tab and sends a Slack DM. It does not post to a Slack channel.

Repository: [shivaniwhachal/VINI-AGENT-ALERT](https://github.com/shivaniwhachal/VINI-AGENT-ALERT). This replaces `pmm-spyne/VINI-AGENT-ALERT-`. Do not push to that repo.

| Piece | Where |
| --- | --- |
| Paste this into the tracker | [apps-script/Code.gs](apps-script/Code.gs) version `2026-10-16-csm-no-sheet-write` |
| Clicks you have to do yourself | [apps-script/SETUP.md](apps-script/SETUP.md) |
| Hourly DM | [.github/workflows/hourly-dm-test.yml](.github/workflows/hourly-dm-test.yml) |

Tracker: `1Mgg5Xrrkza55VcsofSPOsKWdo1-zFO19luusZUt0-Ww`. Alerts gid `818793773`. CSM gid `376341429`. Keep the sheet viewable by anyone with the link.

## Slack

These Actions secrets are already on the repo:

- `SLACK_BOT_TOKEN`
- `SLACK_NOTIFY_USER_ID` — the only destination
- `SLACK_NOTIFY_CHANNEL_ID` — ignored. The code never reads it.

If `SLACK_NOTIFY_USER_ID` is empty, or its value starts with `C`, the DM falls back to `D0C40GC2CN8`. A user id (`U…`) is opened as a DM. Nothing is posted to `#vini-cs-team`.

The uploaded file name is `vini-accounts-alert.png`. The Slack file title is `Daily VINI Report`.

## Schedule

Cron `30 15-21 * * *` is UTC. That is 9:00 PM, 10:00 PM, 11:00 PM, 12:00 AM, 1:00 AM, 2:00 AM, and 3:00 AM IST, on the night of 16 Oct 2026.

The 3:00 AM IST run on 17 Oct 2026 still sends. At 3:45 AM IST the schedule stops. A later scheduled run exits without calling Slack.

`workflow_dispatch` can still DM one date. Type `YYYY-MM-DD` in the date input. That run still goes to the DM, never a channel. Leave the date empty after the window and the run no-ops.

Each hour uses one date. 12:00 AM is 2026-10-05, 1:00 AM is 2026-10-03, 2:00 AM is 2026-10-14, and 3:00 AM is 2026-10-15. The image contains only rows that exist on the Alerts tab for that date. Notes that start with `Metabase 4-file backfill` are left out. If that date has no real rows, the DM gets the not-sent note and no table.

## CSM column

The image reads the CSM tab. Match is exact: Alerts `enterprise_id` → column **Enterprise ID** → column **CSM Name**. The header is not row 1. If the same enterprise has a Studio row and a Vini row, the Vini CSM Name wins. The cell is shown as stored, including `@spyne.ai`. No match is an em dash. The script does not invent a name, and it does not write names into Alerts column I.

## What you still click

1. On GitHub, open this repo → **Actions** → enable workflows if GitHub asks.
2. In the sheet, paste `apps-script/Code.gs` and run the four functions in [apps-script/SETUP.md](apps-script/SETUP.md). `setupCsmSheet` only checks that the CSM tab can be read.

```bash
python3 -m unittest tests.test_table
python3 -m vini_alert --dry-run --date 2026-10-12 --output /tmp/vini-oct12.png
```

The second command writes a PNG and does not call Slack.
