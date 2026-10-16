# VINI Accounts Alert

GitHub Actions in this repo reads the Alerts tab. The 5:30 PM IST run posts the image to `#vini-cs-team`. Tester and manual runs stay a bot DM.

Repository: [shivaniwhachal/VINI-AGENT-ALERT](https://github.com/shivaniwhachal/VINI-AGENT-ALERT). This replaces `pmm-spyne/VINI-AGENT-ALERT-`. Do not push to that repo.

| Piece | Where |
| --- | --- |
| Paste this into the tracker | [apps-script/Code.gs](apps-script/Code.gs) version `2026-10-17-mail-once-daily` |
| Clicks you have to do yourself | [apps-script/SETUP.md](apps-script/SETUP.md) |
| 5:30 PM channel post | [.github/workflows/daily-dm.yml](.github/workflows/daily-dm.yml) |
| Manual tester DM | [.github/workflows/hourly-dm-test.yml](.github/workflows/hourly-dm-test.yml) |

Tracker: `1Mgg5Xrrkza55VcsofSPOsKWdo1-zFO19luusZUt0-Ww`. Alerts gid `818793773`. CSM gid `376341429`. Keep the sheet viewable by anyone with the link.

## Slack

These Actions secrets are already on the repo:

- `SLACK_BOT_TOKEN`
- `SLACK_NOTIFY_USER_ID` — tester and manual DMs
- `SLACK_NOTIFY_VINI_CS_TEAM_CHANNEL_ID` — the 5:30 PM channel, `#vini-cs-team`
- `SLACK_NOTIFY_CHANNEL_ID` — ignored. The code never reads it.

The 5:30 PM schedule posts to the channel secret. If that secret is empty or does not start with `C`, the fallback is `C0BPY9U15U5`. Tester runs and **Run workflow** post to `SLACK_NOTIFY_USER_ID`. If that value is empty or starts with `C`, the DM falls back to `D0C40GC2CN8`. Satchit’s DM is not used.

The uploaded file name is `vini-accounts-alert.png`. The Slack file title is `Daily VINI Report`.

## Schedule

Cron `0 12 * * 1-6` is UTC. That is 5:30 PM IST, Monday through Saturday. Sunday has no run.

Monday’s image is Saturday. Tuesday through Saturday use yesterday. The image contains only rows on the Alerts tab for that date. Notes that start with `Metabase 4-file backfill` are left out. If that date has no rows, nothing is sent: no image and no note, including on the channel.

**Run workflow** on Daily DM still sends a DM. It does not post to the channel. Hourly DM is manual only and also stays a DM.

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
